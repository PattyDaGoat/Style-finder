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
/* The photo is now a link to the shop, and the photo is also most of the drag
   surface — so a swipe that starts on it must not open a tab on release.
   _TAP stays true only while the pointer has barely moved; the anchor's
   onclick asks deckTapOK() and returns false after a real drag. */
let _TAP=true; const TAP_SLOP=5;
/* CSS defines a pixel as 1/96 inch, so real-world distances are expressible.
   The swipe is tuned in these because that is how it is actually judged — "I
   moved the mouse about a centimetre" — not in pixels. */
const CM=37.8;
function deckTapOK(){ return _TAP; }

/* Tuned light on purpose: a mouse drag is a short movement from the wrist,
   nothing like a thumb sweeping a phone. You should never have to push a card
   to the edge — a nudge in a direction is already a clear statement of intent,
   and the stamp on screen tells you it landed before you let go. */
const SW={
  /* There is no distance to reach any more. Move the card at all and it goes,
     in the direction you moved it. deadPx is the ONLY line, and it is not a
     swipe threshold — it is the boundary between "clicked the photo" and
     "dragged the card", so it sits just above TAP_SLOP and no lower. Below it a
     click stops opening the shop link and starts swiping, which is the bug this
     whole thread opened with. */
  deadPx:     TAP_SLOP+1,
  upBias:     1.6,   /* up must beat sideways by this much to count as a love,
                        or a swipe that drifts upward loves things you meant to
                        merely like */
  vMax:       3,     /* px/ms ceiling, so one bad frame can't dominate */
  dtMin:      4,     /* ms floor, so we never divide by ~0 */
  maxRot:    14,     /* degrees at a full card-width of travel */
  lift:    1.02,     /* scale while held: the card comes off the stack */
  /* The exit is deliberately unhurried — the card is the answer to "do you like
     this", and watching it leave is the confirmation. Fast enough not to be in
     the way, slow enough to read. */
  flyMs:    560,
  flyTravel: 1.0,    /* card-widths it crosses on the way out */
  flyCarry:   80,    /* how much of the throw's momentum shows in the exit */
  springMs: 420,     /* and an unhurried settle back when it doesn't commit */
  /* ---- the card arriving ----
     It had no entry at all: renderCard() wrote the next card straight into the
     DOM and it appeared with transition 0s, while the card it replaced took the
     full 560ms to leave. One motion unhurried and the next instantaneous is
     exactly what reads as the next photo snapping in too fast — the eye is
     still following the old card out when the new one is simply THERE.

     So it rises from the stack instead, on the same ease-out, settling a beat
     before the old card clears the screen. Slightly back and slightly low,
     growing into place — the same "comes off the stack" idea `lift` already
     uses for a held card, run in reverse. */
  inMs:     460,
  inScale: 0.94,     /* starts set back in the stack ... */
  inRise:    12      /* ... and a little low, then grows into place */
};
/* How far the stamps take to reach full opacity. Nothing to do with committing
   any more — the swipe commits on direction alone — this is purely how quickly
   LIKE/NOPE fade up so you can see which way it is going to go. */
function stampScale(card){
  const w=(card&&card.offsetWidth)||340;
  return Math.max(24,Math.round(w*0.12));
}
const _clampV=v=>Math.max(-SW.vMax,Math.min(SW.vMax,v));
function showStamp(card,kind){const m={skip:'.s-nope',like:'.s-like',love:'.s-love'}[kind];const el=card.querySelector(m);if(el)el.style.opacity='1';}

/* Send the card off along the line the hand was ACTUALLY travelling, not a
   canned left/right. Let go moving up-and-right and it leaves up-and-right — the
   card carries on doing what you were already doing with it, which is the whole
   difference between "sliding" and "snapping to a preset".

   dx/dy are the gesture's own vector. Buttons and the keyboard have no gesture,
   so they fall back to the canonical direction for the reaction. */
