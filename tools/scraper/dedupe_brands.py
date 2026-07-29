"""Collapse brand names that are the same brand spelled differently.

    python3 dedupe_brands.py --dry-run     show what would merge
    python3 dedupe_brands.py               rewrite data/catalog.json

Why this matters, beyond tidiness. The app keys real behaviour off the brand
string, so one brand under two spellings is one brand getting half of everything:

  * `idf(p.b, BRcnt)` in 50-taste-model.js weighs a brand by how rare it is.
    Split 148 Afends rows into 58 + 90 and BOTH halves score as rarer — and so
    more distinctive — than the single brand ever would.
  * `diversify()` caps a brand at perBrand entries in the results grid. A brand
    under two spellings gets two allowances and can quietly take double.
  * `topKeys(W.brand)` and BRAND_HOME show the shopper their brands. "AFENDS"
    and "Afends" as two separate favourites is simply a bug on the screen.

The rule is deliberately mechanical rather than a hand-kept alias table: fold to
ASCII, strip non-alphanumerics, lowercase, and whichever spelling has the most
rows in the catalog wins its group. Ties prefer mixed case over ALLCAPS, because
"Converse" is a name and "CONVERSE" is a shop's database being shouty.

Most-frequent is doing real work here, not just breaking ties — it is what keeps
DÔEN (27 rows) rather than DOEN (2), and Anti Social Social Club (24) rather
than AntiSocialSocialClub (3). Where it picks the less-styled form (Stussy over
Stüssy, 17 to 4) that is accepted on purpose: the app needs ONE spelling far
more than it needs the brand's preferred typography, and the majority spelling
is the one its own storefront reports.
"""

import argparse
import json
import os
import re
import sys
import unicodedata
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
CATALOG_JSON = os.path.join(REPO, "data", "catalog.json")

APP_FIELDS = ("b", "n", "p", "cur", "usd", "img", "u", "cat", "ms", "color",
              "pat", "fab", "g")


def key(brand):
    """The identity of a brand name, ignoring case, accents and punctuation."""
    s = unicodedata.normalize("NFKD", brand or "")
    s = s.encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", s.lower())


def canonical(variants, counts):
    """Pick the spelling to keep: most rows wins, mixed case beats ALLCAPS."""
    return sorted(variants, key=lambda b: (counts[b], b != b.upper()),
                  reverse=True)[0]


def plan(catalog):
    """-> {old_brand: new_brand} for every name that should change."""
    counts = Counter(p["b"] for p in catalog)
    groups = defaultdict(set)
    for b in counts:
        groups[key(b)].add(b)
    mapping = {}
    for k, variants in groups.items():
        if len(variants) < 2:
            continue
        keep = canonical(variants, counts)
        for b in variants:
            if b != keep:
                mapping[b] = keep
    return mapping, counts


def _sync_pool_to_catalog(catalog):
    """Point every pool brand at whatever spelling the catalog settled on.

    The catalog is the authority — it is what ships — so this maps the pool's
    variants onto it by the same fold, rather than re-deciding a winner.
    """
    try:
        import db
        db.init()
        conn = db.conn()
    except Exception as exc:                     # a fresh clone has no catalog.db
        print("(pool not updated: {} — fine if you have no catalog.db)".format(exc))
        return
    want = {}
    for b in {p["b"] for p in catalog}:
        want[key(b)] = b
    moved = 0
    pool_brands = [r[0] for r in conn.execute(
        "SELECT DISTINCT b FROM products WHERE b IS NOT NULL")]
    for b in pool_brands:
        target = want.get(key(b))
        if target and target != b:
            moved += conn.execute("UPDATE products SET b = ? WHERE b = ?",
                                  (target, b)).rowcount
    conn.commit()
    if moved:
        print("{} pool rows re-branded to match the catalog's spellings".format(moved))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    with open(CATALOG_JSON, encoding="utf-8") as fh:
        catalog = json.load(fh)
    mapping, counts = plan(catalog)

    if not mapping:
        print("no split brand names — {} brands across {} rows".format(
            len({p["b"] for p in catalog}), len(catalog)))
        # A clean catalog does NOT mean a clean pool, and returning here was a
        # bug: the pool keeps the pre-merge spellings, so the very next
        # `export.py --promote` re-appends them and the split comes straight back
        # (measured: 90 rows re-split on one export). Normalise the pool against
        # the catalog's own spellings before leaving.
        if not args.dry_run:
            _sync_pool_to_catalog(catalog)
        return

    merged = defaultdict(list)
    for old, new in sorted(mapping.items()):
        merged[new].append(old)
    print("merging {} spellings into {} brands:".format(
        len(mapping), len(merged)))
    for new, olds in sorted(merged.items()):
        parts = " + ".join("{} ({})".format(o, counts[o]) for o in olds)
        print("   {} ({})  <-  {}".format(new, counts[new], parts))

    moved = 0
    for p in catalog:
        if p["b"] in mapping:
            p["b"] = mapping[p["b"]]
            moved += 1
    print("\n{} rows re-branded; brands {} -> {}".format(
        moved, len(counts), len({p["b"] for p in catalog})))

    if args.dry_run:
        print("dry run — nothing written")
        return

    # The crawler pool has to move too, and this is not tidiness. export.py's
    # duplicate guard is `(brand, base_title)` against the CURRENT catalog, keyed
    # on the exact brand string. Rename brands here only, and a pool row still
    # spelled "AFENDS" no longer matches the catalog's "Afends" — so the guard
    # misses and export appends a product that is already shipped. That produced
    # 59 duplicate (brand, url) groups on one --promote 350 before this existed.
    try:
        import db
        db.init()
        conn = db.conn()
        pool_moved = 0
        for old, new in mapping.items():
            pool_moved += conn.execute(
                "UPDATE products SET b = ? WHERE b = ?", (new, old)).rowcount
        conn.commit()
        print("{} pool rows re-branded too, so export.py's duplicate guard still "
              "matches".format(pool_moved))
    except Exception as exc:                     # a fresh clone has no catalog.db
        print("(pool not updated: {} — fine if you have no catalog.db)".format(exc))

    lines = [json.dumps({k: p[k] for k in APP_FIELDS if k in p},
                        ensure_ascii=False, separators=(",", ":"))
             for p in catalog]
    text = "[\n" + ",\n".join(lines) + "\n]\n"
    try:
        json.loads(text)
    except ValueError as exc:
        sys.exit("refusing to write malformed catalog: {}".format(exc))
    with open(CATALOG_JSON, "w", encoding="utf-8") as fh:
        fh.write(text)
    print("written — run `node build.mjs && npm test`")


if __name__ == "__main__":
    main()
