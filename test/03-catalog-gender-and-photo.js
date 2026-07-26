const { chromium } = require('playwright');
const { join, dirname } = require('node:path');
const REPO = dirname(dirname(require('node:fs').realpathSync(__filename)));
const DIST = join(REPO, 'dist', 'style-finder.html');
const DIST_URL = require('node:url').pathToFileURL(DIST).href;
const SHOTS = join(require('node:os').tmpdir(), 'sf-shots');
require('node:fs').mkdirSync(SHOTS, { recursive: true });

const ok=[],bad=[];
const chk=(n,c,e)=>(c?ok:bad).push(n+(e?' :: '+e:''));
async function settle(p){await p.waitForLoadState('load').catch(()=>{});await p.waitForFunction("typeof storeKey==='function'",null,{timeout:30000});await p.waitForTimeout(400);}

(async()=>{
 const b=await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
 const c=await b.newContext({viewport:{width:1150,height:1000}});
 const p=await c.newPage();
 const errs=[];
 p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
 p.on('console',m=>{if(m.type()==='error'&&!/net::|Failed to load resource|gsi\/client|ERR_/.test(m.text()))errs.push('CONSOLE: '+m.text());});
 await p.goto(DIST_URL); await settle(p);

 // ---------------- 1. catalog integrity ----------------
 const cat=await p.evaluate(()=>{
   const cats={}, gs={};
   CATALOG.forEach(x=>{cats[x.cat]=(cats[x.cat]||0)+1; gs[x.g]=(gs[x.g]||0)+1;});
   return {n:CATALOG.length, cats, gs,
           noImg:CATALOG.filter(x=>!x.img).length, noUrl:CATALOG.filter(x=>!x.u).length,
           APPARELCATS:Object.keys(cats).sort()};
 });
 chk('catalog loaded', cat.n>8000, cat.n+' items');
 chk('every category is an apparel category',
     cat.APPARELCATS.every(k=>['tee','shirt','trouser','short','sweat','dress','knit','cap','acc','shoe','outer'].includes(k)),
     JSON.stringify(cat.APPARELCATS));
 chk('no items missing an image or link', cat.noImg===0&&cat.noUrl===0);
 chk('DECK index list removed', await p.evaluate("typeof DECK==='undefined'"));
 chk('profile storage version bumped to v3', (await p.evaluate("KEY"))==='styleDNA_v3');

 // ---------------- 2. non-apparel absence ----------------
 const junk=await p.evaluate(()=>{
   const junkRx=/\b(beach towel|bath towel|bath sheet|golf towel|pillowcase|pillow|coverlet|blanket|throw|candle|mug|tumbler|magazine|hand cream|bottle opener|woodcarved|skateboard|wheel|griptape|putter|coaster|gift card|serum|sunscreen|shampoo|notebook|furniture|collected works|packing cube|spectacle cord)\b/i;
   const wearRx=/\b(tee|t-?shirts?|shirts?|sweater|sweat|hoodie|jacket|coat|knit|jumper|cardigan|top|tank|pants?|trousers?|jeans?|shorts?|skirt|dress|socks?|cap|hat|belt|scarf|shoes?|sneakers?|boots?|bag|tote|robe|bikini|swim|bra|briefs?|gloves?|beanie|vest|polo|blouse)\b/i;
   const lastEnd=(rx,s)=>{let e=-1,m,g=new RegExp(rx.source,'gi');while((m=g.exec(s)))e=m.index+m[0].length;return e;};
   // only flag when the non-apparel word is the head noun, e.g. "Beach Towel" but not "Pillow Sweater"
   return CATALOG.filter(x=>{const seg=x.n.split(/\s+[-–—|:~]\s+/)[0];
     return junkRx.test(seg) && lastEnd(junkRx,seg) >= lastEnd(wearRx,seg);}).map(x=>x.b+' — '+x.n).slice(0,12);
 });
 chk('no non-apparel items left in the catalog', junk.length===0, junk.join(' | '));

 // ---------------- 3. the gender detector itself ----------------
 const det=await p.evaluate(()=>{
   const cases=[
     ["Bodycon Midi Dress","dress","f"], ["Women's Crew Sweatshirt","sweat","f"],
     ["Mens Devotion Boxy Hood","sweat","m"], ["Sports Bra - Khaki","tee","f"],
     ["Lift Scrunch Seamless Leggings","trouser","f"], ["Jersey Skirt - Black","trouser","f"],
     ["Men's Apollo Dress Shirt - Navy","shirt","m"],        // "dress shirt" must NOT read as a dress
     ["The Dory Crew Sweater in Washed Indigo","knit",null], // genuinely unisex-looking name
     ["Willa Crochet Ballet Flat","shoe","f"],
     ["Ballet Flat Tee","tee",null],                          // shoe word outside footwear = no signal
     ["Jalen Brunson Captain Clutch Pocket Tee","tee",null],  // nickname, not a handbag
     ["Beaded Clutch","acc","f"],
     ["Boxer Briefs 3-Pack","short","m"],
     ["Heel Tab Logo Sneaker","shoe",null],                   // shoe anatomy, not a high heel
     ["Women's Boy Fit Tank in Navy","tee","f"],              // audience word beats "boy"
     ["Flat Knit Merino Beanie","cap",null]
   ];
   return cases.map(([n,cat,want])=>({n,want,got:detectGender({n,cat})}));
 });
 det.forEach(d=>chk('detector: "'+d.n.slice(0,40)+'"', d.got===d.want, 'want '+d.want+' got '+d.got));

 // ---------------- 4. no cross-gender leakage in either deck ----------------
 for(const [g,label,forbid] of [['m','MENSWEAR',1],['f','WOMENSWEAR',2]]){
   const r=await p.evaluate(gg=>{
     GENDER=gg; S.settings={gender:gg};
     const lock=genderLock(); const out=[];
     for(let i=0;i<CATALOG.length;i++){
       if(!passesFilters(i)) continue;
       out.push(i);
     }
     const wrongLock=out.filter(i=>lock[i]===(gg==='m'?1:2));
     const wrongTag=out.filter(i=>CATALOG[i].g===(gg==='m'?'f':'m'));
     const dresses=out.filter(i=>CATALOG[i].cat==='dress');
     return {pool:out.length, wrongLock:wrongLock.length, wrongTag:wrongTag.length,
             dresses:dresses.length,
             sampleWrong:wrongLock.slice(0,5).map(i=>CATALOG[i].b+' — '+CATALOG[i].n.slice(0,44)),
             cats:[...new Set(out.map(i=>CATALOG[i].cat))].sort()};
   },g);
   chk(label+': deck has plenty of pieces', r.pool>3000, r.pool+' items');
   chk(label+': zero items locked to the OTHER gender', r.wrongLock===0, r.sampleWrong.join(' | '));
   chk(label+': zero items tagged the OTHER gender', r.wrongTag===0);
   chk(label+': all garment categories represented', r.cats.length>=9, r.cats.join(','));
   if(g==='m') chk('MENSWEAR: contains no dresses at all', r.dresses===0, r.dresses+' found');
   if(g==='f') chk('WOMENSWEAR: dresses are present', r.dresses>100, r.dresses+' dresses');
 }

 // ---------------- 5. a mis-tagged item still cannot leak (the real test of the lock) ----------------
 const guard=await p.evaluate(()=>{
   // deliberately corrupt a dress's tag to 'm', the exact failure being defended against
   const i=CATALOG.findIndex(x=>x.cat==='dress'&&/\bdress\b/i.test(x.n));
   const orig=CATALOG[i].g;
   CATALOG[i].g='m'; GLOCK=null;                    // force the lock to rebuild
   GENDER='m'; S.settings={gender:'m'};
   const reachable=passesFilters(i);
   CATALOG[i].g=orig; GLOCK=null;
   return {name:CATALOG[i].n.slice(0,44), reachable};
 });
 chk('a dress mis-tagged as menswear is STILL blocked from the men\'s deck',
     guard.reachable===false, guard.name);

 // ---------------- 6. focus regions ----------------
 const foc=await p.evaluate(()=>{
   const cases=[["Merino Beanie","cap"],["Cotton Tee","tee"],["Selvedge Jeans","trouser"],
                ["Runner Sneaker","shoe"],["Leather Belt","acc"],["Silk Scarf","acc"],
                ["Ribbed Socks","acc"],["Midi Dress","dress"],["Canvas Tote Bag","acc"],
                ["Gold Hoop Earrings","acc"],["Wool Overcoat","outer"],["Swim Shorts","short"]];
   return cases.map(([n,cat])=>{const f=focusOf({n,cat});
     return {n,cat,top:+(f.t.toFixed(2)),h:+(f.h.toFixed(2)),mid:+((f.t+f.h/2).toFixed(2)),label:f.label};});
 });
 const by=Object.fromEntries(foc.map(f=>[f.n,f]));
 chk('focus: a beanie is framed at the head', by['Merino Beanie'].mid<0.20, JSON.stringify(by['Merino Beanie']));
 chk('focus: shoes are framed at the feet', by['Runner Sneaker'].mid>0.80, JSON.stringify(by['Runner Sneaker']));
 chk('focus: socks are framed low', by['Ribbed Socks'].mid>0.75, JSON.stringify(by['Ribbed Socks']));
 chk('focus: a belt is framed at the waist', by['Leather Belt'].mid>0.40&&by['Leather Belt'].mid<0.60, JSON.stringify(by['Leather Belt']));
 chk('focus: a scarf is framed high', by['Silk Scarf'].mid<0.30, JSON.stringify(by['Silk Scarf']));
 chk('focus: earrings are framed at the head', by['Gold Hoop Earrings'].mid<0.20);
 chk('focus: jeans are framed on the legs', by['Selvedge Jeans'].mid>0.60);
 chk('focus: a dress covers most of the body', by['Midi Dress'].h>0.55);
 chk('focus: a tee is framed on the torso', by['Cotton Tee'].mid>0.25&&by['Cotton Tee'].mid<0.45);
 chk('focus: every region stays inside the photo', foc.every(f=>f.top>=0&&f.top+f.h<=1.001),
     JSON.stringify(foc.filter(f=>f.top+f.h>1.001)));
 chk('focus: every region carries a plain-English label', foc.every(f=>/^the /.test(f.label)));

 // ---------------- 7. the highlight actually renders on a card ----------------
 await p.evaluate(()=>{ localStorage.clear(); });
 await p.reload({waitUntil:'domcontentloaded'}); await settle(p);
 await p.click('text=Continue as guest'); await p.waitForTimeout(400);
 await p.click('#topSizes .size-chip >> nth=2');
 await p.click('text=Next →'); await p.waitForTimeout(250);
 await p.click('text=Start shopping'); await p.waitForTimeout(1800);
 chk('deck renders after the catalog swap', await p.isVisible('#deck'));
 const dom=await p.evaluate(()=>{
   const ph=document.querySelector('#cardHost .piece-photo');
   const fr=ph&&ph.querySelector('.ph-frame'), dims=ph?ph.querySelectorAll('.ph-dim').length:0;
   const p0=CATALOG[QUEUE[0]];
   return {hasFrame:!!fr, dims, tag:fr?fr.textContent.trim():null,
           cat:p0.cat, name:p0.name||p0.n.slice(0,40), expect:focusOf(p0).label,
           frameTop:fr?fr.style.top:null, frameH:fr?fr.style.height:null,
           btn:!!document.getElementById('focusBtn')};
 });
 chk('card draws the highlight frame', dom.hasFrame);
 chk('card draws both dimming panels', dom.dims===2, 'dims='+dom.dims);
 chk('frame label matches the garment type', dom.tag===dom.expect, dom.tag+' vs '+dom.expect);
 chk('frame is positioned and sized', !!dom.frameTop&&!!dom.frameH, dom.frameTop+' / '+dom.frameH);
 chk('highlight toggle button present', dom.btn);

 // the full photo is the default now, so the first click turns the highlight ON
 chk('default is the full photo, highlight off',
     await p.evaluate("document.querySelector('#cardHost .piece-photo').classList.contains('nofocus')===true"));
 await p.click('#focusBtn'); await p.waitForTimeout(250);
 chk('toggle turns the highlight on', await p.evaluate("!document.querySelector('#cardHost .piece-photo').classList.contains('nofocus')"));
 chk('toggle relabels itself', (await p.textContent('#focusBtn')).includes('Showing the piece'));
 await p.click('#focusBtn'); await p.waitForTimeout(250);
 chk('toggle returns to the full photo', await p.evaluate("document.querySelector('#cardHost .piece-photo').classList.contains('nofocus')"));
 // the opt-in persists across a reload
 await p.click('#focusBtn'); await p.waitForTimeout(200);
 await p.reload({waitUntil:'domcontentloaded'}); await settle(p); await p.waitForTimeout(1500);
 chk('highlight opt-in survives a reload',
     await p.evaluate("document.querySelector('#cardHost .piece-photo')?.classList.contains('nofocus')===false"));
 await p.evaluate(()=>{localStorage.removeItem('styleDNA_focus');});

 // ---------------- 8. swiping the real deck: nothing wrong-gender appears ----------------
 await p.reload({waitUntil:'domcontentloaded'}); await settle(p); await p.waitForTimeout(1500);
 const swept=await p.evaluate(async ()=>{
   const seen=[]; const lock=genderLock();
   for(let n=0;n<60;n++){
     if(!QUEUE.length) refill();
     if(!QUEUE.length) break;
     const i=QUEUE[0]; seen.push(i);
     react('like');
   }
   return {n:seen.length,
           wrong:seen.filter(i=>lock[i]===1).map(i=>CATALOG[i].b+' — '+CATALOG[i].n.slice(0,40)),
           wrongTag:seen.filter(i=>CATALOG[i].g==='f').map(i=>CATALOG[i].n.slice(0,40)),
           cats:[...new Set(seen.map(i=>CATALOG[i].cat))]};
 });
 chk('swept '+swept.n+' real cards from the menswear deck', swept.n>=50);
 chk('none of them were women\'s-locked pieces', swept.wrong.length===0, swept.wrong.slice(0,4).join(' | '));
 chk('none of them were tagged womenswear', swept.wrongTag.length===0, swept.wrongTag.slice(0,4).join(' | '));

 await p.screenshot({path:join(SHOTS,'shot-highlight.png')});
 await b.close();
 console.log('\n===== PASS ('+ok.length+') ====='); ok.forEach(t=>console.log('  ok  '+t));
 if(bad.length){console.log('\n===== FAIL ('+bad.length+') ====='); bad.forEach(t=>console.log('  FAIL '+t));}
 if(errs.length){console.log('\nJS ERRORS:'); [...new Set(errs)].forEach(e=>console.log('  '+e));}
 console.log('\n'+(bad.length||errs.length?'>>> PROBLEMS FOUND':'>>> ALL GREEN'));
})();
