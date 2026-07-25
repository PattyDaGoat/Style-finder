/* ---------- settings (gender + sizes) ---------- */
let S_TOP=null, SET_CATS=new Set(), SET_OCC=new Set(), SET_BUDGET=100000;
/* simple "Show me" groups -> the underlying categories they cover */
const GROUP_CATS={tops:['tee','shirt','knit','sweat'],bottoms:['trouser','short'],dresses:['dress'],outerwear:['outer'],shoes:['shoe'],accessories:['cap','acc']};
const SHOW_OPTS_M=[['tops','Tops'],['bottoms','Bottoms'],['outerwear','Outerwear'],['shoes','Shoes'],['accessories','Accessories']];
const OCC_OPTS=[['daily','Day to day'],['work','Work / smart'],['event','Going out / cocktail'],['active','Active / gym'],['beach','Beach / vacation']];
const BUDGET_OPTS=[[50,'Under $50'],[100,'Under $100'],[150,'Under $150'],[200,'Up to $200'],[100000,'No limit ($200+)']];
function catOpts(){const base=SHOW_OPTS_M.slice();if(GENDER==='f')base.splice(2,0,['dresses','Dresses']);return base;}
/* per-section (menswear / womenswear) settings are stored independently */
function defGS(){return {top:null,waist:'',shoe:'',cats:[],occ:[],maxBudget:100000};}
function getGS(g){S.byGender=S.byGender||{};return S.byGender[g]||defGS();}
function saveFormToGender(g){S.byGender=S.byGender||{};const w=document.getElementById('setWaist'),sh=document.getElementById('setShoe');
  S.byGender[g]={top:S_TOP,waist:((w&&w.value)||'').trim(),shoe:((sh&&sh.value)||'').trim(),cats:[...SET_CATS],occ:[...SET_OCC],maxBudget:SET_BUDGET};}
function loadFormFromGender(g){const gs=getGS(g);S_TOP=gs.top||null;SET_CATS=new Set(gs.cats||[]);SET_OCC=new Set(gs.occ||[]);SET_BUDGET=gs.maxBudget||200;
  const w=document.getElementById('setWaist');if(w)w.value=gs.waist||'';const sh=document.getElementById('setShoe');if(sh)sh.value=gs.shoe||'';
  document.querySelectorAll('#topSizes .size-chip').forEach(b=>b.classList.toggle('on',b.textContent===S_TOP));
  renderFilterChips();}
function goStep2(){saveFormToGender(GENDER);renderFilterChips();show('settings2');}
function setGender(g,el){const old=GENDER;if(old&&old!==g)saveFormToGender(old);GENDER=g;document.querySelectorAll('.seg-btn').forEach(b=>b.classList.toggle('on',b.dataset.g===g));loadFormFromGender(g);}
function initSizeChips(){const h=document.getElementById('topSizes');if(h)h.innerHTML=['XS','S','M','L','XL','XXL'].map(s=>`<button class="size-chip" onclick="pickTop('${s}',this)">${s}</button>`).join('');renderFilterChips();}
function pickTop(s,el){S_TOP=s;document.querySelectorAll('#topSizes .size-chip').forEach(b=>b.classList.remove('on'));el.classList.add('on');}
function renderFilterChips(){
  const cc=document.getElementById('setCats');if(cc)cc.innerHTML=catOpts().map(([k,l])=>`<button class="chip ${SET_CATS.has(k)?'on':''}" onclick="toggleSetCat('${k}',this)">${l}</button>`).join('');
  const oc=document.getElementById('setOcc');if(oc)oc.innerHTML=OCC_OPTS.map(([k,l])=>`<button class="chip ${SET_OCC.has(k)?'on':''}" onclick="toggleSetOcc('${k}',this)">${l}</button>`).join('');
  const bc=document.getElementById('setBudget');if(bc)bc.innerHTML=BUDGET_OPTS.map(([v,l])=>`<button class="chip ${SET_BUDGET===v?'on':''}" onclick="pickBudget(${v},this)">${l}</button>`).join('');
  syncCatsAllBtn();
}
function toggleSetCat(k,el){if(SET_CATS.has(k)){SET_CATS.delete(k);el.classList.remove('on');}else{SET_CATS.add(k);el.classList.add('on');}syncCatsAllBtn();}
function toggleAllCats(btn){
  const keys=catOpts().map(o=>o[0]);
  const allOn=keys.every(k=>SET_CATS.has(k));
  if(allOn){SET_CATS.clear();}else{keys.forEach(k=>SET_CATS.add(k));}
  document.querySelectorAll('#setCats .chip').forEach((b,i)=>b.classList.toggle('on',!allOn));
  syncCatsAllBtn();
}
function syncCatsAllBtn(){
  const b=document.getElementById('catsAllBtn'); if(!b)return;
  const keys=catOpts().map(o=>o[0]);
  const allOn=keys.length>0 && keys.every(k=>SET_CATS.has(k));
  b.textContent=allOn?'Clear all':'Select all';
  b.classList.toggle('on',allOn);
}
function toggleSetOcc(k,el){if(SET_OCC.has(k)){SET_OCC.delete(k);el.classList.remove('on');}else{SET_OCC.add(k);el.classList.add('on');}}
function pickBudget(v,el){SET_BUDGET=v;document.querySelectorAll('#setBudget .chip').forEach(b=>b.classList.remove('on'));el.classList.add('on');}
function openSettings(){GENDER=(S.settings&&S.settings.gender)||GENDER||'m';
  document.querySelectorAll('.seg-btn').forEach(b=>b.classList.toggle('on',b.dataset.g===GENDER));
  loadFormFromGender(GENDER);show('settings');}
function filterSig(st){return [st.gender,(st.cats||[]).slice().sort().join(','),(st.occ||[]).slice().sort().join(','),st.maxBudget||200].join('|');}
function startShopping(){const g=GENDER||'m';const prevSig=filterSig(S.settings||{});
  saveFormToGender(g);
  S.settings=Object.assign({gender:g},getGS(g));
  GENDER=g;save();syncGenderToggles();
  if(prevSig===filterSig(S.settings) && S.reactions && Object.keys(S.reactions).length){ show('deck'); renderCard(); }  // only sizes changed — keep progress
  else { startDeck(); }                                                                                                 // filters/section changed — fresh feed
}
function syncGenderToggles(){document.querySelectorAll('.gtoggle').forEach(b=>b.classList.toggle('on',b.dataset.g===GENDER));document.querySelectorAll('.seg-btn').forEach(b=>b.classList.toggle('on',b.dataset.g===GENDER));}
function setDeckGender(g){if(GENDER===g)return;GENDER=g;S.settings=Object.assign({gender:g},getGS(g));save();syncGenderToggles();startDeck();}
