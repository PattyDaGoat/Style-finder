"""Import Shopify shops through their GENDERED collection feeds.

    python3 import_collections.py --brand Stussy
    python3 import_collections.py --brands-file youth.txt --limit 250
    python3 import_collections.py --brand HUF --dry-run

This is the third way into a shop, and for Shopify it is the best of the three.

    harvest.py    GET /products.json. Fast and description-rich, but genderless —
                  the feed has no idea which section a piece sits in, which is why
                  its rows are stored via='feed' and export.py refuses to ship
                  them (see pick(), "via != 'feed'").
    browse.py     drives Chromium over gendered listing PAGES. Gets the section,
                  works on non-Shopify shops, and is the only option for a React
                  storefront — but it is slow, and it is at the mercy of whether a
                  grid renders for us. Dime MTL and Golf Wang both returned "no
                  products found on the page" while serving perfectly good JSON.
    this file     GET /collections/<handle>/products.json. Shopify will hand over
                  the products OF ONE COLLECTION, so picking a men's collection
                  makes the section evidence rather than a guess — the same thing
                  browse.py drives a browser for — at feed speed and reliability.

The section is taken from sites.py, which is where the gendered entry points for
each shop already live, so there is one source of truth for "which collection is
menswear" rather than two.

Two things it deliberately does differently from enrich.normalise:

  * IT FEEDS THE DESCRIPTION TO THE CLASSIFIER. enrich.normalise builds its
    haystack from title + product_type + tags + option values and never looks at
    `body_html`, so every taxonomy field is inferred from a product NAME. Names do
    not say "skate": measured on Stussy, that left `skate-street` on none of 175
    rows and mean ms-youth at 0.25, against 0.72 once the prose was included.
    Since the youth tilt in 50-taste-model.js reads micro-style as 45% of its
    signal, a name-only haystack makes a streetwear brand invisible to the exact
    ranking meant to surface it. The description is right there in the feed, so
    this uses it.

  * IT IGNORES `vendor`. On these shops that field is the printer or the
    sub-label, not the brand — Golf Wang ships "NSP PRINTING INC.", Stussy ships
    "Radial". The brand is the shop we asked, which is what the app groups by.

Rows land with via='coll' so export.py treats them as shippable, and keep their
description in `descr` so browse.py --reclassify can re-tag them later without a
refetch. Politeness: one request per collection, a real user-agent, a pause
between shops, and a 429 stops that shop for the run.
"""

import argparse
import gzip
import io
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from urllib.parse import urlparse

import db
import enrich
import sites as site_registry

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
PAGE_SIZE = 250
TIMEOUT = 25
POLITE = (0.6, 1.2)

TAGS = re.compile(r"<[^>]+>")
WS = re.compile(r"\s+")


def strip_html(raw):
    return WS.sub(" ", TAGS.sub(" ", raw or "")).strip()


