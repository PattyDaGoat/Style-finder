"""Test a list of candidate shops and report which are worth adding.

    python3 probe_brands.py candidates.json --out live.json
    python3 probe_brands.py candidates.json --want 60

Input is [{"name": "...", "domain": "..."}, ...]. For each shop this answers the
only question that matters before writing a registry entry: how many products
would actually SURVIVE the pipeline and reach the catalog?

That is a much harder test than "does the domain resolve". A shop is only useful
here if it clears every gate downstream:

  * /products.json answers at all (i.e. it is Shopify and has not locked the feed)
  * its products are APPAREL — enrich.classify_cat has to place them in a
    shipping category, so a shop selling mostly decks, wax and hardware scores
    near zero however famous it is
  * enough of them are IN STOCK
  * enough of them are under enrich.MAX_PRICE ($200) — this is the quiet killer
    for premium streetwear, where a whole catalog can sit above the cap
  * it has gendered collections, or at least a usable general one

So it runs the real enrich.normalise over a sample and counts what comes out,
rather than trusting the product count Shopify reports. `eligible` is the number
to read: it is what the shop is worth in catalog rows, and shops are ranked by it.
"""

import argparse
import concurrent.futures as cf
import gzip
import io
import json
import os
import re
import sys
import threading
import time
import urllib.error
import urllib.request

import enrich

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
TIMEOUT = 18

# ---- pacing -----------------------------------------------------------------
# Shopify rate-limits per IP, not per shop, so probing many shops at once is one
# fast client as far as it is concerned. The first run of this file used 14
# workers with no delay and earned HTTP 429 from 70 of 142 shops — including
# shops that had answered perfectly minutes earlier, and that still returned 200
# to a hand-run curl while the probe was being refused. Read that carefully: the
# failures were NOT the shops being unavailable, they were this tool being told
# to slow down, and a report built from that run would have concluded a hundred
# perfectly good brands did not exist.
#
# So: a global token bucket, not per-thread delays. Every request through this
# module waits its turn, whichever shop it is for.
RATE = 1.6                 # requests per second, all shops combined
_rate_lock = threading.Lock()
_next_slot = [0.0]


def _pace():
    with _rate_lock:
        now = time.monotonic()
        slot = max(now, _next_slot[0])
        _next_slot[0] = slot + 1.0 / RATE
    wait = slot - time.monotonic()
    if wait > 0:
        time.sleep(wait)

MENS = re.compile(r"\b(mens?|for-?him|homme|herren|uomo)\b", re.I)
WOMENS = re.compile(r"\b(womens?|ladies|for-?her|femme|damen|donna)\b", re.I)
KIDS = re.compile(r"\b(kids?|child|children|boys?|girls?|baby|toddler|junior|youth)\b", re.I)
SKIP = re.compile(r"\b(sale|archive|gift|clearance|outlet|sample|preorder|lookbook|"
                  r"editorial|journal|blog|hardware|hardgood|deck|wheel|truck|"
                  r"bearing|griptape|wax|accessor)\w*\b", re.I)


class Throttled(Exception):
    """HTTP 429 — us, not them. Kept distinct from a genuine failure so a
    throttled probe can never be mistaken for a shop that does not exist."""


