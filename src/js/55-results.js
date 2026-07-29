/* ---------- results ---------- */
let REC=[], REC_CAT='all', REC_N=18, POSCATS=[], SUGGESTED=new Set(), MORE=[], MORE_N=0;
function computeRec(){
  const W=MODEL;const swiped=new Set(Object.keys(S.reactions).map(Number));
  POSCATS=positiveCats();const L=lovedPicks();const a=ADVP[ADV];
  const scored=CATALOG.map((p,i)=>({i,c:p.cat,s:hybrid(p,W,L)}))
    .filter(o=>!swiped.has(o.i)&&genderOK(o.i)&&POSCATS.includes(o.c)&&o.s>0)
    .sort((x,y)=>y.s-x.s).map(o=>o.i);
  REC=diversify(scored,a.perBrand,a.perMs,36);SUGGESTED=new Set(REC);REC_N=18;
}
function buildResults(){
  const W=MODEL;
  const topMs=topKeys(W.ms,4,true);const primary=topMs[0]||"elevated-basics";
  computeRec();
  const maxMs=Math.max(1,...topMs.map(k=>W.ms[k]));
  let html=`<div class="panel dna-hero"><div class="badge gold">Your Style DNA</div>
    <h2>${MS[primary]}${topMs[1]?` &nbsp;+&nbsp; ${MS[topMs[1]]}`:""}</h2>
    <p class="section-note">${MS_BLURB[primary]||""}.${topMs[1]?` With a real streak of <b>${MS[topMs[1]]}</b> — ${MS_BLURB[topMs[1]]}.`:""}</p>
    <div style="margin-top:10px">`;
  topMs.forEach(k=>{const v=Math.max(0,W.ms[k]);html+=`<div class="meter"><div class="ml"><span>${MS[k]}</span><span>${Math.round(v/maxMs*100)}%</span></div><div class="mbar"><div class="mfill" style="width:${Math.round(v/maxMs*100)}%"></div></div></div>`;});
  html+=`</div></div>`;

  html+=`<div class="panel"><h3 class="section-title">What your swipes told us</h3><div style="margin-top:14px">
    <p class="kv"><b>Your micro-styles:</b> ${topKeys(W.ms,5,true).map(m=>MS[m]).join(", ")||"still forming"}.</p>
    <p class="kv"><b>Colors you go for:</b> ${topKeys(W.color,3,true).map(c=>COLORN[c]||c).join(", ")||"open"}.</p>
    <p class="kv"><b>Patterns:</b> ${topKeys(W.pat,3,true).map(c=>PATN[c]||c).join(", ")||"open"}.</p>
    <p class="kv"><b>Fabrics:</b> ${topKeys(W.fab,4,true).join(", ")||"varied"}.</p>
    <p class="kv"><b>Fits you gravitate to:</b> ${topKeys(W.fit,3,true).filter(f=>f!=='regular').map(f=>FITN[f]||f).join(", ")||"regular / classic"}.</p>
    ${(()=>{ /* the conditional model, said out loud — one averaged line above can
                claim you like both dark and neutral; this says which goes where.
                Needs two groups to be worth printing: with one it is only the
                line above restated under a heading. */
      const gt=groupTaste(); if(gt.length<2) return "";
      return `<p class="kv"><b>By garment:</b> ${gt.map(x=>`${x.label} &mdash; ${x.text}`).join(" &nbsp;&middot;&nbsp; ")}.</p>`;})()}
    <p class="kv"><b>Categories you liked:</b> ${POSCATS.map(c=>CATN[c]||c).join(", ")||"a bit of everything"} <span style="color:var(--ink-soft)">(we only recommend these)</span>.</p>
    <p class="kv"><b>Brands that clicked:</b> ${topKeys(W.brand,4,true).join(", ")||"a spread"}.</p>
  </div></div>`;

  html+=`<div class="panel"><h3 class="section-title">New pieces you'd wear</h3>
    <p class="section-note">Brand-new pieces you didn't swipe, blended from your micro-styles <i>and</i> how close they are to your favorites — only in categories you liked. Each says why it matched. Tick pieces you like and hit <b>Refine</b> to teach it more.</p>
    <div style="display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-bottom:6px">
      <span style="font-size:14px;color:var(--ink-soft)">Tuning:</span><div id="advRow" class="filterchips" style="margin:0"></div>
      <button class="btn ghost small" onclick="refineFromPicks()">↻ Refine from my picks</button></div>
    <div id="recFilters" class="filterchips"></div>
    <div id="recGrid" class="grid"></div>
    <div id="recMoreRow" class="center hidden" style="margin-top:16px"><button class="btn ghost small" onclick="recMore()">Show more</button></div>
  </div>`;

  html+=`<div class="panel" id="morePanel"><h3 class="section-title">Find more like the pieces you picked</h3>
    <p class="section-note">Tick pieces above (your 💚 loved ones count automatically), then hit the button — I'll pull new options nearest to <i>those exact pieces</i>.</p>
    <button class="btn" onclick="findMore()">🔎 Find more like my picks</button>
    <span id="moreNote" style="color:var(--green);font-size:14px;margin-left:10px"></span>
    <div id="moreCount" class="section-note" style="margin-top:12px"></div>
    <div id="moreGrid" class="grid"></div>
    <div id="moreMoreRow" class="center hidden" style="margin-top:16px"><button class="btn ghost small" onclick="showMore()">Show more matches</button></div>
  </div>`;

  html+=`<div class="panel"><h3 class="section-title">Your niche brands</h3>
    <p class="section-note">The labels behind your picks — browse their full ranges.</p>
    <div class="storelinks">${brandLinks()}</div>
    <div class="shortlist-bar"><span id="slCount" style="color:var(--ink-soft)">Shortlist: 0</span>
      <span><button class="btn ghost small" onclick="copyShortlist()">Copy shortlist</button>
      <button class="btn ghost small" onclick="downloadDNA()">⬇ Download my Style DNA</button>
      <button class="btn ghost small" onclick="restart()">Start over</button></span></div>
    <span id="copyNote" style="color:var(--green);font-size:14px"></span>
    <div class="foot">Pieces &amp; photos belong to each brand &bull; prices approximate (check the site) &bull; nothing sponsored.</div>
  </div>`;

  document.getElementById("results").innerHTML=html;
  renderAdv();renderRecFilters();renderRecGrid();updateShortlistBar();
}
window.__sugfail=function(i){const el=document.querySelector('#s_'+i+' .sphoto img');if(!el)return;if(!el.dataset.r){el.dataset.r='1';el.referrerPolicy='no-referrer';el.src=CATALOG[i].img;return;}imgFail(el,CATALOG[i]);};

