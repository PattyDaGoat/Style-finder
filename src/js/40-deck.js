/* ---------- endless adaptive deck ---------- */
let QUEUE=[], SERVED=new Set(), LAST_BRANDS=new Set();
/* Which piece the card currently on screen is showing, so renderCard() can tell
   "the next card arrived" from "the same card was redrawn". Only the first gets
   the entry animation — see the call site. */
let _SHOWING=null;

/* ---- a piece you have already been shown never comes back ----
   SERVED alone was per-session and reset on every startDeck(), so closing the
   tab brought everything round again. This remembers across sessions.

   Keyed by the product URL, NOT the catalog index. The catalog is regenerated
   every few hours and rows get pruned from the middle, so index 5000 today is a
   different garment tomorrow — an index-keyed memory would quietly start
   hiding the wrong pieces.

   Colourways are the exception the owner asked for: a second colour of a shirt
   you were shown is a legitimately different card, but fifteen of them is a
   broken feed. So the exact piece is blocked forever, and the style it belongs
   to is capped. */
const MAX_COLOURWAYS = 2;                       /* of one style, ever */
function pieceKey(p){ return p ? (p.u || (p.b+"|"+p.n)) : ""; }
function styleKey(p){ return p ? p.b+"|"+baseTitle(p.n) : ""; }
function seenInit(){ S.seen=S.seen||{}; S.seenStyle=S.seenStyle||{}; }
function seenPiece(p){ seenInit(); return !!S.seen[pieceKey(p)]; }
function styleFull(p){ seenInit(); return (S.seenStyle[styleKey(p)]||0) >= MAX_COLOURWAYS; }
/* Called when a card is actually rendered, not when it is queued — a piece you
   never got to see stays available. */
function markShown(i){
  const p=CATALOG[i]; if(!p) return;
  seenInit();
  const k=pieceKey(p);
  if(S.seen[k]) return;
  S.seen[k]=1;
  const sk=styleKey(p); S.seenStyle[sk]=(S.seenStyle[sk]||0)+1;
  save();
}
function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));const t=a[i];a[i]=a[j];a[j]=t;}return a;}
/* ============================================================================
   DEALING THE NEXT BATCH (v4)

   v3 dealt a batch as "the top-N by score, then random filler": a fixed share of
   exploitation that grew with the swipe count, one card per brand, and a
   shuffle. It had three blind spots, each measured with tools/measure-deck.mjs
   before this was written:

     * It never looked at GARMENT. Brands were spaced perfectly (10 distinct per
       10 cards) but a shopper who liked a few tops was dealt tops until the
       scores said otherwise — runs of 15-30 consecutive same-group cards for
       two of the five simulated shoppers.
     * It never noticed boredom. A run of skips on one lane (a garment group, a
       micro-style, a label) only reached the model as a slow smear across the
       profile, so the lane kept coming for a dozen more cards.
     * Its exploration was uniform random: the "different things in between"
       were as likely to be a $12 bucket hat as the best piece of a style the
       shopper had not been shown yet.

   This deals a batch in four parts and then arranges it:

     1. EXPLOIT: the best candidates by hybrid(), chosen greedily with a maximal
        marginal relevance step so two near-twins do not both land in one batch,
        under a per-group cap (no more than half a batch from one garment group)
        and a fatigue penalty.
     2. EXPLORE: curated, not random. Micro-style lanes are ranked by an upper
        confidence bound on their like-rate — lanes the shopper has barely seen
        get the benefit of the doubt — and each chosen lane contributes its
        best-scoring unseen piece. So a discovery card is still a good card.
     3. WILDCARD: one card per batch drawn uniformly from the pool. Pure
        serendipity, so the feed can never fully close in on itself.
     4. The exploit share adapts: it follows the v3 schedule by default, opens up
        when the recent like-rate drops (the shopper is cooling off), and moves
        toward whichever arm — exploit or explore — has been winning lately.

   Then the batch is ARRANGED rather than shuffled: consecutive cards differ in
   garment group and brand where the batch allows it, and discovery cards are
   interleaved with the safe ones instead of landing in a clump.

   Fatigue reads the last RECENT_N swipes: a trailing run of skips on a lane
   pushes that lane's candidates down for this batch and, at three or more,
   caps the lane at one card. It is a temporary nudge on top of the model, not
   a memory — the moment the shopper likes something in the lane the streak
   resets, which is the difference between "tired of hoodies right now" and
   "never show hoodies". (negScore in 50-taste-model.js is the persistent half:
   near-twins of recent skips rank lower everywhere.)

   DECK_V4 is the measurement hook: false deals the v3 batch from the same pool
   and model, so tools/measure-deck.mjs can compare like with like.
   ========================================================================== */
