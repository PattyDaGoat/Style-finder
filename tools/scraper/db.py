"""SQLite store for the product catalog the bot feeds.

One table does the real work. `in_app = 1` means the row is already baked into
style-finder.html's CATALOG (so the bot must never re-serve it); `in_app = 0`
rows are the bot's live finds, and those only reach the page once `aligned = 1`.
"""

import json
import os
import sqlite3
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HERE, "catalog.db")

_local = threading.local()

SCHEMA = """
CREATE TABLE IF NOT EXISTS products (
  id         TEXT PRIMARY KEY,
  b          TEXT NOT NULL,
  n          TEXT NOT NULL,
  p          REAL,
  cur        TEXT DEFAULT '$',
  usd        REAL,
  img        TEXT,
  u          TEXT,
  cat        TEXT,
  ms         TEXT,          -- json array
  color      TEXT,
  pat        TEXT,
  fab        TEXT,          -- json array
  g          TEXT,
  src        TEXT,          -- store domain it came from
  handle     TEXT,
  in_app     INTEGER DEFAULT 0,   -- 1 = already in the HTML catalog
  served     INTEGER DEFAULT 0,   -- 1 = handed to the page at least once
  score      REAL DEFAULT 0,      -- alignment score vs the current profile
  aligned    INTEGER DEFAULT 0,   -- 1 = clears the threshold, safe to show
  reason     TEXT,                -- human-readable "why this matched"
  first_seen REAL,
  scored_at  REAL
);
CREATE INDEX IF NOT EXISTS idx_products_live    ON products(in_app, aligned, served);
CREATE INDEX IF NOT EXISTS idx_products_gender  ON products(g);
CREATE INDEX IF NOT EXISTS idx_products_src     ON products(src);

CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT
);

CREATE TABLE IF NOT EXISTS runs (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  started  REAL,
  finished REAL,
  store    TEXT,
  found    INTEGER DEFAULT 0,
  added    INTEGER DEFAULT 0,
  note     TEXT
);
"""

LIST_FIELDS = ("ms", "fab")
ROW_FIELDS = ("id", "b", "n", "p", "cur", "usd", "img", "u", "cat", "ms",
              "color", "pat", "fab", "g", "src", "handle",
              # written by the headless crawler (browse.py); the Shopify feed
              # harvester leaves them null
              "descr", "gconf", "gwhy", "section", "sect_src", "via")

# Added after the first version shipped, so they arrive by migration rather than
# in SCHEMA — an existing catalog.db must keep working untouched.
BROWSER_COLUMNS = (
    ("descr",   "TEXT"),     # the shop's own product description
    ("gconf",   "REAL"),     # 0..1, how lopsided the gender evidence was
    ("gwhy",    "TEXT"),     # which signals decided it
    ("section", "TEXT"),     # 'm'/'f' the crawl associated with this row
    # how to read `section`: 'section' means the shop labelled that department
    # itself and it is evidence; 'prior' means we inferred it from the brand only
    # selling one gender, and it is a tiebreak. Stored so the classifier can be
    # re-run later without re-crawling.
    ("sect_src", "TEXT"),
    ("via",     "TEXT"),     # ld | json | dom | feed
)


def conn():
    """One connection per thread — sqlite objects aren't shareable across them."""
    c = getattr(_local, "conn", None)
    if c is None:
        c = sqlite3.connect(DB_PATH, timeout=30)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=NORMAL")
        _local.conn = c
    return c


def init():
    c = conn()
    c.executescript(SCHEMA)
    c.commit()
    migrate()


def migrate():
    """Add any column this build knows about that the file on disk doesn't.

    Idempotent, so it is safe to call on every start.
    """
    c = conn()
    have = {r[1] for r in c.execute("PRAGMA table_info(products)")}
    added = []
    for name, decl in BROWSER_COLUMNS:
        if name not in have:
            c.execute("ALTER TABLE products ADD COLUMN {} {}".format(name, decl))
            added.append(name)
    if added:
        c.commit()
    return added


def _encode(row):
    out = {k: row.get(k) for k in ROW_FIELDS}
    for f in LIST_FIELDS:
        out[f] = json.dumps(out.get(f) or [])
    # rows that arrived through the Shopify feed harvester never set this
    out["via"] = out.get("via") or "feed"
    return out


def decode(row):
    """sqlite Row -> the dict shape style-finder.html's CATALOG uses."""
    d = dict(row)
    for f in LIST_FIELDS:
        try:
            d[f] = json.loads(d.get(f) or "[]")
        except (TypeError, ValueError):
            d[f] = []
    return d


