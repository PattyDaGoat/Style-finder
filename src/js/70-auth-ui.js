/* ============================================================================
   SIGN-IN SCREEN
   ========================================================================== */
let GIS_TRIES=0, LF_MODE='signin';

function authNote(t){const el=document.getElementById("authNote");if(el){el.textContent=t||"";}}

function showAuth(){
  renderKnownAccts();
  show("auth");
  initGoogle();
}

/* --- real Google Identity Services --- */
function useLocalMode(msg){
  document.getElementById("gReal").classList.add("hidden");
  document.getElementById("gFallback").classList.remove("hidden");
  if(msg){
    const w=document.getElementById("authWarn");
    if(w)w.innerHTML="<b>Couldn't load Google sign-in.</b><br>"+msg+" The buttons above still work \u2014 they make a <b>profile saved only in this browser</b>, and the rest of the app is unaffected.";
  }
}
function initGoogle(){
  const real=document.getElementById("gReal"), fb=document.getElementById("gFallback"),
        host=document.getElementById("gBtnHost");
  /* No Client ID pasted in yet -> straight to local profiles. */
  if(!GOOGLE_CLIENT_ID){ useLocalMode(); return; }
  /* A Client ID IS set. Show the real block immediately with a status line, so the
     screen is never blank while Google's script loads. */
  real.classList.remove("hidden"); fb.classList.add("hidden");
  if(host.dataset.done!=="1"&&!host.textContent.trim())
    host.innerHTML='<span style="color:var(--ink-soft);font-size:14px">Connecting to Google\u2026</span>';
  if(!(window.google&&window.google.accounts&&window.google.accounts.id)){
    GIS_TRIES++;
    if(GIS_TRIES>12){ useLocalMode("Google's script didn't load \u2014 usually no internet, or a blocker/extension stopping accounts.google.com."); return; }
    setTimeout(initGoogle,300); return;
  }
  if(host.dataset.done==="1")return;
  try{
    host.innerHTML="";
    google.accounts.id.initialize({client_id:GOOGLE_CLIENT_ID,callback:onGoogleCredential,auto_select:false,cancel_on_tap_outside:true});
    google.accounts.id.renderButton(host,{theme:"outline",size:"large",shape:"pill",text:"continue_with",logo_alignment:"left",width:320});
    host.dataset.done="1";
  }catch(e){
    useLocalMode("Google turned down this page's web address \u2014 that's the file:// limitation described in the setup guide.");
  }
}

/* Decode the ID token Google returns. NOTE: this reads the token client-side to
   get your name/email. It does not cryptographically verify it — that needs a
   server. Fine for a personal app on your own machine; see the setup guide. */
function decodeJWT(t){
  const part=t.split(".")[1].replace(/-/g,"+").replace(/_/g,"/");
  const json=decodeURIComponent(atob(part).split("").map(c=>"%"+("00"+c.charCodeAt(0).toString(16)).slice(-2)).join(""));
  return JSON.parse(json);
}
function onGoogleCredential(resp){
  let p;
  try{ p=decodeJWT(resp.credential); }
  catch(e){ authNote("Couldn't read Google's response. Try again, or continue as guest."); return; }
  const acct={id:"g_"+p.sub,name:p.name||p.email||"Google user",email:p.email||"",picture:p.picture||"",kind:"google"};
  upsertAccount(acct);
  if(PENDING_CREATE){ PENDING_CREATE=false; try{localStorage.removeItem(KEY+"::"+acct.id);}catch(e){} }
  activateAccount(acct);
}
let PENDING_CREATE=false;
function googleCreate(){
  PENDING_CREATE=true;
  authNote("");
  if(window.google&&google.accounts&&google.accounts.id&&GOOGLE_CLIENT_ID){
    try{ google.accounts.id.prompt(); }catch(e){}
    const el=document.getElementById("authNote");
    if(el){el.style.color="var(--ink-soft)";el.textContent="Use the Google button above — signing in with a brand-new Google account creates a fresh profile. (An account you've used here before will be reset to empty.)";}
  }
}

/* --- local profiles (used when real Google sign-in isn't configured) --- */
function openLocalForm(mode){
  LF_MODE=mode||"signin";
  document.getElementById("lfTitle").textContent = LF_MODE==="create" ? "Create your profile" : "Your profile";
  const f=document.getElementById("localForm");
  f.classList.remove("hidden");
  authNote("");
  const n=document.getElementById("lfName"); if(n){n.value="";n.focus();}
  const e=document.getElementById("lfEmail"); if(e)e.value="";
}
function closeLocalForm(){document.getElementById("localForm").classList.add("hidden");}
function submitLocalForm(){
  const name=(document.getElementById("lfName").value||"").trim();
  const email=(document.getElementById("lfEmail").value||"").trim();
  if(!name&&!email){ authNote("Add a name (or an email) so the profile has a label."); return; }
  const id="l_"+(email||name).toLowerCase().replace(/[^a-z0-9]+/g,"_");
  const existed=!!findAccount(id);
  const acct={id:id,name:name||email,email:email,picture:"",kind:"local"};
  upsertAccount(acct);
  if(LF_MODE==="create"&&existed){ try{localStorage.removeItem(KEY+"::"+id);}catch(e){} }
  closeLocalForm();
  activateAccount(acct);
}

function signInGuest(){ upsertAccount(GUEST); activateAccount(GUEST); }

