# Style Finder — recommended algorithm upgrades

Ranked by value for effort. Everything below is measured against your actual catalog
(9,306 items, 367 brands, 20 micro-styles) and a simulated 60-swipe session, not guessed at.

---

## First, what your algorithm actually does

Worth stating plainly, because the upgrades only make sense against it.

Every swipe updates a **profile**: a set of weights across micro-styles, colours, patterns,
fabrics, fits and brands. Love adds 3, like adds 1.5, skip subtracts 1.2, and recent swipes count
up to ~1.9× more than early ones. Rare features count for more than common ones (that's the
`idf` function — the same trick search engines use so the word "the" doesn't dominate).

To rank a candidate piece it blends two scores:

- **profileScore** — does this piece match your overall taste?
- **knnScore** — how close is it to the specific pieces you loved or put in your cart?

The Safe/Balanced/Adventurous dial changes the mix. Safe leans on your favourites, Adventurous
leans on the broad profile.

**This is a sound design.** It's the right architecture for 9k items and it doesn't need replacing.
Every recommendation below sharpens the signals feeding it rather than swapping the engine.

---

## 1. Stop one skip from banning an entire category — biggest win, smallest change

**The symptom.** The results page can only recommend categories you reacted *positively* to. It
computes a weight per category, then uses it as a yes/no gate.

**The evidence.** I liked 10 t-shirts and skipped exactly **one** cap. Result: cap weight −1.68,
caps excluded, and **0 of 36 recommendations were caps — out of 334 available.** In a realistic
60-swipe session the same thing happened to shorts: one pair seen, one skipped, shorts banned for good.

**Why this matters more than it sounds.** It punishes the long tail hardest. Categories you happen
to see a lot of get a fair trial; categories you see once are decided by a single swipe. Skipping
one cap means "not that cap," not "no hats, ever."

**The fix.** Two lines of thinking, both small:

- Feed the category weight into the score instead of using it as a gate. `profileScore` already
  reads micro-style, colour, pattern, fabric, fit and brand — it just ignores category. Add it as a
  term, so a lightly-disliked category is *ranked lower* rather than deleted.
- Floor the penalty by how much evidence you have. One skip out of one sighting should barely move
  the weight; eight skips out of ten should bury it. Statistically this is shrinking toward the mean —
  divide the score by `(sightings + k)` with k around 3, so early evidence counts less.

---

## 2. Balance the results across categories — you're getting a t-shirt drawer, not a wardrobe

**The symptom.** Results are ranked purely by score, so whatever you swiped most dominates.

**The evidence.** In that 60-swipe session: **20 of 36 recommendations were tees and sweatshirts.
One pair of trousers. One knit.** The user had liked 4 pairs of shoes, 6 shirts and 4 jackets.

**Why it matters.** The panel is called "New pieces you'd wear." Twenty tops isn't an outfit, and
it's the part of the app a user judges you on.

**The fix.** Give the results grid soft quotas — say at most 40% from any one category, and reserve
slots for the next-best categories you liked. Your `diversify()` function already does exactly this
for brands and micro-styles (caps per brand, caps per micro-style). Extend the same pattern to
category. It's the cheapest fix in this document because the machinery already exists.

---

## 3. Learn what you're willing to spend

**The symptom.** Price is a hard ceiling and nothing else. Budget filters out anything above your
cap; below the cap, a $12 tee and a $240 tee are treated identically.

**The evidence.** `profileScore` contains no price term at all. Your catalog runs $1 to $660,
median $80. In the simulated session price tracking came out roughly right by accident — because
expensive brands correlate with expensive taste — but the top recommendation was $140 against a
liked median of $90, with nothing steering it.

**Why it matters.** Price is one of the strongest real signals in clothing, and you're collecting it
free on every swipe. Someone who loves $60 pieces and skips $200 ones is telling you something the
model currently throws away.

**The fix.** Track the price of what you love versus what you skip and score candidates by distance
from your revealed band. Two details that matter:

- Work in **log price**, not dollars. The gap from $40 to $80 feels the same as $80 to $160 — a
  doubling either way. Raw dollars would make a single $600 coat distort everything.
- Do it **per category**. Being comfortable at $200 for a jacket says nothing about socks.

This also unlocks a nice readout for the results page: *"your sweet spot: $70–$120."*

---

## 4. Fix the similarity metric — one term is 19% of the score and carries almost no information

This is the subtlest problem and the most interesting one.

**The symptom.** `simItem()` decides how alike two pieces are. It awards +0.8 when two items share
a "fit" (oversized, relaxed, slim…). But fit is guessed from keywords in the product name, and most
names don't mention fit.

**The evidence.** **92% of your catalog is fit "regular".** So roughly 85% of all item pairs match on
fit and collect that +0.8. Measured across 4,000 random pairs, the fit term is **19% of the average
similarity score — more than colour contributes (12%)** — while telling you essentially nothing.

**Why it matters.** It's not that it adds noise; it adds a near-constant. Every pair gets it, so it
compresses the differences between the pairs you actually care about. The signals doing real work
get proportionally quieter.

**The fix, three parts:**

- **Only credit fit when it isn't the default.** Two "regular" items sharing "regular" is not a
  similarity. Two *oversized* items sharing oversized genuinely is.
- **Apply the rare-feature weighting to colour and pattern too.** Right now `idf` is applied to
  micro-styles, fabrics and brands — but not colour or pattern. Your catalog is **53% neutral** and
  **81% solid**, so matching on "neutral solid" currently scores the same as matching on "bold plaid",
  which is a far more meaningful thing to have in common.
- **Normalise for how richly tagged an item is.** An item with 3 micro-styles and 2 fabrics scores
  higher against everything than a sparse one — not because it's more similar, just because it has
  more chances to match. Dividing by the square root of each item's tag count (standard cosine
  normalisation) fixes it.

