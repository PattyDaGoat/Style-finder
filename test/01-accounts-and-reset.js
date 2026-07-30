const { chromium } = require('playwright');
const { join, dirname } = require('node:path');
const REPO = dirname(dirname(require('node:fs').realpathSync(__filename)));
const DIST = join(REPO, 'dist', 'style-finder.html');
const DIST_URL = require('node:url').pathToFileURL(DIST).href;
const SHOTS = join(require('node:os').tmpdir(), 'sf-shots');
require('node:fs').mkdirSync(SHOTS, { recursive: true });

const path = DIST;
const URL = DIST_URL;

const ok = [], bad = [];
async function settle(page) {
  await page.waitForLoadState('load').catch(() => {});
  await page.waitForFunction("typeof storeKey === 'function' && typeof S === 'object'", null, { timeout: 30000 });
  await page.waitForTimeout(500);
}
function chk(name, cond, extra) { (cond ? ok : bad).push(name + (extra ? ' :: ' + extra : '')); }

/* A swipe's reaction lands when the card has finished leaving, so anything
   reading state straight after a swipe has to wait for that. Derived from the
   app's own SW.flyMs rather than hardcoded, or retuning the animation silently
   makes this suite flaky — which is exactly what happened when the exit went
   from 300ms to 560ms. */
