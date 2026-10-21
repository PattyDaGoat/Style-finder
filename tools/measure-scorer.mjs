#!/usr/bin/env node
/**
 * measure-scorer.mjs — the eval harness's numbers at the terminal, with the
 * taste model's switches flipped so a change can be compared against the
 * shipped scorer on identical sessions.
 *
 *   node tools/measure-scorer.mjs                 # 12 seeds x 1280 swipes, as test/04
 *   node tools/measure-scorer.mjs --quick         # 6 seeds x 640 swipes
 *   node tools/measure-scorer.mjs --flags NEG_ON,CAT_ON
 *
 * Prints AUC and P@10 per persona for the "current" row with every named flag
 * ON and then OFF, and the difference against the noise floor. A variant counts
 * only if it clears the floor on the persona it was meant to help and costs
 * none of the others more than their floor.
 */
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = pathToFileURL(join(REPO, 'dist', 'style-finder.html')).href;
const QUICK = process.argv.includes('--quick');
const fi = process.argv.indexOf('--flags');
const FLAGS = fi > 0 ? process.argv[fi + 1].split(',').filter(Boolean) : [];
/* --set NEG_W=1.2,CAT_W=8 : assign module-level lets inside the page before measuring */
const si = process.argv.indexOf('--set');
const SETS = si > 0 ? process.argv[si + 1].split(',').filter(Boolean) : [];
const argN = process.argv.indexOf('--n'), argS = process.argv.indexOf('--seeds');
const N = argN > 0 ? +process.argv[argN + 1] : (QUICK ? 640 : 1280);
const NSEEDS = argS > 0 ? +process.argv[argS + 1] : (QUICK ? 6 : 12);

const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
await p.goto(DIST, { waitUntil: 'domcontentloaded' });
await p.waitForFunction("typeof evAggregate==='function'");

const out = await p.evaluate(({ N, NSEEDS, FLAGS, SETS }) => {
  /* the switches are script-level `let`s, so they are reached through indirect
     eval (the global lexical scope), not as window properties */
  const G = (0, eval);
  SETS.forEach(a => G(a));
  const rows = [];
  const keepG = GENDER, keepS = S.settings;
  const saved = {}; FLAGS.forEach(f => { saved[f] = G(f); });
  try {
    EV_PERSONAS.forEach((per, k) => {
      GENDER = per.gender; S.settings = Object.assign({}, S.settings || {}, { gender: per.gender });
      const seeds = Array.from({ length: NSEEDS }, (_, j) => 11 + k + j * 101);
      const sets = evSeededSessions(per, N, seeds);
      const measure = () => { const r = evAggregate(sets); const g = key => r.rows.find(x => x.key === key); return { auc: g('current').auc, p10: g('current').p10, ship: g('with-youth').auc, floor: r.noiseFloor, sd: g('current').aucSD }; };
      const on = measure();
      let off = null;
      if (FLAGS.length) { FLAGS.forEach(f => G(f + '=false')); off = measure(); FLAGS.forEach(f => G(f + '=' + JSON.stringify(saved[f]))); }
      rows.push({ persona: per.name, on, off });
    });
  } finally { GENDER = keepG; S.settings = keepS; FLAGS.forEach(f => G(f + '=' + JSON.stringify(saved[f]))); }
  return rows;
}, { N, NSEEDS, FLAGS, SETS });
await b.close();

console.log(`\nscorer: ${NSEEDS} seeds x ${N} swipes, 25% holdout${FLAGS.length ? ' — flags ' + FLAGS.join(',') + ' ON vs OFF' : ''}${SETS.length ? ' — ' + SETS.join(' ') : ''}\n`);
const f = v => v == null ? '  —  ' : v.toFixed(3);
let sumOn = 0, sumOff = 0;
out.forEach(r => {
  sumOn += r.on.auc; if (r.off) sumOff += r.off.auc;
  const d = r.off ? r.on.auc - r.off.auc : null;
  console.log(r.persona.padEnd(20) + ' AUC ' + f(r.on.auc) + ' (P@10 ' + (r.on.p10 * 100).toFixed(1) + '%, shipped ' + f(r.on.ship) + ')' +
    (r.off ? '   OFF ' + f(r.off.auc) + ' (P@10 ' + (r.off.p10 * 100).toFixed(1) + '%)   diff ' + (d >= 0 ? '+' : '') + f(d) + ' vs floor ±' + f(r.off.floor) + (Math.abs(d) > r.off.floor ? (d > 0 ? '  CLEARS' : '  REGRESSES') : '  (noise)') : '   floor ±' + f(r.on.floor)));
});
console.log('\n  mean AUC ' + f(sumOn / out.length) + (FLAGS.length ? '  vs OFF ' + f(sumOff / out.length) : '') + '\n');
