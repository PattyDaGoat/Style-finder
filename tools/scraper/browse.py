"""The headless-browser crawler.

`harvest.py` asks a shop for /products.json and normalises whatever comes back.
That works on Shopify and nowhere else, and what comes back has no notion of
which section of the shop a piece belongs to. Most of the clothing internet is
neither: Uniqlo, COS, J.Crew, Mango, Aritzia and the rest render their listings
client-side, and a plain fetch of those URLs returns an empty shell.

So this drives a real Chromium instead. For every gendered index page in
sites.py it loads the page, lets the React app paint, scrolls until the grid
stops growing, and pulls the products out three ways at once:

    JSON-LD      the <script type="application/ld+json"> block. Cleanest when
                 present — it carries name, price, image, brand and sometimes
                 the shop's own audience/gender field.
    XHR capture  every JSON response the page fetched while we watched. Single
                 page apps hand themselves their catalog this way, so this is
                 usually the richest source on the sites that have no JSON-LD.
    DOM sweep    last resort: product-shaped links, the image and price near
                 them. Ugly, but it is what makes a shop we have never seen
                 work without writing a selector for it.

Whatever the source, the piece is then read for gender (gender.py) and tagged
with the same taxonomy the app already uses (enrich.py), so a row scraped from
Uniqlo scores through scoring.py identically to one pulled from a Shopify feed.

    python3 browse.py --probe                 which shops let us in
    python3 browse.py --crawl --limit 400     fill the pool
    python3 browse.py --crawl --brand COS     one shop, verbose

Politeness: one page at a time per shop, a real user-agent, a pause between
scrolls, images and fonts blocked (which is both faster and lighter on their
CDN), and consent banners answered with *reject*, never accept.
"""

import argparse
import asyncio
import json
import random
import re
import sys
import time
from collections import Counter, defaultdict
from urllib.parse import urljoin, urlparse

# A piped or redirected stdout gets a cp1252 codec on Windows, where one
# non-Latin-1 glyph kills a run mid-report. The ASCII swap above fixes the
# glyph we had; this stops the next one being a crash instead of a '?'.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

import db
import enrich
import gender as gender_mod
import sites as site_registry

try:
    from playwright.async_api import async_playwright, Error as PWError
except ImportError:                                            # pragma: no cover
    sys.exit("playwright is missing — python3 -m pip install --user playwright "
             "&& playwright install chromium")

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")

RATE_LIMITED = "rate-limited (429) — stopping this shop for now"

# How many listing pages to take from one shop in one visit. Everlane serves two
# and then answers 429, and it is not alone; a shop's remaining entry points are
# picked up on the next sweep instead, so coverage still accumulates without
# leaning on anyone.
ENTRIES_PER_VISIT = 2

NAV_TIMEOUT = 45_000
SETTLE_MS = 2_500          # after load, before we start scrolling
SCROLL_ROUNDS = 8
SCROLL_PAUSE = 900
PDP_TIMEOUT = 25_000

BLOCK_TYPES = {"image", "media", "font"}
BLOCK_HOSTS = re.compile(
    r"(google-analytics|googletagmanager|doubleclick|facebook\.net|hotjar|"
    r"segment\.(io|com)|criteo|taboola|outbrain|bing\.com|clarity\.ms|"
    r"snapchat|tiktok|pinterest\.com/ct|klaviyo|attentivemobile)", re.I)

# Currencies we see, and roughly what they are worth. Approximate on purpose —
# these decide budget filtering, not accounting.
CUR_SYMBOL = {"$": "$", "£": "£", "€": "€", "¥": "¥",
              "USD": "$", "AUD": "$", "CAD": "$", "GBP": "£", "EUR": "€"}
TO_USD = {"$": 1.0, "£": 1.27, "€": 1.08, "¥": 0.0067}

# Both separators are allowed inside the number (1,299.00 and 1.299,00 are the
# same price); _to_float works out which one was the decimal point. Anchoring the
# end on a digit keeps a full stop that ends a sentence out of the amount.
_AMT = r"\d[\d.,]*\d|\d"
MONEY = re.compile(
    r"(?:(?P<sym>[$£€¥])\s?(?P<amt1>{a})"
    r"|(?P<amt2>{a})\s?(?P<code>USD|AUD|CAD|GBP|EUR))".format(a=_AMT))

# What a product URL looks like across the shops in the registry.
PRODUCT_HREF = re.compile(
    r"/(products?|prd|item|itm|dp|pd)/|/p/|product[-._]\d|/shop/[^?]*/p/|"
    r"\.product\.|/product\.", re.I)

# Links that match PRODUCT_HREF but are not a product.
NOT_PRODUCT_HREF = re.compile(
    r"/(cart|account|login|register|gift-?card|blog|journal|pages?|policies|"
    r"collections?/all|search|help|faq|stores?|size-?guide)(/|$|\?)", re.I)


def log(*a):
    print(*a, flush=True)


def notify(title, message, sound="Glass"):
    """Pop a desktop notification. A crawl runs for half an hour in silence, so
    it should say when it is done rather than making you watch it.

    Windows, macOS and Linux each get their native mechanism; this used to be
    macOS-only and returned silently everywhere else, so a Windows user got no
    alert at all and no hint that one was ever intended. Never fatal — a failed
    alert must not take the crawl down."""
    import subprocess

    try:
        if sys.platform == "darwin":
            esc = lambda s: str(s).replace("\\", "\\\\").replace('"', '\\"')
            subprocess.run(
                ["osascript", "-e",
                 'display notification "{}" with title "{}" sound name "{}"'.format(
                     esc(message), esc(title), sound)],
                timeout=10, capture_output=True)

        elif sys.platform.startswith("win"):
            # Built straight into Windows; no module to install. Passed
            # base64-encoded so quotes in a product name cannot break it.
            import base64
            q = lambda s: "'" + str(s).replace("'", "''") + "'"
            ps = (
                "[Windows.UI.Notifications.ToastNotificationManager, "
                "Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null\n"
                "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, "
                "ContentType=WindowsRuntime] | Out-Null\n"
                "$t=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent("
                "[Windows.UI.Notifications.ToastTemplateType]::ToastText02)\n"
                "$n=$t.GetElementsByTagName('text')\n"
                "$n.Item(0).AppendChild($t.CreateTextNode({})) | Out-Null\n"
                "$n.Item(1).AppendChild($t.CreateTextNode({})) | Out-Null\n"
                "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("
                "'Microsoft.Windows.Explorer').Show("
                "[Windows.UI.Notifications.ToastNotification]::new($t))"
            ).format(q(title), q(message))
            subprocess.run(
                ["powershell", "-NoProfile", "-NonInteractive", "-EncodedCommand",
                 base64.b64encode(ps.encode("utf-16-le")).decode("ascii")],
                timeout=25, capture_output=True)
            try:
                import winsound
                winsound.MessageBeep(winsound.MB_ICONASTERISK)
            except Exception:
                pass

        else:
            subprocess.run(["notify-send", str(title), str(message)],
                           timeout=10, capture_output=True)
    except Exception:
        pass


# ------------------------------------------------------------------- money --

def _to_float(raw):
    """Read a price string without assuming which separator means what.

    Shops write 1,299.00 and 1.299,00 and 39,99 for the same kind of number. The
    rule that covers all three: when both separators appear the rightmost one is
    the decimal point; when only a comma appears it is a decimal point if exactly
    two digits follow it, and a thousands separator otherwise.
    """
    raw = (raw or "").strip()
    if not raw:
        return None
    has_comma, has_dot = "," in raw, "." in raw
    if has_comma and has_dot:
        if raw.rfind(",") > raw.rfind("."):
            raw = raw.replace(".", "").replace(",", ".")
        else:
            raw = raw.replace(",", "")
    elif has_comma:
        raw = raw.replace(",", ".") if re.search(r",\d{2}$", raw) \
            else raw.replace(",", "")
    try:
        return float(raw)
    except ValueError:
        return None


def parse_money(text):
    """-> (amount, symbol) or (None, None). Takes the *first* price in the blob,
    which on a sale card is the current price, not the struck-through one."""
    if not text:
        return None, None
    m = MONEY.search(text)
    if not m:
        return None, None
    sym = m.group("sym") or CUR_SYMBOL.get((m.group("code") or "").upper(), "$")
    v = _to_float(m.group("amt1") or m.group("amt2") or "")
    return (v, sym) if v and v > 0 else (None, None)


# Keys that say outright what unit the number is in.
CENTS_KEY = re.compile(r"cents|minor[_-]?units?", re.I)
MICROS_KEY = re.compile(r"micros", re.I)


