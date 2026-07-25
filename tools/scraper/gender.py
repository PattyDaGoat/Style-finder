"""Decide whether a scraped product is menswear or womenswear.

`enrich.classify_gender` only ever sees a Shopify title and a tag blob, so it
guesses from a handful of words. A browser sees far more, and this module spends
it: the section of the site the piece was found in, the crumb trail above it, the
`/women/` in its URL, schema.org's own audience field, and the shop's prose
description. Each of those is a piece of evidence with a weight; the verdict is
the side that wins by a clear margin, and anything closer than that stays 'u'.

Two rules make it safe to plug into the existing app:

  * Evidence is *ranked*, not summed blindly. A "for her" in a description can't
    outvote landing on the piece from the men's index, because the section is
    worth more than the prose.
  * The verdict is reconciled with `frontend_lock`, a line-for-line port of
    detectGender() in style-finder.html. That function is a hard gate in
    passesFilters(): a piece it reads as women's-only never renders in the men's
    deck no matter what `g` says. Disagreeing with it doesn't get you a second
    opinion, it gets you an invisible product — so where it has an opinion, it
    wins, and the override is recorded in the reason string.
"""

import re

# --------------------------------------------------------------- vocabulary --

# Who the shop says it's for. These are the words retailers use in nav, crumbs
# and headings, so they carry the most weight of the text signals.
F_AUDIENCE = re.compile(
    r"\b(women|womens|women's|womenswear|woman|woman's|ladies|ladies'|lady's|"
    r"girls|girls'|girl's|for her|hers|maternity|nursing|femme|female|donna|"
    r"mujer|damen|dam)\b", re.I)
M_AUDIENCE = re.compile(
    r"\b(men|mens|men's|menswear|man's|mans|boys|boys'|boy's|for him|his|"
    r"homme|male|uomo|hombre|herren|herr)\b", re.I)

# Garments only one section stocks. Weaker than an audience word: a women's shop
# sells "trunks" as swimwear, and plenty of men's shops sell a "tunic".
F_GARMENT = re.compile(
    r"\b(dress|dresses|gown|gowns|skirt|skirts|skort|skorts|blouse|blouses|"
    r"bra|bras|bralette|bralet|bikini|bikinis|swimsuit|tankini|lingerie|"
    r"corset|bustier|camisole|cami|bodysuit|bodycon|romper|playsuit|jumpsuit|"
    r"legging|leggings|jegging|jeggings|tights|pantyhose|midi|maxi|halter|"
    r"strapless|sweetheart|peplum|tube top|crop top|cropped top|kaftan|caftan|"
    r"babydoll|pinafore|jupe|sarong|pareo|nightie|nightgown|bodice|corsage)\b",
    re.I)
M_GARMENT = re.compile(
    r"\b(boxer|boxers|boxer brief|boxer briefs|jockstrap|tuxedo|necktie|"
    r"bow tie|swim trunk|swim trunks|trunks|y-front|y-fronts)\b", re.I)

# Category-bound signals: only count them inside the category they belong to.
F_SHOE = re.compile(
    r"\b(stiletto|stilettos|pump|pumps|heels|wedge|wedges|espadrille|"
    r"espadrilles|ballet flat|ballet flats|mary jane|mary janes|slingback|"
    r"slingbacks)\b", re.I)
F_BAG = re.compile(r"\b(clutch|clutches|purse|purses|handbag|handbags)\b", re.I)

# Body/fit language that shows up in prose rather than titles.
F_BODY = re.compile(
    r"\b(bust|waist ?line|hip measurement|feminine|flatters? (her|the )?"
    r"(figure|silhouette)|cup size|underbust|empire waist|princess seam)\b", re.I)
M_BODY = re.compile(
    r"\b(chest measurement|broad shoulders?|masculine|beard|facial hair|"
    r"inseam for men|men's fit|mens fit)\b", re.I)

# URL path segments. `/w/` and `/m/` are common shorthand on big retailers.
F_PATH = re.compile(
    r"(?:^|[/_-])(women|womens|womenswear|woman|ladies|girls|damen|femme|"
    r"mujer|donna|female|w)(?:[/_-]|$)", re.I)