let DECK_V4=true;
const RECENT_N=16;          /* swipes the fatigue window reads */
const GROUP_SHARE_MAX=0.5;  /* of a batch from one garment group */
const MMR_LAMBDA=0.6;       /* how hard near-twins are pushed apart within a batch */
const SIM_REF=8;            /* a "very similar" simItem() score, for the MMR term */
const UCB_C=0.5, UCB_PRIOR=2;
let LAST_DEALT=null;        /* tail of the previous batch: the seam is spaced too */

/* what the recent swipes say about the session: fatigue per lane, the like-rate
   trend, how the two arms have been doing, and per-lane totals for the UCB */
function laneKeys(p){ return ['g:'+groupOf(p),'ms:'+p.ms[0],'b:'+p.b]; }
function sessionContext(){
  const hist=S.hist||[], rx=S.reactions||{}, org=S.origin||{};
  const recent=hist.slice(-RECENT_N), seq={};
  recent.forEach(pi=>{const p=CATALOG[pi]; if(!p) return; const y=rx[pi]==='skip'?0:1;
    laneKeys(p).forEach(k=>{(seq[k]=seq[k]||[]).push(y);});});
  const fatigue={};
  for(const k in seq){ const a=seq[k]; let n=0; for(let j=a.length-1;j>=0&&a[j]===0;j--) n++; if(n>=2) fatigue[k]=n; }
  const rate=a=>a.length?a.filter(pi=>rx[pi]!=='skip').length/a.length:null;
  const now=hist.length>=15?rate(hist.slice(-15)):null;
  const before=hist.length>=30?rate(hist.slice(-30,-15)):null;
  let xN=0,xL=0,eN=0,eL=0;
  hist.slice(-40).forEach(pi=>{const o=org[pi]; if(!o) return; const l=rx[pi]!=='skip'?1:0;
    if(o==='x'){xN++;xL+=l;} else {eN++;eL+=l;}});
  const laneN={}, laneL={}; let likes=0;
  hist.forEach(pi=>{const p=CATALOG[pi]; if(!p) return; const m=p.ms[0];
    laneN[m]=(laneN[m]||0)+1; if(rx[pi]!=='skip'){laneL[m]=(laneL[m]||0)+1; likes++;}});
  return {fatigue, now, before, xN, xL, eN, eL, laneN, laneL, n:hist.length,
          likeRate: hist.length?likes/hist.length:0.5};
}
/* how many z-score units a candidate is pushed down for the lanes it shares
   with a run of recent skips */
function fatiguePenalty(p,ctx){
  let pen=0; laneKeys(p).forEach(k=>{const n=ctx.fatigue[k]; if(n) pen+=0.5*(n-1)+0.5;});
  return Math.min(pen,3);
}
function laneCapped(p,ctx){ return laneKeys(p).some(k=>(ctx.fatigue[k]||0)>=3); }

function exploitShare(k,ctx){
  const swipes=ctx.n;
  let f = swipes<20 ? Math.min(0.6, 0.42 + swipes*0.009)
                    : Math.min(0.9, 0.66 + (swipes-20)*0.006);
  /* cooling off: the last 15 swipes liked clearly less than the 15 before — open
     the deck up rather than pressing the same profile harder */
  if(ctx.now!=null && ctx.before!=null && ctx.now < ctx.before-0.15) f-=0.15;
  /* the arms: if discovery cards are being liked as often as the model's picks,
     discovery deserves more of the batch; if the model is clearly winning, a
     little more of it */
  if(ctx.xN>=6 && ctx.eN>=6){ const xr=ctx.xL/ctx.xN, er=ctx.eL/ctx.eN;
    if(er>=xr) f-=0.10; else if(xr>=er+0.30) f+=0.05; }
  return Math.max(0.3, Math.min(0.85, f));
}

