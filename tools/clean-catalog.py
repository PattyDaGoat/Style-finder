"""
Catalog cleaner for style-finder.html

  1. Keep only wearable things: clothing, accessories, shoes.
  2. Repair categories that are demonstrably wrong.
  3. Re-tag gender so menswear shows men's pieces and womenswear women's.

Gender uses four tiers, most trustworthy first:
  T1  an explicit audience word in the name ("Women's ...", "Men's ...")
  T2  a garment type only one gender wears (bodycon dress, jockstrap)
  T3  the retailer's own tag  -- respected, never overridden without proof above
  T4  the brand's gender profile -- used ONLY to resolve items tagged unisex,
      and only for brands that are overwhelmingly single-gender on hard evidence

Nothing here reads photographs. Inferring a model's gender from raw pixels needs a
trained vision model, and a wrong guess files a dress into menswear -- the exact bug
being fixed. Names and brands are dull and correct.

Vocabulary is held in plain Python lists, not one big verbose regex: an earlier version
used re.VERBOSE, which silently strips literal spaces, so every multi-word pattern
("crop top", "dress shirt") quietly never matched.
"""
import io, re, json
from collections import Counter, defaultdict

SRC = "/tmp/sf/work/style-finder.html"
h = io.open(SRC, encoding="utf-8").read()
CAT = json.loads(re.search(r'const CATALOG = (\[.*?\]);\n', h, re.S).group(1))
print("loaded %d items" % len(CAT))

def words(lst):                      # -> compiled word-boundary alternation
    return re.compile(r"\b(?:" + "|".join(lst) + r")\b")
def n_of(p): return re.sub(r"\s+", " ", (p.get("n") or "").lower())

# =====================================================================
# 1. IS IT WEARABLE?  (positive vocabulary — catches what a blocklist misses)
# =====================================================================
APPAREL_WORDS = [
 # tops
 "t-?shirts?","tees?","tanks?","singlets?","tops?","camisoles?","camis?","blouses?","shirts?",
 "polos?","henleys?","jerseys?","button ?ups?","button ?downs?","long ?sleeves?","longsleeves?",
 "short ?sleeves?","raglans?","bodices?",
 # knits & sweats
 "sweaters?","jumpers?","knits?","knitwear","cardigans?","pullovers?","hoodies?","hoodys?","hoods?",
 "sweatshirts?","sweats?","sweatpants?","crewnecks?","crews?","fleeces?","turtlenecks?","mocknecks?",
 "quarter ?zips?","half ?zips?","zip ?ups?",
 # outerwear
 "jackets?","coats?","parkas?","anoraks?","windbreakers?","blazers?","vests?","gilets?","ponchos?",
 "capes?","overshirts?","shackets?","bombers?","trenches?","trench","puffers?","shells?","macs?",
 # bottoms
 "pants?","trousers?","chinos?","jeans?","denim","shorts?","skirts?","skorts?","leggings?","jeggings?",
 "joggers?","track ?pants?","cargos?","slacks?","overalls?","dungarees?","culottes?","flares?",
 # one-piece
 "dress(?:es)?","gowns?","rompers?","playsuits?","jumpsuits?","bodysuits?","unitards?","boilersuits?",
 "pinafores?","kaftans?","caftans?","sarongs?",
 # swim
 "swims?","swimwear","swimsuits?","bikinis?","trunks?","boardshorts?","board ?shorts?","rashguards?",
 "rash ?guards?","tankinis?","one ?pieces?",
 # underwear & sleep
 "bras?","bralettes?","briefs?","boxers?","underwear","undies","thongs?","lingerie","corsets?",
 "bustiers?","slips?","pyjamas?","pajamas?","pjs?","robes?","kimonos?","loungewear","onesies?",
 "nighties?","nightgowns?","sleep ?shirts?",
 # legwear
 "socks?","tights?","stockings?","hosiery",
 # headwear
 "caps?","hats?","beanies?","buckets?","visors?","headbands?","bandanas?","balaclavas?","snapbacks?",
 "fedoras?","berets?","beanie","sunhats?",
 # accessories
 "belts?","scarves","scarf","shawls?","ties?","neckties?","bow ?ties?","bolos?","gloves?","mittens?",
 "suspenders?","braces","cufflinks?","necklaces?","earrings?","bracelets?","anklets?","rings?",
 "pendants?","charms?","brooches?","chains?","jewellery","jewelry","sunglasses?","eyewear","watches?",
 "watch","wallets?","cardholders?","card ?cases?","keyrings?",
 # bags (worn accessories)
 "bags?","totes?","backpacks?","rucksacks?","duffels?","duffles?","satchels?","clutches?","clutch",
 "purses?","handbags?","crossbodys?","cross ?body","pouches?","slings?","musettes?",
 # footwear
 "shoes?","sneakers?","trainers?","boots?","loafers?","derbys?","derbies","oxfords?","brogues?",
 "sandals?","slides?","flip ?flops?","espadrilles?","moccasins?","mocs?","clogs?","mules?","heels?",
 "pumps?","flats?","slippers?","chukkas?","chelseas?","hikers?","runners?","cleats?",
 # suiting & misc garments
 "suits?","waistcoats?","tuxedos?","aprons?","uniforms?","garments?","sets?","co-?ords?","two ?pieces?",
 "wraps?","wrap","liners?","base ?layers?","thermals?","onepiece",
]
APPAREL = words(APPAREL_WORDS)

