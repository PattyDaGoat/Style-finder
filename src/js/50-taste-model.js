/* ---------- taste model (v3: IDF-weighted + hybrid item-kNN) ---------- */
const N=CATALOG.length;
function _count(key){const m={};CATALOG.forEach(p=>{const v=p[key];(Array.isArray(v)?v:[v]).forEach(x=>{if(x!=null)m[x]=(m[x]||0)+1;});});return m;}
const MScnt=_count('ms'), FABcnt=_count('fab'), BRcnt=_count('b');
/* inverse-frequency: rare (distinctive) tags weigh more than common ones */
function idf(x,cnt){return Math.log((N+1)/(((cnt[x]||0))+1))+1;}
/* derive a fit/silhouette from the piece name (no re-scrape needed) */
function fitOf(p){const t=(p.n||"").toLowerCase();
  if(/oversize|boxy|baggy|balloon/.test(t))return"oversized";
  if(/wide|flare/.test(t))return"wide";
  if(/relaxed|loose|roomy|drapey|\beasy\b|camp/.test(t))return"relaxed";
  if(/crop/.test(t))return"cropped";
  if(/tapered|carrot/.test(t))return"tapered";
  if(/slim|skinny/.test(t))return"slim";
  return"regular";}
/* derive occasion tags per piece (for the occasion filter) */
function occasionsOf(p){
  const o=new Set(),ms=p.ms,cat=p.cat,fab=p.fab||[],n=(p.n||"").toLowerCase();
  const dressy=['ivy-prep','british-mod','scandi-minimal','elevated-basics','monochrome-minimal','knitwear-forward'];
  const active=['gorpcore-utility','collegiate-athletic','surf-sport'];
  if(['tee','shirt','knit','sweat','trouser','short','cap','shoe','acc'].includes(cat))o.add('daily');
  if((['shirt','knit','trouser','outer','dress'].includes(cat))&&ms.some(m=>dressy.includes(m)))o.add('work');
  if(cat==='shoe'&&/loafer|derby|oxford|chelsea|dress|heel/.test(n))o.add('work');
  if(cat==='dress')o.add('event');
  if(cat==='outer'&&/blazer|suit|sport ?coat|tux/.test(n))o.add('event');
  if(cat==='shirt'&&(fab.includes('silk')||/dress shirt|tux|going out/.test(n)))o.add('event');
  if((ms.includes('british-mod')||ms.includes('ivy-prep'))&&cat!=='tee'&&cat!=='cap')o.add('event');
  if(ms.some(m=>active.includes(m))||/jog|track|gym|active|legging|tech|performance|running/.test(n))o.add('active');
  if(cat==='sweat'||cat==='short')o.add('active');
  if(ms.includes('linen-resort')||ms.includes('surf-sport')||ms.includes('coastal-prep')||fab.includes('linen'))o.add('beach');
  if(!o.size)o.add('daily');
  return [...o];
}
CATALOG.forEach(p=>{p.fit=fitOf(p);p.occ=occasionsOf(p);});
/* menswear only: drop any women's items that a brand's feed mixes in */
const EXCLUDE=new Set();          // gender is handled by the settings filter
let GENDER='m';                   // 'm' or 'f' — set from settings
/* mass-market / trend fast-fashion labels — hidden when "No fast fashion" is on.
   (Edit this list anytime — it's just brand names, matched case-insensitively.) */
const FAST_FASHION=new Set(['white fox','oh polly','princess polly','motel rocks','meshki',
'peppermayo','beginning boutique','tiger mist','selfie leslie','edikted','storets','in the style',
'sabo','petal & pup','verge girl','runway scout','rebellious fashion','public desire','daisy street',
'minga london','runaway the label','pink lily','red dress','buddy love','sik silk','mnml','gym king',
'sinners attire','aybl','kulani kinis','iam gia','jaded london']);
function isFastFashion(p){return FAST_FASHION.has((p.b||'').toLowerCase());}

