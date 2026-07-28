/* ---- swipe animation + drag ---- */
let SWIPING=false;
/* The photo is now a link to the shop, and the photo is also most of the drag
   surface — so a swipe that starts on it must not open a tab on release.
   _TAP stays true only while the pointer has barely moved; the anchor's
   onclick asks deckTapOK() and returns false after a real drag. */
let _TAP=true; const TAP_SLOP=6;
function deckTapOK(){ return _TAP; }
function showStamp(card,kind){const m={skip:'.s-nope',like:'.s-like',love:'.s-love'}[kind];const el=card.querySelector(m);if(el)el.style.opacity='1';}
function animateSwipe(kind){
  if(SWIPING||!QUEUE.length)return; SWIPING=true;
  const card=document.querySelector('#cardHost .piece-card');
  if(card){
    card.style.transition='transform .34s ease, opacity .34s ease';
    const t=kind==='skip'?'translate(-140%,-30px) rotate(-20deg)':kind==='love'?'translate(0,-150%) rotate(-4deg)':'translate(140%,-30px) rotate(20deg)';
    showStamp(card,kind);
    requestAnimationFrame(()=>{card.style.transform=t;card.style.opacity='0';});
  }
  setTimeout(()=>{SWIPING=false;react(kind);},340);
}
function attachDrag(card){
  if(!card)return;
  /* lx/ly are the last position we actually SAW during the drag, and the only
     thing the release reads. pointercancel does not carry a usable coordinate —
     it arrives as clientX 0 — so reading the event directly turned a rightward
     drag into dx = 0 - startX, a large negative number, past the -120 threshold,
     and fired 'skip'. That is why swiping right registered as a left swipe. */
  let sx=0,sy=0,lx=0,ly=0,drag=false;
  const like=card.querySelector('.s-like'),nope=card.querySelector('.s-nope'),love=card.querySelector('.s-love');
  const clearStamps=()=>{like.style.opacity=nope.style.opacity=love.style.opacity=0;};
  const setStamps=(dx,dy)=>{const up=dy<-50&&Math.abs(dy)>Math.abs(dx);
    love.style.opacity=up?Math.min(1,(-dy-50)/90):0;
    like.style.opacity=(!up&&dx>0)?Math.min(1,(dx-24)/90):0;
    nope.style.opacity=(!up&&dx<0)?Math.min(1,(-dx-24)/90):0;};
  const settle=()=>{card.style.transition='transform .2s ease';card.style.transform='';clearStamps();};

  const down=e=>{if(SWIPING||(e.target&&e.target.closest&&e.target.closest('.swipe-cart,.focus-btn,.report-btn')))return;
    drag=true;_TAP=true;sx=lx=e.clientX;sy=ly=e.clientY;card.style.transition='none';
    try{card.setPointerCapture(e.pointerId);}catch(_){}};
  const move=e=>{if(!drag)return;lx=e.clientX;ly=e.clientY;
    const dx=lx-sx,dy=ly-sy;
    if(Math.abs(dx)+Math.abs(dy)>TAP_SLOP)_TAP=false;
    card.style.transform=`translate(${dx}px,${dy}px) rotate(${dx/24}deg)`;setStamps(dx,dy);};
  const up=e=>{if(!drag)return;drag=false;
    const dx=lx-sx,dy=ly-sy;                     /* last seen, never the event's */
    if(dy<-120&&Math.abs(dy)>Math.abs(dx))return animateSwipe('love');
    if(dx>120)return animateSwipe('like');
    if(dx<-120)return animateSwipe('skip');
    settle();};
  /* A cancelled gesture is not a swipe. Snap back and decide nothing — acting on
     a drag the browser threw away is how the wrong card got skipped. _TAP is
     cleared too, so an aborted gesture cannot fall through and open the shop. */
  const cancel=()=>{if(!drag)return;drag=false;_TAP=false;settle();};

  card.addEventListener('pointerdown',down);card.addEventListener('pointermove',move);
  card.addEventListener('pointerup',up);card.addEventListener('pointercancel',cancel);
  /* Belt and braces on the photo: .piece-photo img already has pointer-events
     none, but any other image in the card would otherwise start a native HTML5
     image drag, and that is what cancels the pointer stream mid-swipe. */
  card.querySelectorAll('img').forEach(im=>{im.draggable=false;});
  card.addEventListener('dragstart',e=>e.preventDefault());
}
function finishDeck(){buildModel();buildResults();show("results");save();}