# Compound garment nouns: "workshirt", "raincoat", "shirtdress", "undershirt", "headscarf"
# have no word boundary before the stem, so the list above misses them entirely.
SUFFIX = re.compile(r"(?:shirts?|coats?|dress(?:es)?|shorts?|shortys?|shorties|pants?|pantalons?|"
                    r"socks?|scarf|scarves|suits?|wear|jackets?|sweaters?|hoodies?|tops?|tees?|"
                    r"skirts?|jumpers?|knits?|boots?|shoes?|caps?|hats?|bags?|vests?|robes?|"
                    r"jeans?|denim|wares?)\b")

# Generic words that are apparel-ish but too weak to prove an item is clothing on their own.
WEAK = words(["sets?","wraps?","liners?","crews?","tops?","bags?","packs?","cases?","cords?"])

# Definitely not worn, even when the name also contains a garment word.
NOT_WEARABLE = words([
 "gift ?cards?","e-?gift","candles?","mugs?","tumblers?","water ?bottles?","flasks?","magazines?",
 "zines?","newspapers?","books?","novels?","notebooks?","journals?","diaries","posters?",
 "art ?prints?","puzzles?","playing ?cards?","incense","shampoo","conditioners?","body ?lotions?",
 "moisturi[sz]ers?","hand ?cream","lip ?balms?","serums?","perfumes?","colognes?","fragrances?",
 "deodorants?","toothbrushes?","razors?","sunscreens?","vitamins?","supplements?","protein ?powder",
 "beach ?towels?","bath ?towels?","bath ?sheets?","hand ?towels?","golf ?towels?","towels?",
 "blankets?","throws?","pillow ?cases?","pillowcases?","pillows?","cushions?","duvets?","bed ?sheets?",
 "day ?beds?","bed ?sets?","doormats?","picture ?frames?","mouse ?pads?","lighters?","ashtrays?",
 "grinders?","skateboards?","surfboards?","snowboards?","wheels?","trucks? set","bearings?",
 "griptape","tents?","sleeping ?bags?","coolers?","chairs?","stools?","side ?tables?","lamps?",
 "speakers?","headphones?","earbuds?","chargers?","phone ?cases?","laptop ?sleeves?","mirrors?",
 "vases?","planters?","coasters?","air ?fresheners?","leather ?conditioner","shoe ?trees?",
 "boxed ?tea","coffee ?beans?","toys?","figurines?","sticker ?packs?","patch ?sets?",
 "packing ?cubes?","spectacle ?cords?","furniture","collected ?works","cube ?sets?",
])

