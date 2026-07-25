# tools/scraper — the headless-browser catalog harvester

Grows `data/catalog.json` by browsing real clothing shops in a headless
Chromium, reading each piece's own product page, and classifying its section
(menswear / womenswear) from what the shop itself says. This is the pipeline
that produced the browser-sourced rows in the catalog; run it again to add
more.

Two harvesters, different halves of the web:

| | `harvest.py` | `browse.py` |
|---|---|---|
| How | `GET /products.json` | drives Chromium (Playwright) |
| Works on | Shopify only | anything that renders in a browser |
| Knows the shop's section | no | **yes — enters through the men's/women's index pages** |
| Sees the description | no | yes |
| Speed | thousands of rows/min | tens of rows/min |

## Setup

```
python3 -m pip install --user playwright
python3 -m playwright install chromium
```

Everything else is stdlib. The pool lives in `catalog.db` here (gitignored).

## The loop

```
python3 browse.py --discover --from-catalog   # build sites.json from the catalog's own brands
python3 browse.py --probe                     # record which shops let a crawler in
python3 browse.py --crawl --shops 20          # fill the pool (rotates; safe to re-run)
python3 browse.py --audit                     # what came back, and how good it is
python3 export.py --promote 200               # bake 200/gender into data/catalog.json
node ../../build.mjs && npm test              # rebuild, prove nothing broke
```

`browse.py --reclassify` re-runs the gender model over stored rows after a
classifier change — everything it reads is kept on the row, so improving
`gender.py` never means re-crawling.

## How gender is decided (`gender.py`)

Weighted evidence, strongest first: the shop's structured-data gender, **the
section the crawl entered through**, breadcrumbs, URL path, audience words in
the name and description, gendered garment words, body-fit language. The winner
needs a clear margin; anything closer ships as `u`. A brand that only sells one
gender is a tiebreak, not a vote.

The verdict is then reconciled with `app_section()` — a tier-for-tier port of
`detectSection()` in `src/js/15-sectioning.js`. That function is a hard gate in
the app (`passesFilters`), so a row that argues with it doesn't get a second
opinion, it gets invisibility. **If `15-sectioning.js` changes, change
`gender.py` with it** — then `--reclassify`.

`export.py` also skips intimates (same word rules as `underwearLock` in
`15-sectioning.js`): the app never deals them, so baking them in only grows
the file.

## Being a good guest

Images/fonts/analytics blocked; one page at a time per shop; seconds between
pages; **two listing pages per shop per visit** (the rotation picks up the rest
next sweep); a `429` stops that shop for the sweep and is never retried; cookie
banners are answered with *reject*, never accept; no attempt to defeat bot
detection — shops that say no are recorded in `sites.json` and skipped.

## Files

```
browse.py    the crawler: probe / crawl / discover / audit / reclassify
gender.py    the classifier + the 15-sectioning.js parity port
enrich.py    Shopify-feed normaliser + the shared taxonomy rules
harvest.py   the JSON-feed harvester (fast path for Shopify shops)
sites.py     gendered entry-point registry (sites.json)
stores.py    brand -> domain registry derived from data/catalog.json
db.py        the SQLite pool (catalog.db, local only)
export.py    picks a varied slice of the pool -> data/catalog.json
```
