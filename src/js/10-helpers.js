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