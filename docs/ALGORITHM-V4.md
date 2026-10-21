# Algorithm v4 — the learned layer, skip repulsion, and a deck that notices boredom

Measured at **19,355 products** (before the October 2026 retailer batch landed), on the
protocol in `CONTRIBUTING.md`: 12 seeds × 1280 swipes, 25% holdout, youth tilt off for the
taste rows. Re-measure on the catalogue you are shipping before quoting any of these.

Two halves changed, and they are measured by two different tools because they answer two
different questions.

| question | tool | what it drives |
|---|---|---|
| does the **scorer** rank liked pieces above skipped ones? | `node tools/measure-scorer.mjs` (the eval harness, at the terminal) | `hybrid()` on a random deck |
| does the **deck** deal a session people keep swiping through? | `node tools/measure-deck.mjs` | the real `nextBatch()` with simulated shoppers who get bored |

Both take `--set NAME=value` to flip the module-level switches inside the page, so a variant
is compared against the shipped code on identical sessions.

---

## 1. The scorer (`50-taste-model.js`)

### 1a. The learned layer — an online logistic regression over the swipes

The counting model credits every tag on a piece equally for every swipe, so it cannot tell
that you like linen *because of the linen* rather than the beige it usually comes in. The
garment-conditional bags were one hand-built fix for one such confound. This is the general
one: a logistic regression fitted on the session's own swipes over one-hot features of the
piece (each micro-style, colour, pattern, fabric, fit, category, brand) plus the
garment-group × colour / pattern / fit crosses. Eight passes of weighted gradient descent
with L2 shrinkage, in swipe order so it is deterministic. Its share of the score grows with
evidence — `LR_W · n/(n+60)` — so a first session is still ranked by the model that was
measured on first sessions.

Full protocol, learned layer on vs off (everything else as shipped):

| persona | ON | OFF | diff | floor | |
|---|---|---|---|---|---|
| Neutral minimalist | 0.850 | 0.818 | +0.032 | ±0.020 | clears |
| Bold streetwear | 0.826 | 0.780 | +0.046 | ±0.020 | clears |
| Earthy womenswear | 0.714 | 0.700 | +0.015 | ±0.026 | noise |
| Split wardrobe | 0.823 | 0.757 | +0.066 | ±0.020 | clears |
| **mean** | **0.804** | **0.764** | **+0.040** | | |

Split wardrobe is the conditional shopper (dark/bold on top, neutral below), which is exactly
what the cross features exist for, and it gains the most.

Short sessions, where a regression could plausibly hurt:

| session | seeds | mean AUC ON | OFF | diff | personas clearing / regressing |
|---|---|---|---|---|---|
| 60 swipes | 40 | 0.754 | 0.730 | +0.024 | 0 / 0 (all four positive, all inside noise) |
| 160 swipes | 24 | 0.777 | 0.745 | +0.032 | 2 / 0 |
| 640 swipes | 6 | 0.814 | 0.783 | +0.031 | 2 / 0 |

`LR_W` sweep at 640 swipes: 12 → +0.017, 24 → +0.026, 48 → +0.031, 96 → +0.032. 48 is
where the curve flattens; 96 starts to swamp the terms the Safe / Balanced / Adventurous dial
is calibrated against, for +0.001.

### 1b. Skipped-neighbour repulsion (`negScore`)

`knnScore` pulls a candidate toward the specific pieces you loved. Nothing pulled it away from
the specific pieces you skipped, so a near-twin of something you had just rejected — same
label, same graphic, different colourway — came straight back. `negScore` is the mirror:
average similarity to the closest three of your last 40 skips, subtracted. Top-3 rather than a
sum so one unlucky skip of a lane cannot bury the lane.

### 1c. Category affinity, shrunk (`catAffinity`)

`docs/ALGORITHM-UPGRADES.md` #1. The ranking never read `W.cat`; the results page used it as
a yes/no door. Now it is a term: weight per unit of evidence, pulled toward zero by 3
pseudo-swipes, so one skipped cap is a shrug and eight are a verdict.

### 1b and 1c on the ranking harness

| variant (640 swipes, 6 seeds) | mean AUC | vs off |
|---|---|---|
| repulsion at NEG_W=1.0 | 0.782 | +0.001 |
| repulsion at NEG_W=2.4 | 0.783 | +0.002 |
| category at CAT_W=8 | 0.782 | +0.001 |
| category at CAT_W=16 | 0.782 | +0.001 |

