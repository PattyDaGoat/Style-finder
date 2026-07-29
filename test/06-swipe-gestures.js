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
   moves: [[dx,dy], …] relative to the card centre. endWith: 'up' | 'cancel'.
   stepMs: ms between moves — the handler reads velocity, so timing decides
   whether something is a flick or a slow drag. It is stamped explicitly rather
   than left to how fast the test happens to run, or these assertions would pass
   or fail on machine speed. */
async function gesture(p, moves, endWith, stepMs) {
  return p.evaluate(async ({ moves, endWith, stepMs }) => {
    const card = document.querySelector('#cardHost .piece-card');
    if (!card) return { error: 'no card on screen' };
    const r = card.getBoundingClientRect();
    const pi = QUEUE[0];
    const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    let t = 5000;
    const ev = (type, x, y) => {
      const e = new PointerEvent(type, {
        clientX: x, clientY: y, pointerId: 1, bubbles: true, cancelable: true, isPrimary: true
      });
      Object.defineProperty(e, 'timeStamp', { value: t });
      card.dispatchEvent(e);
    };
    ev('pointerdown', x0, y0);
    for (const [dx, dy] of moves) { t += (stepMs === undefined ? 200 : stepMs); ev('pointermove', x0 + dx, y0 + dy); }
    if (endWith === 'cancel') {
      ev('pointercancel', 0, 0);          // as the browser really sends it
    } else {
      const last = moves[moves.length - 1];
      ev('pointerup', x0 + last[0], y0 + last[1]);
    }
    await new Promise(res => setTimeout(res, (typeof SW!=='undefined'?SW.flyMs:400)+250));
    return { reaction: S.reactions[pi] || null, queueTop: QUEUE[0], wasIndex: pi };
  }, { moves, endWith, stepMs });
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

  // ---------- a light mouse flick is enough ----------
  // The point of the retune: a nudge from the wrist, never a shove to the edge.
  g = await gesture(p, [[8, 0], [14, 0], [16, 0]], 'up', 8);
  chk('a TINY quick flick right (16px) commits', g.reaction === 'like', 'got ' + g.reaction);
  g = await gesture(p, [[-8, 0], [-14, 0], [-16, 0]], 'up', 8);
  chk('a TINY quick flick left (16px) commits', g.reaction === 'skip', 'got ' + g.reaction);

  // A slow short drag — no flick at all, just a small deliberate movement.
  g = await gesture(p, [[10, 0], [18, 0], [22, 0]], 'up', 260);
  chk('a SLOW 22px drag right commits on distance alone',
      g.reaction === 'like', 'got ' + g.reaction);

  // A real fast flick often produces NO pointermove at all — the browser
  // coalesces them, or the mouse simply outruns the sampling. Tracking only
  // what pointermove reported left dx=0 and the swipe did nothing.
  const noMoves = await p.evaluate(async () => {
    const card = document.querySelector('#cardHost .piece-card');
    const r = card.getBoundingClientRect();
    const pi = QUEUE[0];
    const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    const ev = (type, x, y) => card.dispatchEvent(new PointerEvent(type, {
      clientX: x, clientY: y, pointerId: 1, bubbles: true, cancelable: true, isPrimary: true }));
    ev('pointerdown', x0, y0);
    ev('pointerup', x0 + 60, y0);          // straight to release, zero moves
    await new Promise(res => setTimeout(res, (typeof SW!=='undefined'?SW.flyMs:400)+250));
    return { reaction: S.reactions[pi] || null };
  });
  chk('a drag with NO pointermove events still registers (fast flick)',
      noMoves.reaction === 'like', 'got ' + noMoves.reaction);

  // ---------- the stated target: about a centimetre, either way ----------
  // A CSS pixel is 1/96 inch, so 1cm is ~37.8px. Moving the mouse that far must
  // register whichever direction it went and however slowly it was done.
  for (const [label, dx] of [['right', 38], ['left', -38]]) {
    const slow = await gesture(p, [[dx * 0.4, 0], [dx * 0.7, 0], [dx, 0]], 'up', 300);
    chk(`a SLOW 1cm move ${label} commits`,
        slow.reaction === (dx > 0 ? 'like' : 'skip'), 'got ' + slow.reaction);
  }
  chk('a 1cm move is far past the dead band',
      await p.evaluate('CM > SW.deadPx * 3'),
      await p.evaluate('"deadPx="+SW.deadPx+"  1cm="+Math.round(CM)+"px"'));

  // Half a centimetre, both directions, slowly — the stated target, and now far
  // above the only line that exists.
  for (const [label, dx] of [['right', 19], ['left', -19]]) {
    const halfCm = await gesture(p, [[dx * 0.5, 0], [dx, 0]], 'up', 300);
    chk(`a SLOW half-cm move ${label} commits`,
        halfCm.reaction === (dx > 0 ? 'like' : 'skip'), 'got ' + halfCm.reaction);
  }

  // ---------- the actual rule: any real movement goes, by direction ----------
  // No distance to reach and no speed to hit. Let go having moved the card at
  // all and it leaves the way you were moving it.
  for (const [label, dx, want] of [['right', 8, 'like'], ['left', -8, 'skip']]) {
    const t = await gesture(p, [[dx, 0]], 'up', 300);
    chk(`an 8px SLOW nudge ${label} commits on direction alone`,
        t.reaction === want, 'got ' + t.reaction);
  }
  const upTiny = await gesture(p, [[0, -12]], 'up', 300);
  chk('a 12px nudge up is a love', upTiny.reaction === 'love', 'got ' + upTiny.reaction);

  // Up only wins when it clearly dominates, or a rightward swipe that drifts
  // upward would love things you meant to like.
  const diag = await gesture(p, [[30, -14]], 'up', 300);
  chk('right-and-slightly-up is a like, not a love', diag.reaction === 'like', 'got ' + diag.reaction);

  // The dead band is the click/drag boundary, not a swipe threshold. It must
  // stay above TAP_SLOP or clicking the photo starts swiping cards.
  chk('the dead band sits above the tap slop',
      await p.evaluate('SW.deadPx > TAP_SLOP'),
      await p.evaluate('"deadPx="+SW.deadPx+" TAP_SLOP="+TAP_SLOP'));

  // ---------- swiping fast must not lose swipes ----------
  // The reaction lands when the card finishes leaving, so at a 560ms exit a
  // second swipe arriving mid-flight used to be discarded. Anyone going at a
  // decent pace would silently lose inputs.
  const rapid = await p.evaluate(async () => {
    const before = Object.keys(S.reactions).length;
    for (let i = 0; i < 5; i++) {
      document.querySelector('.t-like').click();
      await new Promise(r => setTimeout(r, 120));   // far faster than the exit
    }
    await new Promise(r => setTimeout(r, SW.flyMs + 250));
    return { before, after: Object.keys(S.reactions).length };
  });
  chk('5 rapid swipes all register, none dropped mid-flight',
      rapid.after - rapid.before === 5, JSON.stringify(rapid));

  // Buttons were fixed first; the DRAG path was still frozen for the whole exit
  // because pointerdown bailed while a card was in flight. Half the swipes of
  // anyone going at a normal pace were lost, silently.
  const rapidDrag = await p.evaluate(async () => {
    const drag = () => {
      const c = document.querySelector('#cardHost .piece-card');
      if (!c) return;
      const b = c.getBoundingClientRect();
      const x = b.left + b.width / 2, y = b.top + b.height / 2;
      const ev = (t, cx) => c.dispatchEvent(new PointerEvent(t, {
        clientX: cx, clientY: y, pointerId: 1, bubbles: true, cancelable: true, isPrimary: true }));
      ev('pointerdown', x); ev('pointermove', x + 40); ev('pointerup', x + 40);
    };
    const before = Object.keys(S.reactions).length;
    drag();
    await new Promise(r => setTimeout(r, 150));   // well inside the fly-out
    drag();
    await new Promise(r => setTimeout(r, SW.flyMs + 300));
    return { before, after: Object.keys(S.reactions).length };
  });
  chk('a drag started mid-fly-out is not dropped',
      rapidDrag.after - rapidDrag.before === 2, JSON.stringify(rapidDrag));

  // Right/middle mouse buttons must not swipe.
  const rmb = await p.evaluate(async () => {
    const c = document.querySelector('#cardHost .piece-card');
    const b = c.getBoundingClientRect();
    const x = b.left + b.width / 2, y = b.top + b.height / 2;
    const before = Object.keys(S.reactions).length;
    const ev = (t, cx, btn) => c.dispatchEvent(new PointerEvent(t, {
      clientX: cx, clientY: y, button: btn, pointerId: 1, bubbles: true, cancelable: true, isPrimary: true }));
    ev('pointerdown', x, 2); ev('pointermove', x + 90, 2); ev('pointerup', x + 90, 2);
    await new Promise(r => setTimeout(r, SW.flyMs + 250));
    return { before, after: Object.keys(S.reactions).length };
  });
  chk('a RIGHT-button drag does not swipe', rmb.after === rmb.before, JSON.stringify(rmb));

  // ---------- the exit is unhurried ----------
  chk('a swiped card takes its time leaving',
      await p.evaluate('SW.flyMs >= 500'), await p.evaluate('"flyMs="+SW.flyMs'));
  chk('and settles back unhurriedly when it does not commit',
      await p.evaluate('SW.springMs >= 400'), await p.evaluate('"springMs="+SW.springMs'));

  // ---------- keyboard ----------
  // The only way to use the deck without a pointer, so it is also the
  // accessibility route, not just a shortcut.
  for (const [key, want] of [['ArrowRight', 'like'], ['ArrowLeft', 'skip'], ['ArrowUp', 'love']]) {
    const k = await p.evaluate(async (key) => {
      const pi = QUEUE[0];
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 200));
      return { reaction: S.reactions[pi] || null };
    }, key);
    chk(`${key} swipes ${want}`, k.reaction === want, 'got ' + k.reaction);
  }
  // A modified arrow is the browser's (cmd+left is Back) — never ours.
  const modded = await p.evaluate(async () => {
    const before = Object.keys(S.reactions).length;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', metaKey: true, bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 200));
    return { before, after: Object.keys(S.reactions).length };
  });
  chk('cmd+Arrow is left to the browser', modded.after === modded.before, JSON.stringify(modded));
  // And typing in a field must never swipe the deck out from under you.
  const typing = await p.evaluate(async () => {
    const i = document.createElement('input');
    document.body.appendChild(i); i.focus();
    const before = Object.keys(S.reactions).length;
    i.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 200));
    const after = Object.keys(S.reactions).length;
    i.remove();
    return { before, after };
  });
  chk('arrows inside a text field do not swipe', typing.after === typing.before, JSON.stringify(typing));

  // ---------- the only line left: click vs drag ----------
  // There is no swipe threshold any more, so the guarantee changed. What must
  // still hold is that a CLICK is not a swipe — that is the bug this whole
  // thread opened with, and making the gesture this easy is exactly what could
  // bring it back.
  g = await gesture(p, [[3, 0]], 'up', 8);
  chk('a 3px wobble during a click decides nothing', g.reaction === null, 'got ' + g.reaction);
  g = await gesture(p, [[0, 3]], 'up', 8);
  chk('a 3px vertical wobble decides nothing', g.reaction === null, 'got ' + g.reaction);
  chk('the dead band is small but real (>= 4px)',
      await p.evaluate('SW.deadPx >= 4'), await p.evaluate('"deadPx=" + SW.deadPx'));

  // A plain click — press and release, no movement at all. Reported from real
  // use as "as soon as I click on it, it swipes left".
  g = await gesture(p, [[0, 0]], 'up', 8);
  chk('a plain CLICK decides nothing (was: swiped left)', g.reaction === null, 'got ' + g.reaction);

  // ---------- distance alone still commits, however slowly ----------
  g = await gesture(p, [[30, 0], [60, 0], [90, 0]], 'up', 300);
  chk('a slow but long drag right (90px) commits on distance', g.reaction === 'like', 'got ' + g.reaction);

  // ---------- the card is held, and pivots about where you grabbed ----------
  // Each grab is cancelled, never committed, so the same card survives both and
  // nothing is left mid-flight to report a stale transform.
  const rotAt = async (fracY) => p.evaluate(async (fy) => {
    const card = document.querySelector('#cardHost .piece-card');
    if (!card) return { err: 'no card' };
    const r = card.getBoundingClientRect();
    const y = r.top + r.height * fy, x = r.left + r.width / 2;
    const ev = (type, cx, cy) => card.dispatchEvent(new PointerEvent(type, {
      clientX: cx, clientY: cy, pointerId: 1, bubbles: true, cancelable: true, isPrimary: true }));
    ev('pointerdown', x, y);
    ev('pointermove', x + 80, y);          // same pull to the right both times
    const t = card.style.transform;
    ev('pointercancel', 0, 0);             // never commits, card stays
    await new Promise(res => setTimeout(res, 250));
    const m = /rotate\((-?[\d.]+)deg\)/.exec(t || '');
    return { rot: m ? parseFloat(m[1]) : null, held: /scale\(1\.0[1-9]/.test(t || ''), raw: t };
  }, fracY);

  const grabTop = await rotAt(0.2);
  const grabBottom = await rotAt(0.8);
  chk('the card lifts while held (scale > 1)', grabTop.held === true, JSON.stringify(grabTop));
  chk('pulling right from the top rotates one way',
      grabTop.rot !== null && grabTop.rot > 0, JSON.stringify(grabTop));
  chk('pulling right from the bottom pivots the other way',
      grabBottom.rot !== null && grabBottom.rot < 0, JSON.stringify(grabBottom));

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
      await new Promise(r => setTimeout(r, (typeof SW!=='undefined'?SW.flyMs:400)+250));
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
    await new Promise(res => setTimeout(res, (typeof SW!=='undefined'?SW.flyMs:400)+250));
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
