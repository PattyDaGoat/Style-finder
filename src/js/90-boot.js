/* ============================================================================
   BOOT
   ========================================================================== */
(function(){
  const last=(function(){try{return localStorage.getItem(LAST_KEY);}catch(e){return null;}})();
  const acct=last?(last==="guest"?GUEST:findAccount(last)):null;
  if(acct){ activateAccount(acct); }
  else{ showAuth(); }
  let justReset=false;
  try{ justReset=sessionStorage.getItem("styleDNA_justReset")==="1"; if(justReset)sessionStorage.removeItem("styleDNA_justReset"); }catch(e){}
  if(justReset)toast("Cleared — starting fresh.");
})();