/* ============================================================================
   BOOT
   ========================================================================== */

/* Take the boot screen down. Fades rather than cuts, but goes non-interactive
   immediately so nothing can be swallowed mid-fade, and leaves the DOM entirely
   so no stray overlay can sit on top of the deck. */
function hideBoot(){
  window.__bootDone=true;
  const b=document.getElementById("boot");
  if(!b) return;
  b.classList.add("boot-done");
  setTimeout(function(){ if(b.parentNode) b.parentNode.removeChild(b); },360);
}

(function(){
  const last=(function(){try{return localStorage.getItem(LAST_KEY);}catch(e){return null;}})();
  const acct=last?(last==="guest"?GUEST:findAccount(last)):null;
  if(acct){ activateAccount(acct); }
  else{ showAuth(); }
  let justReset=false;
  try{ justReset=sessionStorage.getItem("styleDNA_justReset")==="1"; if(justReset)sessionStorage.removeItem("styleDNA_justReset"); }catch(e){}
  if(justReset)toast("Cleared — starting fresh.");
  hideBoot();
})();
