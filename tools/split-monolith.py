"""
Split style-finder.html into a modular source tree, losslessly.

The test that matters: rebuilding from the pieces must reproduce the original file
byte for byte. If it doesn't, the split is wrong and we stop.
"""
import io, os, json, re, sys, hashlib

SRC  = "/tmp/sf/work/style-finder.html"
ROOT = "/tmp/sf/repo"
h = io.open(SRC, encoding="utf-8").read()
orig_sha = hashlib.sha256(h.encode()).hexdigest()
print("source: %d bytes  sha256 %s" % (len(h), orig_sha[:16]))

# ---------------------------------------------------------------- carve the shell
i_style = h.index("<style>");     j_style = h.index("</style>")
i_scr   = h.index("<script>\n");  j_scr   = h.index("\n</script>")
head = h[:i_style + len("<style>")]        # doctype/head up to and including <style>
css  = h[i_style + len("<style>"): j_style]
mid  = h[j_style: i_scr + len("<script>\n")]   # </style> ... <body> ... <script>
js   = h[i_scr + len("<script>\n"): j_scr]
tail = h[j_scr:]                            # \n</script></body></html>

def w(path, text):
    full = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    io.open(full, "w", encoding="utf-8", newline="").write(text)
    return len(text)

os.system("rm -rf " + ROOT)

# ---------------------------------------------------------------- CSS -> files
# split at the comment banners already in the file, so the pieces match how the
# stylesheet is actually organised
CSS_CUTS = [
    (0,      "01-tokens-and-base.css"),
    (2700,   "02-deck.css"),
    (7189,   "03-results.css"),
    (10811,  "04-cart.css"),
    (13328,  "05-settings.css"),
    (19535,  "06-sectioning.css"),
    (21826,  "07-eval-panel.css"),
    (23373,  "08-appbar-and-auth.css"),
]
css_files = []
for k, (start, name) in enumerate(CSS_CUTS):
    end = CSS_CUTS[k+1][0] if k+1 < len(CSS_CUTS) else len(css)
    css_files.append(name)
    w("src/css/" + name, css[start:end])

# ---------------------------------------------------------------- JS -> files
# Numeric prefixes fix the concatenation order. These are plain scripts sharing one
# global scope (top-level const/let), not ES modules, so order is load-bearing.
JS_CUTS = [
    (2,    "00-catalog-alias.js"),      # const PIECES = CATALOG;  (CATALOG itself is injected)
    (3,    "05-microstyles.js"),
    (41,   "10-helpers.js"),
    (78,   "15-sectioning.js"),         # gender/section detection + strict toggle
    (200,  "20-photo-focus.js"),        # which part of the photo is the product
    (275,  "25-state-accounts.js"),
    (322,  "30-settings.js"),
    (380,  "35-inspiration.js"),
    (616,  "40-deck.js"),
    (768,  "45-swipe-drag.js"),
    (802,  "50-taste-model.js"),        # the scoring engine
    (1003, "55-results.js"),
    (1121, "60-cart-and-stock.js"),
    (1213, "65-brand-links-export.js"),
    (1235, "70-auth-ui.js"),
    (1437, "80-eval-harness.js"),       # dev-only measurement panel
    (1718, "90-boot.js"),
]
L = js.split("\n")
js_files = []
for k, (start, name) in enumerate(JS_CUTS):
    end = JS_CUTS[k+1][0] if k+1 < len(JS_CUTS) else len(L) + 1
    chunk = "\n".join(L[start-1:end-1])
    js_files.append(name)
    w("src/js/" + name, chunk)

# ---------------------------------------------------------------- the catalog as data
m = re.match(r"const CATALOG = (\[.*\]);$", L[0], re.S)
if not m: sys.exit("could not isolate the CATALOG literal on line 1")
catalog_literal = m.group(1)