M_PATH = re.compile(
    r"(?:^|[/_-])(men|mens|menswear|man|boys|herren|homme|hombre|uomo|male|m)"
    r"(?:[/_-]|$)", re.I)

# `/women` is a substring of nothing dangerous, but `/m/` is a substring of a
# hundred things. Only trust the one-letter form when it is a whole segment.
_SHORT_PATH = {"w", "m"}

# schema.org: Product.audience.suggestedGender, or a bare "gender" property.
LD_F = re.compile(r"\b(female|women|womens|women's|ladies|girls)\b", re.I)
LD_M = re.compile(r"\b(male|men|mens|men's|boys)\b", re.I)


# ------------------------------------------------------------------ weights --
#
# Ordered strongest to weakest. The numbers only matter relative to each other
# and to MARGIN below.

W_LD_GENDER = 6.0      # the shop states it in structured data
W_SECTION = 5.0        # we reached the piece from a gendered index page
W_BREADCRUMB = 4.5     # "Home / Women / Knitwear"
W_URL = 4.0            # /collections/womens-knitwear
W_NAME_AUD = 3.5       # "Women's Cropped Tee"
W_DESC_AUD = 3.0       # "…cut for women, this…"
W_NAME_GARMENT = 2.5   # "Wrap Dress"
W_DESC_BODY = 2.0      # "…sits at the natural waist under the bust…"
W_DESC_GARMENT = 1.2   # the word appears somewhere in a long description
W_BRAND_PRIOR = 0.8    # this brand has only ever been one thing

# How far ahead the winner must be before we commit. Below this the piece is
# genuinely unisex or genuinely ambiguous, and 'u' shows it in both decks.
MARGIN = 2.0


def _scrub(text):
    """Remove the phrases that only look like gender markers.

    Mirrors gdScrub() in style-finder.html, with a few extras a full product
    description throws up that a title never does.
    """
    t = text or ""
    t = re.sub(r"\bdress\s+(shirt|pant|trouser|sock|boot|shoe|short|code)", " ", t, flags=re.I)
    t = re.sub(r"\bheel\s+(tab|counter|cup|loop|pull|patch|drop)\b", " ", t, flags=re.I)
    t = re.sub(r"\b(lay|laid)\s*flat\b|\bflat\s*knit\b", " ", t, flags=re.I)
    t = re.sub(r"\bmaxi[- ]?(mal|mum|mise|mize)\w*\b", " ", t, flags=re.I)
    # prose-only false friends
    t = re.sub(r"\bmodel\s+(is|wears|measures)\b[^.]*", " ", t, flags=re.I)
    t = re.sub(r"\bcraftsman(ship)?\b|\bworkman(ship)?\b", " ", t, flags=re.I)
    t = re.sub(r"\bmen(tion|tal|u\b|d\b)\w*", " ", t, flags=re.I)
    t = re.sub(r"\bwoman?ly\b", " ", t, flags=re.I)
    return t


# ---------------------------------------------------------- frontend mirror --
#
# A port of detectSection() in style-finder.html, tier for tier. The app runs it
# over every catalog row and uses the result as a hard gate in passesFilters(),
# so this is not advisory: a piece it places in the women's deck cannot appear in
# the men's one whatever `g` says. Drift here shows up as rows that exist in the
# database and never render.
#
# The app's own regexes are narrower than the ones above — it is reading a
# product title, not a paragraph of prose — so the tiers below use their own
# copies rather than the broad ones this module uses elsewhere.

APP_F_AUDIENCE = re.compile(
    r"\b(women|womens|women's|woman|woman's|ladies|lady's|girls|girl's|for her|"
    r"maternity|nursing|femme)\b", re.I)
APP_M_AUDIENCE = re.compile(
    r"\b(men|mens|men's|man's|for him|homme)\b", re.I)

# T3 — where the shop shelved it, read off the product's own address
URL_W = re.compile(
    r"(?:/|[_\-])(?:women|womens|womans|woman|ladies|female|wmns)(?:/|[_\-]|$)", re.I)
