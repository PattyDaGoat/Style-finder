"""The browse-list: shops the headless crawler visits, and where to enter them.

`stores.py` derives its registry from brands already in the app, and reaches them
over Shopify's /products.json. That only ever finds more of what we already sell,
and it finds it genderless — the feed has no idea which section a piece sits in.

This registry is the opposite. Every entry names the shop's *gendered index
pages* directly, so a piece harvested from a men's listing is known menswear
before a single word of its title has been read. That is the whole reason for
driving a browser: these pages are React apps that render nothing useful in a
plain HTTP fetch, and they are where the gender lives.

`health` is written back by `browse.py --probe`, so a shop that starts blocking
us drops out of the rotation instead of burning a crawl slot every night.
"""

import json
import os
import time

HERE = os.path.dirname(os.path.abspath(__file__))
SITES_JSON = os.path.join(HERE, "sites.json")


def S(brand, host, m=(), f=(), note=""):
    return {"brand": brand, "host": host,
            "entries": {"m": list(m), "f": list(f)}, "note": note}


# Ordered roughly by how likely they are to let a crawler in. Mid-market and
# independent shops first; the big conglomerate sites are included because when
# they do work they are worth thousands of rows, and --probe will tell us.
SEED = [
    # ---- non-Shopify majors: the gap the JSON harvester cannot reach --------
    S("Uniqlo", "www.uniqlo.com",
      m=["https://www.uniqlo.com/us/en/men/tops",
         "https://www.uniqlo.com/us/en/men/bottoms",
         "https://www.uniqlo.com/us/en/men/outerwear"],
      f=["https://www.uniqlo.com/us/en/women/tops",
         "https://www.uniqlo.com/us/en/women/bottoms",
         "https://www.uniqlo.com/us/en/women/dresses-and-jumpsuits"]),
    S("COS", "www.cos.com",
      m=["https://www.cos.com/en-us/men/menswear/shirts",
         "https://www.cos.com/en-us/men/menswear/knitwear",
         "https://www.cos.com/en-us/men/menswear/trousers"],
      f=["https://www.cos.com/en-us/women/womenswear/dresses",
         "https://www.cos.com/en-us/women/womenswear/knitwear",
         "https://www.cos.com/en-us/women/womenswear/tops"]),
    S("Arket", "www.arket.com",
      m=["https://www.arket.com/en-us/men/shirts.html",
         "https://www.arket.com/en-us/men/knitwear.html"],
      f=["https://www.arket.com/en-us/women/dresses.html",
         "https://www.arket.com/en-us/women/knitwear.html"]),
    S("Weekday", "www.weekday.com",
      m=["https://www.weekday.com/en-us/men/tops/",
         "https://www.weekday.com/en-us/men/jeans/"],
      f=["https://www.weekday.com/en-us/women/dresses/",
         "https://www.weekday.com/en-us/women/jeans/"]),
    S("J.Crew", "www.jcrew.com",
      m=["https://www.jcrew.com/plp/mens/categories/clothing/shirts",
         "https://www.jcrew.com/plp/mens/categories/clothing/sweaters"],
      f=["https://www.jcrew.com/plp/womens/categories/clothing/dresses",
         "https://www.jcrew.com/plp/womens/categories/clothing/sweaters"]),
    S("Madewell", "www.madewell.com",
      m=["https://www.madewell.com/mens-clothing"],
      f=["https://www.madewell.com/womens-dresses-and-jumpsuits",
         "https://www.madewell.com/womens-tops"]),
    S("Abercrombie & Fitch", "www.abercrombie.com",
      m=["https://www.abercrombie.com/shop/us/mens-tops",
         "https://www.abercrombie.com/shop/us/mens-bottoms"],
      f=["https://www.abercrombie.com/shop/us/womens-dresses-and-jumpsuits",
         "https://www.abercrombie.com/shop/us/womens-tops"]),
    S("Urban Outfitters", "www.urbanoutfitters.com",
      m=["https://www.urbanoutfitters.com/mens-tops",
         "https://www.urbanoutfitters.com/mens-pants"],
      f=["https://www.urbanoutfitters.com/womens-dresses",
         "https://www.urbanoutfitters.com/womens-tops"]),
    S("Gap", "www.gap.com",
      m=["https://www.gap.com/browse/category.do?cid=11900"],
      f=["https://www.gap.com/browse/category.do?cid=5664"]),
    S("Banana Republic", "bananarepublic.gap.com",
      m=["https://bananarepublic.gap.com/browse/category.do?cid=47986"],
      f=["https://bananarepublic.gap.com/browse/category.do?cid=47516"]),
    S("Aritzia", "www.aritzia.com",
      f=["https://www.aritzia.com/us/en/clothing/dresses",
         "https://www.aritzia.com/us/en/clothing/tops"]),
    S("Mango", "shop.mango.com",
      m=["https://shop.mango.com/us/en/c/men/shirts_d5b3c1a2",
         "https://shop.mango.com/us/en/c/men/t-shirts_2b6a1e7f"],
      f=["https://shop.mango.com/us/en/c/women/dresses-and-jumpsuits_0e1e4a1f",
         "https://shop.mango.com/us/en/c/women/t-shirts-and-tops_5f0c0a3d"]),
    S("Massimo Dutti", "www.massimodutti.com",
      m=["https://www.massimodutti.com/us/men/shirts-n1912"],
      f=["https://www.massimodutti.com/us/women/dresses-n1917"]),
    S("Everlane", "www.everlane.com",
      m=["https://www.everlane.com/collections/mens-tees",
         "https://www.everlane.com/collections/mens-pants"],
      f=["https://www.everlane.com/collections/womens-dresses",
         "https://www.everlane.com/collections/womens-tops"]),
    S("Lululemon", "shop.lululemon.com",
      m=["https://shop.lululemon.com/c/men-tops/_/N-1z13ziqZ8t6"],
      f=["https://shop.lululemon.com/c/women-tops/_/N-1z13ziuZ8un"]),
    S("Patagonia", "www.patagonia.com",
      m=["https://www.patagonia.com/shop/mens-tops",
         "https://www.patagonia.com/shop/mens-jackets-vests"],
      f=["https://www.patagonia.com/shop/womens-tops",
         "https://www.patagonia.com/shop/womens-dresses-skirts"]),
    S("Carhartt WIP", "us.carhartt-wip.com",
      m=["https://us.carhartt-wip.com/en/men/clothing/shirts",
         "https://us.carhartt-wip.com/en/men/clothing/pants"],
      f=["https://us.carhartt-wip.com/en/women/clothing/tops",
         "https://us.carhartt-wip.com/en/women/clothing/pants"]),
    S("Muji", "www.muji.us",
      m=["https://www.muji.us/collections/men-tops"],
      f=["https://www.muji.us/collections/women-tops"]),
    S("Reformation", "www.thereformation.com",
      f=["https://www.thereformation.com/categories/dresses",
         "https://www.thereformation.com/categories/tops"]),
    S("Ted Baker", "www.tedbaker.com",
      m=["https://www.tedbaker.com/us/mens/clothing"],
      f=["https://www.tedbaker.com/us/womens/dresses"]),

    # ---- Shopify shops, entered through their *gendered* collections --------
    # The JSON harvester already sees these products; it does not see which
    # section they sit in. Crawling the collection page is what supplies that.
    S("Taylor Stitch", "www.taylorstitch.com",
      m=["https://www.taylorstitch.com/collections/mens-shirts",
         "https://www.taylorstitch.com/collections/mens-pants"],
      f=["https://www.taylorstitch.com/collections/womens"]),
    S("Percival", "www.percivalclo.com",
      m=["https://www.percivalclo.com/collections/mens-shirts",
         "https://www.percivalclo.com/collections/knitwear"],
      f=["https://www.percivalclo.com/collections/womenswear"]),
    S("Wax London", "waxlondon.com",
      m=["https://waxlondon.com/collections/shirts",
         "https://waxlondon.com/collections/knitwear"]),
    S("Polar Skate Co", "polarskateco.com",
      m=["https://polarskateco.com/collections/tops",
         "https://polarskateco.com/collections/bottoms"]),
    S("Lyle and Scott", "www.lyleandscott.com",
      m=["https://www.lyleandscott.com/collections/mens-polo-shirts",
         "https://www.lyleandscott.com/collections/mens-knitwear"],
      f=["https://www.lyleandscott.com/collections/womens"]),
    S("Boody", "boody.com",
      m=["https://boody.com/collections/mens"],
      f=["https://boody.com/collections/womens"]),
    S("SNDYS", "sndys.com.au",
      f=["https://sndys.com.au/collections/dresses",
         "https://sndys.com.au/collections/tops"]),
    S("Andie Swim", "andieswim.com",
      f=["https://andieswim.com/collections/swimsuits"]),
    S("Montirex", "montirex.com",
      m=["https://montirex.com/collections/mens"],
      f=["https://montirex.com/collections/womens"]),
    S("Gym King", "www.gymking.com",
      m=["https://www.gymking.com/collections/mens"],
      f=["https://www.gymking.com/collections/womens"]),
]