def first_segment(n):
    """Product name before the colour/variant tail: 'Blanket Shirt - Outerworn' -> 'blanket shirt'."""
    n = re.sub(r"\([^)]*\)", " ", n)
    n = re.split(r"\s+[-–—|:~]\s+|\s{2,}", n)[0]
    return re.sub(r"\s+", " ", n).strip()

def last_end(rx, s):
    e = -1
    for mt in rx.finditer(s): e = mt.end()
    return e

# Extra garment words, incl. non-English and trade terms, so the head-noun comparison
# below judges "Blanket Shirt" (keep) differently from "Beach Towel" (drop).
EXTRA = words(["popovers?","strapbacks?","shortalls?","bralets?","boaters?","pareos?","laces?",
               "scrunchies?","d[eé]bardeurs?","jupes?","kaps?","bibs?","coveralls?","shirtdress(?:es)?",
               "workshirts?","undershirts?","headscarf","headscarves","raincoats?","overcoats?",
               "topcoats?","peacoats?","tracksuits?","swimwear","beanies?","babygrows?"])

# Names that are unmistakably objects rather than things you wear.
OBJECT = re.compile(
    r"\[\s*\d+(?:\.\d+)?\s*[\"”′″']?\s*\]"          # skate deck sizing: [8.25"]
    r"|\b\d+(?:\.\d+)?\s*mm\b"                        # 54MM wheel
    r"|\bwheels?\b|\bgriptape\b|\bbearings?\b|\bdeck\b"
    r"|\bputter\b|\bmallet\b|\bcoverlet\b|\bissue\s*#?\d+"
    r"|\bbottle ?opener\b|\bwoodcarved\b|\bcarved\b|\bgiraffe\b"
    r"|\bpen in\b|\bballpoint\b|\bhand ?cream\b|\bcollected works\b|\bfurniture\b", re.I)

def head_is_nonwearable(seg):
    """True when the thing the name ends on is a non-wearable object."""
    nw = last_end(NOT_WEARABLE, seg)
    if nw < 0: return False
    ap = max(last_end(APPAREL, seg), last_end(SUFFIX, seg), last_end(EXTRA, seg))
    return nw >= ap        # the household word is the head, or there's no garment word at all

# Only positive evidence of NOT being wearable removes an item. An earlier version required
# a garment word in the name and dropped ~1,050 items -- but hundreds of real products are
# bare model names ("574 Legacy", "The Starling", "Débardeur Spaghetti"), so that test threw
# away shoes and tank tops. The per-item `cat` field already says what kind of garment it is;
# the name only needs to veto the handful of non-apparel strays.
def has_garment_word(s):
    return bool(APPAREL.search(s) or SUFFIX.search(s) or EXTRA.search(s))

dropped = []
for p in CAT:
    n = n_of(p); seg = first_segment(n)
    if head_is_nonwearable(seg):
        dropped.append(p)
    elif NOT_WEARABLE.search(seg) and not SUFFIX.search(seg) and not EXTRA.search(seg) \
         and last_end(WEAK, seg) == last_end(APPAREL, seg):
        dropped.append(p)          # only a generic word like "set" argues for apparel
    elif OBJECT.search(n) and not has_garment_word(n):
        dropped.append(p)          # object-shaped name AND no garment word anywhere
drop_ids = {id(p) for p in dropped}
KEPT = [p for p in CAT if id(p) not in drop_ids]

print("\n=== 1. NOT WEARABLE -> dropping %d, keeping %d" % (len(dropped), len(KEPT)))
for p in dropped[:34]:
    print("    [%s/%s] %-22s %s" % (p.get("g"), p.get("cat"), p.get("b")[:22], p.get("n")[:56]))
if len(dropped) > 34: print("    ... and %d more" % (len(dropped)-34))

# =====================================================================
# 2. CATEGORY REPAIR
# =====================================================================
DRESSY   = re.compile(r"\bdress\s+(shirt|pant|trouser|sock|boot|shoe|short)")

