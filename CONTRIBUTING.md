# Working on this project — including with several agents at once

The whole point of the layout below is that **two people (or two agents) can work at the
same time without overwriting each other.** Three rules make that true. Please don't skip them.

> **Bringing in another agent?** `docs/AGENT-QUICKSTART.md` is a ready-to-paste version of
> everything on this page — copy it straight into that agent's prompt instead of summarizing
> this file by hand.

---

## The three rules

### 1. Never edit `dist/`

`dist/style-finder.html` is **generated**. It is the 3.6MB single file you double-click, and it
is rebuilt from `src/` and `data/` by `node build.mjs`. Editing it directly means your change is
destroyed by the next build, and it's the one file guaranteed to conflict with everyone else.

Edit `src/**` or `data/**`. Then run the build.

### 2. Claim files, not features

Because everything ends up concatenated into one scope, two agents editing the *same module*
will conflict. Two agents editing *different modules* will not. So before starting, say which
files you're taking. The map is below.

### 3. `npm test` before every commit

```
npm test          # builds, then runs all 6 suites (289 assertions)
```

It takes a few minutes and it has caught eight real bugs that code review missed — a drag
handler swallowing button clicks, a colour palette invisible to red‑green colourblind readers,
chart text shrinking to 5px on a phone, a measurement tool reporting noise as a finding. If it's
red, don't commit.

---

## What lives where

```
build.mjs              glues src/ + data/ into dist/. Read the comment at the top before touching.
data/catalog.json      9,306 products, ONE PER LINE. Generated data — see the warning below.
dist/style-finder.html generated. Never edit.
src/shell/*.html       the HTML around the CSS and JS (head, body, tail)
src/css/*.css          concatenated in filename order
src/js/*.js            concatenated in filename order
test/                  five suites + run-all.mjs
tools/                 one-off scripts that generated the data
docs/                  design notes and change reviews
```

### The JavaScript modules, and who should touch what

Order is load-bearing — these are plain scripts sharing one global scope, not ES modules, so
`50-taste-model.js` can use things defined in `10-helpers.js` but not the reverse. **If you
renumber, run the tests.**

| File | Contains | Touch it when |
|---|---|---|
| `00-catalog-alias.js` | `PIECES` alias | almost never |
| `05-microstyles.js` | the 20 micro-style names, blurbs, category labels | adding a style or renaming labels |
| `10-helpers.js` | formatting, image URL helpers, `baseTitle` dedupe | shared utilities |
| `15-sectioning.js` | **menswear/womenswear detection** — name, URL, filename, brand tiers, strict toggle | anything about which section a piece belongs in |
| `20-photo-focus.js` | which part of the photo is the product; the highlight frame | the on-card highlight |
| `25-state-accounts.js` | `S`, storage keys, per-account profiles | saving, accounts, migrations |
| `30-settings.js` | sizes, categories, occasion, budget, filters | the two setup screens, `passesFilters` |
| `35-inspiration.js` | Pinterest / photo colour reading | the inspiration board |
| `40-deck.js` | the endless queue, `nextBatch`, card rendering | the swipe feed and exploration |
| `45-swipe-drag.js` | drag, stamps, animation | swipe feel |
| `50-taste-model.js` | **the scoring engine** — `buildModel`, `profileScore`, `simItem`, `knnScore`, `hybrid`, `diversify` | any algorithm change |
| `55-results.js` | the results page, `computeRec`, `whyMatch` | recommendations and explanations |
| `60-cart-and-stock.js` | the two carts, sold-out checks | cart behaviour |
| `65-brand-links-export.js` | brand links, DNA export | small utilities |
| `70-auth-ui.js` | sign-in screen, Google, top bar, Start over | accounts and the app bar |
| `80-eval-harness.js` | the dev-only measurement panel | changing how the algorithm is measured |
| `90-boot.js` | startup routing | almost never |

**Good parallel splits.** One agent on `50-taste-model.js` + `55-results.js` (algorithm) while
another is on `src/css/*` + `20-photo-focus.js` (presentation). Zero overlap, clean merge.

**Bad parallel split.** Two agents both "improving recommendations" — they'll both open
`50-taste-model.js`.

---

## About `data/catalog.json`

