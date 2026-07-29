/**
 * 07-occasions.js — does the occasion filter show you clothes for the occasion?
 *
 * The occasion chips are a HARD filter: pick "Going out / cocktail" and anything
 * without that tag never reaches your deck. So the cost of a loose rule is not a
 * slightly odd sort order, it is a feed full of the wrong clothes — which is
 * exactly what shipped. `cat==='dress'` alone tagged all 605 dresses as cocktail,
 * denim shifts and smocked sundresses included, and any ivy-prep or british-mod
 * piece that was not a tee or a cap qualified too, so jeans, chinos, corduroy
 * shorts and pique polos all sat under "Going out". 1,299 pieces carried the tag.
 *
 * This suite is written as PRECISION first: for each occasion, a list of things
 * that must never appear in it, checked across the whole catalog. Those lists are
 * the part worth arguing about — they encode what the chip means. Recall is
 * checked too, but loosely: an occasion that matched nothing would be just as
 * broken as one that matched everything, and the two failure modes need
 * different assertions.
 *
 * The suite reads `p.occ`, i.e. the tags the app itself computed at startup from
 * the shipping occasionsOf(), not a copy of the rule — so it cannot drift.
 */
const { chromium } = require('playwright');
const { join, dirname } = require('node:path');
const REPO = dirname(dirname(require('node:fs').realpathSync(__filename)));
const DIST_URL = require('node:url').pathToFileURL(join(REPO, 'dist', 'style-finder.html')).href;

const ok = [], bad = [];
const chk = (n, c, e) => (c ? ok : bad).push(n + (e ? ' :: ' + e : ''));

/* Things that must never carry the tag. Written as source strings so they can be
   handed to the page and rebuilt there — a RegExp does not survive evaluate(). */
const FORBIDDEN = {
  event: [
    ['jeans / denim', 'denim|\\bjean'],
    /* \\bshorts\\b, not \\bshort\\b: the latter also matches "Short-Sleeve", and a
       silk short-sleeve shirt is perfectly good going-out wear. */
    ['shorts', '\\bshorts\\b'],
    ['hoodies', 'hood(ie|ed)'],
    ['sweatpants / joggers', 'sweatpant|jogger|sweat pant'],
    ['polos', '\\bpolo\\b|pique'],
    ['sneakers', 'sneaker|trainer'],
    ['gymwear', '\\bgym\\b|athletic|legging|sports? ?bra'],
    ['sundresses / smocked', 'smocked|sundress'],
    ['caps and beanies', '\\bcap\\b|beanie|trucker'],
    ['swimwear', 'swim|bikini|trunk'],
    ['cargo', 'cargo'],
    ['flannel', 'flannel'],
    ['t-shirts', '\\btee\\b|t.?shirt']
  ],
  work: [
    ['hoodies', 'hood(ie|ed)'],
    ['sweatpants / joggers', 'sweatpant|jogger|sweat pant'],
    ['gymwear', '\\bgym\\b|legging|sports? ?bra'],
    ['swimwear', 'swim|bikini|trunk'],
    ['graphic tees', 'graphic|band tee'],
    ['cargo', 'cargo'],
    ['beanies', 'beanie|trucker'],
    ['shorts', '\\bshorts\\b']
  ],
  active: [
    ['dressy fabrics', 'silk|satin|velvet'],
    ['tailoring', 'blazer|\\bsuit\\b|gown'],
    ['denim', 'denim|\\bjean'],
    ['linen', 'linen'],
    ['cashmere', 'cashmere'],
    ['heels and loafers', '\\bheel|loafer'],
    ['swimwear', 'swim|bikini|trunk']
  ],
  beach: [
    ['heavy outerwear', 'puffer|parka|shearling'],
    ['wool and cashmere', '\\bwool\\b|cashmere|merino'],
    ['fleece', 'fleece'],
    ['boots', '\\bboots?\\b'],
    ['corduroy', 'corduroy']
  ],
  daily: [
    ['swimwear', 'swim|bikini|trunk'],
    ['black tie', 'gown|tuxedo|cocktail'],
    ['sports bras', 'sports? ?bra']
  ]
};

/* Recall spot-checks: a phrase, the occasion it must produce, and how many rows
   have to agree. Keeps the vetoes from quietly emptying a bucket. */
const MUST_MATCH = [
  ['satin', 'event'], ['sequin', 'event'], ['\\bheel', 'event'], ['blazer', 'event'],
  ['dress shirt', 'work'], ['oxford', 'work'], ['loafer', 'work'], ['cardigan', 'work'],
  ['legging', 'active'], ['sports? ?bra', 'active'], ['\\bgym\\b|training', 'active'],
  ['swim|bikini', 'beach'], ['sandal', 'beach'], ['board ?short', 'beach']
];

