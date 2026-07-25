   ===== UPGRADE 1: EVALUATION HARNESS — delete from here to "end UPGRADE 1" to revert =====

   Why this exists: before this, there was no way to tell whether a change to the
   recommender made it better or worse. Every tuning decision was a guess.

   What it does: takes a swipe session in order, hides the last 20%, rebuilds the
   taste model from the first 80% only, then ranks the hidden pieces and asks
   "did the ones I actually liked come out on top?".

   It scores the REAL functions the app ships (buildModel / hybrid / profileScore),
   not a copy, so the number describes the live algorithm.

   Hidden from normal users: the button only appears with ?eval=1 in the address, or
   after pressing Shift+E three times.
   ========================================================================== */

/* deterministic RNG — a fixed seed means two runs of the same test give the same
   number, which is the whole point of a measurement tool */
function evRng(seed){
  let a=seed>>>0;
  return function(){ a+=0x6D2B79F5; let t=a; t=Math.imul(t^t>>>15,t|1); t^=t+Math.imul(t^t>>>7,t|61);
    return ((t^t>>>14)>>>0)/4294967296; };
}

/* ---------- metrics ---------- */
/* AUC = probability a liked piece outranks a skipped one. Computed exactly over all
   pairs via rank-sum (Mann-Whitney), not sampled. */
function evAUC(scored){
  const pos=scored.filter(x=>x.liked), neg=scored.filter(x=>!x.liked);
  if(!pos.length||!neg.length) return null;
  const all=scored.slice().sort((a,b)=>a.s-b.s);
  let i=0, rankSum=0;
  while(i<all.length){                       // average ranks within ties, or ties inflate the score
    let j=i; while(j+1<all.length && all[j+1].s===all[i].s) j++;
    const avg=(i+j)/2+1;
    for(let k=i;k<=j;k++) if(all[k].liked) rankSum+=avg;
    i=j+1;
  }
  return (rankSum - pos.length*(pos.length+1)/2) / (pos.length*neg.length);
}
function evPrecAt(scored,k){
  const top=scored.slice().sort((a,b)=>b.s-a.s).slice(0,k);
  return top.length? top.filter(x=>x.liked).length/top.length : null;
}

/* ---------- the scorers under test ----------
   To measure a change, add a row here and re-run. Keep "current" untouched so every
   future variant is compared against the same reference. */
const EV_SCORERS = [
  {key:"current", label:"Current algorithm", kind:"real",
   fn:(i,W,L)=>hybrid(CATALOG[i],W,L)},
  {key:"profile-only", label:"Taste profile only (no nearest-neighbour)", kind:"real",
   fn:(i,W,L)=>profileScore(CATALOG[i],W)},
  {key:"knn-only", label:"Nearest-neighbour only (no profile)", kind:"real",
   fn:(i,W,L)=>knnScore(CATALOG[i],L)},
  {key:"popularity", label:"Baseline: most common brands", kind:"base",
   fn:(i)=>(BRcnt[CATALOG[i].b]||0)},
  {key:"random", label:"Baseline: random order", kind:"base",
   fn:(i,W,L,rng)=>rng()}
];

/* ---------- replay one session ----------
   session = [{i, r}] in swipe order, r = 'love' | 'like' | 'skip' */
function evReplay(session, holdoutFrac){
  holdoutFrac=holdoutFrac||0.2;
  const cut=Math.max(1, Math.floor(session.length*(1-holdoutFrac)));
  const train=session.slice(0,cut), test=session.slice(cut);
  const nPos=test.filter(x=>x.r!=="skip").length, nNeg=test.length-nPos;
  if(!nPos||!nNeg) return {error:"the hidden slice needs at least one like and one skip (got "+nPos+" / "+nNeg+")"};

  /* build the model from the training slice only, by temporarily standing in for the
     real session state, then putting it back exactly as it was */
  const keep={reactions:S.reactions,tags:S.tags,hist:S.hist,picks:S.picks,likes:S.likes,seeds:S.seeds,inspo:S.inspo};
  const trainIdx=new Set(train.map(x=>x.i));
  S.reactions={}; S.hist=[]; S.tags=keep.tags||{};
  train.forEach(x=>{S.reactions[x.i]=x.r; S.hist.push(x.i);});
  S.picks=(keep.picks||[]).filter(i=>trainIdx.has(i));   // cart/likes only count if inside the window
  S.likes=(keep.likes||[]).filter(i=>trainIdx.has(i));
  S.seeds=keep.seeds||[]; S.inspo=keep.inspo;
  buildModel();
  const W=MODEL, L=lovedPicks();
  Object.assign(S,keep);                                  // restore

  const rows=EV_SCORERS.map(sc=>{
    const rng=evRng(20260725);
    const scored=test.map(x=>({liked:x.r!=="skip", s:sc.fn(x.i,W,L,rng)}));
    return {key:sc.key,label:sc.label,kind:sc.kind,
            auc:evAUC(scored), p10:evPrecAt(scored,10), p5:evPrecAt(scored,5)};
  });
  return {trainN:train.length, testN:test.length, nPos, nNeg, rows};
}

