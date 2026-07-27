"""Bake scraper finds into data/catalog.json.

The crawler (browse.py) fills a local SQLite pool; this picks a clean, varied
slice and appends it to the repo's catalog — one product per line, exactly the
format build.mjs asserts. It is the repo-native replacement for the standalone
workspace's inject.py, which wrote into the built HTML directly; here the HTML
is generated, so the data file is the thing to edit.

    python3 export.py --shipped                  rows already curated (in_app=1)
    python3 export.py --promote 200              pick 200/gender fresh from the pool
    python3 export.py --promote 200 --dry-run    show the pick, write nothing
    python3 export.py --prune                    drop non-clothing rows already baked in

Clothes only: garments, headwear and footwear ship. Underwear, socks/hosiery,
bags, belts, jewellery and homeware do not — see ALLOWED_CATS and is_clothing().

Never hand-edit data/catalog.json in bulk — run this, so the change is
reproducible (CONTRIBUTING.md, "About data/catalog.json").
"""

import argparse
import json
import os
import re
import sys
from collections import defaultdict

import db
import stores as store_registry

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
CATALOG_JSON = os.path.join(REPO, "data", "catalog.json")

# fields the app reads — anything else the scraper knows stays in the database
APP_FIELDS = ("b", "n", "p", "cur", "usd", "img", "u", "cat", "ms", "color",
              "pat", "fab", "g")

MAX_PER_BRAND = 8          # per category, while quota-picking
GLOBAL_PER_BRAND = 20      # per brand across the whole export — one prolific
                           # store adding 60 near-identical rows makes the
                           # simulated-shopper eval visibly noisier (suite 04)
MIN_PRICE = 5.0

# Mirror of the head-noun junk check in test/03-catalog-gender-and-photo.js —
# things the crawler's own not-apparel rule is too lenient about. Keep in sync.
JUNK_RX = re.compile(
    r"\b(beach towel|bath towel|bath sheet|golf towel|pillowcase|pillow|"
    r"coverlet|blanket|throw|candle|mug|tumbler|magazine|hand cream|"
    r"bottle opener|woodcarved|skateboard|wheel|griptape|putter|coaster|"
    r"gift card|serum|sunscreen|shampoo|notebook|furniture|collected works|"
    r"packing cube|spectacle cord)\b", re.I)

# Roughly the mix the catalog already ships, so additions feel like more of the
# same deck rather than a bag of socks. The `acc` slice is deliberately absent —
# see ALLOWED_CATS below.
CAT_SHARE = {"tee": .30, "shirt": .13, "trouser": .12, "short": .08,
             "dress": .08, "sweat": .07, "knit": .07, "outer": .07,
             "cap": .04, "shoe": .04}

# ---- clothes only ----------------------------------------------------------
# The deck is for outfits, so only garments ship. `acc` is where enrich.py files
# socks, bags, belts, ties, scarves, gloves, wallets, jewellery, sunglasses and
# towels — none of them things you swipe on to build a look — so the whole
# category stays out. Headwear (`cap`) and footwear (`shoe`) are kept: they're
# worn, and the app already gives each its own filter chip.
ALLOWED_CATS = ("tee", "knit", "sweat", "shirt", "outer", "trouser", "short",
                "dress", "cap", "shoe")

# Socks and hosiery, caught by name as well as by category, because a stray
# "Elgin Cotton Blend Sock" filed under knitwear is still a sock. Shoes named
# after the style are not: a "sock sneaker" and a "sock boot" are footwear.
SOCK_RE = re.compile(
    r"\b(socks?|hosiery|tights?|stockings?|leg\s*warmers?|"
    r"knee\s*highs?|ankle\s*highs?)\b", re.I)
SOCK_EXEMPT_RE = re.compile(
    r"\b(sneakers?|trainers?|boots?|runners?|shoes?|slip[-\s]?ons?|"
    r"mules?|sandals?|loafers?)\b", re.I)


