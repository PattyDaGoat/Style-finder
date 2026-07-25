/* ---- swipe animation + drag ---- */
let SWIPING=false;
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
  let sx=0,sy=0,drag=false;
  const like=card.querySelector('.s-like'),nope=card.querySelector('.s-nope'),love=card.querySelector('.s-love');
  const setStamps=(dx,dy)=>{const up=dy<-50&&Math.abs(dy)>Math.abs(dx);
    love.style.opacity=up?Math.min(1,(-dy-50)/90):0;
    like.style.opacity=(!up&&dx>0)?Math.min(1,(dx-24)/90):0;
    nope.style.opacity=(!up&&dx<0)?Math.min(1,(-dx-24)/90):0;};
  const down=e=>{if(SWIPING||(e.target&&e.target.closest&&e.target.closest('.swipe-cart,.focus-btn')))return;drag=true;sx=e.clientX;sy=e.clientY;card.style.transition='none';try{card.setPointerCapture(e.pointerId);}catch(_){}};
  const move=e=>{if(!drag)return;const dx=e.clientX-sx,dy=e.clientY-sy;card.style.transform=`translate(${dx}px,${dy}px) rotate(${dx/24}deg)`;setStamps(dx,dy);};
  const up=e=>{if(!drag)return;drag=false;const dx=e.clientX-sx,dy=e.clientY-sy;
    if(dy<-120&&Math.abs(dy)>Math.abs(dx))return animateSwipe('love');
    if(dx>120)return animateSwipe('like');
    if(dx<-120)return animateSwipe('skip');
    card.style.transition='transform .2s ease';card.style.transform='';like.style.opacity=nope.style.opacity=love.style.opacity=0;};
  card.addEventListener('pointerdown',down);card.addEventListener('pointermove',move);
  card.addEventListener('pointerup',up);card.addEventListener('pointercancel',up);
}
function finishDeck(){buildModel();buildResults();show("results");save();}
