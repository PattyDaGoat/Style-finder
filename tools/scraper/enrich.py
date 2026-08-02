"""Normalise a raw Shopify product into the Style DNA Finder catalog schema.

The frontend's recommendation engine depends on `cat`, `ms`, `color`, `pat`,
`fab` and `g`. Store feeds don't provide any of them, so we derive them here
with keyword rules that mirror the taxonomy already used by style-finder.html.

Both the one-shot backfill (harvest.py) and the always-on bot (bot.py) import
this module, so a product enriched today is tagged the same way as one enriched
six months from now.
"""

import hashlib
import re
from urllib.parse import urlparse

# ---------------------------------------------------------------- taxonomy --

CATEGORIES = ("tee", "knit", "sweat", "shirt", "outer", "trouser", "short",
              "dress", "cap", "shoe", "acc")

# Not clothing — homeware, gift cards, skate hardware, phone junk. These slip
# into store feeds constantly and have no business in a style deck.
NOT_APPAREL = re.compile(
    r"\b(gift ?card|e-?gift|voucher|pillow|cushion|blanket|throw rug|mug|tumbler|"
    r"candle|coaster|poster|art print|puzzle|book|planner|sticker|charger|"
    r"phone case|airpod|water bottle|incense|soap|shampoo|fragrance|perfume|"
    r"deodorant|grip ?tape|bearings|skate deck|skateboard deck|wheels|"
    r"griptape|hardware|wax\b|tool ?kit|repair kit|detergent|candle|vinyl|"
    r"magazine|zine\b|patch set|pin set|keyring|key ?chain|laptop case|"
    r"trinket|figurine|stone figure|tray\b|vase|frame\b|lamp\b|rug\b)\b", re.I)

# order matters: the first pattern that hits wins, so put the specific ones
# ("sweatshirt" before "shirt", "crew socks" before "crew") higher up. Every
# noun takes an optional plural — store feeds are full of "Pants" and "Slides".
CAT_RULES = [
    ("shoe",    r"\b(shoes?|sneakers?|trainers?|boots?|loafers?|mules?|sandals?|slides?|clogs?|heels?|derbys?|chelseas?|flip ?flops?|ballet flats?)\b"),
    # "trucker jacket" is outerwear, not a hat
    ("cap",     r"\b(caps?|hats?|beanies?|bucket hats?|visors?|truckers?(?!\s*jacket)|snapbacks?|balaclavas?|headbands?|berets?)\b"),
    # small goods before the garment rules so "crew socks" doesn't read as a crew
    ("acc",     r"\b(socks?|bags?|totes?|backpacks?|daypacks?|slings?|pouches?|belts?|scarves(?!\s*top)|scarf(?!\s*top)|gloves?|mittens?|wallets?|necklaces?|earrings?|bracelets?|anklets?|jewellery|jewelry|sunglasses|hair clips?|scrunchies?|towels?|aprons?|bandanas?|neckties?)\b"),
    ("sweat",   r"\b(hoodies?|hooded|hoods?|sweatshirts?|sweat ?pants?|sweatpants?|crewnecks?|track ?suits?|track ?pants?|trackpants?|joggers?)\b"),
    # "dress" as an adjective is never the garment: a dress shirt is a shirt, a
    # dress pant is a trouser, dress socks are socks. Only the noun counts.
    # ("skort" is handled by the shorts rule below.)
    # ...and it is not the garment as a COLOUR either. "Dress Blue" is a shade
    # (military dress blues), so "Smoke Em Mens Short Sleeve Tee in Dress Blue"
    # is a TEE — but `dress` is tested before `tee`, so without this it wins and
    # a men's tee ships as a dress. That row reached the catalog and broke the
    # "MENSWEAR contains no dresses" assertion in suites 03 and 05.
    ("dress",   r"\b(dress(?!\s*(shirt|pant|trouser|sock|boot|shoe|short|code|form"
                r"|blue|navy|white|black|green|gray|grey|red|khaki|olive|cream|tan))(es)?"
                r"|gowns?|skirts?|jumpsuits?|playsuits?|rompers?|midis?|maxis?|sundress(es)?|minidress(es)?|sarongs?|cover[-\s]?ups?|kaftans?|caftans?)\b"),
    # "short sleeve" is a tee, not a pair of shorts — hence the lookahead
    ("short",   r"\b(shorts?(?!\s*-?\s*sleeve)|trunks?|boardshorts?|bike shorts?|skorts?|briefs?|boxers?|panty|panties|thongs?|bikini bottoms?|swim bottoms?|volleys?)\b"),
    ("trouser", r"\b(trousers?|pants?|chinos?|jeans?|denim pants?|cargos?|cargo pants?|leggings?|culottes?|slacks?|overalls?|dungarees?|denims?(?!\s*(jacket|shirt|vest|jkt)))\b"),
    ("knit",    r"\b(1/4 ?zips?|quarter ?zips?|half ?zips?|sweaters?|knits?|knitted|knitwear|cardigans?|jumpers?|pullovers?|merino|cashmere|mohair|crochet)\b"),
    ("outer",   r"\b(jackets?|coats?|parkas?|blazers?|anoraks?|shells?|vests?|gilets?|bombers?|puffers?|windbreakers?|ponchos?|trench(es)?|shackets?)\b"),
    ("shirt",   r"\b(shirts?|oxfords?|flannels?|overshirts?|blouses?|camp collars?|button.?(up|down)s?|poplin|plaids?)\b"),
    ("tee",     r"\b(t-?shirts?|tees?|tanks?|singlets?|jerseys?|polos?|henleys?|long ?sleeves?|short ?sleeves?|bodysuits?|crop tops?|crews?|tops?|bras?|bralettes?|bikinis?|bikini tops?|swim tops?|camis?|camisoles?|corsets?|one ?pieces?|swimsuits?|leotards?)\b"),
    ("acc",     r"\b(wristbands?|cufflinks?|suspenders?|umbrellas?)\b"),
]

