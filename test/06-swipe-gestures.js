/* Swipe gestures: does a drag produce the reaction the user meant?
 *
 * Written after a real bug: swiping RIGHT registered as a LEFT swipe. Two
 * causes stacked. `pointercancel` was wired to the same handler as `pointerup`,
 * and that handler read the pointer position off the event — but pointercancel
 * carries no usable coordinate, so it arrived as clientX 0. A right-swipe
 * starting mid-screen therefore computed dx = 0 - 640 = -640, sailed past the
 * -120 threshold, and fired 'skip'. And the product photo was a natively
 * draggable <img>, so starting a swipe on it began an HTML5 image drag, which
 * is what cancelled the pointer stream in the first place — making the bad path
 * fire on most desktop swipes rather than occasionally.
 *
 * The cancel case is the one that matters most here. A gesture the browser threw
 * away must decide NOTHING; anything else is acting on input the user never
 * completed.
 */
const { chromium } = require('playwright');
const { join, dirname } = require('node:path');
const REPO = dirname(dirname(require('node:fs').realpathSync(__filename)));
const DIST = join(REPO, 'dist', 'style-finder.html');
const DIST_URL = 'file://' + DIST;
require('node:fs').mkdirSync('/tmp/sf-shots', { recursive: true });

const ok = [], bad = [];
const chk = (n, c, e) => (c ? ok : bad).push(n + (e ? ' :: ' + e : ''));
async function settle(p) {
  await p.waitForLoadState('load').catch(() => {});
  await p.waitForFunction("typeof storeKey==='function'", null, { timeout: 30000 });
  await p.waitForTimeout(400);
}

/* Drive one gesture and report the reaction it produced.
   moves: [[dx,dy], …] relative to the card centre. endWith: 'up' | 'cancel'. */
async function gesture(p, moves, endWith) {
  return p.evaluate(async ({ moves, endWith }) => {
    const card = document.querySelector('#cardHost .piece-card');
    if (!card) return { error: 'no card on screen' };
    const r = card.getBoundingClientRect();
    const pi = QUEUE[0];
    const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    const ev = (t, x, y) => card.dispatchEvent(new PointerEvent(t, {
      clientX: x, clientY: y, pointerId: 1, bubbles: true, cancelable: true, isPrimary: true
    }));
    ev('pointerdown', x0, y0);
    for (const [dx, dy] of moves) ev('pointermove', x0 + dx, y0 + dy);
    if (endWith === 'cancel') {
      ev('pointercancel', 0, 0);          // as the browser really sends it
    } else {
      const last = moves[moves.length - 1];
      ev('pointerup', x0 + last[0], y0 + last[1]);
    }
    await new Promise(res => setTimeout(res, 600));
    return { reaction: S.reactions[pi] || null, queueTop: QUEUE[0], wasIndex: pi };
  }, { moves, endWith });
}