def carve(lit):
    """Split a JSON array literal into its top-level element substrings, keeping the
    original text byte for byte. Re-serialising through a JSON parser would rewrite
    175.0 as 175 -- numerically identical, but then the build is no longer provably
    lossless, and 'provably' is the whole point."""
    out, depth, start, instr, esc = [], 0, None, False, False
    for i, ch in enumerate(lit):
        if instr:
            if esc: esc = False
            elif ch == "\\": esc = True
            elif ch == '"': instr = False
            continue
        if ch == '"': instr = True; continue
        if ch in "[{":
            depth += 1
            if depth == 2 and start is None: start = i
        elif ch in "]}":
            depth -= 1
            if depth == 1 and start is not None:
                out.append(lit[start:i+1]); start = None
    return out

items = carve(catalog_literal)
if len(items) != len(json.loads(catalog_literal)):
    sys.exit("carve produced %d items, parser says %d" % (len(items), len(json.loads(catalog_literal))))
assert all("\n" not in it for it in items), "a product contains a newline; the one-per-line format breaks"
w("data/catalog.json", "[\n" + ",\n".join(items) + "\n]\n")
print("catalog: %d products -> data/catalog.json (one per line, original text preserved)" % len(items))

# ---------------------------------------------------------------- shell templates
w("src/shell/head.html", head)
w("src/shell/body.html", mid)
w("src/shell/tail.html", tail)

# ---------------------------------------------------------------- the build script
BUILD = r'''#!/usr/bin/env node
/**
 * build.mjs — reassemble the modular source into the single-file app.
 *
 *   node build.mjs            -> dist/style-finder.html
 *   node build.mjs --check    -> build, then compare against dist/ without writing
 *
 * Why a build step: the app has to stay one double-clickable file, but a 3.6MB
 * monolith cannot be worked on by two people at once — every edit collides and a
 * merge conflict inside a 3.5MB line of JSON is unresolvable. So the source is
 * split by concern and this script glues it back together.
 *
 * The CSS and JS pieces are concatenated in filename order. They share one global
 * scope (top-level const/let, not ES modules), so the numeric prefixes are
 * load-bearing — 50-taste-model.js must come after 10-helpers.js. Renumber
 * carefully.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const p    = (...a) => join(ROOT, ...a);
const read = f => readFileSync(f, 'utf8');
const ordered = dir => readdirSync(p(dir)).filter(f => !f.startsWith('.')).sort();

const css = ordered('src/css').map(f => read(p('src/css', f))).join('');
const jsParts = ordered('src/js');
const js  = jsParts.map(f => read(p('src/js', f))).join('\n');

/* The catalog lives as data and is injected verbatim. Note we splice in the FILE TEXT
   rather than JSON.parse -> JSON.stringify: a round trip through the parser rewrites
   175.0 as 175, which is the same number but a different file, and we want the build
   to be byte-for-byte reproducible. JSON is valid JS, so the text drops straight in.
   Newlines are stripped because the source keeps one product per line (for sane diffs)
   while the shipped file keeps the array on a single line. */
const catalogText = read(p('data/catalog.json')).trim();
const catalogCount = (catalogText.match(/\n/g) || []).length - 1;
const catalogLine = 'const CATALOG = ' + catalogText.replace(/\n/g, '') + ';';

const out = read(p('src/shell/head.html'))
          + css
          + read(p('src/shell/body.html'))
          + catalogLine + '\n' + js
          + read(p('src/shell/tail.html'));

const target = p('dist/style-finder.html');
if (process.argv.includes('--check')) {
  if (!existsSync(target)) { console.error('no dist build to compare against'); process.exit(1); }
  const cur = read(target);
  if (cur === out) { console.log('dist is up to date'); process.exit(0); }
  console.error('dist is STALE — run `node build.mjs`');
  console.error(`  built ${out.length} bytes vs dist ${cur.length} bytes`);
  process.exit(1);
}
mkdirSync(p('dist'), { recursive: true });
writeFileSync(target, out);
console.log(`built dist/style-finder.html — ${(out.length/1e6).toFixed(2)} MB`);
console.log(`  ${ordered('src/css').length} css files, ${jsParts.length} js files, ${catalogCount} products`);
'''
w("build.mjs", BUILD)

print("\nwrote %d css files, %d js files" % (len(css_files), len(js_files)))
print("\nrun the build and compare:")
