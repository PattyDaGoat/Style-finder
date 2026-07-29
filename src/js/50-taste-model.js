/* ---------- taste model (v3: IDF-weighted + hybrid item-kNN) ---------- */
const N=CATALOG.length;
function _count(key){const m={};CATALOG.forEach(p=>{const v=p[key];(Array.isArray(v)?v:[v]).forEach(x=>{if(x!=null)m[x]=(m[x]||0)+1;});});return m;}
const MScnt=_count('ms'), FABcnt=_count('fab'), BRcnt=_count('b'),
      COLcnt=_count('color'), PATcnt=_count('pat');
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
/* ---------- occasion tagging ----------
   Which events a piece actually suits. This feeds the Day-to-day / Work /
   Going-out / Active / Beach chips on the setup screen, and it is a HARD
   filter — pick an occasion and anything without that tag never reaches your
   deck. So a loose rule here does not merely mis-sort the feed, it fills it
   with the wrong clothes.

   The old rule was loose in one direction only: nearly everything qualified.
   `cat==='dress'` on its own tagged all 605 dresses as cocktail — denim shifts
   and smocked sundresses included — and any ivy-prep or british-mod piece that
   was not a tee or a cap qualified too, which is how jeans, chinos, corduroy
   shorts and pique polos arrived under "Going out". 1,299 pieces carried the
   tag and most of them were daywear.

   This works the other way round. Every occasion except `daily` needs a
   positive reason AND has to survive a veto written for that occasion
   specifically — chinos and oxford shirts are vetoed from cocktail but not
   from work, which a single shared "casual" list could never express.

   The reasons come mostly from the piece's own NAME, because the name is by
   far the richest signal here: `fab` is populated on well under a fifth of the
   catalog, and `cat` is occasionally wrong outright — there is a baseball cap
   filed under `trouser` — so a name-led rule is both sharper and much harder
   to fool with one bad row. */
