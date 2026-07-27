"""find_brands.py — find new clothing brands and add them to the crawl list.

`browse.py --discover --from-catalog` grows the browse-list out of brands the
app already sells, so it only ever finds more of the same shops. This finds
brands that are *not* in the catalog yet and works out how to crawl them.

    python3 find_brands.py                    probe the built-in pool, print findings
    python3 find_brands.py --write            ...and add the good ones to sites.json
    python3 find_brands.py --from list.txt    probe your own list instead
    python3 find_brands.py --only "Kith,Bode" probe named brands
    python3 find_brands.py --all              re-probe brands already registered

Then crawl and bake them in the usual way:

    python3 browse.py --crawl --shops 20
    python3 export.py --promote 200
    node ../../build.mjs && npm test

WHAT "FINDING" MEANS HERE
-------------------------
A brand is only useful to the crawler if we know *where its men's and women's
pages are* — that entry point is the strongest gender signal `gender.py` gets,
better than anything a product title can tell it. So for each candidate this
opens a headless browser and asks the shop itself: Shopify stores publish their
whole collection list at /collections.json, which is where the gendered
collection handles live ("mens-shirts", "womens-outerwear"). We read that, keep
the collections that hold *garments*, and register those as entry points.

A candidate is only added if it clears all of:
  * robots.txt allows the paths we'd read
  * /collections.json parses and names at least one gendered garment collection
  * /products.json actually returns products

Anything else is reported with the reason and left out. A shop that answers 401
or 403 is a shop that said no; it gets recorded and never retried, exactly as in
browse.py. Nothing here tries to defeat bot detection.

CLOTHES ONLY
------------
Collections of socks, underwear, jewellery, bags, fragrance and homeware are
skipped when choosing entry points, so the crawler never walks into them. That
is the same rule `export.py` enforces at the other end of the pipeline
(`is_clothing`), applied early enough to save the crawl budget.
"""

import argparse
import asyncio
import json
import os
import re
import sys
from collections import Counter
from urllib.parse import urlparse

import enrich
import gender as gender_model
import sites as site_registry
import stores as store_registry

HERE = os.path.dirname(os.path.abspath(__file__))

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

MAX_ENTRIES_PER_GENDER = 3
PAGE_TIMEOUT = 30000
POLITE_DELAY = 1.0          # seconds between requests to the same shop


