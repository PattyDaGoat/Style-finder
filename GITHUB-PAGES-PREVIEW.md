# Turning this into a clickable preview link (GitHub Pages)

> **Status: already done for this repo.** It's live at
> **https://pattydagoat.github.io/Style-finder/** — the two steps below are already completed.
> This page is left in place as a reference for what was done, and in case you ever fork or
> recreate the repo and need to redo it.

This repo already contains a GitHub Actions workflow (`.github/workflows/deploy-pages.yml`) that
builds the app and publishes it to GitHub Pages automatically, every time `main` is updated. Two
one-time settings and it's live — nothing to run by hand, ever again.

---

## 1. The repo needs to be public

GitHub Pages is free, but only for **public** repositories on the free plan — Pages on a private
repo needs a paid plan (Pro/Team/Enterprise Cloud). That's a real constraint, not a nag screen, so
it's worth saying plainly: nothing in this repo is a secret. There's no API key or password
committed anywhere. If you later add a real Google Sign-In Client ID, that value is *meant* to be
public — Google sends it to the browser on every page load regardless of who's looking at the
repo. So going public here costs you "anyone with the link can read the code," which for a
portfolio-style project is usually a feature, not a risk.

- Already created the repo as private (per `PUSH-TO-GITHUB.md`)? **Settings → General → Danger
  Zone → Change visibility → Make public.**
- Haven't created it yet? Just don't tick "Private" when you create it.

## 2. Turn on Pages, once

**Settings → Pages** (left sidebar) → under **Build and deployment** → **Source** → choose
**GitHub Actions** (not "Deploy from a branch" — that older option would try to serve the raw repo
instead of running the build).

That's the whole setup. The workflow already sitting in this repo takes it from there.

## 3. What happens on every push

`.github/workflows/deploy-pages.yml` runs automatically on every push to `main`:

1. Checks out the repo
2. Runs `node build.mjs` — the exact build that produces `dist/style-finder.html` — fresh, from
   whatever is in `src/` and `data/` at that commit (not just whatever was last committed to
   `dist/`, so it's correct even if someone forgot to rebuild before committing)
3. Publishes the result to GitHub Pages

The first run takes about a minute after you push. Watch it under the repo's **Actions** tab. Once
it's green, the link is:

```
https://YOUR-USERNAME.github.io/style-finder/
```

Substitute the GitHub username you pushed with, and the repo name from step 2 of
`PUSH-TO-GITHUB.md` (`style-finder`, if you used the suggested name). GitHub also prints the exact
URL at the bottom of **Settings → Pages** once the first deploy finishes.

## What this link is, and isn't

- It's the **real app**, fully working — swipe, results, both carts, all of it. Not a screenshot,
  not a mockup.
- It auto-updates within a minute or two of anyone pushing to `main`. Nobody has to remember to
  redeploy.
- It's a `github.io` address, not a custom domain — a preview link, not a "launch." That's the
  "works but isn't live" you asked for.
- Profiles, likes, and the "Start over" reset are stored in the browser you open it in
  (`localStorage`) — same as the local file. Opening the link on your phone and your laptop gives
  two separate profiles, not a shared one.
- **If** you've already set up real Google Sign-In (`docs/GOOGLE-SIGNIN-SETUP.md` — the app also
  works fine in guest mode without this): add this new `github.io` address to the OAuth client's
  **Authorized JavaScript origins** in
  [Google Cloud Console](https://console.cloud.google.com/apis/credentials). Google checks the
  exact domain a sign-in request comes from, so a client ID authorized for
  `http://localhost:8000` won't also work from the published link until you add it there too.

## A second thing this unlocks for free

Once the repo is public, `https://github.com/YOUR-USERNAME/style-finder` is itself a clickable,
browsable view of every file and folder on github.com — no extra setup beyond the push. That's
the "preview of the GitHub folder" half of the original ask; the Pages link above is the "preview
app that works" half.