const OCC={
  /* genuinely dressy: eveningwear, tailoring, and the fabrics that only turn up
     when a piece is meant to be dressed up */
  dressy:/(cocktail|black ?tie|tuxedo|\btux\b|gown|evening|formal|\bparty\b|going ?out|sequin|sparkl|glitter|metallic|satin|silk|velvet|\blace\b|chiffon|organza|taffeta|crepe|slip dress|bodycon|strapless|halter|corset|off.the.shoulder|one.shoulder|backless|plunge|blazer|\bsuit\b|sport ?coat|dinner jacket|dress shirt|dress ?(pant|trouser)|tailored|\bheel|\bpump\b|stiletto|monk strap)/,
  /* vetoes COCKTAIL only. Denim, chinos, polos and camp shirts are perfectly
     good clothes — they are simply not what anyone means by "going out".
     `\bshorts\b` is plural on purpose: the garment is nearly always named in the
     plural ("Crepe Low Rise Shorts"), while the singular is usually an adjective
     — "Silk SHORT Slip Dress", "SHORT-Sleeve Shirt" — both of which are exactly
     the sort of thing that should stay. Dressy shorts do exist and this drops a
     handful of them; showing corduroy shorts to someone who asked for cocktail
     is the worse error. */
  notDressy:/(hood(ie|ed)|sweat ?(shirt|pant|short)|jogger|track ?(suit|pant|top)|\bgym\b|athletic|workout|training|running|legging|yoga|sports? ?bra|rash ?guard|base ?layer|thermal|fleece|puffer|parka|anorak|windbreaker|cargo|carpenter|painter|utility|flannel|graphic|band tee|\blogo\b|tank|muscle|sneaker|trainer|skate|hik(e|ing)|trucker|beanie|bucket|denim|\bjean|chino|corduroy|\bcord\b|terry|waffle|crochet|smocked|sundress|shift dress|prairie|coverup|cover.up|kaftan|caftan|swim|bikini|trunk|board ?short|\bpolo\b|pique|camp ?(shirt|collar)|western|work ?shirt|overshirt|chore|lace.?up|heel ?tab|\bcap\b|seersucker|gingham|plaid|fair ?isle|\btee\b|t.?shirt|\bshorts\b)/,
  /* smart enough for an office, without needing to be eveningwear */
  smart:/(blazer|\bsuit\b|sport ?coat|dress shirt|oxford|poplin|button.?down|buttondown|tailored|trouser|slack|pleated|merino|cashmere|\bwool\b|cardigan|turtleneck|sweater|loafer|derby|chelsea|monk strap|blouse|sheath|shirt ?dress|pencil|\bchino\b)/,
  /* vetoes WORK. Deliberately shorter than notDressy: an oxford shirt and a
     pair of chinos belong here, a hoodie and gym shorts do not. */
  notSmart:/(hood(ie|ed)|sweat ?(shirt|pant|short)|jogger|track ?(suit|pant|top)|\bgym\b|athletic|workout|training|legging|yoga|sports? ?bra|rash ?guard|graphic|band tee|tank|muscle|cargo|swim|bikini|trunk|board ?short|beanie|trucker|bucket|distressed|ripped|\btee\b|t.?shirt|hawaii|aloha|tropical|sneaker|trainer|heel ?tab|\bcap\b|denim|\bjean|\bshorts?\b(?! ?sleeve))/,
  /* gym and sport */
  active:/(\bgym\b|athletic|training|workout|running|\brun\b|jog|track|legging|yoga|pilates|sports? ?bra|performance|moisture|quick.?dry|dri.?fit|wicking|compression|base ?layer|rash ?guard|\bactive|\bcourt\b|tennis|golf|hik(e|ing)|trail|cycling|\bbike|sweat ?(pant|short)|jogger)/,
  /* vetoes ACTIVE — nobody trains in silk or corduroy */
  notActive:/(silk|satin|velvet|\blace\b|blazer|\bsuit\b|gown|dress shirt|denim|\bjean|linen|corduroy|\bcord\b|cashmere|oxford|poplin|loafer|\bheel|tweed|flannel|swim|bikini|trunk|one.?piece|py?jama|pajama|terry|\bpolo\b)/,
  /* sun, sand, holiday */
  beach:/(swim|bikini|trunk|board ?short|one.?piece|coverup|cover.up|kaftan|caftan|sarong|pareo|sandal|flip.?flop|\bslide\b|espadrille|\bstraw\b|raffia|resort|vacation|tropical|\bpalm\b|hawaii|aloha|camp ?(shirt|collar)|cabana|seersucker|sundress|\bbeach)/,
  /* vetoes BEACH — too warm or too heavy to be holiday wear */
  cold:/(puffer|parka|\bdown\b|\bwool\b|cashmere|merino|fleece|shearling|corduroy|flannel|\bboots?\b|coat\b|quilted|insulated|thermal|tweed|leather jacket)/,
  /* vetoes DAY TO DAY — you do not wear these to the shops */
  notDaily:/(swim|bikini|trunk|board ?short|one.?piece|gown|tuxedo|\btux\b|cocktail|black ?tie|sports? ?bra|rash ?guard)/
};
/* There is deliberately no category veto here any more. Vetoing cat==='tee' and
   cat==='short' from cocktail looked sensible and cost real pieces: a "Sequin
   Lily Top" is filed `tee` and a "Sequin Mesh High Neck Bodysuit and Shorts
   Co-ord" is filed `short`, and both are unmistakably going-out clothes. `cat`
   is the least reliable field on the row — there is a baseball cap filed under
   `trouser` — so the name vetoes do this job instead, and do it more precisely:
   sequin BIKINIS, sequin SWEATPANTS and sequin JEANS are still all excluded,
   because those words are in the name where the truth is. */