**Related data gap:** fabric is empty on **7,436 of 9,306 items (80%)**. So the "the fabric" answer
on a card often has nothing to attach to, and `whyMatch()`'s fabric fallback usually fails silently.
Worth backfilling from product descriptions when you next harvest.

---

## 5. Learn from skips — you're discarding two-thirds of your data

**The symptom.** Skips only subtract from the profile. They never pull recommendations *away* from
anything, and you never find out why.

**Why it matters.** Most swipes are skips. Right now a skip is a small blunt negative spread across
every trait of that item — including the traits it shares with things you loved. Skip a navy
oversized hoodie and you're mildly penalising navy, oversized *and* hoodies, even if navy was the
one thing you liked about it.

**The fix, in order of value:**

- **Add a negative-neighbour term.** You already compute closeness to your favourites. Compute
  closeness to your *skips* and subtract it. This is a handful of lines and it sharpens the boundary
  a lot, because it targets specific pieces instead of smearing a penalty across traits.
- **Ask why, on the skip.** The tag strip ("what caught your eye?") only appears in a positive frame.
  A one-tap *too loud / too pricey / not my fit / wrong colour* on a skip is the single richest signal
  you could collect per swipe, and it directly solves the smearing problem above: it tells you which
  trait to penalise.
- **Separate "no" from "already own it."** A third reason turns a false negative into a compliment.

---

## 6. Don't let the feed close in on itself

**The symptom.** The deck starts at 42% "best guess" and 58% exploration. By swipe 80 it's 90/10 and
stays there permanently.

**Why it matters.** After 80 swipes you're seeing almost nothing outside what the model already
believes, which means it can't be corrected, and it looks confident because it stopped testing itself.
Taste also drifts, and a 90% exploit feed can't notice.

**The fix.**

- **Keep a permanent exploration floor** of roughly 25–30% rather than decaying to 10%.
- **Make it react to how you're doing.** If the last 10 swipes were mostly skips, the model is wrong
  right now — exploration should *rise*, not stay pinned. That's a few lines: track the recent
  like-rate and scale the exploit fraction by it. This is the one change here that makes the feed feel
  intelligent rather than stubborn.
- Optionally a **"show me something different"** button, which is a more honest version of what
  Adventurous already gestures at.

---

## 7. Collapse duplicate listings

**The evidence.** 283 groups of items share a product title, **443 duplicate rows** in total.

**Why it matters** — and it's not mainly about seeing a piece twice, since `baseTitle()` already
hides repeats while swiping. It's that **the rare-feature weighting is computed over a catalog with
duplicates.** Seven copies of one pair of leggings makes that brand and its micro-styles look seven
times more common than they are, so genuinely rare features get under-rewarded.