def default_registry():
    return {s["brand"]: s for s in SEED}


def load(path=SITES_JSON):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    reg = default_registry()
    save(reg, path)
    return reg


def save(registry, path=SITES_JSON):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(registry, fh, indent=1, sort_keys=True)
    return path


def record_health(registry, brand, ok, found=0, note=""):
    """Remember how a shop behaved so --crawl can skip the dead ones."""
    site = registry.get(brand)
    if not site:
        return
    h = site.setdefault("health", {"ok": 0, "fail": 0})
    h["ok" if ok else "fail"] += 1
    h["last"] = time.time()
    h["last_found"] = found
    h["status"] = "ok" if ok else "blocked"
    if note:
        h["note"] = note[:200]


def live_sites(registry, include_unknown=True):
    """Shops worth spending a crawl slot on."""
    out = []
    for brand, site in sorted(registry.items()):
        h = site.get("health")
        if h is None:
            if include_unknown:
                out.append(site)
            continue
        # two clean failures in a row and it sits out until the next probe
        if h.get("status") == "ok" or h.get("ok", 0) > 0:
            out.append(site)
    return out


def entries(site):
    """[(url, section_gender), …] for one shop."""
    out = []
    for g in ("m", "f"):
        for url in site["entries"].get(g) or []:
            out.append((url, g))
    return out


if __name__ == "__main__":
    reg = load()
    n_urls = sum(len(entries(s)) for s in reg.values())
    print("{} shops, {} gendered entry points -> {}".format(
        len(reg), n_urls, SITES_JSON))