const OCC_LIGHT_CATS =['tee','shirt','short','dress','trouser','shoe','cap','knit'];
function occasionsOf(p){
  const o=new Set(), n=(p.n||"").toLowerCase(), cat=p.cat, ms=p.ms||[], fab=p.fab||[];
  const has=f=>fab.includes(f);
  const dressyFab=has('silk')||has('satin')||has('velvet');
  const dressy=OCC.dressy.test(n)||dressyFab;

  /* going out / cocktail — a dressy reason, surviving the dressy veto. Being a
     dress is NOT a reason: that single line was most of the old false positives. */
  if(dressy && !OCC.notDressy.test(n)) o.add('event');

  /* work / smart */
  if((dressy||OCC.smart.test(n)||has('wool')||has('merino')||has('cashmere')||has('oxford')||has('poplin'))
     && !OCC.notSmart.test(n)) o.add('work');

  /* active / gym — the NAME has to say so. The old rule accepted a micro-style
     on its own, and `surf-sport` / `collegiate-athletic` describe an aesthetic
     rather than a function: between them they cover 2,510 pieces, which is how
     swim trunks, bikini bottoms, pyjama bottoms and plain pocket tees came to
     be filed as gym kit. Nothing about a striped tee says you can train in it. */
  if(OCC.active.test(n) && !OCC.notActive.test(n)) o.add('active');

  /* beach / vacation. Linen counts as a FABRIC on a light garment, not as the
     `linen-resort` LOOK — that micro-style sits on 1,257 pieces including
     metallic knit ponchos and silk evening tops. A linen blazer is tailoring,
     and the old rule shipped all 227 linen rows whatever they turned out to be. */
  if((OCC.beach.test(n) || (has('linen') && OCC_LIGHT_CATS.indexOf(cat)>=0))
     && !OCC.cold.test(n)) o.add('beach');

  /* day to day — deliberately broad, it is the "just show me clothes" option */
  if(!OCC.notDaily.test(n)) o.add('daily');

  if(!o.size)o.add('daily');
  return [...o];
}
CATALOG.forEach(p=>{p.fit=fitOf(p);p.occ=occasionsOf(p);});
const FITcnt=_count('fit');   /* has to come after the line above — `fit` does not exist before it */

/* ---------- inverse-frequency for colour, pattern and fit ----------
   `ms`, `fab` and `brand` were already IDF-weighted; colour, pattern and fit
   were not, and that asymmetry had a direction. The catalogue is 52% neutral,
   79% solid and 91% "regular" fit, so those three values sit on most of what
   anybody swipes and their weights grew fastest for every user alike. The trait
   block carries the heaviest multiplier in profileScore, so the profile drifted
   toward a generic neutral / solid / regular attractor that came out much the
   same whoever built it — the exact opposite of a personal result.

   The IDF is divided by its catalogue-wide mean, so the change is magnitude
   neutral: an average piece contributes what it always did and only the BALANCE
   between common and rare values moves. Measured on this catalogue — colour
   spans 0.68x (neutral) to 1.76x (green), pattern 0.69x (solid) to 2.70x
   (plaid), fit 0.76x ("regular") to 5.47x (tapered, on 9 pieces). Skip the
   division and these become the raw IDF instead, 1.1x to 7.9x, every one of them
   an increase — which would silently re-tune the profile-vs-kNN blend as a side
   effect of a change meant to be about weighting alone. */
function meanIdf(key,cnt){
  let s=0,n=0;
  CATALOG.forEach(p=>{const v=p[key];(Array.isArray(v)?v:[v]).forEach(x=>{if(x!=null){s+=idf(x,cnt);n++;}});});
  return n?s/n:1;
}
const COL_MI=meanIdf('color',COLcnt), PAT_MI=meanIdf('pat',PATcnt), FIT_MI=meanIdf('fit',FITcnt);
function idfCol(x){return idf(x,COLcnt)/COL_MI;}
function idfPat(x){return idf(x,PATcnt)/PAT_MI;}
function idfFit(x){return idf(x,FITcnt)/FIT_MI;}

/* ---------- garment groups ----------
   Which bucket a piece falls in for the conditional model further down. This
   reuses the six groups the "Show me" filter already offers (GROUP_CATS, in
   30-settings.js) rather than the raw `cat`: six buckets stay dense enough to
   learn something from a forty-swipe session where twelve would not, and `cat`
   is the least reliable field on the row anyway. */
const CAT_GROUP={};
for(const _g in GROUP_CATS) GROUP_CATS[_g].forEach(c=>CAT_GROUP[c]=_g);
const GROUPN={tops:"Tops",bottoms:"Bottoms",dresses:"Dresses",outerwear:"Outerwear",
              shoes:"Shoes",accessories:"Accessories",other:"Other"};
function groupOf(p){return CAT_GROUP[p.cat]||'other';}
/* What share of a group's pieces carry each key, per field. This is what lets
   traitW talk about the LEVEL of a group's weights — the score a typical shoe
   picks up simply for being a shoe — separately from which shoes score above the
   rest. Multi-valued fields (ms, fab) can sum past 1 per group, which is correct:
   profileScore sums over every tag a piece carries, so the level must too. */