def _minor_units(v, key, node):
    """Rescale a price only when something actually says it is in minor units.

    An earlier version guessed from the digits — anything over 1000 that didn't
    end in 00 was treated as cents. That turned Taylor Stitch's $1,248 Moto
    Jacket into a $12.48 one and walked it straight past the price cap into the
    deck. Guessing is not worth that, so now it converts on evidence only:

      * the key names the unit (`price_in_cents`, `amountMicros`), or
      * the node is unmistakably a Shopify AJAX product — a `handle` alongside
        `price_min`/`price_max` — which is always quoted in cents.

    Anything else is taken at face value. A cents-quoted price we can't identify
    reads as a big number and gets dropped by the cap, which is the safe way to
    be wrong.
    """
    if MICROS_KEY.search(key or ""):
        return v / 1_000_000.0
    if CENTS_KEY.search(key or ""):
        return v / 100.0
    if (v == int(v) and node.get("handle")
            and ("price_min" in node or "price_max" in node)):
        return v / 100.0
    return v


def to_usd(amount, symbol):
    return round((amount or 0) * TO_USD.get(symbol, 1.0), 2)


# ------------------------------------------------------- structured parsing --

def _iter_nodes(obj):
    """Every dict inside an arbitrarily nested JSON blob."""
    stack = [obj]
    seen = 0
    while stack and seen < 200_000:
        node = stack.pop()
        seen += 1
        if isinstance(node, dict):
            yield node
            stack.extend(node.values())
        elif isinstance(node, list):
            stack.extend(node)


def _s(v):
    """Coerce a JSON value that might be a string, a list, or a nested object."""
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, list):
        return " ".join(_s(x) for x in v[:4])
    if isinstance(v, dict):
        for k in ("name", "value", "url", "@id", "text", "src"):
            if k in v:
                return _s(v[k])
    return ""


# A shop's JSON-LD often gives brand as {"@type":"Brand","@id":"https://x.com#organization"}
# with no name, and _s() will happily hand back that URL. Season codes and stray
# markup end up there too. None of it is a brand, and a brand string is what the
# app groups, filters and displays by — so anything that doesn't look like a name
# is discarded and the shop's own name is used instead.
def clean_brand(raw, fallback):
    b = (raw or "").strip().strip('"“”')
    if not b or len(b) < 2 or len(b) > 60:
        return fallback
    if b.lower().startswith(("http", "www.", "/")) or "#" in b or "://" in b:
        return fallback
    if not re.search(r"[A-Za-z]{2}", b):            # "SS26", "2607", "—"
        return fallback
    if re.fullmatch(r"(ss|aw|fw|pre)\s?\d{2,4}", b, re.I):   # season codes
        return fallback
    if re.search(r"[<>{}]|&[a-z]+;", b):            # leaked markup
        return fallback
    return b


NAME_KEYS = ("name", "title", "productName", "displayName", "product_title")
PRICE_KEYS = ("price", "listPrice", "salePrice", "currentPrice", "finalPrice",
              "priceValue", "amount", "minPrice", "value", "lowPrice")
IMG_KEYS = ("image", "images", "imageUrl", "imageURL", "thumbnail", "media",
            "mainImage", "primaryImage", "featured_image", "img")
URL_KEYS = ("url", "link", "productUrl", "pdpUrl", "href", "canonicalUrl",
            "@id", "handle", "slug")


def _deep_price(node):
    """Price out of a product node, following schema.org's offers if need be."""
    offers = node.get("offers")
    if offers:
        for sub in _iter_nodes(offers):
            for k in PRICE_KEYS:
                if k in sub:
                    amt, sym = parse_money(_s(sub[k])) if not isinstance(
                        sub[k], (int, float)) else (float(sub[k]), None)
                    if amt:
                        cur = _s(sub.get("priceCurrency")) or ""
                        return amt, CUR_SYMBOL.get(cur.upper(), sym or "$")
    for k in PRICE_KEYS:
        if k in node:
            v = node[k]
            if isinstance(v, (int, float)) and v > 0:
                amt = _minor_units(float(v), k, node)
                cur = _s(node.get("currency") or node.get("currencyCode")
                         or node.get("priceCurrency"))
                return amt, CUR_SYMBOL.get(cur.upper(), "$")
            amt, sym = parse_money(_s(v))
            if amt:
                return amt, sym or "$"
    return None, None


def _deep_image(node, base):
    for k in IMG_KEYS:
        if k not in node:
            continue
        for cand in _iter_nodes(node[k]) if isinstance(node[k], (dict, list)) else []:
            for kk in ("url", "src", "@id", "contentUrl", "href"):
                v = _s(cand.get(kk))
                if v and re.search(r"\.(jpe?g|png|webp|avif)", v, re.I):
                    return absolutise(v, base)
        v = _s(node[k])
        if v and re.search(r"\.(jpe?g|png|webp|avif)|/image|/media", v, re.I):
            return absolutise(v, base)
    return None


def _deep_url(node, base):
    for k in URL_KEYS:
        if k not in node:
            continue
        v = _s(node[k])
        if not v:
            continue
        if k in ("handle", "slug") and "/" not in v:
            v = "/products/" + v
        if v.startswith(("http", "/")):
            return absolutise(v, base)
    return None


# co.uk, com.au and friends — a two-label suffix, so the registrable domain is
# the last three labels rather than the last two.
_TWO_PART_TLD = re.compile(
    r"\.(co|com|net|org|gov|ac)\.(uk|au|nz|jp|kr|za|in|br|sg)$", re.I)


def registrable(url_or_host):
    """'https://www.taylorstitch.com/x' -> 'taylorstitch.com'.

    Used to tell "another page on this shop" from "a link off to someone else",
    without dragging in a public-suffix list for a dozen retailers.
    """
    host = url_or_host
    if "//" in host:
        host = urlparse(host).netloc
    host = (host or "").split(":")[0].lower().rstrip(".")
    if not host:
        return ""
    parts = host.split(".")
    n = 3 if _TWO_PART_TLD.search(host) else 2
    return ".".join(parts[-n:]) if len(parts) >= n else host


def absolutise(url, base):
    if not url:
        return None
    url = url.strip()
    if url.startswith("//"):
        return "https:" + url
    if url.startswith("http"):
        return url
    return urljoin(base, url)


def product_from_node(node, base):
    """A JSON dict -> a raw product, or None if it isn't one."""
    name = ""
    for k in NAME_KEYS:
        if k in node:
            name = _s(node[k]).strip()
            if name:
                break
    if not name or len(name) < 3 or len(name) > 180:
        return None
    # ItemList wrappers and category nodes have names too
    if str(node.get("@type", "")).lower() in ("itemlist", "breadcrumblist",
                                              "website", "organization",
                                              "webpage", "collectionpage"):
        return None

    price, sym = _deep_price(node)
    url = _deep_url(node, base)
    img = _deep_image(node, base)
    if not url or not img:
        return None
    if not PRODUCT_HREF.search(urlparse(url).path or ""):
        # a bare category link that happened to carry an image
        if "@type" not in node or "product" not in str(node.get("@type")).lower():
            return None

    return {
        "n": name,
        "u": url.split("?")[0],
        "img": (img or "").split("?")[0],
        "price": price,
        "sym": sym or "$",
        "brand": _s(node.get("brand")) or None,
        "desc": _s(node.get("description"))[:2000],
        "ld_gender": (_s(node.get("gender"))
                      or _s((node.get("audience") or {}).get("suggestedGender")
                            if isinstance(node.get("audience"), dict) else "")
                      or _s(node.get("suggestedGender"))),
        "color": _s(node.get("color")),
        "material": _s(node.get("material")),
        "via": "json",
    }


def products_from_blob(blob, base):
    out = []
    for node in _iter_nodes(blob):
        p = product_from_node(node, base)
        if p:
            out.append(p)
    return out


# ------------------------------------------------------------ browser bits --

async def make_context(browser, block_css=False):
    ctx = await browser.new_context(
        user_agent=UA,
        viewport={"width": 1440, "height": 1000},
        locale="en-US",
        timezone_id="America/New_York",
        java_script_enabled=True,
        extra_http_headers={"Accept-Language": "en-US,en;q=0.9"},
    )
    blocked = set(BLOCK_TYPES) | ({"stylesheet"} if block_css else set())

    async def route(r):
        try:
            req = r.request
            if req.resource_type in blocked or BLOCK_HOSTS.search(req.url):
                await r.abort()
            else:
                await r.continue_()
        except PWError:
            pass

    await ctx.route("**/*", route)
    ctx.set_default_timeout(NAV_TIMEOUT)
    return ctx