# A real dress has a dress noun. "Dressy Crew Neck Sweater" and "Dress Shirt" do not.
TRUE_DRESS = re.compile(r"\b(dress|dresses|gown|gowns|shirtdress|sundress|maxi|midi)\b")
CAT_BY_WORD = [("shoe",  words(["shoes?","sneakers?","trainers?","boots?","loafers?","sandals?","slides?",
                                "heels","pumps?","flats?","mules?","clogs?","espadrilles?","slippers?"])),
               ("outer", words(["jackets?","coats?","parkas?","anoraks?","blazers?","vests?","gilets?",
                                "bombers?","windbreakers?","raincoats?","overcoats?","peacoats?"])),
               ("knit",  words(["sweaters?","jumpers?","cardigans?","knits?","knitwear","pullovers?"])),
               ("sweat", words(["hoodies?","hoodys?","sweatshirts?","sweats?","joggers?","sweatpants?"])),
               ("shirt", words(["shirts?","blouses?","polos?","button ?ups?","button ?downs?","overshirts?",
                                "workshirts?","henleys?"])),
               ("trouser",words(["trousers?","pants?","jeans?","chinos?","slacks?","leggings?","skirts?"])),
               ("short", words(["shorts?","skorts?"])),
               ("cap",   words(["caps?","hats?","beanies?","visors?"])),
               ("acc",   words(["belts?","scarves","scarf","ties?","socks?","gloves?","necklaces?",
                                "earrings?","bracelets?","bags?","totes?","wallets?"])),
               ("tee",   words(["tees?","t-?shirts?","tanks?","tops?","singlets?","bodysuits?"]))]

def rederive_cat(n, fallback):
    for c, rx in CAT_BY_WORD:
        if rx.search(n): return c
    return fallback
BAGWORD  = words(["totes?","backpacks?","rucksacks?","duffels?","duffles?","satchels?","clutches?",
                  "clutch","purses?","handbags?","crossbodys?","cross ?body","pouches?","wallets?",
                  "cardholders?","card ?cases?","bags?"])
SKIRT    = re.compile(r"\bskirts?\b")

def bag_is_head(n):
    """True only when the bag word is what the product actually is."""
    seg = first_segment(n)
    if not BAGWORD.search(seg): return False
    if re.search(r"\bcargo\b|\bbag ?shirt\b", seg): return False
    tail = " ".join(seg.split()[-2:])          # the head noun and one modifier
    return bool(BAGWORD.search(tail))
fix = Counter()
for p in KEPT:
    n = n_of(p)
    if p["cat"] == "dress" and (DRESSY.search(n) or not TRUE_DRESS.search(n)):
        p["cat"] = rederive_cat(n, "shirt"); fix["not actually a dress -> re-derived"] += 1
    elif p["cat"] not in ("acc",) and bag_is_head(n):
        p["cat"] = "acc"; fix["bags -> accessories"] += 1
    if SKIRT.search(n) and p["cat"] in ("trouser", "short"):
        fix["skirts sitting in bottoms"] += 1
print("\n=== 2. CATEGORY REPAIR ===")
for k, v in fix.items(): print("    %-38s %d" % (k, v))

# =====================================================================
# 3. GENDER
# =====================================================================
# T1 — explicit audience. NB "boy" is deliberately absent: "boy fit" and
# "boyfriend" are women's cuts, so it is a trap, not a men's marker.
T1_F = words([r"women", r"womens", r"women's", r"woman", r"woman's", r"ladies", r"lady's",
              r"girls", r"girl's", r"for her", r"maternity", r"nursing", r"femme"])
T1_M = words([r"men", r"mens", r"men's", r"man's", r"for him", r"homme"])

# T2 — garment types only one gender wears
T2_F = words([
 "dress(?:es)?","gowns?","skirts?","skorts?","blouses?","bras?","bralettes?","bikinis?","swimsuits?",
 "tankinis?","lingerie","corsets?","bustiers?","camisoles?","camis?","bodysuits?","bodycon","rompers?",
 "playsuits?","jumpsuits?","leggings?","jeggings?","tights?","pantyhose","midi","maxi","halters?",
 "off-?(?:the-?)?shoulder","strapless","sweetheart","peplum","tube ?tops?","crop ?tops?",
 "cropped ?tops?","kaftans?","caftans?","babydolls?","pinafores?","jupes?","sarongs?","pareos?",
  "nighties?","nightgowns?","bodices?","corsages?","suspender ?belts?","mini ?dress","slip ?dress",
 "wrap ?dress",
])
T2_M = words(["boxer ?briefs?","boxers?","jockstraps?","tuxedos?","neckties?","bow ?ties?",
              "swim ?trunks?","trunks?","y-?fronts?"])