const GRP_SHARE=(function(){
  const out={}, size={};
  CATALOG.forEach(p=>{
    const g=groupOf(p), o=out[g]||(out[g]=newBag());
    size[g]=(size[g]||0)+1;
    p.ms.forEach(m=>o.ms[m]=(o.ms[m]||0)+1);
    o.color[p.color]=(o.color[p.color]||0)+1;
    o.pat[p.pat]=(o.pat[p.pat]||0)+1;
    (p.fab||[]).forEach(f=>o.fab[f]=(o.fab[f]||0)+1);
    o.fit[p.fit]=(o.fit[p.fit]||0)+1;
  });
  for(const g in out) for(const k in out[g]) for(const x in out[g][k]) out[g][k][x]/=size[g];
  return out;
})();
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

/* ---------- the weight bags ----------
   Two levels now. `W.ms/color/pat/fab/fit/brand` is the whole-wardrobe profile,
   exactly as before. `W.grp[<group>]` holds the same counters kept SEPARATELY
   for tops, bottoms, dresses, outerwear, shoes and accessories, and `W.n[group]`
   records how much evidence each group has collected.

   Why: taste in clothes is conditional on the garment. Loving an oversized cable
   knit says "oversized" about your JUMPERS, and a flat model applied it to your
   trousers; loving cream boots pushed cream tees, cream shorts and cream
   everything. One shared bag of colour / pattern / fit weights cannot express
   "dark on top, neutral on the bottom", which is how a great many people
   actually dress — it sees "likes dark AND likes neutral" and learns nothing.

   `cat` and `brand` stay global on purpose. `cat` IS the thing being conditioned
   on, and brand affinity genuinely travels across garments — you like the label
   — while per-group brand counts would be far too thin to learn from. */
function newBag(){return {ms:{},color:{},pat:{},fab:{},fit:{}};}
function newModel(){return {ms:{},color:{},pat:{},cat:{},fab:{},fit:{},brand:{},grp:{},n:{}};}
/* every write THROUGH HERE goes to the global bag and to the piece's group bag at
   once, so the two cannot drift apart. The only writes that skip it are the ones
   with no garment to attribute — warm-up seeds and inspiration, both global by
   nature — which is why traitW treats the group bags as an estimate to be
   shrunk toward the global one rather than a partition of it. */
function bumpW(W,p,kind,key,v){
  W[kind][key]=(W[kind][key]||0)+v;
  const g=groupOf(p), G=W.grp[g]||(W.grp[g]=newBag());
  G[kind][key]=(G[kind][key]||0)+v;
}
function addTo(W,p,w){
  W.n[groupOf(p)]=(W.n[groupOf(p)]||0)+Math.abs(w);
  p.ms.forEach(m=>bumpW(W,p,'ms',m,w*idf(m,MScnt)));
  bumpW(W,p,'color',p.color,w*idfCol(p.color));
  bumpW(W,p,'pat',p.pat,w*idfPat(p.pat));
  (p.fab||[]).forEach(f=>bumpW(W,p,'fab',f,w*idf(f,FABcnt)));
  bumpW(W,p,'fit',p.fit,w*idfFit(p.fit));
  W.cat[p.cat]=(W.cat[p.cat]||0)+w;                        // global: this is the condition itself
  W.brand[p.b]=(W.brand[p.b]||0)+w*0.6*idf(p.b,BRcnt);     // global: brand taste crosses garments
}
/* ---------- how much evidence is in the model ----------
   The L1 size of the weight vector, i.e. the total weight ever poured in from
   every source — swipes, cart, per-card tags, warm-up answers, inspiration.
   profileScore is a sum over these weights so it grows in step with this;
   knnScore does not grow at all, being the average of the top-3 similarities to
   your favourites however long you swipe. See PROF_REF for what that costs. */
function modelMass(W){
  let s=0;
  ['ms','color','pat','fab','fit','brand'].forEach(k=>{const o=W[k];for(const x in o)s+=Math.abs(o[x]);});
  return s;
}
/* finish a model: the two totals everything downstream reads off it. nTot is the
   evidence across all groups, which traitW needs to put a group bag back on the
   global bag's scale; mass is what profileScore divides by. Both are derived, so
   any code path that adds weight after this has to call it again. */