def upsert_many(rows, in_app=0):
    """Insert new products; refresh price/image on ones we've already seen.

    Returns (added, updated). Never flips `in_app` back to 0 or clears a score.
    """
    if not rows:
        return 0, 0
    c = conn()
    now = time.time()
    added = updated = 0
    cur = c.cursor()
    for r in rows:
        enc = _encode(r)
        cur.execute("SELECT 1 FROM products WHERE id = ?", (enc["id"],))
        if cur.fetchone():
            cur.execute(
                "UPDATE products SET p=?, usd=?, img=?, u=? WHERE id=?",
                (enc["p"], enc["usd"], enc["img"], enc["u"], enc["id"]))
            updated += 1
        else:
            cur.execute(
                "INSERT INTO products (id,b,n,p,cur,usd,img,u,cat,ms,color,pat,"
                "fab,g,src,handle,descr,gconf,gwhy,section,sect_src,via,"
                "in_app,first_seen) VALUES "
                "(:id,:b,:n,:p,:cur,:usd,:img,:u,:cat,:ms,:color,:pat,:fab,:g,"
                ":src,:handle,:descr,:gconf,:gwhy,:section,:sect_src,:via,"
                "{},{})".format(int(in_app), now), enc)
            added += 1
    c.commit()
    return added, updated


def known_ids():
    return {r[0] for r in conn().execute("SELECT id FROM products")}


def known_urls():
    return {r[0] for r in conn().execute("SELECT u FROM products")}


def candidates(limit=4000):
    """Bot-found rows waiting to be scored or re-scored."""
    q = ("SELECT * FROM products WHERE in_app = 0 ORDER BY first_seen DESC LIMIT ?")
    return [decode(r) for r in conn().execute(q, (limit,))]


def live_feed(gender, limit=40, exclude_served=True):
    """Aligned, not-yet-in-the-app products for one section, best match first."""
    q = ("SELECT * FROM products WHERE in_app = 0 AND aligned = 1 "
         "AND (g = ? OR g = 'u') ")
    if exclude_served:
        q += "AND served = 0 "
    q += "ORDER BY score DESC LIMIT ?"
    return [decode(r) for r in conn().execute(q, (gender, limit))]


def mark_served(ids):
    if not ids:
        return
    c = conn()
    c.executemany("UPDATE products SET served = 1 WHERE id = ?",
                  [(i,) for i in ids])
    c.commit()


def apply_scores(scored):
    """scored: iterable of (id, score, aligned, reason)"""
    if not scored:
        return 0
    c = conn()
    now = time.time()
    c.executemany(
        "UPDATE products SET score=?, aligned=?, reason=?, scored_at=? WHERE id=?",
        [(s, a, why, now, pid) for pid, s, a, why in scored])
    c.commit()
    return len(scored)


def set_meta(key, value):
    c = conn()
    c.execute("INSERT INTO meta (k,v) VALUES (?,?) "
              "ON CONFLICT(k) DO UPDATE SET v = excluded.v",
              (key, json.dumps(value)))
    c.commit()


def get_meta(key, default=None):
    r = conn().execute("SELECT v FROM meta WHERE k = ?", (key,)).fetchone()
    if not r:
        return default
    try:
        return json.loads(r[0])
    except (TypeError, ValueError):
        return default


def log_run(store, found, added, started, note=""):
    c = conn()
    c.execute("INSERT INTO runs (started,finished,store,found,added,note) "
              "VALUES (?,?,?,?,?,?)",
              (started, time.time(), store, found, added, note))
    c.commit()


def stats():
    c = conn()
    one = lambda q, *a: c.execute(q, a).fetchone()[0]
    return {
        "total": one("SELECT COUNT(*) FROM products"),
        "in_app": one("SELECT COUNT(*) FROM products WHERE in_app = 1"),
        "bot_found": one("SELECT COUNT(*) FROM products WHERE in_app = 0"),
        "aligned": one("SELECT COUNT(*) FROM products WHERE in_app = 0 AND aligned = 1"),
        "served": one("SELECT COUNT(*) FROM products WHERE in_app = 0 AND served = 1"),
        "pending": one("SELECT COUNT(*) FROM products WHERE in_app = 0 AND aligned = 0"),
        "stores": one("SELECT COUNT(DISTINCT src) FROM products WHERE src IS NOT NULL"),
        "by_gender": {r[0]: r[1] for r in c.execute(
            "SELECT g, COUNT(*) FROM products WHERE in_app = 0 GROUP BY g")},
        "last_runs": [dict(r) for r in c.execute(
            "SELECT store, found, added, finished FROM runs "
            "ORDER BY id DESC LIMIT 8")],
    }
