#!/usr/bin/env node
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