function dealV4(k,pool,L,haveSignal){
  const ctx=sessionContext();
  const picked=[], origin={}, brandCap={}, seenT={}, groupN={}, laneN={};
  const groupMax=Math.max(1,Math.ceil(k*GROUP_SHARE_MAX));
  const ok=(i,avoidRecent,strict)=>{const p=CATALOG[i],bt=baseTitle(p.n);
    if(seenT[bt]||brandCap[p.b]) return false;
    if(avoidRecent && LAST_BRANDS.has(p.b)) return false;
    if(strict){ const g=groupOf(p); if((groupN[g]||0)>=groupMax) return false;
      if(laneCapped(p,ctx)){ if(laneKeys(p).some(key=>ctx.fatigue[key]>=3 && (laneN[key]||0)>=1)) return false; } }
    return true;};
  const take=(i,o)=>{const p=CATALOG[i]; picked.push(i); origin[i]=o; seenT[baseTitle(p.n)]=1; brandCap[p.b]=1;
    const g=groupOf(p); groupN[g]=(groupN[g]||0)+1; laneKeys(p).forEach(key=>laneN[key]=(laneN[key]||0)+1);};

  if(haveSignal){
    let cand=pool;
    if(pool.length>2500){ const s=pool.slice(); shuffle(s); cand=s.slice(0,2500); }
    const scored=cand.map(i=>({i,s:hybrid(CATALOG[i],MODEL,L)}));
    let mean=0; scored.forEach(o=>mean+=o.s); mean/=scored.length;
    let v=0; scored.forEach(o=>v+=(o.s-mean)*(o.s-mean)); const sd=Math.sqrt(v/Math.max(1,scored.length-1))||1;
    scored.forEach(o=>{o.z=(o.s-mean)/sd; o.a=o.z-fatiguePenalty(CATALOG[o.i],ctx);});
    scored.sort((x,y)=>y.a-x.a);

    const f=exploitShare(k,ctx);
    const nWild=k>=6?1:0;
    const nExploit=Math.max(1,Math.round(k*f));
    const nExplore=Math.max(0,k-nExploit-nWild);

    /* 1. exploit, with the MMR step over a window of the best remaining */
    const WINDOW=40;
    while(picked.length<nExploit){
      let best=null, bestV=-Infinity, seen=0;
      for(const o of scored){
        if(origin[o.i]!==undefined) continue;
        if(!ok(o.i,true,true)) continue;
        let maxSim=0; for(const j of picked){ const sm=simItem(CATALOG[o.i],CATALOG[j]); if(sm>maxSim) maxSim=sm; }
        const val=o.a - MMR_LAMBDA*maxSim/SIM_REF;
        if(val>bestV){bestV=val;best=o;}
        if(++seen>=WINDOW) break;
      }
      if(!best) break;
      take(best.i,'x');
    }
    /* 2. explore: lanes by upper confidence bound, best unseen piece of each */
    if(nExplore>0){
      const byLane={}; scored.forEach(o=>{ if(origin[o.i]!==undefined) return; const m=CATALOG[o.i].ms[0]; (byLane[m]=byLane[m]||[]).push(o); });
      const lnN=Math.log(ctx.n+2);
      const lanes=Object.keys(byLane).map(m=>{
        const n=ctx.laneN[m]||0, l=ctx.laneL[m]||0;
        const ucb=(l+UCB_PRIOR*ctx.likeRate)/(n+UCB_PRIOR) + UCB_C*Math.sqrt(lnN/(n+1));
        return {m, ucb: ucb + Math.random()*0.05 - ((laneN['ms:'+m]||0)?0.3:0)};   /* a lane already in the batch waits its turn */
      }).sort((a,b)=>b.ucb-a.ucb);
      let got=0;
      for(const lane of lanes){
        if(got>=nExplore) break;
        if((ctx.fatigue['ms:'+lane.m]||0)>=3) continue;
        const top=byLane[lane.m].filter(o=>ok(o.i,true,true)).slice(0,3);
        if(!top.length) continue;
        const o=top[Math.floor(Math.random()*top.length)];
        take(o.i,'e'); got++;
      }
    }
    /* 3. the wildcard: anything at all, once per batch */
    if(nWild){ const rest=pool.filter(i=>origin[i]===undefined); shuffle(rest);
      for(const i of rest){ if(ok(i,true,true) && !laneCapped(CATALOG[i],ctx)){ take(i,'w'); break; } } }
    /* fallbacks if the pool is thin: relax the group cap, then the recent-brand rule */
    if(picked.length<k){ for(const o of scored){ if(picked.length>=k)break; if(origin[o.i]===undefined&&ok(o.i,true,false)) take(o.i,'x'); } }
    if(picked.length<k){ for(const o of scored){ if(picked.length>=k)break; if(origin[o.i]===undefined&&ok(o.i,false,false)) take(o.i,'x'); } }
    if(picked.length<k){ const rest=pool.filter(i=>origin[i]===undefined); shuffle(rest);
      for(const i of rest){ if(picked.length>=k)break; if(ok(i,false,false)) take(i,'w'); } }
  } else {
    /* cold start: one piece from each micro-style in turn, as before, but with
       the garment cap so the opening hand is not all t-shirts */
    const byMs={}; pool.forEach(i=>{const m=CATALOG[i].ms[0];(byMs[m]=byMs[m]||[]).push(i);});
    const keys=Object.keys(byMs); shuffle(keys); keys.forEach(m=>shuffle(byMs[m]));
    let added=true;
    while(picked.length<k&&added){ added=false; for(const m of keys){ if(picked.length>=k)break; const arr=byMs[m];
      while(arr.length){ const i=arr.shift(); if(ok(i,true,true)){take(i,'e');added=true;break;} } } }
    if(picked.length<k){ const rest=pool.filter(i=>origin[i]===undefined); shuffle(rest); for(const i of rest){ if(picked.length>=k)break; if(ok(i,false,false)) take(i,'w'); } }
  }
  S.origin=S.origin||{}; picked.forEach(i=>S.origin[i]=origin[i]);
  return arrangeSpaced(picked,origin);
}
/* order a batch so neighbours differ: garment group first, then brand, then
   micro-style, and alternate discovery cards with the model's picks */