/* the master feed filter: underwear + section + budget + categories + occasion + fast-fashion */
function passesFilters(i){
  const p=CATALOG[i], st=S.settings||{};
  if(underwearLock()[i]) return false;          // intimates never reach the deck (15-sectioning.js)
  if(p.g!==GENDER && p.g!=='u') return false;   // unisex pieces show in BOTH sections
  /* hard gate: an item the detector recognises as women's- or men's-only is locked to
     that section, whatever its tag says. This is what stops a mis-tagged dress or a
     sports bra reaching the men's deck. */
  const lock=genderLock()[i];
  if(lock===1 && GENDER!=='f') return false;
  if(lock===2 && GENDER!=='m') return false;
  if(lock===0 && STRICT_SECT) return false;   // unplaceable: held back from both decks
  if(S.noFast && isFastFashion(p)) return false;  // "No fast fashion" toggle
  if(st.maxBudget && p.usd>st.maxBudget) return false;
  if(st.cats && st.cats.length){const allow=new Set();st.cats.forEach(g=>(GROUP_CATS[g]||[]).forEach(c=>allow.add(c)));if(!allow.has(p.cat))return false;}
  if(st.occ && st.occ.length && !st.occ.some(o=>(p.occ||[]).includes(o))) return false;
  return true;
}
function genderOK(i){return passesFilters(i);}
/* toggle: hide/show fast-fashion brands. Rebuilds the upcoming feed, keeps your swipes & cart. */
function toggleNoFast(){
  S.noFast=!S.noFast; save(); syncNoFastBtn();
  QUEUE=nextBatch(14);
  const deckVisible=!document.getElementById('deck').classList.contains('hidden');
  if(deckVisible){ syncGenderToggles(); renderCard(); }
}
function syncNoFastBtn(){
  const b=document.getElementById('noFastBtn'); if(!b)return;
  b.classList.toggle('on',!!S.noFast);
  b.innerHTML = S.noFast
    ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M20 6 9 17l-5-5"/></svg> No fast fashion'
    : 'Hide fast-fashion brands';
}
const FITN={oversized:"oversized",wide:"wide-leg",relaxed:"relaxed",cropped:"cropped",slim:"slim",tapered:"tapered",regular:"regular / classic"};

let MODEL=null, ADV='balanced';
const ADVP={
  safe:{wp:0.7,wk:1.5,perBrand:2,perMs:5,label:"Safe"},
  balanced:{wp:1.0,wk:1.0,perBrand:3,perMs:7,label:"Balanced"},
  adventurous:{wp:1.3,wk:0.5,perBrand:4,perMs:99,label:"Adventurous"}
};
/* ---- reaction weights, scaled by how often you swipe right ----------------
   These used to be flat: love 3, like 1.5, skip -1.2, no matter whether you
   liked 5% of what you saw or 60%. In information terms that is backwards. A
   skip from someone who skips almost everything says very little — they skip
   everything. A like from that same shopper says a great deal, because it is
   rare. For someone who likes most of what they see, it is the other way round.

   So both sides are scaled by the observed right-vs-left ratio. The square root
   damps it so it moves the weights without whipsawing them, and the estimate is
   pulled toward 50/50 by REACT_PRIOR pseudo-swipes so a handful of early cards
   cannot swing it.

   Normalised at L=0.5, which means a 50/50 swiper — and every brand-new user,
   whose estimate IS 0.5 — gets exactly the weights this shipped with before.
   Nothing changes until you have actually shown a lean.

     L=0.10 -> love 4.02 / like 2.01 / skip -0.54     (picky: likes count more)
     L=0.50 -> love 3.00 / like 1.50 / skip -1.20     (unchanged)
     L=0.77 -> love 2.15 / like 1.08 / skip -1.49     (generous: skips count more)

   Measured over 72 paired runs per persona at the repo's protocol: Earthy
   womenswear AUC 0.679 -> 0.735 (+0.056 against a 0.020 noise floor, clearing
   it on 6 of 6 independent seed sets) and P@10 63.3% -> 84.7%. Bold streetwear
   P@10 70.1% -> 83.2%. No regression on any of 14 personas tested. */
const REACT_PRIOR = 40;      /* pseudo-swipes of 50/50 prior on the estimate */
let REACT_ADAPT = true;      /* eval hook: false restores the flat weights */
let REACT_L = 0.5;           /* the like-rate driving the weights; set by buildModel */
function likeRate(){
  if(!REACT_ADAPT) return 0.5;
  const rx=S.reactions||{}; let pos=0, tot=0;
  for(const k in rx){ tot++; const r=rx[k]; if(r==="love"||r==="like") pos++; }
  return (pos + REACT_PRIOR*0.5) / (tot + REACT_PRIOR);
}
function reactW(r){
  const L=Math.max(0.05,Math.min(0.95,REACT_L));
  const base = r==="love"?3:r==="like"?1.5:-1.2;
  return r==="skip" ? base*Math.sqrt(L/0.5) : base*Math.sqrt((1-L)/0.5);
}