# Only ever the privacy-preserving answer — we decline, we never accept.
REJECT_SELECTORS = [
    "#onetrust-reject-all-handler",
    "button#truste-consent-required",
    "[data-testid='reject-all']",
    "[data-test='cookie-reject']",
    "button[aria-label*='eject' i]",
    "#CybotCookiebotDialogBodyButtonDecline",
]
REJECT_TEXT = re.compile(
    r"^\s*(reject all|reject|decline all|decline|necessary only|"
    r"only necessary|essential only|strictly necessary|refuse|no thanks)\s*$", re.I)


async def dismiss_consent(page):
    """Answer a cookie wall with 'reject', or just get it out of the way.

    Never clicks accept: agreeing to tracking on someone's behalf is not the
    crawler's call to make. If there is no reject control the banner is hidden
    locally, which grants nothing.
    """
    for sel in REJECT_SELECTORS:
        try:
            el = await page.query_selector(sel)
            if el and await el.is_visible():
                await el.click(timeout=2000)
                await page.wait_for_timeout(400)
                return "rejected"
        except PWError:
            continue
    try:
        buttons = await page.query_selector_all("button, a[role=button]")
        for b in buttons[:120]:
            try:
                txt = (await b.inner_text() or "").strip()
            except PWError:
                continue
            if txt and REJECT_TEXT.match(txt):
                try:
                    await b.click(timeout=2000)
                    await page.wait_for_timeout(400)
                    return "rejected"
                except PWError:
                    pass
    except PWError:
        pass
    # nothing to reject — hide any fixed full-width overlay so it can't eat clicks
    try:
        await page.evaluate("""() => {
          const kill = /cookie|consent|gdpr|privacy|newsletter|modal|popup/i;
          document.querySelectorAll('div,section,aside,dialog').forEach(el => {
            const cs = getComputedStyle(el);
            if ((cs.position === 'fixed' || cs.position === 'sticky') &&
                el.offsetHeight > 80 &&
                kill.test(el.className + ' ' + el.id)) el.style.display = 'none';
          });
          document.body.style.overflow = 'auto';
        }""")
    except PWError:
        pass
    return "hidden"


LOAD_MORE = re.compile(r"^\s*(load|show|view|see)\s+more|^\s*more products", re.I)


async def settle(page, timeout=6000):
    """Give the page's own fetches a chance to finish. Plenty of shops keep a
    socket open forever, so a timeout here is normal and not an error."""
    try:
        await page.wait_for_load_state("networkidle", timeout=timeout)
    except (PWError, asyncio.TimeoutError):
        pass


async def autoscroll(page, rounds=SCROLL_ROUNDS, pause=SCROLL_PAUSE):
    """Scroll until the page stops growing, clicking any 'load more' on the way.

    Deliberately steps by one viewport at a time rather than jumping to the
    bottom: these grids hang off an IntersectionObserver, and a single jump past
    everything fires it for one row and leaves the rest of the page blank.
    """
    last_h, stable = 0, 0
    for _ in range(rounds):
        try:
            await page.evaluate(
                "window.scrollBy(0, Math.max(600, window.innerHeight * 0.9))")
        except PWError:
            break
        await page.wait_for_timeout(pause)
        try:
            h = await page.evaluate("document.body.scrollHeight")
            y = await page.evaluate("window.scrollY + window.innerHeight")
        except PWError:
            break
        if h == last_h and y >= h - 50:
            stable += 1
            # a paginated grid needs the button pressed before it will grow
            clicked = await click_load_more(page)
            if clicked:
                stable = 0
                await page.wait_for_timeout(pause + 600)
            elif stable >= 2:
                break
        else:
            stable = 0
        last_h = h
    await settle(page, 3000)


async def click_load_more(page):
    try:
        for b in (await page.query_selector_all("button, a"))[:150]:
            try:
                if not await b.is_visible():
                    continue
                txt = (await b.inner_text() or "").strip()
            except PWError:
                continue
            if txt and LOAD_MORE.match(txt):
                try:
                    await b.click(timeout=2500)
                    return True
                except PWError:
                    return False
    except PWError:
        pass
    return False


# --------------------------------------------------------------- extractors --

async def jsonld_blobs(page):
    try:
        raw = await page.eval_on_selector_all(
            "script[type='application/ld+json']",
            "els => els.map(e => e.textContent)")
    except PWError:
        return []
    out = []
    for txt in raw or []:
        if not txt:
            continue
        try:
            out.append(json.loads(txt))
        except ValueError:
            # some shops emit several objects back to back
            for chunk in re.findall(r"\{.*?\}(?=\s*[\{\[]|\s*$)", txt, re.S)[:20]:
                try:
                    out.append(json.loads(chunk))
                except ValueError:
                    pass
    return out


DOM_SWEEP_JS = r"""
(patterns) => {
  const PROD = new RegExp(patterns.product, 'i');
  const SKIP = new RegExp(patterns.skip, 'i');
  const MONEY = /(?:[$£€¥]\s?\d[\d.,]*)|(?:\d[\d.,]*\s?(?:USD|AUD|CAD|GBP|EUR))/;
  const pickImg = (root) => {
    const img = root.querySelector('img');
    if (img) {
      const ss = img.getAttribute('srcset') || img.getAttribute('data-srcset');
      if (ss) {
        const first = ss.split(',').pop().trim().split(/\s+/)[0];
        if (first) return first;
      }
      for (const a of ['src','data-src','data-original','data-lazy','data-image']) {
        const v = img.getAttribute(a);
        if (v && !/^data:/.test(v)) return v;
      }
    }
    const src = root.querySelector('source[srcset]');
    if (src) return src.getAttribute('srcset').split(',')[0].trim().split(/\s+/)[0];
    const bg = [...root.querySelectorAll('*')].slice(0, 40)
      .map(e => e.style && e.style.backgroundImage).find(v => v && v.includes('url('));
    return bg ? bg.slice(bg.indexOf('url(') + 4).replace(/^['"]|['"]\)?$/g, '') : null;
  };
  // A women's listing page also carries "you may also like", "recently viewed"
  // and footer modules full of MEN's products. Hoovering up every product link
  // and stamping the page's gender on all of them is how a men's shirt ends up
  // tagged womenswear, so anything inside one of these is skipped.
  const OFFGRID = new RegExp([
    'recommend', 'related', 'you-?may', 'also-?like', 'also-?bought',
    'complete-the-look', 'pairs-?with', 'recently-?viewed', 'cross-?sell',
    'up-?sell', 'carousel', 'slider', 'swiper', 'marquee', 'footer', 'header',
    'menu', 'popular', 'trending', 'bestsell', 'shop-the-look', 'styled-?with'
  ].join('|'), 'i');
  const offGrid = (el) => {
    for (let n = el, d = 0; n && d < 12; n = n.parentElement, d++) {
      if (n.nodeType !== 1) continue;
      const id = (n.getAttribute('id') || '') + ' ' +
                 (typeof n.className === 'string' ? n.className : '') + ' ' +
                 (n.getAttribute('data-section-type') || '') + ' ' +
                 (n.getAttribute('aria-label') || '');
      if (OFFGRID.test(id)) return true;
      if (n.tagName === 'FOOTER' || n.tagName === 'HEADER' || n.tagName === 'NAV')
        return true;
    }
    return false;
  };

  const out = [], seen = new Set();
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') || '';
    if (!PROD.test(href) || SKIP.test(href)) continue;
    if (seen.has(href)) continue;
    if (offGrid(a)) continue;
    // climb until we find the card: something with a picture and a price
    let card = a, img = null, depth = 0;
    while (card && depth < 6) {
      img = pickImg(card);
      if (img && MONEY.test(card.innerText || '')) break;
      card = card.parentElement; depth++;
    }
    if (!card || !img) continue;
    const text = (card.innerText || '').trim();
    const m = text.match(MONEY);
    // Collect every plausible name rather than trusting one selector. Grids put
    // a "Bestseller" badge and a "MEN, XS-XL" size range inside the same anchor
    // as the title, so the first line of link text is often not the product.
    // Python picks the best of these; see pick_name().
    const names = [];
    const push = (v) => {
      if (!v) return;
      v = ('' + v).replace(/\s+/g, ' ').trim();
      if (v.length >= 3 && v.length <= 180) names.push(v);
    };
    for (const sel of ['[class*="name" i]', '[class*="title" i]',
                       '[data-testid*="name" i]', 'h2', 'h3', 'h4']) {
      const el = card.querySelector(sel);
      if (el) push((el.innerText || '').split('\n')[0]);
    }
    const im = card.querySelector('img');
    if (im) push(im.getAttribute('alt'));
    push(a.getAttribute('aria-label'));
    push(im && im.getAttribute('title'));
    (a.innerText || '').split('\n').forEach(push);
    if (!names.length) continue;
    seen.add(href);
    out.push({ names: names, u: href, img: img, priceText: m ? m[0] : null });
    if (out.length > 400) break;
  }
  return out;
}
"""