# =============================================================================
#  The candidate pool
# =============================================================================
# Every one of these was reached with a headless browser on 2026-07-26 and had a
# readable catalog. They are grouped by what they'd bring to the deck; the point
# of the mix is that the app stops feeling like one aesthetic.
#
# `note` is carried into sites.json so the next person knows why a shop is here.
CANDIDATES = [
    # ---- high fashion / designer -------------------------------------------
    ("Rick Owens", "https://www.rickowens.eu", "designer"),
    ("AMIRI", "https://www.amiri.com", "designer"),
    ("Gallery Dept.", "https://gallerydept.com", "designer"),
    ("Bode", "https://bode.com", "designer"),
    ("A.P.C.", "https://www.apc-us.com", "designer"),
    ("sacai", "https://www.sacai.jp", "designer"),
    ("Casablanca", "https://casablancaparis.com", "designer"),
    ("Lemaire", "https://www.lemaire.fr", "designer"),
    ("Khaite", "https://khaite.com", "designer"),
    ("Toteme", "https://toteme-studio.com", "designer"),
    ("Dover Street Market", "https://shop.doverstreetmarket.com", "designer"),
    ("Heron Preston", "https://heronpreston.com", "designer"),
    ("WTAPS", "https://wtaps.com", "designer"),
    ("NEIGHBORHOOD", "https://neighborhood.jp", "designer"),
    ("Chrome Hearts", "https://www.chromehearts.com", "designer"),

    # ---- elevated streetwear ------------------------------------------------
    ("Kith", "https://kith.com", "streetwear"),
    ("Aime Leon Dore", "https://www.aimeleondore.com", "streetwear"),
    ("Stussy", "https://www.stussy.com", "streetwear"),
    ("Fear of God", "https://fearofgod.com", "streetwear"),
    ("Denim Tears", "https://denimtears.com", "streetwear"),
    ("Corteiz", "https://crtz.xyz", "streetwear"),
    ("Hellstar", "https://hellstar.com", "streetwear"),
    ("Madhappy", "https://www.madhappy.com", "streetwear"),

    # ---- popular / mainstream ----------------------------------------------
    ("Todd Snyder", "https://www.toddsnyder.com", "mainstream"),
    ("Alo Yoga", "https://www.aloyoga.com", "mainstream"),

    # ---- footwear -----------------------------------------------------------
    ("Reebok", "https://www.reebok.com", "footwear"),
    ("Blundstone", "https://www.blundstone.com", "footwear"),
    ("KEEN", "https://www.keenfootwear.com", "footwear"),
    ("Xero Shoes", "https://xeroshoes.com", "footwear"),
    ("Beckett Simonon", "https://beckettsimonon.com", "footwear"),
    ("norda", "https://nordarun.com", "footwear"),
    ("Sabah", "https://sabah.am", "footwear"),

    # ---- sneaker boutiques --------------------------------------------------
    # These stock Nike, Jordan, adidas, New Balance and ASICS. Those brands sell
    # direct only through their own bot-protected sites, so this is the honest
    # way the deck gets the sneakers everybody actually wants.
    ("Concepts", "https://cncpts.com", "sneaker boutique"),
    ("Extra Butter", "https://extrabutterny.com", "sneaker boutique"),
    ("UNDEFEATED", "https://undefeated.com", "sneaker boutique"),
    ("Shoe Palace", "https://www.shoepalace.com", "sneaker boutique"),
    ("Sneaker Politics", "https://sneakerpolitics.com", "sneaker boutique"),
    ("A Ma Maniere", "https://www.amamaniere.com", "sneaker boutique"),
    ("Social Status", "https://www.socialstatuspgh.com", "sneaker boutique"),
    ("Notre", "https://www.notre-shop.com", "sneaker boutique"),
    ("Feature", "https://feature.com", "sneaker boutique"),
    ("Packer Shoes", "https://packershoes.com", "sneaker boutique"),
    ("Bodega", "https://bdgastore.com", "sneaker boutique"),
    ("DTLR", "https://www.dtlr.com", "sneaker boutique"),
    ("Sneakersnstuff", "https://www.sneakersnstuff.com", "sneaker boutique"),
    ("Renarts", "https://renarts.com", "sneaker boutique"),
    ("Xhibition", "https://xhibition.co", "sneaker boutique"),
]


# =============================================================================
#  Reading a shop's collection list
# =============================================================================
MEN_TOKENS = {"men", "mens", "men's", "mensday", "male", "guys", "him", "his"}
WOMEN_TOKENS = {"women", "womens", "women's", "ladies", "female", "her", "hers",
                "wmns", "womans", "womens-"}

# Collections worth entering: they hold garments.
GARMENT_WORDS = {
    "shirts", "shirt", "tees", "tee", "t-shirts", "tops", "top", "knitwear",
    "knits", "sweaters", "sweater", "sweats", "sweatshirts", "hoodies", "hoodie",
    "fleece", "outerwear", "jackets", "jacket", "coats", "coat", "bottoms",
    "pants", "trousers", "denim", "jeans", "shorts", "dresses", "dress",
    "skirts", "skirt", "clothing", "apparel", "ready-to-wear", "rtw",
    "sneakers", "shoes", "footwear", "boots", "all", "new", "new-arrivals",
    "newarrivals", "collection", "essentials", "polos", "jumpers", "cardigans",
    "activewear", "loungewear", "suiting", "tailoring", "overshirts", "trousers",
}

# Collections to stay out of — non-clothing, or things the app never shows.
# Same intent as is_clothing() in export.py, applied before we spend a crawl.
BANNED_WORDS = {
    "socks", "sock", "hosiery", "tights", "underwear", "undies", "boxers",
    "briefs", "lingerie", "intimates", "bras", "sleepwear", "pyjamas",
    "pajamas", "accessories", "accessory", "jewelry", "jewellery", "rings",
    "necklaces", "bracelets", "earrings", "bags", "bag", "totes", "backpacks",
    "wallets", "belts", "hats", "caps", "eyewear", "sunglasses", "fragrance",
    "perfume", "scents", "candles", "home", "homeware", "furniture", "books",
    "gift", "gifts", "gift-cards", "giftcard", "skate", "skateboards", "decks",
    "vinyl", "stickers", "kids", "baby", "toddler", "infant", "pets", "dog",
    "swim", "swimwear", "care", "grooming", "beauty", "archive-sale",
}


def tokens(handle):
    return [t for t in re.split(r"[-_/]+", (handle or "").lower()) if t]


