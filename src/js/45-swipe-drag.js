/* ---- swipe animation + drag ----
   A card that feels like a card. Three things do most of that work:

     velocity   a fast flick commits even if it barely moved, because that is
                what your hand meant. Distance alone forces you to drag the full
                width every time, which is what made this feel stuck.
     pivot      rotation is anchored to where you grabbed. Take the card by the
                bottom and it swings the opposite way to the top, like pushing a
                real card on a table. A fixed rotation is the giveaway that it is
                a div.
     spring     released under the threshold it comes back with a little
                overshoot, and it lifts while held. That is the "weight".

   Everything is transform + opacity so it stays on the compositor. */
let SWIPING=false;
/* The photo is now a link to the shop, and the photo is also most of the drag
   surface — so a swipe that starts on it must not open a tab on release.
   _TAP stays true only while the pointer has barely moved; the anchor's
   onclick asks deckTapOK() and returns false after a real drag. */
let _TAP=true; const TAP_SLOP=6;
function deckTapOK(){ return _TAP; }

/* Tuned light on purpose: a mouse drag is a short movement from the wrist,
   nothing like a thumb sweeping a phone. You should never have to push a card
   to the edge — a nudge in a direction is already a clear statement of intent,
   and the stamp on screen tells you it landed before you let go. */
const SW={
  commitPx:  34,     /* travel that always commits — a nudge, not a shove */
  commitFrac: 0.12,  /* …or this share of the card's width, whichever is SMALLER.
                        Keeps the gesture feeling the same on a narrow phone card
                        and a wide desktop one, instead of being easy on one and
                        a stretch on the other. */
  commitV:   0.20,   /* px/ms — a lazy wrist flick clears this */
  flickMinPx: 18,    /* …but a flick still has to have gone somewhere. Velocity
                        on its own fires on a twitch: pointer events can arrive
                        microseconds apart, and dx/dt then explodes into a flick
                        the user never made. Both conditions, always. This is the
                        one number that must not chase the others down — it is
                        what keeps a jittery click from swiping. */
  vMax:       3,     /* px/ms ceiling, so one bad frame can't dominate */
  dtMin:      4,     /* ms floor, so we never divide by ~0 */
  upPx:      44,     /* upward travel for a love */
  upV:       0.24,
  maxRot:    14,     /* degrees at a full card-width of travel */
  lift:    1.02,     /* scale while held: the card comes off the stack */
  flyMs:    300,     /* leaves briskly — a slow exit reads as lag */
  springMs: 380      /* and comes back briskly too */
};
/* the distance that commits, for this card's actual width */
function swipeCommitPx(card){
  const w=(card&&card.offsetWidth)||340;
  return Math.min(SW.commitPx, Math.round(w*SW.commitFrac));
}
const _clampV=v=>Math.max(-SW.vMax,Math.min(SW.vMax,v));
function showStamp(card,kind){const m={skip:'.s-nope',like:'.s-like',love:'.s-love'}[kind];const el=card.querySelector(m);if(el)el.style.opacity='1';}

/* Throw the card off screen, then commit the reaction. `vx`/`vy` carry the
   flick's momentum through so a hard swipe leaves faster than a slow one. */
function flyOut(card,kind,vx,vy,rot){
  const w=innerWidth||900;
  const dir=kind==='skip'?-1:kind==='like'?1:0;
  const tx=dir? dir*(w*1.25) : (vx||0)*160;
  const ty=kind==='love' ? -(innerHeight||800)*1.1 : (vy||0)*120+40;
  const tr=kind==='love' ? (vx||0)*8 : dir*Math.max(22,Math.abs(rot||0)*1.5);
  card.style.transition=`transform ${SW.flyMs}ms cubic-bezier(.22,.61,.36,1), opacity ${SW.flyMs-80}ms linear`;
  showStamp(card,kind);
  requestAnimationFrame(()=>{
    card.style.transform=`translate(${tx}px,${ty}px) rotate(${tr}deg) scale(1)`;
    card.style.opacity='0';
  });
}

function animateSwipe(kind,vx,vy,rot){
  if(SWIPING||!QUEUE.length)return; SWIPING=true;
  const card=document.querySelector('#cardHost .piece-card');
  if(card) flyOut(card,kind,vx,vy,rot);
  setTimeout(()=>{SWIPING=false;react(kind);},SW.flyMs-40);
}

