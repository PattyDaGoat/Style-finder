   ===== SECTIONING: extra signals — delete to "end SECTIONING" to revert =====

   I still cannot look at the photograph. Telling a model's gender from raw pixels
   needs a trained vision model, and a local page can't even read the pixels of a
   third-party CDN image. But almost everything I need is written down beside it:

     product URL      .../products/womens-cotton-diana-edition-sweater-pink
     photo filename   F1_W_Gigi_Smocked_Dress.jpg   instock_m_q326_dory-crew.jpg
     brand name       "Wax London Womens"

   A piece filed by its own shop under /womens/ was photographed on a woman, so the
   URL stands in for the thing I can't see. Checked against the tags that shipped with
   this catalog it agrees 91% of the time, and nearly every disagreement is the tag
   being wrong: six Roark women's tees and five Fresh Clean Threads women's multipacks
   were sitting in the men's deck.
   ========================================================================== */
const GD_URL_W = /(?:\/|[_\-])(?:women|womens|womans|woman|ladies|female|wmns)(?:\/|[_\-]|$)/i;
const GD_URL_M = /(?:\/|[_\-])(?:men|mens|mans|male|mnswr)(?:\/|[_\-]|$)/i;
const GD_BRAND_W = /\b(?:women|womens|womans|ladies|female)\b/i;
const GD_BRAND_M = /\b(?:men|mens|male)\b/i;
/* A single-letter token must be delimited on BOTH sides, or camera filenames like
   "CordSoftTruckerCap_Navy_W7A1410.jpg" read as womenswear. That bug was in my first
   attempt at this and it mislabelled a men's cap. */
const GD_IMG_W = /(?:^|[/_.\-])(?:w|wm|wmn|wmns|women|womens|womans|female|ladies)(?=[/_.\-])/i;
const GD_IMG_M = /(?:^|[/_.\-])(?:m|mn|men|mens|mans|male)(?=[/_.\-])/i;
function gdFile(url){ return (url||"").split("/").pop().split("?")[0]; }

/* Which section does this piece belong in? Tiers, most trustworthy first; the first
   one that fires decides. Returns {g:'f'|'m'|null, why, weak?}. */
function detectSection(p){
  const s=gdScrub(p.n||""), cat=p.cat;

  /* T0 — women's swimwear, no exceptions and no tier above it.
     bikini/swimsuit already sat in GD_F_GARMENT at T2, which is why none had
     actually leaked. But T2 is reachable only if T1 stays silent, so a stray
     "men's" anywhere in the name would have outranked it, and the T2 list had
     no word for one-piece, monokini, bandeau or cover-up. Nobody swiping the
     men's deck should ever be shown a bikini, so it is decided first and the
     rest of the ladder never gets a vote. */
  if(isWomensSwim(p)) return {g:"f", why:"women's swimwear"};

  /* T1 — the name names its audience */
  const fa=GD_F_AUDIENCE.test(s), ma=GD_M_AUDIENCE.test(s);
  if(fa!==ma) return {g:fa?"f":"m", why:"name says so"};

  /* T2 — a garment type only one gender wears */
  const fg=GD_F_GARMENT.test(s) || (cat==="shoe"&&GD_F_SHOE.test(s)) || (cat==="acc"&&GD_F_BAG.test(s));
  const mg=GD_M_GARMENT.test(s);
  if(fg!==mg) return {g:fg?"f":"m", why:"garment type"};

  /* T3 — the shop's own URL: where they shelved it, so who modelled it */
  const uw=GD_URL_W.test(p.u||""), um=GD_URL_M.test(p.u||"");
  if(uw!==um) return {g:uw?"f":"m", why:"product web address"};

  /* T4 — the brand name itself carries a gender */
  const bw=GD_BRAND_W.test(p.b||""), bm=GD_BRAND_M.test(p.b||"");
  if(bw!==bm) return {g:bw?"f":"m", why:"brand name"};

  /* T5 — a gender token in the photo filename. Weakest: some are camera codes, so a
     brand's own lean is allowed to overrule this one below. */
  const f=gdFile(p.img);
  const iw=GD_IMG_W.test(f), im=GD_IMG_M.test(f);
  if(iw!==im) return {g:iw?"f":"m", why:"photo filename", weak:true};

  return {g:null, why:"nothing in the listing says"};
}

/* ---------- brand lean ----------
   Built from the pieces the tiers above could place. A brand that is 85%+ one gender
   places its own leftovers: an unlabelled Roark piece is menswear because Roark
   overwhelmingly is. Genuinely mixed brands (Community Clothing, Allbirds) place
   nothing, which is the honest outcome rather than a coin flip. */