COLOR_RULES = [
    ("dark",    r"\b(black|jet|onyx|charcoal|graphite|coal|ink|midnight|noir|obsidian)\b"),
    ("blue",    r"\b(blue|navy|indigo|denim|cobalt|azure|sky|chambray|marine|nautical|teal)\b"),
    ("green",   r"\b(green|olive|sage|forest|khaki|moss|emerald|fatigue|pistachio|mint|seaweed)\b"),
    ("earth",   r"\b(brown|tan|camel|rust|clay|terracotta|chocolate|coffee|caramel|sand|taupe|walnut|tobacco|amber|mocha|toffee|chestnut|umber|ochre|copper)\b"),
    ("bold",    r"\b(red|pink|orange|yellow|purple|violet|magenta|fuchsia|lime|coral|scarlet|crimson|burgundy|lilac|lavender|cherry|neon|rainbow|multi)\b"),
    ("neutral", r"\b(white|cream|ecru|oat|bone|ivory|natural|stone|grey|gray|heather|beige|off ?white|chalk|vanilla|pearl|silver)\b"),
]

PAT_RULES = [
    ("plaid",    r"\b(plaid|check|checked|tartan|gingham|madras|windowpane|houndstooth)\b"),
    ("stripe",   r"\b(stripe|striped|breton|pinstripe|railroad|ticking)\b"),
    ("textured", r"\b(cord|corduroy|waffle|herringbone|cable|boucle|bouclé|ribbed|slub|terry|jacquard|quilted|tweed|fleece|marl|pointelle|crochet|seersucker|pique|piqué)\b"),
    ("graphic",  r"\b(graphic|print|printed|logo|floral|paisley|camo|camouflage|tie ?dye|patch|embroider|animal|leopard|polka|artwork|souvenir)\b"),
]