function attachDrag(card){
  if(!card)return;
  /* lx/ly are the last position we actually SAW, and the only thing the release
     reads. pointercancel carries no usable coordinate — it arrives as clientX 0
     — so reading the event directly turned a rightward drag into
     dx = 0 - startX, a large negative number, past the threshold, and fired
     'skip'. That is why swiping right registered as a left swipe. */
  let sx=0,sy=0,lx=0,ly=0,drag=false,pivot=1,vx=0,vy=0,lastT=0;
  const like=card.querySelector('.s-like'),nope=card.querySelector('.s-nope'),love=card.querySelector('.s-love');
  const clearStamps=()=>{if(like)like.style.opacity=0;if(nope)nope.style.opacity=0;if(love)love.style.opacity=0;};
  /* Stamps are derived from the commit thresholds rather than hardcoded, so
     they stay honest if the feel is retuned: full opacity lands exactly where
     letting go would commit. The stamp is the promise; the threshold keeps it. */
  const stampAt=(travel,limit)=>Math.max(0,Math.min(1,(travel-4)/Math.max(1,limit-4)));
  const setStamps=(dx,dy)=>{
    const cp=swipeCommitPx(card);
    const up=dy<-10&&Math.abs(dy)>Math.abs(dx);
    if(love)love.style.opacity=up?stampAt(-dy,SW.upPx):0;
    if(like)like.style.opacity=(!up&&dx>0)?stampAt(dx,cp):0;
    if(nope)nope.style.opacity=(!up&&dx<0)?stampAt(-dx,cp):0;};

  const paint=(dx,dy,held)=>{
    const w=card.offsetWidth||340;
    const rot=(dx/w)*SW.maxRot*pivot;
    card.style.transform=`translate(${dx}px,${dy}px) rotate(${rot}deg) scale(${held?SW.lift:1})`;
    return rot;
  };
  /* Overshoot on the way back is the whole point — it reads as mass, where a
     linear ease reads as a slide. */
  const settle=()=>{card.style.transition=`transform ${SW.springMs}ms cubic-bezier(.18,.89,.32,1.28)`;
    card.style.transform='';clearStamps();};

  const down=e=>{
    if(SWIPING||(e.target&&e.target.closest&&e.target.closest('.swipe-cart,.focus-btn,.report-btn')))return;
    drag=true;_TAP=true;
    sx=lx=e.clientX;sy=ly=e.clientY;vx=vy=0;lastT=e.timeStamp||performance.now();
    /* grab the top half and it swings one way, the bottom half the other */
    const r=card.getBoundingClientRect();
    pivot=((e.clientY-r.top)/(r.height||1))<0.5?1:-1;
    card.style.transition='none';
    paint(0,0,true);
    try{card.setPointerCapture(e.pointerId);}catch(_){}
  };

  const move=e=>{
    if(!drag)return;
    const t=e.timeStamp||performance.now();
    const dt=Math.max(t-lastT,SW.dtMin);   /* never divide by ~0 */
    /* smoothed, so one jittery frame can't throw it */
    vx=_clampV(vx*0.7+((e.clientX-lx)/dt)*0.3);
    vy=_clampV(vy*0.7+((e.clientY-ly)/dt)*0.3);
    lastT=t;
    lx=e.clientX;ly=e.clientY;
    const dx=lx-sx,dy=ly-sy;
    if(Math.abs(dx)+Math.abs(dy)>TAP_SLOP)_TAP=false;
    setStamps(dx,dy);paint(dx,dy,true);
  };

  const up=()=>{
    if(!drag)return;drag=false;
    const dx=lx-sx,dy=ly-sy;        /* last seen, never the event's */
    const w=card.offsetWidth||340, rot=(dx/w)*SW.maxRot*pivot;
    /* Distance OR a flick — but a flick still has to have travelled. */
    const cp=swipeCommitPx(card);
    const flickR=vx> SW.commitV&&dx> SW.flickMinPx;
    const flickL=vx<-SW.commitV&&dx<-SW.flickMinPx;
    const flickU=vy<-SW.upV   &&dy<-SW.flickMinPx;
    const upward=(dy<-SW.upPx||flickU)&&Math.abs(dy)>Math.abs(dx);
    if(upward)               return animateSwipe('love',vx,vy,rot);
    if(dx> cp||flickR)       return animateSwipe('like',vx,vy,rot);
    if(dx<-cp||flickL)       return animateSwipe('skip',vx,vy,rot);
    settle();
  };
  /* A cancelled gesture is not a swipe. Snap back and decide nothing — acting on
     a drag the browser threw away is how the wrong card got skipped. _TAP is
     cleared too, so an aborted gesture cannot fall through and open the shop. */
  const cancel=()=>{if(!drag)return;drag=false;_TAP=false;settle();};

  card.addEventListener('pointerdown',down);
  card.addEventListener('pointermove',move);
  card.addEventListener('pointerup',up);
  card.addEventListener('pointercancel',cancel);
  card.addEventListener('lostpointercapture',cancel);
  /* Belt and braces on the photo: .piece-photo img already has pointer-events
     none, but any other image in the card would otherwise start a native HTML5
     image drag, and that is what cancels the pointer stream mid-swipe. */
  card.querySelectorAll('img').forEach(im=>{im.draggable=false;});
  card.addEventListener('dragstart',e=>e.preventDefault());
}
function finishDeck(){buildModel();buildResults();show("results");save();}