def fetch(url, timeout=TIMEOUT, retries=2):
    for attempt in range(retries + 1):
        _pace()
        req = urllib.request.Request(url, headers={
            "User-Agent": UA, "Accept": "application/json", "Accept-Encoding": "gzip"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read()
                if r.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.GzipFile(fileobj=io.BytesIO(raw)).read()
            return json.loads(raw.decode("utf-8", "replace"))
        except urllib.error.HTTPError as exc:
            if exc.code != 429:
                raise
            if attempt == retries:
                raise Throttled(url)
            # honour Retry-After when the shop sends one, else back off hard
            wait = 0
            try:
                wait = float(exc.headers.get("Retry-After") or 0)
            except (TypeError, ValueError):
                wait = 0
            time.sleep(max(wait, 4.0 * (attempt + 1)))
    raise Throttled(url)


def in_stock(p):
    return any(v.get("available") for v in (p.get("variants") or []))


def probe(cand, sample_pages=2):
    name, domain = cand.get("name") or cand["domain"], cand["domain"]
    out = {"name": name, "domain": domain, "ok": False, "why": "",
           "total": 0, "eligible": 0, "m": 0, "f": 0, "colls": 0,
           "mens_colls": [], "womens_colls": [], "general_colls": []}

    host = None
    for h in (domain, "www." + domain):
        try:
            d = fetch("https://{}/products.json?limit=250".format(h))
            if isinstance(d, dict) and d.get("products") is not None:
                host = h
                break
        except Throttled:
            out["why"] = "RATE-LIMITED (429) — retry later, this is us not them"
            out["throttled"] = True
            return out
        except Exception as exc:
            out["why"] = "{}{}".format(type(exc).__name__,
                                       " " + str(getattr(exc, "code", "")) if hasattr(exc, "code") else "")
    if not host:
        out["why"] = out["why"] or "no products.json"
        return out
    out["host"] = host

    prods = []
    for page in range(1, sample_pages + 1):
        try:
            d = fetch("https://{}/products.json?limit=250&page={}".format(host, page))
        except Exception:
            break
        got = d.get("products") or []
        if not got:
            break
        prods.extend(got)
        if len(got) < 250:
            break
    out["total"] = len(prods)
    if not prods:
        out["why"] = "feed is empty"
        return out

    # run the REAL normaliser: this is what decides whether a row can ship
    elig = 0
    for p in prods:
        if not in_stock(p):
            continue
        row = enrich.normalise(p, name, host)
        if row and row["cat"] in ("tee", "knit", "sweat", "shirt", "outer",
                                  "trouser", "short", "dress", "cap", "shoe"):
            elig += 1
    out["eligible"] = elig

    try:
        colls = fetch("https://{}/collections.json?limit=250".format(host)).get("collections") or []
    except Exception:
        colls = []
    out["colls"] = len(colls)
    for c in colls:
        h, t, n = c.get("handle") or "", c.get("title") or "", int(c.get("products_count") or 0)
        if not h or n < 8:
            continue
        blob = "{} {}".format(h.replace("-", " "), t)
        if KIDS.search(blob) or SKIP.search(blob):
            continue
        if WOMENS.search(blob) and not MENS.search(blob):
            out["womens_colls"].append((h, n))
        elif MENS.search(blob) and not WOMENS.search(blob):
            out["mens_colls"].append((h, n))
        else:
            out["general_colls"].append((h, n))
    for k in ("mens_colls", "womens_colls", "general_colls"):
        out[k] = [h for h, n in sorted(out[k], key=lambda x: -x[1])[:4]]

    out["ok"] = elig >= 25 and (out["mens_colls"] or out["womens_colls"] or out["general_colls"])
    if not out["ok"] and not out["why"]:
        out["why"] = ("only {} eligible apparel rows".format(elig) if elig < 25
                      else "no usable collection")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("candidates")
    ap.add_argument("--out", default="probed.json")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--want", type=int, default=0,
                    help="stop reporting once this many shops pass")
    args = ap.parse_args()

    with open(args.candidates, encoding="utf-8") as fh:
        cands = json.load(fh)
    if isinstance(cands, dict):
        cands = cands.get("brands") or []
    print("probing {} candidate shops…".format(len(cands)), flush=True)

    res = []
    with cf.ThreadPoolExecutor(max_workers=args.workers) as ex:
        for i, r in enumerate(ex.map(probe, cands), 1):
            res.append(r)
            if i % 25 == 0:
                print("  {}/{}  {} usable so far".format(
                    i, len(cands), sum(1 for x in res if x["ok"])), flush=True)

    good = sorted([r for r in res if r["ok"]], key=lambda r: -r["eligible"])
    bad = [r for r in res if not r["ok"]]
    with open(args.out, "w", encoding="utf-8") as fh:
        json.dump({"usable": good, "rejected": bad}, fh, indent=1)

    print("\n{} usable / {} probed".format(len(good), len(res)))
    print("  potential rows (capped at 60/brand): {}".format(
        sum(min(60, r["eligible"]) for r in good)))
    print("\ntop shops by eligible apparel:")
    for r in good[:25]:
        print("   {:<26} {:<28} {:>4} eligible  m={} f={} gen={}".format(
            r["name"][:26], r["host"][:28], r["eligible"],
            len(r["mens_colls"]), len(r["womens_colls"]), len(r["general_colls"])))
    reasons = {}
    for r in bad:
        k = re.sub(r"\d+", "N", r["why"] or "?")
        reasons[k] = reasons.get(k, 0) + 1
    thr = sum(1 for r in bad if r.get("throttled"))
    if thr:
        print("\n  !! {} shops were RATE-LIMITED, not rejected on merit. Re-probe those"
              "\n     before concluding anything about them.".format(thr))
    print("\nrejected, by reason:")
    for k, v in sorted(reasons.items(), key=lambda kv: -kv[1])[:10]:
        print("   {:>4}  {}".format(v, k))
    print("\nwrote {}".format(args.out))


if __name__ == "__main__":
    main()
