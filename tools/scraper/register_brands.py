"""Turn probe_brands.py results into sites.json registry entries.

    python3 register_brands.py probed.json --limit 100 --dry-run
    python3 register_brands.py probed.json --limit 100

sites.py's SEED is hand-written, and rightly so — its entries encode a judgement
about which collection of a shop is worth crawling, and auto-discovery gets that
badly wrong on the shops that matter (it once resolved Stussy to `mens-swim`).
But that does not scale to a hundred shops, and hand-writing a hundred entries
would be a hundred chances to fumble a URL.

So this sits in between: probe_brands.py has already fetched each shop's real
collection list and ranked the candidates by product count, filtering out kids',
sale, archive and hardgoods collections. This writes those choices into
sites.json without touching sites.py, so the generated bulk stays out of the
hand-curated seed file and can be regenerated or dropped wholesale.

Never overwrites an existing entry: the twelve shops already in SEED have
hand-picked entry points and this must not clobber them.

Gender: a shop's own "mens"/"womens" collections are used where they exist. Where
they do not, its general collections go in under "u", which tells
import_collections.py to leave the section to the piece's own text rather than
stamping a whole unisex label as menswear.
"""

import argparse
import json
import re
import sys

import sites as site_registry

BAD_BRAND = re.compile(r"^(shop|store|home|all|the)$", re.I)

# ---- multi-brand retailers never get registered -----------------------------
# A shop that sells OTHER labels' clothes is poison here, because every row it
# yields is stamped with the SHOP's name — the brand field is the shop we asked,
# not the `vendor` field, which on these sites is unreliable anyway. Import
# Sneaker Politics and the catalog gains 60 pieces of Nike and Adidas all filed
# as brand "Sneaker Politics", which then feeds idf(p.b), the per-brand cap in
# diversify(), the brand chips on the results page and BRAND_HOME.
#
# The probe cannot detect this — a retailer's feed looks exactly like a label's,
# and these score WELL on eligible-apparel precisely because they carry so much
# stock. So it is a judgement call and it lives here as a list. Kith was excluded
# by hand for the same reason when the first twelve shops were added.
MULTI_BRAND = {
    "sneaker politics", "extra butter", "xhibition", "social status", "union la",
    "union los angeles", "wish atl", "bows and arrows", "dover street market",
    "kith", "end clothing", "ssense", "zumiez", "pacsun", "tillys", "urban industry",
    "consortium", "hanon", "size?", "jd sports", "footpatrol", "slam jam",
    "concepts", "bodega", "packer shoes", "a ma maniere", "notre", "up there",
    "solebox", "titolo", "asphaltgold", "afew", "overkill", "naked copenhagen",
}


def is_multi_brand(name, domain):
    n = (name or "").strip().lower()
    d = (domain or "").lower()
    return n in MULTI_BRAND or any(
        m.replace(" ", "") in d.replace("-", "").replace(".", "") for m in MULTI_BRAND
        if len(m) > 6)


def clean_name(name, domain):
    n = (name or "").strip()
    if not n or len(n) < 2 or BAD_BRAND.match(n):
        n = domain.split(".")[0].replace("-", " ").title()
    return n


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("probed")
    ap.add_argument("--limit", type=int, default=100)
    ap.add_argument("--min-eligible", type=int, default=25)
    ap.add_argument("--per-gender", type=int, default=3)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    with open(args.probed, encoding="utf-8") as fh:
        data = json.load(fh)
    usable = data.get("usable") if isinstance(data, dict) else data
    usable = [r for r in usable if r.get("eligible", 0) >= args.min_eligible]
    usable.sort(key=lambda r: -r["eligible"])

    reg = site_registry.load()
    existing_hosts = {s.get("host") for s in reg.values()}
    existing_names = {k.lower() for k in reg}

    added, skipped = [], []
    for r in usable:
        if len(added) >= args.limit:
            break
        host = r.get("host") or r["domain"]
        name = clean_name(r.get("name"), r["domain"])
        if is_multi_brand(name, r["domain"]):
            skipped.append((name, "multi-brand retailer"))
            continue
        if host in existing_hosts or name.lower() in existing_names:
            skipped.append((name, "already registered"))
            continue
        m = ["https://{}/collections/{}".format(host, h)
             for h in (r.get("mens_colls") or [])[:args.per_gender]]
        f = ["https://{}/collections/{}".format(host, h)
             for h in (r.get("womens_colls") or [])[:args.per_gender]]
        u = []
        if not m and not f:
            u = ["https://{}/collections/{}".format(host, h)
                 for h in (r.get("general_colls") or [])[:args.per_gender]]
        if not (m or f or u):
            skipped.append((name, "no usable collection"))
            continue
        site = site_registry.S(name, host, m, f,
                               "auto-registered from probe ({} eligible)".format(r["eligible"]))
        if u:
            site["entries"]["u"] = u
        reg[name] = site
        existing_hosts.add(host)
        existing_names.add(name.lower())
        added.append((name, host, len(m), len(f), len(u), r["eligible"]))

    print("registering {} shops (of {} usable):".format(len(added), len(usable)))
    for name, host, nm, nf, nu, el in added[:40]:
        print("   {:<28} {:<30} m={} f={} u={}  ~{} eligible".format(
            name[:28], host[:30], nm, nf, nu, el))
    if len(added) > 40:
        print("   … and {} more".format(len(added) - 40))
    if skipped:
        print("\nskipped {}: {}".format(
            len(skipped), ", ".join("{} ({})".format(n, w) for n, w in skipped[:8])))
    print("\npotential rows at 60/brand: {}".format(
        sum(min(60, a[5]) for a in added)))

    if args.dry_run:
        print("\ndry run — sites.json untouched")
        return
    site_registry.save(reg)
    print("\nsites.json now holds {} shops".format(len(reg)))
    print("  Next:  python3 import_collections.py --brands-file <names.txt>")

    with open("registered_brands.txt", "w", encoding="utf-8") as fh:
        fh.write("\n".join(a[0] for a in added) + "\n")
    print("  brand names written to registered_brands.txt")


if __name__ == "__main__":
    main()
