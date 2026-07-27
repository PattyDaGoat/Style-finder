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
 const c=await b.newContext({viewport:{width:1150,height:1000}});
 const p=await c.newPage(); const errs=[];
 p.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
 p.on('console',m=>{if(m.type()==='error'&&!/net::|Failed to load|gsi\/client|ERR_/.test(m.text()))errs.push('CONSOLE: '+m.text());});

 // ---- hidden from normal users ----
 await p.goto(DIST_URL,{waitUntil:'domcontentloaded'}); await settle(p);
 chk('dev button hidden for a normal visitor', !(await p.isVisible('#evFab')));
 chk('dev panel hidden for a normal visitor', !(await p.isVisible('#evOverlay')));

 // ---- metric correctness: the maths must be right or the tool is worse than useless ----
 const maths=await p.evaluate(()=>{
   const A=s=>evAUC(s);
   return {
     perfect:  A([{liked:true,s:10},{liked:true,s:9},{liked:false,s:1},{liked:false,s:0}]),   // 1.0
     inverted: A([{liked:false,s:10},{liked:false,s:9},{liked:true,s:1},{liked:true,s:0}]),   // 0.0
     allTied:  A([{liked:true,s:5},{liked:false,s:5},{liked:true,s:5},{liked:false,s:5}]),    // 0.5
     halfway:  A([{liked:true,s:4},{liked:false,s:3},{liked:false,s:2},{liked:true,s:1}]),    // 0.5
     known:    A([{liked:true,s:3},{liked:false,s:2},{liked:false,s:1}]),                     // 1.0
     onesided: A([{liked:true,s:1},{liked:true,s:2}]),                                        // null
     p10perfect: evPrecAt([{liked:true,s:3},{liked:true,s:2},{liked:false,s:1}],2),           // 1.0
     p10half:    evPrecAt([{liked:true,s:3},{liked:false,s:2}],2),                            // 0.5
     rngStable: (()=>{const a=evRng(42),b=evRng(42);return a()===b()&&a()===b();})()
   };
 });
 chk('AUC = 1.0 when ranking is perfect', maths.perfect===1, String(maths.perfect));
 chk('AUC = 0.0 when ranking is exactly inverted', maths.inverted===0, String(maths.inverted));
 chk('AUC = 0.5 when every score is tied', maths.allTied===0.5, String(maths.allTied));
 chk('AUC = 0.5 on a deliberately even split', maths.halfway===0.5, String(maths.halfway));
 chk('AUC handles the simple known case', maths.known===1, String(maths.known));
 chk('AUC returns nothing when one class is missing', maths.onesided===null, String(maths.onesided));
 chk('P@k correct when all top-k are liked', maths.p10perfect===1);
 chk('P@k correct at half', maths.p10half===0.5);
 chk('random baseline is seeded and reproducible', maths.rngStable===true);

 // ---- it must not disturb the live session state ----
 await p.evaluate(()=>{ localStorage.clear(); });
 await p.reload({waitUntil:'domcontentloaded'}); await settle(p);
 await p.click('text=Continue as guest'); await p.waitForTimeout(300);
 await p.click('#topSizes .size-chip >> nth=2');
 await p.click('text=Next →'); await p.waitForTimeout(200);
 await p.click('text=Start shopping'); await p.waitForTimeout(1500);
 const stateTest=await p.evaluate(()=>{
   for(let n=0;n<40;n++){ if(!QUEUE.length) refill(); if(!QUEUE.length) break;
     react(n%3===0?'love':(n%3===1?'like':'skip')); }
   const before=JSON.stringify({r:S.reactions,h:S.hist,pi:S.picks,li:S.likes,g:GENDER});
   const sess=evSavedSession();
   const res=evReplay(sess,0.2);
   const after=JSON.stringify({r:S.reactions,h:S.hist,pi:S.picks,li:S.likes,g:GENDER});
   return {identical:before===after, sessN:sess.length, res:res,
           modelStillBuilt: MODEL!==null};
 });
 chk('running the test leaves the live session byte-identical', stateTest.identical);
 chk('the live model survives a test run', stateTest.modelStillBuilt);
 chk('session read back from real swipes', stateTest.sessN>=38, 'n='+stateTest.sessN);
 chk('replay produced results, no error', !stateTest.res.error, stateTest.res.error||'');
 const rows=stateTest.res.rows||[];
 const cur=rows.find(r=>r.key==='current'), rnd=rows.find(r=>r.key==='random');
 chk('every scorer returned an AUC', rows.every(r=>r.auc!==null), JSON.stringify(rows.map(r=>[r.key,r.auc])));
 chk('train/test split adds up', stateTest.res.trainN+stateTest.res.testN===stateTest.sessN,
     stateTest.res.trainN+'+'+stateTest.res.testN+' vs '+stateTest.sessN);
 chk('holdout contains both liked and skipped', stateTest.res.nPos>0&&stateTest.res.nNeg>0,
     stateTest.res.nPos+'/'+stateTest.res.nNeg);
 chk('random baseline lands near a coin flip', rnd.auc>0.2&&rnd.auc<0.8, 'random AUC='+rnd.auc);

 // ---- the real signal test: a model trained on a coherent taste MUST beat random ----
 const signal=await p.evaluate(()=>{
   const out=[];
   EV_PERSONAS.forEach((per,k)=>{
     GENDER=per.gender; S.settings={gender:per.gender,maxBudget:100000};
     /* 12 runs x 1280 swipes, not 5 x 320. AUC's run-to-run spread is set by how
        many LIKED pieces land in the holdout, and shrinks as 1/sqrt(that count).
        The two narrow personas like only ~12-14% of the deck, so 320 swipes hid
        as few as 8 positives — an AUC from 8 samples is noise, and its spread
        (~0.08-0.17) sat right on top of the 0.10 threshold below. That made this
        a coin flip: "Earthy womenswear" failed at SD=0.166 while "Bold
        streetwear" passed at 0.039 on a true spread of ~0.074, i.e. on luck.
        Deleting 30 random rows from the catalogue moved Earthy from 0.166 back
        under 0.09 — proof the number tracked the shuffle, not the recommender.
        1280 swipes hide 46-148 positives; measured over 6 independent seed
        families x 3 personas the worst spread is 0.052. The threshold is
        unchanged at 0.10 — this measures the same thing properly, it does not
        lower the bar. Costs ~0.6s. */
     const seeds=Array.from({length:12},(_,j)=>11+k+j*101);
     const r=evAggregate(evSeededSessions(per,1280,seeds));
     const g=key=>r.rows.find(x=>x.key===key);
     out.push({persona:per.name, runs:r.runs, minPos:r.minPos, noise:r.noiseFloor,
               current:g('current').auc, currentSD:g('current').aucSD,
               random:g('random').auc, popularity:g('popularity').auc,
               profileOnly:g('profile-only').auc, knnOnly:g('knn-only').auc,
               p10:g('current').p10});
   });
   return out;
 });
 signal.forEach(s=>{
   chk('"'+s.persona+'": clearly above chance',
       s.current > s.random + 0.05,
       'current '+s.current.toFixed(3)+' vs random '+s.random.toFixed(3));
   chk('"'+s.persona+'": holdout has enough liked pieces to mean something',
       s.minPos>=8, 'min liked in a run = '+s.minPos);
   chk('"'+s.persona+'": repeated runs are stable (spread under 0.10)',
       s.currentSD<0.10, 'SD='+s.currentSD.toFixed(3));
 });
 console.log('\nMEASURED BASELINE — the "before" number every later change must beat:');
 signal.forEach(s=>console.log('  '+s.persona.padEnd(22)+
   ' AUC '+s.current.toFixed(3)+' \u00b1'+s.currentSD.toFixed(3)+
   '  P@10 '+(s.p10*100).toFixed(0)+'%'+
   '   [random '+s.random.toFixed(3)+', popularity '+s.popularity.toFixed(3)+
   ', profile-only '+s.profileOnly.toFixed(3)+', knn-only '+s.knnOnly.toFixed(3)+']'));
 const avgAll=signal.reduce((a,s)=>a+s.current,0)/signal.length;
 console.log('  OVERALL current-algorithm AUC: '+avgAll.toFixed(3));

 // ---- reproducibility: same input, same number ----
 const repro=await p.evaluate(()=>{
   GENDER='m'; S.settings={gender:'m',maxBudget:100000};
   const s=evSynthSession(EV_PERSONAS[0],120,999);
   const a=evReplay(s,0.2).rows.find(x=>x.key==='current').auc;
   const b=evReplay(s,0.2).rows.find(x=>x.key==='current').auc;
   const s2=evSynthSession(EV_PERSONAS[0],120,999);
   const c=evReplay(s2,0.2).rows.find(x=>x.key==='current').auc;
   return {a,b,c};
 });
 chk('same session gives the same number twice', repro.a===repro.b, repro.a+' vs '+repro.b);
 chk('same seed regenerates the same session', repro.a===repro.c, repro.a+' vs '+repro.c);

 // ---- UI works ----
 await p.goto(DIST_URL + '?eval=1',{waitUntil:'domcontentloaded'}); await settle(p);
 chk('?eval=1 reveals the dev button', await p.isVisible('#evFab'));
 await p.click('#evFab'); await p.waitForTimeout(300);
 chk('panel opens', await p.isVisible('#evOverlay'));
 await p.click('text=Test on 3 simulated shoppers');
 await p.waitForTimeout(6000);
 const uiTables=await p.evaluate(()=>document.querySelectorAll('#evResult table.ev').length);
 chk('panel renders one table per simulated shopper', uiTables===3, 'tables='+uiTables);
 chk('panel shows a headline average', (await p.textContent('#evResult')).includes('Headline'));
 chk('log reports timing', (await p.textContent('#evLog')).includes('done in'));
 await p.screenshot({path:join(SHOTS,'shot-eval.png')});
 // guard: with too few swipes it must refuse, not mislead
 await p.evaluate(()=>{ Object.keys(localStorage).filter(k=>k.indexOf('styleDNA_v3::')===0)
     .forEach(k=>localStorage.removeItem(k));
   S.reactions={0:'like',1:'skip'}; S.hist=[0,1]; S.picks=[]; S.likes=[]; });
 await p.click('text=Test on my saved swipes'); await p.waitForTimeout(1200);
 chk('refuses to report a number from too few swipes',
     (await p.textContent('#evResult')).includes('Not enough saved swipes'));
 await p.click('.ev-x'); await p.waitForTimeout(200);
 chk('panel closes', !(await p.isVisible('#evOverlay')));

 await b.close();
 console.log('\n===== PASS ('+ok.length+') ====='); ok.forEach(t=>console.log('  ok  '+t));
 if(bad.length){console.log('\n===== FAIL ('+bad.length+') ====='); bad.forEach(t=>console.log('  FAIL '+t));}
 if(errs.length){console.log('\nJS ERRORS:'); [...new Set(errs)].forEach(e=>console.log('  '+e));}
 console.log('\n'+(bad.length||errs.length?'>>> PROBLEMS FOUND':'>>> ALL GREEN'));
})();
