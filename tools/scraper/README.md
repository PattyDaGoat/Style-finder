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
python3 find_brands.py --write                # find brands not in the app yet
python3 browse.py --discover --from-catalog   # build sites.json from the catalog's own brands
python3 browse.py --probe                     # record which shops let a crawler in
python3 browse.py --crawl --shops 20          # fill the pool (rotates; safe to re-run)
python3 browse.py --audit                     # what came back, and how good it is
python3 export.py --promote 200               # bake 200/gender into data/catalog.json
node ../../build.mjs && npm test              # rebuild, prove nothing broke
```

`--shops` caps how many shops a crawl *starts*; it says nothing about how long
one takes, and a shop whose gender is guessed can cost ten times an established
one because nearly every row earns a product-page visit. Add `--max-minutes N`
where the clock matters — the crawl then stops itself between shops, listing
pages and product pages, exits 0, and leaves everything it did not reach at the
front of the rotation for next time. The GitHub Actions job always passes it;
without it a crawl runs until it is done, which is what you want at a terminal.

## Adding brands the app has never sold (`find_brands.py`)

`--discover` grows the browse-list from brands already in the catalog, so it
only ever finds more of the same shops. `find_brands.py` is the other
direction: a pool of labels the app *doesn't* carry, each probed in a headless
browser to work out whether it can be crawled and where its gendered pages are.

```
python3 find_brands.py                    probe the pool, print findings, write nothing
python3 find_brands.py --write            add the good ones to sites.json
python3 find_brands.py --from list.txt    your own list ("Brand = https://shop.com")
python3 find_brands.py --only "Kith,Bode"
```

It reads each shop's own `/collections.json` and keeps the collections that hold
garments, so an entry point is registered only when the shop itself says which
section it is. A candidate has to clear robots.txt, name at least one gendered
garment collection, and return products — otherwise it's reported with the
reason and skipped. 401/403 means no, and is taken as no.

**Single-gender shops.** Plenty of good labels never say "mens" anywhere,
because the whole shop is one gender (Todd Snyder, WTAPS; Khaite, Toteme).
Since the entry-point gender is the strongest signal `gender.py` gets, guessing
it wrong is worse than skipping the shop, so only two narrow rules apply — a
women's call needs the classifier *and* real dress stock (dress share separates
Khaite at 16% from a sneaker boutique at 0%, where the vote count alone can't);
a men's call needs no women's collection anywhere on the site and no womenswear
in a 100-product sample. Anything else is left out, and shops that are added
this way carry `"gender_source": "inferred"` in `sites.json` so the call can be
reviewed or dropped later.

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

## Clothes only

The deck is for building outfits, so `export.py` ships garments, headwear and
footwear and nothing else — see `ALLOWED_CATS` and `is_clothing()` there. Out:
underwear (same word rules as `underwearLock` in `15-sectioning.js`, so the app
was never going to deal them anyway), socks and hosiery, and the whole `acc`
category, which is where `enrich.py` files bags, belts, ties, scarves,
jewellery, sunglasses and towels.

Socks are caught by name as well as by category, because `enrich.py` files
"Loafer Dress Socks" under `shoe`. Whichever noun comes last is the thing being
sold: a *sock boot* is a boot, a *boot sock* is a sock.

The same rule can be applied to rows already in the catalog:

```
python3 export.py --prune --dry-run     # count what would go, and why
python3 export.py --prune               # rewrite data/catalog.json
```

## Being a good guest

Images/fonts/analytics blocked; one page at a time per shop; seconds between
pages; **two listing pages per shop per visit** (the rotation picks up the rest
next sweep); a `429` stops that shop for the sweep and is never retried; cookie
banners are answered with *reject*, never accept; no attempt to defeat bot
detection — shops that say no are recorded in `sites.json` and skipped.

## Files

```
find_brands.py  finds brands the app doesn't carry and registers how to crawl them
browse.py    the crawler: probe / crawl / discover / audit / reclassify
gender.py    the classifier + the 15-sectioning.js parity port
enrich.py    Shopify-feed normaliser + the shared taxonomy rules
harvest.py   the JSON-feed harvester (fast path for Shopify shops)
sites.py     gendered entry-point registry (sites.json)
stores.py    brand -> domain registry derived from data/catalog.json
db.py        the SQLite pool (catalog.db, local only)
export.py    picks a varied slice of the pool -> data/catalog.json
```
