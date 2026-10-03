// WaterSurfaceRenderer — the visible water, and only the visible water.
//
// It owns waves, depth colour, shoreline foam and the soft edge where water
// meets ground. It does not decide whether anything is swimming, wading,
// drowning or floating: those are WaterQuery's answers, and a machine that
// cannot afford foam still gets exactly the same gameplay truth.
//
// Depth comes from the coarse WaterField texture rather than a depth buffer,
// so there is no extra render pass and no GPU readback — the shoreline is
// precomputed once at boot, which is the Tidewater lesson worth keeping.
import * as THREE from 'three';
import { WORLD } from './worldgen.js';
import { shared } from './terrain.js';
import { buildWaterField, FIELD_RES, FIELD_MAX_DEPTH } from './water-field.js';

const WATER_VERT = /* glsl */`
  uniform sampler2D uWaterField;
  uniform float uWorldHalf;
  uniform float uWaveAmp;
  uniform float uMaxDepth;
  varying vec3 vWP;
  varying float vDepth;
  varying float vShore;
  varying vec2 vFlow;
`;

const WATER_VERT_BODY = /* glsl */`
  vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vec2 fUv = (wp.xz + uWorldHalf) / (uWorldHalf * 2.0);
  vec4 fld = texture2D(uWaterField, fUv);
  float depth = fld.r * uMaxDepth;
  float shore = fld.g;
  // Waves belong to deep water. In the shallows they flatten out and turn
  // into foam, which is what makes a shoreline read as a shoreline.
  float open = smoothstep(0.15, 2.2, depth);
  float swell = sin(wp.x * 0.06 + uTime * 1.1) * 0.22 + sin(wp.z * 0.045 - uTime * 0.8) * 0.20;
  float chop = sin(wp.x * 0.21 - uTime * 1.7) * 0.055 + sin(wp.z * 0.17 + uTime * 1.3) * 0.045;
  float chop2 = sin((wp.x + wp.z) * 0.33 + uTime * 2.3) * 0.025;
  transformed.y += (swell + (chop + chop2 * uWaveAmp) * uWaveAmp) * open * uWaveAmp;
  vWP = wp;
  vDepth = depth;
  vShore = shore;
  vFlow = (fld.ba - 0.5) * 2.0;
`;

const WATER_FRAG_HEAD = /* glsl */`
  uniform float uFoam;
  uniform float uWaveAmp;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  varying vec3 vWP;
  varying float vDepth;
  varying float vShore;
  varying vec2 vFlow;
`;

const WATER_FRAG_BODY = /* glsl */`
  // Depth does the colour work that a flat sheet cannot: teal where you can
  // see the bed, navy where you cannot.
  float shallowMix = smoothstep(7.0, 0.0, vDepth);
  vec3 waterCol = mix(uDeep, uShallow, shallowMix);

  // Surface motion. Drifting along the field's flow makes rivers visibly run
  // downhill without any simulation.
  vec2 drift = vWP.xz + vFlow * uTime * 1.4;
  float ripple = sin(drift.x * 0.55 + uTime * 1.7) * sin(drift.y * 0.5 - uTime * 1.3);
  float ripple2 = sin(drift.x * 1.31 - uTime * 2.1) * sin(drift.y * 1.13 + uTime * 1.9);
  waterCol += ripple * 0.030 * uWaveAmp + ripple2 * 0.016 * uWaveAmp;

  // Foam: a band hugging the shore, broken up so it is not a painted line.
  float edge = smoothstep(0.30, 0.68, vShore) * (1.0 - smoothstep(0.86, 1.0, vShore));
  float breakUp = 0.55 + 0.45 * sin(vWP.x * 0.9 + vWP.z * 0.7 - uTime * 2.2);
  float foam = edge * breakUp * uFoam;
  waterCol = mix(waterCol, vec3(0.90, 0.95, 0.96), clamp(foam, 0.0, 1.0));

  diffuseColor.rgb = waterCol;
  // The waterline fades instead of stopping, so there is no hard seam where
  // the plane meets the terrain.
  diffuseColor.a *= 1.0 - smoothstep(0.70, 0.99, vShore);
`;

export class WaterSurface {
  constructor(scene, quality) {
    this.scene = scene;
    this.quality = quality;
    this.uniforms = {
      uWaterField: { value: null },
      uWorldHalf: shared.uWorldHalf,
      uTime: shared.uTime,
      uWaveAmp: { value: 1 },
      uFoam: { value: quality.foam },
      uMaxDepth: { value: FIELD_MAX_DEPTH },
      uShallow: { value: new THREE.Color(0x4e8f8a) },
      uDeep: { value: new THREE.Color(0x12323c) },
    };
    this.fieldTexture = this.makeFieldTexture();
    this.mesh = null;
    this.buildMesh(quality);
  }

  // The field is generated on the CPU once, then handed to the GPU as an
  // ordinary RGBA texture.
  makeFieldTexture() {
    const bytes = buildWaterField(FIELD_RES);
    const tex = new THREE.DataTexture(bytes, FIELD_RES, FIELD_RES, THREE.RGBAFormat);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.uniforms.uWaterField.value = tex;
    return tex;
  }

  buildMesh(quality) {
    const segs = quality.segments;
    const geo = new THREE.PlaneGeometry(WORLD.size * 1.6, WORLD.size * 1.6, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({
      color: 0xffffff, transparent: true, opacity: 0.86, depthWrite: true,
    });
    const u = this.uniforms;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uWaterField = u.uWaterField;
      sh.uniforms.uWorldHalf = u.uWorldHalf;
      sh.uniforms.uTime = u.uTime;
      sh.uniforms.uWaveAmp = u.uWaveAmp;
      sh.uniforms.uFoam = u.uFoam;
      sh.uniforms.uMaxDepth = u.uMaxDepth;
      sh.uniforms.uShallow = u.uShallow;
      sh.uniforms.uDeep = u.uDeep;
      sh.vertexShader = WATER_VERT + sh.vertexShader.replace(
        '#include <begin_vertex>', '#include <begin_vertex>\n' + WATER_VERT_BODY);
      sh.fragmentShader = WATER_FRAG_HEAD + sh.fragmentShader.replace(
        '#include <color_fragment>', '#include <color_fragment>\n' + WATER_FRAG_BODY);
    };
    mat.customProgramCacheKey = () => 'watersurface';
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = WORLD.water - 0.05;
    mesh.renderOrder = 1;
    this.scene.add(mesh);
    this.mesh = mesh;
  }

  // Weather reaches the surface here: wind lifts the swell, calm flattens it.
  setWeather(weather) {
    const wind = Math.max(0, weather.windSpeed || 0) / 0.45;
    const storm = weather.type === 'storm' ? 1.35 : weather.type === 'rain' ? 1.1 : 1;
    this.uniforms.uWaveAmp.value = Math.min(1.9, (0.62 + wind * 0.34) * storm * this.quality.waveDetail);
  }

  setQuality(quality) {
    this.quality = quality;
    this.uniforms.uFoam.value = quality.foam;
    if (quality.segments !== this.mesh.geometry.parameters.widthSegments) {
      const old = this.mesh;
      this.scene.remove(old);
      old.geometry.dispose();
      old.material.dispose();
      this.buildMesh(quality);
    }
  }

  suspend() { if (this.mesh) this.mesh.visible = false; }
  resume() { if (this.mesh) this.mesh.visible = true; }

  dispose() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh = null;
    }
    if (this.fieldTexture) { this.fieldTexture.dispose(); this.fieldTexture = null; }
    this.uniforms.uWaterField.value = null;
  }
}
