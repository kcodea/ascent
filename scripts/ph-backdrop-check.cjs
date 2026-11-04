// THE ONE-BACKDROP CHECK (party home prototype, owner 2026-11-04). A cold, slow or failed page chunk must never show another
// background. Needs a prod-like build with the prototype on, served on :5358, and PWC / PWEXE / SHARP env paths (playwright-core,
// the headless shell, sharp). Writes a frame strip per case; exits 1 if a frame goes bright (foreign art) or the crash screen shows.
// node scripts/ph-backdrop-check.cjs <label> [case...]
const path=require('path');const fs=require('fs');const sharp=require(process.env.SHARP);const {chromium}=require(process.env.PWC);
const label=process.argv[2];const only=process.argv.slice(3);
const CASES=[['boot-slow','PartyHome|PhTopNav',null,'delay'],['career-slow','PhCareer','Career','delay'],['collection-slow','CollectionPh','Collection','delay'],['crates-slow','CrateShopPh','Crates','delay'],['leaderboard-slow','PhLeaderboard','Leaderboard','delay'],['recent-slow','RecentGamesPh','Recent Games','delay'],['live-slow','LiveGamesPh','Live Games','delay'],['patch-slow','PhPatchNotes','Patch Notes','delay'],['compendium-slow','PhCompendium|PhBookNav','Compendium','delay'],['settings-slow','PhSettings','Settings','delay'],['chrome-slow','PhPageChrome','Career','delay'],['leaderboard-fail','PhLeaderboard','Leaderboard','abort'],['recent-fail','RecentGamesPh','Recent Games','abort'],['live-fail','LiveGamesPh','Live Games','abort'],['settings-fail','PhSettings','Settings','abort'],['compendium-fail','PhCompendium|PhBookNav','Compendium','abort'],['boot-fail','PartyHome-',null,'abort']];
const OUT=path.join(process.env.PH_OUT||__dirname,'r16',label);fs.mkdirSync(OUT,{recursive:true});
// the reference: the steady art in the region, per run, is the median frame; a "foreign" frame differs in the sky band
const stat=async(buf)=>{const {data,info}=await sharp(buf).extract({left:40,top:60,width:560,height:70}).resize(16,4).raw().toBuffer({resolveWithObject:true});let r=0,g=0,b=0;const n=info.width*info.height;for(let i=0;i<n;i++){r+=data[i*info.channels];g+=data[i*info.channels+1];b+=data[i*info.channels+2]}return[r/n,g/n,b/n].map(x=>Math.round(x))};
(async()=>{const sum=[];
for(const [name,pat,click,how] of CASES){if(only.length&&!only.includes(name))continue;
const ctx=await chromium.launchPersistentContext(process.env.PW_PROFILE||path.join(__dirname,'pw-r11-d1920'),{headless:true,ignoreDefaultArgs:['--hide-scrollbars'],executablePath:process.env.PWEXE,viewport:{width:1920,height:1080}});
const page=ctx.pages()[0]||await ctx.newPage();const c=await ctx.newCDPSession(page);await c.send('Network.enable');await c.send('Network.setCacheDisabled',{cacheDisabled:true});
const re=new RegExp('/assets/('+pat+')[^/]*\.js');
const hold=async()=>page.route(re,async r=>{if(how==='abort')return r.abort();await new Promise(x=>setTimeout(x,1800));r.continue()});
if(click&&how==='abort')await page.addInitScript(()=>{window.requestIdleCallback=()=>0});
if(!(click&&how==='abort'))await hold();
const frames=[];c.on('Page.screencastFrame',async f=>{frames.push({t:Date.now(),d:Buffer.from(f.data,'base64')});await c.send('Page.screencastFrameAck',{sessionId:f.sessionId}).catch(()=>{})});
await page.on('pageerror',e=>console.log('PE',e.message.slice(0,200)));page.on('console',m=>{if(m.type()==='error'&&process.env.V)console.log('CE',m.text().slice(0,300))});page.on('requestfailed',r=>{if(process.env.V)console.log('RF',r.url().slice(-50))});await page.goto('http://localhost:5358/?partyhome=1&partydemo=1',{waitUntil:'commit',timeout:60000});
await page.addStyleTag({content:'[class*=perf]{display:none!important}'}).catch(()=>{});
await c.send('Page.startScreencast',{format:'jpeg',quality:55,maxWidth:640,maxHeight:360,everyNthFrame:1});
if(click){await page.waitForFunction(()=>document.querySelectorAll('.ph-navtab').length>3,null,{timeout:120000,polling:100});await page.waitForTimeout(250);if(how==='abort')await hold();frames.length=0;
 await page.evaluate((n)=>[...document.querySelectorAll(`.ph-top [aria-label="${n}"]`)].pop()?.click(),click);await page.waitForTimeout(how==='abort'?1500:2600);}
else{await page.waitForTimeout(9000);}
await c.send('Page.stopScreencast');
const end=await page.evaluate(()=>({crashTxt:document.querySelector('.crash,.errbound,[class*=crash]')?.innerText?.slice(0,220)||null,txt:document.body.innerText.slice(0,0),h1:[...document.querySelectorAll('h1')].pop()?.innerText||null,crash:!!document.querySelector('.crash,.errbound,[class*=crash]'),nav:[...document.querySelectorAll('.ph-top')].length,fail:document.querySelector('.ph-pagefail')?.innerText||null,tsBg:getComputedStyle(document.querySelector('.titlescreen')||document.body).backgroundImage.slice(0,60)}));
const st=[];for(const f of frames)st.push(await stat(f.d));
const lum=st.map(s=>Math.round((s[0]+s[1]+s[2])/3));const blue=st.map(s=>s[2]-s[0]);
const pick=[];const step=Math.max(1,Math.floor(frames.length/6));for(let i=0;i<frames.length&&pick.length<6;i+=step)pick.push(frames[i]);
if(pick.length){const W=320,H=180;const comp=await Promise.all(pick.map(async(f,i)=>({input:await sharp(f.d).resize(W,H).toBuffer(),left:i*W,top:0})));await sharp({create:{width:W*6,height:H,channels:3,background:'#000'}}).composite(comp).jpeg({quality:70}).toFile(path.join(OUT,name+'.jpg'))}
const line={name,frames:frames.length,lum:[Math.min(...lum),Math.max(...lum)],blue:[Math.min(...blue),Math.max(...blue)],end};sum.push(line);console.log(JSON.stringify(line).slice(0,520));
await ctx.close()}
fs.writeFileSync(path.join(OUT,'summary.json'),JSON.stringify(sum,null,1));const bad=sum.filter((l)=>l.lum[1]>110||l.end.crash);if(bad.length){console.log('FAIL',bad.map((l)=>l.name).join(' '));process.exit(1)}console.log('PASS',sum.length);})().catch(e=>{console.log('ERR',e.message.slice(0,240));process.exit(1)});
