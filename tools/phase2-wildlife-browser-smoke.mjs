import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
const server=spawn('python3',['-m','http.server','8080','--bind','127.0.0.1'],{stdio:['ignore','pipe','pipe']});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
 await sleep(800);
 const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
 for(const [name,viewport] of [['desktop',{width:1280,height:800}],['mobile-viewport',{width:390,height:844}]]){
  const page=await browser.newPage({viewport}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
  await page.goto('http://127.0.0.1:8080/phase2-wildlife-probe.html',{waitUntil:'networkidle'});
  await page.waitForFunction(()=>window.__LF_WILDLIFE?.ready||window.__LF_WILDLIFE?.error,null,{timeout:30000});
  const r=await page.evaluate(async()=>{const p=window.__LF_WILDLIFE;if(p.error)return{error:p.error};const out={};for(const id of Object.keys(p.results)){out[id]=await p.show(id);await new Promise(r=>setTimeout(r,120))}const c=document.querySelector('#c');return{out,png:c.toDataURL('image/png').length,webgl:!!c.getContext('webgl2')||!!c.getContext('webgl')}});
  if(r.error)throw new Error(`${name}: ${r.error}`);if(!r.webgl||r.png<8000)throw new Error(`${name}: blank/unavailable WebGL wildlife probe`);
  for(const [id,a] of Object.entries(r.out)){if(!a.meshes||!a.skinned||!a.animations.length)throw new Error(`${name}: incomplete animated wildlife ${id}`);if((a.nodeNames||[]).some(n=>['Plane','Camera','Hemi','Hemi.001','Lamp'].includes(n)))throw new Error(`${name}: source helper leaked into ${id}`)}
  if(errors.length)throw new Error(`${name}: browser errors ${errors.join(' | ')}`);
  const shot=await page.locator('#c').screenshot({path:`/tmp/lf-phase2-wildlife-${name}.png`});if(shot.length<8000)throw new Error(`${name}: wildlife screenshot blank`);
  console.log(`PHASE2 WILDLIFE BROWSER PASS ${name}`,JSON.stringify(r.out));await page.close();
 }
 await browser.close();
}finally{server.kill('SIGTERM')}
