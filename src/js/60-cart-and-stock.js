/* ---------- shortlist ---------- */
function togglePick(i){
  const k=S.picks.indexOf(i);if(k>=0)S.picks.splice(k,1);else S.picks.push(i);
  document.querySelectorAll('#s_'+i).forEach(el=>{el.classList.toggle("picked",S.picks.includes(i));el.querySelector(".selbox").textContent=S.picks.includes(i)?"✓":"";});
  save();updateShortlistBar();updateCartFab();
  const ov=document.getElementById("cartOverlay");if(ov&&!ov.classList.contains("hidden"))renderCart();
}
function updateShortlistBar(){const el=document.getElementById("slCount");if(el)el.textContent=`Cart: ${(S.picks||[]).length}`;}
/* ---------- two carts: 'cart' (super-likes + added) and 'likes' (right swipes) ---------- */
let CART_VIEW='cart';
function cartArr(which){return (which==='likes'?(S.likes=S.likes||[]):(S.picks=S.picks||[]));}
function updateCartFab(){
  const c=document.getElementById("cartFabN");if(c)c.textContent=(S.picks||[]).length;
  const l=document.getElementById("likeFabN");if(l)l.textContent=(S.likes||[]).length;
  const bar=document.getElementById("slCount");if(bar)bar.textContent="Cart: "+(S.picks||[]).length;
}
function openCart(which){CART_VIEW=which||'cart';renderCart();document.getElementById("cartOverlay").classList.remove("hidden");checkCartStock(cartArr(CART_VIEW).slice());}
function closeCart(){document.getElementById("cartOverlay").classList.add("hidden");}
function removeFromCart(i){const arr=cartArr(CART_VIEW);const k=arr.indexOf(i);if(k>=0)arr.splice(k,1);save();updateCartFab();renderCart();const el=document.getElementById('s_'+i);if(el){el.classList.remove("picked");const b=el.querySelector(".selbox");if(b)b.textContent="";}}
function clearCart(){cartArr(CART_VIEW).length=0;save();updateCartFab();renderCart();if(CART_VIEW==='cart')document.querySelectorAll('.sug.picked').forEach(e=>{e.classList.remove('picked');const b=e.querySelector('.selbox');if(b)b.textContent='';});}
const HEART_SVG='<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" style="vertical-align:-1px"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';
/* ---- live sold-out check (best-effort via a CORS helper; local files can't hit the store directly) ---- */
const STOCK={};
function stockLabel(i){const s=STOCK[i];
  if(s==='out')return '<span class="ci-sold">Sold out</span>';
  if(s==='in')return '<span class="ci-instock">In stock</span>';
  if(s==='err')return '<span class="ci-checking" style="cursor:pointer" title="tap to retry" onclick="recheckStock('+i+')">couldn\'t check ↻</span>';
  return '<span class="ci-checking">checking…</span>';}
