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

/* the master feed filter: section + budget + categories + occasion + fast-fashion */
function passesFilters(i){
  const p=CATALOG[i], st=S.settings||{};
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
function reactW(r){return r==="love"?3:r==="like"?1.5:-1.2;}

function buildModel(){
  const W={ms:{},color:{},pat:{},cat:{},fab:{},fit:{},brand:{}};
  const add=(p,w)=>{
    p.ms.forEach(m=>W.ms[m]=(W.ms[m]||0)+w*idf(m,MScnt));
    W.color[p.color]=(W.color[p.color]||0)+w;
    W.pat[p.pat]=(W.pat[p.pat]||0)+w;
    W.cat[p.cat]=(W.cat[p.cat]||0)+w;
    (p.fab||[]).forEach(f=>W.fab[f]=(W.fab[f]||0)+w*idf(f,FABcnt));
    W.fit[p.fit]=(W.fit[p.fit]||0)+w;
    W.brand[p.b]=(W.brand[p.b]||0)+w*0.6*idf(p.b,BRcnt);
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
  MODEL=W;
}
function positiveCats(){return Object.keys(MODEL.cat).filter(c=>MODEL.cat[c]>0);}
function topKeys(o,n,pos){return Object.keys(o).filter(k=>pos?o[k]>0:true).sort((a,b)=>o[b]-o[a]).slice(0,n);}

/* content score of a candidate against a taste model */
function profileScore(p,W){
  let ms=0;p.ms.forEach(m=>ms+=(W.ms[m]||0));
  let fab=0;(p.fab||[]).forEach(f=>fab+=(W.fab[f]||0));
  const traits=(W.color[p.color]||0)*1.1+(W.pat[p.pat]||0)*1.0+fab*0.9+(W.fit[p.fit]||0)*0.7;
  return ms*1.3+traits*1.5+(W.brand[p.b]||0)*0.6;
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
  return bits.length?("Matches your "+bits.slice(0,2).join(" + ")):"";
}
