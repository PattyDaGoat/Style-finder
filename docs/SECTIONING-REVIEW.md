# Full photo by default + strict section matching

Three changes. Each is in a block marked `SECTIONING` (CSS, JS, and two lines of HTML) so you
can delete them independently.

---

## 1. The full photo is now the default

The highlight is opt-in. First visit shows the plain photo; the button on the card reads
**"Highlight the piece"** and turns the frame on if you want it. Your choice is remembered, and
clearing it returns to the full photo.

---

## 2. Reading each listing to decide the section — this is the real change

You asked me to check each item's description and sort accordingly. I'd only been reading the
**product name**. There were three more fields sitting right there that I hadn't touched:

| Field | Example |
|---|---|
| **Product URL** | `.../products/womens-cotton-diana-edition-sweater-pink` |
| **Photo filename** | `F1_W_Gigi_Smocked_Dress.jpg` · `instock_m_q326_dory-crew.jpg` |
| **Brand name** | `Wax London Womens` |

The product URL is the important one, and here's why it answers the question you actually asked.
**A piece filed by its own shop under `/womens/` was photographed on a woman.** I can't see the
photo, but the shop already told me which section it belongs to — so the URL is a stand-in for the
thing I can't look at.

Checked against the gender tags that shipped with your catalog, the URL agrees **91%** of the time.
I went through the disagreements one by one, and **nearly every one is the tag being wrong**:

- **six Roark women's tees** — `/products/womens-sunbeam-muse-premium-tee-wheat` — were tagged menswear
- **five Fresh Clean Threads women's multipacks** — filenames literally reading `Womens-Vneck-...` — same
- a **Rowing Blazers women's Diana sweater**, a **Represent women's cropped training tee**
- and three **Organic Basics men's tees** tagged womenswear, going the other way

**43 items had their section corrected** this way. All of those were previously showing in the wrong deck.

### The tiers, most trustworthy first

1. The name states its audience — "Women's Crew Sweatshirt"
2. A garment type only one gender wears — bodycon dress, jockstrap
3. **The product URL** — where the shop shelved it
4. **The brand name** — "Wax London Womens"
5. **The photo filename** — weakest, because some tokens are camera codes

That last tier needed care. My first pass read `CordSoftTruckerCap_Navy_W7A1410.jpg` as womenswear —
the `W7A` is a camera file prefix, not a gender. Single-letter tokens now have to be delimited on
both sides, and a brand's own lean can overrule this tier. There's a test pinning that exact filename.

---

## 3. Strict section matching — how the wrong-gender photos actually stop

Correcting tags isn't enough on its own, because of the pieces marked **unisex**. A unisex t-shirt has
*one* photo with *one* model in it. Shown in both decks, that photo appears in menswear whether the
model is a man or a woman. That's precisely your complaint.

After all five tiers plus brand lean, **8,010 of 9,306 pieces are positively placed** (4,440 women's,
3,570 men's). **1,296 cannot be placed** — mostly skate and streetwear labels like Quasi, Polar,
Helas and Last Resort AB, which genuinely sell unisex product and photograph it on whoever.

So there's a switch on the deck, **on by default**:

> **✓ Only pieces confirmed for this section**

Strict mode holds those 1,296 unplaceable pieces back from **both** decks — because an unplaced piece is
exactly the one whose photo might show the wrong model. The result:

| | Strict (default) | Relaxed |
|---|---|---|
| Menswear deck | **3,554** pieces | 4,850 |
| Womenswear deck | **4,413** pieces | 5,709 |
| Confirmed wrong-gender pieces | **0** | **0** |
| Unplaceable pieces included | 0 | 1,296 |

**That's the honest trade:** strict costs you about 28% of the menswear deck. Relaxed still admits
*zero* confirmed womenswear into menswear — it only adds back the genuinely unknown ones. The toggle
is visible under the deck with a line explaining which you're in, so it's yours to choose. 3,554
pieces is still a very deep deck.

---

## What I still can't do, plainly

I cannot look at the photograph. Telling a model's gender from raw pixels needs a trained vision
model, and a page opened off your disk can't even read the pixels of an image hosted on someone
else's CDN. So for those 1,296 pieces the honest answer is "the listing doesn't say," and strict mode
handles that by not showing them rather than by guessing.

If you want to close that last gap properly, the way to do it is a one-off offline pass with a real
vision model that looks at each photo once and writes the answer into the catalog. That's a real
project, not a tweak, but it's the only thing that would actually see the models.

---

## Testing

42 new assertions, all passing; 221 across all five suites. The ones that matter:

- both decks in strict mode contain **zero** pieces from the other section and **zero** unplaceable ones
- relaxed mode still admits zero *confirmed* womenswear into menswear
- a dress with its tag deliberately corrupted to "menswear" is still blocked, in both modes
- `W7A1410.jpg` is not read as womenswear; a listing with no clue returns "don't know" rather than a guess
- the URL outranks the photo filename when they disagree
- first visit shows the full photo; the highlight opt-in persists; clearing it reverts
- 70 real cards swept from the menswear deck — none womenswear, none unplaceable

---

## Your call

- **Keep it** → I move on to the category-ban fix (upgrade 2 from the list).
- **Change the default** → if 28% fewer menswear pieces is too steep, I can default to relaxed, or
  soften strict so it only holds back unplaced pieces from brands that lean the other way.
- **Delete it** → remove the `SECTIONING` blocks; the earlier name-and-brand detector remains.
