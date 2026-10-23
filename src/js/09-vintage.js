/* ---------- vintage / thrift ----------
   A micro-style the catalogue does not carry in its data, derived here at load
   from what a listing says about itself, so it lands on every second-hand
   piece — the Depop finds and the vintage shops — without a re-scrape, and so
   the scraper's own classifier (enrich.MS_RULES has the mirror rule) and this
   one cannot drift apart for the rows that predate it.

   Three strengths. A second-hand listing that says vintage / 90s / Y2K, or any
   piece that says thrifted / pre-loved / deadstock / reworked, is a real find:
   the tag goes FIRST, so it becomes the piece's lane for the deck's exploration
   and the lead chip on the card. A second-hand listing that does not say so (a
   used Nike hoodie on Depop) is thrift, and a NEW piece that only borrows the
   words ("Vintage Wash Western Shirt") is a look: for both the tag goes last,
   so the piece keeps its own style as its lane but still answers to
   the Vintage / Thrift chip. Runs before 10-helpers.js (whose tail opens a comment that 15-sectioning.js closes, so nothing can sit between those two) and before the taste
   model counts tags, which is why this file sits at 09. */
/* second-hand for certain, whoever is selling it */
const SECONDHAND_WORD=/\b(thrift(ed)?|pre[- ]?loved|pre[- ]?owned|second[- ]?hand|deadstock|upcycled|reworked)\b/i;
/* era words: TRUE vintage on a second-hand listing, a vintage LOOK on a new piece
   ("Vintage Wash Western Shirt" from a current label is a finish, not a find) */
const ERA_WORD=/\b(vintage|retro|y2k|'?[6789]0s|00s|1[89][0-9]0s|archive)\b/i;
const SECONDHAND_HOST=/(depop\.com|thredup\.com|shopthrilling\.com|beyondretro\.com|rokit\.co\.uk|ragstock\.com|vintage-threads\.com|thrifted\.com|goodfair\.com|thevintagetwin\.com|shopwasteland\.com|shoproundtwo\.com|procell\.com|glassonionvintage\.com|messinahembry\.com|retrothreads\.com|vintagefolk\.co\.uk|coolclothesforcoolpeople\.com)/i;
/* "vintage": a real find, leads the piece's lane. "thrift": second-hand without the
   words. "look": a new piece styled after the past — answers to the chip, is not
   offered as a find. */
function vintageKind(p){
  const n=p.n||"", sh=SECONDHAND_HOST.test(p.u||"");
  if(SECONDHAND_WORD.test(n)) return "vintage";
  if(sh) return ERA_WORD.test(n) ? "vintage" : "thrift";
  if(ERA_WORD.test(n)) return "look";
  return null;
}
CATALOG.forEach(p=>{
  /* the scraper reads the whole description, this reads the name: a row that
     arrives already tagged by enrich.py but says nothing in its name is a look
     the description vouched for — kept, but never in the lead */
  const k=vintageKind(p) || ((p.ms||[]).includes("vintage-thrift") ? "look" : null);
  if(!k) return;
  p.ms=(p.ms||[]).filter(m=>m!=="vintage-thrift");
  /* a row the scraper could only file under the vintage rule arrives with that as
     its ONLY tag; a look or a thrift piece still needs a style of its own in
     front, or "last" and "first" are the same slot */
  if(!p.ms.length && k!=="vintage") p.ms.push("elevated-basics");
  if(k==="vintage") p.ms.unshift("vintage-thrift"); else p.ms.push("vintage-thrift");   /* thrift and look: last */
  if(p.ms.length>4) p.ms.length=4;
  p.vintage=k;
});