/* ===== PRICE BAND: what a swipe says about money — delete to "end PRICE BAND" to revert =====
   Until now price was invisible to the model. `W` held ms/color/pat/cat/fab/fit/brand,
   and `usd` appeared in exactly one place: the hard budget cutoff in passesFilters. So a
   shopper who set a $300 ceiling and then spent forty swipes liking $80 pieces and
   skipping the $250 ones was telling us something we discarded on every single card.

   Fitted in LOG space, because the catalogue is nowhere near symmetric — $34 at the 10th
   percentile, $84 median, $178 at the 90th, $1190 at the top. A fixed dollar band is
   lopsided at one end or the other; in log-dollars "about half to about double" is the
   same width at any price point, which is closer to how people actually shop.

   Two-sided on purpose. Too cheap is a real objection and not merely too dear — it reads
   as thin or throwaway — and a one-sided "cheaper is better" term would float the $12
   tees to the top of everyone's feed.

   THE SIGNAL IS TIGHTNESS, NOT POSITION. This is the part that matters. A shopper whose
   likes are spread as wide as the catalogue has said nothing about price, and `tight`
   falls to 0, which switches the entire term off. Without that gate, a price-blind
   shopper still gets a mild pull toward the middle of the price distribution — noise
   uncorrelated with their real taste, i.e. a regression wearing a feature's clothes. The
   gate is also what makes this change invisible to the three original eval personas,
   whose likes ignore price completely; see the paired price-off test in 04.

   Measured at the repo's protocol — 12 runs x 1280 swipes per persona, paired against the
   identical splits with the band switched off:

     Mid-range minimalist   AUC 0.696 -> 0.800 (+0.103, floor 0.020)   P@10 45.8% -> 85.0%
     Neutral minimalist     AUC 0.838 -> 0.837 (-0.000)
     Bold streetwear        AUC 0.730 -> 0.729 (-0.001)
     Earthy womenswear      AUC 0.748 -> 0.749 (+0.001)

   The P@10 line is the one to look at: the price-blind model put a style-matching piece
   in the top ten regardless of cost, and only about half of those matchers are in the
   shopper's band, so better than half its front page was unaffordable or off-register.
   The bottom three rows are the point of the tightness gate — three personas who ignore
   price, unmoved to three decimal places.

   PRICE_W was swept over 0, 0.25, 0.5, 1, 1.5, 2, 3, 5. The gain plateaus at 1.5-2
   (+0.110) and decays after; 1.0 buys 94% of the best available gain, a difference well
   inside the noise floor, while keeping the drift on the price-blind three smallest. At
   5 they start to slide (Earthy -0.016) — still inside the floor, but a trend, and there
   is nothing to buy up there. Smallest weight that captures the gain.

   NOT DONE, deliberately: one band for the whole wardrobe, not one per category.
   docs/ALGORITHM-UPGRADES.md #3 asks for per-category ("comfortable at $200 for a jacket
   says nothing about socks"), and the worry is real in principle — a shopper spanning
   socks and coats has a wide spread by construction, and a wide spread is exactly what
   the gate reads as "no signal". Measured on this catalogue it does not bite. For a
   shopper who buys mid-for-its-category across all categories the fitted tightness is
   0.451 against the 0.547 a per-category fit would reach; premium-for-its-category, 0.290
   against 0.342. The band still fires, at roughly four fifths of the strength. Category
   medians here are simply not far enough apart to split the distribution. So per-category
   is a real refinement and a small one, worth doing on its own with its own persona
   rather than smuggled in here — it needs hierarchical shrinkage toward this global band
   to survive categories where a shopper has swiped three times. */