function flyOut(card,kind,vx,vy,rot,dx,dy){
  const len=Math.hypot(dx||0,dy||0);
  let ux,uy;
  if(len>2){ ux=(dx||0)/len; uy=(dy||0)/len; }
  else { ux=kind==='skip'?-1:kind==='like'?1:0; uy=kind==='love'?-1:0; }
  /* far enough to clear the screen from anywhere on it */
  const reach=Math.hypot(innerWidth||900,innerHeight||800)*1.05;
  const tx=ux*reach, ty=uy*reach;
  const tr=kind==='love' ? (vx||0)*6 : (ux>=0?1:-1)*Math.max(14,Math.abs(rot||0)*1.3);
  /* A single ease-out with no bounce: it keeps the speed it already had and
     glides away. Anything with an ease-IN stalls for a frame first, and that
     hitch is exactly what reads as "not smooth". */
  card.style.transition=`transform ${SW.flyMs}ms cubic-bezier(.16,.72,.30,1), opacity ${SW.flyMs-140}ms linear`;
  showStamp(card,kind);
  requestAnimationFrame(()=>{
    card.style.transform=`translate(${tx}px,${ty}px) rotate(${tr}deg) scale(1)`;
    card.style.opacity='0';
  });
}

/* The leaving card flies out in its OWN layer, detached from the deck, and the
   reaction lands immediately — so the next card is live the instant you swipe.

   It used to animate in place and only commit when the animation finished, which
   meant the deck was frozen for the whole exit: a second swipe was dropped and a
   drag could not even start, because pointerdown bailed while SWIPING was true.
   Survivable at 300ms; at 560ms it silently ate half the swipes of anyone going
   at a normal pace. Slowing an animation must never cost input.

   The ghost is position:fixed over the card's last on-screen box, so it looks
   identical while it leaves, and is removed when done. */
function _ghostOut(card,kind,vx,vy,rot,dx,dy){
  /* Measure the card's UNTRANSFORMED box, then carry its live transform across
     unchanged. This used to read getBoundingClientRect() on the card mid-drag
     and pin the ghost to that with transform:none — but on a rotated, scaled
     card that rect is the axis-aligned box AROUND it, which is bigger than the
     card: 476x491 for a 430x446 card at 4.88deg, and the gap grows with the
     angle up to maxRot. So at the instant you let go the card jumped ~46px
     wider and snapped upright. That flinch, on every swipe, is what reads as
     the card being yanked back into place before it leaves.

     Clearing the transform to measure and restoring it happens inside one task,
     so no frame is ever painted with the card at rest. */
  const live=card.style.transform;
  card.style.transform='none';
  const r=card.getBoundingClientRect();      /* the resting layout box */
  card.style.transform=live;
  const g=card.cloneNode(true);
  g.classList.add('card-ghost');
  g.style.cssText+=`position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;`
    +`height:${r.height}px;margin:0;pointer-events:none;z-index:60;transition:none;`
    +`transform:${live||'none'};`;
  document.body.appendChild(g);
  flyOut(g,kind,vx,vy,rot,dx,dy);
  setTimeout(()=>{try{g.remove();}catch(_){}},SW.flyMs+80);
}
/* Bring a freshly rendered card up from the stack.
   Purely cosmetic, and deliberately unable to cost you anything: the card is
   already live and draggable before this runs, and down() blows the transition
   away the moment you touch it. That is the same rule the exit had to learn the
   hard way — slowing an animation must never eat an input. */
function enterCard(card){
  if(!card)return;
  card.style.transition='none';
  card.style.transform=`translateY(${SW.inRise}px) scale(${SW.inScale})`;
  void card.offsetWidth;              /* commit that as the starting point... */
  card.style.transition=`transform ${SW.inMs}ms cubic-bezier(.16,.72,.30,1)`;
  card.style.transform='';            /* ...then let it settle to rest */
}

