
/* ============================================================================
   WHICH PART OF THE PHOTO IS THE PRODUCT
   Most of these shots are a full look on a model, so "a green jacket" can be the one
   thing in frame you aren't looking at. The band below is derived from the garment
   type -- where a jacket sits on a body, where shoes sit -- and is used to frame and
   label the piece.

   Honest about what this is: a position by garment type, not object detection. It
   puts the frame on the right region for a standard full-length product shot; it
   can't know that this particular photo is cropped at the waist.
   ========================================================================== */
const FOCUS_BY_CAT={
  cap:    {t:0.00,h:0.27,label:"the hat"},
  tee:    {t:0.15,h:0.40,label:"the top"},
  shirt:  {t:0.14,h:0.42,label:"the shirt"},
  knit:   {t:0.14,h:0.42,label:"the knit"},
  sweat:  {t:0.13,h:0.44,label:"the sweat"},
  outer:  {t:0.11,h:0.48,label:"the jacket"},
  dress:  {t:0.13,h:0.64,label:"the dress"},
  trouser:{t:0.43,h:0.52,label:"the trousers"},
  short:  {t:0.39,h:0.35,label:"the shorts"},
  shoe:   {t:0.73,h:0.27,label:"the shoes"},
  acc:    {t:0.24,h:0.46,label:"the accessory"}
};
/* accessories and a few others sit in very different places — refine by name */
const FOCUS_BY_WORD=[
  [/\b(necklace|pendant|earring|earrings|choker|brooch)\b/i,{t:0.02,h:0.24,label:"the jewellery"}],
  [/\b(sunglass|sunglasses|eyewear|glasses)\b/i,           {t:0.00,h:0.22,label:"the sunglasses"}],
  [/\b(scarf|scarves|bandana|shawl|neckerchief)\b/i,       {t:0.05,h:0.28,label:"the scarf"}],
  [/\b(tie|necktie|bow tie|bolo)\b/i,                      {t:0.10,h:0.30,label:"the tie"}],
  [/\b(belt)\b/i,                                          {t:0.39,h:0.20,label:"the belt"}],
  [/\b(sock|socks|stocking|tights)\b/i,                    {t:0.66,h:0.32,label:"the socks"}],
  [/\b(glove|gloves|mitten|mittens)\b/i,                   {t:0.33,h:0.36,label:"the gloves"}],
  [/\b(bag|tote|backpack|rucksack|duffel|duffle|satchel|clutch|purse|handbag|crossbody|pouch|wallet)\b/i,
                                                           {t:0.28,h:0.44,label:"the bag"}],
  [/\b(watch|bracelet|anklet|ring|rings)\b/i,              {t:0.30,h:0.34,label:"the jewellery"}],
  [/\b(beanie|cap|hat|visor|headband|balaclava)\b/i,        {t:0.00,h:0.27,label:"the hat"}],
  [/\b(boot|boots|sneaker|sneakers|shoe|shoes|sandal|sandals|loafer|loafers|slide|slides|heel|heels)\b/i,
                                                           {t:0.73,h:0.27,label:"the shoes"}],
  [/\b(skirt|skort)\b/i,                                   {t:0.40,h:0.44,label:"the skirt"}],
  [/\b(legging|leggings|jean|jeans|trouser|trousers|pant|pants|chino|chinos|jogger|joggers)\b/i,
                                                           {t:0.43,h:0.52,label:"the trousers"}],
  [/\b(short|shorts|swim short|boardshort|trunk|trunks)\b/i,{t:0.39,h:0.35,label:"the shorts"}],
  [/\b(bikini|swimsuit|one.piece)\b/i,                     {t:0.18,h:0.52,label:"the swimwear"}],
  [/\b(jacket|coat|parka|blazer|gilet|vest|bomber|anorak)\b/i,{t:0.11,h:0.48,label:"the jacket"}]
];
function focusOf(p){
  const n=p.n||"";
  /* the category is the more reliable signal, so a name-based hint only wins when it
     agrees with the category's own family (stops "Bomber Tee" pointing at outerwear) */
  const base=FOCUS_BY_CAT[p.cat]||{t:0.16,h:0.46,label:"the piece"};
  if(p.cat==="acc"||p.cat==="shoe"||p.cat==="cap"){
    for(const [rx,f] of FOCUS_BY_WORD) if(rx.test(n)) return f;
  }
  return base;
}
function focusPos(p){                       /* for the small grid cards: object-position */
  const f=focusOf(p);
  return Math.round((f.t+f.h/2)*100)+"%";
}
let FOCUS_ON=false;   /* full photo is the default; the frame is opt-in */
function toggleFocus(e){
  if(e&&e.stopPropagation)e.stopPropagation();
  FOCUS_ON=!FOCUS_ON;
  try{localStorage.setItem("styleDNA_focus",FOCUS_ON?"1":"0");}catch(_){}
  const ph=document.querySelector("#cardHost .piece-photo");
  if(ph)ph.classList.toggle("nofocus",!FOCUS_ON);
  const b=document.getElementById("focusBtn");
  if(b){b.classList.toggle("off",!FOCUS_ON);
     const lab=b.querySelector("#focusLab");
     if(lab)lab.textContent=FOCUS_ON?"Showing the piece":"Highlight the piece";}
}
(function(){try{FOCUS_ON=localStorage.getItem("styleDNA_focus")==="1";}catch(_){}})();   /* opt-in, so absent = off */