def fetch(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept": "application/json",
        "Accept-Encoding": "gzip", "Accept-Language": "en-US,en;q=0.9"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        raw = resp.read()
        if resp.headers.get("Content-Encoding") == "gzip":
            raw = gzip.GzipFile(fileobj=io.BytesIO(raw)).read()
    return json.loads(raw.decode("utf-8", "replace"))


def handle_of(url):
    """'https://x.com/collections/mens-tees' -> 'mens-tees'"""
    path = urlparse(url).path.rstrip("/")
    return path.split("/collections/")[-1].split("/")[0] if "/collections/" in path else ""


def in_stock(product):
    return any(v.get("available") for v in (product.get("variants") or []))


def rows_for_collection(brand, host, handle, section, pages=2, stock_only=True,
                        drops=None):
    """One collection -> normalised, gendered, description-tagged rows."""
    def drop(reason):
        if drops is not None:
            drops[reason] += 1

    out = []
    for page in range(1, pages + 1):
        url = "https://{}/collections/{}/products.json?limit={}&page={}".format(
            host, handle, PAGE_SIZE, page)
        try:
            data = fetch(url)
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError,
                TimeoutError, OSError) as exc:
            code = getattr(exc, "code", "")
            drop("fetch failed{}".format(" " + str(code) if code else ""))
            break
        products = data.get("products") if isinstance(data, dict) else None
        if not products:
            break
        for prod in products:
            if stock_only and not in_stock(prod):
                drop("out of stock")
                continue
            row = enrich.normalise(prod, brand, host)
            if not row:
                drop("rejected by enrich.normalise")
                continue

            # --- the two departures from enrich.normalise ---
            desc = strip_html(prod.get("body_html"))[:1200]
            tags = prod.get("tags") or []
            if isinstance(tags, str):
                tags = [tags]
            opts = []
            for o in (prod.get("options") or []):
                if isinstance(o, dict):
                    opts.extend(o.get("values") or [])
            haystack = " ".join([row["n"], prod.get("product_type") or "",
                                 " ".join(tags), " ".join(map(str, opts)), desc])
            row["ms"] = enrich.classify_ms(haystack, row["cat"])
            row["color"] = enrich.classify_color(haystack)
            row["pat"] = enrich.classify_pat(haystack)
            row["fab"] = enrich.classify_fab(haystack)

            # The collection we asked for IS the section — that is the whole
            # point of this path, so it overrides the text guess outright.
            # EXCEPT for "u": that marks a collection the shop never labelled by
            # gender (a single unisex range), where there is nothing to override
            # WITH. Stamping those "m" would file an entire label as menswear on
            # no evidence, so the piece's own text keeps the decision.
            # ...unless the PIECE ITSELF says otherwise. A shop's "mens"
            # collection is not always purely menswear — Body Glove's carried
            # "Glow Aubree Cover-Up Kimono", which the stamp filed as menswear
            # and which then broke the "MENSWEAR contains no dresses" assertion.
            # gender.frontend_lock is the app's OWN verdict on the name, so when
            # it flatly disagrees with the collection the honest answer is that
            # we do not know: drop the stamp and let classify_gender read the
            # text, exactly as the "u" case does. browse.py handles the same
            # conflict by opening the product page; this is the cheap version.
            lock = gender_mod.frontend_lock(row["n"], row["cat"], row["u"],
                                            brand, row["img"])
            conflicted = section in ("m", "f") and lock in ("m", "f") and lock != section
            if section in ("m", "f") and not conflicted:
                row["g"] = section
                row["section"] = section
                row["sect_src"] = "collection"
                row["gconf"] = 5.0
                row["gwhy"] = "collection:{}".format(handle)
            elif conflicted:
                row["section"] = ""
                row["sect_src"] = "conflict"
                row["gwhy"] = "name says {} but collection {} says {}".format(
                    lock, handle, section)
                drop("name disagrees with the collection's gender")
            else:
                row["section"] = ""
                row["sect_src"] = "text"
            row["descr"] = desc
            row["via"] = "coll"
            out.append(row)
        if len(products) < PAGE_SIZE:
            break
    return out


def import_brand(site, pages=2, stock_only=True, dry_run=False):
    brand, host = site["brand"], site["host"]
    seen, rows, drops = set(), [], Counter()
    for url, section in site_registry.entries(site):
        handle = handle_of(url)
        if not handle:
            continue
        got = rows_for_collection(brand, host, handle, section, pages,
                                  stock_only, drops)
        fresh = [r for r in got if r["id"] not in seen]
        for r in fresh:
            seen.add(r["id"])
        rows.extend(fresh)
        print("   {:<34} {:>4} rows  ({})".format(handle[:34], len(fresh), section))
        time.sleep(random.uniform(*POLITE))

    added = 0
    if rows and not dry_run:
        added, _ = db.upsert_many(rows, in_app=0)
        db.log_run(host, len(rows), added, time.time(), "collection import")
    g = Counter(r["g"] for r in rows)
    withd = sum(1 for r in rows if r["descr"])
    print("  {:<20} {:>4} rows, {:>4} new, {} with text   m={} f={}   {}".format(
        brand[:20], len(rows), added if not dry_run else len(rows), withd,
        g.get("m", 0), g.get("f", 0),
        "; ".join("{} {}".format(v, k) for k, v in drops.most_common(3))))
    return rows, added


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--brand", action="append", default=[],
                    help="repeatable; matches a sites.py brand exactly")
    ap.add_argument("--brands-file")
    ap.add_argument("--pages", type=int, default=2)
    ap.add_argument("--limit", type=int, default=0,
                    help="stop after this many new rows overall (0 = no limit)")
    ap.add_argument("--include-sold-out", action="store_true",
                    help="keep products with no available variant")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    wanted = list(args.brand)
    if args.brands_file:
        with open(args.brands_file, encoding="utf-8") as fh:
            wanted += [l.strip() for l in fh if l.strip()]
    if not wanted:
        sys.exit("say --brand NAME (repeatable) or --brands-file FILE")

    db.init()
    db.migrate()
    registry = site_registry.load()

    total = 0
    for name in wanted:
        site = registry.get(name)
        if not site:
            print("!! {} is not in sites.json — add it to sites.py SEED".format(name))
            continue
        print("== {} ({}) ==".format(name, site["host"]))
        _, added = import_brand(site, args.pages, not args.include_sold_out,
                                args.dry_run)
        total += added
        if args.limit and total >= args.limit:
            print("hit --limit {}".format(args.limit))
            break

    s = db.stats()
    print("\n{} rows imported{}. pool: {} bot rows across {} stores".format(
        total, " (dry run — nothing written)" if args.dry_run else "",
        s["bot_found"], s["stores"]))
    if not args.dry_run:
        print("\n  Next:  python3 export.py --promote 200")


if __name__ == "__main__":
    main()
