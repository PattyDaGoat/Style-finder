#!/usr/bin/env python3
"""
update-catalog.py — one command that refreshes the whole app.

    python tools/update-catalog.py

That's it. It finds new clothes, adds them to the app, rebuilds it, and opens
it. No GitHub account, no browser, no setup — the first run installs whatever
is missing.

WHAT IT DOES, IN ORDER
  1. Installs anything missing (headless browser, Node) into .tools/ — once.
  2. Crawls shops for clothes you don't have yet.
  3. Adds the best of them to the catalogue, clothes only.
  4. Rebuilds style-finder.html.
  5. Saves the change to git (on your machine).
  6. Opens the updated app.

It will not touch GitHub unless you ask:
    python tools/update-catalog.py --push

USEFUL SWITCHES
    --shops 25       crawl more shops (default 15, each takes ~1-2 min)
    --add 40         add more pieces per gender (default 15)
    --quick          crawl 5 shops — a fast check that everything works
    --push           also upload to GitHub (asks you to sign in the first time)
    --no-open        don't open the app at the end
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
import zipfile

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
SCRAPER = os.path.join(HERE, "scraper")
TOOLS = os.path.join(REPO, ".tools")          # downloaded bits live here, gitignored
APP = os.path.join(REPO, "dist", "style-finder.html")


# --- talking to the user ------------------------------------------------------
def step(n, total, msg):
    print(f"\n\033[1m[{n}/{total}] {msg}\033[0m", flush=True)


def ok(msg):
    print(f"      {msg}", flush=True)


def warn(msg):
    print(f"      ! {msg}", flush=True)


def die(msg):
    print(f"\n  Stopped: {msg}\n", flush=True)
    sys.exit(1)


def run(cmd, cwd=None, env=None, quiet=False):
    """Run a command, streaming its output. Returns (ok, output)."""
    p = subprocess.Popen(cmd, cwd=cwd, env=env, stdout=subprocess.PIPE,
                         stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                         errors="replace", bufsize=1)
    lines = []
    for line in p.stdout:
        lines.append(line)
        if not quiet:
            print("      " + line.rstrip(), flush=True)
    p.wait()
    return p.returncode == 0, "".join(lines)


# --- step 1: make sure the machine has what it needs --------------------------
def ensure_playwright():
    try:
        import playwright  # noqa: F401
    except ImportError:
        ok("installing the headless browser driver (one time)...")
        good, _ = run([sys.executable, "-m", "pip", "install", "--quiet", "playwright"])
        if not good:
            die("could not install playwright. Try: python -m pip install playwright")
    # the browser binary itself — cheap to re-check, downloads only if absent
    good, out = run([sys.executable, "-m", "playwright", "install", "chromium"], quiet=True)
    if not good:
        die("could not download Chromium. Check your internet connection.")
    ok("headless browser ready")


def ensure_node():
    """Return the full path to node.exe, downloading a portable copy if needed.

    The full path matters on Windows: subprocess resolves a bare "node" against
    the PATH of *this* process, not against any PATH handed to it in `env`, so
    a portable copy is invisible unless it is named outright.
    """
    found = shutil.which("node")
    if found:
        ok(f"node found: {found}")
        return found

    existing = [d for d in (os.listdir(TOOLS) if os.path.isdir(TOOLS) else [])
                if d.startswith("node-")]
    if existing:
        node_dir = os.path.join(TOOLS, sorted(existing)[-1])
    else:
        ok("Node isn't installed — fetching a portable copy into .tools/ (one time, ~30 MB)")
        os.makedirs(TOOLS, exist_ok=True)
        try:
            index = json.load(urllib.request.urlopen(
                "https://nodejs.org/dist/index.json", timeout=90))
            rel = next(r for r in index
                       if r.get("lts") and "win-x64-zip" in r.get("files", []))
            version = rel["version"]
            url = f"https://nodejs.org/dist/{version}/node-{version}-win-x64.zip"
            zip_path = os.path.join(TOOLS, "node.zip")
            urllib.request.urlretrieve(url, zip_path)
            with zipfile.ZipFile(zip_path) as z:
                z.extractall(TOOLS)
            os.remove(zip_path)
            node_dir = os.path.join(TOOLS, f"node-{version}-win-x64")
        except Exception as exc:
            die("could not download Node ({}). Install it from nodejs.org and "
                "run this again.".format(type(exc).__name__))

    node_exe = shutil.which("node", path=node_dir)
    if not node_exe:
        die("downloaded Node but can't find node.exe inside it")
    ok(f"using portable node from {os.path.relpath(node_dir, REPO)}")
    return node_exe


# --- the pipeline -------------------------------------------------------------
CATALOG = os.path.join(REPO, "data", "catalog.json")


def sanity_check():
    """Fast checks on the data before it is saved. Returns a list of problems.

    Not a replacement for `npm test` — that needs the developer setup. These are
    the checks that actually matter for a data refresh, and they cost a fraction
    of a second.
    """
    import re
    problems = []
    try:
        with open(CATALOG, encoding="utf-8") as fh:
            text = fh.read()
        rows = json.loads(text)
    except Exception as exc:
        return ["data/catalog.json is not valid JSON ({})".format(exc)]

    # build.mjs asserts one product per line, so a stray newline breaks the app
    body = [ln for ln in text.strip().splitlines()[1:-1] if ln.strip()]
    if len(body) != len(rows):
        problems.append("catalog is not one product per line ({} lines, {} products)"
                        .format(len(body), len(rows)))

    missing = [r for r in rows if not r.get("img") or not r.get("u") or not r.get("n")]
    if missing:
        problems.append("{} pieces are missing a photo, name or link".format(len(missing)))

    banned = re.compile(r"\b(socks?|boxer briefs?|underwear|lingerie|panties)\b", re.I)
    strays = [r["n"] for r in rows if banned.search(r.get("n", ""))]
    if strays:
        problems.append("{} non-clothing pieces got in, e.g. {!r}".format(
            len(strays), strays[0][:50]))

    ungendered = [r for r in rows if r.get("g") not in ("m", "f", "u")]
    if ungendered:
        problems.append("{} pieces have no section".format(len(ungendered)))
    return problems


def count_catalog():
    try:
        with open(os.path.join(REPO, "data", "catalog.json"), encoding="utf-8") as fh:
            rows = json.load(fh)
        return len(rows), len({r["b"] for r in rows})
    except Exception:
        return 0, 0


def notify(title, message):
    """A Windows toast, so an unattended run still tells you it finished."""
    if not sys.platform.startswith("win"):
        return
    import base64
    ps = f"""
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime] | Out-Null
$t = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent(
        [Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$n = $t.GetElementsByTagName('text')
$n.Item(0).AppendChild($t.CreateTextNode('{title}')) | Out-Null
$n.Item(1).AppendChild($t.CreateTextNode('{message}')) | Out-Null
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier(
    'Microsoft.Windows.Explorer').Show([Windows.UI.Notifications.ToastNotification]::new($t))
"""
    try:
        subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-EncodedCommand",
                        base64.b64encode(ps.encode("utf-16-le")).decode("ascii")],
                       capture_output=True, timeout=25)
    except Exception:
        pass


TASK_NAME = "Style Finder catalogue"


def _powershell(script):
    """Run a PowerShell snippet, passed base64-encoded so quoting can't bite."""
    import base64
    encoded = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
    return subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
        capture_output=True, text=True)


def _ps_quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def schedule_self(hours=3, task_name=None):
    """Ask Windows to run this every few hours, so you never run it by hand.

    Registered through PowerShell's scheduler API rather than schtasks.exe:
    schtasks takes the whole command as one /TR string, which falls apart the
    moment a path contains a space — and this repo lives under "Claude Cowork".
    """
    task_name = task_name or TASK_NAME
    if not sys.platform.startswith("win"):
        die("automatic scheduling is Windows-only here. On a Mac or Linux, add a "
            "cron line for: {} {} --no-open".format(sys.executable, os.path.abspath(__file__)))

    script = """
$ErrorActionPreference = 'Stop'
$action  = New-ScheduledTaskAction -Execute {py} -Argument {argline} -WorkingDirectory {repo}
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(3) `
             -RepetitionInterval (New-TimeSpan -Hours {hours}) `
             -RepetitionDuration (New-TimeSpan -Days 3650)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
              -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
              -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName {name} -Action $action -Trigger $trigger `
    -Settings $settings -Description 'Refreshes the Style Finder clothes catalogue.' `
    -Force | Out-Null
'REGISTERED'
""".format(py=_ps_quote(sys.executable),
           argline=_ps_quote('"{}" --no-open'.format(os.path.abspath(__file__))),
           repo=_ps_quote(REPO),
           hours=int(hours),
           name=_ps_quote(task_name))

    result = _powershell(script)
    if result.returncode != 0 or "REGISTERED" not in (result.stdout or ""):
        die("Windows would not create the task:\n      "
            + (result.stderr or result.stdout).strip()[:400])
    print(f"\n  Done. Windows will refresh your catalogue every {hours} hours,")
    print("  quietly in the background, whenever your computer is on.")
    print("  The first run starts in about 3 minutes.")
    print("\n  To stop it:   python tools/update-catalog.py --unschedule")
    print(f"  To see it:    Task Scheduler -> \"{task_name}\"\n")


def unschedule_self(task_name=None):
    task_name = task_name or TASK_NAME
    result = _powershell(
        "$ErrorActionPreference='Stop'\n"
        "Unregister-ScheduledTask -TaskName {} -Confirm:$false\n'REMOVED'".format(
            _ps_quote(task_name)))
    if result.returncode != 0 or "REMOVED" not in (result.stdout or ""):
        die("could not remove it (was it scheduled?):\n      "
            + (result.stderr or result.stdout).strip()[:300])
    print("\n  Stopped. It will no longer run on its own.\n")


def main():
    ap = argparse.ArgumentParser(add_help=True,
                                 description="Refresh the Style Finder app with new clothes.")
    ap.add_argument("--schedule", nargs="?", const=3, type=int, metavar="HOURS",
                    help="run automatically every N hours from now on (default 3)")
    ap.add_argument("--unschedule", action="store_true",
                    help="stop it running automatically")
    ap.add_argument("--shops", type=int, default=15, help="shops to crawl (default 15)")
    ap.add_argument("--add", type=int, default=15, help="pieces per gender to add (default 15)")
    ap.add_argument("--quick", action="store_true", help="crawl only 5 shops")
    ap.add_argument("--push", action="store_true", help="also upload to GitHub")
    ap.add_argument("--no-open", action="store_true", help="don't open the app afterwards")
    ap.add_argument("--find-brands", action="store_true",
                    help="also look for brands the app doesn't carry yet")
    args = ap.parse_args()

    # These just talk to Windows Task Scheduler and exit — no crawling.
    if args.unschedule:
        return unschedule_self()
    if args.schedule:
        return schedule_self(args.schedule)

    if args.quick:
        args.shops = 5

    total = 7 + (1 if args.push else 0) + (1 if args.find_brands else 0)
    stage = {"n": 0}

    def next_step(msg):
        stage["n"] += 1
        step(stage["n"], total, msg)

    started = time.time()
    before_items, before_brands = count_catalog()

    print("\n\033[1mStyle Finder — updating your catalogue\033[0m")
    print(f"  right now: {before_items:,} pieces from {before_brands:,} brands")

    next_step("Checking what's installed")
    ensure_playwright()
    node_exe = ensure_node()

    if args.find_brands:
        next_step("Looking for brands you don't have yet")
        run([sys.executable, "find_brands.py", "--write"], cwd=SCRAPER)

    next_step(f"Crawling {args.shops} shops for clothes  "
              f"(a few minutes — leave it running)")
    good, _ = run([sys.executable, "browse.py", "--crawl",
                   "--shops", str(args.shops), "--verbose"], cwd=SCRAPER)
    if not good:
        warn("the crawl hit a problem, but anything it did find is saved — carrying on")

    next_step(f"Adding the best {args.add} per section to the app")
    good, out = run([sys.executable, "export.py", "--promote", str(args.add)], cwd=SCRAPER)
    if not good:
        die("could not add the new pieces. The output above says why.")
    nothing_new = "nothing new to add" in out

    next_step("Checking the new pieces")
    problems = sanity_check()
    if problems:
        for p in problems:
            warn(p)
        die("the new pieces look wrong, so nothing was saved. Undo the last "
            "change with:  git checkout data/catalog.json")
    ok("catalogue looks right")

    next_step("Rebuilding the app")
    good, _ = run([node_exe, "build.mjs"], cwd=REPO)
    if not good:
        die("the rebuild failed. Nothing was changed.")

    next_step("Saving the change")
    if nothing_new:
        ok("no new pieces this time — nothing to save")
    else:
        after_items, after_brands = count_catalog()
        subprocess.run(["git", "add", "data/catalog.json", "dist/style-finder.html",
                        "tools/scraper/sites.json", "tools/scraper/stores.json"], cwd=REPO)
        staged = subprocess.run(["git", "diff", "--cached", "--name-only"], cwd=REPO,
                                capture_output=True, text=True).stdout.strip()
        if staged:
            added = after_items - before_items
            subprocess.run(["git", "commit", "-q", "-m",
                            f"data: +{added} products from a local crawl"], cwd=REPO)
            ok(f"saved to git ({added:+,} pieces)")
        else:
            ok("nothing changed")

    next_step("Done")
    after_items, after_brands = count_catalog()
    mins = (time.time() - started) / 60
    print(f"\n      pieces  {before_items:,}  ->  {after_items:,}   ({after_items - before_items:+,})")
    print(f"      brands  {before_brands:,}  ->  {after_brands:,}   ({after_brands - before_brands:+,})")
    print(f"      took {mins:.1f} min")

    if args.push:
        next_step("Uploading to GitHub")
        print("      (the first time, a browser window will ask you to sign in — "
              "after that it never asks again)")
        good, out = run(["git", "push"], cwd=REPO)
        if good:
            ok("uploaded")
        else:
            warn("upload didn't work. Everything is saved on your computer — "
                 "you can try again any time with:  git push")

    notify("Style Finder updated",
           f"{after_items:,} pieces from {after_brands:,} brands "
           f"({after_items - before_items:+,} new).")

    if not args.no_open and os.path.exists(APP):
        print(f"\n      opening {os.path.relpath(APP, REPO)}\n")
        try:
            # os.startfile only exists on Windows, so on a Mac this silently
            # fell through to "open it yourself" instead of opening anything.
            if sys.platform.startswith("win"):
                os.startfile(APP)                      # noqa: F821 (Windows only)
            elif sys.platform == "darwin":
                subprocess.run(["open", APP], check=False)
            else:
                subprocess.run(["xdg-open", APP], check=False)
        except Exception:
            print(f"      open it yourself: {APP}\n")
    else:
        print()


if __name__ == "__main__":
    main()
