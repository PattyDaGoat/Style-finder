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
  const picked=[], brandCap={}, seenT={};
  // wide variety: at most ONE piece per brand per batch, and avoid brands shown in the
  // previous batch (avoidRecent) so you don't see the same company back-to-back.
  const tryAdd=(i,avoidRecent)=>{const p=CATALOG[i],bt=baseTitle(p.n);
    if(seenT[bt])return false;
    if(brandCap[p.b])return false;
    if(avoidRecent && LAST_BRANDS.has(p.b))return false;
    picked.push(i);seenT[bt]=1;brandCap[p.b]=1;return true;};
  if(haveSignal){
    // cap how many candidates we score each batch — keeps it fast on big catalogs.
    // Always keep a large sample; the feed is endless so nothing good is lost for long.
    let cand=pool;
    if(pool.length>2500){ const s=pool.slice(); shuffle(s); cand=s.slice(0,2500); }
    const scored=cand.map(i=>({i,s:hybrid(CATALOG[i],MODEL,L)})).sort((a,b)=>b.s-a.s);
    const swipes=Object.keys(S.reactions).length;
    // two regimes: first 20 swipes = calibration (stay exploratory to learn you, gently guided by
    // your inspiration); after 20 = hone in hard on the profile your own picks built.
    const exploitFrac = swipes<20 ? Math.min(0.6, 0.42 + swipes*0.009)
                                  : Math.min(0.9, 0.66 + (swipes-20)*0.006);
    const nExploit=Math.max(1,Math.round(k*exploitFrac));       // best matches (grows over time)
    for(const o of scored){ if(picked.length>=nExploit)break; tryAdd(o.i,true); }
    const rest=pool.filter(i=>!picked.includes(i)); shuffle(rest);  // remainder = exploration to keep discovering
    for(const i of rest){ if(picked.length>=k)break; tryAdd(i,true); }
    // fallbacks if the catalog is thin: relax the "avoid recent brands" rule
    if(picked.length<k){ for(const o of scored){ if(picked.length>=k)break; tryAdd(o.i,false); } }
    if(picked.length<k){ for(const i of rest){ if(picked.length>=k)break; tryAdd(i,false); } }
  } else {
    const byMs={}; pool.forEach(i=>{const m=CATALOG[i].ms[0];(byMs[m]=byMs[m]||[]).push(i);});
    const keys=Object.keys(byMs); shuffle(keys); keys.forEach(m=>shuffle(byMs[m]));
    let added=true;
    while(picked.length<k&&added){ added=false; for(const m of keys){ if(picked.length>=k)break; const arr=byMs[m]; while(arr.length){ if(tryAdd(arr.shift(),true)){added=true;break;} } } }
    // fallback pass without the recent-brand guard
    if(picked.length<k){ const rest=pool.filter(i=>!picked.includes(i)); shuffle(rest); for(const i of rest){ if(picked.length>=k)break; tryAdd(i,false); } }
  }
  shuffle(picked);
  picked.forEach(i=>SERVED.add(i));
  LAST_BRANDS=new Set(picked.map(i=>CATALOG[i].b));
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
  S={seeds:S.seeds,reactions:{},tags:{},picks:(S.picks||[]),likes:(S.likes||[]),hist:[],settings:S.settings,byGender:S.byGender,inspo:S.inspo,noFast:S.noFast,seen:(S.seen||{}),seenStyle:(S.seenStyle||{})};
  QUEUE=[]; SERVED=new Set(); LAST_BRANDS=new Set(); _SHOWING=null;
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