(async () => {
  const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const p = await (await b.newContext()).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  await p.goto(DIST_URL, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction("typeof occasionsOf==='function' && Array.isArray(CATALOG)");

  const totals = await p.evaluate(() => {
    const c = {};
    CATALOG.forEach(x => (x.occ || []).forEach(o => c[o] = (c[o] || 0) + 1));
    return { counts: c, n: CATALOG.length,
             noOcc: CATALOG.filter(x => !x.occ || !x.occ.length).length };
  });

  chk('every piece carries at least one occasion', totals.noOcc === 0, totals.noOcc + ' with none');
  ['daily', 'work', 'event', 'active', 'beach'].forEach(o =>
    chk('"' + o + '" is a non-empty bucket', (totals.counts[o] || 0) > 50,
        o + '=' + (totals.counts[o] || 0)));

  /* The headline: cocktail must be SELECTIVE. It was 1,299 of 9,867 — 13% of the
     whole catalog nominated as eveningwear, which is what made the chip useless. */
  const evShare = (totals.counts.event || 0) / totals.n;
  chk('"Going out / cocktail" is selective, not a third of the shop',
      evShare < 0.06, (evShare * 100).toFixed(1) + '% of the catalog (was 13.2%)');

  /* ---- precision: nothing forbidden may carry the tag ---- */
  for (const [occ, rules] of Object.entries(FORBIDDEN)) {
    for (const [label, rx] of rules) {
      const hits = await p.evaluate(([occ, rx]) => {
        const re = new RegExp(rx, 'i');
        return CATALOG.filter(x => (x.occ || []).includes(occ) && re.test(x.n || ''))
                      .slice(0, 4).map(x => x.n);
      }, [occ, rx]);
      chk('"' + occ + '" contains no ' + label, hits.length === 0,
          hits.length ? hits.join(' | ').slice(0, 150) : '');
    }
  }

  /* ---- recall: the buckets still contain the obvious things ---- */
  for (const [rx, occ] of MUST_MATCH) {
    const r = await p.evaluate(([occ, rx]) => {
      const re = new RegExp(rx, 'i');
      const named = CATALOG.filter(x => re.test(x.n || ''));
      return { named: named.length, tagged: named.filter(x => (x.occ || []).includes(occ)).length };
    }, [occ, rx]);
    /* Not every match has to qualify — "silk gym short" should not be eveningwear
       — but a majority must, or the veto has eaten the category. */
    chk('/' + rx + '/ mostly lands in "' + occ + '"',
        r.named === 0 || r.tagged / r.named >= 0.5,
        r.tagged + '/' + r.named + ' tagged');
  }

  /* ---- the filter actually filters, end to end ---- */
  const filtered = await p.evaluate(() => {
    const keep = S.settings;
    S.settings = { gender: 'f', occ: ['event'], cats: [], maxBudget: 100000 };
    GENDER = 'f';
    let pass = 0, wrong = 0;
    for (let i = 0; i < CATALOG.length; i++) {
      if (!passesFilters(i)) continue;
      pass++;
      if (!(CATALOG[i].occ || []).includes('event')) wrong++;
    }
    S.settings = keep;
    return { pass, wrong };
  });
  chk('choosing an occasion admits only pieces carrying it', filtered.wrong === 0,
      filtered.wrong + ' of ' + filtered.pass + ' admitted without the tag');
  chk('choosing "cocktail" still leaves a deck to swipe', filtered.pass >= 20,
      filtered.pass + ' womenswear pieces');

  console.log('\nOCCASION COUNTS (of ' + totals.n + ' products):');
  ['daily', 'work', 'event', 'active', 'beach'].forEach(o =>
    console.log('  ' + o.padEnd(8) + String(totals.counts[o] || 0).padStart(6) +
                '   ' + ((totals.counts[o] || 0) / totals.n * 100).toFixed(1) + '%'));

  await b.close();
  console.log('\n===== PASS (' + ok.length + ') ====='); ok.forEach(t => console.log('  ok  ' + t));
  if (bad.length) { console.log('\n===== FAIL (' + bad.length + ') ====='); bad.forEach(t => console.log('  FAIL ' + t)); }
  if (errs.length) { console.log('\nJS ERRORS:'); [...new Set(errs)].forEach(e => console.log('  ' + e)); }
  console.log('\n' + (bad.length || errs.length ? '>>> PROBLEMS FOUND' : '>>> ALL GREEN'));
})();