function sealModel(W){
  W.nTot=0; for(const g in W.n) W.nTot+=W.n[g];
  W.mass=modelMass(W);
  W.lev={};                     // traitLevels caches off nTot and the bags: both just moved
  return W;
}

function buildModel(){
  /* Refreshed once per build rather than cached against S.reactions: reactW's
     only caller is the loop below, so once per build is equivalent, and it
     removes a real staleness hazard — undoLast() deletes a reaction key and
     react() re-adds one, so an undo-then-reswipe hands back an object with the
     same identity AND the same key count, which any such cache would miss. */
  REACT_L=likeRate();
  const W=newModel();
  const add=(p,w)=>addTo(W,p,w);
  const hist=S.hist||[]; const pos={}; hist.forEach((pi,k)=>pos[pi]=k); const nH=Math.max(1,hist.length);
  for(const pi in S.reactions){
    const r=S.reactions[pi];
    const k=(pos[pi]!==undefined?pos[pi]:nH-1);
    const rec=nH>1?(0.75+0.65*(k/(nH-1))):1;              // recent swipes weigh more (taste adapts)
    const p=CATALOG[pi],w=reactW(r)*rec; add(p,w);
    if(r==="love"){                                        // super-like locks in this lane harder
      W.brand[p.b]=(W.brand[p.b]||0)+idf(p.b,BRcnt);
      bumpW(W,p,'ms',p.ms[0],1.2*idf(p.ms[0],MScnt));
    }
    /* per-card "what I like" answers. These are statements about THIS garment, so
       they land in its group bag as well as the global one — "the fit/cut" on a
       pair of wide-leg trousers is not a claim about your shirts. Colour, pattern
       and fit pick up the same IDF the rest of the model now uses. */
    (S.tags[pi]||[]).forEach(t=>{const a=Math.abs(w)*0.8;
      if(t==="the color")bumpW(W,p,'color',p.color,a*idfCol(p.color));
      if(t==="the pattern")bumpW(W,p,'pat',p.pat,a*idfPat(p.pat));
      if(t==="the fabric")(p.fab||[]).forEach(f=>bumpW(W,p,'fab',f,a*idf(f,FABcnt)));
      if(t==="the fit/cut")bumpW(W,p,'fit',p.fit,a*idfFit(p.fit));
      if(t==="the brand")W.brand[p.b]=(W.brand[p.b]||0)+a*idf(p.b,BRcnt);});
  }
  (S.picks||[]).forEach(i=>add(CATALOG[i],2.5));        // cart items = strong intent
  (S.likes||[]).forEach(i=>add(CATALOG[i],1.6));        // liked cart = solid intent
  /* Warm-up answers and inspiration are global only, and deliberately so: a
     micro-style chip and a Pinterest board say what you like, not what garment
     you like it ON, so there is no group to attribute them to. Shrinkage below
     means they still reach every group until that group has evidence of its own. */
  S.seeds.forEach(m=>W.ms[m]=(W.ms[m]||0)+2*idf(m,MScnt));
  // inspiration (Pinterest board / photos): leads the feed while you calibrate, then fades to a
  // residual so the pieces YOU swiped drive the direction after the first ~20.
  const insp=S.inspo;
  if(insp){
    const nSw=Object.keys(S.reactions).length;
    const decay=Math.max(0,1-nSw/20);                 // 1.0 at 0 swipes -> 0 by swipe 20
    const strength=2.4*decay+0.35;                    // strong early, small residual after 20
    const cTot=Object.values(insp.colors||{}).reduce((a,b)=>a+b,0)||1;
    for(const c in (insp.colors||{})) W.color[c]=(W.color[c]||0)+strength*1.3*(insp.colors[c]/cTot)*3*idfCol(c);
    const sTot=Object.values(insp.styles||{}).reduce((a,b)=>a+b,0)||1;
    for(const m in (insp.styles||{})) W.ms[m]=(W.ms[m]||0)+strength*(insp.styles[m]/sTot)*3*idf(m,MScnt);
  }
  MODEL=sealModel(W);
}
function positiveCats(){return Object.keys(MODEL.cat).filter(c=>MODEL.cat[c]>0);}
function topKeys(o,n,pos){return Object.keys(o).filter(k=>pos?o[k]>0:true).sort((a,b)=>o[b]-o[a]).slice(0,n);}