function renderKnownAccts(){
  const host=document.getElementById("knownAccts"); if(!host)return;
  const list=accounts().filter(a=>a.id!=="guest");
  if(!list.length){host.innerHTML="";return;}
  host.innerHTML='<div class="kah">Continue as</div>'+list.map(a=>
    `<button class="known-acct" onclick="activateAccount(findAccount('${a.id}'))">
       <span class="ab-avatar">${a.picture?`<img src="${a.picture}" alt="" style="width:100%;height:100%;object-fit:cover">`:initialsOf(a)}</span>
       <span style="min-width:0"><span class="ka-n">${esc(a.name)}</span>${a.email?`<div class="ka-e">${esc(a.email)}</div>`:""}</span>
     </button>`).join("");
}
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}
function initialsOf(a){const s=(a.name||a.email||"?").trim();return esc(s.charAt(0).toUpperCase());}

/* ============================================================================
   ACTIVATE AN ACCOUNT -> load its profile -> route to the right screen
   ========================================================================== */
function activateAccount(acct){
  if(!acct)return;
  ACCOUNT=acct;
  try{localStorage.setItem(LAST_KEY,acct.id);}catch(e){}
  seedFromLegacy();
  bootProfile();
}

function bootProfile(){
  /* fresh in-memory state, then merge in whatever this account has saved */
  S={seeds:[],i:0,order:[],reactions:{},tags:{},picks:[],likes:[],byGender:{}};
  const s=load();
  if(s){ if(Array.isArray(s.picks))S.picks=s.picks; if(Array.isArray(s.likes))S.likes=s.likes; if(s.settings)S.settings=s.settings; if(s.byGender)S.byGender=s.byGender; if(s.inspo)S.inspo=s.inspo; if(s.noFast)S.noFast=s.noFast; }
  S.likes=S.likes||[];
  S.byGender=S.byGender||{};
  // migrate an older single-settings save into the per-section store
  if(S.settings&&S.settings.gender&&!S.byGender[S.settings.gender]){
    S.byGender[S.settings.gender]={top:S.settings.top,waist:S.settings.waist,shoe:S.settings.shoe,cats:S.settings.cats,occ:S.settings.occ,maxBudget:S.settings.maxBudget};
  }
  initSizeChips();
  renderAcctChip();
  if(S.settings&&S.settings.gender){ GENDER=S.settings.gender; startDeck(); }
  else { GENDER='m'; const mb=document.querySelector('.seg-btn[data-g="m"]'); if(mb)mb.classList.add('on'); loadFormFromGender('m'); show('settings'); }
  updateCartFab();
}

/* ============================================================================
   TOP BAR: account chip + menu
   ========================================================================== */
function renderAcctChip(){
  const chip=document.getElementById("acctChip"); if(!chip||!ACCOUNT)return;
  const av=ACCOUNT.picture
    ? `<span class="ab-avatar"><img src="${ACCOUNT.picture}" alt="" style="width:100%;height:100%;object-fit:cover"></span>`
    : `<span class="ab-avatar">${initialsOf(ACCOUNT)}</span>`;
  chip.innerHTML=av+`<span class="ab-name">${esc(ACCOUNT.name||"Guest")}</span>`;
}
function toggleAcctMenu(ev){
  if(ev&&ev.stopPropagation)ev.stopPropagation();
  const m=document.getElementById("acctMenu"); if(!m)return;
  if(!m.classList.contains("hidden")){m.classList.add("hidden");return;}
  const kind=ACCOUNT&&ACCOUNT.kind;
  const who=ACCOUNT?(ACCOUNT.email||ACCOUNT.name):"Guest";
  const label=kind==="google"?"Signed in with Google as":kind==="local"?"Local profile (this browser only):":"Browsing as";
  m.innerHTML=`<div class="amh">${esc(label)}<br><b>${esc(who)}</b></div>
    <button onclick="switchAccount()">Switch account</button>
    ${kind==="guest"?'<button onclick="switchAccount()">Sign in with Google</button>':'<button onclick="signOut()">Sign out</button>'}
    <button class="danger" onclick="closeAcctMenu();askReset()">Start over — clear everything</button>`;
  m.classList.remove("hidden");
}
function closeAcctMenu(){const m=document.getElementById("acctMenu");if(m)m.classList.add("hidden");}
document.addEventListener("click",function(e){
  const m=document.getElementById("acctMenu"), c=document.getElementById("acctChip");
  if(m&&!m.classList.contains("hidden")&&!m.contains(e.target)&&c&&!c.contains(e.target))m.classList.add("hidden");
});
function switchAccount(){ try{localStorage.removeItem(LAST_KEY);}catch(e){} location.reload(); }
function signOut(){ try{localStorage.removeItem(LAST_KEY);}catch(e){} location.reload(); }

/* ============================================================================
   START OVER
   A full reset. Clearing the saved profile then reloading is deliberate: the
   app keeps a lot of live state in memory (queue, model, stock cache, inspo,
   filters). A reload guarantees every one of them is genuinely back to zero,
   with no stale value surviving. The signed-in account is stored separately,
   so you stay signed in.
   ========================================================================== */
function askReset(){
  const who=document.getElementById("resetWho");
  if(who)who.textContent=(ACCOUNT&&ACCOUNT.kind!=="guest")?(ACCOUNT.name||ACCOUNT.email):"this guest session";
  document.getElementById("resetOverlay").classList.remove("hidden");
}
function closeReset(){document.getElementById("resetOverlay").classList.add("hidden");}
function doReset(){
  try{localStorage.removeItem(storeKey());}catch(e){}
  try{sessionStorage.setItem("styleDNA_justReset","1");}catch(e){}
  location.reload();
}
function toast(t,ms){
  const el=document.getElementById("toast"); if(!el)return;
  el.textContent=t; el.classList.remove("hidden");
  clearTimeout(el._t); el._t=setTimeout(()=>el.classList.add("hidden"),ms||3800);
}


/* ============================================================================