**Inside the noise on every persona, in the right direction on all of them.** That is
expected: the harness personas are single global rules over traits, which the additive
profile already represents nearly perfectly, and nothing in a random-dealt holdout rewards
"stop re-dealing what I just rejected". Both are kept at the modest weights (1.0 and 8)
because they cost nothing here and because the deck measurement below is where they earn
their place — they are the persistent half of the boredom handling.

The in-app harness (`?eval=1`) now has ablation rows for all three: *no learned layer*,
*no skipped-neighbour repulsion*, and *the v3 scorer*.

---

## 2. The deck (`40-deck.js`, `dealV4`)

v3 dealt a batch as "the top-N by score, then random filler", one card per brand, shuffled.
Measured with `tools/measure-deck.mjs` — 120 swipes × 6 seeds, five simulated shoppers with
a boredom model (4+ of the last 6 cards from one garment group halves the chance they like
the next one) and one who goes off tops entirely at swipe 50:

| | hit rate (all) | late-session hit | groups / 10 cards | longest same-group run | micro-styles seen | "goes off tops": tops share before → after |
|---|---|---|---|---|---|---|
| v3 deck, v3 scorer | 0.444 | 0.471 | 3.07 | 9 – 31 | 17.5 – 18.5 | 0.42 → 0.27 |
| v3 deck, v4 scorer | 0.513 | 0.601 | 3.19 | 5 – 11 | 17.3 – 18.8 | 0.42 → 0.18 |
| v4 deck, v3 scorer | 0.587 | 0.642 | 3.72 | 2.7 – 3.5 | 20 | 0.33 → 0.17 |
| **v4 deck, v4 scorer** | **0.647** | **0.729** | **3.59** | **2.7 – 3.7** | **20** | **0.36 → 0.12** |

Brands were already perfectly spaced in v3 (10 distinct per 10 cards) and still are.

What v4 does, in dealing order:

1. **Exploit with maximal marginal relevance.** The best candidates by `hybrid()`, chosen
   greedily with a similarity penalty against what is already in the batch, under a cap of
   half a batch per garment group and a fatigue penalty.
2. **Curated exploration.** Micro-style lanes ranked by an upper confidence bound on their
   like-rate — a lane the shopper has barely seen gets the benefit of the doubt — and each
   chosen lane contributes its *best-scoring* unseen piece. A discovery card is still a good
   card.
3. **One wildcard per batch**, uniformly random. Serendipity, so the feed can never fully close
   in on itself.
4. **The exploit share adapts**: the v3 schedule by default; opens up by 0.15 when the last 15
   swipes liked clearly less than the 15 before; moves toward whichever arm (exploit /
   explore) has been winning over the last 40 cards. Clamped to 30–85%, so there is always
   something different in between.
5. **Arranged, not shuffled**: consecutive cards differ in garment group and brand where the
   batch allows, discovery cards interleave with the model's picks, and the seam between
   batches is spaced too.

**Fatigue** reads the last 16 swipes. A trailing run of skips on a lane (garment group,
micro-style, or label) pushes that lane down for the batch and, at three or more, caps it at
one card. The moment the shopper likes something in the lane the streak resets — "tired of
hoodies right now", not "never show hoodies". `negScore` is the persistent half.

`test/08-deck-variety.js` turns the parts that must not regress into assertions: group cap
and spacing on the opening hand, longest run ≤ 6 over 80 swipes, origins tracked, discovery
and wildcards dealt throughout, four skips on tops → at most one top in the next batch, a
like resets it.

`DECK_V4=false` deals the v3 batch from the same pool and model, which is how the table above
was produced.

---

## What was NOT done, and why

- **Price in the ranking.** Still out, per `ALGORITHM-UPGRADES.md` #3.
- **A results-page quota by category.** `computeRec` still gates on positively-reacted
  categories. The shrunk category term now feeds the ranking, which was the first half of
  that recommendation; the grid composition is guarded by test/04 and was not touched.
- **Weights the learned layer could not justify.** NEG_W and CAT_W were left modest rather
  than tuned to a number the harness cannot distinguish from noise.