/* ---------- reading a weight back out ----------
   Group-local when that group has evidence behind it, global when it does not,
   sliding between the two: lam = n/(n+COND_SHRINK).

   The rescaling by nTot/n is not a detail, it is the whole thing. A group bag is
   a sum over that group's swipes, so it is smaller than the global bag by
   roughly the group's share of the deck — tops take about 57% of this catalogue,
   shoes about 5%. Blend the raw numbers and a shoe can never out-score a shirt,
   whatever the shopper thinks of either, because its weights were summed over a
   tenth as much evidence. Omitting it cost 0.116 AUC on the "Neutral minimalist"
   persona when this was first written at COND_SHRINK=8 — not noise, a systematic
   bias toward whichever garment the deck happens to serve most. (The cost shrinks
   as COND_SHRINK rises, because a larger k leans on the global bag anyway; that
   is a reason to fix the scale, not a reason to hide behind the constant.)

   Multiplying by nTot/n puts both estimates in the same units — weight per unit
   of evidence — so the blend compares like with like. It also gives the change a
   property worth having: for a shopper whose taste really is uniform, the
   rescaled group estimate ≈ the global one, so conditioning quietly costs
   nothing. It only bites when a group genuinely disagrees with the whole.

   Shrinkage alone does NOT then handle the other end, which is the trap here and
   is worth spelling out because the obvious form of this function is wrong.
   Write it as lam*loc + (1-lam)*glob with lam = n/(n+k) and loc = G*(nTot/n) and
   the n cancels: the multiplier landing on the raw group bag is nTot/(n+k), which
   does not fall away for a thin group at all. Measured on this catalogue at 1280
   swipes it was 1.5x for tops and 10.2x for shoes — so every shoe in the
   catalogue got a bulk score rise over every shirt, for no reason but the deck
   serving fewer shoes. The results grid collapsed onto whichever group was
   thinnest: 16 shoes / 11 accessories / 7 tops / 0 bottoms out of 36, for a
   shopper who liked half the bottoms they were shown. Held-out AUC barely
   noticed (within-group AUC was unchanged to three decimals) because a pooled
   ranking metric is nearly blind to a group-level offset — which is exactly why
   this survived the COND_SHRINK sweep below and had to be caught by looking at
   what the grid actually contained.

   So the local estimate is also LEVEL-MATCHED: subtract its own catalogue-weighted
   mean and add back the global one (traitLevels). Conditioning may now reorder
   pieces WITHIN a garment group, and cannot shift the group's average score at
   all — which is right, because the group's overall standing is what W.cat and
   POSCATS already carry, and it is precisely the part of a thin group's estimate
   that is noise.

   (Seeds and inspiration write to the global bag only, so the group bags do not
   quite sum to it while inspiration is still live. It decays out by swipe 20 and
   the resulting tilt is small; it is the reason lam is capped by evidence rather
   than trusted outright.) */
/* ---------- choosing COND_SHRINK ----------
   150 is roughly 79 swipes' worth of weight, so conditioning arrives as a tilt
   over a session rather than firing off a handful of cards: at 40 swipes the
   biggest group sits at lam≈0.23, at 160 swipes ≈0.55, at 1280 ≈0.91.

   The tension is real — a shopper whose taste is genuinely uniform wants
   k=infinity, one whose taste is entirely per-garment wants k=0 — but with the
   level-matching above in place it is no longer an expensive one. Swept at 14
   seeds, AUC, "flat" = conditioning off:

     session   who        flat   k=25   k=60  k=150  k=400  k=1000
        160    uniform   0.737  0.724  0.734  0.738  0.738   0.739
        160    split     0.665  0.743  0.735  0.722  0.700   0.684
        400    uniform   0.750  0.742  0.749  0.752  0.753   0.751
        400    split     0.657  0.741  0.734  0.722  0.704   0.683
       1280    uniform   0.771  0.754  0.759  0.764  0.768   0.770
       1280    split     0.676  0.771  0.773  0.772  0.761   0.737

   At 160 and 400 swipes k=150 costs the uniform shoppers nothing at all
   (0.738 vs 0.737 flat, 0.752 vs 0.750) while the conditional one gains 0.057
   and 0.065. Only at 1280 — thirty times a real first session — does it cost
   anything, and then 0.007. Smaller k buys the conditional shopper more but
   starts charging the uniform ones for it; larger k makes conditioning nearly
   inert at the length people actually swipe (lam≈0.10 at 40 cards). Pick for the
   operating point, not for the measuring protocol.

   Note this whole table shifted once traitW was level-matched: before that fix
   the same sweep showed the uniform shoppers paying 0.013-0.014 at every length,
   and it was that cost — not the conditioning idea — that the constant was being
   asked to buy off. */