def gender_of(handle):
    """'mens-shirts' -> 'm'. Token-wise, so 'amen' and 'moment' don't count."""
    ts = set(tokens(handle))
    m, f = ts & MEN_TOKENS, ts & WOMEN_TOKENS
    if m and not f:
        return "m"
    if f and not m:
        return "f"
    return None


def is_garment_collection(handle, title=""):
    ts = set(tokens(handle)) | set(tokens(title))
    if ts & BANNED_WORDS:
        return False
    return bool(ts & GARMENT_WORDS)


def rank_collection(handle, count):
    """Prefer specific garment collections with stock in them."""
    ts = set(tokens(handle))
    score = min(count or 0, 400) / 400.0          # more stock is better
    if ts & {"shirts", "tees", "tops", "knitwear", "outerwear", "dresses",
             "trousers", "pants", "denim", "jeans", "shorts", "sweats"}:
        score += 2.0                              # a real garment category
    elif ts & {"clothing", "apparel", "ready-to-wear", "rtw"}:
        score += 1.5
    elif "all" in ts or "new" in ts:
        score += 0.5                              # broad, but always populated
    return -score


# =============================================================================
#  Single-gender shops
# =============================================================================
# Plenty of the best labels are one gender all the way through, so nothing in
# their collection handles ever says "mens" — Todd Snyder and WTAPS are men's
# shops with collections called "shirts" and "trousers"; Khaite and Toteme are
# women's shops with collections called "coats". Skipping them would cost the
# deck a lot of good clothes.
#
# The entry-point gender is the strongest signal gender.py gets, so getting this
# wrong is worse than not registering the shop at all. Two narrow rules, both
# resting on the shop's own data, and anything ambiguous is left out:
#
#   women's — the classifier reads a chunk of a 100-product sample as womenswear
#             AND the shop actually sells dresses. The second half is what makes
#             this safe: on its own the vote count does not separate a women's
#             label from a sneaker shop that carries some women's sizes
#             (Khaite 16% female / Feature 15% female — indistinguishable), but
#             dress share does, cleanly: Khaite 16% and Toteme 7% sell dresses,
#             while Corteiz, Feature and Todd Snyder sell 0%.
#   men's   — the shop has no women's collection anywhere in its collection
#             list AND essentially no womenswear in the sample
#
# A shop that sells both without labelling either (Stüssy, whose only gendered
# collections are swimwear) is deliberately skipped.
SAMPLE_SIZE = 100
MIN_SAMPLE = 12
F_VOTES_MIN = 8            # womenswear reads in the sample
F_DRESS_SHARE_MIN = 0.06   # ...and it has to actually sell dresses


def infer_shop_gender(products, base, brand, has_women_collection):
    """-> ('m'|'f'|None, why, confident).

    Two narrow rules produce a *confident* call. Everything else still gets a
    call, but flagged as a guess — because skipping the shop entirely costs the
    deck brands people have actually heard of, and a guess here is cheap to be
    wrong about: it is registered as `gender_source: "prior"`, which browse.py
    passes to the classifier as a brand prior worth 0.8 rather than as a
    section worth 5.0. Any real evidence on the piece itself — an audience word
    in the name (3.5), the product URL (4.0), a breadcrumb (4.5) — outvotes it,
    and `browse.py --reclassify` can revisit the lot after the fact.
    """
    if len(products) < MIN_SAMPLE:
        return None, "only {} products to judge from".format(len(products)), False
    votes, cats = Counter(), Counter()
    for p in products:
        title = p.get("title", "")
        votes[gender_model.classify(
            name=title, brand=brand,
            url="{}/products/{}".format(base.rstrip("/"), p.get("handle", "")))["g"]] += 1
        cats[enrich.classify_cat(title)] += 1
    m, f = votes["m"], votes["f"]
    dress_share = cats["dress"] / float(len(products))

    if f >= F_VOTES_MIN and dress_share >= F_DRESS_SHARE_MIN:
        return "f", "{}/{} read as womenswear, {:.0%} dresses".format(
            f, len(products), dress_share), True
    if not has_women_collection and f <= 2:
        return "m", ("no women's collection on the whole site and {}/{} "
                     "womenswear in a sample".format(f, len(products))), True

    # No confident call — guess, but not by comparing f votes to m votes. The
    # classifier is deliberately asymmetric: it fires on womenswear (dresses,
    # "WMNS", bodycon) and almost never on menswear, because a shirt is not a
    # gendered garment. So f > m is true of a menswear shop that carries four
    # women's pieces, and comparing the two called Stüssy, Corteiz, Aimé Leon
    # Dore and Feature womenswear — all four wrong.
    #
    # Share of the sample separates them cleanly. A women's label sells dresses
    # (Khaite 16%, Toteme 7%); a men's or sneaker shop sells none (Corteiz,
    # Feature, Todd Snyder, Shoe Palace all 0%), and its handful of women's
    # pieces stays a small slice of the whole.
    f_share = f / float(len(products))
    if dress_share >= 0.05 or f_share >= 0.25:
        guess, because = "f", "{:.0%} dresses, {:.0%} read womenswear".format(
            dress_share, f_share)
    else:
        guess, because = "m", "only {:.0%} dresses and {:.0%} read womenswear".format(
            dress_share, f_share)
    return guess, ("guessed {} ({}); registered as a prior, so any evidence on a "
                   "piece overrides it".format(
                       "womenswear" if guess == "f" else "menswear", because)), False