function sugCardHTML(i){
  const p=CATALOG[i],loved=S.reactions[i]==="love",picked=S.picks.includes(i);
  const price=p.cur==="$"?`$${p.p}`:`${p.cur}${p.p} (≈$${p.usd})`;
  const why=whyMatch(i);
  return `<div class="sug ${picked?'picked':''}" id="s_${i}">
    <div class="selbox" onclick="togglePick(${i})">${picked?'✓':''}</div>
    ${loved?'<div class="lovetag">💚 loved</div>':''}
    <div class="sphoto" style="--fpos:50% ${focusPos(p)}"><img src="${pImg(p.img,520)}" alt="${p.n}" referrerpolicy="no-referrer" loading="lazy" onerror="window.__sugfail(${i})"></div>
    <div class="sbody"><div class="sbrand">${p.b}</div><div class="sname">${p.n}</div>
      <div class="sprice">${price}</div>${why?`<div class="swhy">${why}</div>`:""}
      <div class="sms">${p.ms.slice(0,2).map(m=>MS[m]).join(" · ")}</div>
      <div class="sactions"><a class="shopbtn" target="_blank" rel="noopener" href="${p.u}">Shop &rarr;</a></div></div>
  </div>`;
}
function renderAdv(){document.getElementById("advRow").innerHTML=['safe','balanced','adventurous'].map(a=>`<span class="fchip ${a===ADV?'on':''}" onclick="setAdv('${a}')">${ADVP[a].label}</span>`).join("");}
function setAdv(a){ADV=a;computeRec();renderAdv();renderRecFilters();renderRecGrid();}
function refineFromPicks(){buildModel();computeRec();renderRecFilters();renderRecGrid();cnote(S.picks.length?"Refined from your "+S.picks.length+" picked piece"+(S.picks.length===1?"":"s")+".":"Tick pieces first, then Refine.");}
function renderRecFilters(){
  const cats=['all',...POSCATS];
  document.getElementById("recFilters").innerHTML=cats.map(c=>`<span class="fchip ${c===REC_CAT?'on':''}" onclick="setRecCat('${c}')">${c==='all'?'All':(CATN[c]||c)}</span>`).join("");
}
function setRecCat(c){REC_CAT=c;REC_N=18;renderRecFilters();renderRecGrid();}
function recMore(){REC_N+=18;renderRecGrid();}
function renderRecGrid(){
  const list=REC.filter(i=>REC_CAT==='all'||CATALOG[i].cat===REC_CAT);
  document.getElementById("recGrid").innerHTML=list.slice(0,REC_N).map(sugCardHTML).join("")||'<p class="section-note">Swipe Like/Love on a few more pieces to unlock recommendations.</p>';
  document.getElementById("recMoreRow").classList.toggle("hidden",REC_N>=list.length);
}