URL_M = re.compile(
    r"(?:/|[_\-])(?:men|mens|mans|male|mnswr)(?:/|[_\-]|$)", re.I)
# T4 — the brand name itself
BRAND_W = re.compile(r"\b(?:women|womens|womans|ladies|female)\b", re.I)
BRAND_M = re.compile(r"\b(?:men|mens|male)\b", re.I)
# T5 — a gender token in the photo filename. Single letters must be delimited on
# both sides or camera codes like "..._W7A1410.jpg" read as womenswear.
IMG_W = re.compile(
    r"(?:^|[/_.\-])(?:w|wm|wmn|wmns|women|womens|womans|female|ladies)(?=[/_.\-])", re.I)
IMG_M = re.compile(
    r"(?:^|[/_.\-])(?:m|mn|men|mens|mans|male)(?=[/_.\-])", re.I)


def _filename(url):
    return (url or "").split("/")[-1].split("?")[0]


def app_section(name="", cat=None, url="", brand="", img=""):
    """-> {'g': 'f'|'m'|None, 'why': str, 'weak': bool}, exactly as the app decides."""
    s = _scrub(name or "")

    fa, ma = bool(APP_F_AUDIENCE.search(s)), bool(APP_M_AUDIENCE.search(s))
    if fa != ma:
        return {"g": "f" if fa else "m", "why": "name says so", "weak": False}

    fg = bool(F_GARMENT.search(s))
    if cat == "shoe" and F_SHOE.search(s):
        fg = True
    if cat == "acc" and F_BAG.search(s):
        fg = True
    mg = bool(M_GARMENT.search(s))
    if fg != mg:
        return {"g": "f" if fg else "m", "why": "garment type", "weak": False}

    uw, um = bool(URL_W.search(url or "")), bool(URL_M.search(url or ""))
    if uw != um:
        return {"g": "f" if uw else "m", "why": "product web address", "weak": False}

    bw, bm = bool(BRAND_W.search(brand or "")), bool(BRAND_M.search(brand or ""))
    if bw != bm:
        return {"g": "f" if bw else "m", "why": "brand name", "weak": False}

    f = _filename(img)
    iw, im = bool(IMG_W.search(f)), bool(IMG_M.search(f))
    if iw != im:
        return {"g": "f" if iw else "m", "why": "photo filename", "weak": True}

    return {"g": None, "why": "nothing in the listing says", "weak": False}


def frontend_lock(name, cat=None, url="", brand="", img=""):
    """The app's verdict, or None where it has no opinion.

    Weak evidence (a token in a photo filename) still counts here, because in the
    app a brand lean can overrule it but nothing else does — and we cannot
    compute that lean until the row is in the catalog.
    """
    return app_section(name, cat, url, brand, img)["g"]


# ------------------------------------------------------------- the verdict --

def _hit(pattern_f, pattern_m, text):
    """-> 'f', 'm' or None. Only fires when exactly one side matches."""
    if not text:
        return None
    f, m = bool(pattern_f.search(text)), bool(pattern_m.search(text))
    if f == m:
        return None
    return "f" if f else "m"


def _path_hit(url):
    """Gender from a URL path, ignoring the host and the query string."""
    if not url:
        return None
    path = re.sub(r"^https?://[^/]+", "", url).split("?")[0].split("#")[0]
    segs = [s for s in path.split("/") if s]
    f = m = False
    for seg in segs:
        low = seg.lower()
        for pat, short, flag in ((F_PATH, "w", "f"), (M_PATH, "m", "m")):
            hit = pat.match(low) or pat.search("/" + low + "/")
            if not hit:
                continue
            word = hit.group(1).lower()
            # a bare "w"/"m" is only a gender when it is the whole segment
            if word in _SHORT_PATH and low != word:
                continue
            if flag == "f":
                f = True
            else:
                m = True
    if f == m:
        return None
    return "f" if f else "m"