function arrangeSpaced(list,origin){
  const rest=shuffle(list.slice()), out=[];
  let prev=LAST_DEALT!=null?CATALOG[LAST_DEALT]:null, prevO=LAST_DEALT!=null?(S.origin||{})[LAST_DEALT]:null;
  while(rest.length){
    let bi=0, bp=Infinity;
    for(let j=0;j<rest.length;j++){
      const p=CATALOG[rest[j]]; let pen=0;
      if(prev){ if(groupOf(p)===groupOf(prev)) pen+=2; if(p.b===prev.b) pen+=3; if(p.ms[0]===prev.ms[0]) pen+=1; }
      if(prevO && origin[rest[j]]===prevO && prevO!=='w') pen+=0.5;
      if(pen<bp){bp=pen;bi=j;}
      if(pen===0) break;
    }
    const i=rest.splice(bi,1)[0]; out.push(i); prev=CATALOG[i]; prevO=origin[i];
  }
  return out;
}

/* the v3 dealer, kept verbatim for measurement (DECK_V4=false) */
function dealV3(k,pool,L,haveSignal){
  const picked=[], brandCap={}, seenT={};
  const tryAdd=(i,avoidRecent)=>{const p=CATALOG[i],bt=baseTitle(p.n);
    if(seenT[bt])return false;
    if(brandCap[p.b])return false;
    if(avoidRecent && LAST_BRANDS.has(p.b))return false;
    picked.push(i);seenT[bt]=1;brandCap[p.b]=1;return true;};
  if(haveSignal){
    let cand=pool;
    if(pool.length>2500){ const s=pool.slice(); shuffle(s); cand=s.slice(0,2500); }
    const scored=cand.map(i=>({i,s:hybrid(CATALOG[i],MODEL,L)})).sort((a,b)=>b.s-a.s);
    const swipes=Object.keys(S.reactions).length;
    const exploitFrac = swipes<20 ? Math.min(0.6, 0.42 + swipes*0.009)
                                  : Math.min(0.9, 0.66 + (swipes-20)*0.006);
    const nExploit=Math.max(1,Math.round(k*exploitFrac));
    for(const o of scored){ if(picked.length>=nExploit)break; tryAdd(o.i,true); }
    const rest=pool.filter(i=>!picked.includes(i)); shuffle(rest);
    for(const i of rest){ if(picked.length>=k)break; tryAdd(i,true); }
    if(picked.length<k){ for(const o of scored){ if(picked.length>=k)break; tryAdd(o.i,false); } }
    if(picked.length<k){ for(const i of rest){ if(picked.length>=k)break; tryAdd(i,false); } }
  } else {
    const byMs={}; pool.forEach(i=>{const m=CATALOG[i].ms[0];(byMs[m]=byMs[m]||[]).push(i);});
    const keys=Object.keys(byMs); shuffle(keys); keys.forEach(m=>shuffle(byMs[m]));
    let added=true;
    while(picked.length<k&&added){ added=false; for(const m of keys){ if(picked.length>=k)break; const arr=byMs[m]; while(arr.length){ if(tryAdd(arr.shift(),true)){added=true;break;} } } }
    if(picked.length<k){ const rest=pool.filter(i=>!picked.includes(i)); shuffle(rest); for(const i of rest){ if(picked.length>=k)break; tryAdd(i,false); } }
  }
  return shuffle(picked);
}