/* ---------- where sessions come from ---------- */
function evSavedSession(){
  const saved=load();
  /* use whichever has more swipes: the saved profile, or this session in memory */
  const nSaved=(saved&&saved.reactions)?Object.keys(saved.reactions).length:0;
  const nLive=Object.keys(S.reactions||{}).length;
  const src=nSaved>=nLive&&nSaved>0?saved:S;
  const rx=src.reactions||{}, hist=(src.hist||[]).filter(i=>rx[i]!==undefined);
  const seen=new Set(), order=[];
  hist.forEach(i=>{if(!seen.has(i)){seen.add(i);order.push(i);}});      // swipe order where known
  Object.keys(rx).map(Number).forEach(i=>{if(!seen.has(i)){seen.add(i);order.push(i);}});
  return order.filter(i=>CATALOG[i]).map(i=>({i:i, r:rx[i]}));
}
/* Simulated shoppers, so the harness is usable before a long real session exists.
   Each persona likes a trait combination; the deck they see is the app's real deck. */
const EV_PERSONAS=[
  {name:"Neutral minimalist", gender:"m", want:p=>(p.color==="neutral"||p.color==="dark")&&p.pat==="solid"},
  {name:"Bold streetwear",    gender:"m", want:p=>p.color==="bold"||p.pat==="graphic"},
  {name:"Earthy womenswear",  gender:"f", want:p=>p.color==="earth"||(p.fab||[]).includes("linen")}
];
function evSynthSession(persona, n, seed){
  const rng=evRng(seed);
  const pool=[];
  for(let i=0;i<CATALOG.length;i++) if(passesFilters(i)) pool.push(i);
  for(let i=pool.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));const t=pool[i];pool[i]=pool[j];pool[j]=t;}
  const out=[];
  for(let k=0;k<pool.length&&out.length<n;k++){
    const p=CATALOG[pool[k]], fav=persona.want(p);
    /* a real shopper is noisy: they like ~85% of what suits them and ~12% of what doesn't */
    const r = fav ? (rng()<0.45?"love":(rng()<0.75?"like":"skip"))
                  : (rng()<0.12?"like":"skip");
    out.push({i:pool[k], r:r});
  }
  return out;
}


/* ---------- repeated evaluation, because one split is noise ----------
   A single hold-out on a short session gives a number with a large margin of error. With
   only ~6 liked pieces hidden, AUC wobbles by roughly +/-0.07 run to run -- enough to make
   a change look like an improvement when nothing improved. So every measurement is repeated
   and reported as an average with its spread, and the spread of the RANDOM baseline is shown
   as the noise floor: a change smaller than that floor means nothing.

   Time-ordered data can't be bootstrapped by reshuffling (that would let the model learn
   from the future), so instead the split point is rolled: evaluate at 65%, 70%, 75%, 80%,
   85% and average. That's the standard "rolling origin" approach for sequential data. */
function evMean(a){return a.reduce((x,y)=>x+y,0)/a.length;}
function evSD(a){ if(a.length<2)return 0; const m=evMean(a);
  return Math.sqrt(a.reduce((s,v)=>s+(v-m)*(v-m),0)/(a.length-1)); }