def is_socks(name, cat=None):
    """True for socks/hosiery — but not for shoes that borrow the word.

    Whichever noun comes *last* is the thing being sold: a "Sock Runner
    Sneaker" is a sneaker, a "Boot Sock" is a sock. The category is no help
    here — enrich.py files "Loafer Dress Socks" under `shoe` because the name
    starts with a shoe word, which is exactly the case this has to get right.
    """
    text = name or ""
    sock = None
    for match in SOCK_RE.finditer(text):
        sock = match
    if not sock:
        return False
    shoe = None
    for match in SOCK_EXEMPT_RE.finditer(text):
        shoe = match
    return not (shoe and shoe.start() > sock.start())


def is_clothing(row):
    """The one gate: a garment, not underwear, not socks, not a bag."""
    name, cat = row.get("n") or "", row.get("cat")
    return (cat in ALLOWED_CATS
            and not is_underwear(name, cat)
            and not is_socks(name, cat)
            and not JUNK_RX.search(name))

# The app hides intimates from the deck (underwearLock in 15-sectioning.js), so
# baking them in just grows the file with rows nobody will ever see. Same words,
# same exemptions as the app: sports bras, swim briefs, bikini bottoms, thong
# sandals and boxer overshirts are not underwear.
UW_SCRUB = re.compile(
    r"\b(sports?\s+bras?|swim\s+briefs?|bikini\s+bottoms?|"
    r"thong\s+(sandals?|slides?|flip\s*-?\s*flops?)|"
    r"(leather|heel|suede|toe)\s+thongs?|"
    r"boxer\s+(overshirts?|shirts?|jackets?|hoodies?|sweat\w*|tees?|tops?|fit)|"
    r"bras?\s+details?|bra[-\s]friendly|built[-\s]in\s+bras?)\b", re.I)
UW_RE = re.compile(
    r"\b(underwear|undies|underpants|boxers?|boxer\s*briefs?|briefs?|"
    r"jock\s*straps?|y-?fronts?|panty|panties|thongs?|g-?strings?|knickers|"
    r"lingerie|negligees?|nighties?|nightgowns?|bras?|bralettes?|"
    r"long\s*johns?)\b", re.I)


def is_underwear(name, cat=None):
    n = UW_SCRUB.sub(" ", name or "")
    if cat == "shoe" or re.search(r"\b(bikini|swim)\b", name or "", re.I):
        n = re.sub(r"\bthongs?\b", " ", n, flags=re.I)
    elif (re.search(r"\bthongs\b", n, re.I)
          and not re.search(r"\b(packs?|multi\w*|seamless|invisible|cotton|"
                            r"underwear)\b", n, re.I)):
        n = re.sub(r"\bthongs\b", " ", n, flags=re.I)
    return bool(UW_RE.search(n))


def base_title(name):
    """'The Camp Shirt in Washed Olive' -> 'the camp shirt' — collapses
    colourways of the same piece down to one entry."""
    n = re.sub(r"\s*[-—]\s*[^-—]+$", "", name or "")
    n = re.sub(r"\s+in\s+[A-Z].*$", "", n)
    n = re.sub(r"\s*\([^)]*\)\s*$", "", n)
    return n.strip().lower()


def _round_robin(by_brand, want, max_depth=MAX_PER_BRAND):
    picked, depth = [], 0
    brands = sorted(by_brand, key=lambda b: -len(by_brand[b]))
    while len(picked) < want and depth < max_depth:
        took = 0
        for b in brands:
            if len(picked) >= want:
                break
            bucket = by_brand[b]
            if depth < len(bucket):
                picked.append(bucket[depth])
                took += 1
        if not took:
            break
        depth += 1
    return picked


def eligible(row, exclude_titles):
    return (row.get("usd", 0) >= MIN_PRICE and row.get("img")
            and is_clothing(row)
            and (row["b"], base_title(row["n"])) not in exclude_titles)