/* ---------- find more like my picks ---------- */
function seedSet(){const loved=Object.keys(S.reactions).filter(k=>S.reactions[k]==="love").map(Number);return [...new Set([...(S.picks||[]),...(S.likes||[]),...loved])];}
/* profileScore is now normalised to the 40-swipe reference scale (PROF_REF), and
   a seed model built from a handful of picks is far lighter than that — so the
   old 0.8 would have amplified the profile here and turned a feature whose whole
   promise is "nearest to THOSE exact pieces" into a profile-led one. 0.314 is
   0.8 scaled by the measured seed-model mass at 8 picks, i.e. the same blend
   users get today, now stable whether they tick 3 pieces or 30.
   Re-measure with `node tools/measure-prof-ref.mjs`. */
const FINDMORE_WP=0.215;
function findMore(){
  const seeds=seedSet();
  if(!seeds.length){note2("Tick a few pieces above (or Love some while swiping) first.");return;}
  const W=modelFromSeeds(seeds);const seedCats=new Set(seeds.map(i=>CATALOG[i].cat));
  const swiped=new Set(Object.keys(S.reactions).map(Number));const a=ADVP[ADV];
  const scored=CATALOG.map((p,i)=>({i,s:profileScore(p,W)*FINDMORE_WP+knnScore(p,seeds)*2.4}))
    .filter(o=>!swiped.has(o.i)&&genderOK(o.i)&&!seeds.includes(o.i)&&!SUGGESTED.has(o.i)&&seedCats.has(CATALOG[o.i].cat)&&o.s>0)
    .sort((x,y)=>y.s-x.s).map(o=>o.i);
  MORE=diversify(scored,a.perBrand,0,40);MORE_N=8;renderMore();
  note2(`Matched against ${seeds.length} piece${seeds.length===1?'':'s'} you picked.`);
}
function showMore(){MORE_N+=8;renderMore();}
function renderMore(){
  const host=document.getElementById("moreGrid");if(!host)return;
  host.innerHTML=MORE.slice(0,MORE_N).map(sugCardHTML).join("")||'<p class="section-note">No more close matches — pick a couple more pieces above.</p>';
  document.getElementById("moreMoreRow").classList.toggle("hidden",MORE_N>=MORE.length);
  const lbl=document.getElementById("moreCount");if(lbl)lbl.textContent=MORE.length?`Showing ${Math.min(MORE_N,MORE.length)} of ${MORE.length} matches`:"";
}
function note2(t){const el=document.getElementById("moreNote");if(el){el.textContent=t;setTimeout(()=>{if(el)el.textContent="";},4500);}}
