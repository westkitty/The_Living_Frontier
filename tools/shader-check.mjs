// Assembles the real Three.js shaders with our onBeforeCompile injections,
// resolves #include chunks, and parses the result to catch GLSL syntax errors
// (we cannot run a GPU in this environment). Run with: npm run shaders
import * as THREE from 'three';
import { FX } from '../src/fx.js';
import { WorldState } from '../src/worldstate.js';
import { parser } from '@shaderfrog/glsl-parser';
import { preprocess } from '@shaderfrog/glsl-parser/preprocessor/index.js';

const includePattern = /^[ \t]*#include +<([\w\d./]+)>/gm;
function resolveIncludes(src) {
  let out = src, guard = 0;
  while (includePattern.test(out) && guard++ < 12) {
    out = out.replace(includePattern, (m, name) => {
      const chunk = THREE.ShaderChunk[name];
      return chunk ? resolveIncludes(chunk) : '';
    });
    includePattern.lastIndex = 0;
  }
  return out;
}

// GLSL ES 1.0 preamble roughly matching what WebGLProgram prepends.
const VERT_PRE = `
precision highp float; precision highp int;
#define SHADER_NAME test
#define USE_COLOR
#define USE_INSTANCING
#define USE_FOG
#define USE_SHADOWMAP
#define NUM_DIR_LIGHTS 1
#define NUM_POINT_LIGHTS 1
#define NUM_SPOT_LIGHTS 0
#define NUM_HEMI_LIGHTS 1
#define NUM_RECT_AREA_LIGHTS 0
#define NUM_DIR_LIGHT_SHADOWS 1
#define NUM_POINT_LIGHT_SHADOWS 0
#define NUM_SPOT_LIGHT_SHADOWS 0
uniform mat4 modelMatrix; uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix;
uniform mat4 viewMatrix; uniform mat3 normalMatrix; uniform vec3 cameraPosition;
uniform bool isOrthographic;
attribute vec3 position; attribute vec3 normal; attribute vec2 uv;
attribute mat4 instanceMatrix;
attribute vec3 color;
`;
const FRAG_PRE = `
precision highp float; precision highp int;
#define SHADER_NAME test
#define USE_COLOR
#define USE_FOG
#define USE_SHADOWMAP
#define NUM_DIR_LIGHTS 1
#define NUM_POINT_LIGHTS 1
#define NUM_SPOT_LIGHTS 0
#define NUM_HEMI_LIGHTS 1
#define NUM_RECT_AREA_LIGHTS 0
#define NUM_DIR_LIGHT_SHADOWS 1
#define NUM_POINT_LIGHT_SHADOWS 0
#define NUM_SPOT_LIGHT_SHADOWS 0
uniform mat4 viewMatrix; uniform vec3 cameraPosition; uniform bool isOrthographic;
`;

function check(name, vert, frag) {
  const results = [];
  for (const [kind, src, pre] of [['vertex', vert, VERT_PRE], ['fragment', frag, FRAG_PRE]]) {
    const raw = pre + resolveIncludes(src);
    let full = raw;
    try {
      full = preprocess(raw, { preserve: { version: () => true, extension: () => true, pragma: () => true } });
      parser.parse(full, { quiet: true });
      results.push(`${kind} ok`);
    } catch (e) {
      const line = (e.location && e.location.start.line) || '?';
      const lines = full.split('\n');
      console.error(`\n  ✗ ${name} ${kind} FAILED at line ${line}: ${e.message}`);
      console.error('   ' + lines.slice(Math.max(0, line - 4), line + 2).join('\n   '));
      return false;
    }
  }
  console.log(`  ✓ ${name}: ${results.join(', ')}`);
  return true;
}

// --- gather our materials ---------------------------------------------------
const { applyGroundShader } = await import('../src/terrain.js');
const { makeFoliageMaterial } = await import('../src/veg.js');

const captured = [];
function capture(mat, label, libName = 'lambert') {
  const lib = THREE.ShaderLib[libName];
  const sh = {
    uniforms: {},
    vertexShader: lib.vertexShader,
    fragmentShader: lib.fragmentShader,
    defines: {},
  };
  mat.onBeforeCompile(sh, { getRenderTarget: () => null });
  captured.push([label, sh.vertexShader, sh.fragmentShader]);
}

capture(applyGroundShader(new THREE.MeshLambertMaterial({ vertexColors: true })), 'terrain / structures');
capture(makeFoliageMaterial(1.0), 'foliage (trees)');
capture(makeFoliageMaterial(2.6), 'foliage (grass)');

// water material
const waterMat = new THREE.MeshLambertMaterial({ color: 0x2f5a63, transparent: true });
const mod = await import('../src/terrain.js');
// re-create the water shader hook by calling makeWater against a stub scene
const stubScene = { add() { } };
const water = mod.makeWater(stubScene);
capture(water.material, 'water');
const rainFx = new FX(new THREE.Scene(), { setClearColor() {} }, new WorldState());
capture(rainFx.rainSystem.material, 'rain (GPU particle drift)', 'points');

console.log('\n GLSL syntax check\n');
let ok = true;
for (const [label, v, f] of captured) ok = check(label, v, f) && ok;

// sky shader (raw ShaderMaterial)
const skyV = `varying vec3 vDir;
  void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
ok = check('sky (inline)', skyV, `
  varying vec3 vDir;
  uniform vec3 uTop, uMid, uBottom, uSunCol, uSunDir;
  uniform float uStars, uSunSize;
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 col = mix(uBottom, uMid, smoothstep(0.42, 0.55, h));
    col = mix(col, uTop, smoothstep(0.52, 0.95, h));
    float sd = max(dot(d, normalize(uSunDir)), 0.0);
    col += uSunCol * pow(sd, 22.0) * 0.55;
    if (uStars > 0.01 && d.y > 0.0) {
      vec2 g = floor(d.xz * 140.0 / max(d.y, 0.25));
      float s = hash(g);
      col += vec3(smoothstep(0.9975, 1.0, s) * uStars);
    }
    gl_FragColor = vec4(col, 1.0);
  }`) && ok;

console.log(ok ? '\n ALL SHADERS PARSE\n' : '\n SHADER CHECK FAILED\n');
process.exit(ok ? 0 : 1);
