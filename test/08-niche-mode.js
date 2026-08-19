/* 08-niche-mode.js — the Niche toggle.
 *
 * Two things have to hold, and the second is the fragile one:
 *   1. the deck deals only lesser-known labels while the mode is on;
 *   2. the two modes keep entirely separate profiles.
 *
 * (2) is the whole point of the feature and it fails silently — a broken
 * storeKey() suffix still runs, still swipes, still saves; it just quietly
 * writes both modes into the same slot, and nobody notices until a cart has
 * been overwritten. So it is asserted from the storage layer up.
 */
const { chromium } = require('playwright');
const { join, dirname } = require('node:path');
const REPO = dirname(dirname(require('node:fs').realpathSync(__filename)));
const URL = require('node:url').pathToFileURL(join(REPO, 'dist', 'style-finder.html')).href;

const ok = [], bad = [];
function chk(name, cond, extra) { (cond ? ok : bad).push(name + (extra ? ' :: ' + extra : '')); }
async function settle(page) {
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForFunction("typeof storeKey === 'function' && typeof nicheLock === 'function'", null, { timeout: 30000 });
  await page.waitForTimeout(400);
}

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/net::|Failed to load resource|gsi/.test(m.text())) errs.push('CONSOLE: ' + m.text()); });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await settle(page);

  /* ---------- the classifier ---------- */
  const cls = await page.evaluate(() => {
    const lock = nicheLock(); let well = 0;
    for (let i = 0; i < lock.length; i++) well += lock[i];
    return {
      total: CATALOG.length, well: well, niche: CATALOG.length - well,
      /* sub-labels and collabs must resolve to their parent brand */
      nikeSB: isWellKnown({ b: 'Nike SB' }),
      adidasOrig: isWellKnown({ b: 'Adidas Originals' }),
      kithWomen: isWellKnown({ b: 'Kith Women' }),
      bbcCollab: isWellKnown({ b: 'Billionaire Boys Club x New York Yankees' }),
      fastFashion: isWellKnown({ b: 'White Fox' }),
      /* ...without swallowing a different brand that merely starts the same way */
      vanquish: isWellKnown({ b: 'Vanquish Fitness' }),
      indie: isWellKnown({ b: 'Dehen 1920' })
    };
  });
  chk('well-known labels are recognised', cls.well > 0 && cls.niche > 0, cls.niche + ' niche of ' + cls.total);
  chk('niche pool is big enough to swipe on', cls.niche > cls.total * 0.4, Math.round(100 * cls.niche / cls.total) + '% of catalog');
  chk('sub-label resolves to parent (Nike SB)', cls.nikeSB);
  chk('sub-label resolves to parent (Adidas Originals)', cls.adidasOrig);
  chk('sub-label resolves to parent (Kith Women)', cls.kithWomen);
  chk('collab resolves to parent (BBC x Yankees)', cls.bbcCollab);
  chk('fast fashion counts as well known', cls.fastFashion);
  chk('prefix match is whole-word (Vanquish is not Vans)', !cls.vanquish);
  chk('an actually obscure label stays niche (Dehen 1920)', !cls.indie);

  /* ---------- the feed ---------- */
  const feed = await page.evaluate(() => {
    localStorage.clear();
    activateAccount(GUEST);
    GENDER = 'm'; S.settings = { gender: 'm', cats: [], occ: [], maxBudget: 100000 };
    save(); startDeck();
    const off = { key: storeKey(), niche: NICHE, btn: !!document.getElementById('nicheBtn') };
    for (let n = 0; n < 5; n++) { const i = QUEUE[0]; if (i == null) break; S.reactions[i] = 1; S.likes.push(i); QUEUE.shift(); }
    save();
    const mainLikes = S.likes.slice();

    document.getElementById('nicheBtn').click();          /* -> niche */
    /* deal deeply, not just one batch: a leak in the tail is still a leak */
    let sampled = 0, leaked = 0;
    for (let r = 0; r < 10; r++) {
      const b = nextBatch(14); if (!b.length) break;
      b.forEach(i => { sampled++; if (nicheLock()[i]) leaked++; SERVED.add(i); });
    }
    QUEUE = nextBatch(14);
    for (let n = 0; n < 4; n++) { const i = QUEUE[0]; if (i == null) break; S.reactions[i] = 1; S.likes.push(i); QUEUE.shift(); }
    save();
    const on = { key: storeKey(), niche: NICHE, likes: S.likes.length, settings: !!(S.settings && S.settings.gender) };

    document.getElementById('nicheBtn').click();          /* -> back to main */
    return {
      off: off, on: on, sampled: sampled, leaked: leaked, mainLikes: mainLikes,
      back: { key: storeKey(), niche: NICHE, likes: (S.likes || []).slice() },
      keys: Object.keys(localStorage).sort()
    };
  });

  chk('the button exists in the top bar', feed.off.btn);
  chk('niche deals no well-known labels', feed.leaked === 0, feed.leaked + ' leaked of ' + feed.sampled + ' dealt');
  chk('a deep sample was actually dealt', feed.sampled > 100, 'n=' + feed.sampled);

  /* ---------- the profiles ---------- */
  chk('main mode writes the plain key', /guest$/.test(feed.off.key), feed.off.key);
  chk('niche mode writes a separate key', /guest::niche$/.test(feed.on.key), feed.on.key);
  chk('both profiles exist side by side in storage',
      feed.keys.indexOf('styleDNA_v3::guest') >= 0 && feed.keys.indexOf('styleDNA_v3::guest::niche') >= 0);
  chk('niche starts with its own empty like list', feed.on.likes === 4, 'has ' + feed.on.likes + ', expected only its own 4');
  chk('sizes carry into a fresh mode so setup is not repeated', feed.on.settings);
  chk('switching back restores the main profile untouched',
      feed.back.likes.length === feed.mainLikes.length && feed.back.likes.every((v, i) => v === feed.mainLikes[i]),
      'main had ' + feed.mainLikes.length + ', came back with ' + feed.back.likes.length);
  chk('niche swipes never reached the main profile',
      !feed.back.likes.some(i => feed.mainLikes.indexOf(i) < 0));

  /* ---------- the mode survives a reload ---------- */
  await page.evaluate(() => { document.getElementById('nicheBtn').click(); });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(page);
  const after = await page.evaluate(() => ({
    niche: NICHE, key: storeKey(),
    btnOn: document.getElementById('nicheBtn').classList.contains('on'),
    aria: document.getElementById('nicheBtn').getAttribute('aria-pressed'),
    likes: (S.likes || []).length,
    anyWellKnown: (S.likes || []).some(i => nicheLock()[i])
  }));
  chk('niche mode survives a reload', after.niche === true, after.key);
  chk('the button shows the restored mode', after.btnOn && after.aria === 'true');
  chk('the reloaded profile is the niche one', after.likes === 4, 'likes=' + after.likes);
  chk('nothing well known sits in the niche liked list', !after.anyWellKnown);

  await browser.close();

  console.log('\n===== PASS (' + ok.length + ') =====');
  ok.forEach(t => console.log('  ok  ' + t));
  if (bad.length) { console.log('\n===== FAIL (' + bad.length + ') ====='); bad.forEach(t => console.log('  FAIL ' + t)); }
  if (errs.length) { console.log('\n===== JS ERRORS ====='); [...new Set(errs)].forEach(e => console.log('  ' + e)); }
  console.log('\n' + (bad.length || errs.length ? '>>> PROBLEMS FOUND' : '>>> ALL GREEN'));
})();