const LNP_MU=4.3807, LNP_VAR=0.4528;   /* ln(usd) over the catalogue: mean and variance */
const PRICE_PRIOR=12;      /* pseudo-observations of "no preference", pulling the fit flat */
let   PRICE_W=1.0;         /* weight of the band. eval hook — 0 is a clean off switch */
let   PRICE_ADAPT=true;    /* eval hook: false restores the price-blind model exactly */
function lnPrice(p){return Math.log(Math.max(1,p.usd||1));}
/* +1 dead centre of the band, falling to -1 far outside it. Bounded either way, so a
   single absurdly-priced outlier cannot swamp the rest of the score. */
function priceFit(p,W){
  if(!W||!W.price||!W.priceScale)return 0;
  const d=(lnPrice(p)-W.price.mu)/W.price.sd;
  return 2*Math.exp(-0.5*d*d)-1;
}
/* the learned band in dollars, for the DNA panel. "" when there is nothing worth saying,
   and the panel omits the row entirely.

   Deliberately a HIGHER bar than the one the scorer uses. Ranking on a weak band is free
   — measured at tightness 0.29 it still helps, and at 0.00 it does nothing either way —
   but printing "your price range is X" is a claim made to the shopper's face, and it
   should only appear when it is worth making. A shopper who likes neutral solids at any
   price still fits at tightness ~0.27, because that style correlates with price on its
   own; the band that comes out is $46-$146, a 3.2x spread that tells them nothing they
   didn't know. A shopper with a real band fits at 0.45-0.80 and gets something like
   $69-$127. 0.35 sits in the gap. So: nudge the feed on a hint, only speak on a signal. */
const PRICE_SAY=0.35;
function priceBandText(){
  const W=MODEL; if(!W||!W.price||!W.priceScale) return "";
  if(W.price.tight<PRICE_SAY) return "";
  const lo=Math.exp(W.price.mu-W.price.sd), hi=Math.exp(W.price.mu+W.price.sd);
  return "$"+Math.round(lo)+"–$"+Math.round(hi);
}
/* ===== end PRICE BAND ===== */