def fallback_collections(collections, want):
    """Biggest non-banned collections, for a shop whose collections are named
    after drops and labels rather than garments (most sneaker boutiques)."""
    scored = []
    for col in collections:
        handle, title = col.get("handle", ""), col.get("title", "")
        if set(tokens(handle)) & BANNED_WORDS or set(tokens(title)) & BANNED_WORDS:
            continue
        count = col.get("products_count") or 0
        if count < 5:
            continue
        scored.append((-count, handle))
    return [h for _, h in sorted(scored)[:want]]


def top_garment_collections(collections, want):
    """Best ungendered garment collections, for a shop that is all one gender."""
    scored = []
    for col in collections:
        handle, title = col.get("handle", ""), col.get("title", "")
        if gender_of(handle) or gender_of(title):
            continue                       # gendered ones were handled already
        if not is_garment_collection(handle, title):
            continue
        scored.append((rank_collection(handle, col.get("products_count")), handle))
    return [h for _, h in sorted(scored)[:want]]


async def read_json(page, url, timeout=PAGE_TIMEOUT):
    resp = await page.goto(url, wait_until="commit", timeout=timeout)
    if not resp:
        return 0, None
    try:
        body = await resp.text()
    except Exception:
        body = await page.evaluate("() => document.body ? document.body.innerText : ''")
    try:
        return resp.status, json.loads(body)
    except ValueError:
        return resp.status, None


async def robots_allows(page, base, paths):
    """Honour robots.txt for User-agent: * before reading anything."""
    try:
        resp = await page.goto(base.rstrip("/") + "/robots.txt",
                               wait_until="commit", timeout=20000)
        if not resp or resp.status != 200:
            return True, None
        text = await resp.text()
    except Exception:
        return True, None
    rules, applies = [], False
    for line in text.splitlines():
        line = line.split("#")[0].strip()
        if not line:
            continue
        key, _, val = line.partition(":")
        key, val = key.strip().lower(), val.strip()
        if key == "user-agent":
            applies = (val == "*")
        elif key == "disallow" and applies and val:
            rules.append(val)
    for path in paths:
        for rule in rules:
            if re.match(re.escape(rule).replace(r"\*", ".*"), path):
                return False, rule
    return True, None