function animateSwipe(kind,vx,vy,rot,dx,dy){
  if(!QUEUE.length)return;
  const card=document.querySelector('#cardHost .piece-card');
  if(card) _ghostOut(card,kind,vx,vy,rot,dx,dy);
  react(kind);                        /* immediately — the deck never freezes */
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
    const cp=stampScale(card);
    const up=dy<-10&&Math.abs(dy)>Math.abs(dx);
    if(love)love.style.opacity=up?stampAt(-dy,cp):0;
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
    /* Buttons on the card are theirs, not the deck's. Otherwise every press
       starts a drag — including the right and middle mouse buttons, which have
       no business swiping anything. */
    if(e.button&&e.button!==0)return;
    if(e.target&&e.target.closest&&e.target.closest('.swipe-cart,.focus-btn,.report-btn'))return;
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

  const up=e=>{
    if(!drag)return;drag=false;
    /* A quick short drag can deliver pointerdown and pointerup with barely a
       pointermove between them — browsers coalesce moves, and a fast flick can
       produce none at all. Reading only what pointermove reported then leaves
       dx = 0 and the swipe silently does nothing, which is exactly what "I
       swipe and it doesn't register" feels like.

       pointerup DOES carry a true final position, so trust it. This is not the
       old bug returning: that was reading coordinates off pointerCANCEL, which
       carries none. Cancel has its own handler and never reads them. */
    if(e&&Number.isFinite(e.clientX)&&Number.isFinite(e.clientY)){lx=e.clientX;ly=e.clientY;}
    const dx=lx-sx,dy=ly-sy;
    const w=card.offsetWidth||340, rot=(dx/w)*SW.maxRot*pivot;

    /* Let go having moved the card AT ALL, and it goes — in whatever direction
       you were moving it. No distance to reach, no speed to hit: once the
       gesture is a drag rather than a click, the direction alone decides.

       The only line left is TAP_SLOP, and it is not a swipe threshold — it is
       what separates "clicked the photo to open the shop" from "dragged the
       card". Below it nothing happened; above it, something did, and the
       direction says what. */
    const moved=Math.hypot(dx,dy);
    if(moved<=SW.deadPx){ settle(); return; }

    /* Up counts as a love only when it clearly dominates; otherwise a swipe that
       drifts upward would love things you meant to like. */
    if(-dy>Math.abs(dx)*SW.upBias && -dy>SW.deadPx)
      return animateSwipe('love',vx,vy,rot,dx,dy);
    return animateSwipe(dx>0?'like':'skip',vx,vy,rot,dx,dy);
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
/* ---- keyboard ----
   Left skips, right likes, up loves, down undoes. Faster than a mouse once you
   have the rhythm, and it is the only way to use the deck without a pointer at
   all — which also makes it the accessible route.

   Guarded three ways: only on the deck, never while typing in a field, and only
   for a bare arrow press, so browser and OS shortcuts (cmd+arrow, alt+arrow to
   go back) are left alone. */
const DECK_KEYS={ArrowLeft:'skip',ArrowRight:'like',ArrowUp:'love'};
function deckKeyHandler(e){
  if(e.metaKey||e.ctrlKey||e.altKey||e.shiftKey)return;
  const deck=document.getElementById('deck');
  if(!deck||deck.classList.contains('hidden'))return;
  const t=e.target;
  if(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.isContentEditable))return;
  if(e.key==='ArrowDown'){
    if(typeof undoLast==='function'&&S&&S.hist&&S.hist.length){e.preventDefault();undoLast();}
    return;
  }
  const kind=DECK_KEYS[e.key];
  if(!kind)return;
  e.preventDefault();               /* or the page scrolls under the deck */
  if(!QUEUE.length)return;
  animateSwipe(kind);
}
document.addEventListener('keydown',deckKeyHandler);

function finishDeck(){buildModel();buildResults();show("results");save();}
