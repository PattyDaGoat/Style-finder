#!/usr/bin/env node
/**
 * measure-prof-ref.mjs — set the two calibration constants the score normaliser
 * needs, by measurement rather than by guess.
 *
 *   node tools/measure-prof-ref.mjs
 *
 * profileScore divides by the model's own mass so that its ratio against
 * knnScore stops depending on how long you have been swiping (see the PROF_REF
 * comment in src/js/50-taste-model.js). Dividing alone would leave the blend
 * sitting at an arbitrary absolute scale, so it is multiplied back up by
 * PROF_REF — the mass of a model built from a NORMAL session. Pick that number
 * correctly and the change is a deliberate no-op for a typical first-time user
 * and a correction only where the blend had genuinely drifted; pick it wrongly
 * and you have silently re-tuned the recommender for everybody.
 *
 * "Normal" is taken as 40 swipes: the number the deck's own progress bar fills
 * to, and roughly where the results screen becomes worth opening.
 *
 * FINDMORE_WP is the same idea for "find more like my picks", which blends a
 * seed-built model against kNN with its own coefficients. Its reference point is
 * 8 picked pieces.
 *
 * Re-run this after a catalogue change large enough to move the IDF values, and
 * paste the two numbers it prints back into 50-taste-model.js / 55-results.js.
 */
import { chromium } from 'playwright';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST = pathToFileURL(join(REPO, 'dist', 'style-finder.html')).href;

const REF_SWIPES = 40;   // a normal first session
const REF_PICKS  = 8;    // a normal "find more like my picks" seed set

const b = await chromium.launch();
const p = await (await b.newContext()).newPage();
await p.goto(DIST, { waitUntil: 'domcontentloaded' });
await p.waitForFunction("typeof buildModel==='function' && typeof EV_PERSONAS!=='undefined'");

const out = await p.evaluate(({ REF_SWIPES, REF_PICKS }) => {
  const masses = [], seedMasses = [], perPersona = [];
  const keepG = GENDER, keepS = S.settings;
  EV_PERSONAS.forEach((per, k) => {
    GENDER = per.gender;
    S.settings = { gender: per.gender, maxBudget: 100000 };
    const mine = [];
    for (let j = 0; j < 8; j++) {
      const sess = evSynthSession(per, REF_SWIPES, 7001 + k * 37 + j * 211);
      S.reactions = {}; S.hist = []; S.tags = {}; S.picks = []; S.likes = []; S.seeds = []; S.inspo = null;
      /* mirror react() exactly (src/js/40-deck.js): every love lands in the cart
         and every like in the liked cart, with no extra action from the shopper.
         Leaving these empty measured a session the app cannot produce, and
         understated the mass buildModel actually sees by about a quarter. */
      sess.forEach(x => {
        S.reactions[x.i] = x.r; S.hist.push(x.i);
        if (x.r === 'love' && !S.picks.includes(x.i)) S.picks.push(x.i);
        if (x.r === 'like' && !S.likes.includes(x.i)) S.likes.push(x.i);
      });
      buildModel();
      mine.push(MODEL.mass); masses.push(MODEL.mass);

      /* the seed model behind "find more" — the pieces this shopper liked most */
      const liked = sess.filter(x => x.r !== 'skip').slice(0, REF_PICKS).map(x => x.i);
      if (liked.length === REF_PICKS) seedMasses.push(modelFromSeeds(liked).mass);
    }
    perPersona.push({ name: per.name, mass: mine.reduce((a, c) => a + c, 0) / mine.length });
  });
  GENDER = keepG; S.settings = keepS;
  const med = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  return { perPersona, median: med(masses), seedMedian: med(seedMasses), n: masses.length };
}, { REF_SWIPES, REF_PICKS });

await b.close();

console.log(`\nmodel mass at ${REF_SWIPES} swipes (${out.n} sessions):`);
out.perPersona.forEach(x => console.log(`  ${x.name.padEnd(22)} ${x.mass.toFixed(1)}`));
console.log(`\n  PROF_REF     = ${Math.round(out.median)}      (median; 50-taste-model.js)`);
console.log(`  seed mass at ${REF_PICKS} picks = ${out.seedMedian.toFixed(1)}`);
console.log(`  FINDMORE_WP  = ${(0.8 * out.seedMedian / Math.round(out.median)).toFixed(3)}` +
            `   (0.8 x seedMass / PROF_REF — keeps find-more's blend where it is today; 55-results.js)\n`);