async function afterSwipe(page) {
  const ms = await page.evaluate("typeof SW!=='undefined' ? SW.flyMs : 380").catch(() => 380);
  await page.waitForTimeout(ms + 180);
}

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/net::|Failed to load resource|gsi\/client/.test(m.text())) errs.push('CONSOLE: ' + m.text()); });

  await page.goto(URL, { waitUntil: 'domcontentloaded' });
  await settle(page);

  // ---------- 1. sign-in gate ----------
  chk('auth screen visible on first load', await page.isVisible('#auth'));
  chk('settings hidden behind gate', !(await page.isVisible('#settings')));
  chk('top bar hidden on auth screen', !(await page.isVisible('#appbar')));
  chk('fallback google buttons shown (no CLIENT_ID)', await page.isVisible('#gFallback'));
  chk('real GIS block hidden (no CLIENT_ID)', !(await page.isVisible('#gReal')));
  chk('guest bypass present', await page.isVisible('text=Continue as guest'));
  chk('honest warning about google shown', (await page.textContent('.auth-warn')).includes("isn't switched on"));

  // ---------- 2. create a local "Google" account ----------
  await page.click('#gFallback >> text=Create a new account with Google');
  chk('local form opens', await page.isVisible('#localForm'));
  await page.fill('#lfName', 'Patrick');
  await page.fill('#lfEmail', 'psuttongerstein@gmail.com');
  await page.click('#localForm >> text=Continue');
  await page.waitForTimeout(600);

  chk('routed to step 1 setup after new account', await page.isVisible('#settings'));
  chk('top bar now visible', await page.isVisible('#appbar'));
  chk('Start over button visible on top', await page.isVisible('.ab-restart'));
  chk('account chip shows name', (await page.textContent('#acctChip')).includes('Patrick'));
  const abBox = await (await page.$('#appbar')).boundingBox();
  chk('top bar is at the top of the page', abBox.y < 90, 'y=' + Math.round(abBox.y));

  // ---------- 3. complete the profile + swipe ----------
  await page.click('.seg-btn[data-g="m"]');
  await page.click('#topSizes .size-chip >> nth=2');       // M
  await page.fill('#setWaist', '32');
  await page.fill('#setShoe', 'US 10');
  await page.click('#setCats .chip >> nth=0');
  await page.click('text=Next →');
  await page.waitForTimeout(300);
  chk('step 2 reached', await page.isVisible('#settings2'));
  await page.click('#setBudget .chip >> nth=3');
  await page.click('text=Start shopping');
  await page.waitForTimeout(1500);
  chk('deck reached', await page.isVisible('#deck'));
  chk('a card rendered', (await page.$$('#cardHost .piece-card')).length > 0);

  for (let i = 0; i < 6; i++) { await page.click('.t-like'); await afterSwipe(page); }
  await page.click('.t-love'); await afterSwipe(page);
  await page.click('.swipe-cart').catch(() => {});
  await page.waitForTimeout(400);

  const st1 = await page.evaluate(() => {
    const k = 'styleDNA_v3::l_psuttongerstein_gmail_com';
    const raw = localStorage.getItem(k);
    return { key: k, exists: !!raw, obj: raw ? JSON.parse(raw) : null,
             allKeys: Object.keys(localStorage).sort(),
             acct: (JSON.parse(localStorage.getItem('styleDNA_accounts')) || []).map(a => a.id) };
  });
  chk('profile saved under per-account key', st1.exists, st1.key);
  chk('reactions recorded', st1.obj && Object.keys(st1.obj.reactions || {}).length >= 6,
      'n=' + (st1.obj ? Object.keys(st1.obj.reactions || {}).length : 0));
  chk('sizes saved', st1.obj && st1.obj.settings && st1.obj.settings.top === 'M');
  chk('account registered', st1.acct.includes('l_psuttongerstein_gmail_com'), JSON.stringify(st1.acct));
  chk('NO writes to old un-namespaced key', !st1.allKeys.includes('styleDNA_v3'), JSON.stringify(st1.allKeys));

  // ---------- 4. reload = still signed in, progress kept ----------
  await page.reload({ waitUntil: 'domcontentloaded' });
  await settle(page);
  chk('reload skips sign-in (stays signed in)', !(await page.isVisible('#auth')));
  chk('reload lands on deck', await page.isVisible('#deck'));
  chk('chip still shows Patrick', (await page.textContent('#acctChip')).includes('Patrick'));
  const cartN = await page.textContent('#cartFabN');
  chk('cart survived reload', parseInt(cartN, 10) >= 1, 'cart=' + cartN);

  // ---------- 5. RESTART ----------
  await page.click('.ab-restart');
  await page.waitForTimeout(300);
  chk('reset confirm modal opens', await page.isVisible('#resetOverlay'));
  chk('modal names the account', (await page.textContent('#resetWho')).includes('Patrick'));
  await page.click('#resetOverlay >> text=Cancel');
  chk('cancel closes modal', !(await page.isVisible('#resetOverlay')));
  chk('cancel did NOT wipe data', await page.evaluate(() => !!localStorage.getItem('styleDNA_v3::l_psuttongerstein_gmail_com')));

  await page.click('.ab-restart');
  await page.waitForTimeout(250);
  await page.click('#resetOverlay >> text=Yes, clear everything');
  await settle(page);

  chk('after reset: back on step 1 setup', await page.isVisible('#settings'));
  chk('after reset: still signed in (no auth screen)', !(await page.isVisible('#auth')));
  chk('after reset: chip still Patrick', (await page.textContent('#acctChip')).includes('Patrick'));
  const after = await page.evaluate(() => {
    const raw = localStorage.getItem('styleDNA_v3::l_psuttongerstein_gmail_com');
    return { raw: raw, s: S, gender: GENDER, queue: QUEUE.length, model: MODEL, inspoImgs: INSPO && INSPO.imgs, served: SERVED.size, hist: (S.hist||[]).length };
  });
  chk('after reset: saved profile gone', after.raw === null, 'raw=' + after.raw);
  chk('after reset: reactions empty', Object.keys(after.s.reactions || {}).length === 0);
  chk('after reset: likes empty', (after.s.likes || []).length === 0);
  chk('after reset: cart empty', (after.s.picks || []).length === 0);
  chk('after reset: settings gone', !after.s.settings);
  chk('after reset: sizes/byGender empty', Object.keys(after.s.byGender || {}).length === 0);
  chk('after reset: learned model cleared', after.model === null, 'model=' + JSON.stringify(after.model));
  chk('after reset: cart badge 0', (await page.textContent('#cartFabN')) === '0');
  chk('after reset: toast shown', await page.isVisible('#toast'));

  // ---------- 6. sign out -> gate returns ----------
  await page.click('#acctChip'); await page.waitForTimeout(250);
  chk('account menu opens', await page.isVisible('#acctMenu'));
  await page.click('#acctMenu >> text=Sign out');
  await settle(page);
  chk('sign out returns to gate', await page.isVisible('#auth'));
  chk('signed-out account offered under "Continue as"', (await page.textContent('#knownAccts')).includes('Patrick'));

  // ---------- 7. second account is isolated ----------
  await page.click('#gFallback >> text=Sign in with Google');
  await page.fill('#lfName', 'Friend');
  await page.fill('#lfEmail', 'friend@gmail.com');
  await page.click('#localForm >> text=Continue');
  await page.waitForTimeout(700);
  chk('2nd account starts at step 1 (own blank profile)', await page.isVisible('#settings'));
  chk('2nd account chip shows Friend', (await page.textContent('#acctChip')).includes('Friend'));
  const iso = await page.evaluate(() => ({
    s: S, keys: Object.keys(localStorage).filter(k => k.indexOf('styleDNA_v3::') === 0).sort()
  }));
  chk('2nd account has no inherited swipes', Object.keys(iso.s.reactions || {}).length === 0);
  chk('2nd account has no inherited cart', (iso.s.picks || []).length === 0);

  // give Friend some swipes, then switch back and confirm separation
  await page.click('.seg-btn[data-g="f"]');
  await page.click('#topSizes .size-chip >> nth=1');
  await page.click('text=Next →'); await page.waitForTimeout(300);
  await page.click('text=Start shopping'); await page.waitForTimeout(1400);
  for (let i = 0; i < 3; i++) { await page.click('.t-love'); await afterSwipe(page); }
  const sep = await page.evaluate(() => {
    const f = JSON.parse(localStorage.getItem('styleDNA_v3::l_friend_gmail_com') || 'null');
    const p = localStorage.getItem('styleDNA_v3::l_psuttongerstein_gmail_com');
    return { friendReacts: f ? Object.keys(f.reactions || {}).length : 0, friendGender: f && f.settings && f.settings.gender, patrick: p };
  });
  chk("friend's swipes saved to friend's key", sep.friendReacts >= 3, 'n=' + sep.friendReacts);
  chk("friend's womenswear choice did not leak", sep.friendGender === 'f');
  chk("Patrick's (reset) profile still absent — no cross-write", sep.patrick === null);

  // ---------- 8. switch account ----------
  await page.click('#acctChip'); await page.waitForTimeout(200);
  await page.click('#acctMenu >> text=Switch account');
  await settle(page);
  chk('switch account returns to gate', await page.isVisible('#auth'));
  chk('both accounts listed', (await page.textContent('#knownAccts')).includes('Friend') && (await page.textContent('#knownAccts')).includes('Patrick'));

  // ---------- 9. guest path ----------
  await page.click('text=Continue as guest');
  await page.waitForTimeout(700);
  chk('guest reaches the app', await page.isVisible('#settings'));
  chk('guest chip says Guest', (await page.textContent('#acctChip')).includes('Guest'));
  await page.click('#acctChip'); await page.waitForTimeout(200);
  chk('guest menu offers Google sign-in', (await page.textContent('#acctMenu')).includes('Sign in with Google'));
  chk('guest menu has no Sign out', !(await page.textContent('#acctMenu')).includes('Sign out'));
  await page.keyboard.press('Escape');
  await page.click('body', { position: { x: 5, y: 500 } });
  await page.waitForTimeout(200);
  chk('clicking outside closes account menu', !(await page.isVisible('#acctMenu')));

  await page.screenshot({ path: join(SHOTS,'shot-setup.png') });
  await page.evaluate(() => { localStorage.removeItem('styleDNA_lastAccount'); });
  await page.reload({ waitUntil: 'domcontentloaded' }); await settle(page);
  await page.screenshot({ path: join(SHOTS,'shot-auth.png') });

  /* ---- the carts are per section ----
     Menswear and womenswear each keep their own cart and liked list. The pieces
     still live in one array; which section a piece belongs to is read off the
     piece (inSection), so the thing worth asserting is that the two VIEWS never
     see each other — and, above all, that Clear empties only the section you are
     looking at. A Clear that quietly binned the other section's cart would be
     the worst possible bug in this feature and is silent from the UI. */
  const carts = await page.evaluate(() => {
    const keepG = GENDER, keepP = S.picks, keepL = S.likes, keepR = S.reactions;
    const men = [], women = [], uni = [];
    for (let i = 0; i < CATALOG.length; i++) {
      const inM = inSection(i, 'm'), inF = inSection(i, 'f');
      if (CATALOG[i].g === 'u' && inM && inF) { if (uni.length < 2) uni.push(i); }
      else if (inM && !inF) { if (men.length < 3) men.push(i); }
      else if (inF && !inM) { if (women.length < 3) women.push(i); }
      if (men.length >= 3 && women.length >= 3 && uni.length >= 2) break;
    }
    S.picks = [...men, ...women, ...uni]; S.likes = []; S.reactions = {};
    GENDER = 'm'; const mCart = cartView('cart').length;
    GENDER = 'f'; const fCart = cartView('cart').length;
    GENDER = 'm'; const mSaw = cartView('cart').every(i => inSection(i, 'm'));
    GENDER = 'f'; const fSaw = cartView('cart').every(i => inSection(i, 'f'));
    /* clear menswear only */
    GENDER = 'm'; CART_VIEW = 'cart'; clearCart();
    const afterM = (GENDER = 'm', cartView('cart').length);
    const afterF = (GENDER = 'f', cartView('cart').length);
    GENDER = keepG; S.picks = keepP; S.likes = keepL; S.reactions = keepR;
    return { seeded: men.length + women.length + uni.length, uni: uni.length,
             mCart, fCart, mSaw, fSaw, afterM, afterF };
  });
  chk('menswear cart shows only menswear pieces', carts.mSaw, 'n=' + carts.mCart);
  chk('womenswear cart shows only womenswear pieces', carts.fSaw, 'n=' + carts.fCart);
  chk('each section sees its own pieces plus unisex',
      carts.mCart === 3 + carts.uni && carts.fCart === 3 + carts.uni,
      'm=' + carts.mCart + ' f=' + carts.fCart + ' (3 own + ' + carts.uni + ' unisex each)');
  chk('clearing the menswear cart empties it', carts.afterM === 0, 'left ' + carts.afterM);
  chk('clearing the menswear cart leaves womenswear alone',
      carts.afterF === 3, 'womenswear left with ' + carts.afterF + ' of 3');

  await browser.close();

  console.log('\n===== PASS (' + ok.length + ') =====');
  ok.forEach(t => console.log('  ok  ' + t));
  if (bad.length) { console.log('\n===== FAIL (' + bad.length + ') ====='); bad.forEach(t => console.log('  FAIL ' + t)); }
  if (errs.length) { console.log('\n===== JS ERRORS ====='); [...new Set(errs)].forEach(e => console.log('  ' + e)); }
  console.log('\n' + (bad.length || errs.length ? '>>> PROBLEMS FOUND' : '>>> ALL GREEN'));
})();