function evAggregate(sessions){
  /* sessions: array of {session, holdout} to evaluate and average over */
  const per={};                        // key -> {auc:[], p10:[]}
  let trainN=0, testN=0, nPos=[], nNeg=[], runs=0, err=null;
  sessions.forEach(({session, holdout})=>{
    const r=evReplay(session, holdout);
    if(r.error){ err=err||r.error; return; }
    runs++; trainN+=r.trainN; testN+=r.testN; nPos.push(r.nPos); nNeg.push(r.nNeg);
    r.rows.forEach(row=>{
      per[row.key]=per[row.key]||{label:row.label,kind:row.kind,auc:[],p10:[],p5:[]};
      if(row.auc!=null)per[row.key].auc.push(row.auc);
      if(row.p10!=null)per[row.key].p10.push(row.p10);
      if(row.p5!=null)per[row.key].p5.push(row.p5);
    });
  });
  if(!runs) return {error: err||"no run produced a usable split"};
  const rows=Object.keys(per).map(k=>{
    const v=per[k];
    return {key:k,label:v.label,kind:v.kind,
            auc:v.auc.length?evMean(v.auc):null, aucSD:evSD(v.auc),
            p10:v.p10.length?evMean(v.p10):null, p5:v.p5.length?evMean(v.p5):null, n:v.auc.length};
  });
  const cur=rows.find(r=>r.key==="current");
  const rnd=rows.find(r=>r.key==="random");
  /* standard error of the mean = SD / sqrt(runs). Two of those either side is the
     conventional "is this difference real?" bar, and it tightens as runs increase. */
  const sem = cur&&cur.n>1 ? cur.aucSD/Math.sqrt(cur.n) : 0.05;
  return {runs:runs, trainN:Math.round(trainN/runs), testN:Math.round(testN/runs),
          minPos:Math.min(...nPos), avgPos:Math.round(evMean(nPos)), avgNeg:Math.round(evMean(nNeg)),
          sem:sem, noiseFloor:Math.max(2*sem, 0.02),
          aboveChance: cur&&rnd ? (cur.auc - rnd.auc) : null, rows:rows};
}
/* rolling-origin splits over one real session */
function evRollingSplits(session){
  return [0.35,0.30,0.25,0.20,0.15].map(hf=>({session:session, holdout:hf}));
}
/* several independent simulated sessions for one persona */
function evSeededSessions(persona, n, seeds){
  return seeds.map(sd=>({session:evSynthSession(persona,n,sd), holdout:0.25}));
}

/* ---------- UI ---------- */
let EV_LAST=null;
function evalOpen(){document.getElementById("evOverlay").classList.remove("hidden");}
function evalClose(){document.getElementById("evOverlay").classList.add("hidden");}
function evLog(t){const el=document.getElementById("evLog");if(el)el.textContent=t;}
function evPct(v){return v==null?"&mdash;":(v*100).toFixed(1)+"%";}
function evNum(v){return v==null?"&mdash;":v.toFixed(3);}

function evTable(title, res){
  if(res.error) return `<p class="ev-note" style="color:var(--red)"><b>${title}:</b> ${res.error}</p>`;
  const real=res.rows.filter(r=>r.kind==="real");
  const best=real.reduce((a,b)=>(b.auc||0)>(a.auc||0)?b:a, real[0]);
  const thin=res.minPos<8;
  return `<div style="margin-top:18px"><div style="font-weight:700;font-size:15px">${title}</div>
    <div class="ev-note" style="margin:2px 0 6px">${res.runs} runs · learned from ~${res.trainN} swipes each ·
      judged on ~${res.testN} hidden (~${res.avgPos} liked, ~${res.avgNeg} skipped)
      ${thin?'<b style="color:#b3261e"> · thin sample: only '+res.minPos+' liked pieces in the smallest run, so treat these numbers loosely</b>':''}</div>
    <table class="ev"><thead><tr><th>Scoring method</th><th>AUC</th><th>&plusmn;</th><th>P@5</th><th>P@10</th></tr></thead><tbody>
    ${res.rows.map(r=>`<tr class="${r.kind==="base"?"base":(r.key===best.key?"best":"")}">
        <td>${r.label}</td><td>${evNum(r.auc)}</td>
        <td style="color:var(--ink-soft);font-size:12.5px">${r.aucSD?("\u00b1"+r.aucSD.toFixed(3)):"&mdash;"}</td>
        <td>${evPct(r.p5)}</td><td>${evPct(r.p10)}</td></tr>`).join("")}
    </tbody></table>
    <div class="ev-note" style="margin-top:6px">
      Above chance by <b>${res.aboveChance==null?"&mdash;":(res.aboveChance>0?"+":"")+res.aboveChance.toFixed(3)} AUC</b>
      versus the random baseline. &nbsp;·&nbsp;
      A later change counts as real only if it moves AUC by more than <b>&plusmn;${res.noiseFloor.toFixed(3)}</b>
      (twice the run-to-run error). Add runs to tighten that.</div></div>`;
}

