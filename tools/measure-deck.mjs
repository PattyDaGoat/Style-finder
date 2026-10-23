#!/usr/bin/env node
/**
 * measure-deck.mjs — what the swipe deck actually deals, measured on the real
 * deck code rather than on the scorer alone.
 *
 *   node tools/measure-deck.mjs            # current build
 *   node tools/measure-deck.mjs --json     # machine-readable
 *
 * The eval harness (80-eval-harness.js, test/04) measures RANKING: does hybrid()
 * put the pieces a shopper likes above the ones they skip? It deals the shopper
 * a random deck, so it is blind to everything nextBatch() decides — how much to
 * explore, how to space brands and garments, and whether it notices that the
 * shopper has gone off something. This tool measures that half.
 *
 * Simulated shoppers have the same want() rules as EV_PERSONAS plus a boredom
 * model a real person has and the harness's personas do not: a piece that suits
 * them is liked less when the deck has just dealt a run of the same garment
 * group, and one persona goes off its favourite group entirely part-way through
 * the session. Metrics, per persona, averaged over seeds:
 *
 *   hit      share of swipes that were like/love, in three windows of the session
 *   grp10    distinct garment groups per 10 consecutive cards
 *   brand10  distinct brands per 10 consecutive cards
 *   run      longest run of consecutive cards from one garment group
 *   adapt    for the "goes off tops" persona: tops' share of the 30 cards dealt
 *            AFTER the switch, against their share before it
 *   ms       distinct micro-styles seen across the whole session
 *
 * Math.random is replaced by a seeded generator inside the page so two runs of
 * the same build give the same numbers.
 */
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = pathToFileURL(join(REPO, 'dist', 'style-finder.html')).href;
const JSON_OUT = process.argv.includes('--json');
const SWIPES = 120;
/* --set DECK_V4=false,NEG_ON=false : assign module-level lets inside the page first */
const si = process.argv.indexOf('--set');
const SETS = si > 0 ? process.argv[si + 1].split(',').filter(Boolean) : [];
const SEEDS = [11, 22, 33, 44, 55, 66];

const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.route('**/*', r => (['image', 'font', 'media'].includes(r.request().resourceType()) ? r.abort() : r.continue()));
const p = await ctx.newPage();
await p.goto(DIST, { waitUntil: 'domcontentloaded' });
await p.waitForFunction("typeof startDeck==='function' && typeof EV_PERSONAS!=='undefined'");

