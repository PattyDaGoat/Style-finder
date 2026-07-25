"""The known-store registry, derived from data/catalog.json.

Every brand already in the catalog links out to its own storefront, so the
registry is built straight from the data rather than hand-maintained: brand
name -> storefront domain + the gender that brand already skews to. It picks up
new brands automatically whenever the catalog gains one.

(The standalone workspace version of this file read the CATALOG array out of
the built HTML; in this repo the catalog is source data, so it reads that.)
"""

import json
import os
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
CATALOG_JSON = os.path.join(REPO, "data", "catalog.json")
STORES_JSON = os.path.join(HERE, "stores.json")


def read_catalog(path=CATALOG_JSON):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def build_registry(catalog):
    """brand -> {domain, gender_prior, seen}"""
    domains = defaultdict(Counter)
    genders = defaultdict(Counter)
    for p in catalog:
        host = p.get("u", "").split("/")[2] if "://" in p.get("u", "") else ""
        if host:
            domains[p["b"]][host] += 1
        genders[p["b"]][p.get("g", "u")] += 1

    registry = {}
    for brand, hosts in domains.items():
        host, _ = hosts.most_common(1)[0]
        prior, _ = genders[brand].most_common(1)[0]
        registry[brand] = {"domain": host, "gender_prior": prior,
                           "seen": sum(hosts.values())}
    return registry


def save_registry(registry, path=STORES_JSON):
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(registry, fh, indent=1, sort_keys=True)
    return path


def load_registry(path=STORES_JSON):
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    registry = build_registry(read_catalog())
    save_registry(registry, path)
    return registry


if __name__ == "__main__":
    reg = build_registry(read_catalog())
    save_registry(reg)
    print("{} stores -> {}".format(len(reg), STORES_JSON))
