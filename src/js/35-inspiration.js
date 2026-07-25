/* ---------- inspo photo matcher (reads colours from the image, offline) ---------- */
const INSPO={counts:{},sel:new Set(),vibes:new Set(),imgs:0};
const SWATCH={dark:"#232323",blue:"#2b4c7e",green:"#48704f",earth:"#8a5a34",bold:"#c0392b",neutral:"#dcd6c8"};
function classifyRGB(r,g,b){
  const mx=Math.max(r,g,b),mn=Math.min(r,g,b),lum=(0.299*r+0.587*g+0.114*b)/255,sat=mx===0?0:(mx-mn)/mx;
  if(lum<0.15)return"dark";
  if(sat<0.16)return lum<0.42?"dark":"neutral";
  const d=mx-mn;let h;
  if(mx===r)h=((g-b)/d)%6;else if(mx===g)h=(b-r)/d+2;else h=(r-g)/d+4;
  h*=60;if(h<0)h+=360;
  if(h>=200&&h<=270)return"blue";
  if(h>=70&&h<175)return"green";
  if(h>=20&&h<50)return lum<0.58?"earth":"bold";
  return"bold"; // reds/pinks/purples/yellows
}
function openInspo(){renderInspoVibes();const pu=document.getElementById('pinBoard');if(pu&&S.inspo&&S.inspo.board&&!pu.value)pu.value=S.inspo.board;show("inspo");}
function handleInspo(e){
  const files=[...e.target.files].slice(0,6);
  files.forEach(file=>{
    const rd=new FileReader();
    rd.onload=ev=>{
      const img=new Image();
      img.onload=()=>{
        const c=document.createElement("canvas");c.width=40;c.height=40;
        const ctx=c.getContext("2d");ctx.drawImage(img,0,0,40,40);
        let data;try{data=ctx.getImageData(0,0,40,40).data;}catch(_){return;}
        for(let i=0;i<data.length;i+=4){if(data[i+3]<125)continue;const k=classifyRGB(data[i],data[i+1],data[i+2]);INSPO.counts[k]=(INSPO.counts[k]||0)+1;}
        INSPO.imgs++;
        const t=document.createElement("div");t.className="inspo-thumb";t.innerHTML=`<img src="${ev.target.result}">`;
        document.getElementById("inspoThumbs").appendChild(t);
        renderInspoDetected();
        reseedFromInspo();   // adding a photo instantly refreshes the suggestions
        const ir=document.getElementById("inspoResults"); if(ir&&!ir.innerHTML.trim()) ir.innerHTML='<p class="section-note">Got it — refreshed your suggestions from these looks. Head back to swiping to see them.</p>';
      };
      img.src=ev.target.result;
    };
    rd.readAsDataURL(file);
  });
  e.target.value="";
}
function renderInspoDetected(){
  const top=Object.keys(INSPO.counts).sort((a,b)=>INSPO.counts[b]-INSPO.counts[a]);
  if(!top.length)return;
  INSPO.sel=new Set(top.slice(0,3));   // auto-pick the strongest colours
  document.getElementById("inspoColors").innerHTML=top.map(c=>`<button class="inspo-sw ${INSPO.sel.has(c)?'on':''}" onclick="toggleInspoColor('${c}',this)"><i style="background:${SWATCH[c]}"></i>${COLORN[c]||c}</button>`).join("");
  document.getElementById("inspoDetected").classList.remove("hidden");
}
function toggleInspoColor(c,el){if(INSPO.sel.has(c)){INSPO.sel.delete(c);el.classList.remove("on");}else{INSPO.sel.add(c);el.classList.add("on");}}
function renderInspoVibes(){
  document.getElementById("inspoVibes").innerHTML=Object.keys(MS).map(k=>`<span class="chip ${INSPO.vibes.has(k)?'on':''}" onclick="toggleInspoVibe('${k}',this)">${MS[k]}</span>`).join("");
}
function toggleInspoVibe(k,el){if(INSPO.vibes.has(k)){INSPO.vibes.delete(k);el.classList.remove("on");}else{INSPO.vibes.add(k);el.classList.add("on");}}
function findInspoMatches(){
  const cols=INSPO.sel, vibes=INSPO.vibes;
  if(!cols.size && !vibes.size){document.getElementById("inspoResults").innerHTML='<p class="section-note">Add a photo (or tap a vibe) first.</p>';return;}
  const scored=[];
  for(let i=0;i<CATALOG.length;i++){
    const p=CATALOG[i]; if(!passesFilters(i))continue;
    let s=0;
    if(cols.has(p.color))s+=2.2;
    let mv=0; p.ms.forEach(m=>{if(vibes.has(m))mv+=1;}); s+=mv*2;
    if(s<=0)continue;
    s+=(p.pat==="graphic"&&vibes.has("skate-street"))?0.6:0;
    scored.push({i,s});
  }
  scored.sort((a,b)=>b.s-a.s);
  INSPO.matches=diversify(scored.map(o=>o.i),3,0,40);
  const host=document.getElementById("inspoResults");
  if(!INSPO.matches.length){host.innerHTML='<p class="section-note">No close matches — try different colours or vibes.</p>';return;}
  host.innerHTML=`<div class="set-label">${INSPO.matches.length} matches</div>
    <div style="margin:6px 0 12px"><button class="btn small" onclick="swipeInspo()">Swipe these matches</button></div>
    <div class="grid">${INSPO.matches.slice(0,18).map(sugCardHTML).join("")}</div>`;
}
function swipeInspo(){
  if(!INSPO.matches||!INSPO.matches.length)return;
  QUEUE=INSPO.matches.slice(); INSPO.matches.forEach(i=>SERVED.add(i));
  show("deck"); syncGenderToggles(); renderCard();
}

