"""Pull live product data from the known stores.

Every brand in the catalog runs a storefront that publishes its catalog as JSON,
so a harvest is: for each store, page through its feed, normalise each product
into our schema, and upsert. Used two ways —

    python3 harvest.py --backfill 1000     one-shot: fill the DB, then inject.py
                                           bakes the picks into the HTML.
    from harvest import harvest_store       the bot calls this on a loop.

Requests are polite by default: a small thread pool, a delay between pages, and
a per-store failure is logged and skipped rather than allowed to kill the run.
"""

import argparse
import gzip
import io
import json
import random
import sys
import time
import threading
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

import db
import enrich
import stores as store_registry

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
PAGE_SIZE = 250
TIMEOUT = 20
POLITE_DELAY = (0.4, 0.9)      # seconds between pages of the same store

_print_lock = threading.Lock()


def log(msg):
    with _print_lock:
        print(msg, flush=True)


def fetch_json(url, timeout=TIMEOUT):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "application/json,text/plain,*/*",
        "Accept-Encoding": "gzip",
        "Accept-Language": "en-US,en;q=0.9",
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        if resp.headers.get("Content-Encoding") == "gzip":
            raw = gzip.GzipFile(fileobj=io.BytesIO(raw)).read()
    return json.loads(raw.decode("utf-8", "replace"))


def harvest_store(brand, domain, gender_prior=None, pages=2, skip_ids=None,
                  page_size=PAGE_SIZE):
    """Return normalised rows for one store. Never raises."""
    rows, seen = [], set()
    skip_ids = skip_ids or set()
    started = time.time()
    found = 0
    for page in range(1, pages + 1):
        url = "https://{}/products.json?limit={}&page={}".format(
            domain, page_size, page)
        try:
            data = fetch_json(url)
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError,
                TimeoutError, OSError) as exc:
            db.log_run(domain, found, 0, started, "fetch failed: {}".format(exc)[:180])
            break
        products = data.get("products") if isinstance(data, dict) else None
        if not products:
            break
        found += len(products)
        for prod in products:
            row = enrich.normalise(prod, brand, domain, gender_prior)
            if not row:
                continue
            if row["id"] in skip_ids or row["id"] in seen:
                continue
            seen.add(row["id"])
            rows.append(row)
        if len(products) < page_size:
            break
        time.sleep(random.uniform(*POLITE_DELAY))
    return rows


def harvest_all(registry, pages=2, workers=8, skip_ids=None, in_app=0,
                on_store=None, stop_when=None):
    """Harvest every store in the registry. Returns total rows added."""
    skip_ids = skip_ids or db.known_ids()
    added_total = 0
    items = list(registry.items())
    random.shuffle(items)

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(harvest_store, brand, meta["domain"],
                        meta.get("gender_prior"), pages, skip_ids): brand
            for brand, meta in items
        }
        for fut in as_completed(futures):
            brand = futures[fut]
            try:
                rows = fut.result()
            except Exception as exc:                      # belt and braces
                log("  ! {}: {}".format(brand, exc))
                continue
            rows = [r for r in rows if r["id"] not in skip_ids]
            for r in rows:
                skip_ids.add(r["id"])
            added, updated = db.upsert_many(rows, in_app=in_app)
            added_total += added
            if rows:
                db.log_run(rows[0]["src"], len(rows), added, time.time())
            if on_store:
                on_store(brand, added, added_total)
            if stop_when and stop_when():
                for f in futures:
                    f.cancel()
                break
    return added_total


def seed_in_app_rows():
    """Register everything already baked into the HTML so the bot never
    re-offers a product the page is already showing."""
    catalog = store_registry.read_catalog()
    rows = []
    for p in catalog:
        row = dict(p)
        row["id"] = enrich.product_id(p["b"], p["n"], p["u"])
        row["src"] = enrich.domain_of(p["u"])
        row["handle"] = p["u"].rstrip("/").split("/")[-1]
        rows.append(row)
    added, updated = db.upsert_many(rows, in_app=1)
    # anything that was already there needs its in_app flag asserted
    c = db.conn()
    c.executemany("UPDATE products SET in_app = 1 WHERE id = ?",
                  [(r["id"],) for r in rows])
    c.commit()
    return added, len(rows)


def main():
    ap = argparse.ArgumentParser(description="Harvest the known stores.")
    ap.add_argument("--backfill", type=int, default=0,
                    help="target NEW items per gendered section (m and f)")
    ap.add_argument("--pages", type=int, default=2)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--seed-only", action="store_true",
                    help="just register the existing HTML catalog in the DB")
    args = ap.parse_args()

    db.init()
    log("registering the existing catalog…")
    added, total = seed_in_app_rows()
    log("  {} rows in the DB from the app ({} new)".format(total, added))
    if args.seed_only:
        return

    registry = store_registry.load_registry()
    log("harvesting {} known stores (pages={}, workers={})…".format(
        len(registry), args.pages, args.workers))

    target = args.backfill

    def enough():
        if not target:
            return False
        s = db.stats()["by_gender"]
        return s.get("m", 0) >= target and s.get("f", 0) >= target

    done = [0]

    def progress(brand, added, running):
        done[0] += 1
        if done[0] % 25 == 0 or added > 60:
            s = db.stats()["by_gender"]
            log("  [{}/{}] +{:<4} total new={}  m={} f={} u={}".format(
                done[0], len(registry), added, running,
                s.get("m", 0), s.get("f", 0), s.get("u", 0)))

    t0 = time.time()
    got = harvest_all(registry, pages=args.pages, workers=args.workers,
                      on_store=progress, stop_when=enough)
    s = db.stats()
    log("\nharvested {} new products in {:.0f}s".format(got, time.time() - t0))
    log("  bot pool: {}  (m={} f={} u={})".format(
        s["bot_found"], s["by_gender"].get("m", 0),
        s["by_gender"].get("f", 0), s["by_gender"].get("u", 0)))


if __name__ == "__main__":
    sys.exit(main())
