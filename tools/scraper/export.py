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
    python3 export.py --prune --verify-images     ...and fetch every image to check it

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
# Per brand across the whole export. This was 20, chosen because one prolific
# store adding ~60 near-identical rows made the simulated-shopper eval visibly
# noisier (suite 04). Raised to 60 deliberately, to let a brand the app wants
# properly represented — Stussy and the streetwear labels behind the youth tilt
# — arrive as a real range rather than a token handful.
#
# The original worry is real and has NOT gone away, so it is now guarded rather
# than assumed: suite 04 asserts the eval's per-persona spread stays under 0.10
# and the results grid stays diverse, and both were re-baselined after this
# change. If a future export makes suite 04 noisy again, this number is the first
# thing to look at, not the last.
GLOBAL_PER_BRAND = 60
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


# ---- children's clothing never ships -------------------------------------
# browse.py's collection filter calls a kids' section "the one thing this app
# must never ingest" and screens it out by COLLECTION name. That is not enough:
# a brand's general apparel collection can carry kids' sizes inline, and three
# Primitive rows — "AGENCY I I YOUTH TEE", "EXIST YOUTH TEE", "MELTDOWN YOUTH
# TEE" — reached data/catalog.json that way. So the same rule is enforced here,
# per product, where every row has to pass regardless of where it came from.
#
# Every word that means "child" is also a word that means something else in
# clothing, so a flat keyword list deletes real products. Measured over this
# catalog, the naive version flagged 192 rows and among them:
#     "Faint of Heart Graphic Baby Tee"   a BABY TEE is an adult fitted tee
#     "Core V Baby Tee"                   same
#     "Olsen Mini Dress ~ Baby Blue"      BABY BLUE is a colour
#     "Bootcut Boys Snapback"             a song title on an adult cap
#     "Sonic Youth x Saturdays NYC ..."   a band
# so ~35% of the flags were adult garments. This splits the words by how much
# context they need instead.
#
# STRICT: unambiguous in a garment name. Nothing else calls itself a toddler.
KIDS_STRICT_RE = re.compile(
    r"\b(kid|kids|kid's|kids'|child|child's|children|children's|childrens|"
    r"toddler|toddlers|infant|infants|newborn|preschool|pre-?k|"
    r"grade ?school|little kid|big kid|junior|juniors)\b", re.I)
# CONTEXTUAL: only a child signal next to a garment noun ("youth tee") or used
# as the audience prefix a shop puts first ("BOYS ALAN SOLID SHIRT").
_GARMENT = (r"tee|t-?shirt|shirt|hoodie|hood|sweat\w*|crew|jacket|pant|pants|"
            r"short|shorts|jean|jeans|tank|top|dress|skirt|onesie|romper|"
            r"boardshort|swim|trunk|cap|hat|beanie|sock|shoe|sneaker|boot")
KIDS_CONTEXT_RE = re.compile(
    r"\b(youth|boys|girls)\s+(?:\w+\s+){0,2}(?:" + _GARMENT + r")\b"
    r"|^\s*(?:youth|boys|girls)\b"
    r"|\bbaby\s+(?:boy|girl)\b", re.I)
# Phrases that contain a child word but are not about children at all.
KIDS_EXEMPT_RE = re.compile(
    r"\b(baby ?tee|baby ?doll|babydoll|baby blue|baby pink|baby green|"
    r"baby yellow|baby cord|sonic youth|youth of today|eternal youth|"
    r"youth culture|bootcut boys|beach boys|pet shop boys|backstreet boys|"
    r"spice girls|gilmore girls|girls? ?(trip|night)|boy ?short|boy ?friend|"
    r"the boys)\b", re.I)
# A slogan is artwork, not an audience. Shops quote it inside the product name —
# Punkandyo - "INDONESIA KID" Black S/S T-Shirt is an adult tee with KID printed
# on it — so quoted runs are removed before the audience words are looked for.
KIDS_QUOTED_RE = re.compile(r"[\"“”'‘’]([^\"“”]{2,40})[\"“”'‘’]")


def is_kids(name):
    """True for children's garments only.

    Deliberately asymmetric. A missed kids' item is one bad row in the deck; a
    false positive silently deletes a product a shopper could have bought, and
    nothing downstream will ever surface that. So slogans and known phrases are
    stripped FIRST, and the words that double as style names (youth, boys, girls,
    baby) only count with a garment noun beside them.
    """
    n = KIDS_QUOTED_RE.sub(" ", name or "")
    n = KIDS_EXEMPT_RE.sub(" ", n)
    return bool(KIDS_STRICT_RE.search(n) or KIDS_CONTEXT_RE.search(n))