# Context-bound markers: only a women's signal inside the category they belong to.
SHOE_F = words(["stilettos?","pumps?","heels","wedges?","espadrilles?","ballet ?flats?",
                "mary ?janes?","kitten ?heels?","slingbacks?"])
BAG_F  = words(["clutch","clutches?","purses?","handbags?"])

# noise scrubbers: shoe anatomy, "dress shirt", knit terms that look like markers
def scrub(n):
    n = DRESSY.sub(" ", n)
    n = re.sub(r"\bheel\s+(?:tab|counter|cup|loop|pull|patch)\b", " ", n)
    n = re.sub(r"\b(?:lay|laid)\s*flat\b|\bflat\s*knit\b|\bflat\s*lay\b", " ", n)
    n = re.sub(r"\bmaxi[- ]?(?:mal|mum)\b", " ", n)
    return n

def tier(n, cat=None):
    s = scrub(n)
    f1, m1 = bool(T1_F.search(s)), bool(T1_M.search(s))
    if f1 != m1: return ("f" if f1 else "m"), "T1 audience word"
    f2 = bool(T2_F.search(s)) \
         or (cat == "shoe" and bool(SHOE_F.search(s))) \
         or (cat == "acc"  and bool(BAG_F.search(s)))
    m2 = bool(T2_M.search(s))
    if f2 != m2: return ("f" if f2 else "m"), "T2 garment type"
    return None, None

# ---- 3a. brand profile, from HARD evidence only (never from the tags we're auditing)
ev = defaultdict(lambda: [0, 0])
for p in KEPT:
    g, _ = tier(n_of(p), p.get("cat"))
    if g == "f": ev[p.get("b","")][0] += 1
    elif g == "m": ev[p.get("b","")][1] += 1
BRAND, BRAND_STRICT = {}, {}
for b, (fc, mc) in ev.items():
    tot = fc + mc
    if tot >= 5:                                  # enough hard hits to mean something
        if fc/tot >= 0.95: BRAND[b] = "f"
        elif mc/tot >= 0.95: BRAND[b] = "m"
    if tot >= 10:                                 # strong enough to correct a bad tag
        if fc/tot >= 0.98: BRAND_STRICT[b] = "f"
        elif mc/tot >= 0.98: BRAND_STRICT[b] = "m"
nf = sum(1 for v in BRAND.values() if v=="f"); nm = len(BRAND)-nf
print("\n=== 3a. BRAND PROFILE (hard evidence only, >=5 hits, >=95%% one way) ===")
print("    %d women's brands, %d men's brands, %d left mixed/unknown"
      % (nf, nm, len({p['b'] for p in KEPT}) - len(BRAND)))

# ---- 3b. decide
before = Counter(p.get("g") for p in KEPT)
why = Counter(); changed = []; why_of = {}
for p in KEPT:
    n, old = n_of(p), p.get("g")
    g, r = tier(n, p.get("cat"))
    if g:                                  new, reason = g, r
    elif p.get("b") in BRAND_STRICT and old in ("m","f") and BRAND_STRICT[p["b"]] != old:
                                           new, reason = BRAND_STRICT[p["b"]], "T3.5 brand overrides tag"
    elif old in ("m","f"):                 new, reason = old, "T3 retailer tag kept"
    elif p["cat"] == "dress":              new, reason = "f", "T2 dress category"
    elif p.get("b") in BRAND:              new, reason = BRAND[p["b"]], "T4 single-gender brand"
    else:                                  new, reason = "u", "genuinely unisex"
    p["g"] = new; why[reason] += 1; why_of[id(p)] = reason
    if new != old: changed.append((old, new, reason, p.get("b",""), p["n"][:50]))