(async () => {
  const b = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const p = await (await b.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));

  await p.goto(DIST_URL, { waitUntil: 'domcontentloaded' });
  await settle(p);
  await p.click('text=Continue as guest'); await p.waitForTimeout(400);
  await p.click('#topSizes .size-chip >> nth=2');
  await p.click('text=Next →'); await p.waitForTimeout(250);
  await p.click('text=Start shopping'); await p.waitForTimeout(1700);
  chk('deck reached', await p.isVisible('#deck'));

  // ---------- the three real gestures ----------
  let g = await gesture(p, [[60, 0], [140, 0], [200, 0]], 'up');
  chk('drag RIGHT is a like', g.reaction === 'like', 'got ' + g.reaction);

  g = await gesture(p, [[-60, 0], [-140, 0], [-200, 0]], 'up');
  chk('drag LEFT is a skip', g.reaction === 'skip', 'got ' + g.reaction);

  g = await gesture(p, [[0, -60], [0, -140], [0, -200]], 'up');
  chk('drag UP is a love', g.reaction === 'love', 'got ' + g.reaction);

  // ---------- the regression ----------
  // A rightward drag the browser cancels must NOT become a left swipe.
  g = await gesture(p, [[60, 0], [100, 0]], 'cancel');
  chk('a cancelled RIGHT drag records nothing (was: recorded skip)',
      g.reaction === null, 'got ' + g.reaction);
  chk('the card stays on screen after a cancelled drag',
      await p.evaluate("!!document.querySelector('#cardHost .piece-card')"));

  g = await gesture(p, [[-60, 0], [-100, 0]], 'cancel');
  chk('a cancelled LEFT drag also records nothing', g.reaction === null, 'got ' + g.reaction);

  // ---------- below-threshold drags are not swipes ----------
  g = await gesture(p, [[40, 0]], 'up');
  chk('a small nudge right decides nothing', g.reaction === null, 'got ' + g.reaction);
  g = await gesture(p, [[-40, 0]], 'up');
  chk('a small nudge left decides nothing', g.reaction === null, 'got ' + g.reaction);

  // ---------- what made the cancel fire so often ----------
  const dragging = await p.evaluate(() => {
    const card = document.querySelector('#cardHost .piece-card');
    const img = card.querySelector('img');
    return {
      imgDraggable: img ? img.draggable : null,
      touchAction: getComputedStyle(card).touchAction,
      imgCount: card.querySelectorAll('img').length
    };
  });
  chk('the product photo cannot start a native image drag',
      dragging.imgDraggable === false, JSON.stringify(dragging));
  chk('the card owns every gesture direction (touch-action:none)',
      dragging.touchAction === 'none', 'got ' + dragging.touchAction);

  // ---------- the buttons still agree with the gestures ----------
  const viaButtons = await p.evaluate(async () => {
    const out = {};
    for (const [sel, want] of [['.t-like', 'like'], ['.t-skip', 'skip'], ['.t-love', 'love']]) {
      const pi = QUEUE[0];
      document.querySelector(sel).click();
      await new Promise(r => setTimeout(r, 600));
      out[want] = S.reactions[pi] || null;
    }
    return out;
  });
  chk('the Like button records a like', viaButtons.like === 'like', 'got ' + viaButtons.like);
  chk('the Skip button records a skip', viaButtons.skip === 'skip', 'got ' + viaButtons.skip);
  chk('the Love button records a love', viaButtons.love === 'love', 'got ' + viaButtons.love);

  // ---------- a like actually reaches the liked cart ----------
  const cart = await p.evaluate(async () => {
    const before = (S.likes || []).length;
    const card = document.querySelector('#cardHost .piece-card');
    const r = card.getBoundingClientRect();
    const pi = QUEUE[0];
    const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    const ev = (t, x, y) => card.dispatchEvent(new PointerEvent(t, {
      clientX: x, clientY: y, pointerId: 1, bubbles: true, cancelable: true, isPrimary: true }));
    ev('pointerdown', x0, y0);
    ev('pointermove', x0 + 150, y0);
    ev('pointerup', x0 + 200, y0);
    await new Promise(res => setTimeout(res, 600));
    return { before, after: (S.likes || []).length, holdsIt: (S.likes || []).includes(pi) };
  });
  chk('a right swipe puts the piece in the liked cart',
      cart.after === cart.before + 1 && cart.holdsIt, JSON.stringify(cart));

  await p.screenshot({ path: '/tmp/sf-shots/shot-swipe.png' });
  await b.close();

  console.log('\n===== PASS (' + ok.length + ') ====='); ok.forEach(t => console.log('  ok  ' + t));
  if (bad.length) { console.log('\n===== FAIL (' + bad.length + ') ====='); bad.forEach(t => console.log('  FAIL ' + t)); }
  if (errs.length) { console.log('\nJS ERRORS:'); [...new Set(errs)].forEach(e => console.log('  ' + e)); }
  console.log('\n' + (bad.length || errs.length ? '>>> PROBLEMS FOUND' : '>>> ALL GREEN'));
})();