It is one product per line **on purpose**: a single product edit shows as a one-line diff instead
of rewriting a 3.5MB blob. Keep it that way — the build strips the newlines when it inlines the
array, and it asserts one product per line.

**Don't hand-edit it in bulk.** It was produced by `tools/clean-catalog.py`, which drops
non-apparel, repairs categories, and assigns gender. If you need a sweeping change, change the
tool and re-run it, so the change is reproducible and reviewable.

**Live gender/section logic is in `src/js/15-sectioning.js`, not in the data.** That's deliberate:
the app re-derives each piece's section at startup from the product name, its URL, the photo
filename and the brand, so a bad tag in the data cannot put a dress in the men's deck. Fix the
detector, not the row.

---

## Measuring an algorithm change

Don't claim a change improved recommendations. Show it.

1. Open `dist/style-finder.html?eval=1` (or press **Shift+E** three times).
2. Click **Test on 3 simulated shoppers**. Note the headline AUC.
3. Make your change, rebuild, re-run.
4. A change only counts if AUC moves by more than the **noise floor** printed under each table.

The current baseline, for reference:

| Scenario | AUC | P@10 | run-to-run spread |
|---|---|---|---|
| Neutral minimalist | 0.838 | 83% | ±0.020 |
| Bold streetwear | 0.729 | 85% | ±0.033 |
| Earthy womenswear | 0.749 | 86% | ±0.058 |
| Mid-range minimalist | 0.800 | 84% | ±0.035 |
| **overall** | **0.779** | | |

Two of those rows moved without the recommender changing, so don't read them as a gain.
Bold streetwear was 0.701 and Earthy womenswear 0.735 when they were last written down; the
catalogue has grown from 9,306 products to 9,837 since, and the personas swipe a different
deck as a result. Measured with the price band switched off they sit at 0.730 and 0.748 —
i.e. the whole of that movement is the new data, none of it the price band. Re-measure
rather than trusting a number written against a smaller catalogue.

"Mid-range minimalist" is new, added with the price band, because the three above express
no price preference at all and cannot measure one. It is also the reason the overall
average is not comparable to the older 0.737/0.758 figures — different set of scenarios.

Earthy womenswear moved 0.675 → 0.735 and Bold streetwear's P@10 75% → 79% when
`reactW` began scaling with the shopper's own right-vs-left swipe ratio. Note
the headline average (0.737 → 0.758, +0.021) does **not** clear the worst-case
noise floor of 0.029 on its own — the result is carried by the per-persona
numbers, where Earthy clears its own floor on 6 of 6 independent seed sets, and
by P@10, which is the part a swiper actually sees.

These moved when the eval was given enough data to be meaningful (12 runs of
1280 swipes, up from 5 of 320). The old numbers were measured from as few as
**8** liked pieces in the holdout, so their spread was ±0.035–0.148 — wider than
most changes anyone would want to detect, which meant the noise floor was doing
the deciding. The new numbers are the same measurement taken properly, not a
change in the recommender: nothing in `50-taste-model.js` moved. Narrow tastes
genuinely score lower than broad ones (Bold streetwear, a menswear persona, sits
at the same ~0.70 as the womenswear one) — that is a property of niche
preferences, not of a section.

To compare a variant side by side, add a row to `EV_SCORERS` in `80-eval-harness.js`. Leave the
`current` row alone so every future change is measured against the same reference.

---

## Commit and branch conventions

```
git checkout -b algo/price-preference      # area/short-description
npm test
git commit -m "algo: learn a price band from swipes"
```

Prefixes in use: `algo/`, `ui/`, `data/`, `test/`, `docs/`, `fix/`.

Commit `dist/style-finder.html` **along with** your source change, so anyone who pulls gets a
working file without needing node. `npm run check` fails if `dist/` is stale — run it before you
push.

---

## Reverting a feature

Recent features are wrapped in marked blocks so they can be pulled out cleanly:

- `UPGRADE 1` — the evaluation harness (CSS, HTML, and `80-eval-harness.js`)
- `SECTIONING` — strict section matching and the extra detection signals
- The account system and Start over button are in `70-auth-ui.js` / `25-state-accounts.js`

Delete the marked block, rebuild, run the tests.
