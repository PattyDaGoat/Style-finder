# Upgrade 1 of 5 — the measurement harness

**Status:** implemented, tested, ready for your review. Nothing else has been changed.
**Reverting it:** delete the three blocks marked `UPGRADE 1` (one in the CSS, one in the HTML,
one in the JavaScript, each with a matching `end UPGRADE 1`). The app is then exactly as it was.

---

## Why this one first

You asked for the changes one at a time. I've done them in the order I recommended, which puts
the boring one first: **before this, there was no way to tell whether a change to the recommender
helped or hurt.** The next four changes all claim to improve things. Without this, those claims
would be my opinion.

## Where to find it

It's invisible to normal users. To open it:

- add `?eval=1` to the address — `style-finder.html?eval=1` — **or**
- press **Shift+E three times** on any screen

A small dark **"Algorithm test"** button appears bottom-right. Two buttons inside:

- **Test on my saved swipes** — uses your real session. Needs ~25 swipes minimum, 100+ to trust.
- **Test on 3 simulated shoppers** — works immediately, no swiping needed. Three fake shoppers
  with defined tastes (a neutral minimalist, a bold streetwear buyer, an earthy womenswear buyer)
  swipe your real catalog, and the model is tested on each.

## What it actually does

1. Takes a swipe session **in order**.
2. Hides the last chunk of it.
3. Rebuilds the taste model from the earlier swipes **only**.
4. Ranks the hidden pieces, and asks: *did the ones you actually liked come out on top?*

It calls the real `buildModel` / `hybrid` / `profileScore` the app ships — not a copy — so the
number describes the algorithm you're actually running.

**AUC** is the headline. Take one piece you liked and one you skipped; AUC is how often the model
ranks the liked one higher. 0.50 is a coin flip. 0.70 is decent. 0.80+ is strong.
**P@10** is how many of its top 10 picks you actually liked.

---

## Your baseline — the "before" number

Averaged over 5 runs each, on your real catalog:

| Scenario | AUC | P@10 |
|---|---|---|
| Neutral minimalist | **0.807** ±0.035 | 90% |
| Bold streetwear | **0.670** ±0.099 | 34% |
| Earthy womenswear | **0.693** ±0.046 | 40% |
| **Overall** | **≈0.73** | |

For context, the two deliberately dumb baselines scored 0.45–0.62. **So your algorithm is real —
it's clearly better than chance, and by a wide margin on the mainstream taste.** It's weaker on
niche tastes, which is expected and is what upgrades 3–6 are aimed at.

---

## Two things the harness found on day one

**1. The nearest-neighbour half of your hybrid is contributing almost nothing.**

Look at the first two rows of every table. "Taste profile only" scores 0.809 / 0.669 / 0.692 —
against the full hybrid's 0.807 / 0.670 / 0.693. Identical within the margin of error. Meanwhile
"nearest-neighbour only" manages just 0.544–0.600.

In Balanced mode the kNN term carries equal weight to the profile, and it appears to be buying you
nothing in ranking accuracy. That doesn't automatically mean delete it — it may still be doing
useful work on *diversity* and on the Safe/Adventurous dial, which AUC doesn't measure. But it's
now a question with evidence attached instead of an assumption, and it's worth a look before
upgrade 5a (which adds a *negative* neighbour term and would be measured the same way).

**2. It caught me nearly misleading you.**

My first version reported a single number per scenario. On that version, the dumb popularity
baseline appeared to *beat* the real algorithm on the streetwear shopper — 0.893 versus 0.827. I
went looking for why, expecting the fake persona was correlated with big brands. It wasn't
(average brand size 27.5 versus 27.3 — flat).

The truth was that **my measurement was too noisy to say anything.** With only ~6 liked pieces in
the hidden slice, AUC wobbles by roughly ±0.07 between runs. The "finding" was a coin flip.

So the harness now: runs **five times** per scenario at different split points, reports the
**average and the spread**, prints the **noise floor** (how big a change has to be before it counts),
and **warns you in red** when a sample is too thin to trust. Re-run with the fix and popularity
drops to 0.464–0.520 — comfortably below the algorithm everywhere.

That was the harness earning its keep before it had even measured anything real. A tool that hands
you a confident wrong number is worse than no tool.

---

## How you'll use it on the next four changes

For each upgrade I'll give you a before-and-after table. A change only counts if it moves AUC by
more than the noise floor shown under each table. If it doesn't, I'll tell you it didn't, and we
either dig further or drop it.

If you want more precision at any point, the fix is more runs — the noise floor shrinks with the
square root of the run count.

---

## Testing

37 assertions, all passing, plus all 141 earlier ones still green. Notably:

- the AUC maths is verified against cases with known answers — perfect ranking = 1.0, exactly
  inverted = 0.0, all-tied = 0.5 (ties are rank-averaged, or they'd inflate the score)
- running a test leaves your live session **byte-identical** — it borrows the state, then restores it
- the same session produces the same number twice, and the same seed regenerates the same session
  (a measurement tool that drifts between runs is useless)
- it **refuses** to report a number from too few swipes rather than printing something meaningless
- the dev button is invisible without the flag

---

## Your call

Options, and I'm happy with any of them:

- **Keep it as is** → I move on to upgrade 2 (category weight instead of the ban).
- **Change something** — different metrics, different personas, always-visible button, a real
  A/B toggle in the UI, whatever.
- **Delete it** → remove the three `UPGRADE 1` blocks. I'd then do the remaining four changes
  without measurement, and I'd have to describe them as "should be better" rather than "is better".