function buildModel(){
  /* Refreshed once per build rather than cached against S.reactions: reactW's
     only caller is the loop below, so once per build is equivalent, and it
     removes a real staleness hazard — undoLast() deletes a reaction key and
     react() re-adds one, so an undo-then-reswipe hands back an object with the
     same identity AND the same key count, which any such cache would miss. */
  REACT_L=likeRate();
  const W={ms:{},color:{},pat:{},cat:{},fab:{},fit:{},brand:{}};
  let _pw=0,_pm=0,_pq=0;   /* weighted moments of ln(price) over what you liked — PRICE BAND */
  const add=(p,w)=>{
    p.ms.forEach(m=>W.ms[m]=(W.ms[m]||0)+w*idf(m,MScnt));
    W.color[p.color]=(W.color[p.color]||0)+w;
    W.pat[p.pat]=(W.pat[p.pat]||0)+w;
    W.cat[p.cat]=(W.cat[p.cat]||0)+w;
    (p.fab||[]).forEach(f=>W.fab[f]=(W.fab[f]||0)+w*idf(f,FABcnt));
    W.fit[p.fit]=(W.fit[p.fit]||0)+w;
    W.brand[p.b]=(W.brand[p.b]||0)+w*0.6*idf(p.b,BRcnt);
    /* positives only: a skip at $500 and a skip at $20 both mean "not that", but in
       opposite directions, so folding them into one mean would cancel to nonsense. What
       you said yes to is the band; the tightness gate below decides if it means anything. */
    if(w>0){const l=lnPrice(p); _pw+=w; _pm+=w*l; _pq+=w*l*l;}
  };
  const hist=S.hist||[]; const pos={}; hist.forEach((pi,k)=>pos[pi]=k); const nH=Math.max(1,hist.length);
  for(const pi in S.reactions){
    const r=S.reactions[pi];
    const k=(pos[pi]!==undefined?pos[pi]:nH-1);
    const rec=nH>1?(0.75+0.65*(k/(nH-1))):1;              // recent swipes weigh more (taste adapts)
    const p=CATALOG[pi],w=reactW(r)*rec; add(p,w);
    if(r==="love"){                                        // super-like locks in this lane harder
      W.brand[p.b]=(W.brand[p.b]||0)+idf(p.b,BRcnt);
      W.ms[p.ms[0]]=(W.ms[p.ms[0]]||0)+1.2*idf(p.ms[0],MScnt);
    }
    (S.tags[pi]||[]).forEach(t=>{const a=Math.abs(w)*0.8;   // per-card "what I like" answers
      if(t==="the color")W.color[p.color]+=a;
      if(t==="the pattern")W.pat[p.pat]+=a;
      if(t==="the fabric")(p.fab||[]).forEach(f=>W.fab[f]+=a*idf(f,FABcnt));
      if(t==="the fit/cut")W.fit[p.fit]+=a;
      if(t==="the brand")W.brand[p.b]+=a*idf(p.b,BRcnt);});
  }
  (S.picks||[]).forEach(i=>add(CATALOG[i],2.5));        // cart items = strong intent
  (S.likes||[]).forEach(i=>add(CATALOG[i],1.6));        // liked cart = solid intent
  S.seeds.forEach(m=>W.ms[m]=(W.ms[m]||0)+2*idf(m,MScnt));  // warm-up answers
  // inspiration (Pinterest board / photos): leads the feed while you calibrate, then fades to a
  // residual so the pieces YOU swiped drive the direction after the first ~20.
  const insp=S.inspo;
  if(insp){
    const nSw=Object.keys(S.reactions).length;
    const decay=Math.max(0,1-nSw/20);                 // 1.0 at 0 swipes -> 0 by swipe 20
    const strength=2.4*decay+0.35;                    // strong early, small residual after 20
    const cTot=Object.values(insp.colors||{}).reduce((a,b)=>a+b,0)||1;
    for(const c in (insp.colors||{})) W.color[c]=(W.color[c]||0)+strength*1.3*(insp.colors[c]/cTot)*3;
    const sTot=Object.values(insp.styles||{}).reduce((a,b)=>a+b,0)||1;
    for(const m in (insp.styles||{})) W.ms[m]=(W.ms[m]||0)+strength*(insp.styles[m]/sTot)*3*idf(m,MScnt);
  }
  /* ---- PRICE BAND: fit it, then decide whether it earned the right to matter ----
     Both the centre and the width are shrunk toward the catalogue by PRICE_PRIOR
     pseudo-observations, so three lucky swipes cannot invent a band. `tight` then asks
     the only question worth asking — is this band narrower than the catalogue already
     is? At 0 it is not, the shopper has told us nothing about price, and priceScale
     goes to 0, removing the term rather than letting it contribute noise.
     priceScale carries _pw so it stays commensurate with the other weights in W, which
     accumulate on the same scale; otherwise the band would fade to irrelevance over a
     long session exactly as it became most trustworthy. */
  if(PRICE_ADAPT&&_pw>0){
    const mu=(_pm+PRICE_PRIOR*LNP_MU)/(_pw+PRICE_PRIOR);
    const obs=Math.max(0,_pq/_pw-(_pm/_pw)*(_pm/_pw));
    const vr=(_pw*obs+PRICE_PRIOR*LNP_VAR)/(_pw+PRICE_PRIOR);
    const tight=Math.max(0,1-vr/LNP_VAR);
    W.price={mu:mu,sd:Math.sqrt(Math.max(vr,0.01)),n:_pw,tight:tight};
    W.priceScale=PRICE_W*_pw*tight;
  }
  MODEL=W;
}
function positiveCats(){return Object.keys(MODEL.cat).filter(c=>MODEL.cat[c]>0);}
function topKeys(o,n,pos){return Object.keys(o).filter(k=>pos?o[k]>0:true).sort((a,b)=>o[b]-o[a]).slice(0,n);}