def classify(name="", desc="", url="", breadcrumbs="", section=None,
             ld_gender=None, brand_prior=None, cat=None, brand="", img=""):
    """Weigh every available signal. -> {'g', 'conf', 'why', 'scores'}

    `section` is the gender of the index page the crawl reached this product
    from ('m'/'f'/None) — the single most reliable thing a browser can know, and
    the reason this beats title-keyword guessing.
    """
    name_s = _scrub(name or "")
    desc_s = _scrub(desc or "")
    crumb_s = _scrub(breadcrumbs or "")

    votes = []          # (weight, 'f'|'m', label)

    def vote(weight, side, label):
        if side in ("f", "m"):
            votes.append((weight, side, label))

    if ld_gender:
        vote(W_LD_GENDER, _hit(LD_F, LD_M, str(ld_gender)), "schema gender")
    if section in ("f", "m"):
        vote(W_SECTION, section, "found in the {} section".format(
            "women's" if section == "f" else "men's"))
    vote(W_BREADCRUMB, _hit(F_AUDIENCE, M_AUDIENCE, crumb_s), "breadcrumb")
    vote(W_URL, _path_hit(url), "url path")
    vote(W_NAME_AUD, _hit(F_AUDIENCE, M_AUDIENCE, name_s), "name says who it's for")
    vote(W_DESC_AUD, _hit(F_AUDIENCE, M_AUDIENCE, desc_s), "description says who it's for")

    # garment words, category-aware
    fg = bool(F_GARMENT.search(name_s))
    if cat == "shoe" and F_SHOE.search(name_s):
        fg = True
    if cat == "acc" and F_BAG.search(name_s):
        fg = True
    mg = bool(M_GARMENT.search(name_s))
    if fg != mg:
        vote(W_NAME_GARMENT, "f" if fg else "m", "gendered garment")

    vote(W_DESC_BODY, _hit(F_BODY, M_BODY, desc_s), "fit language")
    vote(W_DESC_GARMENT, _hit(F_GARMENT, M_GARMENT, desc_s), "garment in description")

    scores = {"f": 0.0, "m": 0.0}
    for weight, side, _ in votes:
        scores[side] += weight

    net = scores["f"] - scores["m"]
    if abs(net) >= MARGIN:
        g = "f" if net > 0 else "m"
    else:
        g = "u"

    total = scores["f"] + scores["m"]
    conf = round(abs(net) / total, 3) if total else 0.0

    why = [lbl for _, side, lbl in sorted(votes, reverse=True)
           if g != "u" and side == g][:3]

    # The brand's own skew is a tiebreak, not a vote. A menswear-only label with
    # nothing else to go on should still produce menswear rather than 'u' — that
    # is what enrich.classify_gender has always done — but the moment the piece
    # or the page says anything at all, the evidence above decides and this never
    # runs. Confidence stays low so it reads as the guess it is.
    if g == "u" and brand_prior in ("f", "m") and scores[
            "m" if brand_prior == "f" else "f"] == 0:
        g = brand_prior
        conf = round(min(conf, 0.25), 3)
        why = ["brand only sells {}".format(
            "womenswear" if g == "f" else "menswear")]

    # ---- reconcile with the app's hard gate -------------------------------
    # Losing an argument with the app is not a difference of opinion, it is an
    # invisible product: passesFilters() drops anything whose section disagrees
    # with the deck being shown. So where the app has an opinion it takes it,
    # and the reason records that we deferred and why.
    verdict = app_section(name, cat, url, brand, img)
    lock = verdict["g"]
    if lock and lock != g:
        why = ["the app reads this as {} ({})".format(
            "women's" if lock == "f" else "men's", verdict["why"])] + why[:2]
        g = lock
        # a weak signal (a token in a photo filename) shouldn't look certain
        conf = 0.3 if verdict["weak"] else max(conf, 0.5)

    return {"g": g, "conf": conf, "why": " · ".join(why) or "no clear signal",
            "scores": scores, "app_says": lock, "app_why": verdict["why"]}


def summarise(rows):
    """Counts by verdict — used by the scraper's per-site report."""
    out = {"f": 0, "m": 0, "u": 0}
    for r in rows:
        out[r.get("g", "u")] = out.get(r.get("g", "u"), 0) + 1
    return out
