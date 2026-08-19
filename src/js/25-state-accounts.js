/* ---------- state ---------- */
let S={seeds:[],i:0,order:[],reactions:{},tags:{},picks:[]};
const KEY="styleDNA_v3";

/* ============================================================================
   ACCOUNTS
   Each account gets its own saved profile, stored under "styleDNA_v2::<id>".
   Guest is just another account with the id "guest".
   ========================================================================== */
const GOOGLE_CLIENT_ID = "";      /* <-- paste your Google OAuth Client ID here. See GOOGLE-SIGNIN-SETUP.md */

const ACC_KEY="styleDNA_accounts", LAST_KEY="styleDNA_lastAccount", SEED_KEY="styleDNA_legacySeeded";
let ACCOUNT=null;
const GUEST={id:"guest",name:"Guest",email:"",picture:"",kind:"guest"};

/* ---------- niche mode ----------
   "Niche" hides the labels most people could already name and deals only the
   lesser-known ones (isWellKnown in 50-taste-model.js).

   The recommender is untouched: same features, same scoring, same batching.
   What changes is WHERE the profile is written. storeKey() grows a "::niche"
   suffix, so the two modes keep entirely separate swipes, likes, carts and
   seen-lists, and the taste model each one builds is trained only on its own
   swipes. Liking six skate labels in Niche cannot drag your main feed around,
   and the mainstream profile you already built does not bias the niche one.

   The flag lives outside S — S is the thing being swapped, so a flag stored
   inside it would vanish the moment the other profile loaded. */
let NICHE=false;
const NICHE_KEY="styleDNA_niche";
function acctId(){return (ACCOUNT&&ACCOUNT.id)||"guest";}
function nicheFlagKey(){return NICHE_KEY+"::"+acctId();}
function loadNicheFlag(){try{return localStorage.getItem(nicheFlagKey())==="1";}catch(e){return false;}}
function saveNicheFlag(){try{localStorage.setItem(nicheFlagKey(),NICHE?"1":"0");}catch(e){}}

function storeKey(){return KEY+"::"+acctId()+(NICHE?"::niche":"");}
function save(){try{localStorage.setItem(storeKey(),JSON.stringify(S));}catch(e){}}
function load(){try{const s=localStorage.getItem(storeKey());if(s)return JSON.parse(s);}catch(e){}return null;}

function accounts(){try{return JSON.parse(localStorage.getItem(ACC_KEY))||[];}catch(e){return [];}}
function saveAccounts(a){try{localStorage.setItem(ACC_KEY,JSON.stringify(a));}catch(e){}}
function upsertAccount(a){const all=accounts();const i=all.findIndex(x=>x.id===a.id);
  if(i>=0)all[i]=Object.assign({},all[i],a);else all.push(a);saveAccounts(all);}
function findAccount(id){return accounts().filter(x=>x.id===id)[0]||null;}
function forgetAccount(id){saveAccounts(accounts().filter(x=>x.id!==id));
  /* both profiles, or the niche one is orphaned in localStorage forever */
  try{localStorage.removeItem(KEY+"::"+id);}catch(e){}
  try{localStorage.removeItem(KEY+"::"+id+"::niche");}catch(e){}
  try{localStorage.removeItem(NICHE_KEY+"::"+id);}catch(e){}}

/* One-time courtesy: an existing profile saved by an older version of this file
   (before accounts existed) is handed to whoever signs in first, so nobody
   loses swipes on the upgrade. Anyone signing in after that starts clean. */
function seedFromLegacy(){
  try{
    if(localStorage.getItem(SEED_KEY))return;
    const legacy=localStorage.getItem(KEY);
    if(legacy&&!localStorage.getItem(storeKey()))localStorage.setItem(storeKey(),legacy);
    localStorage.setItem(SEED_KEY,"1");
  }catch(e){}
}
function show(id){["auth","intro","settings","settings2","inspo","deck","results"].forEach(x=>{const e=document.getElementById(x);if(e)e.classList.add("hidden");});document.getElementById(id).classList.remove("hidden");
  const ab=document.getElementById("appbar");if(ab)ab.classList.toggle("hidden",id==="auth");
  const hd=document.querySelector("header.top");if(hd)hd.style.display=(id==="auth")?"none":"";
  closeAcctMenu();
  const shop=(id==="deck"||id==="results"||id==="inspo");
  const fab=document.getElementById("cartFab");if(fab)fab.classList.toggle("hidden",!shop);
  const lfab=document.getElementById("likeFab");if(lfab)lfab.classList.toggle("hidden",!shop);
  const gear=document.getElementById("gearBtn");if(gear)gear.classList.toggle("hidden",!shop);
  updateCartFab();window.scrollTo(0,0);}