# Text that sits in a product card but is not the product's name: promo badges,
# the size range, a colour count, a review score.
JUNK_NAME = re.compile(
    r"^(best ?sellers?|new|new in|new arrivals?|sale|limited|limited edition|"
    r"online (only|exclusive)|exclusive|sold ?out|coming soon|restocked?|"
    r"back in stock|shop now|quick (add|view|shop)|add to (bag|cart)|"
    r"free shipping|more colou?rs|\d+ colou?rs?|unisex|sustainable|"
    r"(men|women|kids?|baby|girls?|boys?)('s)?)$", re.I)
# "MEN, XS-XL" / "XS - XXL" / "S/M/L" — a size run, not a name
SIZE_RUN = re.compile(
    r"(XXS|XS|S|M|L|XL|XXL|XXXL|\d?XL)\s*[-–/]\s*(XXS|XS|S|M|L|XL|XXL|XXXL|\d?XL)"
    r"|^\s*(men|women|kids?|baby)\s*[,:]", re.I)


def looks_like_junk_name(name):
    n = (name or "").strip()
    if len(n) < 3 or len(n) > 180:
        return True
    if JUNK_NAME.match(n) or SIZE_RUN.search(n):
        return True
    if MONEY.search(n):
        return True
    if not re.search(r"[A-Za-z]{3}", n):        # numbers, symbols, size codes
        return True
    return False


def pick_name(candidates):
    """Best product name out of everything the card offered.

    Prefers a real phrase — several words, some length — over a one-word badge,
    and skips anything that reads as a size run or a promo label.
    """
    good = [c for c in (candidates or []) if not looks_like_junk_name(c)]
    if not good:
        return None
    # a two-word name beats a one-word one; beyond that, longer is more specific,
    # but cap the reward so a whole paragraph doesn't win
    def score(c):
        words = len(c.split())
        return (min(words, 8), -abs(len(c) - 45))
    return max(good, key=score)


async def dom_sweep(page, base):
    try:
        rows = await page.evaluate(DOM_SWEEP_JS, {
            "product": PRODUCT_HREF.pattern, "skip": NOT_PRODUCT_HREF.pattern})
    except PWError:
        return []
    out = []
    for r in rows or []:
        price, sym = parse_money(r.get("priceText"))
        name = pick_name(r.get("names"))
        out.append({
            "n": name or "",
            "u": (absolutise(r["u"], base) or "").split("?")[0],
            "img": (absolutise(r["img"], base) or "").split("?")[0],
            "price": price, "sym": sym or "$",
            "brand": None, "desc": "", "ld_gender": "",
            "color": "", "material": "", "via": "dom",
        })
    return [r for r in out if r["u"] and r["img"]]


class JSONCapture(object):
    """Everything JSON the page fetched while we were watching.

    Single page apps ask their own API for the grid, so this is often the only
    place the full product list exists in one piece.
    """

    def __init__(self, limit=60):
        self.blobs = []
        self.limit = limit

    def attach(self, page):
        page.on("response", self._on)

    async def _on(self, resp):
        if len(self.blobs) >= self.limit:
            return
        try:
            ctype = (resp.headers or {}).get("content-type", "")
            if "json" not in ctype.lower():
                return
            if resp.request.resource_type not in ("xhr", "fetch", "document"):
                return
            body = await resp.body()
            if not body or len(body) < 200 or len(body) > 6_000_000:
                return
            self.blobs.append(json.loads(body.decode("utf-8", "replace")))
        except Exception:
            return                       # a dead response is not worth a trace


# ------------------------------------------------------------ product pages --

PDP_JS = r"""
() => {
  const meta = (sel, attr) => {
    const el = document.querySelector(sel);
    return el ? (el.getAttribute(attr || 'content') || '').trim() : '';
  };
  const crumbs = [];
  const cselectors = [
    'nav[aria-label*="readcrumb" i]', '[class*="breadcrumb" i]',
    '[data-testid*="breadcrumb" i]', 'ol[itemtype*="BreadcrumbList"]'
  ];
  for (const s of cselectors) {
    const el = document.querySelector(s);
    if (el && el.innerText) { crumbs.push(el.innerText.replace(/\s*\n\s*/g, ' / ')); break; }
  }
  // the prose: prefer a real description container, fall back to meta tags
  let desc = '';
  const dsel = ['[class*="product-description" i]', '[class*="productDescription" i]',
                '[data-testid*="description" i]', '[id*="description" i]',
                '[class*="pdp-description" i]', '[class*="details" i][class*="product" i]',
                'section[aria-label*="escription" i]'];
  for (const s of dsel) {
    const el = document.querySelector(s);
    if (el && el.innerText && el.innerText.trim().length > 40) {
      desc = el.innerText.trim(); break;
    }
  }
  if (!desc) desc = meta('meta[name="description"]') || meta('meta[property="og:description"]');
  const h1 = document.querySelector('h1');
  return {
    crumbs: crumbs.join(' / ').slice(0, 400),
    desc: (desc || '').replace(/\s+/g, ' ').slice(0, 3000),
    title: h1 ? (h1.innerText || '').trim().slice(0, 200) : '',
    ogTitle: meta('meta[property="og:title"]'),
    ogImage: meta('meta[property="og:image"]'),
    // some shops state it outright in a meta tag
    metaGender: meta('meta[property="product:gender"]') ||
                meta('meta[name="gender"]') ||
                meta('meta[property="og:gender"]'),
    metaPrice: meta('meta[property="product:price:amount"]') ||
               meta('meta[property="og:price:amount"]') ||
               meta('meta[itemprop="price"]', 'content') ||
               meta('[itemprop="price"]', 'content'),
    metaCurrency: meta('meta[property="product:price:currency"]') ||
                  meta('meta[property="og:price:currency"]'),
    // last resort: the first price-shaped string near the buy button
    domPrice: (() => {
      const sel = ['[class*="price" i]', '[data-testid*="price" i]',
                   '[id*="price" i]'];
      for (const s of sel) {
        for (const el of [...document.querySelectorAll(s)].slice(0, 8)) {
          const t = (el.innerText || '').trim();
          if (/[$£€¥]\s?\d/.test(t)) return t.slice(0, 60);
        }
      }
      return '';
    })()
  };
}
"""


async def read_pdp(ctx, url):
    """Open one product page for its description, crumbs and stated gender."""
    page = await ctx.new_page()
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=PDP_TIMEOUT)
        await page.wait_for_timeout(700)
        info = await page.evaluate(PDP_JS)
        ld = await jsonld_blobs(page)
        ld_gender, ld_desc, ld_brand = "", "", ""
        price = sym = None
        for blob in ld:
            for node in _iter_nodes(blob):
                if "product" not in str(node.get("@type", "")).lower():
                    continue
                ld_gender = ld_gender or _s(node.get("gender")) or _s(
                    node.get("suggestedGender"))
                aud = node.get("audience")
                if isinstance(aud, dict):
                    ld_gender = ld_gender or _s(aud.get("suggestedGender"))
                ld_desc = ld_desc or _s(node.get("description"))
                ld_brand = ld_brand or _s(node.get("brand"))
                if price is None:
                    price, sym = _deep_price(node)

        # a listing card without a price is common; the product page always has
        # one somewhere, so recover it rather than throwing the piece away
        if price is None and info.get("metaPrice"):
            price = _to_float(str(info["metaPrice"]))
            sym = CUR_SYMBOL.get((info.get("metaCurrency") or "").upper(), "$")
        if price is None and info.get("domPrice"):
            price, sym = parse_money(info["domPrice"])

        return {
            "desc": (ld_desc or info.get("desc") or "")[:3000],
            "crumbs": info.get("crumbs") or "",
            "ld_gender": ld_gender or info.get("metaGender") or "",
            "brand": ld_brand or "",
            "title": info.get("title") or info.get("ogTitle") or "",
            "img": info.get("ogImage") or "",
            "price": price, "sym": sym or "$",
        }
    except (PWError, asyncio.TimeoutError):
        return {}
    finally:
        try:
            await page.close()
        except PWError:
            pass


# ------------------------------------------------------------ normalisation --

