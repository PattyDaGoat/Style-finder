# Agent Quickstart — paste this into another bot's prompt

Everything below the line is written to be copied straight into the system/task prompt of
another coding agent (another Claude session, ChatGPT, Cursor, Copilot Workspace, a teammate's
CLI tool — anything that can run git and a shell). It tells that agent how to change this repo
without stepping on anyone else's work. It's the pasteable version of `CONTRIBUTING.md` — read
that file too if you want the reasoning and the full file-by-file map.

---

You're adding code to an existing project: **Style Finder**, a swipe-to-discover clothing
recommender app. Other agents may be working on this same repo at the same time. Follow this
exactly.

**Repo:** `https://github.com/PattyDaGoat/Style-finder`

1. Clone it and read `CONTRIBUTING.md` at the repo root before writing any code. It maps which
   file handles which feature. State which file(s) you're about to touch before you start, so a
   human running several agents at once can catch a collision before it happens.

2. Create a branch off `main` — never commit straight to `main`:
   ```
   git checkout -b <type>/<short-description>
   ```
   `<type>` is one of: `algo`, `ui`, `data`, `test`, `docs`, `fix`.

3. Make your change only inside `src/**` and `data/**` (and `test/**` if you're adding a test).
   **Never hand-edit `dist/style-finder.html`.** It's generated from `src/` and `data/` by
   `build.mjs`; the next build silently overwrites anything you put there directly.

4. Before committing:
   ```
   npm install      # first time only
   npx playwright install chromium   # first time only — the suites drive a real browser
   npm test         # rebuilds dist/ and runs the full test suite — it must pass
   npm run check    # confirms dist/ isn't stale
   ```
   The suite takes ~10 minutes and drives a real browser. If a suite reports
   "did not report", run it on its own (`node test/0X-name.js`) to see the actual
   error — the runner only surfaces the summary line. Set `PW_CHROMIUM` if you
   need to point at a specific Chromium binary.

5. Commit your source changes together with the regenerated `dist/style-finder.html`:
   ```
   git add -A
   git commit -m "<type>: <what changed and why>"
   ```

6. Push the branch and open a pull request against `main`. Don't merge it yourself unless you
   were explicitly told this task is allowed to merge on its own.
   ```
   git push -u origin <branch-name>
   ```

### Things that have already bitten someone

Written down because each one cost real debugging time, and none are obvious from
the diff.

- **The app is published, so "done" means live.** A push to `main` triggers
  `.github/workflows/deploy-pages.yml`, which rebuilds from source and republishes
  to https://pattydagoat.github.io/Style-finder/. A change sitting on a branch is
  not done. Before you report a fix, `curl` the live URL and grep for something
  unique to your change — a green build is not evidence the user can see it. And
  tell them to hard-reload; a cached file is indistinguishable from a failed deploy.

- **A syntax error anywhere in `src/js/**` looks like six broken test suites, not a
  syntax error.** Everything is concatenated into one inline `<script>`, so one stray
  character stops the whole file parsing and *every* global — `S`, `storeKey`,
  `buildModel` — is undefined. All six suites then time out in `settle()` and the runner
  prints `0 passed` for each, with `(did not report)` only in the last line. Nothing
  anywhere says "syntax error". Cost: one full 10-minute run to find a comment that had
  been closed one paragraph too early. Check it in a second before you spend the ten:

  ```
  cat src/js/*.js | node --check /dev/stdin
  ```

  Parsing is all it does — the files share one scope and reference each other's globals,
  which `--check` neither resolves nor complains about. That is exactly what you want here.

- **`dist/style-finder.html` is ~4MB.** Never open it whole. Grep it.

- **Timing lives in `SW` (`src/js/45-swipe-drag.js`).** Any test that reads state
  after a swipe must wait for `SW.flyMs`, not a hardcoded number — suites 01 and 06
  derive their waits from it. Hardcoding a wait means retuning the animation
  silently makes the suite flaky, which has happened.

- **Slowing an animation must never cost input.** The deck used to freeze for the
  whole fly-out, so a second swipe was dropped. The leaving card now animates in
  its own detached layer with the reaction committed immediately.

- **Cart and Liked are stored as CATALOG ARRAY INDICES.** Anything that reorders
  or removes catalog rows silently repoints every saved item at a different
  garment. `export.py` only appends for exactly this reason. If you prune, you
  own that problem.

- **Gender lives in code, not data.** `detectSection()` in `15-sectioning.js` is a
  hard gate — a row it disagrees with is invisible, whatever `g` says. The scraper
  mirrors it in `tools/scraper/gender.py:app_section()`; change one and you must
  change the other, then run `browse.py --reclassify`.

- **Another agent may be mid-work.** `git fetch` and check before you merge
  anything. Rebase onto their work rather than pushing over it.

---

### Why these rules (for the human reading this, not the agent)

- **Rule 3 — never edit `dist/`.** This is what makes parallel work possible at all. The old
  version of this app was a single 3.6MB file; two agents editing it directly would either
  overwrite each other's work or produce a merge conflict inside a giant blob that's practically
  impossible to resolve by hand. Splitting the source into `src/`/`data/` plus a build step means
  two agents touching *different* files merge cleanly — `CONTRIBUTING.md` has the actual before/
  after proof of that.
- **Rule 4 — `npm test` before committing.** This isn't a formality: the suite has already caught
  real bugs a glance at the diff would miss — a colour palette that's invisible to red-green
  colourblind readers, a measurement tool that reported statistical noise as a real finding. An
  agent that skips this can commit something that looks fine and isn't.
- **Rule 6 — pull request, not a direct push to `main`.** This is the actual safety net: nothing
  reaches the real app without a human (or another agent you trust) seeing the diff first. You
  can review it yourself, or point a second agent at the first agent's PR and ask it to check the
  work.

### If the agent can't push

Step 6 assumes the agent has some way to push a branch to GitHub. That's automatic for an agent
running *on this computer* (Claude Code in a terminal, Cursor, etc.) — it can use the same saved
GitHub login this repo was pushed with. An agent running somewhere else (another cloud session, a
teammate's machine) needs its own way in: either give it a GitHub personal access token with the
`repo` scope (see `PUSH-TO-GITHUB.md` for how to make one), or, if you'd rather not hand out a
token, let it finish the branch locally and have it tell you the exact `git push` command to run
yourself.

The repo is public, so any agent can clone it and read every file with no token at all — a token
is only needed for the push in step 6.
