import * as THREE from 'three';
import { ChunkManager } from '../src/terrain.js';
import { Vegetation } from '../src/veg.js';
import { WorldState } from '../src/worldstate.js';
import { heightAt } from '../src/worldgen.js';
globalThis.btoa=(s)=>Buffer.from(s,'binary').toString('base64');
const st = new WorldState();
const scene = new THREE.Scene();
const cm = new ChunkManager(scene, st);
const veg = new Vegetation(scene, st);
cm.onChunkBuild=(k,rec,ring)=>veg.buildChunk(k,rec,ring);
cm.onChunkRemove=(k)=>veg.removeChunk(k);
cm.onRingChange=(k,rec,ring)=>veg.setRing(k,ring);
let t0=performance.now();
cm.update(0,0,999);
console.log('initial 49 chunks:', (performance.now()-t0).toFixed(0),'ms');
// measure per-chunk cost while walking
const times=[];
for (let step=1; step<=12; step++){
  const x=(step%6)*180, z=(step<6?0:180);
  const t=performance.now();
  cm.update(x,z,999);
  times.push(performance.now()-t);
}
console.log('per chunk-row crossing (ms):', times.map(t=>t.toFixed(0)).join(' '));
// heightAt throughput
t0=performance.now(); let acc=0; for(let i=0;i<200000;i++) acc+=heightAt(i*0.7%2000-1000, i*1.3%2000-1000);
console.log('heightAt: ', (200000/((performance.now()-t0)/1000)/1000).toFixed(0),'k calls/sec');
let tris=0, meshes=0;
scene.traverse(o=>{ if(o.isMesh){meshes++; const g=o.geometry; tris += (g.index?g.index.count:g.attributes.position.count)/3 * (o.isInstancedMesh?o.count:1);} });
console.log('scene meshes(draw calls):', meshes, '| triangles:', Math.round(tris).toLocaleString());

if (meshes > 96 || tris > 79932 * 1.25) throw new Error('Canopy budget exceeded: max 96 draws / 99,915 triangles');