async def probe(ctx, brand, base, note, sem, results):
    """Work out whether we can crawl this shop, and where to enter it."""
    async with sem:
        page = await ctx.new_page()
        row = {"brand": brand, "base": base, "note": note, "ok": False,
               "m": [], "f": [], "why": "", "products": 0, "inferred": "", "guessed": False}
        try:
            ok, rule = await robots_allows(page, base,
                                           ["/collections.json", "/products.json"])
            if not ok:
                row["why"] = "robots.txt disallows {}".format(rule)
                return

            status, data = await read_json(
                page, base.rstrip("/") + "/collections.json?limit=250")
            if status in (401, 403):
                row["why"] = "shop declined automated reads (HTTP {})".format(status)
                return
            if not data or not data.get("collections"):
                row["why"] = ("no public collection list (HTTP {})".format(status)
                              if status != 200 else "no public collection list")
                return

            await asyncio.sleep(POLITE_DELAY)
            collections = data["collections"]
            buckets = {"m": [], "f": []}
            for col in collections:
                handle, title = col.get("handle", ""), col.get("title", "")
                g = gender_of(handle) or gender_of(title)
                if not g or not is_garment_collection(handle, title):
                    continue
                buckets[g].append((rank_collection(handle, col.get("products_count")),
                                   handle))
            for g in ("m", "f"):
                picked = sorted(buckets[g])[:MAX_ENTRIES_PER_GENDER]
                row[g] = ["{}/collections/{}".format(base.rstrip("/"), h)
                          for _, h in picked]

            status, data = await read_json(
                page, base.rstrip("/") + "/products.json?limit={}".format(SAMPLE_SIZE))
            sample = (data or {}).get("products", [])
            row["products"] = len(sample)

            # One side only. Kith is the case that showed this up: its women's
            # collections are named "…-women" and matched, while its men's ones
            # are named after collaborators ("adidas-mens" reads as a brand, not
            # a garment), so the crawl entered the women's door and came back
            # with 22 women's pieces and nothing else. If the shop's collection
            # list clearly names BOTH genders somewhere, fill the empty side
            # from its biggest general collections and mark the whole entry a
            # guess, so the crawl at least reaches that half of the shop.
            for have, missing in (("m", "f"), ("f", "m")):
                if row[have] and not row[missing]:
                    tok = WOMEN_TOKENS if missing == "f" else MEN_TOKENS
                    sells_both = any(
                        set(tokens(c.get("handle", ""))) & tok
                        or set(tokens(c.get("title", ""))) & tok
                        for c in collections)
                    if not sells_both:
                        break
                    handles = [h for h in fallback_collections(collections, 6)
                               if h not in [u.rsplit("/", 1)[-1] for u in row[have]]]
                    if handles:
                        row[missing] = ["{}/collections/{}".format(base.rstrip("/"), h)
                                        for h in handles[:MAX_ENTRIES_PER_GENDER]]
                        row["guessed"] = True
                        row["inferred"] = (
                            "found only {} collections by name; the shop also lists "
                            "{} ones, so its general collections are registered for "
                            "that side as a guess".format(
                                "men's" if have == "m" else "women's",
                                "women's" if missing == "f" else "men's"))
                    break

            # Nothing gendered in the collection names: this is either a
            # single-gender shop worth registering, or genuinely ambiguous.
            if not row["m"] and not row["f"]:
                has_women_col = any(gender_of(c.get("handle", "")) == "f"
                                    or gender_of(c.get("title", "")) == "f"
                                    for c in collections)
                g, why, confident = infer_shop_gender(sample, base, brand, has_women_col)
                if not g:
                    row["why"] = "no gendered collections; " + why
                    return
                handles = top_garment_collections(collections, MAX_ENTRIES_PER_GENDER)
                if not handles:
                    # No collection matched the garment vocabulary — common at
                    # sneaker shops, whose collections are named after drops and
                    # labels rather than garments. Fall back to the biggest
                    # collections that are not on the banned list, so the shop
                    # is crawlable at all.
                    handles = fallback_collections(collections,
                                                   MAX_ENTRIES_PER_GENDER)
                    if handles:
                        why += "; entered via its largest collections"
                if not handles:
                    row["why"] = "nothing crawlable — every collection is banned or empty"
                    return
                row[g] = ["{}/collections/{}".format(base.rstrip("/"), h)
                          for h in handles]
                row["inferred"] = why
                row["guessed"] = not confident

            if row["products"] == 0:
                row["why"] = "collections look right but no products came back"
                return

            row["ok"] = True
        except Exception as exc:
            first = str(exc).strip().splitlines()[0] if str(exc).strip() else ""
            row["why"] = "{}: {}".format(type(exc).__name__, first[:70])
        finally:
            await page.close()
            results.append(row)


# =============================================================================
#  Wiring the findings into the repo
# =============================================================================
def known_brands(registry):
    """Brand names and hosts already registered, lower-cased."""
    names = {b.lower() for b in registry}
    hosts = {(s.get("host") or "").lower() for s in registry.values()}
    try:
        stores = store_registry.load_registry()
        names |= {b.lower() for b in stores}
        hosts |= {(s.get("domain") or "").lower() for s in stores.values()}
    except Exception:
        pass
    return names, hosts


