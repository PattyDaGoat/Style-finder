const { chromium } = require('playwright');
const { join, dirname } = require('node:path');
const REPO = dirname(dirname(require('node:fs').realpathSync(__filename)));
const DIST = join(REPO, 'dist', 'style-finder.html');
const DIST_URL = 'file://' + DIST;
require('node:fs').mkdirSync('/tmp/sf-shots', { recursive: true });
require('node:fs').mkdirSync('/tmp/sf/work', { recursive: true });   /* suite C writes a patched copy here */

const fs=require('fs');
const ok=[],bad=[];
const chk=(n,c,e)=>(c?ok:bad).push(n+(e?' :: '+e:''));
async function settle(p){await p.waitForLoadState('load').catch(()=>{});await p.waitForFunction("typeof storeKey==='function'",null,{timeout:30000});await p.waitForTimeout(500);}

(async()=>{
 const b=await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});

 // ---------- A. deck layout: top bar must not collide with the cart buttons ----------
 const c1=await b.newContext({viewport:{width:1100,height:1000}});
 const p1=await c1.newPage();
 const errs=[];p1.on('pageerror',e=>errs.push('PAGEERROR: '+e.message));
 await p1.goto(DIST_URL);await settle(p1);
 chk('duplicate page logo hidden on auth screen', await p1.evaluate("getComputedStyle(document.querySelector('header.top')).display==='none'"));
 await p1.click('text=Continue as guest'); await p1.waitForTimeout(500);
 chk('page logo restored after sign-in', await p1.evaluate("getComputedStyle(document.querySelector('header.top')).display!=='none'"));
 await p1.click('#topSizes .size-chip >> nth=2');
 await p1.click('text=Next →'); await p1.waitForTimeout(250);
 await p1.click('text=Start shopping'); await p1.waitForTimeout(1600);
 chk('deck reached as guest', await p1.isVisible('#deck'));
 const geo=await p1.evaluate(()=>{
   const r=s=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return {x:b.x,y:b.y,r:b.right,bt:b.bottom};};
   return {bar:r('#appbar'),restart:r('.ab-restart'),chip:r('#acctChip'),cart:r('#cartFab'),like:r('#likeFab'),gear:r('#gearBtn')};
 });
 const overlap=(a,c)=>a&&c&&!(a.r<c.x||c.r<a.x||a.bt<c.y||c.bt<a.y);
 chk('Start over does not overlap cart button', !overlap(geo.restart,geo.cart), JSON.stringify(geo.restart)+' vs '+JSON.stringify(geo.cart));
 chk('account chip does not overlap cart button', !overlap(geo.chip,geo.cart));
 chk('account chip does not overlap likes button', !overlap(geo.chip,geo.like));
 chk('cart + likes buttons still visible on deck', await p1.isVisible('#cartFab') && await p1.isVisible('#likeFab'));
 chk('Profile (gear) button still works', await p1.isVisible('#gearBtn'));
 await p1.screenshot({path:'/tmp/sf-shots/shot-deck.png'});
 await p1.click('.ab-restart'); await p1.waitForTimeout(300);
 await p1.screenshot({path:'/tmp/sf-shots/shot-modal.png'});
 await p1.click('#resetOverlay >> text=Cancel');
 // gear -> profile still routes correctly and appbar persists
 await p1.click('#gearBtn'); await p1.waitForTimeout(400);
 chk('Profile button opens settings with top bar intact', await p1.isVisible('#settings') && await p1.isVisible('#appbar'));

 // ---------- B. mobile width ----------
 const c2=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const p2=await c2.newPage();
 await p2.goto(DIST_URL);await settle(p2);
 await p2.click('text=Continue as guest'); await p2.waitForTimeout(400);
 await p2.click('#topSizes .size-chip >> nth=2');
 await p2.click('text=Next →'); await p2.waitForTimeout(250);
 await p2.click('text=Start shopping'); await p2.waitForTimeout(1700);
 const m=await p2.evaluate(()=>{
   const r=s=>{const e=document.querySelector(s);const b=e.getBoundingClientRect();return {x:b.x,y:b.y,r:b.right,bt:b.bottom};};
   return {restart:r('.ab-restart'),chip:r('#acctChip'),cart:r('#cartFab'),like:r('#likeFab'),vw:innerWidth};
 });
 const ov=(a,c)=>!(a.r<c.x||c.r<a.x||a.bt<c.y||c.bt<a.y);
 chk('MOBILE: Start over does not overlap cart', !ov(m.restart,m.cart), JSON.stringify(m));
 chk('MOBILE: chip does not overlap cart', !ov(m.chip,m.cart));
 chk('MOBILE: chip does not overlap likes', !ov(m.chip,m.like));
 chk('MOBILE: nothing spills off screen', m.chip.r <= m.vw+1, 'chipRight='+m.chip.r+' vw='+m.vw);
 await p2.screenshot({path:'/tmp/sf-shots/shot-mobile.png'});

 // ---------- C. real Google path (CLIENT_ID filled in) ----------
 const src=fs.readFileSync(DIST,'utf8');
 const withId=src.replace('const GOOGLE_CLIENT_ID = "";','const GOOGLE_CLIENT_ID = "123456789-testclientid.apps.googleusercontent.com";');
 chk('CLIENT_ID slot is findable by exact one-line edit', withId!==src);
 fs.writeFileSync('/tmp/sf/work/withid.html',withId);
 const c3=await b.newContext({viewport:{width:1100,height:900}});
 const p3=await c3.newPage();
 const e3=[];p3.on('pageerror',e=>e3.push(e.message));
 await p3.goto('file:///tmp/sf/work/withid.html');await settle(p3);

 // sign-in area must never be blank at ANY point while Google loads
 let blankFrames=0, seenSomething=0;
 for(let i=0;i<26;i++){
   const st=await p3.evaluate(()=>{
     const r=document.getElementById('gReal'), f=document.getElementById('gFallback');
     const vis=e=>e&&!e.classList.contains('hidden')&&e.getBoundingClientRect().height>4;
     const host=document.getElementById('gBtnHost');
     const realHasContent=vis(r)&&(host.textContent.trim().length>0||host.children.length>0);
     return {any:(realHasContent||vis(f))};
   });
   if(st.any)seenSomething++; else blankFrames++;
   await p3.waitForTimeout(300);
 }
 chk('sign-in area is never blank while Google loads', blankFrames===0, 'blankFrames='+blankFrames+'/'+(blankFrames+seenSomething));
 const real=await p3.isVisible('#gReal'), fb=await p3.isVisible('#gFallback');
 chk('with CLIENT_ID: shows real Google block OR degrades to fallback (never both, never neither)', real!==fb, 'real='+real+' fallback='+fb);
 chk('with CLIENT_ID: guest escape hatch still present', await p3.isVisible('text=Continue as guest'));
 chk('with CLIENT_ID: no uncaught JS errors', e3.length===0, e3.join('|'));
 const gisLoaded=await p3.evaluate("!!(window.google&&google.accounts&&google.accounts.id)");
 chk('GIS script reachable in this sandbox (informational)', true, 'loaded='+gisLoaded+' -> took '+(real?'REAL button path':'graceful fallback path'));
 if(real){ chk('real Google button actually rendered into host', (await p3.$$('#gBtnHost iframe, #gBtnHost div[role=button]')).length>0 || (await p3.evaluate("document.getElementById('gBtnHost').children.length>0"))); }

 // ---------- D. JWT decoder correctness ----------
 const jwtOk=await p3.evaluate(()=>{
   const payload={sub:"1099", name:"Pátrick Sütton", email:"p@gmail.com", picture:"https://x/y.png"};
   const b64=btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
   const tok="hdr."+b64+".sig";
   try{ const d=decodeJWT(tok); return d.sub==="1099" && d.name==="Pátrick Sütton" && d.email==="p@gmail.com"; }catch(e){ return 'ERR '+e.message; }
 });
 chk('Google token decoder handles real payloads incl. accents/base64url', jwtOk===true, 'got='+jwtOk);

 // ---------- E. account creation from a Google token ----------
 const flow=await p3.evaluate(()=>{
   const payload={sub:"777", name:"Test User", email:"test@gmail.com", picture:""};
   const b64=btoa(JSON.stringify(payload)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
   onGoogleCredential({credential:"h."+b64+".s"});
   return {acctId:ACCOUNT&&ACCOUNT.id, kind:ACCOUNT&&ACCOUNT.kind, key:storeKey(),
           registered:accounts().map(a=>a.id), last:localStorage.getItem('styleDNA_lastAccount')};
 });
 await p3.waitForTimeout(500);
 chk('simulated Google sign-in creates a google-kind account', flow.kind==='google', JSON.stringify(flow));
 chk('google account id is namespaced by Google subject id', flow.acctId==='g_777');
 chk('storage key follows the google account', flow.key==='styleDNA_v3::g_777');
 chk('signed-in google account remembered for next visit', flow.last==='g_777');
 chk('simulated google sign-in lands in the app', await p3.isVisible('#settings'));
 chk('top bar appears for google account', await p3.isVisible('.ab-restart'));

 await b.close();
 console.log('\n===== PASS ('+ok.length+') =====');ok.forEach(t=>console.log('  ok  '+t));
 if(bad.length){console.log('\n===== FAIL ('+bad.length+') =====');bad.forEach(t=>console.log('  FAIL '+t));}
 if(errs.length){console.log('\nERRORS: '+[...new Set(errs)].join(' | '));}
 console.log('\n'+(bad.length||errs.length?'>>> PROBLEMS FOUND':'>>> ALL GREEN'));
})();
