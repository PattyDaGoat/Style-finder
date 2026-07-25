# MAISON / EDIT — Style Finder

Swipe real clothing from 367 niche labels; the app learns your taste and recommends pieces you
didn't see. 9,306 products, menswear and womenswear, no backend required.

**Live preview:** `https://YOUR-USERNAME.github.io/style-finder/` — see `GITHUB-PAGES-PREVIEW.md`
to turn this on (two one-time settings, ~2 minutes). Auto-updates on every push to `main`.

**Run it locally:** open `dist/style-finder.html`. That's the whole app in one file.

---

## Why there's a build step

The shipped app is deliberately a single 3.6MB file you can double-click. That's lovely to use
and impossible to collaborate on: 3.5MB of it is one line of JSON, so every edit collides and a
merge conflict inside that line cannot be resolved by hand or by git.

So the **source** is modular and the **output** is one file.

```
npm install          # once, for playwright (tests only)
npm run build        # src/ + data/  ->  dist/style-finder.html
npm test             # build, then 221 assertions across 5 suites
npm run serve        # serve dist/ on http://localhost:8000 (needed for Google sign-in)
```

The split is provably lossless: it was verified by rebuilding and confirming the output was
byte-for-byte identical to the original monolith.

---

## What it does

- **Swipe** — love / like / skip on real products with live photos and prices. The feed adapts as
  you go and never runs out.
- **Learns** a profile across 20 micro-styles, colours, patterns, fabrics, fits and brands,
  weighted so rare traits count for more, and blended with how close a piece is to the specific
  things you loved.
- **Results** — your top micro-styles, and new pieces you didn't swipe, each with a reason.
- **Two carts** — super-liked pieces and a separate liked list, with a best-effort sold-out check.
- **Inspiration** — point it at a Pinterest board or drop in photos; it reads their colours on
  your device and uses them to shape the first ~20 swipes.
- **Accounts** — sign in with Google (see `docs/GOOGLE-SIGNIN-SETUP.md`) or continue as guest.
  Each account keeps its own profile.
- **Start over** — clears the algorithm, likes, cart and sizes, back to first-run.

## Menswear stays menswear

Each piece's section is re-derived at startup from four signals, most trustworthy first: an
audience word in the name, a garment type only one gender wears, **the product's own URL**
(`/products/womens-…` — where the shop shelved it, which is also who modelled the photo), the
brand name, then the photo filename. A brand that is 85%+ one gender places its own leftovers.

Anything the listing can't place is held back from **both** decks by default — the toggle under
the deck lets you widen it. Result: zero confirmed cross-gender pieces in either section.

Details and the honest limits: `docs/SECTIONING-REVIEW.md`.

## Measuring the algorithm

There is a dev-only harness: open with `?eval=1` or press **Shift+E** three times. It hides the
last part of a swipe session, rebuilds the model from the rest, and checks whether the pieces you
actually liked come out on top — with baselines and a noise floor, so a change is only "better"
if it clears the margin of error. See `docs/UPGRADE-1-REVIEW.md`.

---

## Layout

```
build.mjs               src/ + data/ -> dist/
data/catalog.json       9,306 products, one per line
dist/style-finder.html  the app (generated — never edit)
src/shell/              html around the css and js
src/css/                8 stylesheets, concatenated in order
src/js/                 17 modules, concatenated in order
test/                   5 suites + run-all.mjs
tools/                  the scripts that produced the data
docs/                   design notes, change reviews, setup guides
fast-fashion-waste-chart.html   standalone chart on fast-fashion waste
```

**Working on this with more than one person or agent? Read `CONTRIBUTING.md` first** — it has the
file-ownership map that keeps concurrent edits from colliding.

## Roadmap

`docs/ALGORITHM-UPGRADES.md` has ten measured improvements ranked by value for effort. The next
four in the queue: category weight instead of a hard ban, category quotas in results, fixing a
similarity term that contributes 19% of the score while carrying almost no information, and a
negative-neighbour term.