/* ---- inspiration -> a persistent seed that shapes the live swipe feed ---- */
function inspoStyleCounts(){
  const colors={}; INSPO.sel.forEach(c=>colors[c]=(colors[c]||0)+(INSPO.counts[c]||1));
  if(!Object.keys(colors).length) Object.keys(INSPO.counts).forEach(c=>colors[c]=INSPO.counts[c]);
  const styles={}; INSPO.vibes.forEach(m=>styles[m]=(styles[m]||0)+1);
  return {colors,styles};
}
function commitInspo(){
  // SET the saved inspiration from the current working set (photos + board this session),
  // so it always reflects exactly what you've added.
  const cs=inspoStyleCounts();
  S.inspo=S.inspo||{colors:{},styles:{},imgs:0,board:''};
  S.inspo.colors=cs.colors; S.inspo.styles=cs.styles; S.inspo.imgs=INSPO.imgs||0;
  save();
}
/* refresh the upcoming suggestions from the current inspiration WITHOUT wiping your swipes/cart */
function reseedFromInspo(){
  if(!INSPO.sel.size && !INSPO.vibes.size && !Object.keys(INSPO.counts).length) return;
  commitInspo();
  QUEUE=nextBatch(14);                                   // new cards, influenced by the outfits you added
  const deckVisible=!document.getElementById("deck").classList.contains("hidden");
  if(deckVisible){ syncGenderToggles(); renderCard(); }  // if you're on the cards, swap in the fresh ones now
}
function useInspoSeed(){
  if(!INSPO.sel.size && !INSPO.vibes.size && !Object.keys(INSPO.counts).length){
    document.getElementById("inspoResults").innerHTML='<p class="section-note">Add a board or a photo first, then pick the vibe.</p>';return;}
  reseedFromInspo();
  cnote("Refreshed your feed from your inspiration");
  show("deck"); syncGenderToggles(); renderCard();
}
/* return to the cards without wiping your swipes (unlike a fresh startDeck) */
function backToDeck(){
  if((QUEUE&&QUEUE.length)||Object.keys(S.reactions||{}).length){ show("deck"); syncGenderToggles(); renderCard(); }
  else startDeck();
}
/* keyword -> micro-style / colour maps, so a Pinterest board's words can seed taste */
const PIN_STYLE_WORDS={
  'streetwear':'skate-street','street style':'skate-street','skate':'skate-street','hypebeast':'skate-street','graphic tee':'band-graphic','graphic':'band-graphic','band tee':'band-graphic',
  'preppy':'ivy-prep','prep':'ivy-prep','ivy':'ivy-prep','collegiate':'ivy-prep','blazer':'ivy-prep',
  'minimal':'monochrome-minimal','minimalist':'monochrome-minimal','clean':'monochrome-minimal','monochrome':'monochrome-minimal','scandi':'scandi-minimal','scandinavian':'scandi-minimal',
  'workwear':'rugged-workwear','work wear':'rugged-workwear','carpenter':'rugged-workwear','chore':'rugged-workwear','rugged':'rugged-workwear',
  'heritage':'earthy-heritage','vintage':'earthy-heritage','americana':'earthy-heritage','retro':'earthy-heritage',
  'denim':'raw-denim','jeans':'raw-denim','raw denim':'raw-denim','selvedge':'raw-denim',
  'gorpcore':'gorpcore-utility','gorp':'gorpcore-utility','outdoor':'gorpcore-utility','hiking':'gorpcore-utility','techwear':'gorpcore-utility','utility':'gorpcore-utility','cargo':'gorpcore-utility',
  'surf':'surf-sport','surfer':'surf-sport','beach':'coastal-prep','coastal':'coastal-prep','nautical':'coastal-prep',
  'knit':'knitwear-forward','sweater':'knitwear-forward','knitwear':'knitwear-forward','cozy':'knitwear-forward','cardigan':'knitwear-forward',
  'linen':'linen-resort','resort':'linen-resort','vacation':'linen-resort','holiday':'linen-resort',
  'military':'military-surplus','army':'military-surplus','camo':'military-surplus','surplus':'military-surplus',
  'athletic':'collegiate-athletic','gym':'collegiate-athletic','sporty':'collegiate-athletic','athleisure':'collegiate-athletic','activewear':'collegiate-athletic',
  'flannel':'flannel-cabincore','plaid':'flannel-cabincore','cabincore':'flannel-cabincore','cabin':'flannel-cabincore',
  'boho':'eclectic-pattern','bohemian':'eclectic-pattern','floral':'eclectic-pattern','pattern':'eclectic-pattern','eclectic':'eclectic-pattern','colourful':'eclectic-pattern','colorful':'eclectic-pattern','print':'eclectic-pattern','y2k':'eclectic-pattern',
  'mod':'british-mod','british':'british-mod','britpop':'british-mod',
  'basics':'elevated-basics','essentials':'elevated-basics','capsule':'elevated-basics','staples':'elevated-basics',
  'crochet':'texture-craft','handmade':'texture-craft','texture':'texture-craft','artisan':'texture-craft','craft':'texture-craft'
};
const PIN_COLOR_WORDS={
  'black':'dark','noir':'dark','charcoal':'dark','dark':'dark',
  'navy':'blue','blue':'blue','indigo':'blue','denim':'blue',
  'olive':'earth','khaki':'earth','brown':'earth','tan':'earth','beige':'earth','camel':'earth','cream':'earth','taupe':'earth','rust':'earth','sand':'earth','earth tone':'earth','neutral':'neutral','white':'neutral','grey':'neutral','gray':'neutral','ecru':'neutral',
  'green':'green','sage':'green','forest':'green','emerald':'green',
  'red':'bold','pink':'bold','orange':'bold','yellow':'bold','purple':'bold','bright':'bold','neon':'bold','bold color':'bold','lilac':'bold'
};
function parsePinText(text){
  const styles={},colors={},t=' '+text+' ';
  for(const w in PIN_STYLE_WORDS){let n=0,idx=0;while((idx=t.indexOf(w,idx))>=0){n++;idx+=w.length;} if(n)styles[PIN_STYLE_WORDS[w]]=(styles[PIN_STYLE_WORDS[w]]||0)+n;}
  for(const w in PIN_COLOR_WORDS){let n=0,idx=0;while((idx=t.indexOf(w,idx))>=0){n++;idx+=w.length;} if(n)colors[PIN_COLOR_WORDS[w]]=(colors[PIN_COLOR_WORDS[w]]||0)+n;}
  const imgs=(text.match(/i\.pinimg\.com/g)||[]).length;
  return {styles,colors,imgs};
}
function describeSeed(styles,colors){
  const topS=Object.keys(styles).sort((a,b)=>styles[b]-styles[a]).slice(0,2).map(m=>MS[m]||m);
  const topC=Object.keys(colors).sort((a,b)=>colors[b]-colors[a]).slice(0,2).map(c=>COLORN[c]||c);
  const parts=[]; if(topS.length)parts.push(topS.join(' & ')); if(topC.length)parts.push(topC.join(' & '));
  return parts.join(', ')||'a general vibe';
}
/* analyse one image URL on-device (works from a local file — images load cross-origin) */
function analyzeImageUrl(url){
  return new Promise((resolve)=>{
    const img=new Image(); img.crossOrigin='anonymous';
    let done=false; const fin=(ok)=>{if(!done){done=true;resolve(ok);}};
    img.onload=()=>{
      try{
        const c=document.createElement('canvas');c.width=40;c.height=40;
        const ctx=c.getContext('2d');ctx.drawImage(img,0,0,40,40);
        const data=ctx.getImageData(0,0,40,40).data;
        for(let i=0;i<data.length;i+=4){if(data[i+3]<125)continue;const k=classifyRGB(data[i],data[i+1],data[i+2]);INSPO.counts[k]=(INSPO.counts[k]||0)+1;}
        INSPO.imgs++;
        const t=document.createElement('div');t.className='inspo-thumb';t.innerHTML='<img src="'+url+'">';
        document.getElementById('inspoThumbs').appendChild(t);
        fin(true);
      }catch(_){ fin(false); }   // tainted (no CORS on that host) — can't read pixels
    };
    img.onerror=()=>fin(false);
    setTimeout(()=>fin(false),9000);
    img.src=url;
  });
}
/* pull pin images out of a public board via a CORS helper, then read them on-device */
async function loadBoardLink(){
  const url=(document.getElementById('pinBoard').value||'').trim();
  const st=document.getElementById('pinStatus');
  if(!/pinterest\.[a-z.]+\/[^/]+\/[^/]+/i.test(url)){st.innerHTML='Paste a full public board link — like <b>pinterest.com/you/board-name/</b>.';return;}
  S.inspo=S.inspo||{colors:{},styles:{},imgs:0,board:''}; S.inspo.board=url; save();
  st.textContent='Opening your board…';
  const proxies=[
    u=>'https://api.allorigins.win/raw?url='+encodeURIComponent(u),
    u=>'https://corsproxy.io/?url='+encodeURIComponent(u),
    u=>'https://r.jina.ai/'+u
  ];
  const targets=[url, url.replace(/\/?$/,'')+'.rss'];
  let html='';
  for(const t of targets){ for(const mk of proxies){
    try{ const res=await fetch(mk(t)); if(res && res.ok){ const txt=await res.text(); if(txt && (txt.length>150||/i\.pinimg\.com/.test(txt))){ html=txt; break; } } }catch(_){}
  } if(html) break; }
  if(!html){ st.innerHTML='Couldn\'t open the board automatically (it may be private, or the helper service is busy right now). Paste a few pin image links below instead — that always works — or send me the board link in chat and I\'ll load it.'; return; }
  let imgs=[...new Set((html.match(/https:\/\/i\.pinimg\.com\/[^"'\\\s)]+?\.(?:jpg|jpeg|png|webp)/gi)||[]))];
  imgs=imgs.map(u=>u.replace(/\/\d{2,4}x\d{0,4}\//,'/564x/')).filter(u=>!/\/(30|60|75)x/.test(u));
  imgs=[...new Set(imgs)].slice(0,16);
  if(!imgs.length){ st.innerHTML='Opened the board, but Pinterest didn\'t expose the pin images to read (they\'re often behind scripts). Paste a few pin image links below instead, or send me the link in chat.'; return; }
  st.textContent='Found '+imgs.length+' pins — reading their colours…';
  let ok=0; for(const u of imgs){ if(await analyzeImageUrl(u)) ok++; }
  if(!ok){ st.innerHTML='Found pins on the board but couldn\'t read their colours here. Paste the pin image links below, or send me the link in chat.'; return; }
  renderInspoDetected(); reseedFromInspo();
  const seed=S.inspo||{styles:{},colors:{}};
  st.innerHTML='Loaded <b>'+ok+' pins</b> from your board ✓ — refreshed your suggestions from '+describeSeed(seed.styles||{},seed.colors||{})+'. Head back to swiping to see them.';
}
async function addPinLinks(){
  const st=document.getElementById('pinStatus');
  const raw=(document.getElementById('pinUrls').value||'')+' '+(document.getElementById('pinBoard').value||'');
  const urls=(raw.match(/https?:\/\/[^\s"'<>]+/gi)||[]);
  const imgUrls=urls.filter(u=>/i\.pinimg\.com/i.test(u) || /\.(jpe?g|png|webp|avif|gif)(\?|$)/i.test(u));
  const boardUrls=urls.filter(u=>/pinterest\.[a-z.]+/i.test(u) && !/i\.pinimg\.com/i.test(u));
  if(boardUrls.length){ S.inspo=S.inspo||{colors:{},styles:{},imgs:0,board:''}; S.inspo.board=boardUrls[0]; save(); }
  if(!imgUrls.length){
    st.innerHTML = boardUrls.length
      ? 'That\'s a board/pin <i>page</i> link — a local app can\'t open it. On Pinterest, right-click a pin and choose <b>Copy image address</b> (the link ends in .jpg from i.pinimg.com), paste those here. Or send me the board link in chat and I\'ll bake it in.'
      : 'Paste one or more pin <b>image</b> links (they look like https://i.pinimg.com/…​.jpg), one per line.';
    return;
  }
  st.textContent='Reading '+imgUrls.length+' pin'+(imgUrls.length>1?'s':'')+'…';
  let ok=0; for(const u of imgUrls){ if(await analyzeImageUrl(u)) ok++; }
  if(!ok){ st.innerHTML='Couldn\'t read those images (some hosts block reading their pixels). Try the pin\'s direct i.pinimg.com image link, or drop the images below — that always works.'; return; }
  renderInspoDetected();
  reseedFromInspo();   // pins added -> refresh suggestions from them right away
  document.getElementById('pinUrls').value='';
  const seed=S.inspo||{styles:{},colors:{}};
  st.innerHTML='Read '+ok+' pin'+(ok>1?'s':'')+' ✓ — refreshed your suggestions from '+describeSeed(seed.styles||{},seed.colors||{})+'. Head back to swiping to see them.';
}

/* seed chips: the most common micro-styles */
(function initSeeds(){
  const counts={}; CATALOG.forEach(p=>p.ms.forEach(m=>counts[m]=(counts[m]||0)+1));
  const top=Object.keys(MS).sort((a,b)=>(counts[b]||0)-(counts[a]||0)).slice(0,12);
  document.getElementById("seedChips").innerHTML=top.map(k=>`<div class="chip" onclick="toggleSeed('${k}',this)">${MS[k]}</div>`).join("");
})();
function toggleSeed(k,el){const i=S.seeds.indexOf(k);if(i>=0){S.seeds.splice(i,1);el.classList.remove("on");}else{S.seeds.push(k);el.classList.add("on");}}