def normalise(raw, site_brand, section, detail=None, brand_prior=None,
              max_price=None, drops=None):
    """Raw scrape -> a row shaped exactly like enrich.normalise() returns.

    Same field names, same taxonomy, same id scheme — which is what lets a
    browser-sourced product flow through scoring.py and inject.py untouched.

    `drops` is an optional Counter: pass one in and it records why each rejected
    candidate was rejected, which is the difference between "this shop yields 13
    of 240" and knowing that 190 of them were over the price cap.
    """
    def drop(reason):
        if drops is not None:
            drops[reason] += 1
        return None

    detail = detail or {}
    # A card's own text is often a badge or a size run. Where we opened the
    # product page, its <h1> is authoritative — use it whenever the listing name
    # doesn't read like a product.
    name = (raw.get("n") or "").strip()
    if looks_like_junk_name(name):
        better = (detail.get("title") or "").strip()
        name = better if better and not looks_like_junk_name(better) else ""
    url = raw.get("u")
    img = raw.get("img") or detail.get("img")
    if not name:
        return drop("no usable product name")
    if not url:
        return drop("no url")
    if not img:
        return drop("no image")

    price, sym = raw.get("price"), raw.get("sym") or "$"
    if price is None and detail.get("price") is not None:
        price, sym = detail["price"], detail.get("sym") or "$"
    if price is None:
        return drop("no price on the card")
    usd = to_usd(price, sym)
    if usd < 5:
        return drop("under $5")
    if max_price and usd > max_price:
        return drop("over the ${:.0f} cap".format(max_price))

    desc = (detail.get("desc") or raw.get("desc") or "")[:3000]
    crumbs = detail.get("crumbs") or ""
    brand = clean_brand(raw.get("brand") or detail.get("brand"), site_brand)

    # taxonomy: the title decides the category, but colour/fabric/micro-style get
    # the whole page, because that is where a shop actually says "washed olive
    # heavyweight cotton" rather than just "The Field Shirt".
    title_type = name
    if enrich.NOT_APPAREL.search(title_type):
        return drop("not apparel")
    haystack = " ".join([name, raw.get("color") or "", raw.get("material") or "",
                         desc[:1200], crumbs])

    cat = enrich.classify_cat(title_type)
    if cat == "acc":
        cat = enrich.classify_cat(haystack)

    g = gender_mod.classify(
        name=name, desc=desc, url=url, breadcrumbs=crumbs, section=section,
        ld_gender=raw.get("ld_gender") or detail.get("ld_gender"),
        brand_prior=brand_prior, cat=cat, brand=brand, img=img)

    row = {
        "b": brand,
        "n": name,
        "p": round(price, 2),
        "cur": sym,
        "usd": usd,
        "img": img,
        "u": url,
        "cat": cat,
        "ms": enrich.classify_ms(haystack, cat),
        "color": enrich.classify_color(haystack),
        "pat": enrich.classify_pat(haystack),
        "fab": enrich.classify_fab(haystack),
        "g": g["g"],
        "src": urlparse(url).netloc,
        "handle": url.rstrip("/").split("/")[-1][:120],
        # browser-only columns
        "descr": desc[:1200],
        "gconf": g["conf"],
        "gwhy": g["why"],
        # keep both the gender we associated with the row and how we came by it,
        # so --reclassify can reproduce this decision without re-crawling
        "section": section or brand_prior or "",
        "sect_src": "section" if section else ("prior" if brand_prior else ""),
        "via": raw.get("via") or "dom",
    }
    row["id"] = enrich.product_id(brand, name, url)
    return row


def merge_raw(*groups):
    """Combine the three extractors, best-quality record per URL wins."""
    rank = {"json": 3, "ld": 3, "dom": 1}
    best = {}
    for group in groups:
        for r in group:
            u = (r.get("u") or "").split("?")[0]
            if not u:
                continue
            cur = best.get(u)
            if cur is None:
                best[u] = r
                continue
            # prefer the record that actually has a price, then the richer source
            score = (1 if r.get("price") else 0, rank.get(r.get("via"), 0),
                     len(r.get("desc") or ""))
            cscore = (1 if cur.get("price") else 0, rank.get(cur.get("via"), 0),
                      len(cur.get("desc") or ""))
            if score > cscore:
                merged = dict(cur)
                merged.update({k: v for k, v in r.items() if v})
                best[u] = merged
            else:
                for k, v in r.items():
                    if v and not cur.get(k):
                        cur[k] = v
    return list(best.values())


# ------------------------------------------------------------------ crawler --

async def crawl_entry(ctx, url, section, site_brand, want, detail_mode,
                      detail_rate, max_price, brand_prior, verbose=False):
    """One gendered index page -> normalised rows."""
    rows = []
    raws, counts, note = [], (0, 0, 0), ""
    # One retry on an empty page. A listing that renders perfectly on its own and
    # returns nothing as the fourth page of a sweep is being rate-limited, not
    # broken, and backing off for a few seconds usually gets it back.
    for attempt in (1, 2):
        page = await ctx.new_page()
        cap = JSONCapture()
        cap.attach(page)
        try:
            try:
                resp = await page.goto(url, wait_until="domcontentloaded",
                                       timeout=NAV_TIMEOUT)
            except (PWError, asyncio.TimeoutError) as exc:
                note = "nav failed: {}".format(str(exc).split("\n")[0][:120])
                await page.close()
                if attempt == 1:
                    await asyncio.sleep(4)
                    continue
                return [], note
            # An explicit "slow down". Retrying is the wrong answer to it: stop
            # asking this shop anything else this sweep and pick up its
            # remaining pages next time round the rotation.
            if resp is not None and resp.status in (429, 503):
                await page.close()
                return [], RATE_LIMITED
            await page.wait_for_timeout(SETTLE_MS)
            await settle(page)
            await dismiss_consent(page)
            await autoscroll(page)

            base = page.url
            ld = []
            for blob in await jsonld_blobs(page):
                ld.extend(products_from_blob(blob, base))
            for r in ld:
                r["via"] = "ld"
            api = []
            for blob in cap.blobs:
                api.extend(products_from_blob(blob, base))
            dom = await dom_sweep(page, base)
            counts = (len(ld), len(api), len(dom))

            merged = merge_raw(ld, api, dom)
            # keep it to this shop — a listing page links out to editorial, to
            # affiliates and to other retailers' size charts
            home = registrable(base)
            raws = [r for r in merged if registrable(r["u"]) == home]
        finally:
            try:
                await page.close()
            except PWError:
                pass
        if raws or attempt == 2:
            break
        if verbose:
            log("    empty — backing off and retrying once")
        await asyncio.sleep(random.uniform(4, 7))

    if verbose:
        log("    ld={} api={} dom={} -> {} unique".format(
            counts[0], counts[1], counts[2], len(raws)))
    if not raws:
        return [], note or "no products found on the page"

    # Take the *complete* records first. Merging leaves plenty of URLs that came
    # only from an API blob with no price in it, and truncating at random before
    # checking that threw away good rows to keep useless ones.
    random.shuffle(raws)
    raws.sort(key=lambda r: (not looks_like_junk_name(r.get("n")),
                             bool(r.get("price")), bool(r.get("img")),
                             bool(r.get("desc"))), reverse=True)
    raws = raws[:want]

    # Which of these deserve a product-page visit. A PDP costs a page load, so
    # `auto` spends them where they change the answer:
    #   - the piece's own name argues with the section it was filed under. One
    #     of the two is wrong and the description is the tie-breaker.
    #   - we have no section at all and nothing in the name to go on, so the
    #     description is the only gender evidence available.
    #   - the listing card had no price on it, which the product page will have.
    # Everything else gets sampled, because a description also sharpens colour,
    # fabric and micro-style, not just gender.
    need_detail, sampled = [], []
    for r in raws:
        if detail_mode == "none":
            continue
        if detail_mode == "all":
            need_detail.append(r)
            continue
        lock = gender_mod.frontend_lock(r.get("n") or "")
        conflicted = section is not None and lock is not None and lock != section
        # "blind" means nothing at all points at a gender. A brand that only
        # sells one doesn't count as blind — the tiebreak in gender.classify
        # covers it — otherwise every product on a single-gender shop would earn
        # a page visit it doesn't need.
        blind = section is None and lock is None and brand_prior not in ("m", "f")
        if (conflicted or blind or not r.get("price")
                or looks_like_junk_name(r.get("n"))):
            need_detail.append(r)
        elif not r.get("desc"):
            sampled.append(r)
    random.shuffle(sampled)
    need_detail.extend(sampled[:int(len(raws) * detail_rate)])

    details = {}
    for r in need_detail[:want]:
        d = await read_pdp(ctx, r["u"])
        if d:
            details[r["u"]] = d
        await asyncio.sleep(random.uniform(0.25, 0.6))

    drops = Counter()
    for r in raws:
        row = normalise(r, site_brand, section, details.get(r["u"]),
                        brand_prior, max_price, drops)
        if row:
            rows.append(row)
    if verbose and drops:
        log("    dropped {}: {}".format(
            sum(drops.values()),
            ", ".join("{} {}".format(v, k) for k, v in drops.most_common(4))))
    return rows, note


