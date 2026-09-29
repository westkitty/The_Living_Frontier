import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const server=spawn('python3',['-m','http.server','8080','--bind','127.0.0.1'],{stdio:['ignore','pipe','pipe']});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ids=['player.phase2','human.villager-male.phase2','human.villager-female.phase2','human.soldier-male.phase2','human.soldier-female.phase2'];

try{
  await sleep(800);
  const browser=await chromium.launch({headless:true,args:['--use-angle=swiftshader','--enable-webgl','--ignore-gpu-blocklist']});
  for(const [name,viewport] of [['desktop',{width:1280,height:800}],['mobile-viewport',{width:390,height:844}]]){
    const page=await browser.newPage({viewport}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
    await page.goto('http://127.0.0.1:8080/phase2-human-probe.html',{waitUntil:'networkidle'});
    await page.waitForFunction(()=>window.__LF_HUMANS?.ready||window.__LF_HUMANS?.error,null,{timeout:30000});
    const readyError=await page.evaluate(()=>window.__LF_HUMANS?.error||null);
    if(readyError)throw new Error(`${name}: ${readyError}`);
    for(const id of ids){
      const result=await page.evaluate(async assetId=>{
        const p=window.__LF_HUMANS;
        const a=await p.show(assetId);
        await new Promise(resolve=>setTimeout(resolve,220));
        const c=document.querySelector('#c');
        return {asset:a,png:c.toDataURL('image/png').length,webgl:!!c.getContext('webgl2')||!!c.getContext('webgl'),camera:p.cameraState()};
      },id);
      const a=result.asset;
      if(!result.webgl||result.png<8000)throw new Error(`${name}: blank/unavailable WebGL for ${id}`);
      if(!a.meshes||!a.skinned||!a.animations.includes('Idle')||!a.animations.includes('Walk')||!a.animations.includes('Run')||!a.animations.includes('Death'))throw new Error(`${name}: incomplete human runtime ${id}`);
      if(!(result.camera.fitDistance>=2.5&&result.camera.fitDistance<=5.5))throw new Error(`${name}: invalid review framing for ${id}`);
      const slug=id.replace(/[^a-z0-9-]+/gi,'-');
      const shot=await page.locator('#c').screenshot({path:`/tmp/lf-phase2-human-${slug}-${name}.png`});
      if(shot.length<8000)throw new Error(`${name}: ${id} screenshot blank`);
    }
    if(errors.length)throw new Error(`${name}: browser errors ${errors.join(' | ')}`);
    console.log(`PHASE2 HUMAN BROWSER PASS ${name}`);
    await page.close();
  }
  await browser.close();
}finally{server.kill('SIGTERM');}