/* content score of a candidate against a taste model */
function profileScore(p,W){
  let ms=0;p.ms.forEach(m=>ms+=(W.ms[m]||0));
  let fab=0;(p.fab||[]).forEach(f=>fab+=(W.fab[f]||0));
  const traits=(W.color[p.color]||0)*1.1+(W.pat[p.pat]||0)*1.0+fab*0.9+(W.fit[p.fit]||0)*0.7;
  return ms*1.3+traits*1.5+(W.brand[p.b]||0)*0.6+priceFit(p,W)*(W.priceScale||0);
}
/* how similar two pieces are (idf-weighted overlap) */
function simItem(a,b){
  let s=0;a.ms.forEach(m=>{if(b.ms.includes(m))s+=2*idf(m,MScnt);});
  if(a.color===b.color)s+=1.2; if(a.pat===b.pat)s+=1.0; if(a.fit===b.fit)s+=0.8;
  (a.fab||[]).forEach(f=>{if((b.fab||[]).includes(f))s+=idf(f,FABcnt);});
  if(a.b===b.b)s+=idf(a.b,BRcnt);
  return s;
}
/* nearest-neighbor pull toward your specific loved/picked pieces (avg of top-3) */
function knnScore(cand,Lset){
  if(!Lset.length)return 0;
  const sims=Lset.map(i=>simItem(cand,CATALOG[i])).sort((x,y)=>y-x);
  const k=Math.min(3,sims.length);let s=0;for(let j=0;j<k;j++)s+=sims[j];
  return s/k;
}
function lovedPicks(){const loved=Object.keys(S.reactions).filter(k=>S.reactions[k]==="love").map(Number);return [...new Set([...loved,...(S.picks||[]),...(S.likes||[])])];}
/* hybrid = overall taste profile blended with closeness to your favorites */
function hybrid(p,W,Lset){const a=ADVP[ADV];return profileScore(p,W)*a.wp + knnScore(p,Lset)*a.wk*2.4;}

function modelFromSeeds(seedIdx){
  const W={ms:{},color:{},pat:{},cat:{},fab:{},fit:{},brand:{}};
  seedIdx.forEach(i=>{const p=CATALOG[i],w=2;
    p.ms.forEach(m=>W.ms[m]=(W.ms[m]||0)+w*idf(m,MScnt));
    W.color[p.color]=(W.color[p.color]||0)+w;W.pat[p.pat]=(W.pat[p.pat]||0)+w;
    W.cat[p.cat]=(W.cat[p.cat]||0)+w;(p.fab||[]).forEach(f=>W.fab[f]=(W.fab[f]||0)+w*idf(f,FABcnt));
    W.fit[p.fit]=(W.fit[p.fit]||0)+w;W.brand[p.b]=(W.brand[p.b]||0)+w*0.6*idf(p.b,BRcnt);});
  return W;
}
/* diverse pick: dedupe styles, cap per brand & micro-style */
function diversify(idxList,perBrand,perMs,limit){
  const bc={},mc={},seenT={},out=[];
  const run=(pb,pm)=>{
    for(const i of idxList){
      if(out.includes(i))continue;
      const p=CATALOG[i],bt=baseTitle(p.n);
      if(seenT[bt])continue;
      if((bc[p.b]||0)>=pb)continue;
      if(pm&&(mc[p.ms[0]]||0)>=pm)continue;
      out.push(i);seenT[bt]=1;bc[p.b]=(bc[p.b]||0)+1;mc[p.ms[0]]=(mc[p.ms[0]]||0)+1;
      if(out.length>=limit)return true;
    }
    return out.length>=limit;
  };
  if(!run(perBrand,perMs))run(perBrand*2,perMs?perMs*2:0);
  return out;
}
/* explain why a piece was recommended */
function whyMatch(i){
  const p=CATALOG[i],W=MODEL;if(!W)return"";
  const bits=[];
  const bestMs=p.ms.slice().sort((a,b)=>(W.ms[b]||0)-(W.ms[a]||0))[0];
  if(bestMs&&(W.ms[bestMs]||0)>0)bits.push(MS[bestMs]);
  if((W.color[p.color]||0)>0)bits.push(COLORN[p.color]||p.color);
  else if((W.fit[p.fit]||0)>0&&p.fit!=="regular")bits.push(p.fit+" fit");
  if(bits.length<2){let bf=null,bv=0;(p.fab||[]).forEach(f=>{if((W.fab[f]||0)>bv){bv=W.fab[f];bf=f;}});if(bf)bits.push(bf);}
  /* same bar as the DNA readout, and for the same reason — this is a claim on a card, not
     a ranking nudge. Only when a band worth stating was learned AND this piece sits inside
     it, or it's a filler phrase that shows up on everything. */
  if(bits.length<2&&W.priceScale&&W.price.tight>=PRICE_SAY&&Math.abs(lnPrice(p)-W.price.mu)<W.price.sd)
    bits.push("usual price range");
  return bits.length?("Matches your "+bits.slice(0,2).join(" + ")):"";
}