/* choose the next pieces to swipe on, adapting to what you've liked so far */
function nextBatch(k){
  buildModel();
  const swiped=new Set(Object.keys(S.reactions).map(Number));
  const pool=[];
  for(let i=0;i<CATALOG.length;i++){
    if(swiped.has(i)||SERVED.has(i)||!genderOK(i)) continue;
    const p=CATALOG[i];
    if(seenPiece(p)) continue;    /* shown before, in this session or an earlier one */
    if(styleFull(p)) continue;    /* already had MAX_COLOURWAYS colours of this style */
    pool.push(i);
  }
  if(!pool.length) return [];
  const Lfull=lovedPicks();
  const L=Lfull.length>12?Lfull.slice(-12):Lfull;   // cap nearest-neighbour set (perf: knn is O(pool*L))
  const hasInspo=S.inspo && (Object.keys(S.inspo.styles||{}).length||Object.keys(S.inspo.colors||{}).length);
  const haveSignal=Object.keys(S.reactions).length>=4 || Lfull.length>0 || S.seeds.length>0 || hasInspo;
  const picked = DECK_V4 ? dealV4(k,pool,L,haveSignal) : dealV3(k,pool,L,haveSignal);
  picked.forEach(i=>SERVED.add(i));
  LAST_BRANDS=new Set(picked.map(i=>CATALOG[i].b));
  if(picked.length) LAST_DEALT=picked[picked.length-1];
  return picked;
}
function refill(){ if(QUEUE.length<6){ QUEUE=QUEUE.concat(nextBatch(8)); } }
/* refill OFF the swipe's critical path so scoring never hitches the animation.
   The queue keeps a buffer (>=5 after a swipe), so the next card is always ready instantly. */
