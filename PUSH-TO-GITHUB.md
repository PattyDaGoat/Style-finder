# Getting this onto GitHub

The repo is already a real git repo with history — it just has no remote yet. I can't create one
for you: the GitHub token in my environment is a placeholder that doesn't authenticate, and I
shouldn't be making repos under your account anyway. This is the one step that needs you, and it
takes about two minutes.

---

## 1. Unzip it somewhere sensible

Put it wherever you keep code — **not** inside `Outputs/`, since that folder is for generated
files and I've been overwriting things in it.

```
cd ~/Desktop
unzip style-finder-repo.zip -d style-finder
cd style-finder
git log --oneline          # you should see one commit
```

## 2. Make an empty repo on GitHub

Go to **https://github.com/new**. Name it `style-finder`. **Leave every checkbox off** — no
README, no .gitignore, no licence. You want it completely empty, or the first push will be
rejected for having unrelated history.

**Public or private?** If you want the clickable preview link (`GITHUB-PAGES-PREVIEW.md`), the
repo has to be **public** — GitHub Pages on the free plan only serves public repos; private-repo
Pages needs a paid plan. Nothing in this repo is a secret (no API keys or passwords are
committed anywhere), so going public costs you nothing but "anyone with the link can read the
code." If you don't want the preview link, private is still fine.

## 3. Push

GitHub will show you the exact commands. They'll look like this — substitute your username:

```
git remote add origin https://github.com/YOUR-USERNAME/style-finder.git
git push -u origin main
```

It will ask for a username and password. **Your GitHub password will not work** — GitHub stopped
accepting passwords for git in 2021. You need a **personal access token** instead:

1. https://github.com/settings/tokens → **Generate new token (classic)**
2. Note: `style-finder`. Expiry: 90 days is sensible.
3. Tick **`repo`** — that one checkbox is all you need.
4. Generate, and **copy it immediately** — GitHub never shows it again.
5. Paste it as the *password* when git asks. Username is your GitHub username.

To avoid re-typing it every push:

```
git config --global credential.helper osxkeychain
```

macOS then stores it in your keychain after the first push.

## 4. Check it worked

```
git remote -v
git log --oneline origin/main
```

---

## Then agents can work in parallel

Once it's on GitHub, copy `docs/AGENT-QUICKSTART.md` into the other agent's prompt — it's the
full version of this instruction (branch naming, the never-edit-`dist/` rule, the test-before-
commit step, opening a PR instead of pushing to `main`) with nothing left implicit. The short
version, if you just want the idea:

> Clone https://github.com/YOUR-USERNAME/style-finder, read CONTRIBUTING.md, work on a branch,
> run `npm test` before committing, and open a pull request.

Give each agent a **different area** so they don't collide — `CONTRIBUTING.md` has the map of
which module does what. A good split is one agent on the algorithm (`50-taste-model.js`,
`55-results.js`) and another on presentation (`src/css/*`, `20-photo-focus.js`).

You'll need to give each agent the token so it can push. Treat that token like a password: it can
write to your repos. Revoke it at https://github.com/settings/tokens when you're done.

---

## What to do with the old copy

`Outputs/menswear-style-profiler/style-finder.html` is now a **dead end**. It's the same bytes as
`dist/style-finder.html` in the repo, but nothing keeps them in sync, and two copies drifting apart
is exactly the problem you flagged.

Once the repo is pushed, either delete that folder or rename it `_legacy-do-not-edit`. From then
on there's one source of truth. (I can't delete files on your machine — the bridge doesn't allow
it — so this one's yours.)