const out = await p.evaluate(({ SWIPES, SEEDS, SETS }) => {
  SETS.forEach(a => (0, eval)(a));
  /* ---- personas: EV_PERSONAS' taste, plus boredom ---- */
  const base = Object.fromEntries(EV_PERSONAS.map(x => [x.name, x]));
  const PERSONAS = [
    { name: 'Neutral minimalist', gender: 'm', want: base['Neutral minimalist'].want },
    { name: 'Bold streetwear',    gender: 'm', want: base['Bold streetwear'].want },
    { name: 'Earthy womenswear',  gender: 'f', want: base['Earthy womenswear'].want },
    { name: 'Split wardrobe',     gender: 'm', want: base['Split wardrobe'].want },
    /* likes neutral solids everywhere, then at swipe 50 is DONE with tops: from
       then on only bottoms, outerwear and shoes get a like. Measures whether the
       deck notices the shopper has moved on. */
    { name: 'Goes off tops',      gender: 'm', switchAt: 50,
      want: (p, k) => { const g = groupOf(p);
        const taste = (p.color === 'neutral' || p.color === 'dark') && p.pat === 'solid';
        return k < 50 ? taste : (taste && g !== 'tops'); } },
  ];
  function rngFor(seed) { return evRng(seed); }

  const results = [];
  const keepG = GENDER, keepS = S.settings, keepRand = Math.random;
  try {
    PERSONAS.forEach(per => {
      const runs = [];
      SEEDS.forEach(seed => {
        const rng = rngFor(seed * 7919 + per.name.length);
        Math.random = rng;
        try { localStorage.clear(); } catch (_) {}
        GENDER = per.gender;
        S = { seeds: [], reactions: {}, tags: {}, picks: [], likes: [], hist: [], settings: { gender: per.gender, maxBudget: 100000, cats: [], occ: [] }, byGender: {}, inspo: null, noFast: false, seen: {}, seenStyle: {} };
        startDeck();
        const dealt = [], hits = [], t0 = performance.now();
        let batches = 0, batchMs = 0;
        for (let k = 0; k < SWIPES; k++) {
          if (!QUEUE.length) { const t = performance.now(); refill(); batchMs += performance.now() - t; batches++; }
          if (!QUEUE.length) break;
          const i = QUEUE[0], pc = CATALOG[i];
          const g = groupOf(pc);
          /* boredom: 4+ of the last 6 cards from this garment group halves the
             chance of liking this one, suits-them or not */
          const recent = dealt.slice(-6).filter(j => groupOf(CATALOG[j]) === g).length;
          const bored = recent >= 4 ? 0.45 : 1;
          const fav = per.want(pc, k);
          const pLike = (fav ? 0.85 : 0.12) * bored;
          const r = rng() < pLike ? (fav && rng() < 0.45 ? 'love' : 'like') : 'skip';
          dealt.push(i); hits.push(r !== 'skip' ? 1 : 0);
          react(r);
        }
        const n = dealt.length;
        const win = (a, b) => { const s = hits.slice(a, b); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : null; };
        const per10 = key => { const v = []; for (let a = 0; a + 10 <= n; a += 10) v.push(new Set(dealt.slice(a, a + 10).map(key)).size); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0; };
        let run = 0, best = 0, prev = null;
        dealt.forEach(i => { const g = groupOf(CATALOG[i]); run = g === prev ? run + 1 : 1; prev = g; if (run > best) best = run; });
        let adapt = null;
        if (per.switchAt) {
          const share = (a, b) => { const s = dealt.slice(a, b); return s.filter(i => groupOf(CATALOG[i]) === 'tops').length / Math.max(1, s.length); };
          adapt = { before: share(per.switchAt - 30, per.switchAt), after: share(per.switchAt + 10, per.switchAt + 40) };
        }
        let sameBrandAdj = 0, sameMsAdj = 0;
        for (let k = 1; k < n; k++) { if (CATALOG[dealt[k]].b === CATALOG[dealt[k - 1]].b) sameBrandAdj++; if (CATALOG[dealt[k]].ms[0] === CATALOG[dealt[k - 1]].ms[0]) sameMsAdj++; }
        runs.push({ n, hit1: win(0, 30), hit2: win(30, 70), hit3: win(70, n), hitAll: win(0, n), trend: dealt.reduce((a, i) => a + (CATALOG[i].trend || 0), 0) / Math.max(1, n), trend14: dealt.slice(0, 14).reduce((a, i) => a + (CATALOG[i].trend || 0), 0) / Math.max(1, Math.min(14, n)),
                    grp10: per10(i => groupOf(CATALOG[i])), brand10: per10(i => CATALOG[i].b), run: best,
                    msSeen: new Set(dealt.map(i => CATALOG[i].ms[0])).size,
                    sameBrandAdj: sameBrandAdj / Math.max(1, n - 1), sameMsAdj: sameMsAdj / Math.max(1, n - 1),
                    adapt, msPerBatch: batches ? batchMs / batches : 0, totalMs: performance.now() - t0 });
      });
      const mean = k => { const v = runs.map(r => r[k]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
      const adapt = runs[0].adapt ? { before: runs.reduce((a, r) => a + r.adapt.before, 0) / runs.length, after: runs.reduce((a, r) => a + r.adapt.after, 0) / runs.length } : null;
      results.push({ name: per.name, seeds: runs.length, hit1: mean('hit1'), hit2: mean('hit2'), hit3: mean('hit3'), hitAll: mean('hitAll'), trend: mean('trend'), trend14: mean('trend14'),
                     grp10: mean('grp10'), brand10: mean('brand10'), run: mean('run'), msSeen: mean('msSeen'),
                     sameBrandAdj: mean('sameBrandAdj'), sameMsAdj: mean('sameMsAdj'), adapt, msPerBatch: mean('msPerBatch') });
    });
  } finally { GENDER = keepG; S.settings = keepS; Math.random = keepRand; }
  return results;
}, { SWIPES, SEEDS, SETS });

await b.close();

if (JSON_OUT) { console.log(JSON.stringify(out, null, 1)); }
else {
  const f = (v, d = 2) => v == null ? '  —  ' : v.toFixed(d).padStart(5);
  console.log(`\ndeck measurement: ${SWIPES} swipes x ${SEEDS.length} seeds per persona${SETS.length ? ' — ' + SETS.join(' ') : ''}\n`);
  console.log('persona'.padEnd(20) + ' hit:1-30 31-70 71-end  all | grp10 brand10  run  msSeen sameBrand sameMs | adapt tops before->after | ms/batch');
  out.forEach(r => {
    console.log(r.name.padEnd(20) + '     ' + f(r.hit1) + ' ' + f(r.hit2) + ' ' + f(r.hit3) + ' ' + f(r.hitAll) + ' | ' +
      f(r.grp10) + '  ' + f(r.brand10) + '  ' + f(r.run, 1) + '  ' + f(r.msSeen, 1) + '  ' + f(r.sameBrandAdj) + '    ' + f(r.sameMsAdj) + ' | ' +
      (r.adapt ? f(r.adapt.before) + ' -> ' + f(r.adapt.after) : '      —      ') + '       | ' + f(r.msPerBatch, 0));
  });
  const avg = k => out.reduce((a, r) => a + (r[k] || 0), 0) / out.length;
  console.log('  mean trend of dealt cards ' + avg('trend').toFixed(3) + ' · opening hand ' + avg('trend14').toFixed(3) + ' (catalogue mean printed by --json)');
  console.log('\n  mean hit rate ' + avg('hitAll').toFixed(3) + ' · late-session hit ' + avg('hit3').toFixed(3) + ' · groups/10 ' + avg('grp10').toFixed(2) + ' · brands/10 ' + avg('brand10').toFixed(2) + '\n');
}
