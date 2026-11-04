/* eslint-disable @typescript-eslint/no-require-imports */
// THE IN-GAME MENU SWEEP (party home prototype): every page opened from the in-game menu has the shell look, one host, Back, and returns to the game. Prod-like build on :5358, env PWC / PWEXE; node scripts/ph-ingame-check.cjs <d1920|d1366|iph>
const path=require('path');const {chromium}=require(process.env.PWC);const [mode,off]=process.argv.slice(2);
const V={d1920:{viewport:{width:1920,height:1080}},d1366:{viewport:{width:1366,height:768}},iph:{viewport:{width:844,height:390},deviceScaleFactor:2,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'},touch:{viewport:{width:844,height:390},deviceScaleFactor:1,hasTouch:true}}[mode];
const P={d1920:'pw-r11-d1920',d1366:'pw-r11-d1366',iph:'pw-r11-phone',touch:'pw-r11-touch1'}[mode];
(async()=>{const ctx=await chromium.launchPersistentContext(path.join(__dirname,P),{headless:true,ignoreDefaultArgs:['--hide-scrollbars'],executablePath:process.env.PWEXE,...V});
const page=ctx.pages()[0]||await ctx.newPage();page.on('pageerror',e=>console.log('PE',e.message.slice(0,140)));
// A test game must never reach the live backend (it would list on Live Games): only this machine is reachable.
await page.route((u)=>u.hostname!=='localhost',(r)=>r.abort());
await page.goto('http://localhost:5358/?partyhome=1&partydemo=0',{waitUntil:'commit',timeout:60000});await page.waitForFunction(()=>document.querySelectorAll('.ph-navhost .ph-navtab').length>3,null,{timeout:120000,polling:200});await page.waitForTimeout(2200);await page.addStyleTag({content:'[class*=perf]{display:none!important}'});
await page.evaluate(()=>[...document.querySelectorAll('.ph-modes .phk-tab')].find(b=>/practice/i.test(b.textContent))?.click());await page.waitForTimeout(500);
await page.evaluate(()=>document.querySelector('.ph-start')?.click());await page.waitForTimeout(700);await page.evaluate(()=>[...document.querySelectorAll('.phk-dialog button')].find(b=>/start new/i.test(b.textContent))?.click());await page.waitForTimeout(2600);
const hero=await page.evaluate(()=>{const r=document.querySelector('.herocard')?.getBoundingClientRect();return r?{x:r.x+r.width/2,y:r.y+r.height/2}:null});console.log('hero',!!hero);
if(hero){if(mode==='iph'||mode==='touch')await page.touchscreen.tap(hero.x,hero.y);else await page.mouse.click(hero.x,hero.y);}
await page.waitForTimeout(3200);await page.evaluate(()=>[...document.querySelectorAll('button')].find(b=>/start game/i.test(b.textContent))?.click());
await page.waitForFunction(()=>!document.querySelector('.heroselect')&&!document.querySelector('.titlescreen'),null,{timeout:30000,polling:300}).catch(()=>console.log('no game'));await page.waitForTimeout(6000);
await page.screenshot({path:`r6/r21-${mode}-game.png`});
for(let i=0;i<4;i++){if(await page.evaluate(()=>!!document.querySelector('.gmenu')))break;await page.keyboard.press('Escape');await page.waitForTimeout(1500)}await page.screenshot({path:`r6/r21-${mode}-menu.png`});
const rows=await page.evaluate(()=>[...document.querySelectorAll('.gmenu .msb button')].map(b=>(b.getAttribute('aria-label')||b.textContent).trim().slice(0,16)));console.log(mode,'rail',rows.join('|'));
for(const n of ['Career','Collection','Leaderboard','Recent Games','Live Games','Patch Notes','Settings']){
 const ok=await page.evaluate((n)=>{const b=[...document.querySelectorAll('.gmenu .msb button')].find(x=>(x.getAttribute('aria-label')||x.textContent).trim().toLowerCase().startsWith(n.toLowerCase()));b?.click();return !!b},n);await page.waitForTimeout(1500);
 const st=await page.evaluate(()=>({shell:document.documentElement.hasAttribute('data-ph-shell'),ing:document.documentElement.hasAttribute('data-ph-ingame'),steady:document.querySelectorAll('.ph-steady').length,pg:[...document.querySelectorAll('.phk-page')].filter(e=>getComputedStyle(e).visibility!=='hidden').map(e=>e.querySelector('h1')?.innerText).join(),back:!![...document.querySelectorAll('.phk-back')].length,hosts:[...document.querySelectorAll('.lbpage')].filter(e=>getComputedStyle(e).visibility!=='hidden').length,rail:[...document.querySelectorAll('.msb')].filter(e=>getComputedStyle(e).visibility!=='hidden').length}));console.log(mode,n,ok,JSON.stringify(st));await page.screenshot({path:`r6/r21-${mode}-${n.replace(' ','')}.png`});
 await page.evaluate(()=>{const b=document.querySelector('.phk-back');b?.click()});await page.waitForTimeout(500);
 const a=await page.evaluate(()=>({shell:document.documentElement.hasAttribute('data-ph-shell'),gmenu:!!document.querySelector('.gmenu'),steady:document.querySelectorAll('.ph-steady').length}));if(a.shell||!a.gmenu||a.steady)console.log('  after back',JSON.stringify(a));}
await page.keyboard.press('Escape');await page.waitForTimeout(500);console.log('resumed',await page.evaluate(()=>({gmenu:!!document.querySelector('.gmenu'),shell:document.documentElement.hasAttribute('data-ph-shell')})));
await ctx.close()})().catch(e=>{console.log('ERR',e.message.slice(0,200));process.exit(1)});