# ---- 3b-ii. T5 majority snap.
# A brand with 30 women's pieces and exactly one "men's" piece is a tagging slip, not a
# menswear line. Snap the minority to the majority -- but ONLY for items whose gender came
# from the retailer's tag. Anything decided by a garment word or an audience word above is
# left alone, so a real "Women's Boy Fit Tank" inside a menswear brand survives.
tag_decided = {id(p) for p in KEPT if why_of.get(id(p)) in ("T3 retailer tag kept",)}
bcount = defaultdict(Counter)
for p in KEPT: bcount[p.get("b","")][p["g"]] += 1
snapped = 0
for p in KEPT:
    if id(p) not in tag_decided: continue
    c = bcount[p.get("b","")]
    f, m = c.get("f",0), c.get("m",0)
    if f + m < 8: continue
    maj, mino = ("f","m") if f > m else ("m","f")
    if p["g"] == mino and c[mino]/(f+m) <= 0.15:
        p["g"] = maj; snapped += 1; why["T5 brand majority snap"] += 1; why["T3 retailer tag kept"] -= 1
        changed.append(("(tag)", maj, "T5 brand majority", p.get("b",""), p["n"][:50]))
print("    T5 majority snap corrected %d items" % snapped)

after = Counter(p.get("g") for p in KEPT)

print("\n=== 3b. RE-TAG ===")
print("    before:", dict(before), "\n    after :", dict(after))
for k, v in why.most_common(): print("      %-26s %d" % (k, v))
print("    gender changed on %d items" % len(changed))
print("    change directions:", Counter("%s->%s" % (c[0], c[1]) for c in changed).most_common())
for c in changed[:16]: print("      %s->%s (%-22s) %-18s %s" % (c[0],c[1],c[2][:22],c[3][:18],c[4]))

# ---- 3c. leak check
leak_m = [p for p in KEPT if p["g"] in ("m","u") and tier(n_of(p), p.get("cat"))[0] == "f"]
leak_f = [p for p in KEPT if p["g"] in ("f","u") and tier(n_of(p), p.get("cat"))[0] == "m"]
print("\n=== 3c. LEAK CHECK ===")
print("    women's items still reachable from MENSWEAR:   %d" % len(leak_m))
for p in leak_m[:8]: print("       [%s] %s — %s" % (p["g"], p["b"][:20], p["n"][:50]))
print("    men's items still reachable from WOMENSWEAR:   %d" % len(leak_f))
for p in leak_f[:8]: print("       [%s] %s — %s" % (p["g"], p["b"][:20], p["n"][:50]))
print("\n    unisex remaining: %d" % after.get("u",0))
print("    unisex by category:", Counter(p["cat"] for p in KEPT if p["g"]=="u").most_common())
print("    per-section deck sizes:  menswear %d   womenswear %d"
      % (sum(1 for p in KEPT if p["g"] in ("m","u")), sum(1 for p in KEPT if p["g"] in ("f","u"))))
print("    category coverage (menswear):",
      Counter(p["cat"] for p in KEPT if p["g"] in ("m","u")).most_common())
print("    category coverage (womenswear):",
      Counter(p["cat"] for p in KEPT if p["g"] in ("f","u")).most_common())

# =====================================================================
# 4. OUTPUT
# =====================================================================
NEW = json.dumps(KEPT, separators=(",", ":"), ensure_ascii=False)
io.open("/tmp/sf/catalog_clean.json", "w", encoding="utf-8").write(NEW)
json.dump({"kept": len(KEPT), "dropped": len(dropped),
           "brands_f": sorted(b for b,v in BRAND.items() if v=="f"),
           "brands_m": sorted(b for b,v in BRAND.items() if v=="m"),
           "dropped_names": [p["n"] for p in dropped]},
          io.open("/tmp/sf/clean_report.json","w",encoding="utf-8"), indent=1, ensure_ascii=False)
print("\nwrote catalog_clean.json (%d items, %.2f MB)" % (len(KEPT), len(NEW)/1e6))