function patchStockBadge(i){const el=document.getElementById('cst_'+i);if(el)el.innerHTML=stockLabel(i);const row=document.getElementById('ci_'+i);if(row)row.classList.toggle('sold',STOCK[i]==='out');}
async function fetchStock(url){
  const jsUrl=url.replace(/[?#].*$/,'')+'.js';
  const proxies=[u=>'https://api.allorigins.win/raw?url='+encodeURIComponent(u),u=>'https://corsproxy.io/?url='+encodeURIComponent(u)];
  for(const mk of proxies){
    try{const r=await fetch(mk(jsUrl));if(r&&r.ok){const t=await r.text();
      try{const d=JSON.parse(t);
        if(typeof d.available==='boolean')return d.available?'in':'out';
        if(Array.isArray(d.variants))return d.variants.some(v=>v.available)?'in':'out';
      }catch(_){}}
    }catch(_){}
  }
  return 'err';
}
async function checkCartStock(items){
  const pending=items.filter(i=>STOCK[i]!=='in'&&STOCK[i]!=='out');
  pending.forEach(i=>{STOCK[i]='checking';patchStockBadge(i);});
  let idx=0; const CONC=4;
  const worker=async()=>{ while(idx<pending.length){ const i=pending[idx++]; STOCK[i]=await fetchStock(CATALOG[i].u); patchStockBadge(i); } };
  await Promise.all(Array.from({length:Math.min(CONC,pending.length)},worker));
}
function recheckStock(i){STOCK[i]='checking';patchStockBadge(i);fetchStock(CATALOG[i].u).then(r=>{STOCK[i]=r;patchStockBadge(i);});}
function renderCart(){
  const which=CART_VIEW, isLikes=which==='likes';
  // in the cart, super-likes (loved) sort first
  const items=[...cartArr(which)].sort((a,b)=>(S.reactions[b]==='love'?1:0)-(S.reactions[a]==='love'?1:0));
  const total=items.reduce((s,i)=>s+(CATALOG[i].usd||0),0);
  const supers=items.filter(i=>S.reactions[i]==='love').length;
  const title=isLikes?'Liked items':'Cart';
  const body=items.length? items.map(i=>{const p=CATALOG[i];const price=p.cur==="$"?`$${p.p}`:`${p.cur}${p.p} (≈$${p.usd})`;
    const loved=!isLikes&&S.reactions[i]==='love';
    return `<div class="cart-item ${loved?'is-super':''} ${STOCK[i]==='out'?'sold':''}" id="ci_${i}"><img src="${pImg(p.img,160)}" referrerpolicy="no-referrer" alt="" onerror="this.style.visibility='hidden'">
      <div style="flex:1"><div class="ci-b">${p.b}</div>
      <div class="ci-n">${p.n}${loved?` <span class="ci-super" title="Super liked">${HEART_SVG} SUPER</span>`:''} <span class="ci-stock" id="cst_${i}">${stockLabel(i)}</span></div>
      <div class="ci-p">${price} · <a href="${p.u}" target="_blank" rel="noopener">Shop &rarr;</a></div></div>
      <button class="ci-rm" title="Remove" onclick="removeFromCart(${i})">×</button></div>`;}).join("")
    : (isLikes
        ? '<p class="section-note">No liked items yet. Swipe right (like) on pieces and they land here.</p>'
        : '<p class="section-note">Cart is empty. Super-like (up / red heart) a piece, or tap the cart button on a card, and it lands here.</p>');
  document.getElementById("cartOverlay").innerHTML=`<div class="cart-panel">
    <button class="cart-x" onclick="closeCart()" title="Close">×</button>
    <div style="display:flex;gap:8px;margin-bottom:4px">
      <button class="btn ${which==='cart'?'small':'ghost small'}" onclick="openCart('cart')">🛒 Cart (${(S.picks||[]).length})</button>
      <button class="btn ${which==='likes'?'small':'ghost small'}" onclick="openCart('likes')">💚 Liked (${(S.likes||[]).length})</button>
    </div>
    <h3 class="section-title" style="border:none;padding:0">${title} (${items.length})${(!isLikes&&supers)?` · <span style="color:var(--red);font-size:14px;font-weight:700">${supers} super</span>`:''}</h3>
    <div style="margin-top:12px;max-height:50vh;overflow:auto">${body}</div>
    ${items.length?`<p style="text-align:right;font-weight:700;color:var(--green-2);margin-top:10px">Approx total: $${total}</p>`:""}
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn small" onclick="closeCart()">Keep going</button>
      ${items.length?`<button class="btn ghost small" onclick="copyCart()">Copy</button>
        <button class="btn ghost small" onclick="checkCartStock(cartArr(CART_VIEW).slice())">↻ Re-check stock</button>
        <button class="btn ghost small" onclick="clearCart()">Clear</button>`:""}
    </div></div>`;
}
function copyCart(){
  const arr=cartArr(CART_VIEW);
  if(!arr.length){cnote("This cart is empty.");return;}
  const txt=(CART_VIEW==='likes'?"My liked items:\n":"My cart:\n")+arr.map(i=>{const p=CATALOG[i];const so=STOCK[i]==='out'?' [SOLD OUT]':'';return `• ${p.b} — ${p.n} (${p.cur}${p.p})${so} ${p.u}`;}).join("\n");
  navigator.clipboard.writeText(txt).then(()=>cnote("Copied!"),()=>alert(txt));
}
function copyShortlist(){copyCart();}
function cnote(t){const el=document.getElementById("copyNote");if(el){el.textContent=t;setTimeout(()=>{if(el)el.textContent="";},4000);}}