# micro-style -> keyword pattern. A product can pick up to 3.
MS_RULES = [
    ("raw-denim",           r"\b(selvedge|selvage|raw denim|indigo|rigid denim|japanese denim|13oz|14oz)\b"),
    ("flannel-cabincore",   r"\b(flannel|plaid|tartan|cabin|buffalo|sherpa|shearling|lumberjack)\b"),
    ("gorpcore-utility",    r"\b(gorp|technical|shell|gore-?tex|packable|ripstop|hike|hiking|trail|utility|waterproof|primaloft|puffer|windbreaker|cargo|tactical)\b"),
    ("linen-resort",        r"\b(linen|camp collar|resort|vacation|holiday|cabana|beach shirt|kaftan|caftan|sarong)\b"),
    ("ivy-prep",            r"\b(oxford|rugby|chino|loafer|prep|varsity|blazer|club|crest|argyle|penny|polo)\b"),
    ("military-surplus",    r"\b(fatigue|field|military|army|combat|m-?65|surplus|deck|service|officer)\b"),
    ("texture-craft",       r"\b(cord|corduroy|waffle|herringbone|cable|boucle|bouclé|slub|tweed|hand ?knit|crochet|pointelle|quilted)\b"),
    ("scandi-minimal",      r"\b(minimal|clean|tonal|essential|simple|pure|quiet|architect)\b"),
    ("monochrome-minimal",  r"\b(black|charcoal|graphite|monochrome|all ?black|noir|onyx)\b"),
    ("skate-street",        r"\b(skate|boxy|baggy|street|deck|grip|sk8|dickies|carpenter)\b"),
    ("band-graphic",        r"\b(graphic|band|tour|album|artwork|souvenir|logo tee|print tee|screen ?print)\b"),
    ("surf-sport",          r"\b(surf|board ?short|swim|trunk|wave|beach|rash|sport|active|running|training|gym|yoga|pilates)\b"),
    ("collegiate-athletic", r"\b(varsity|collegiate|campus|athletic|track|jog|sweat|crewneck|team|arch logo|gym)\b"),
    ("coastal-prep",        r"\b(nautical|breton|stripe|sail|boat|marine|coastal|seaside|anchor|regatta)\b"),
    ("knitwear-forward",    r"\b(sweater|cardigan|knit|jumper|merino|cashmere|mohair|alpaca|lambswool)\b"),
    ("rugged-workwear",     r"\b(work|chore|duck canvas|carpenter|utility pant|painter|coverall|overall|denim jacket|trucker)\b"),
    ("british-mod",         r"\b(mod|harrington|polo shirt|tipped|terrace|paisley|mohair suit|monkey jacket)\b"),
    ("earthy-heritage",     r"\b(brown|olive|rust|clay|earth|natural dye|botanical|hemp|undyed|heritage)\b"),
    ("eclectic-pattern",    r"\b(floral|paisley|abstract|patchwork|contrast|colou?r ?block|psychedelic|mixed print|leopard)\b"),
    ("elevated-basics",     r"\b(essential|premium|basic|classic|everyday|staple|heavyweight|garment ?dye|pima|supima)\b"),
]

FABRICS = ["cotton", "linen", "wool", "cashmere", "merino", "corduroy", "cord",
           "selvedge", "waffle", "denim", "silk", "leather", "suede", "nylon",
           "fleece", "terry", "hemp", "canvas", "twill", "poplin", "jersey",
           "flannel", "oxford", "mesh", "modal", "tencel", "ripstop", "pique",
           "seersucker", "alpaca", "mohair", "velvet", "satin", "cropped_dummy"]
FABRICS.remove("cropped_dummy")

# Category defaults so nothing lands with an empty micro-style list.
CAT_MS_FALLBACK = {
    "tee": "elevated-basics", "knit": "knitwear-forward", "sweat": "collegiate-athletic",
    "shirt": "elevated-basics", "outer": "rugged-workwear", "trouser": "elevated-basics",
    "short": "surf-sport", "dress": "linen-resort", "cap": "skate-street",
    "shoe": "elevated-basics", "acc": "elevated-basics",
}

WOMEN_WORDS = re.compile(
    r"\b(women|woman|womens|ladies|girl|dress|skirt|gown|blouse|bralette|bra\b|"
    r"legging|jumpsuit|playsuit|romper|midi|maxi|bikini|one ?piece|camisole|cami\b|"
    r"bodysuit|corset|halter|tunic|kaftan|caftan|peplum|wrap dress|sundress|heel|"
    r"pump\b|ballet flat|crop top|tube top|mini skirt|nursing|maternity)\b", re.I)
MEN_WORDS = re.compile(
    r"\b(men|mens|man's|boy|boys|boxer|brief\b|trunk|tux|necktie|tie\b|"
    r"beard|moustache|suiting|sport ?coat|dress shirt|chino|oxford shirt)\b", re.I)

# Mass-market labels — kept in sync with FAST_FASHION in style-finder.html so the
# "Hide fast fashion" toggle keeps working on bot-sourced items.
FAST_FASHION = {
    "white fox", "oh polly", "princess polly", "motel rocks", "meshki", "peppermayo",
    "beginning boutique", "tiger mist", "selfie leslie", "edikted", "storets",
    "in the style", "sabo", "petal & pup", "verge girl", "runway scout",
    "rebellious fashion", "public desire", "daisy street", "minga london",
    "runaway the label", "pink lily", "red dress", "buddy love", "sik silk",
    "mnml", "gym king", "sinners attire", "aybl", "kulani kinis", "iam gia",
    "jaded london", "shein", "temu", "h&m", "zara", "boohoo", "asos", "prettylittlething",
}

