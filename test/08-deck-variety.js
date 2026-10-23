/* The deck's variety and fatigue behaviour (40-deck.js, dealV4).
 *
 * test/04 measures whether the SCORER ranks liked pieces above skipped ones. It
 * deals the simulated shopper a random deck, so nothing in it can see what the
 * deck itself decides: how a batch is spaced, whether boredom is noticed, and
 * whether discovery cards are curated rather than random. tools/measure-deck.mjs
 * reports those as numbers; this suite turns the ones that must not regress
 * into assertions.
 */
const { chromium } = require('playwright');
const { join, dirname } = require('node:path');
const REPO = dirname(dirname(require('node:fs').realpathSync(__filename)));
const DIST = require('node:url').pathToFileURL(join(REPO, 'dist', 'style-finder.html')).href;

const ok = [], bad = [];
const chk = (n, c, e) => (c ? ok : bad).push(n + (e ? ' :: ' + e : ''));

(async () => {
  const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const ctx = await b.newContext({ viewport: { width: 1150, height: 1000 } });
  await ctx.route('**/*', r => (['image', 'font', 'media'].includes(r.request().resourceType()) ? r.abort() : r.continue()));
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e)));
  await p.goto(DIST, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction("typeof startDeck==='function' && typeof dealV4==='function'");

  /* a fresh menswear session with a seeded RNG, so the run is reproducible */
  const fresh = (seed, gender) => p.evaluate(({ seed, gender }) => {
    Math.random = evRng(seed);
    try { localStorage.clear(); } catch (_) {}
    GENDER = gender;
    S = { seeds: [], reactions: {}, tags: {}, picks: [], likes: [], hist: [], settings: { gender, maxBudget: 100000, cats: [], occ: [] }, byGender: {}, inspo: null, noFast: false, seen: {}, seenStyle: {}, origin: {} };
    startDeck();
    return QUEUE.length;
  }, { seed, gender });

  // ---- 1. a batch is capped per garment group and spaced ----
  const n0 = await fresh(101, 'm');
  chk('a fresh deck deals an opening hand', n0 >= 10, 'queue=' + n0);
  const opening = await p.evaluate(() => {
    const by = {}; QUEUE.forEach(i => { const g = groupOf(CATALOG[i]); by[g] = (by[g] || 0) + 1; });
    let adjBrand = 0, adjGroup = 0;
    for (let k = 1; k < QUEUE.length; k++) { if (CATALOG[QUEUE[k]].b === CATALOG[QUEUE[k - 1]].b) adjBrand++; if (groupOf(CATALOG[QUEUE[k]]) === groupOf(CATALOG[QUEUE[k - 1]])) adjGroup++; }
    return { by, n: QUEUE.length, adjBrand, adjGroup, brands: new Set(QUEUE.map(i => CATALOG[i].b)).size };
  });
  const topShare = Math.max(...Object.values(opening.by)) / opening.n;
  chk('the opening hand takes no more than half its cards from one garment group', topShare <= 0.5 + 1e-9, JSON.stringify(opening.by));
  chk('the opening hand spans at least three garment groups', Object.keys(opening.by).length >= 3, JSON.stringify(opening.by));
  chk('no two consecutive cards share a brand', opening.adjBrand === 0, 'adjacent same-brand pairs=' + opening.adjBrand);
  chk('every card in a batch is a different brand', opening.brands === opening.n, opening.brands + ' brands in ' + opening.n);
  chk('consecutive cards mostly differ in garment group', opening.adjGroup <= Math.floor(opening.n / 3), 'adjacent same-group pairs=' + opening.adjGroup);

  // ---- 2. a uniform shopper is not dealt long runs of one garment ----
  await fresh(202, 'm');
  const uniform = await p.evaluate(() => {
    const want = pc => (pc.color === 'neutral' || pc.color === 'dark') && pc.pat === 'solid';
    const dealt = []; let run = 0, best = 0, prev = null;
    for (let k = 0; k < 80; k++) {
      if (!QUEUE.length) refill(); if (!QUEUE.length) break;
      const i = QUEUE[0], pc = CATALOG[i]; dealt.push(i);
      const g = groupOf(pc); run = g === prev ? run + 1 : 1; prev = g; if (run > best) best = run;
      react(want(pc) ? (Math.random() < 0.5 ? 'love' : 'like') : 'skip');
    }
    const origins = dealt.map(i => (S.origin || {})[i]);
    return { n: dealt.length, longestRun: best, groups: new Set(dealt.map(i => groupOf(CATALOG[i]))).size,
             ms: new Set(dealt.map(i => CATALOG[i].ms[0])).size, explore: origins.filter(o => o === 'e').length,
             wild: origins.filter(o => o === 'w').length, exploit: origins.filter(o => o === 'x').length, untagged: origins.filter(o => !o).length };
  });
  chk('80 swipes were dealt', uniform.n === 80, 'n=' + uniform.n);
  chk('longest run of one garment group stays short (<= 6)', uniform.longestRun <= 6, 'run=' + uniform.longestRun);
  chk('the session touched at least four garment groups', uniform.groups >= 4, 'groups=' + uniform.groups);
  chk('the session touched most micro-styles (>= 14 of 20)', uniform.ms >= 14, 'ms=' + uniform.ms);
  chk('every dealt card carries an origin (exploit / explore / wildcard)', uniform.untagged === 0, 'untagged=' + uniform.untagged);
  chk('discovery cards are dealt throughout (>= 10% explore)', uniform.explore >= 8, 'explore=' + uniform.explore + ' exploit=' + uniform.exploit);
  chk('a wildcard is dealt regularly', uniform.wild >= 4, 'wild=' + uniform.wild);
  chk("the model's own picks still lead (> 45%)", uniform.exploit / uniform.n > 0.45, 'exploit share=' + (uniform.exploit / uniform.n).toFixed(2));

  // ---- 3. fatigue: a run of skips on one group thins that group in the next batch ----
  await fresh(303, 'm');
  const fatigue = await p.evaluate(() => {
    /* like everything for 20 cards so the model has a profile, then skip every
       top four times in a row, then look at what the next batch holds */
    for (let k = 0; k < 20; k++) { if (!QUEUE.length) refill(); react('like'); }
    let skippedTops = 0, guard = 0;
    while (skippedTops < 4 && guard++ < 60) {
      if (!QUEUE.length) refill();
      const pc = CATALOG[QUEUE[0]];
      if (groupOf(pc) === 'tops') { react('skip'); skippedTops++; } else { react('like'); }
    }
    const ctx = sessionContext();
    QUEUE = []; const batch = nextBatch(10);
    const tops = batch.filter(i => groupOf(CATALOG[i]) === 'tops').length;
    return { streak: ctx.fatigue['g:tops'] || 0, tops, n: batch.length, skippedTops };
  });
  chk('four consecutive skips on tops are read as a fatigue streak', fatigue.streak >= 3, 'streak=' + fatigue.streak);
  chk('the next batch holds at most one top', fatigue.tops <= 1, fatigue.tops + ' tops of ' + fatigue.n);
  chk('the next batch is still full', fatigue.n === 10, 'n=' + fatigue.n);

  // ---- 4. a like on the lane clears the streak ----
  const cleared = await p.evaluate(() => {
    let guard = 0;
    while (guard++ < 40) { if (!QUEUE.length) refill(); const pc = CATALOG[QUEUE[0]]; if (groupOf(pc) === 'tops') { react('love'); break; } react('skip'); }
    return sessionContext().fatigue['g:tops'] || 0;
  });
  chk('liking a top resets the tops fatigue streak', cleared === 0, 'streak=' + cleared);

  // ---- 4b. the trend signal: a 0..1 score, and an opening hand that leads with it ----
  await fresh(505, 'm');                     /* a fresh deck: the hand measured is an OPENING hand */
  const trend = await p.evaluate(() => {
    const t = CATALOG.map(x => x.trend);
    const mean = t.reduce((a, b) => a + b, 0) / t.length;
    const hand = QUEUE.slice(0, 14).reduce((a, i) => a + CATALOG[i].trend, 0) / Math.min(14, QUEUE.length);
    return { min: Math.min(...t), max: Math.max(...t), mean, hand, tagged: CATALOG.filter(x => x.trend >= 0.72).length / t.length,
             sample: trendScore({ n: 'Barrel Leg Cargo Pant', ms: ['rugged-workwear'], fit: 'wide', pat: 'solid', color: 'earth', cat: 'trouser' }) };
  });
  chk('trendScore stays within 0..1 over the whole catalogue', trend.min >= 0 && trend.max <= 1, trend.min + '..' + trend.max);
  chk('a wide cargo pant in workwear olive reads as very current', trend.sample >= 0.8, String(trend.sample));
  chk('between 1% and 15% of pieces earn the Trending now tag', trend.tagged >= 0.01 && trend.tagged <= 0.15, (trend.tagged * 100).toFixed(1) + '%');
  chk('the opening hand runs well above the catalogue mean on trend', trend.hand >= trend.mean + 0.15, 'hand ' + trend.hand.toFixed(3) + ' vs catalogue ' + trend.mean.toFixed(3));

  // ---- 4c. vintage / thrift: a real lane, and the chip is always offered ----
  const vint = await p.evaluate(() => ({
    finds: CATALOG.filter(x => x.vintage === 'vintage').length, thrift: CATALOG.filter(x => x.vintage === 'thrift').length,
    looks: CATALOG.filter(x => x.vintage === 'look').length, lane: CATALOG.filter(x => x.ms[0] === 'vintage-thrift').length,
    chip: document.getElementById('seedChips').textContent.includes('Vintage / Thrift'),
    newNotFind: vintageKind({ n: 'Vintage Wash Western Shirt', u: 'https://percivalclo.com/products/x' }),
    depopFind: vintageKind({ n: "Levi's men's vintage 90s jeans", u: 'https://www.depop.com/products/x' }),
    trendy: CATALOG.filter(x => x.vintage === 'vintage').reduce((a, x) => a + x.trend, 0) / Math.max(1, CATALOG.filter(x => x.vintage === 'vintage').length) }));
  chk('the catalogue carries real vintage finds (50+)', vint.finds >= 50, 'finds=' + vint.finds + ' thrift=' + vint.thrift + ' looks=' + vint.looks);
  chk('every real find leads with the Vintage / Thrift lane', vint.lane === vint.finds, vint.lane + ' vs ' + vint.finds);
  chk('a new piece with a vintage wash is a look, not a find', vint.newNotFind === 'look', String(vint.newNotFind));
  chk('a 90s listing on Depop is a find', vint.depopFind === 'vintage', String(vint.depopFind));
  chk('Vintage / Thrift is always offered as a warm-up chip', vint.chip === true);
  chk('vintage finds read as current (mean trend >= 0.55)', vint.trendy >= 0.55, vint.trendy.toFixed(3));

  // ---- 5. the v3 dealer is still reachable for measurement ----
  const v3 = await p.evaluate(() => { DECK_V4 = false; try { QUEUE = []; return nextBatch(10).length; } finally { DECK_V4 = true; } });
  chk('DECK_V4=false still deals a full v3 batch', v3 === 10, 'n=' + v3);

  // ---- 6. womenswear deck obeys the same rules ----
  await fresh(404, 'f');
  const w = await p.evaluate(() => {
    const by = {}; QUEUE.forEach(i => { const g = groupOf(CATALOG[i]); by[g] = (by[g] || 0) + 1; });
    return { by, n: QUEUE.length, all: QUEUE.every(i => inSection(i, 'f')) };
  });
  chk('womenswear opening hand is capped per garment group too', Math.max(...Object.values(w.by)) / w.n <= 0.5 + 1e-9, JSON.stringify(w.by));
  chk('womenswear opening hand only deals womenswear', w.all);

  chk('no page errors during the suite', errs.length === 0, errs.slice(0, 2).join(' | '));

  await b.close();
  ok.forEach(x => console.log('PASS ' + x));
  bad.forEach(x => console.log('FAIL ' + x));
  console.log(`===== PASS (${ok.length})`);
  if (bad.length) console.log(`===== FAIL (${bad.length})`);
})().catch(e => { console.log('FAIL suite crashed :: ' + e.message); console.log('===== FAIL (1)'); process.exit(1); });