def pick(gender, want, exclude_titles):
    """Choose `want` varied browser-scraped products for one section.

    Draws from every browser-scraped row in the pool. The per-title exclusion
    against the current catalog is what prevents duplicates, so rows that were
    already curated somewhere else are simply skipped where they'd collide.
    """
    rows = [db.decode(r) for r in db.conn().execute(
        "SELECT * FROM products WHERE g = ? "
        "AND via IS NOT NULL AND via != 'feed' ORDER BY RANDOM()", (gender,))]
    buckets = defaultdict(lambda: defaultdict(list))
    seen_titles = set()
    per_brand = defaultdict(int)
    for r in rows:
        if not eligible(r, exclude_titles):
            continue
        key = (r["b"], base_title(r["n"]))
        if key in seen_titles:
            continue
        if per_brand[r["b"]] >= GLOBAL_PER_BRAND:
            continue
        seen_titles.add(key)
        per_brand[r["b"]] += 1
        buckets[r["cat"]][r["b"]].append(r)

    picked = []
    for cat, share in sorted(CAT_SHARE.items(), key=lambda kv: -kv[1]):
        picked.extend(_round_robin(buckets.get(cat, {}), int(round(want * share))))
    if len(picked) < want:
        chosen = {r["id"] for r in picked}
        spare = defaultdict(list)
        for cat, by_brand in buckets.items():
            if cat == "acc":
                continue
            for brand, items in by_brand.items():
                spare[brand].extend(i for i in items if i["id"] not in chosen)
        picked.extend(_round_robin(spare, want - len(picked),
                                   max_depth=MAX_PER_BRAND * 3))
    return picked[:want]


def shipped(exclude_titles):
    """Rows already curated into the app in the standalone workspace."""
    rows = [db.decode(r) for r in db.conn().execute(
        "SELECT * FROM products WHERE in_app = 1 "
        "AND via IS NOT NULL AND via != 'feed'")]
    out, seen = [], set()
    for r in rows:
        if not eligible(r, exclude_titles):
            continue
        key = (r["b"], base_title(r["n"]))
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
    return out


def append_to_catalog(rows, dry_run=False):
    """data/catalog.json is `[\\n{...},\\n...\\n{...}\\n]` — one product per line."""
    # A crawl that finds nothing is normal (every shop rate-limited, or the pool
    # is already fully exported). Appending zero rows used to write a trailing
    # comma before the closing bracket, which is invalid JSON — and the next
    # read of the file blew up. Nothing to add means leave the file alone.
    if not rows:
        return 0
    with open(CATALOG_JSON, encoding="utf-8") as fh:
        text = fh.read().rstrip()
    if not text.endswith("]"):
        sys.exit("data/catalog.json does not end with ']' — refusing to touch it")
    body = text[:text.rfind("]")].rstrip()
    if body.endswith(","):
        body = body[:-1]
    lines = [json.dumps({k: r[k] for k in APP_FIELDS}, ensure_ascii=False,
                        separators=(",", ":")) for r in rows]
    new_text = body + ",\n" + ",\n".join(lines) + "\n]\n"
    # Never hand the repo a file that doesn't parse. build.mjs splices this text
    # in verbatim, so a malformed catalog is a broken app, not a failed build.
    try:
        json.loads(new_text)
    except ValueError as exc:
        sys.exit("refusing to write malformed catalog: {}".format(exc))
    if dry_run:
        return len(rows)
    with open(CATALOG_JSON, "w", encoding="utf-8") as fh:
        fh.write(new_text)
    # the app owns them now — the crawler must not offer them again
    db.conn().executemany("UPDATE products SET in_app = 1 WHERE id = ?",
                          [(r["id"],) for r in rows])
    db.conn().commit()
    return len(rows)