function evalRun(mode){
  const host=document.getElementById("evResult");
  host.innerHTML=""; evLog("Running…");
  setTimeout(()=>{                                  // let the UI paint before the heavy loop
    const t0=performance.now(); const out=[]; const lines=[];
    try{
      if(mode==="saved"){
        const s=evSavedSession();
        lines.push("saved session: "+s.length+" swipes ("+s.filter(x=>x.r!=="skip").length+" liked)");
        if(s.length<25){
          host.innerHTML=`<p class="ev-note" style="color:var(--red)"><b>Not enough saved swipes yet.</b>
            Found ${s.length}; the test needs about 25+ to mean anything, and 100+ to be trustworthy.
            Swipe a while, then come back &mdash; or run the simulated shoppers.</p>`;
          evLog(lines.join("\n")); return;
        }
        out.push(["Your saved session", evAggregate(evRollingSplits(s))]);
      }else{
        const keepG=GENDER, keepS=S.settings;
        EV_PERSONAS.forEach((per,k)=>{
          GENDER=per.gender; S.settings=Object.assign({},S.settings||{},{gender:per.gender});
          const seeds=[1001+k*13,2002+k*13,3003+k*13,4004+k*13,5005+k*13];
          const sets=evSeededSessions(per,320,seeds);
          lines.push(per.name+": "+seeds.length+" sessions x "+sets[0].session.length+" swipes ("+
                     sets[0].session.filter(x=>x.r!=="skip").length+" liked in the first)");
          out.push([per.name, evAggregate(sets)]);
        });
        GENDER=keepG; S.settings=keepS;
      }
      host.innerHTML=out.map(([t,r])=>evTable(t,r)).join("");
      /* average AUC across runs, so there is one headline number to compare against later */
      const aucs=out.map(([,r])=>r.error?null:(r.rows.find(x=>x.key==="current")||{}).auc).filter(v=>v!=null);
      if(aucs.length>1){
        const avg=evMean(aucs);
        const floor=Math.max(...out.map(([,r])=>r.error?0:r.noiseFloor));
        host.innerHTML+=`<p class="ev-note" style="margin-top:16px;padding:12px 14px;background:var(--mint);
          border-radius:12px;color:var(--green-2)"><b>Headline: AUC ${avg.toFixed(3)}</b> for the current algorithm,
          averaged across ${aucs.length} scenarios. Write it down &mdash; the next change has to beat it by more than
          <b>${floor.toFixed(3)}</b> to count as a real improvement rather than noise.</p>`;
      }
      EV_LAST={mode:mode, when:new Date().toISOString(), runs:out.map(([t,r])=>({name:t,result:r}))};
      lines.push("done in "+Math.round(performance.now()-t0)+" ms");
      evLog(lines.join("\n"));
    }catch(e){
      host.innerHTML=`<p class="ev-note" style="color:var(--red)">The test failed: ${e.message}</p>`;
      evLog("error: "+e.message+"\n"+(e.stack||"").split("\n").slice(0,4).join("\n"));
    }
  },30);
}
function evalCopy(){
  if(!EV_LAST){evLog("Run a test first.");return;}
  const txt=JSON.stringify(EV_LAST,null,1);
  (navigator.clipboard?navigator.clipboard.writeText(txt):Promise.reject())
    .then(()=>evLog("Results copied to the clipboard."))
    .catch(()=>{evLog(txt);});
}
/* reveal: ?eval=1 in the address, or press Shift+E three times */
(function(){
  let taps=0;
  const show=()=>{const f=document.getElementById("evFab");if(f)f.classList.remove("hidden");};
  try{ if(/[?&]eval=1/.test(location.search)) show(); }catch(_){}
  document.addEventListener("keydown",e=>{
    if(e.shiftKey && (e.key==="E"||e.key==="e")){ if(++taps>=3) show(); }
    else if(!e.shiftKey) taps=0;
  });
})();
/* ===== end UPGRADE 1 ===== */
