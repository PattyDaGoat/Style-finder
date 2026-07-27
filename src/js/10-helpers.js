/* ---------- helpers ---------- */
function pImg(url,w){return url+(url.includes('?')?'&':'?')+'width='+(w||700);}
function imgFail(el,p){const d=document.createElement('div');d.className='ph-fallback';d.innerHTML=`<b>${p.b}</b><div style="margin-top:6px">${p.n}</div><div style="margin-top:10px;font-size:13px">(photo didn't load — tap to view)</div>`;if(el&&el.replaceWith)el.replaceWith(d);else if(el&&el.parentNode)el.parentNode.innerHTML=d.outerHTML;}
function baseTitle(n){return n.replace(/\s*[-—]\s*[^-—]+$/,'').replace(/\s+in\s+[A-Z].*$/,'').trim().toLowerCase();}

/* ============================================================================
   GENDER DETECTION
   Runs over the catalog itself rather than trusting the tag that shipped with each
   product. Two signals, in order:
     1. an explicit audience word in the name  ("Women's Crew", "Mens Devotion")
     2. a garment type only one gender wears   (bodycon dress, jockstrap)
   A hit here LOCKS the item to that section, so a mis-tagged dress can never surface
   in menswear even if a future catalog update gets the tag wrong.

   Deliberately not attempted: reading the model's gender out of the photograph. That
   needs a trained vision model; a colour-histogram guess would be wrong often enough
   to put dresses back in the men's deck, which is the bug we're fixing. Product names
   and brands are dull, cheap and right.
   ========================================================================== */
const GD_F_AUDIENCE = /\b(women|womens|women's|woman|woman's|ladies|lady's|girls|girl's|for her|maternity|nursing|femme)\b/i;
const GD_M_AUDIENCE = /\b(men|mens|men's|man's|for him|homme)\b/i;
const GD_F_GARMENT  = /\b(dress|dresses|gown|gowns|skirt|skirts|skort|skorts|blouse|blouses|bra|bras|bralette|bralet|bikini|bikinis|swimsuit|tankini|lingerie|corset|bustier|camisole|cami|bodysuit|bodycon|romper|playsuit|jumpsuit|legging|leggings|jegging|jeggings|tights|pantyhose|midi|maxi|halter|strapless|sweetheart|peplum|tube top|crop top|cropped top|kaftan|caftan|babydoll|pinafore|jupe|sarong|pareo|nightie|nightgown|bodice|corsage)\b/i;
const GD_M_GARMENT  = /\b(boxer|boxers|boxer brief|boxer briefs|jockstrap|tuxedo|necktie|bow tie|swim trunk|swim trunks|trunks|y-front|y-fronts)\b/i;
/* Women's swimwear, treated separately from GD_F_GARMENT because it must be a
   HARD result rather than one tier among several — see detectSection's T0.
   Split into two strengths to avoid the obvious false positive: "two piece" is
   a women's swimsuit at a swimwear label and a men's SUIT at a tailoring one,
   so the loose words only count with swim context beside them. */
const GD_F_SWIM_STRONG = /\b(bikini|bikinis|tankini|monokini|swimsuit|swim ?suit|maillot|swim ?dress|swimdress)\b/i;
const GD_F_SWIM_LOOSE  = /\b(one[- ]?piece|two[- ]?piece|bandeau|cover[- ]?ups?)\b/i;
const GD_SWIM_CTX      = /\b(swim\w*|beach\w*|pool\w*|resort|surf\w*|bathing)\b/i;
/* Men's swimwear keeps its own words, so nothing below drags it into womenswear. */
const GD_M_SWIM = /\b(swim ?trunks?|trunks?|board ?shorts?|boardies|swim ?briefs?|swim ?shorts?|rash ?guards?)\b/i;
function isWomensSwim(p){
  const n = (p && p.n) || "";
  if(GD_M_SWIM.test(n)) return false;                       // men's swimwear stays put
  if(GD_F_SWIM_STRONG.test(n)) return true;
  return GD_F_SWIM_LOOSE.test(n) && GD_SWIM_CTX.test(n);
}

/* only a women's signal inside the category they belong to */
const GD_F_SHOE = /\b(stiletto|stilettos|pump|pumps|heels|wedge|wedges|espadrille|espadrilles|ballet flat|ballet flats|mary jane|mary janes|slingback|slingbacks)\b/i;
const GD_F_BAG  = /\b(clutch|clutches|purse|purses|handbag|handbags)\b/i;

/* strip the phrases that only look like markers */
function gdScrub(n){
  return n
    .replace(/\bdress\s+(shirt|pant|trouser|sock|boot|shoe|short)/gi," ")  // a dress shirt is a shirt
    .replace(/\bheel\s+(tab|counter|cup|loop|pull|patch)\b/gi," ")         // shoe anatomy, not a high heel
    .replace(/\b(lay|laid)\s*flat\b|\bflat\s*knit\b/gi," ")
    .replace(/\bmaxi[- ]?(mal|mum)\b/gi," ");
}
/* -> 'f' | 'm' | null   (null = no hard evidence either way) */
/* ============================================================================