def prune_catalog(dry_run=False):
    """Apply the clothes-only rule to rows that are already in the catalog.

    Changing `eligible()` only governs what ships next. Everything baked in
    before that — socks, boxer briefs, belts, tote bags — is still sitting in
    data/catalog.json. This re-runs the same gate over the existing file so the
    rule is true of the whole catalog, not just of future exports.

        python3 export.py --prune --dry-run    # count what would go
        python3 export.py --prune              # rewrite the catalog
    """
    catalog = store_registry.read_catalog()
    keep = [p for p in catalog if is_clothing(p)]
    dropped = [p for p in catalog if not is_clothing(p)]
    if not dropped:
        print("catalog is already clothes-only — {} items".format(len(catalog)))
        return 0

    reasons = defaultdict(int)
    for p in dropped:
        name, cat = p.get("n") or "", p.get("cat")
        if is_underwear(name, cat):
            reasons["underwear"] += 1
        elif is_socks(name, cat):
            reasons["socks / hosiery"] += 1
        elif cat not in ALLOWED_CATS:
            reasons["not a garment (cat={})".format(cat)] += 1
        else:
            reasons["junk / homeware"] += 1
    print("dropping {} of {} rows:".format(len(dropped), len(catalog)))
    for why, n in sorted(reasons.items(), key=lambda kv: -kv[1]):
        print("   {:5d}  {}".format(n, why))
    print("   e.g. " + " / ".join(p["n"][:34] for p in dropped[:4]))

    if dry_run:
        print("dry run — nothing written")
        return len(dropped)

    lines = [json.dumps({k: p[k] for k in APP_FIELDS if k in p},
                        ensure_ascii=False, separators=(",", ":")) for p in keep]
    text = "[\n" + ",\n".join(lines) + "\n]\n"
    try:
        json.loads(text)
    except ValueError as exc:
        sys.exit("refusing to write malformed catalog: {}".format(exc))
    with open(CATALOG_JSON, "w", encoding="utf-8") as fh:
        fh.write(text)
    print("catalog now: {} items — run `node build.mjs && npm test`".format(len(keep)))
    return len(dropped)


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--promote", type=int, default=0, metavar="N",
                    help="pick N per gender fresh from the crawler pool")
    ap.add_argument("--shipped", action="store_true",
                    help="export the already-curated set instead")
    ap.add_argument("--prune", action="store_true",
                    help="drop non-clothing rows already in data/catalog.json")
    ap.add_argument("--db", help="path to catalog.db (default: alongside this script)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    # Pruning reads and rewrites the catalog file only — it never touches the
    # crawler pool, so it works on a fresh clone with no catalog.db.
    if args.prune:
        prune_catalog(args.dry_run)
        return

    if args.db:
        db.DB_PATH = os.path.abspath(args.db)
    db.init()

    catalog = store_registry.read_catalog()
    existing = {(p["b"], base_title(p["n"])) for p in catalog}
    print("catalog today: {} items".format(len(catalog)))

    if args.shipped:
        rows = shipped(existing)
    elif args.promote:
        rows = []
        for g in ("m", "f"):
            got = pick(g, args.promote, existing)
            for r in got:
                existing.add((r["b"], base_title(r["n"])))
            rows.extend(got)
    else:
        sys.exit("say --shipped or --promote N")

    by_g = defaultdict(int)
    for r in rows:
        by_g[r["g"]] += 1
    print("exporting {} rows  (m={} f={} u={}) from {} brands".format(
        len(rows), by_g.get("m", 0), by_g.get("f", 0), by_g.get("u", 0),
        len({r["b"] for r in rows})))

    if not rows:
        # Not an error. The crawl may have been rate-limited everywhere, or the
        # pool may already be fully exported. Say so and leave with a clean exit
        # so an automated run reports "nothing new" rather than failing.
        print("nothing new to add — catalog left untouched at {} items".format(
            len(catalog)))
        return

    append_to_catalog(rows, args.dry_run)
    if args.dry_run:
        print("dry run — nothing written")
    else:
        print("catalog now: {} items — run `node build.mjs && npm test`".format(
            len(catalog) + len(rows)))
        store_registry.save_registry(
            store_registry.build_registry(store_registry.read_catalog()))
        print("store registry refreshed")


if __name__ == "__main__":
    main()
