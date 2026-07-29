/* ---------- brand links ---------- */
const BRAND_HOME={"Taylor Stitch":"https://www.taylorstitch.com/collections/mens","Wax London":"https://waxlondon.com/collections/all","Adsum":"https://www.adsumnyc.com/collections/all","Corridor NYC":"https://www.corridornyc.com/collections/all","Rowing Blazers":"https://rowingblazers.com/collections/mens","Percival":"https://www.percivalclo.com/collections/mens","Kestin":"https://kestin.co/collections/all","Portuguese Flannel":"https://portugueseflannel.com/collections/all","3sixteen":"https://www.3sixteen.com/collections/all","Noah":"https://noahny.com/collections/all","Stan Ray":"https://stanray.com/collections/all","Battenwear":"https://battenwear.com/collections/all","Alex Mill":"https://www.alexmill.com/collections/mens","Universal Works":"https://universalworks.co.uk/collections/all","Marine Layer":"https://www.marinelayer.com/collections/mens","Bather":"https://bather.com/collections/all"};
function brandLinks(){
  const bs=topKeys(MODEL.brand,6,true);
  const all=bs.length?bs:Object.keys(BRAND_HOME).slice(0,6);
  return all.map(b=>`<a class="storelink" target="_blank" rel="noopener" href="${BRAND_HOME[b]||'#'}">${b} &rarr;</a>`).join("");
}

/* ---------- export ---------- */
function dnaSummary(){
  const W=MODEL;
  return {styleDNA:topKeys(W.ms,4,true).map(m=>MS[m]),microStyleKeys:topKeys(W.ms,4,true),
    colors:topKeys(W.color,3,true).map(c=>COLORN[c]||c),patterns:topKeys(W.pat,3,true).map(c=>PATN[c]||c),
    fabrics:topKeys(W.fab,4,true),categories:POSCATS.map(c=>CATN[c]||c),favoriteBrands:topKeys(W.brand,5,true),
    byGarment:groupTaste().reduce((o,x)=>{o[x.label]=x.text;return o;},{}),
    loved:Object.keys(S.reactions).filter(k=>S.reactions[k]==="love").map(i=>({brand:CATALOG[i].b,name:CATALOG[i].n,price:CATALOG[i].cur+CATALOG[i].p,url:CATALOG[i].u})),
    shortlist:S.picks.map(i=>({brand:CATALOG[i].b,name:CATALOG[i].n,price:CATALOG[i].cur+CATALOG[i].p,url:CATALOG[i].u})),
    budget:(function(){var mb=(S.settings&&S.settings.maxBudget)||100000;return mb>=100000?"no set limit (includes designer)":("under $"+mb+" per piece");})()};
}
function downloadDNA(){const b=new Blob([JSON.stringify(dnaSummary(),null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download="my-style-dna.json";a.click();cnote("Saved my-style-dna.json");}
function restart(){startDeck();}
function resumeResults(){const s=load();if(s&&s.reactions&&Object.keys(s.reactions).length>=8){S=s;buildModel();buildResults();show("results");}}
