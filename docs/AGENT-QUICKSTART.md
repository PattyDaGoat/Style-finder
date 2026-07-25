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

**Repo:** `<PASTE THE GITHUB URL HERE (see PUSH-TO-GITHUB.md) — or a local folder path if it
hasn't been pushed to GitHub yet>`

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
   npm test         # rebuilds dist/ and runs the full test suite — it must pass
   npm run check    # confirms dist/ isn't stale
   ```

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

### Fill in the repo line before you paste this anywhere

Until `PUSH-TO-GITHUB.md` has been completed, there is no GitHub URL yet — use the local folder
path instead, but only for an agent that runs *on this computer* (Claude Code in a terminal,
Cursor, etc.). An agent running somewhere else — including another cloud Cowork session — cannot
see this computer's disk at all and needs the real GitHub URL to reach the repo. That's the one
thing worth double-checking before you copy this in.
