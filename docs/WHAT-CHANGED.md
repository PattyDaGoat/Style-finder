# Style Finder — clothing-only catalog, gender separation, piece highlighting

Plain-language summary of what changed and why. Numbers come from the actual catalog, not estimates.

---

## 1. Only clothing, accessories and shoes

**76 items removed.** They were never clothing: beach towels, bath sheets, magazines, skateboard
decks and wheels, a mirror, a tumbler, hand cream, sunscreen, vitamin serum, a portable speaker,
a notebook, boxed tea, a pillowcase, leather conditioner, a bottle opener, a woodcarved giraffe,
art books, packing cubes and gift-shop odds and ends.

**9,306 items kept** (from 9,382). Every remaining item is a garment, an accessory or a pair of shoes.

### How the filter avoided throwing away real clothes

My first attempt was far too aggressive: it required a garment word in the product name and dropped
**1,052 items** — including real ones. The reason is worth knowing, because it shapes anything you
build on this data later:

> **Hundreds of products are named nothing but a model name.** "574 Legacy" is a New Balance shoe.
> "The Starling" is a shoe. "Débardeur Spaghetti" is a French tank top. "Jupe Zakynthos" is a skirt.
> "808 Powerbird", "The Corsa Driver", "Island Bound", "Haze" — all real products with no garment
> word anywhere in the name.

So the test was inverted. Instead of demanding proof an item *is* clothing, it now looks for proof an
item is **not** clothing — a non-wearable word in the position where the product type belongs. That
distinguishes **"Beach Towel"** (dropped) from **"Blanket Shirt"** (kept), and **"Bath Sheet"**
(dropped) from **"Pillow Sweater"** (kept, and it is a real Selkie sweater).

**160 categories were also corrected**, including 85 items filed as "dresses" that were not dresses
— mostly men's **dress shirts**, plus a "Dressy Crew Neck Sweater" — and 75 bags moved into
accessories.

---

## 2. Menswear shows men's clothes, womenswear shows women's

**442 items had their gender corrected.** The worst offenders were whole women's brands whose items
were tagged "unisex", which meant they appeared in **both** decks — so **Ryderwear** and **Echt**
seamless leggings and sports bras, **Adanola** yoga pants and **Outdoor Voices** skorts were all
showing up in menswear.

### The four signals, in order of trust

| | Signal | Example |
|---|---|---|
| 1 | An audience word in the name | "**Women's** Crew Sweatshirt" → women's |
| 2 | A garment type only one gender wears | "Bodycon Midi **Dress**", "**Jockstrap**" |
| 3 | The retailer's own tag | respected — never overridden without proof from 1 or 2 |
| 4 | The brand's gender profile | Ryderwear is a women's activewear label; all of it is women's |

Signal 4 only resolves items tagged "unisex", and only for brands that are overwhelmingly
single-gender on hard evidence (at least 5 confirmed items, 95% one way). A separate stricter rule
(10+ items, 98% one way) can correct an outright wrong retailer tag — that is what caught
**Andie Swim**, a women's swimwear label with three items tagged menswear.

A final pass fixed **82 lone stragglers**: a brand with 30 women's pieces and exactly one "men's"
piece is a tagging slip, not a menswear line. That pass is blocked from touching anything decided by
signals 1 or 2, so genuine cross-overs survive — a real women's dress from Naked & Famous, a sports
bra from Represent, "Women's Crew" from Fresh Clean Threads all stayed correctly labelled.

### Results

- **0** women's items reachable from menswear
- **0** men's items reachable from womenswear
- **0** dresses anywhere in menswear (was 12)
- Menswear deck: **4,954** pieces across all 10 categories
- Womenswear deck: **5,843** pieces across all 11 categories, including **504 dresses**

### The detection now lives in the app, not just the data

The app carries its own detector that runs over the catalog at startup and **locks** each recognised
item to one section. So if a future catalog update tags a dress as menswear, the dress still cannot
appear in the men's deck. There is a test that deliberately mis-tags a dress as menswear and confirms
it stays blocked.

### One thing deliberately not built

You asked for detection of **women models** in the photos. I did not build that, and I want to be
straight about why rather than quietly ship something weaker than it sounds.

Reliably telling a model's gender from raw pixels needs a trained vision model. Nothing in a plain
web page can do it — and the cheap approximations (skin-tone fraction, hair-region darkness, colour
histograms) are wrong often enough that they would put dresses **back** into menswear, which is the
exact bug being fixed. On top of that, the page can't even read the pixels: the photos come from a
content network that a file opened off your disk isn't allowed to inspect.

What the product **name** and the **brand** tell you is far more reliable, costs nothing, and works
offline — which is why the numbers above are zeroes. If you later want true image analysis, the way
to do it is a one-off offline pass with a real vision model that writes its answers into the catalog,
not a guess made in the browser at swipe time.

---

## 3. The photo highlights the piece that's for sale

Most of these shots are a full outfit on a model, so "a green belt" can be the one thing in frame you
aren't looking at. Each card now dims the rest of the photo, draws a white frame around the garment,
and labels it — **the shoes**, **the belt**, **the dress**.

The region comes from the garment type: a hat sits at the top of the frame, trousers across the legs,
shoes at the feet, a belt at the waist, socks low, earrings at the head. Accessories are refined by
name, so a scarf, a belt, a bag and a pair of earrings each get their own position rather than sharing
one generic "accessory" box.

**Be clear on what this is:** a position by garment type, not object detection. It lands on the right
region for a standard full-length product shot. It cannot know that one particular photo is cropped
at the waist or shot flat on a table. That's why there's a **"Show full photo"** toggle on every card,
and the caption under the deck says the frame is a guide rather than a measurement. Your choice is
remembered.

The small cards in your results grid don't have room for a frame, so they instead re-centre the photo
on the garment — a shoe card shows the shoes rather than the model's midriff.

---

## Note on your saved swipes

Removing items renumbered the catalog, and saved profiles store swipes by number. Rather than let old
swipes point at different clothes — which would quietly corrupt your recommendations — the profile
version was bumped. **Your accounts and sign-in are intact; the swipe history starts fresh.** This was
the honest trade: a reset you know about beats an algorithm silently trained on the wrong garments.

---

## Testing

141 automated browser assertions across three suites, all passing. For this round specifically:

- every category is an apparel category; no non-apparel names survive
- 16 detector cases, including the traps: "Men's **Dress** Shirt" must not read as a dress,
  "Captain **Clutch** Pocket Tee" is a nickname not a handbag, "**Heel** Tab Sneaker" is shoe
  anatomy not a high heel, "**Ballet Flat** Tee" is a t-shirt, "Women's **Boy** Fit Tank" is women's
- both decks swept end to end: zero wrong-gender items
- a deliberately mis-tagged dress stays out of menswear
- frame geometry per garment type, and that no frame falls outside the photo
- the highlight toggle hides, relabels, restores and persists

Three real bugs were caught by that testing and fixed: the card's drag handler swallowed the
highlight button's clicks (it captures the pointer, so pressing the button did nothing — it would
have failed for you too), the button's label appended instead of replaced, and the label collided
with the card's top buttons on hats and with the caption on shoes.
