const { chromium } = require('playwright');
const { join, dirname } = require('node:path');
const REPO = dirname(dirname(require('node:fs').realpathSync(__filename)));
const DIST = join(REPO, 'dist', 'style-finder.html');
const DIST_URL = 'file://' + DIST;
require('node:fs').mkdirSync('/tmp/sf-shots', { recursive: true });

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

 // ---------- G. the strict toggle in the UI ----------
 chk('strict toggle visible on the deck', await p.isVisible('#strictBtn'));
 chk('strict is ON by default', await p.evaluate("STRICT_SECT===true"));
 chk('toggle explains itself', (await p.textContent('#strictNote')).length>40);
 const before=await p.evaluate("(()=>{let n=0;for(let i=0;i<CATALOG.length;i++)if(passesFilters(i))n++;return n;})()");
 await p.click('#strictBtn'); await p.waitForTimeout(900);
 const after=await p.evaluate("(()=>{let n=0;for(let i=0;i<CATALOG.length;i++)if(passesFilters(i))n++;return n;})()");
 chk('turning strict off widens the deck', after>before, before+' -> '+after);
 chk('label updates when relaxed', (await p.textContent('#strictBtn')).includes('unplaced'));
 await p.click('#strictBtn'); await p.waitForTimeout(900);
 chk('turning it back on narrows the deck again',
     (await p.evaluate("(()=>{let n=0;for(let i=0;i<CATALOG.length;i++)if(passesFilters(i))n++;return n;})()"))===before);
 chk('deck still renders a card after toggling', (await p.$$('#cardHost .piece-card')).length>0);

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

 await p.screenshot({path:'/tmp/sf-shots/shot-sect.png'});
 await b.close();
 console.log('\n===== PASS ('+ok.length+') ====='); ok.forEach(t=>console.log('  ok  '+t));
 if(bad.length){console.log('\n===== FAIL ('+bad.length+') ====='); bad.forEach(t=>console.log('  FAIL '+t));}
 if(errs.length){console.log('\nJS ERRORS:'); [...new Set(errs)].forEach(e=>console.log('  '+e));}
 console.log('\n'+(bad.length||errs.length?'>>> PROBLEMS FOUND':'>>> ALL GREEN'));
})();
