"""
Fast-fashion footprint model. Every constant is sourced; every output is derived.
Prints the exact numbers that go into the chart.
"""

# ---------------------------------------------------------------- sourced constants
# European Parliament (EPRS), EU 2022 consumption footprint:
#   19 kg textiles bought per person -> 355 kg CO2e per person
EP_KG_TEXTILE_PER_PERSON = 19.0
EP_KGCO2E_PER_PERSON     = 355.0
CARBON_INTENSITY = EP_KGCO2E_PER_PERSON / EP_KG_TEXTILE_PER_PERSON   # kg CO2e per kg textile

# Water footprint per garment (total water footprint: green + blue + grey)
W_TSHIRT = 2700.0    # European Parliament / Water Footprint Network
W_JEANS  = 7570.0    # UNEP: "around 2,000 gallons" -> 2000 * 3.785

# MIT (2013): a typical pair of running shoes = 30 lb CO2e
SHOE_KGCO2E = 30 * 0.4536

# FashionUnited (via US PIRG): average American buys 53 new garments a year
ITEMS_TYPICAL = 53

# EPA, average passenger vehicle: 400 g CO2 per mile
G_CO2_PER_MILE = 400.0
# Drinking water basis implied by the EP/WFN framing (2,700 L = 2.5 years of drinking water)
DRINKING_L_PER_DAY = 3.0

print("Derived carbon intensity: %.2f kg CO2e per kg of textile" % CARBON_INTENSITY)
print("Sneaker carbon (MIT 30 lb): %.1f kg CO2e/pair\n" % SHOE_KGCO2E)

# ---------------------------------------------------------------- the basket
# A representative 53-item year. mass = typical garment weight (kg); water = L per item.
# Water for categories without a headline study is scaled between the two anchors.
BASKET = [
    # label,            n,  mass,  water,  co2_override
    ("T-shirts & tops", 20, 0.18, W_TSHIRT, None),
    ("Shirts",           8, 0.25, 2500.0,   None),
    ("Jeans & trousers", 7, 0.70, W_JEANS,  None),
    ("Knitwear & sweats",6, 0.55, 3000.0,   None),
    ("Outerwear",        3, 1.00, 4000.0,   None),
    ("Shoes",            5, 0.90, 4400.0,   SHOE_KGCO2E),
    ("Caps & accessories",4,0.10, 500.0,    None),
]

def basket_totals(scale=1.0):
    water = co2 = mass = items = 0.0
    for _, n, m, w, over in BASKET:
        k = n * scale
        items += k
        mass  += k * m
        water += k * w
        co2   += k * (over if over is not None else m * CARBON_INTENSITY)
    return items, water, co2, mass

n_check = sum(b[1] for b in BASKET)
assert n_check == ITEMS_TYPICAL, "basket must sum to 53, got %d" % n_check

print("--- Basket detail (53-item year) ---")
for label, n, m, w, over in BASKET:
    c = n * (over if over is not None else m * CARBON_INTENSITY)
    print("  %-19s n=%2d  mass %5.2f kg  water %7.0f L  CO2 %6.1f kg" % (label, n, n*m, n*w, c))

# ---------------------------------------------------------------- scenarios
SCENARIOS = [
    ("Average US shopper",      53),
    ("Half as many",            27),
    ("Buy better, buy less",    14),
]
print("\n--- Scenarios (per person, per year) ---")
rows = []
for name, items in SCENARIOS:
    _, water, co2, mass = basket_totals(items / ITEMS_TYPICAL)
    rows.append((name, items, water, co2, mass))
    print("  %-22s %2d items  %8.0f L  %6.1f kg CO2e  %5.1f kg textile" % (name, items, water, co2, mass))

base = rows[0]
best = rows[-1]
d_water = base[2] - best[2]
d_co2   = base[3] - best[3]
d_mass  = base[4] - best[4]
print("\n--- Saving, 53 items -> 14 items ---")
print("  water   %8.0f L  (%.0f%%)" % (d_water, 100*d_water/base[2]))
print("  carbon  %8.1f kg CO2e (%.0f%%)" % (d_co2, 100*d_co2/base[3]))
print("  textile %8.1f kg (%.0f%%)" % (d_mass, 100*d_mass/base[4]))
print("\n--- Equivalents for that saving ---")
print("  drinking water: %.0f days = %.0f years at 3 L/day" % (d_water/DRINKING_L_PER_DAY, d_water/DRINKING_L_PER_DAY/365))
print("  driving:        %.0f miles at 400 g CO2/mile" % (d_co2*1000/G_CO2_PER_MILE))
print("  textile mass:   %.1f kg  (~%.0f lb)" % (d_mass, d_mass*2.2046))

# WRAP: +9 months of active life cuts carbon/water/waste footprints by up to 20%
print("\n--- Plus WRAP durability effect on the 14-item year (up to -20%) ---")
print("  water  %8.0f -> %8.0f L" % (best[2], best[2]*0.8))
print("  carbon %8.1f -> %8.1f kg CO2e" % (best[3], best[3]*0.8))
tot_w = base[2] - best[2]*0.8
print("  total water saving vs average shopper: %.0f L (%.0f%%)" % (tot_w, 100*tot_w/base[2]))

# ---------------------------------------------------------------- footprint per wear
print("\n--- Water per wear (same garment, different number of wears) ---")
WEARS = [5, 10, 25, 50, 100]
print("  wears   t-shirt L/wear   jeans L/wear")
perwear = []
for w in WEARS:
    t, j = W_TSHIRT/w, W_JEANS/w
    perwear.append((w, t, j))
    print("   %3d        %6.0f          %6.0f" % (w, t, j))
print("  ratio 5 -> 100 wears: %.0fx less per wear" % (WEARS[-1]/WEARS[0]))

# ---------------------------------------------------------------- EPA end-of-life
print("\n--- EPA 2018, US textiles in municipal solid waste (million tons) ---")
EPA = [("Landfilled", 11.30), ("Burned for energy", 3.22), ("Recycled", 2.51)]
tot = sum(v for _, v in EPA)
for k, v in EPA:
    print("  %-18s %5.2f Mt  (%4.1f%%)" % (k, v, 100*v/tot))
print("  total              %5.2f Mt" % tot)
print("  per person (331M):  %.1f kg generated, %.1f kg landfilled" % (tot*1e6*907.18/331e6, 11.30*1e6*907.18/331e6))

# ---------------------------------------------------------------- machine-readable
import json
out = {
  "carbonIntensity": round(CARBON_INTENSITY, 2),
  "scenarios": [{"name": n, "items": i, "water": round(w), "co2": round(c, 1), "mass": round(m, 1)}
                for n, i, w, c, m in rows],
  "saving": {"water": round(d_water), "co2": round(d_co2, 1), "mass": round(d_mass, 1),
             "drinkingYears": round(d_water/DRINKING_L_PER_DAY/365), "miles": round(d_co2*1000/G_CO2_PER_MILE)},
  "perWear": [{"wears": w, "tshirt": round(t), "jeans": round(j)} for w, t, j in perwear],
  "epa": [{"name": k, "mt": v, "pct": round(100*v/tot, 1)} for k, v in EPA],
  "basket": [{"label": l, "n": n, "mass": round(n*m, 2), "water": round(n*w),
              "co2": round(n*(o if o is not None else m*CARBON_INTENSITY), 1)}
             for l, n, m, w, o in BASKET],
}
open("/tmp/sf/model.json", "w").write(json.dumps(out, indent=1))
print("\nwrote /tmp/sf/model.json")