def add_to_sites(registry, rows):
    added = 0
    for r in rows:
        if not r["ok"]:
            continue
        host = urlparse(r["base"]).netloc
        site = site_registry.S(r["brand"], host, m=r["m"], f=r["f"],
                               note="found by find_brands.py — {}".format(r["note"]))
        # Auditable, and load-bearing: "prior" is browse.py's existing marker for
        # a section we guessed rather than read off the shop. It makes the crawl
        # pass the gender as a brand prior (0.8) instead of a section (5.0), so a
        # wrong guess is corrected by the piece's own evidence instead of
        # overriding it. Anything not marked "prior" is treated as fact.
        if r.get("guessed"):
            site["gender_source"] = "prior"
        elif r.get("inferred"):
            site["gender_source"] = "inferred"
        else:
            site["gender_source"] = "collection-handle"
        if r.get("inferred"):
            site["gender_note"] = r["inferred"]
        registry[r["brand"]] = site
        added += 1
    return added


def read_list_file(path):
    """Lines of 'https://shop.com' or 'Brand Name = https://shop.com'."""
    out = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.split("#")[0].strip()
            if not line:
                continue
            if "=" in line:
                brand, _, url = line.partition("=")
                brand, url = brand.strip(), url.strip()
            else:
                url = line
                host = urlparse(url if "://" in url else "https://" + url).netloc
                brand = host.replace("www.", "").split(".")[0].title()
            if "://" not in url:
                url = "https://" + url
            out.append((brand, url, "from list file"))
    return out


async def run(candidates, args):
    try:
        from playwright.async_api import async_playwright
    except ImportError:
        sys.exit("playwright missing — python3 -m pip install --user playwright "
                 "&& python3 -m playwright install chromium")

    results = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        ctx = await browser.new_context(user_agent=UA, locale="en-US",
                                        viewport={"width": 1366, "height": 900})
        # images/fonts/analytics are dead weight for reading JSON — block them,
        # same courtesy browse.py extends.
        await ctx.route(re.compile(r"\.(png|jpe?g|webp|gif|svg|woff2?|ttf|mp4)$"),
                        lambda route: asyncio.ensure_future(route.abort()))
        sem = asyncio.Semaphore(args.concurrency)
        await asyncio.gather(*[probe(ctx, b, u, n, sem, results)
                               for b, u, n in candidates])
        await browser.close()
    return results


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--write", action="store_true",
                    help="save the good ones into sites.json")
    ap.add_argument("--from", dest="from_file", metavar="FILE",
                    help="probe a file of shops instead of the built-in pool")
    ap.add_argument("--only", help='comma-separated brand names from the pool')
    ap.add_argument("--all", action="store_true",
                    help="include brands already registered (default: skip them)")
    ap.add_argument("--limit", type=int, default=0, help="probe at most N")
    ap.add_argument("--concurrency", type=int, default=6)
    args = ap.parse_args()

    registry = site_registry.load()
    names, hosts = known_brands(registry)

    pool = read_list_file(args.from_file) if args.from_file else list(CANDIDATES)
    if args.only:
        want = {w.strip().lower() for w in args.only.split(",")}
        pool = [c for c in pool if c[0].lower() in want]
    if not args.all:
        pool = [c for c in pool
                if c[0].lower() not in names
                and urlparse(c[1]).netloc.lower() not in hosts]
    if args.limit:
        pool = pool[:args.limit]

    if not pool:
        print("nothing new to probe — every candidate is already registered "
              "(use --all to re-probe)")
        return

    print("probing {} candidate shops with a headless browser...\n".format(len(pool)))
    results = asyncio.run(run(pool, args))
    results.sort(key=lambda r: (not r["ok"], r["brand"].lower()))

    good = [r for r in results if r["ok"]]
    for r in results:
        if r["ok"]:
            extra = ("  [section inferred: {}]".format(r["inferred"])
                     if r.get("inferred") else "")
            print("  OK   {:22s} {} men's + {} women's entries{}".format(
                r["brand"], len(r["m"]), len(r["f"]), extra))
        else:
            print("  --   {:22s} {}".format(r["brand"], r["why"]))

    print("\n{} of {} usable.".format(len(good), len(results)))
    if not args.write:
        print("Nothing written. Re-run with --write to add them to sites.json.")
        return
    if not good:
        print("Nothing to write.")
        return

    added = add_to_sites(registry, good)
    path = site_registry.save(registry)
    print("added {} shops -> {}".format(added, path))
    print("registry now holds {} shops".format(len(registry)))
    print("\nnext:  python3 browse.py --crawl --shops 20"
          "\n       python3 export.py --promote 200"
          "\n       node ../../build.mjs && npm test")


if __name__ == "__main__":
    main()