async def crawl_site(ctx, site, per_entry, detail_mode, detail_rate, max_price,
                     verbose=False, entries_per_visit=ENTRIES_PER_VISIT):
    brand = site["brand"]
    # Entry points found by reading a shop's own "Womenswear" nav are evidence.
    # Entry points we assigned from the brand's historical skew are a guess, and
    # get passed as a prior — worth 0.8 against a section's 5.0 — so a piece can
    # still be talked out of it by its own description.
    guessed = site.get("gender_source") == "prior"
    got, notes = [], []

    # Take a slice of this shop's entry points, starting where the last visit
    # stopped. A shop with six listing pages gets fully covered over three
    # sweeps rather than being hammered once and blocked.
    all_entries = site_registry.entries(site)
    n = max(1, entries_per_visit or len(all_entries))
    cursor = int(site.get("entry_cursor") or 0) % max(1, len(all_entries))
    todo = [all_entries[(cursor + i) % len(all_entries)]
            for i in range(min(n, len(all_entries)))]
    site["entry_cursor"] = (cursor + len(todo)) % max(1, len(all_entries))

    for url, section in todo:
        if verbose:
            log("  {} [{}{}] {}".format(brand, section,
                                        "?" if guessed else "", url))
        try:
            rows, note = await crawl_entry(
                ctx, url, None if guessed else section, brand, per_entry,
                detail_mode, detail_rate, max_price,
                brand_prior=section if guessed else None, verbose=verbose)
        except Exception as exc:                       # never kill the run
            rows, note = [], "{}: {}".format(type(exc).__name__, exc)[:140]
        if note:
            notes.append(note)
        got.extend(rows)
        if verbose:
            log("    -> {} rows  {}".format(len(rows), note))
        if note == RATE_LIMITED:
            # rewind so the page we were refused is the first one we try next
            site["entry_cursor"] = all_entries.index((url, section))
            break
        # Several seconds between listing pages of the same shop. Everlane's
        # third page came back empty at ~1s apart and rendered fine at this
        # pace, so this is buying data, not just being polite.
        await asyncio.sleep(random.uniform(3.0, 6.0))
    # de-dupe across this shop's entry points
    seen, out = set(), []
    for r in got:
        if r["id"] in seen:
            continue
        seen.add(r["id"])
        out.append(r)
    return out, "; ".join(notes)[:200]


async def run(args):
    db.init()
    db.migrate()
    registry = site_registry.load()

    if args.brand:
        wanted = [s for b, s in registry.items()
                  if args.brand.lower() in b.lower()]
        if not wanted:
            sys.exit("no shop matching {!r} in sites.json".format(args.brand))
    else:
        wanted = site_registry.live_sites(registry)
        if args.shops:
            # continue round the registry from where the last run stopped, on
            # the same cursor the bot's sweeps use — five capped runs cover five
            # different slices instead of the same alphabetical one five times
            wanted = _next_shops(registry, args.shops)
    if args.shops:
        wanted = wanted[:args.shops]

    log("{} shops, {} entry points  (detail={}, max ${})".format(
        len(wanted), sum(len(site_registry.entries(s)) for s in wanted),
        args.detail, args.max_price))

    known = db.known_ids()
    totals = defaultdict(int)
    t0 = time.time()

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=not args.headful)
        try:
            for site in wanted:
                ctx = await make_context(browser, block_css=args.block_css)
                started = time.time()
                try:
                    rows, note = await crawl_site(
                        ctx, site, args.per_entry, args.detail,
                        args.detail_rate, args.max_price, args.verbose,
                        args.entries_per_visit)
                finally:
                    await ctx.close()

                fresh = [r for r in rows if r["id"] not in known]
                for r in fresh:
                    known.add(r["id"])
                added = 0
                if fresh and not args.dry_run:
                    added, _ = db.upsert_many(fresh, in_app=0)
                    db.log_run(site["host"], len(rows), added, started,
                               note or "browser")
                gsum = gender_mod.summarise(fresh)
                totals["rows"] += len(rows)
                totals["added"] += added if not args.dry_run else len(fresh)
                for k in ("f", "m", "u"):
                    totals[k] += gsum.get(k, 0)

                ok = len(rows) > 0
                site_registry.record_health(registry, site["brand"], ok,
                                            len(rows), note)
                log("{:<22} {:>4} found  {:>4} new   m={:<4} f={:<4} u={:<4} {}"
                    .format(site["brand"][:22], len(rows), len(fresh),
                            gsum.get("m", 0), gsum.get("f", 0), gsum.get("u", 0),
                            ("" if ok else "BLOCKED ") + (note[:40] if note else "")))
                site_registry.save(registry)
        finally:
            await browser.close()

    mins = (time.time() - t0) / 60
    log("\n{} products seen, {} new, in {:.0f}s".format(
        totals["rows"], totals["added"], time.time() - t0))
    log("  gender split of the new rows:  m={}  f={}  u={}".format(
        totals["m"], totals["f"], totals["u"]))
    ready = totals["added"]
    if not args.dry_run:
        s = db.stats()
        log("  pool now: {} bot rows across {} stores".format(
            s["bot_found"], s["stores"]))
        log("\n  Next:  python3 export.py --promote 200")
    if not args.no_notify:
        notify("Style Finder — crawl finished",
               "{} new products in {:.0f} min. Ready to export.".format(
                   ready, mins))


# ----------------------------------------------------------------- discover --
#
# Hand-written entry URLs rot: five of the first thirty shops here 404'd because
# a collection had been renamed. Shopify will tell us the real ones — every store
# publishes /collections.json — so for that half of the web the registry can
# build itself, and can be pointed at all 367 brands the app already sells
# rather than the couple of dozen anyone would type out by hand.

# Deliberately no "boys"/"girls" here: on a shop's own collection list those
# almost always mean the children's department, and a kids' section is the one
# thing this app must never ingest. They stay in gender.py, where they are read
# off a product's own description rather than a nav label.
MENS_COLL = re.compile(r"\b(mens?|for-?him|homme|herren|uomo)\b", re.I)
WOMENS_COLL = re.compile(r"\b(womens?|ladies|for-?her|femme|damen|donna)\b", re.I)

KIDS_COLL = re.compile(
    r"\b(kids?|child|childs|children|childrens|boys?|girls?|baby|babies|"
    r"toddler|infant|junior|juniors|youth|teen|tween|mini|little)\b", re.I)

# Collections that exist but aren't a section of the shop — a sale event, a
# gift edit, the archive. Crawling these gets us the same products filed under
# a worse name, or products that no longer exist.
# Note the [-\s]? throughout: handles arrive hyphenated ("black-friday") and
# titles arrive spaced ("Black Friday"), and both are searched.
SKIP_COLL = re.compile(
    r"\b(sale|sales|archive|archives|gift|gifts|gifting|voucher|final|"
    r"clearance|outlet|markdown|discount|cyber|bfcm|bundle|bundles|sample|"
    r"samples|preorder|waitlist|restock|lookbook|editorial|journal|blog|"
    r"valentine\w*|christmas|easter)\b"
    r"|\bgift[-\s]?cards?\b|\blast[-\s]?chance\b|\bblack[-\s]?friday\b"
    r"|\bpre[-\s]?order\b|\bholiday[-\s]?(deals?|looks?|edit)\b"
    r"|\b(inter)?national[-\s]?\w+[-\s]?day\b|\b(mothers?|fathers?)[-\s]?day\b"
    r"|\bunder[-\s]?\d+|\b\d+[-\s]?off\b|\b\d+%", re.I)

# The main department page, which is what we actually want to crawl.
MAIN_COLL = re.compile(
    r"^(all-)?(mens?|womens?)(wear|-clothing|-all|-shop)?$|"
    r"^(shop-|all-)?(mens?|womens?)$", re.I)


def shopify_collections(host, timeout=12):
    """[(handle, title, count)] or [] if the shop isn't Shopify / says no."""
    import urllib.error
    import urllib.request
    url = "https://{}/collections.json?limit=250".format(host)
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8", "replace"))
    except Exception:
        return []
    out = []
    for c in (data.get("collections") or []):
        h, t = c.get("handle") or "", c.get("title") or ""
        if h:
            out.append((h, t, int(c.get("products_count") or 0)))
    return out


