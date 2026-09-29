import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = process.cwd();
const sourceHash = process.argv[2];
if (!/^[0-9a-f]{64}$/.test(sourceHash || '')) throw new Error('missing/invalid human source archive hash');

const manifestPath = path.join(root, 'docs/resources/VISUAL_ASSET_MANIFEST.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const specs = [
  { id:'player.phase2', file:'characters/player-phase2.glb', sourceLabel:'Viking_Male', presentation:{targetHeight:1.82,ground:true,centerXZ:true} },
  { id:'human.villager-male.phase2', file:'characters/villager-male-phase2.glb', sourceLabel:'Worker_Male', presentation:{targetHeight:1.78,ground:true,centerXZ:true} },
  { id:'human.villager-female.phase2', file:'characters/villager-female-phase2.glb', sourceLabel:'Worker_Female', presentation:{targetHeight:1.72,ground:true,centerXZ:true} },
  { id:'human.soldier-male.phase2', file:'characters/soldier-male-phase2.glb', sourceLabel:'Soldier_Male', presentation:{targetHeight:1.8,ground:true,centerXZ:true} },
  { id:'human.soldier-female.phase2', file:'characters/soldier-female-phase2.glb', sourceLabel:'Soldier_Female', presentation:{targetHeight:1.74,ground:true,centerXZ:true} },
];

function sha256(buf){return 'sha256:'+crypto.createHash('sha256').update(buf).digest('hex');}
function inspectGlb(buf){
  if(buf.length<20||buf.toString('utf8',0,4)!=='glTF'||buf.readUInt32LE(4)!==2) throw new Error('invalid GLB');
  let offset=12,json=null;
  while(offset+8<=buf.length){
    const len=buf.readUInt32LE(offset),type=buf.readUInt32LE(offset+4); offset+=8;
    if(offset+len>buf.length) throw new Error('GLB chunk exceeds file');
    if(type===0x4E4F534A) json=JSON.parse(buf.toString('utf8',offset,offset+len).trim());
    offset+=len;
  }
  if(!json) throw new Error('missing glTF JSON');
  const externalUris=[];
  for(const b of json.buffers||[]) if(b.uri&&!b.uri.startsWith('data:')) externalUris.push(b.uri);
  for(const i of json.images||[]) if(i.uri&&!i.uri.startsWith('data:')) externalUris.push(i.uri);
  return {
    nodes:json.nodes?.length||0,
    nodeNames:(json.nodes||[]).map((n,i)=>n.name||`node_${i}`),
    meshes:json.meshes?.length||0,
    meshNames:(json.meshes||[]).map((m,i)=>m.name||`mesh_${i}`),
    primitives:(json.meshes||[]).reduce((n,m)=>n+(m.primitives?.length||0),0),
    materials:json.materials?.length||0,
    materialNames:(json.materials||[]).map((m,i)=>m.name||`material_${i}`),
    textures:json.textures?.length||0,
    images:json.images?.length||0,
    skins:json.skins?.length||0,
    animations:json.animations?.length||0,
    animationNames:(json.animations||[]).map((a,i)=>a.name||`animation_${i}`),
    extensionsUsed:json.extensionsUsed||[],
    extensionsRequired:json.extensionsRequired||[],
    externalUris,
  };
}

const requiredClips=['Idle','Walk','Run','Death','PickUp'];
const next=[];
for(const spec of specs){
  const file=path.join(root,'assets/runtime',spec.file);
  const buf=fs.readFileSync(file),stats=inspectGlb(buf);
  if(buf.length>8388608) throw new Error(`${spec.id} exceeds Phase 2 single-asset budget`);
  if(!stats.meshes||!stats.skins||!stats.animations) throw new Error(`${spec.id} missing mesh/skin/animation`);
  if(stats.externalUris.length) throw new Error(`${spec.id} has external URIs`);
  for(const clip of requiredClips) if(!stats.animationNames.includes(clip)) throw new Error(`${spec.id} missing required clip ${clip}`);
  next.push({
    id:spec.id,type:'model',uri:`../../assets/runtime/${spec.file}`,
    sourceHash:`sha256:${sourceHash}`,runtimeHash:sha256(buf),bytes:buf.length,
    dependencies:[],preload:false,streamGroup:'phase2-humans',
    memoryBudgetBytes:33554432,
    licenseRecordId:'quaternius-animated-characters-pack-cc0',
    provenanceRecordId:'quaternius-animated-characters-pack',
    disposalPolicy:'asset-manager-refcount-cache',
    collisionStrategy:'existing-gameplay-controller-no-model-collider',
    lodGroup:null,sourceVariant:spec.sourceLabel,presentation:spec.presentation,stats
  });
}

const replaceIds=new Set(next.map(a=>a.id));
manifest.assets=manifest.assets.filter(a=>!replaceIds.has(a.id)).concat(next);
manifest.generatedAt=new Date().toISOString();
fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({phase2Humans:next.map(a=>({id:a.id,bytes:a.bytes,variant:a.sourceVariant,animations:a.stats.animationNames}))},null,2));