let COND_SHRINK=150;       /* eval hook: assignable, so the sweep above is repeatable */
let COND_ON=true;          /* eval hook: false falls back to the flat global bag */
/* The two levels traitW corrects by: what a typical piece of this group scores
   under the group's own (rescaled) weights, and what it scores under the global
   ones. Cached per model — neither depends on COND_SHRINK, so a sweep over k can
   reuse one built model, which is what makes the ablation rows in the eval
   harness an honest comparison. sealModel clears the cache. */
function traitLevels(W,g,kind){
  const c=W.lev||(W.lev={}), ck=g+'|'+kind;
  let L=c[ck];
  if(!L){
    const G=W.grp[g], sh=(GRP_SHARE[g]||{})[kind]||{}, f=W.nTot/W.n[g];
    let loc=0, glob=0;
    for(const x in sh){ const s=sh[x]; loc+=s*(G[kind][x]||0)*f; glob+=s*(W[kind][x]||0); }
    L=c[ck]={loc:loc,glob:glob};
  }
  return L;
}
function traitW(W,g,kind,key){
  const glob=W[kind][key]||0;
  if(!COND_ON||!W.grp) return glob;
  const G=W.grp[g]; if(!G) return glob;
  const n=(W.n&&W.n[g])||0, nT=W.nTot;
  /* no evidence, or a model that never went through sealModel: fall back to the
     flat global weight. Falling back to the RAW group weight instead would be
     the scale bug above, silently — better to behave like the old model. */
  if(n<=0||!nT) return glob;
  const L=traitLevels(W,g,kind), lam=n/(n+COND_SHRINK);
  const loc=(G[kind][key]||0)*(nT/n)-L.loc+L.glob;   // group's scale, global's level
  return lam*loc+(1-lam)*glob;
}

/* ---------- keeping the two halves of `hybrid` in proportion ----------
   profileScore is a SUM over the model's weights, so it grows without bound as
   you swipe. knnScore is an AVERAGE of the top-3 similarities to your favourites,
   so it does not grow at all. Blend them raw and the profile quietly swallows
   the whole score: under test/04-eval-harness.js's protocol (12 seeds x 1280
   swipes, so ~960 training swipes) the pre-change build returned `current` and
   `profile-only` within 0.001 of each other on all three personas of the day
   — 0.840/0.841, 0.738/0.738, 0.737/0.736. The nearest-neighbour half had
   stopped contributing, and with it the Safe / Balanced / Adventurous dial,
   whose only real lever is wk (1.5 / 1.0 / 0.5). The in-app panel runs shorter
   320-swipe sessions, where the same drift is milder but present.

   Dividing by the model's own mass makes the profile term scale-free, so the
   ratio the ADVP weights ask for is the ratio you get at swipe 10 and at swipe
   500. PROF_REF then restores the absolute scale at the app's normal operating
   point — 40 swipes, the same number the deck's progress bar fills to — which
   makes this a deliberate no-op for a typical first session and a correction
   only where the blend had actually drifted.

   894 is the median mass of a 40-swipe model over 32 synthetic sessions spanning
   all four harness personas (688-1272 across them, so the reference sits inside
   the spread rather than on one persona's shoulder). Re-run
   `node tools/measure-prof-ref.mjs` after a catalogue change big enough to move
   the IDF values, and paste the number it prints back here. */