def gendered_entries(host, collections, per_gender=3, prior=None):
    """Pick the men's and women's collections worth crawling.

    -> ({'m': [urls], 'f': [urls]}, source) where source is 'collection' when
    the shop labelled the section itself, or 'prior' when it is a single-gender
    label with no gendered collections and we fell back to what the catalog
    already knows about the brand. The caller treats those two very differently:
    a labelled section is evidence, a brand prior is a hint.
    """
    picks = {"m": [], "f": []}
    scored = {"m": [], "f": []}
    generic = []
    for handle, title, count in collections:
        blob = "{} {}".format(handle.replace("-", " "), title)
        if KIDS_COLL.search(blob) or SKIP_COLL.search(blob):
            continue
        w, m = bool(WOMENS_COLL.search(blob)), bool(MENS_COLL.search(blob))
        if w == m:                          # neither, or a "his & hers" edit
            if not (w and m):
                generic.append((count, handle))
            continue
        # a shop's main department page beats its "mens-limited-shirts" edit
        rank = 1 if MAIN_COLL.match(handle) else 0
        scored["f" if w else "m"].append((rank, count, handle))

    for g in ("m", "f"):
        for _, _, handle in sorted(scored[g], reverse=True)[:per_gender]:
            picks[g].append("https://{}/collections/{}".format(host, handle))

    if picks["m"] or picks["f"]:
        return picks, "collection"

    # Single-gender DTC labels often have no "womens" collection because
    # everything is womens. Use the brand's known skew and say that's what we
    # did, so the crawler can weight it as the guess it is.
    if prior in ("m", "f") and generic:
        for _, handle in sorted(generic, reverse=True)[:per_gender]:
            picks[prior].append(
                "https://{}/collections/{}".format(host, handle))
        return picks, "prior"
    return picks, "none"


def discover(from_catalog=False, per_gender=3, workers=12, limit=0):
    """Fill in gendered entry points for every Shopify shop we know about."""
    registry = site_registry.load()
    hosts = {}                                    # host -> (brand, gender_prior)
    for brand, site in registry.items():
        hosts[site["host"]] = (brand, None)
    import stores as feed_registry
    feed = feed_registry.load_registry()
    priors = {meta["domain"]: meta.get("gender_prior") for meta in feed.values()}
    for host, (brand, _) in list(hosts.items()):
        hosts[host] = (brand, priors.get(host))
    if from_catalog:
        for brand, meta in feed.items():
            hosts.setdefault(meta["domain"], (brand, meta.get("gender_prior")))

    items = sorted(hosts.items())
    if limit:
        items = items[:limit]
    log("asking {} shops for their collection list…".format(len(items)))

    from concurrent.futures import ThreadPoolExecutor, as_completed
    found = updated = added = by_prior = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futs = {pool.submit(shopify_collections, host): (host, brand, prior)
                for host, (brand, prior) in items}
        for fut in as_completed(futs):
            host, brand, prior = futs[fut]
            try:
                colls = fut.result()
            except Exception:
                colls = []
            if not colls:
                continue
            picks, source = gendered_entries(host, colls, per_gender, prior)
            if source == "none":
                continue
            found += 1
            if source == "prior":
                by_prior += 1
            site = registry.get(brand)
            if site is None:
                site = site_registry.S(brand, host, picks["m"], picks["f"],
                                       "auto-discovered")
                registry[brand] = site
                added += 1
            else:
                # replace only what discovery actually found, so a hand-written
                # non-Shopify entry point is never clobbered by an empty result
                changed = False
                for g in ("m", "f"):
                    if picks[g] and picks[g] != site["entries"].get(g):
                        site["entries"][g] = picks[g]
                        changed = True
                # a shop marked blocked was often just a renamed collection.
                # New URLs, clean slate — otherwise the fix never gets tried.
                if changed:
                    site.pop("health", None)
                updated += 1
            site["gender_source"] = source
    site_registry.save(registry)
    log("{} shops answered, {} new, {} refreshed  ({} gendered by brand skew "
        "rather than a labelled section)".format(found, added, updated, by_prior))
    log("registry now: {} shops, {} gendered entry points".format(
        len(registry),
        sum(len(site_registry.entries(s)) for s in registry.values())))


# ------------------------------------------------- the always-on bot's hook --
#
# bot.py runs a Shopify sweep on a timer. These give it a browser sweep on the
# same pattern: pick up where the last one stopped, crawl a couple of shops,
# write what's new, return. Deliberately small — a browser sweep costs seconds
# per page, so the bot takes a few shops at a time, forever, rather than the lot.

ROTATION_KEY = "browse_cursor"


def _next_shops(registry, n):
    """The next n shops in a rotation that survives a restart."""
    live = site_registry.live_sites(registry)
    if not live:
        return []
    cursor = int(db.get_meta(ROTATION_KEY, 0) or 0)
    picked = [live[(cursor + i) % len(live)] for i in range(min(n, len(live)))]
    db.set_meta(ROTATION_KEY, (cursor + len(picked)) % len(live))
    return picked


async def sweep_async(n_shops=2, per_entry=40, detail="auto", detail_rate=0.35,
                      max_price=None, headless=True):
    """One browser sweep. -> {'added', 'seen', 'shops', 'm', 'f', 'u'}"""
    db.init()
    registry = site_registry.load()
    shops = _next_shops(registry, n_shops)
    if not shops:
        return {"added": 0, "seen": 0, "shops": [], "m": 0, "f": 0, "u": 0}

    max_price = enrich.MAX_PRICE if max_price is None else max_price
    known = db.known_ids()
    out = {"added": 0, "seen": 0, "shops": [], "m": 0, "f": 0, "u": 0}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=headless)
        try:
            for site in shops:
                ctx = await make_context(browser)
                started = time.time()
                try:
                    rows, note = await crawl_site(ctx, site, per_entry, detail,
                                                  detail_rate, max_price)
                except Exception as exc:
                    rows, note = [], "{}: {}".format(type(exc).__name__, exc)[:140]
                finally:
                    await ctx.close()
                fresh = [r for r in rows if r["id"] not in known]
                for r in fresh:
                    known.add(r["id"])
                added, _ = db.upsert_many(fresh, in_app=0)
                if rows:
                    db.log_run(site["host"], len(rows), added, started,
                               "browser sweep")
                gsum = gender_mod.summarise(fresh)
                out["added"] += added
                out["seen"] += len(rows)
                out["shops"].append(site["brand"])
                for k in ("m", "f", "u"):
                    out[k] += gsum.get(k, 0)
                site_registry.record_health(registry, site["brand"],
                                            len(rows) > 0, len(rows), note)
        finally:
            await browser.close()
    site_registry.save(registry)
    return out


def sweep(**kw):
    """Blocking wrapper — bot.py calls this from its own thread."""
    return asyncio.run(sweep_async(**kw))


# -------------------------------------------------------------- reclassify --

def reclassify(dry_run=False):
    """Re-run the gender model over rows already in the database.

    Everything the classifier reads — name, url, brand, image, description, the
    section it was found in — is stored on the row, so improving gender.py does
    not mean re-crawling the web. Only browser-sourced rows are touched; the feed
    harvester's rows never had this evidence to begin with.
    """
    db.init()
    c = db.conn()
    rows = [db.decode(r) for r in c.execute(
        "SELECT * FROM products WHERE via IS NOT NULL AND via != 'feed'")]
    if not rows:
        log("no browser-sourced rows to reclassify")
        return

    # Rows written before `sect_src` existed have no record of the brand skew
    # they were crawled under. The registry still knows, so fall back to it
    # rather than silently demoting a menswear-only label's stock to unisex.
    priors = {}
    for brand, site in site_registry.load().items():
        if site.get("gender_source") != "prior":
            continue
        for g in ("m", "f"):
            if site["entries"].get(g):
                priors[brand] = g
                break

    changed, moves = [], Counter()
    for r in rows:
        # `section` holds a gender either way; `sect_src` says whether it was the
        # shop's own label (evidence) or the brand's skew (a tiebreak)
        sect = r.get("section") or None
        prior_only = (r.get("sect_src") or "") == "prior"
        if sect is None and r.get("b") in priors:
            sect, prior_only = priors[r["b"]], True
        verdict = gender_mod.classify(
            name=r.get("n") or "", desc=r.get("descr") or "",
            url=r.get("u") or "", section=None if prior_only else sect,
            brand_prior=sect if prior_only else None,
            cat=r.get("cat"), brand=r.get("b") or "",
            img=r.get("img") or "")
        if verdict["g"] != r.get("g"):
            moves["{} -> {}".format(r.get("g"), verdict["g"])] += 1
            changed.append((verdict["g"], verdict["conf"], verdict["why"], r["id"]))

    log("{} browser rows, {} would change".format(len(rows), len(changed)))
    for move, n in moves.most_common():
        log("  {:<10} {}".format(move, n))
    if dry_run:
        log("dry run — nothing written")
        return
    if changed:
        c.executemany("UPDATE products SET g=?, gconf=?, gwhy=? WHERE id=?",
                      changed)
        c.commit()
        log("updated {} rows".format(len(changed)))


# -------------------------------------------------------------------- audit --