let GD_LEAN=null;
function gdLean(){
  if(GD_LEAN) return GD_LEAN;
  const tally={};
  for(let i=0;i<CATALOG.length;i++){
    const p=CATALOG[i], d=detectSection(p);
    let g=d.weak?null:d.g;                       // weak evidence gets no vote
    if(!g && (p.g==="m"||p.g==="f")) g=p.g;      // the retailer's tag votes
    if(!g) continue;
    const t=tally[p.b]||(tally[p.b]={f:0,m:0}); t[g]++;
  }
  GD_LEAN={};
  for(const b in tally){
    const t=tally[b], n=t.f+t.m;
    if(n>=4){ if(t.f/n>=0.85)GD_LEAN[b]="f"; else if(t.m/n>=0.85)GD_LEAN[b]="m"; }
  }
  return GD_LEAN;
}

/* Strict mode: a piece appears only in the section it was positively placed in, and
   anything the listing cannot place is held back from BOTH decks — because an
   unplaced piece is exactly the one whose photo might show the wrong model.

   Always on. There used to be a toggle under the deck (and a saved preference);
   the control read as clutter, and turning it off risks a wrong-gender photo, so
   the safe setting is now simply the setting. syncStrictBtn stays as a no-op
   shim because deck rendering calls it on every card. */
let STRICT_SECT=true;
function syncStrictBtn(){}
/* ===== end SECTIONING ===== */

function detectGender(p){ return detectSection(p).g; }
/* Built once, lazily: 0 = no lock, 1 = women's only, 2 = men's only. A typed array so
   the check inside the hot filter loop is an integer compare, not a regex. */
let GLOCK=null;
function genderLock(){
  if(GLOCK) return GLOCK;
  const lean=gdLean();
  GLOCK=new Uint8Array(CATALOG.length);
  for(let i=0;i<CATALOG.length;i++){
    const p=CATALOG[i], d=detectSection(p);
    let g=d.g;
    if(d.weak && lean[p.b] && lean[p.b]!==g) g=lean[p.b];   // brand overrules a weak filename token
    if(!g) g=lean[p.b]||null;                               // otherwise the brand can place it
    if(!g && (p.g==="m"||p.g==="f")) g=p.g;                  // finally, the retailer's own tag
    GLOCK[i]= g==="f" ? 1 : g==="m" ? 2 : 0;
  }
  return GLOCK;
}

/* ---------- no underwear in the deck ----------
   Intimates stay in the data (a past swipe on one is still taste signal) but are
   never dealt, recommended, or restored into a cart. Two regexes because the
   words need scrubbing first: a sports bra is activewear, swim briefs are
   swimwear, a "boxer overshirt" is a shirt, and thong sandals are shoes — none
   of those should vanish. "Thong" needs local knowledge beyond that: on a shoe
   it's a sandal, next to bikini/swim it's swimwear, and the bare plural is
   Australian for flip-flops ("Freedom Thongs", Rip Curl). Underwear listings
   say Thong 3-Pack / seamless / invisible / cotton — those stay hidden. */
const UW_SCRUB=/\b(sports?\s+bras?|swim\s+briefs?|bikini\s+bottoms?|thong\s+(sandals?|slides?|flip\s*-?\s*flops?)|(leather|heel|suede|toe)\s+thongs?|boxer\s+(overshirts?|shirts?|jackets?|hoodies?|sweat\w*|tees?|tops?|fit)|bras?\s+details?|bra[-\s]friendly|built[-\s]in\s+bras?)\b/gi;
const UW_RE=/\b(underwear|undies|underpants|boxers?|boxer\s*briefs?|briefs?|jock\s*straps?|y-?fronts?|panty|panties|thongs?|g-?strings?|knickers|lingerie|negligees?|nighties?|nightgowns?|bras?|bralettes?|long\s*johns?)\b/i;
let UWEAR=null;
function underwearLock(){
  if(UWEAR) return UWEAR;
  UWEAR=new Uint8Array(CATALOG.length);
  for(let i=0;i<CATALOG.length;i++){
    const p=CATALOG[i];
    let n=(p.n||"").replace(UW_SCRUB," ");
    if(p.cat==="shoe" || /\b(bikini|swim)\b/i.test(p.n||"")) n=n.replace(/\bthongs?\b/gi," ");
    else if(/\bthongs\b/i.test(n) && !/\b(packs?|multi\w*|seamless|invisible|cotton|underwear)\b/i.test(n)) n=n.replace(/\bthongs\b/gi," ");
    UWEAR[i]=UW_RE.test(n)?1:0;
  }
  return UWEAR;
}