const PROF_REF=894;
let PROF_SCALE=true;       /* eval hook: false restores the un-normalised blend */
/* content score of a candidate against a taste model */
function profileScore(p,W){
  const g=groupOf(p);
  let ms=0;p.ms.forEach(m=>ms+=traitW(W,g,'ms',m));
  let fab=0;(p.fab||[]).forEach(f=>fab+=traitW(W,g,'fab',f));
  const traits=traitW(W,g,'color',p.color)*1.1+traitW(W,g,'pat',p.pat)*1.0
              +fab*0.9+traitW(W,g,'fit',p.fit)*0.7;
  const raw=ms*1.3+traits*1.5+(W.brand[p.b]||0)*0.6;
  if(!PROF_SCALE) return raw;
  if(W.mass==null) W.mass=modelMass(W);
  return raw*(PROF_REF/Math.max(1,W.mass));
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

/* the throwaway model behind "find more like my picks" — same machinery as the
   real one so it gets the conditioning, the IDF and the mass for free */
function modelFromSeeds(seedIdx){
  const W=newModel();
  seedIdx.forEach(i=>addTo(W,CATALOG[i],2));
  return sealModel(W);
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
/* explain why a piece was recommended. Reads through traitW, the same door the
   score came out of, so the reason quoted on the card is the reason it ranked —
   a global lookup here would now cite weights the ranking never used. */
function whyMatch(i){
  const p=CATALOG[i],W=MODEL;if(!W)return"";
  const g=groupOf(p),bits=[];
  const tw=(kind,key)=>traitW(W,g,kind,key);
  const bestMs=p.ms.slice().sort((a,b)=>tw('ms',b)-tw('ms',a))[0];
  if(bestMs&&tw('ms',bestMs)>0)bits.push(MS[bestMs]);
  if(tw('color',p.color)>0)bits.push(COLORN[p.color]||p.color);
  else if(tw('fit',p.fit)>0&&p.fit!=="regular")bits.push(p.fit+" fit");
  if(bits.length<2){let bf=null,bv=0;(p.fab||[]).forEach(f=>{const v=tw('fab',f);if(v>bv){bv=v;bf=f;}});if(bf)bits.push(bf);}
  return bits.length?("Matches your "+bits.slice(0,2).join(" + ")):"";
}
/* ---------- the garment-by-garment read-out ----------
   The payoff of the conditional model, said out loud on the results page:
   "Tops — dark, oversized · Bottoms — neutral" is a far more convincing thing to
   show someone than one averaged line that claims you like both. Only groups
   with real evidence behind them get a row; the rest would just be the global
   profile repeated back under six headings. */
/* How much evidence a group needs before the read-out will say anything about
   it. Deliberately NOT COND_SHRINK: that is the half-weight of a ranking blend,
   currently 150 — about 79 swipes into ONE group — and using it here meant no
   group ever qualified and the "By garment" line silently never rendered.

   6 is a little over three swipes, which sounds thin until you look at what the
   deck deals: tops are 57% of the catalogue, so a real 44-swipe session came out
   33 tops / 4 bottoms / 4 accessories / 3 outerwear. Every group except tops is
   thin in a first session and always will be. A floor of 8 kept bottoms out at
   n=7.2 even though the model had cleanly learned them (neutral +2.05 against
   dark -5.07) — i.e. it hid the exact split the line exists to show.

   Being a little generous is defensible here because of what the panel claims:
   its heading is "What your swipes told us", so this reports the swipes, not a
   confident forecast. The ranking is far more cautious with the same evidence —
   at n=7 the blend is still ~95% the global profile. */
const GROUP_SAY_MIN=6;
function groupTaste(minN){
  const W=MODEL; if(!W||!W.grp) return [];
  const floor=(minN==null?GROUP_SAY_MIN:minN);
  return Object.keys(W.grp)
    .filter(g=>(W.n[g]||0)>=floor)
    .sort((a,b)=>(W.n[b]||0)-(W.n[a]||0))
    .map(g=>{
      const B=W.grp[g],bits=[];
      const col=topKeys(B.color,1,true)[0], pat=topKeys(B.pat,1,true)[0], fit=topKeys(B.fit,1,true)[0];
      if(col)bits.push(COLORN[col]||col);
      if(pat&&pat!=="solid")bits.push(PATN[pat]||pat);
      if(fit&&fit!=="regular")bits.push(FITN[fit]||fit);
      return bits.length?{group:g,label:GROUPN[g]||g,text:bits.join(", ")}:null;
    }).filter(Boolean);
}
