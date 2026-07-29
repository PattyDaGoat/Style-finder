"""Fetch product-page descriptions for pool rows that have none, and re-tag them.

    python3 backfill_desc.py --brand Stussy --limit 200
    python3 backfill_desc.py --brands-file youth.txt --dry-run

Why this exists. `browse.py` reads a listing page and only opens a product page
when it has a reason to — a gender conflict, a missing price, `--detail all`.
That is the right default: a PDP costs a page load, and on a well-labelled
listing it usually changes nothing. But it means a fast crawl can store rows
whose only text is the product NAME, and every taxonomy field the app ranks on is
inferred from text:

    enrich.classify_ms / classify_color / classify_pat / classify_fab

all keyword-match a haystack. Starve that haystack and rows fall through to the
CAT_MS_FALLBACK defaults. Measured on a 175-row Stussy crawl at --detail-rate
0.25: 0% of rows had a description, `skate-street` was assigned to NONE of them,
and 106 of 175 landed on `elevated-basics` or `monochrome-minimal` — i.e. the
archetypal streetwear label came back tagged as quiet basics, because "Box Crown
Tee" contains no keyword that says otherwise.

That matters beyond tidiness: the youth tilt in 50-taste-model.js reads
micro-style as 45% of its signal, so a mis-tagged streetwear piece is invisible
to the very ranking meant to surface it.

So this backfills the text and re-runs the SAME classifiers, in place. It never
invents a tag — it gives the existing rules something to read. Gender is
deliberately NOT recomputed: `browse.py` decided that from the gendered listing
page the row came from, which is stronger evidence than prose, and silently
overturning it here would undo the whole reason for crawling sections.

Politeness: serial, a real user-agent, a pause between pages, and it stops on a
429 rather than retrying into a block.
"""

import argparse
import asyncio
import json
import random
import sys
import time

import db
import enrich

try:
    from playwright.async_api import async_playwright, Error as PWError
except ImportError:                                            # pragma: no cover
    sys.exit("playwright is missing — python3 -m pip install --user playwright "
             "&& playwright install chromium")

import browse   # reuse the crawler's own context setup and PDP reader


async def run(args):
    db.init()
    db.migrate()
    conn = db.conn()

    brands = []
    if args.brand:
        brands = [args.brand]
    elif args.brands_file:
        with open(args.brands_file, encoding="utf-8") as fh:
            brands = [l.strip() for l in fh if l.strip()]
    else:
        sys.exit("say --brand NAME or --brands-file FILE")

    qmarks = ",".join("?" for _ in brands)
    # in_app = 0 only. A row with in_app = 1 is already baked into
    # data/catalog.json, and re-tagging it here would silently disagree with the
    # shipped catalog — the app would rank on one set of micro-styles while the
    # pool believed another. Re-tagging shipped rows is export.py --prune's job,
    # against the catalog file itself.
    rows = [db.decode(r) for r in conn.execute(
        "SELECT * FROM products WHERE b IN ({}) AND via != 'feed' AND in_app = 0 "
        "AND (descr IS NULL OR descr = '') LIMIT ?".format(qmarks),
        brands + [args.limit])]
    if not rows:
        print("nothing to backfill — every row for those brands already has text")
        return

    print("backfilling {} rows across {} brand(s)".format(len(rows), len(brands)))
    changed = retagged = failed = 0
    t0 = time.time()

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=not args.headful)
        ctx = await browse.make_context(browser)
        try:
            for i, r in enumerate(rows, 1):
                detail = await browse.read_pdp(ctx, r["u"])
                if not detail or not (detail.get("desc") or "").strip():
                    failed += 1
                else:
                    desc = detail["desc"][:1200]
                    crumbs = detail.get("crumbs") or ""
                    # exactly the haystack browse.normalise() builds
                    haystack = " ".join([r["n"], desc[:1200], crumbs])
                    new_ms = enrich.classify_ms(haystack, r["cat"])
                    new = {
                        "descr": desc,
                        "ms": new_ms,
                        "color": enrich.classify_color(haystack),
                        "pat": enrich.classify_pat(haystack),
                        "fab": enrich.classify_fab(haystack),
                    }
                    if new_ms != (r.get("ms") or []):
                        retagged += 1
                    if not args.dry_run:
                        # ms/fab are db.LIST_FIELDS — stored as JSON text, which is
                        # what db.decode() parses back out.
                        conn.execute(
                            "UPDATE products SET descr=?, ms=?, color=?, pat=?, fab=? "
                            "WHERE id=?",
                            (new["descr"], json.dumps(new["ms"]), new["color"],
                             new["pat"], json.dumps(new["fab"]), r["id"]))
                    changed += 1
                if i % 25 == 0:
                    if not args.dry_run:
                        conn.commit()
                    print("  [{}/{}] {} text, {} re-tagged, {} no text".format(
                        i, len(rows), changed, retagged, failed), flush=True)
                await asyncio.sleep(random.uniform(*args.delay))
        finally:
            await ctx.close()
            await browser.close()

    if not args.dry_run:
        conn.commit()
    print("\n{} rows given text, {} re-tagged, {} yielded nothing, in {:.0f}s{}"
          .format(changed, retagged, failed, time.time() - t0,
                  "  (dry run — nothing written)" if args.dry_run else ""))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--brand")
    ap.add_argument("--brands-file")
    ap.add_argument("--limit", type=int, default=400)
    ap.add_argument("--headful", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--delay", nargs=2, type=float, default=(0.35, 0.8),
                    metavar=("MIN", "MAX"))
    args = ap.parse_args()
    asyncio.run(run(args))


if __name__ == "__main__":
    main()
