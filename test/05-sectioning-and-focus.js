const { chromium } = require('playwright');
const { join, dirname } = require('node:path');
const REPO = dirname(dirname(require('node:fs').realpathSync(__filename)));
const DIST = join(REPO, 'dist', 'style-finder.html');
const DIST_URL = require('node:url').pathToFileURL(DIST).href;
const SHOTS = join(require('node:os').tmpdir(), 'sf-shots');
require('node:fs').mkdirSync(SHOTS, { recursive: true });

const ok=[],bad=[];
const chk=(n,c,e)=>(c?ok:bad).push(n+(e?' :: '+e:''));
async function settle(p){await p.waitForLoadState('load').catch(()=>{});await p.waitForFunction("typeof storeKey==='function'");await p.waitForTimeout(400);}
(async()=>{
 const b=await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
 const p=await (await b.newContext({viewport:{width:1150,height:1050}})).newPage();
 const errs=[]; p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
 p.on('console',m=>{if(m.type()==='error'&&!/net::|Failed to load|gsi\/client|ERR_/.test(m.text()))errs.push('CONSOLE: '+m.text());});
 await p.goto(DIST_URL,{waitUntil:'domcontentloaded'}); await settle(p);

 // ---------- A. detector tiers ----------
 const det=await p.evaluate(()=>{
   const t=(n,cat,u,img,brand)=>detectSection({n:n,cat:cat,u:u||'',img:img||'',b:brand||'X'});
   return {
     nameF:  t("Bodycon Midi Dress","dress"),
     nameM:  t("Mens Devotion Hood","sweat"),
     dressShirt: t("Men's Apollo Dress Shirt","shirt"),
     urlF:   t("Cotton Diana Edition Sweater","knit","https://rowingblazers.com/products/womens-cotton-diana-edition-sweater-pink"),
     urlM:   t("Tech Short","short","https://rowingblazers.com/products/mens-tech-short-natural"),
     brandF: t("Silk Scarf","acc","https://x.com/products/scarf","a.jpg","Wax London Womens"),
     imgF:   t("Gigi Smocked Dress Autumn","dress","https://x.com/products/gigi","F1_W_Gigi_Smocked.jpg"),
     imgM:   t("Dory Crew Sweater","knit","https://x.com/products/dory","instock_m_q326_dory-crew.jpg"),
     cameraFile: t("Cord Soft Trucker Cap","cap","https://x.com/products/cap","CordSoftTruckerCap_Navy_W7A1410.jpg"),
     nothing: t("Blur II Tee","tee","https://quasi.com/products/blur-ii-tee","blur2.jpg"),
     urlBeatsFilename: t("Sunbeam Muse Premium Tee","tee",
        "https://roark.com/products/womens-sunbeam-muse-premium-tee-wheat","WRT085_WHE_01_0374.jpg")
   };
 });
 chk('name audience word still wins', det.nameF.g==='f'&&det.nameM.g==='m');
 chk('"dress shirt" still not read as a dress', det.dressShirt.g==='m', JSON.stringify(det.dressShirt));
 chk('product URL /womens- detected', det.urlF.g==='f'&&det.urlF.why==='product web address', JSON.stringify(det.urlF));
 chk('product URL /mens- detected', det.urlM.g==='m', JSON.stringify(det.urlM));
 chk('brand name "Womens" detected', det.brandF.g==='f'&&det.brandF.why==='brand name', JSON.stringify(det.brandF));
 chk('photo filename _W_ detected', det.imgF.g==='f', JSON.stringify(det.imgF));
 chk('photo filename _m_ detected', det.imgM.g==='m', JSON.stringify(det.imgM));
 chk('camera filename W7A1410 NOT mistaken for womenswear', det.cameraFile.g===null, JSON.stringify(det.cameraFile));
 chk('a listing with no gender clue returns null, not a guess', det.nothing.g===null, JSON.stringify(det.nothing));
 chk('URL outranks the photo filename', det.urlBeatsFilename.why==='product web address', JSON.stringify(det.urlBeatsFilename));

 // ---------- B. the corrections it makes on the real catalog ----------
 const corr=await p.evaluate(()=>{
   const lock=genderLock(); let fixed=[];
   for(let i=0;i<CATALOG.length;i++){
     const p=CATALOG[i]; const want=lock[i]===1?'f':lock[i]===2?'m':null;
     if(want && p.g!=='u' && want!==p.g) fixed.push({b:p.b,n:p.n.slice(0,40),tag:p.g,now:want,why:detectSection(p).why});
   }
   const counts={placed:0,unplaced:0,f:0,m:0};
   for(let i=0;i<CATALOG.length;i++){ if(lock[i]===0)counts.unplaced++; else {counts.placed++; lock[i]===1?counts.f++:counts.m++;} }
   return {fixed:fixed.slice(0,8), nFixed:fixed.length, counts,
           leanBrands:Object.keys(gdLean()).length};
 });
 chk('the new signals correct wrongly-tagged items', corr.nFixed>25, corr.nFixed+' corrected');
 chk('most of the catalog is now positively placed', corr.counts.placed>7500,
     'placed '+corr.counts.placed+' / unplaced '+corr.counts.unplaced);
 chk('brand lean built for many brands', corr.leanBrands>150, corr.leanBrands+' brands');
 console.log('\nCORRECTIONS made by reading the URL/filename/brand (sample):');
 corr.fixed.forEach(f=>console.log('   was '+f.tag+' -> now '+f.now+'  ('+f.why+')  '+f.b+' — '+f.n));
 console.log('placed: '+corr.counts.placed+'  (women '+corr.counts.f+', men '+corr.counts.m+')  unplaced: '+corr.counts.unplaced);

 // ---------- C. strict mode: zero cross-gender in either deck ----------
 for(const g of ['m','f']){
   const r=await p.evaluate(gg=>{
     GENDER=gg; S.settings={gender:gg,maxBudget:100000}; STRICT_SECT=true;
     const lock=genderLock(); const pool=[];
     for(let i=0;i<CATALOG.length;i++) if(passesFilters(i)) pool.push(i);
     const other=gg==='m'?1:2;
     return {pool:pool.length,
             wrong:pool.filter(i=>lock[i]===other).length,
             unplaced:pool.filter(i=>lock[i]===0).length,
             dresses:pool.filter(i=>CATALOG[i].cat==='dress').length,
             cats:[...new Set(pool.map(i=>CATALOG[i].cat))].sort()};
   },g);
   const L=g==='m'?'MENSWEAR':'WOMENSWEAR';
   chk(L+' strict: zero pieces from the other section', r.wrong===0, 'wrong='+r.wrong);
   chk(L+' strict: zero unplaceable pieces', r.unplaced===0, 'unplaced='+r.unplaced);
   chk(L+' strict: deck still substantial', r.pool>3000, r.pool+' pieces');
   chk(L+' strict: all categories present', r.cats.length>=9, r.cats.join(','));
   if(g==='m') chk('MENSWEAR strict: no dresses', r.dresses===0);
   console.log(L+' strict deck: '+r.pool+' pieces across '+r.cats.length+' categories');
 }

 // ---------- D. relaxed mode still excludes cross-gender, only adds unplaced ----------
 const relaxed=await p.evaluate(()=>{
   GENDER='m'; S.settings={gender:'m',maxBudget:100000}; STRICT_SECT=false;
   const lock=genderLock(); const pool=[];
   for(let i=0;i<CATALOG.length;i++) if(passesFilters(i)) pool.push(i);
   return {pool:pool.length, wrong:pool.filter(i=>lock[i]===1).length,
           unplaced:pool.filter(i=>lock[i]===0).length};
 });
 chk('relaxed mode still admits ZERO confirmed womenswear into menswear', relaxed.wrong===0);
 chk('relaxed mode adds back the unplaceable pieces', relaxed.unplaced>500, 'unplaced='+relaxed.unplaced);
 console.log('MENSWEAR relaxed deck: '+relaxed.pool+' pieces ('+relaxed.unplaced+' unplaced added back)');

 // ---------- E. the mis-tag guard still holds ----------
 const guard=await p.evaluate(()=>{
   const i=CATALOG.findIndex(x=>x.cat==='dress'&&/\bdress\b/i.test(x.n));
   const o=CATALOG[i].g; CATALOG[i].g='m'; GLOCK=null; GD_LEAN=null;
   GENDER='m'; S.settings={gender:'m',maxBudget:100000}; STRICT_SECT=false;
   const reach=passesFilters(i);
   CATALOG[i].g=o; GLOCK=null; GD_LEAN=null;
   return reach;
 });
 chk('a dress mis-tagged menswear is still blocked, even in relaxed mode', guard===false);

 // ---------- F. full photo is now the default ----------
 await p.evaluate(()=>localStorage.clear());
 await p.reload({waitUntil:'domcontentloaded'}); await settle(p);
 await p.click('text=Continue as guest'); await p.waitForTimeout(300);
 await p.click('#topSizes .size-chip >> nth=2');
 await p.click('text=Next →'); await p.waitForTimeout(250);
 await p.click('text=Start shopping'); await p.waitForTimeout(1700);
 chk('FIRST VISIT shows the full photo, no highlight', await p.evaluate("FOCUS_ON===false"));
 chk('first visit: photo has no dimming applied',
     await p.evaluate("document.querySelector('#cardHost .piece-photo').classList.contains('nofocus')===true"));
 chk('button invites you to highlight', (await p.textContent('#focusBtn')).includes('Highlight the piece'));
 await p.click('#focusBtn'); await p.waitForTimeout(300);
 chk('opting in turns the highlight on', await p.evaluate("FOCUS_ON===true"));
 chk('button confirms it is on', (await p.textContent('#focusBtn')).includes('Showing the piece'));
 await p.reload({waitUntil:'domcontentloaded'}); await settle(p); await p.waitForTimeout(1400);
 chk('the opt-in survives a reload', await p.evaluate("FOCUS_ON===true"));
 await p.evaluate(()=>localStorage.removeItem('styleDNA_focus'));
 await p.reload({waitUntil:'domcontentloaded'}); await settle(p); await p.waitForTimeout(1400);
 chk('clearing the preference returns to full photo', await p.evaluate("FOCUS_ON===false"));

 // ---------- G. strict sectioning is always on, with no toggle to turn it off ----------
 chk('strict toggle UI is gone from the deck', !(await p.$('#strictBtn')) && !(await p.$('#strictNote')));
 chk('strict is ON', await p.evaluate("STRICT_SECT===true"));
 chk('an old saved opt-out cannot resurrect it', await p.evaluate(
     "(()=>{try{localStorage.setItem('styleDNA_strictSect','0');}catch(_){ } return typeof toggleStrictSect==='undefined';})()"));
 chk('unplaceable pieces are held back from the deck', await p.evaluate(
     "(()=>{const l=genderLock();for(let i=0;i<CATALOG.length;i++){if(l[i]===0&&passesFilters(i))return false;}return true;})()"));
 chk('deck still renders a card', (await p.$$('#cardHost .piece-card')).length>0);

 // ---------- H. swipe the real deck: nothing cross-gender ----------
 const sweep=await p.evaluate(()=>{
   const lock=genderLock(); const seen=[];
   for(let n=0;n<70;n++){ if(!QUEUE.length) refill(); if(!QUEUE.length) break;
     seen.push(QUEUE[0]); react('like'); }
   return {n:seen.length, wrong:seen.filter(i=>lock[i]===1).length,
           unplaced:seen.filter(i=>lock[i]===0).length,
           tagged_f:seen.filter(i=>CATALOG[i].g==='f').length};
 });
 chk('swept '+sweep.n+' real menswear cards', sweep.n>=60);
 chk('none were confirmed womenswear', sweep.wrong===0);
 chk('none were unplaceable', sweep.unplaced===0, 'unplaced='+sweep.unplaced);

 // ---------- E. underwear never reaches the deck ----------
 const uw=await p.evaluate(()=>{
   const probe=(n,cat)=>{                       // run one name through the same logic
     const idx=CATALOG.length;                  // scratch row, removed right after
     CATALOG.push({n:n,cat:cat||'tee',b:'X',g:'m',u:'https://x.com/products/p',img:'a.jpg'});
     UWEAR=null; const hit=!!underwearLock()[idx];
     CATALOG.pop(); UWEAR=null; return hit;
   };
   const blocked={
     boxers: probe('Boxer Briefs 3-Pack','short'),
     bra:    probe('Seamless Bralette'),
     thong:  probe('Core Thong 6-Pack','short'),
     lingerie: probe('Lace Lingerie Set')
   };
   const exempt={
     sportsBra: probe('Movement Sports Bra'),
     swimBrief: probe('Swim Briefs','short'),
     flipFlops: probe('Freedom Thongs','short'),
     thongSandal: probe('Earthen Heel Thong','shoe'),
     boxerShirt: probe('Pop Boxer Overshirt','outer'),
     bikini: probe('Thong Tie Side Bikini Bottom','short')
   };
   // and the live catalog: nothing the lock flags may pass the master filter
   const lockArr=underwearLock();
   let leaks=0;
   for(let i=0;i<CATALOG.length;i++) if(lockArr[i]&&passesFilters(i)) leaks++;
   return {blocked:blocked, exempt:exempt, leaks:leaks,
           flagged:lockArr.reduce((a,v)=>a+v,0)};
 });
 chk('underwear names are flagged', Object.values(uw.blocked).every(v=>v===true), JSON.stringify(uw.blocked));
 chk('activewear/swim/sandals/shirts are NOT flagged', Object.values(uw.exempt).every(v=>v===false), JSON.stringify(uw.exempt));
 /* The lock's logic is proven on the synthetic names above; these two check the
   live data. This used to be one assertion that *required* the catalog to still
   contain intimates in order to prove nothing leaked — which stopped being true
   once export.py started shipping clothes only (ALLOWED_CATS / is_clothing).
   Nothing to leak is the stronger outcome, so it is now asserted directly, and
   the leak check is kept separately so it still guards a catalog that regains
   one. */
chk('no flagged intimates reach the deck', uw.leaks===0, 'leaks='+uw.leaks);
chk('catalog is clothes-only — no intimates left in the data', uw.flagged===0, 'flagged='+uw.flagged);

/* ---------- women's swimwear must never reach the men's deck ----------
   detectSection decides this at T0, above the tier that reads audience words,
   so a stray "men's" in a product name cannot outrank it. The loose words
   (one-piece, two-piece, bandeau, cover-up) only count with swim context
   beside them, because "Two Piece Wool Suit" is menswear. */
const swim=await p.evaluate(()=>{
  const probe=n=>({piece:{n:n,cat:'short',u:'',img:'',b:'X'}});
  const blocked={}, exempt={};
  ['Ribbed Bikini Top','String Bikini Bottom','Monokini Black','Tankini Set Navy',
   'Ruched One-Piece Swimsuit','Resort Two Piece','Beach Cover-Up Linen',
   'Bandeau Swim Top','Maillot Noir',"Men's Bikini Cut Swimsuit"]
    .forEach(n=>{const{piece}=probe(n);blocked[n]=isWomensSwim(piece)&&detectSection(piece).g==='f';});
  ['Swim Trunks Navy','Board Shorts Olive','Two Piece Wool Suit','Swim Shorts 5in',
   'Rash Guard Long Sleeve','One Piece Coverall Workwear']
    .forEach(n=>{const{piece}=probe(n);exempt[n]=isWomensSwim(piece);});

  // and the live catalog: zero women's swimwear may pass the men's filter
  GENDER='m'; S.settings={gender:'m',maxBudget:100000}; STRICT_SECT=true;
  let inMens=0, flagged=0;
  for(let i=0;i<CATALOG.length;i++){
    if(isWomensSwim(CATALOG[i])){ flagged++; if(passesFilters(i)) inMens++; }
  }
  return {blocked,exempt,inMens,flagged};
});
chk("women's swimwear names are locked to womenswear",
    Object.values(swim.blocked).every(v=>v===true), JSON.stringify(swim.blocked));
chk("men's swim shorts and a two-piece suit are NOT mistaken for it",
    Object.values(swim.exempt).every(v=>v===false), JSON.stringify(swim.exempt));
chk('no bikini or women\'s swimsuit can reach the men\'s deck ('+swim.flagged+' in the catalog)',
    swim.inMens===0, 'reached the men\'s deck: '+swim.inMens);
 chk('strict-section toggle UI is gone', await p.evaluate("!document.getElementById('strictBtn') && !document.getElementById('strictNote')"));
 chk('strict sectioning itself is still on', await p.evaluate("STRICT_SECT===true"));

 await p.screenshot({path:join(SHOTS,'shot-sect.png')});
 await b.close();
 console.log('\n===== PASS ('+ok.length+') ====='); ok.forEach(t=>console.log('  ok  '+t));
 if(bad.length){console.log('\n===== FAIL ('+bad.length+') ====='); bad.forEach(t=>console.log('  FAIL '+t));}
 if(errs.length){console.log('\nJS ERRORS:'); [...new Set(errs)].forEach(e=>console.log('  '+e));}
 console.log('\n'+(bad.length||errs.length?'>>> PROBLEMS FOUND':'>>> ALL GREEN'));
})();