let _refillScheduled=false;
function scheduleRefill(){
  if(_refillScheduled || QUEUE.length>=10) return;
  _refillScheduled=true;
  const run=()=>{ _refillScheduled=false; if(QUEUE.length<10){ QUEUE=QUEUE.concat(nextBatch(10)); } };
  setTimeout(run,0);   // runs right after the swipe paints — off the animation's critical path
}
function startDeck(){
  /* `seen`/`seenStyle` survive this rebuild on purpose. startDeck() runs every
     time a filter or section changes — switching to womenswear and back must
     not re-deal everything you have already looked at. Only "Start over",
     which clears storage outright, forgets them. */
  S={seeds:S.seeds,reactions:{},tags:{},picks:(S.picks||[]),likes:(S.likes||[]),hist:[],settings:S.settings,byGender:S.byGender,inspo:S.inspo,noFast:S.noFast,seen:(S.seen||{}),seenStyle:(S.seenStyle||{}),origin:{}};
  QUEUE=[]; SERVED=new Set(); LAST_BRANDS=new Set(); LAST_DEALT=null; _SHOWING=null;
  QUEUE=nextBatch(14);
  show("deck"); syncGenderToggles(); renderCard();
}
function renderCard(){
  const swipedN=Object.keys(S.reactions).length;
  const _df=document.getElementById("deckFill");
  if(_df){const strength=Math.min(100,Math.round(swipedN/40*100));_df.style.width=strength+"%";}
  const loved=Object.values(S.reactions).filter(r=>r==="love").length;
  const liked=Object.values(S.reactions).filter(r=>r==="like").length;
  /* the running "N viewed" tally is deliberately not shown — it turned the
     deck into a counter to grind rather than clothes to look at. The number
     is still tracked; only the label is blank. */
  document.getElementById("deckCount").textContent="";
  /* this section's counts, matching the cart badges and the cart panel — the raw
     arrays hold both sections, so reading them here said "7 in cart" while the
     cart itself showed 3 */
  document.getElementById("deckLoved").textContent=`${cartView('cart').length} in cart · ${cartView('likes').length} liked`;
  const undoB=document.getElementById("undoBtn"); if(undoB) undoB.style.visibility=(!S.hist||!S.hist.length)?"hidden":"visible";
  document.getElementById("doneBtn").classList.toggle("hidden",(loved+liked)<8);
  updateCartFab(); syncNoFastBtn(); syncStrictBtn();
  if(!QUEUE.length) refill();
  const tagStrip=document.getElementById("tagStrip");
  if(!QUEUE.length){
    const anyPass=CATALOG.some((p,ix)=>passesFilters(ix));
    document.getElementById("cardHost").innerHTML=`<div class="piece-card" style="min-height:340px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:48px 24px"><p style="font-size:21px;color:var(--green-2);font-weight:700;margin:0 0 6px">${anyPass?"You're all caught up":"No pieces match your filters"}</p><p class="section-note" style="margin:0 0 12px">${anyPass?"You've seen the best matches for now — hit <b>Done</b> to view your edit &amp; cart.":"Your category, occasion or budget filters are a bit tight."}</p>${anyPass?"":'<button class="btn small" onclick="openSettings()">Adjust filters</button>'}</div>`;
    if(tagStrip) tagStrip.innerHTML="";
    return;
  }
  const pi=QUEUE[0],p=CATALOG[pi];
  markShown(pi);                 /* this piece will never be dealt again */
  const price=p.cur==="$"?`$${p.p}`:`${p.cur}${p.p} <span class="usd">(≈$${p.usd})</span>`;
  const inCart=S.picks.includes(pi);
  document.getElementById("cardHost").innerHTML=`
    <div class="piece-card">
      <div class="piece-photo${FOCUS_ON?'':' nofocus'}">
        <a class="ph-link" href="${p.u}" target="_blank" rel="noopener noreferrer"
           title="Open this piece at ${p.b}" onclick="return deckTapOK()">
          <img src="${pImg(p.img,760)}" alt="${p.n}" referrerpolicy="no-referrer" decoding="async" fetchpriority="high" onerror="window.__fail(${pi})">
        </a>
        ${(()=>{const f=focusOf(p);const top=(f.t*100).toFixed(1),hh=(f.h*100).toFixed(1),bot=(100-f.t*100-f.h*100).toFixed(1);
          const place=(f.t<0.08?" at-top":"")+((f.t+f.h)>0.88?" at-foot":"");
          return `<div class="ph-dim" style="top:0;height:${top}%"></div>
                  <div class="ph-dim" style="bottom:0;height:${bot}%"></div>
                  <div class="ph-frame${place}" style="top:${top}%;height:${hh}%"><span class="ph-tag">${f.label}</span></div>`;})()}
        <button class="report-btn" id="reportBtn" onclick="openReport(event)" aria-label="Report a problem with this piece" title="Report a problem with this piece">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V4"/><path d="M4 4h11l-1.6 3.5L15 11H4z"/></svg>
        </button>
        <button class="swipe-cart ${inCart?'in':''}" title="Add to cart" onclick="saveToCartCurrent(event)"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px"><path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8a3 3 0 0 1 6 0"/></svg>${inCart?'In cart':'Add to cart'}</button>
        <div class="stamp s-like">Like</div><div class="stamp s-nope">Nope</div><div class="stamp s-love">Love</div>
        <div class="card-overlay">
          <div class="mstags">${p.ms.slice(0,3).map(m=>`<span class="mstag">${MS[m]||m}</span>`).join("")}</div>
          <div class="piece-brand">${p.b}</div>
          <div class="piece-name">${p.n}</div>
          <div class="piece-price">${price}</div>
        </div>
      </div>
    </div>`;
  const chosen=S.tags[pi]||[];
  if(tagStrip) tagStrip.innerHTML=`<div class="tl">What caught your eye? (optional)</div>`+REACT_TAGS.map(t=>`<span class="tag ${chosen.includes(t)?'on':''}" onclick="toggleTag(${pi},'${t}',this)">${t}</span>`).join("");
  const shown=document.querySelector('#cardHost .piece-card');
  attachDrag(shown);
  /* Animate the arrival only when the piece actually changed. renderCard() also
     re-runs for things that redraw the SAME card — Add to cart, the tag strip,
     a filter toggle — and animating those would make the card bounce every time
     you pressed a button on it. */
  if(pi!==_SHOWING){ _SHOWING=pi; enterCard(shown); }
  preloadUpcoming(4);   // prefetch the next few cards' photos so swiping to them is instant
}
/* keep the next N upcoming card images warm in the browser cache (no on-swipe delay) */
let _PRELOAD=[];
function preloadUpcoming(n){
  n=n||4;
  for(let j=1;j<=n && j<QUEUE.length;j++){
    const p=CATALOG[QUEUE[j]]; if(!p||!p.img) continue;
    const im=new Image(); im.decoding="async"; im.referrerPolicy="no-referrer"; im.src=pImg(p.img,760);
    _PRELOAD.push(im);                                   // hold a reference so the fetch isn't GC-cancelled
  }
  if(_PRELOAD.length>30) _PRELOAD=_PRELOAD.slice(-15);   // cap the retained refs
}
window.__fail=function(pi){
  const img=document.querySelector('#cardHost .piece-photo img'); if(!img)return;
  const p=CATALOG[pi];
  // 1st failure: retry the ORIGINAL (untransformed) url with no referrer — beats CDN hotlink/transform blocks
  if(!img.dataset.r){ img.dataset.r='1'; img.referrerPolicy='no-referrer'; img.src=p.img; return; }
  imgFail(img,p);
};
function toggleTag(pi,t,el){const a=S.tags[pi]||(S.tags[pi]=[]);const i=a.indexOf(t);if(i>=0){a.splice(i,1);el.classList.remove("on");}else{a.push(t);el.classList.add("on");}}
function react(kind){const pi=QUEUE[0];S.reactions[pi]=kind;(S.hist=S.hist||[]).push(pi);
  S.picks=S.picks||[]; S.likes=S.likes||[];
  if(kind==='love'&&!S.picks.includes(pi))S.picks.push(pi);   // super-like -> cart (cart icon)
  if(kind==='like'&&!S.likes.includes(pi))S.likes.push(pi);   // right swipe -> liked cart (green heart)
  QUEUE.shift();
  renderCard();            // show the next card immediately (it's already queued + preloaded)
  save();
  scheduleRefill();        // top up the queue in the background — no swipe hitch
}
function undoLast(){if(S.hist&&S.hist.length){const pi=S.hist.pop();const r=S.reactions[pi];delete S.reactions[pi];
  if(r==='love'){const k=(S.picks||[]).indexOf(pi);if(k>=0)S.picks.splice(k,1);}      // undo pulls it back out of the right cart
  if(r==='like'){const k=(S.likes||[]).indexOf(pi);if(k>=0)S.likes.splice(k,1);}
  QUEUE.unshift(pi);renderCard();}}
function saveToCartCurrent(e){if(e&&e.stopPropagation)e.stopPropagation();if(QUEUE.length){togglePick(QUEUE[0]);renderCard();}}
