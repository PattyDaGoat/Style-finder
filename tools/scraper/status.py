"""Am I still crawling, is it working, and what do I do next?

A crawl is quiet for long stretches — it is one page at a time on purpose — so
there is no way to tell "working" from "hung" by watching the terminal.

    python3 status.py            one-shot: what is happening right now
    python3 status.py --watch    sit here and alert me when the crawl finishes

--watch pops a macOS notification and plays a sound the moment the crawl ends,
so you can go and do something else. It attaches to a crawl that is already
running, so it is safe to start halfway through.
"""

import argparse
import os
import sqlite3
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
DB = os.path.join(HERE, "catalog.db")


def running(pattern):
    """-> elapsed time string, or None. Uses pgrep so it needs no extra deps."""
    try:
        pid = subprocess.run(["pgrep", "-f", pattern], capture_output=True,
                             text=True).stdout.split()
        if not pid:
            return None
        out = subprocess.run(["ps", "-o", "etime=", "-p", pid[0]],
                             capture_output=True, text=True).stdout.strip()
        return out or "running"
    except Exception:
        return None


def notify(title, message, sound="Glass"):
    """macOS notification + sound. Silent no-op anywhere else, and never fatal —
    an alert failing must not take the crawl down with it."""
    if sys.platform != "darwin":
        print("\a", end="", flush=True)          # terminal bell as a fallback
        return
    esc = lambda s: s.replace("\\", "\\\\").replace('"', '\\"')
    script = 'display notification "{}" with title "{}" sound name "{}"'.format(
        esc(message), esc(title), sound)
    try:
        subprocess.run(["osascript", "-e", script], timeout=10,
                       capture_output=True)
    except Exception:
        print("\a", end="", flush=True)


def pool_counts():
    if not os.path.exists(DB):
        return 0, 0, 0
    c = sqlite3.connect(DB)
    q = lambda s: c.execute(s).fetchone()[0]
    return (q("SELECT COUNT(*) FROM products WHERE via IS NOT NULL AND via != 'feed'"),
            q("SELECT COUNT(*) FROM products WHERE in_app = 0 AND via IS NOT NULL AND via != 'feed'"),
            q("SELECT COUNT(DISTINCT src) FROM products"))


def watch(poll=30):
    """Block until the crawl ends, then alert. Prints a line every few minutes so
    you can see it is still alive."""
    if not running("browse.py --crawl"):
        print("\n  No crawl is running — nothing to wait for.")
        print("  Start one:  python3 browse.py --crawl --shops 20\n")
        return
    start = time.time()
    before = pool_counts()[0]
    print("\n  Watching the crawl. Leave this window open — you'll get a "
          "notification when it finishes.")
    print("  (Ctrl-C to stop watching; it won't stop the crawl.)\n")
    last_report = 0
    try:
        while running("browse.py --crawl"):
            time.sleep(poll)
            mins = (time.time() - start) / 60
            if mins - last_report >= 5:         # a heartbeat every 5 minutes
                total, fresh, shops = pool_counts()
                print("    {:>3.0f} min — {} products from {} shops "
                      "(+{} since watching)".format(mins, total, shops,
                                                    total - before))
                last_report = mins
    except KeyboardInterrupt:
        print("\n  Stopped watching. The crawl is still running.\n")
        return

    total, fresh, shops = pool_counts()
    gained = total - before
    mins = (time.time() - start) / 60
    msg = "{} products ready to publish, from {} shops.".format(fresh, shops)
    notify("Style Finder — crawl finished", msg)
    print("\n  " + "=" * 58)
    print("  CRAWL FINISHED after {:.0f} min — {} new products this session."
          .format(mins, gained))
    print("  {} products waiting to be published.".format(fresh))
    print("  " + "=" * 58)
    if fresh:
        print("\n  Next:")
        print("    python3 export.py --promote 200")
        print('    cd "{}" && npm test && git add -A && git commit -m "data: new scraper batch" && git push'
              .format(REPO))
    print()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--watch", action="store_true",
                    help="wait here and alert when the crawl finishes")
    ap.add_argument("--test-alert", action="store_true",
                    help="fire a sample notification, to check they're allowed")
    args = ap.parse_args()

    if args.test_alert:
        notify("Style Finder", "Notifications are working.")
        print("\n  Sent a test notification. If nothing appeared, allow them for")
        print("  your terminal in System Settings > Notifications.\n")
        return
    if args.watch:
        return watch()

    print()
    crawl = running("browse.py --crawl")
    tests = running("run-all.mjs")

    if crawl:
        print("  CRAWLING — running for {}".format(crawl))
    else:
        print("  No crawl running.")
    if tests:
        print("  Tests are running ({}).".format(tests))

    if not os.path.exists(DB):
        print("\n  No pool yet. Start one:")
        print("    python3 browse.py --crawl --shops 20\n")
        return

    c = sqlite3.connect(DB)
    q = lambda s: c.execute(s).fetchone()[0]
    total = q("SELECT COUNT(*) FROM products WHERE via IS NOT NULL AND via != 'feed'")
    fresh = q("SELECT COUNT(*) FROM products WHERE in_app = 0 AND via IS NOT NULL AND via != 'feed'")
    shops = q("SELECT COUNT(DISTINCT src) FROM products")
    print("\n  Pool: {} products from {} shops — {} not yet published."
          .format(total, shops, fresh))

    rows = list(c.execute(
        "SELECT store, found, added, finished FROM runs ORDER BY id DESC LIMIT 6"))
    if rows:
        print("\n  Most recent shops:")
        now = time.time()
        for store, found, added, fin in rows:
            ago = "" if not fin else "  ({:.0f} min ago)".format((now - fin) / 60)
            print("    {:<32} {:>4} found{}".format((store or "?")[:32], found, ago))

    print()
    if crawl:
        print("  It is working. Leave it — roughly 1-2 minutes per shop.")
        print("  Re-run this any time to watch the count climb.")
    elif fresh == 0:
        print("  Nothing new to publish. Crawl some more:")
        print("    python3 browse.py --crawl --shops 20")
    else:
        print("  Crawl finished. Next, add {} products to the catalog:".format(fresh))
        print('    python3 export.py --promote 200')
        print("  Then publish:")
        print('    cd "{}" && npm test && git add -A && git commit -m "data: new scraper batch" && git push'
              .format(REPO))
    print()


if __name__ == "__main__":
    sys.exit(main())