MAX_PRICE = 200.0
_TAG_SPLIT = re.compile(r"[\s/_-]+")


def _first_match(rules, text):
    for label, pattern in rules:
        if re.search(pattern, text, re.I):
            return label
    return None


def product_id(brand, name, url):
    """Stable hash so re-harvesting the same item updates instead of duplicating."""
    raw = "{}|{}|{}".format((brand or "").strip().lower(),
                            (name or "").strip().lower(),
                            (url or "").strip().lower())
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def classify_cat(text):
    return _first_match(CAT_RULES, text) or "acc"


def classify_color(text):
    return _first_match(COLOR_RULES, text) or "neutral"


def classify_pat(text):
    return _first_match(PAT_RULES, text) or "solid"


def classify_ms(text, cat):
    hits = [label for label, pattern in MS_RULES if re.search(pattern, text, re.I)]
    if not hits:
        hits = [CAT_MS_FALLBACK.get(cat, "elevated-basics")]
    return hits[:3]


def classify_fab(text):
    low = text.lower()
    out = []
    for f in FABRICS:
        if re.search(r"\b" + re.escape(f) + r"\b", low):
            out.append("cord" if f == "corduroy" else f)
    # de-dupe, keep order, cap at 3 so one product can't dominate the fabric model
    seen, keep = set(), []
    for f in out:
        if f not in seen:
            seen.add(f)
            keep.append(f)
    return keep[:3]


def classify_gender(text, brand_prior=None):
    """'m', 'f' or 'u'. Explicit words win; otherwise fall back to the brand's
    existing skew in the catalog, then to unisex."""
    w = bool(WOMEN_WORDS.search(text))
    m = bool(MEN_WORDS.search(text))
    if w and not m:
        return "f"
    if m and not w:
        return "m"
    if brand_prior in ("m", "f", "u"):
        return brand_prior
    return "u"


def price_of(raw):
    """Shopify prices come through as strings on variants."""
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return None
    return v if v > 0 else None


def image_of(product):
    imgs = product.get("images") or []
    for im in imgs:
        src = im.get("src") if isinstance(im, dict) else im
        if src:
            return src.split("?")[0]
    return None


def normalise(product, brand, store_domain, brand_prior=None, currency="$"):
    """Shopify products.json entry -> catalog row, or None if unusable.

    Returns a dict in the exact shape style-finder.html expects, plus a few
    bookkeeping fields the database keeps (id, src, handle).
    """
    title = (product.get("title") or "").strip()
    handle = product.get("handle") or ""
    if not title or not handle:
        return None

    variants = product.get("variants") or []
    price = None
    for v in variants:
        price = price_of(v.get("price"))
        if price is not None:
            break
    if price is None or price > MAX_PRICE:
        return None

    img = image_of(product)
    if not img:
        return None

    url = "https://{}/products/{}".format(store_domain, handle)

    tags = product.get("tags") or []
    if isinstance(tags, str):
        tags = [tags]
    ptype = product.get("product_type") or ""
    # option values carry the colour words that titles often omit
    opts = []
    for o in (product.get("options") or []):
        if isinstance(o, dict):
            opts.extend(o.get("values") or [])

    haystack = " ".join([title, ptype, " ".join(tags), " ".join(map(str, opts))])
    title_type = " ".join([title, ptype])
    if NOT_APPAREL.search(title_type):
        return None

    cat = classify_cat(title_type)
    if cat == "acc":
        # give tags a second shot before giving up on the category
        cat = classify_cat(haystack)

    row = {
        "b": brand,
        "n": title,
        "p": round(price, 2),
        "cur": currency,
        "usd": round(price, 2),
        "img": img,
        "u": url,
        "cat": cat,
        "ms": classify_ms(haystack, cat),
        "color": classify_color(haystack),
        "pat": classify_pat(haystack),
        "fab": classify_fab(haystack),
        "g": classify_gender(haystack, brand_prior),
    }
    row["id"] = product_id(brand, title, url)
    row["handle"] = handle
    row["src"] = store_domain
    return row


def is_fast_fashion(brand):
    return (brand or "").strip().lower() in FAST_FASHION


def domain_of(url):
    try:
        return urlparse(url).netloc
    except Exception:
        return ""