**The fix.** Collapse on (title + category), keep the cheapest or in-stock row, and recompute the
feature counts afterwards.

---

## 8. Use the sizes you already collect

You ask for top, waist and shoe size in setup and then never use them for ranking. Stock is only
checked once something is in the cart. Both should influence the score: a piece that's in stock in
your size deserves to outrank one that isn't. Nothing is more annoying than a perfect recommendation
that's sold out.

---

## 9. The interesting one: recommend outfits, not just items

Everything today is per-item. The natural next step — and the thing that would make this feel unlike
a shopping feed — is: *given the jacket you just loved, what trousers and shoes go with it?*

You have most of what you need: colour, pattern, formality (inferable from your existing occasion
tags), and micro-style. The rules are learnable and mostly conventional — no more than one loud
pattern per outfit, keep formality consistent, neutrals pair with anything. Build it as a scoring
function over *pairs* of items in complementary categories and surface it as "complete the look."

This is genuinely more work than everything above it and I'd do it last, after the fixes in 1–6 —
but it's the one that changes what the product *is*.

---

## What I would not do, and why

You should push back on me if you disagree, but I'd argue against all four of these.

**Don't put an LLM in the ranking loop.** It's tempting and it's wrong here. Ranking 9,000 items
against 20 style tags is exactly what a well-tuned linear model is *good* at — it's instant, free,
and runs offline. An LLM would add latency and cost per swipe to do a job it isn't better at. The
place a language model earns its keep in this app is writing the *explanations* ("why this matched"),
not choosing the items.

**Don't reach for embeddings or a neural net yet.** The gains identified above are all in the
*signals* — price, category, skip reasons, a diluted similarity term. Swapping the model class
before fixing the inputs means a more sophisticated engine drawing the same wrong conclusions.
Fix the data first; the model class is not your bottleneck.

**Don't add more micro-styles.** Twenty is already a lot for 2.05 tags per item. More categories
means each one gets less evidence per swipe.

**Don't tune the weights by feel.** Which brings me to the last item, which I'd actually do first.

---

## 10. The upgrade that makes all the others possible: a way to measure

Right now there is no way to tell whether a change made recommendations better or worse. Every
number in this document I had to discover by instrumenting the app by hand. That means every future
tweak — including all nine above — is guesswork.

**Build a replay test.** It's simpler than it sounds:

1. Save a real swipe session (yours — 100+ swipes across both sections).
2. Hide the last 20% of it from the model.
3. Ask the model to rank those hidden pieces.
4. Score it: did the pieces you actually loved land near the top?

The standard measures are **precision@10** (of the top 10 it recommended, how many did you actually
like?) and **AUC** (given one liked and one skipped piece, how often does it rank the liked one
higher — 0.5 is a coin flip, 0.8 is strong).

Then when you make a change, you run it and get a number. **That single number is the difference
between engineering and vibes**, and it costs an afternoon. I'd build this before touching anything else,
because it's what tells you whether item 1 above actually helped — and it's the honest answer to "is
this recommendation engine any good?", which right now neither of us can answer with evidence.

---

## Suggested order

| # | Change | Effort | Payoff |
|---|---|---|---|
| 10 | Replay test to measure changes | Half a day | Makes everything else verifiable |
| 1 | Category weight instead of a ban | Small | Fixes a visible bug |
| 2 | Category quotas in results | Small | Results become a wardrobe |
| 4 | Fix fit / colour / pattern weighting | Small | Sharpens every ranking |
| 5a | Negative-neighbour term | Small | Uses data you already have |
| 3 | Learn the price band | Medium | Strong signal, currently discarded |
| 6 | Exploration floor + react to skips | Medium | Feed stops closing in |
| 5b | Ask why on skip | Medium (UI) | Richest signal per swipe |
| 7 | Collapse duplicates | Medium | Unbiases the rare-feature weighting |
| 8 | Size and stock in ranking | Medium | Removes a real annoyance |
| 9 | Outfit pairing | Large | Changes what the product is |

Items 1, 2, 4 and 5a together are maybe an afternoon and address the two flaws a user would notice
first. If you want, I can implement that block next and use the replay test to show what it moved.