def audit(limit=12):
    """What the browser actually bought us, measured rather than asserted.

    The interesting number is the disagreement rate: how often the old
    title-only classifier lands on a different gender than the section the piece
    was literally filed under on the shop's own site. Every one of those is a
    product the feed harvester would have put in the wrong deck.
    """
    db.init()
    c = db.conn()
    rows = [db.decode(r) for r in c.execute(
        "SELECT * FROM products WHERE via IS NOT NULL AND via != 'feed'")]
    if not rows:
        log("no browser-sourced rows yet — run: python3 browse.py --crawl")
        return

    log("browser-sourced rows: {}".format(len(rows)))
    by_via = defaultdict(int)
    by_g = defaultdict(int)
    with_desc = 0
    for r in rows:
        by_via[r.get("via")] += 1
        by_g[r.get("g")] += 1
        if (r.get("descr") or "").strip():
            with_desc += 1
    log("  extracted via:      {}".format(dict(by_via)))
    log("  gender verdicts:    {}".format(dict(by_g)))
    log("  carry a description: {} ({:.0%})".format(
        with_desc, with_desc / len(rows)))

    # the comparison that matters
    graded = [r for r in rows if r.get("section") in ("m", "f")]
    old_wrong = old_unknown = new_wrong = 0
    misses = []
    for r in graded:
        truth = r["section"]
        old = enrich.classify_gender(r["n"] or "", None)
        if old == "u":
            old_unknown += 1
        elif old != truth:
            old_wrong += 1
            if len(misses) < limit:
                misses.append((r["n"], truth, old, r.get("g"), r.get("gwhy")))
        if r.get("g") != truth and r.get("g") != "u":
            new_wrong += 1

    if graded:
        log("\ngraded against the shop's own section ({} rows):".format(len(graded)))
        log("  title-only classifier  wrong {:>5} ({:.1%})   no opinion {:>5} ({:.1%})"
            .format(old_wrong, old_wrong / len(graded),
                    old_unknown, old_unknown / len(graded)))
        log("  browser classifier     wrong {:>5} ({:.1%})   no opinion {:>5} ({:.1%})"
            .format(new_wrong, new_wrong / len(graded),
                    by_g.get("u", 0), by_g.get("u", 0) / len(rows)))
        if misses:
            log("\n  pieces the old way would have mis-filed:")
            for n, truth, old, new, why in misses:
                log("    {:<48} shop says {}  title said {}  -> {}  ({})".format(
                    n[:48], truth, old, new, (why or "")[:38]))

    # Price sanity. A unit bug (cents read as dollars) doesn't look like an
    # error, it looks like a bargain — and a bargain walks straight past the
    # price cap into the deck. Anything priced far under its own brand's normal
    # range is worth a look.
    by_brand = defaultdict(list)
    for r in rows:
        if r.get("usd"):
            by_brand[r["b"]].append(r)
    suspicious = []
    for brand, items in by_brand.items():
        if len(items) < 4:
            continue
        prices = sorted(i["usd"] for i in items)
        median = prices[len(prices) // 2]
        if median < 40:
            continue
        for i in items:
            if i["usd"] * 20 < median:
                suspicious.append((i["n"], i["usd"], median, brand, i.get("via")))
    if suspicious:
        log("\n  [!] priced far below their brand's normal range — check the units:")
        for n, usd, median, brand, via in suspicious[:8]:
            log("    {:<44} ${:<9} brand median ${:<7} via={}".format(
                n[:44], usd, median, via))
    else:
        log("\n  price sanity: nothing priced absurdly below its brand's range")

    log("\nsample rows:")
    for r in rows[:limit]:
        log("  [{}] {:<9} ${:<7} {:<40} {} conf={:.2f}  {}".format(
            r.get("g"), r.get("cat"), r.get("usd"), (r.get("n") or "")[:40],
            (r.get("b") or "")[:14], r.get("gconf") or 0,
            (r.get("gwhy") or "")[:34]))


async def probe(args):
    """Load one page per shop and report what came back. No writes."""
    registry = site_registry.load()
    sites_ = list(registry.values())
    if args.brand:
        sites_ = [s for s in sites_ if args.brand.lower() in s["brand"].lower()]
    log("probing {} shops…\n".format(len(sites_)))
    log("{:<22} {:>6} {:>6} {:>6} {:>7}  {}".format(
        "shop", "ld", "api", "dom", "usable", "note"))
    log("-" * 78)

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=not args.headful)
        try:
            for site in sites_:
                ents = site_registry.entries(site)
                if not ents:
                    continue
                url, section = ents[0]
                ctx = await make_context(browser, block_css=args.block_css)
                page = await ctx.new_page()
                cap = JSONCapture()
                cap.attach(page)
                nld = napi = ndom = nuse = 0
                note = ""
                try:
                    await page.goto(url, wait_until="domcontentloaded",
                                    timeout=NAV_TIMEOUT)
                    await page.wait_for_timeout(SETTLE_MS)
                    await dismiss_consent(page)
                    await autoscroll(page, rounds=3)
                    base = page.url
                    ld = []
                    for blob in await jsonld_blobs(page):
                        ld.extend(products_from_blob(blob, base))
                    for r in ld:
                        r["via"] = "ld"
                    api = []
                    for blob in cap.blobs:
                        api.extend(products_from_blob(blob, base))
                    dom = await dom_sweep(page, base)
                    nld, napi, ndom = len(ld), len(api), len(dom)
                    merged = merge_raw(ld, api, dom)
                    drops = Counter()
                    usable = [normalise(r, site["brand"], section, None, None,
                                        args.max_price, drops) for r in merged]
                    usable = [u for u in usable if u]
                    nuse = len(usable)
                    if drops:
                        note = "dropped: " + ", ".join(
                            "{} {}".format(v, k)
                            for k, v in drops.most_common(3))
                    if nuse == 0 and not merged:
                        title = (await page.title() or "")[:60]
                        note = "nothing usable — page title: {!r}".format(title)
                except Exception as exc:
                    note = "{}: {}".format(type(exc).__name__,
                                           str(exc).split("\n")[0])[:70]
                finally:
                    await ctx.close()

                site_registry.record_health(registry, site["brand"], nuse > 0,
                                            nuse, note)
                log("{:<22} {:>6} {:>6} {:>6} {:>7}  {}".format(
                    site["brand"][:22], nld, napi, ndom, nuse, note))
        finally:
            await browser.close()
    site_registry.save(registry)
    ok = sum(1 for s in registry.values()
             if (s.get("health") or {}).get("status") == "ok")
    log("\n{}/{} shops usable — written to sites.json".format(ok, len(registry)))


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--probe", action="store_true",
                    help="test each shop, record which ones work, write nothing")
    ap.add_argument("--crawl", action="store_true", help="crawl and store")
    ap.add_argument("--audit", action="store_true",
                    help="report on what the browser has collected so far")
    ap.add_argument("--reclassify", action="store_true",
                    help="re-run the gender model over stored rows; use after "
                         "changing gender.py, instead of re-crawling")
    ap.add_argument("--discover", action="store_true",
                    help="ask every Shopify shop for its real men's/women's "
                         "collection URLs and write them into sites.json")
    ap.add_argument("--from-catalog", action="store_true",
                    help="with --discover: include all brands from stores.json")
    ap.add_argument("--per-gender", type=int, default=3,
                    help="with --discover: entry points per gender per shop")
    ap.add_argument("--brand", help="only this shop (substring match)")
    ap.add_argument("--shops", type=int, default=0, help="cap shops per run")
    ap.add_argument("--per-entry", type=int, default=60,
                    help="max products per gendered index page")
    ap.add_argument("--limit", type=int, default=0,
                    help="alias for --per-entry * entries; soft cap per shop")
    ap.add_argument("--detail", choices=("auto", "all", "none"), default="auto",
                    help="visit product pages for their descriptions")
    ap.add_argument("--detail-rate", type=float, default=0.35,
                    help="in auto mode, fraction of products to open")
    ap.add_argument("--entries-per-visit", type=int, default=ENTRIES_PER_VISIT,
                    help="listing pages to take from one shop per visit; the "
                         "rest are picked up on the next sweep (0 = all)")
    ap.add_argument("--max-price", type=float, default=enrich.MAX_PRICE)
    ap.add_argument("--block-css", action="store_true",
                    help="faster, occasionally breaks a lazy grid")
    ap.add_argument("--headful", action="store_true", help="watch it work")
    ap.add_argument("--no-notify", action="store_true",
                    help="don't pop a notification when the crawl finishes")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--verbose", "-v", action="store_true")
    args = ap.parse_args()

    if args.limit:
        args.per_entry = max(10, args.limit)
    if args.discover:
        return discover(from_catalog=args.from_catalog,
                        per_gender=args.per_gender, limit=args.shops)
    if args.reclassify:
        return reclassify(dry_run=args.dry_run)
    if args.audit:
        return audit()
    if not (args.probe or args.crawl):
        args.crawl = True

    asyncio.run(probe(args) if args.probe else run(args))


if __name__ == "__main__":
    main()