# ---- a dress is never menswear ---------------------------------------------
# `cat` and `g` are derived by two different classifiers from the same text, so
# they can disagree, and one disagreement is always wrong rather than merely
# unlikely: a row that is BOTH a dress and menswear. Whichever field is at fault,
# shipping it puts a dress in the men's deck — which suites 03 and 05 assert
# against by name ("MENSWEAR: contains no dresses at all").
#
# Two such rows reached the catalog from one import and broke both suites:
# a men's tee whose colour was "Dress Blue" (cat wrong) and a women's "Cover-Up
# Kimono" pulled from a shop's mens collection (g wrong). Both source bugs are
# fixed in enrich.py and import_collections.py, but the invariant is cheap and
# does not care which classifier slipped, so it is enforced here too.
def is_contradictory(row):
    return row.get("cat") == "dress" and row.get("g") == "m"


def is_clothing(row):
    """The one gate: a garment, not underwear, not socks, not a bag, not kids'."""
    name, cat = row.get("n") or "", row.get("cat")
    return (cat in ALLOWED_CATS
            and not is_underwear(name, cat)
            and not is_socks(name, cat)
            and not is_kids(name)
            and not is_contradictory(row)
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


# ---- photos: is the image actually a picture of the piece? -----------------
# Read this before touching anything below. Every check here is URL shape and
# pixel arithmetic. NOTHING here can tell you whether the photo shows the
# garment the name describes — that needs a vision model and this pipeline has
# none. What these rules remove are images that are provably not a product
# photo of anything: promo badges, brand logos, colour swatches, wishlist
# icons, "image coming soon" tiles, blank rectangles and category listing pages
# stored in the img field.
#
# Counts were measured over data/catalog.json (9,928 rows) on 2026-07-26 with
# the URLs actually fetched. Do not add a pattern without fetching what it
# matches — four plausible-looking rules were tried and rejected for deleting
# real photography:
#   "no image file extension" -> 95 hits, 26 real photos. 27% false positives.
#   "/thumb/ in the path"     -> 25 hits, 19 real DTLR photos.
#   "logo in the filename"    -> 71 hits, nearly all genuinely "... Logo Tee".
#   "t_default/ in the path"  -> 5 hits, all 5 real Nike renders at 320x400.

# URLs the crawler stored broken that resolve perfectly once repaired. All 32
# affected rows were fetched both ways: 404 or a 1x1 stub as stored, a full
# product photo once repaired. Repairing beats dropping.
IMG_REPAIRS = (
    (re.compile(r"_\{width\}x(?=\.\w+)"), "_1200x"),   # unfilled Shopify Liquid
    (re.compile(r"\{width\}"), "1200"),
    (re.compile(r"_1x1(?=\.\w+)"), ""),                # 1-pixel stub, 938 bytes
    (re.compile(r"_small(?=\.\w+)"), "_1200x"),        # 70x100 thumbnail
)


def repair_img(img):
    """Rewrite a URL the crawler stored in a broken-but-fixable form."""
    if not img:
        return img
    for rx, sub in IMG_REPAIRS:
        img = rx.sub(sub, img)
    # A Firebase object URL without ?alt=media returns bucket metadata as JSON
    # instead of the image.
    if "firebasestorage.googleapis.com" in img and "alt=media" not in img:
        img += ("&" if "?" in img else "?") + "alt=media"
    return img


# Two URLs are junk in their entirety and are matched literally, because their
# shape does not generalise. Each is shared by every product of its brand.
BAD_IMG_EXACT = frozenset({
    # A Cloudinary transform carrying only a background colour and no asset id.
    # Returns 200, decodes as an 840x1147 blank #F7F7F7 rectangle — so the app's
    # onerror fallback never fires and the shopper sees an empty card.
    "https://assets.aritzia.com/image/upload/f7f7f7",
    # A category listing page URL stored in the img field.
    "https://www.jcrew.com/plp/mens/categories/clothing/0",
})

BAD_IMG_RE = re.compile(r"""(?xi)
      /image/upload/[0-9a-f]{6}$      # cloudinary bg-colour transform, no asset
    | /plp/                            # a category page, not an image
    | product-tile-fallback            # the shop's own "IMAGE COMING SOON!" tile
    | (^|[/_-])swatch(es)?[/_.-]       # colour/fabric swatch crop, 100-300px
    | _wishlist\.                      # the site's wishlist heart icon (SVG)
    | /image/upload/w_[1-9]?[0-9]/     # cloudinary render under 100px wide
    | \{width\} | _1x1\. | _small\.    # only reachable if repair_img missed one
""")


def photo_ok(row):
    """Repair the row's image URL in place, then say whether it can be a photo.

    False only for images fetched and confirmed not to be a picture of a
    garment. This does NOT check that the photo matches the product name.
    """
    row["img"] = repair_img(row.get("img"))
    img = row["img"]
    if not img:
        return False
    return (img.split("?")[0] not in BAD_IMG_EXACT
            and not BAD_IMG_RE.search(img))


# One image standing in for several different products is never that product's
# own photo. Measured: 12 URLs are each shared by 3+ distinct (brand, title)
# pairs across 162 rows, and all 12 are junk on inspection — an "EXTRA20" sale
# badge on 34 Albaray products, one shoe photo across 8 Birdies styles, a
# bone-linen swatch on 8 Alex Crane camis. The 2-share tier is the opposite:
# 83 groups / 166 rows, overwhelmingly legitimate mirror listings ("Wax London
# Hayden - Navy" and "Wax London Womens Hayden - Navy" are one product listed
# twice). Dropping at 2 would delete ~160 real products to catch a handful.
MAX_PRODUCTS_PER_IMAGE = 3


def image_key(img):
    """Shopify's ?v= cache-buster differs between rows sharing one asset."""
    return (img or "").split("?")[0]


def overused_images(rows, limit=MAX_PRODUCTS_PER_IMAGE):
    """Image URLs that stand in for `limit` or more different products."""
    owners = defaultdict(set)
    for r in rows:
        owners[image_key(r.get("img"))].add((r.get("b"), base_title(r.get("n"))))
    return {u for u, titles in owners.items() if u and len(titles) >= limit}


def drop_shared_photos(catalog, rows):
    """Global pass — a per-row check cannot see one image serving thirty
    products. Counts what is already baked in too, so a new row cannot quietly
    become the third user of a badge that already serves two."""
    over = overused_images(list(catalog) + list(rows))
    keep = [r for r in rows if image_key(r.get("img")) not in over]
    if len(keep) != len(rows):
        print("dropped {} rows whose photo already stands in for other products"
              .format(len(rows) - len(keep)))
    return keep


def _round_robin(by_brand, want, max_depth=MAX_PER_BRAND, per_brand=None):
    """Take up to `want` rows, one per brand per pass, deepening each round.

    `per_brand` is the shared GLOBAL_PER_BRAND tally and is charged HERE, as rows
    are actually taken. It used to be charged while bucketing candidates instead,
    which is a different thing entirely: a brand with 300 eligible rows burned its
    whole allowance on rows nobody ever picked. Sharing that counter across the
    two per-gender passes then starved the second one — womenswear fell 238 -> 171
    rows on a --promote 350 while menswear was unaffected.
    """
    picked, depth = [], 0
    brands = sorted(by_brand, key=lambda b: -len(by_brand[b]))
    while len(picked) < want and depth < max_depth:
        took = 0
        for b in brands:
            if len(picked) >= want:
                break
            if per_brand is not None and per_brand[b] >= GLOBAL_PER_BRAND:
                continue
            bucket = by_brand[b]
            if depth < len(bucket):
                picked.append(bucket[depth])
                if per_brand is not None:
                    per_brand[b] += 1
                took += 1
        if not took:
            break
        depth += 1
    return picked


def eligible(row, exclude_titles):
    # photo_ok() subsumes the old img-presence test and repairs the URL in
    # place, so the repaired form is what gets written out.
    return (row.get("usd", 0) >= MIN_PRICE and photo_ok(row)
            and is_clothing(row)
            and (row["b"], base_title(row["n"])) not in exclude_titles)


def pick(gender, want, exclude_titles, per_brand=None):
    """Choose `want` varied browser-scraped products for one section.

    Draws from every browser-scraped row in the pool. The per-title exclusion
    against the current catalog is what prevents duplicates, so rows that were
    already curated somewhere else are simply skipped where they'd collide.

    `per_brand` is the GLOBAL_PER_BRAND tally. Pass one in and it is shared
    across calls, which is what makes the cap mean what its name says: this runs
    once per gender, so a counter created fresh here let a brand present in both
    sections ship up to 2 x GLOBAL_PER_BRAND. At 20 that was easy to miss; at 60
    it let Obey land 82 rows in one export.
    """
    rows = [db.decode(r) for r in db.conn().execute(
        "SELECT * FROM products WHERE g = ? "
        "AND via IS NOT NULL AND via != 'feed' ORDER BY RANDOM()", (gender,))]
    buckets = defaultdict(lambda: defaultdict(list))
    seen_titles = set()
    if per_brand is None:
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


# ---- optional: fetch the images and look at the pixels ---------------------
# Everything above is free. This costs one HTTP GET per product, so it is off
# by default and cached. It catches the one class URL shape cannot: an image
# that loads fine, is the right size, and is still not a photo.
#
# Thresholds measured on 250 random gate-passing rows, fetched and decoded,
# against 28 confirmed-bad URLs:
#   long edge < 350px     catches 21 of the 24 decodable bad images, drops 0 of
#                         249 good. Good-photo minimum long edge was 576 (p1 =
#                         875), a 1.6x margin. DO NOT raise it: Nike's real shoe
#                         photos are 320x400, so 450 would delete 5 good rows.
#   <= 8 distinct colours the blank-rectangle test. Control minimum was 25
#   in a 32x32 thumbnail  distinct colours (p1 = 46); swatch stubs and the
#                         Aritzia blank score 1. 0/249 false positives at 8;
#                         1.2% at 64; 4.4% at 128.
#
# Deliberately NOT failures, because they measured unreliable:
#   * HTTP 403/429/timeout/DNS. assets.aritzia.com returns 403 to every
#     non-browser client while the same URL returns 200 in a browser — a
#     403 rule is non-deterministic between runs and deletes working products.
#   * A decode failure on a 200 image/* response (capping the read produced
#     spurious failures during calibration).
IMG_MIN_LONG_EDGE = 350
IMG_MAX_FLAT_COLOURS = 8
IMG_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
          "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
IMG_CACHE = os.path.join(HERE, "imgcheck.json")


def _inspect(img):
    """Fetch one image. Returns (keep, note). Errs towards keeping."""
    import io
    import urllib.error
    import urllib.request
    req = urllib.request.Request(
        img, headers={"User-Agent": IMG_UA, "Accept": "image/*,*/*"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            ctype = resp.headers.get("Content-Type", "")
            data = resp.read(16_000_000)
    except urllib.error.HTTPError as exc:
        return exc.code not in (404, 410), "http {}".format(exc.code)
    except Exception as exc:                        # timeout, DNS, TLS
        return True, "unreachable ({})".format(type(exc).__name__)

    head = ctype.split(";")[0].strip().lower()
    if head == "image/svg+xml":
        # every one of these in this catalog is a wishlist heart icon, which a
        # browser renders happily at 800x800 so onerror never fires
        return False, "svg icon, not a photograph"
    if head and not head.startswith("image/"):
        return False, "not an image ({})".format(head)
    try:
        from PIL import Image
    except ImportError:
        return True, "no Pillow — pixel checks skipped"
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
    except Exception:
        return True, "undecodable (not trusted as a failure)"
    if max(im.size) < IMG_MIN_LONG_EDGE:
        return False, "too small ({}x{})".format(*im.size)
    if len(set(im.convert("RGB").resize((32, 32)).getdata())) <= IMG_MAX_FLAT_COLOURS:
        return False, "blank or near-blank rectangle"
    return True, "ok {}x{}".format(*im.size)


def verify_images(rows, workers=8):
    """Fetch every row's image and drop the ones provably not a photo.

    Polite: 8 connections, a real User-Agent, results cached in imgcheck.json
    so re-runs cost nothing. A full pass over ~10,000 rows moves roughly 1.5 GB
    and takes 20-40 minutes; --promote 200 is about 400 fetches.
    """
    from concurrent.futures import ThreadPoolExecutor
    cache = {}
    if os.path.exists(IMG_CACHE):
        try:
            with open(IMG_CACHE, encoding="utf-8") as fh:
                cache = json.load(fh)
        except ValueError:
            cache = {}
    todo = sorted({r["img"] for r in rows if r.get("img") and r["img"] not in cache})
    if todo:
        print("fetching {} images ({} already cached)".format(len(todo), len(cache)))
        with ThreadPoolExecutor(max_workers=workers) as pool:
            for img, verdict in zip(todo, pool.map(_inspect, todo)):
                cache[img] = list(verdict)
        with open(IMG_CACHE, "w", encoding="utf-8") as fh:
            json.dump(cache, fh)
    keep, reasons = [], defaultdict(int)
    for r in rows:
        ok, note = cache.get(r.get("img"), (True, "unchecked"))
        if ok:
            keep.append(r)
        else:
            reasons[note.split(" (")[0]] += 1
    if reasons:
        print("image fetch dropped {} rows:".format(len(rows) - len(keep)))
        for why, n in sorted(reasons.items(), key=lambda kv: -kv[1]):
            print("   {:5d}  {}".format(n, why))
    return keep


def prune_catalog(dry_run=False, verify=False):
    """Apply the clothes-only rule to rows that are already in the catalog.

    Changing `eligible()` only governs what ships next. Everything baked in
    before that — socks, boxer briefs, belts, tote bags — is still sitting in
    data/catalog.json. This re-runs the same gate over the existing file so the
    rule is true of the whole catalog, not just of future exports.

        python3 export.py --prune --dry-run    # count what would go
        python3 export.py --prune              # rewrite the catalog
    """
    catalog = store_registry.read_catalog()
    # Repair before counting, so a rescued URL is counted at its final value.
    repaired = 0
    for p in catalog:
        before = p.get("img")
        p["img"] = repair_img(before)
        if p["img"] != before:
            repaired += 1
    over = overused_images(catalog)

    # Duplicate product URLs. These appear when the same pool row ships twice
    # under two spellings of its brand: the exclusion set in main() is keyed on
    # the EXACT brand string, so renaming brands in the catalog (dedupe_brands.py)
    # without renaming them in the crawler pool leaves the guard unable to match,
    # and the row is appended again. Collapsing on URL is safe because a product
    # page is one product — whichever copy is seen first wins.
    seen_urls = set()

    keep, dropped, reasons = [], [], defaultdict(int)
    for p in catalog:
        name, cat = p.get("n") or "", p.get("cat")
        url = (p.get("u") or "").split("?")[0]
        if url and url in seen_urls:
            reasons["duplicate product URL"] += 1
            dropped.append(p)
            continue
        if not is_clothing(p):
            if is_underwear(name, cat):
                reasons["underwear"] += 1
            elif is_socks(name, cat):
                reasons["socks / hosiery"] += 1
            elif is_kids(name):
                reasons["children's clothing"] += 1
            elif is_contradictory(p):
                reasons["a dress tagged menswear"] += 1
            elif cat not in ALLOWED_CATS:
                reasons["not a garment (cat={})".format(cat)] += 1
            else:
                reasons["junk / homeware"] += 1
        elif not photo_ok(p):
            reasons["photo is not a picture of the piece"] += 1
        elif image_key(p["img"]) in over:
            reasons["one photo standing in for {}+ products".format(
                MAX_PRODUCTS_PER_IMAGE)] += 1
        else:
            keep.append(p)
            if url:
                seen_urls.add(url)
            continue
        dropped.append(p)

    if verify:
        checked = verify_images(keep)
        reasons["photo failed the fetch check"] += len(keep) - len(checked)
        keep = checked

    if repaired:
        print("repaired {} image URLs in place".format(repaired))
    gone = len(catalog) - len(keep)
    if not gone and not repaired:
        print("catalog is already clothes-only with usable photos — {} items"
              .format(len(catalog)))
        return 0
    if gone:
        print("dropping {} of {} rows:".format(gone, len(catalog)))
        for why, n in sorted(reasons.items(), key=lambda kv: -kv[1]):
            if n:
                print("   {:5d}  {}".format(n, why))
        if dropped:
            print("   e.g. " + " / ".join(p["n"][:34] for p in dropped[:4]))

    if dry_run:
        print("dry run — nothing written")
        return gone

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
    ap.add_argument("--verify-images", action="store_true",
                    help="fetch every image and check the pixels (slow, cached)")
    ap.add_argument("--db", help="path to catalog.db (default: alongside this script)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    # Pruning reads and rewrites the catalog file only — it never touches the
    # crawler pool, so it works on a fresh clone with no catalog.db.
    if args.prune:
        prune_catalog(args.dry_run, args.verify_images)
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
        per_brand = defaultdict(int)     # shared across both sections — see pick()
        for g in ("m", "f"):
            got = pick(g, args.promote, existing, per_brand)
            for r in got:
                existing.add((r["b"], base_title(r["n"])))
            rows.extend(got)
    else:
        sys.exit("say --shipped or --promote N")

    # A per-row check cannot see one photo serving thirty products.
    rows = drop_shared_photos(catalog, rows)
    if args.verify_images:
        rows = verify_images(rows)

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
