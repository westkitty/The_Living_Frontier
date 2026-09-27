// Sky, lighting, weather particles, fire, smoke, birds and small impact FX.
import * as THREE from 'three';
import { heightAt } from './worldgen.js';
import { clamp, lerp, smoothstep } from './rng.js';
import { shared } from './terrain.js';

const SKY_VERT = `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }`;
const SKY_FRAG = `
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
    col += uSunCol * pow(sd, 700.0) * 3.0 * uSunSize;
    col += uSunCol * pow(sd, 4.0) * 0.10;
    if (uStars > 0.01 && d.y > 0.0) {
      vec2 g = floor(d.xz * 140.0 / max(d.y, 0.25));
      float s = hash(g);
      float star = smoothstep(0.9975, 1.0, s) * uStars * (0.5 + 0.5 * hash(g + 3.0));
      col += vec3(star);
    }
    gl_FragColor = vec4(col, 1.0);
  }`;

export class FX {
  constructor(scene, renderer, state) {
    this.scene = scene;
    this.state = state;
    this.renderer = renderer;

    this.skyUniforms = {
      uTop: { value: new THREE.Color(0x2f6fb5) },
      uMid: { value: new THREE.Color(0x87b6de) },
      uBottom: { value: new THREE.Color(0xcfd6c9) },
      uSunCol: { value: new THREE.Color(0xffe9b0) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uStars: { value: 0 },
      uSunSize: { value: 1 },
    };
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1, 24, 16),
      new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: this.skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false })
    );
    this.sky.scale.setScalar(2500);
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;
    scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xffe9c4, 1.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const d = 90;
    this.sun.shadow.camera.left = -d; this.sun.shadow.camera.right = d;
    this.sun.shadow.camera.top = d; this.sun.shadow.camera.bottom = -d;
    this.sun.shadow.camera.near = 1; this.sun.shadow.camera.far = 420;
    this.sun.shadow.bias = -0.0009;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.camera.updateProjectionMatrix();
    scene.add(this.sun);
    scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0xbcd7ff, 0x4a4433, 0.55);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.18);
    scene.add(this.ambient);

    this.fogColor = new THREE.Color(0xbcc9d4);
    scene.fog = new THREE.Fog(this.fogColor, 60, 520);

    this.initWeather();
    this.initFire();
    this.initClouds();
    this.initBirds();
    this.initSparks();
    this.sunDir = new THREE.Vector3();
  }

  // -------------------------------------------------------------- weather
  initWeather() {
    const N = 2200;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 90;
      pos[i * 3 + 1] = Math.random() * 46;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 90;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rainMat = new THREE.PointsMaterial({ color: 0xaac4d8, size: 0.26, transparent: true, opacity: 0.0, depthWrite: false, fog: true });
    this.rain = new THREE.Points(g, this.rainMat);
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
    this.rainVel = new Float32Array(N);
    for (let i = 0; i < N; i++) this.rainVel[i] = 22 + Math.random() * 18;
  }

  initClouds() {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, fog: false });
    this.cloudMat = mat;
    const N = 40;
    const m = new THREE.InstancedMesh(geo, mat, N);
    const dummy = new THREE.Object3D();
    this.cloudData = [];
    for (let i = 0; i < N; i++) {
      const a = Math.random() * 6.283, r = 250 + Math.random() * 950;
      this.cloudData.push({ a, r, y: 220 + Math.random() * 130, s: 180 + Math.random() * 320, sp: 0.004 + Math.random() * 0.006 });
    }
    m.frustumCulled = false;
    m.renderOrder = -900;
    this.clouds = m;
    this.cloudDummy = dummy;
    this.scene.add(m);
  }

  initBirds() {
    const g = new THREE.BufferGeometry();
    const N = 26;
    const pos = new Float32Array(N * 3);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.birdMat = new THREE.PointsMaterial({ color: 0x2a2a2a, size: 1.4, transparent: true, opacity: 0.8, depthWrite: false });
    this.birds = new THREE.Points(g, this.birdMat);
    this.birds.frustumCulled = false;
    this.scene.add(this.birds);
    this.birdCenter = new THREE.Vector3();
  }

  initFire() {
    this.flamePool = [];
    const geo = new THREE.ConeGeometry(1, 2.2, 5);
    geo.translate(0, 1.1, 0);
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.9, fog: true, depthWrite: false });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      this.scene.add(m);
      this.flamePool.push(m);
    }
    this.fireLight = new THREE.PointLight(0xff9040, 0, 60, 2);
    this.scene.add(this.fireLight);

    // smoke / ember points
    const N = 500;
    const pos = new Float32Array(N * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.smokeMat = new THREE.PointsMaterial({ color: 0x6b6259, size: 2.4, transparent: true, opacity: 0.35, depthWrite: false });
    this.smoke = new THREE.Points(g, this.smokeMat);
    this.smoke.frustumCulled = false;
    this.scene.add(this.smoke);
    this.smokeParts = [];
    for (let i = 0; i < N; i++) this.smokeParts.push({ life: 0, x: 0, y: -999, z: 0, vy: 0 });
  }

  initSparks() {
    const N = 220;
    const pos = new Float32Array(N * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.sparkMat = new THREE.PointsMaterial({ color: 0xffd08a, size: 0.7, transparent: true, opacity: 0.95, depthWrite: false });
    this.sparks = new THREE.Points(g, this.sparkMat);
    this.sparks.frustumCulled = false;
    this.scene.add(this.sparks);
    this.sparkParts = [];
    for (let i = 0; i < N; i++) this.sparkParts.push({ life: 0, x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, col: 0 });
    this.sparkCursor = 0;
  }

  emitSpark(pos, color, n = 10, spread = 3, up = 3) {
    for (let i = 0; i < n; i++) {
      const p = this.sparkParts[this.sparkCursor];
      this.sparkCursor = (this.sparkCursor + 1) % this.sparkParts.length;
      p.life = 0.5 + Math.random() * 0.6;
      p.x = pos.x; p.y = pos.y + 0.4; p.z = pos.z;
      p.vx = (Math.random() - 0.5) * spread;
      p.vy = Math.random() * up;
      p.vz = (Math.random() - 0.5) * spread;
    }
    this.sparkMat.color.setHex(color);
  }
  hitSpark(pos) { this.emitSpark(pos, 0xffd9a0, 8, 4, 3); }
  bloodPuff(pos) { this.emitSpark(pos, 0xa02a2a, 12, 3, 2.4); }
  dust(pos) { this.emitSpark(pos, 0xb9ab90, 6, 2, 1.4); }
  chop(pos) { this.emitSpark(pos, 0xb98a4a, 10, 2.5, 2.5); }

  // ---------------------------------------------------------------- update
  update(dt, camera, playerPos) {
    const st = this.state;
    const t = st.time;
    const w = st.weather;
    shared.uTime.value += dt;
    shared.uWind.value.set(Math.cos(w.windDir), Math.sin(w.windDir));
    shared.uWindStrength.value = 0.22 + w.windSpeed * 0.8;
    shared.uWet.value = lerp(shared.uWet.value, (w.type === 'rain' || w.type === 'storm') ? w.intensity : 0, dt * 0.3);
    shared.uSnow.value = lerp(shared.uSnow.value, w.type === 'snow' ? w.intensity : 0, dt * 0.2);

    // --- sun position
    const ang = (t - 0.25) * Math.PI * 2;
    const elev = Math.sin(ang);
    const azim = Math.cos(ang);
    this.sunDir.set(azim * 0.7, elev, 0.35).normalize();
    const dayAmt = clamp(elev * 1.6 + 0.22, 0, 1);
    const dusk = clamp(1 - Math.abs(elev) * 4.5, 0, 1);
    const night = 1 - clamp(elev * 5 + 0.35, 0, 1);

    const su = this.skyUniforms;
    su.uSunDir.value.copy(this.sunDir);
    su.uStars.value = night;
    const cloudy = clamp(w.intensity * (w.type === 'clear' ? 0.2 : 1), 0, 1);
    su.uSunSize.value = 1 - cloudy * 0.85;

    const dayTop = new THREE.Color(0x2e6fbb), nightTop = new THREE.Color(0x070c1c), duskTop = new THREE.Color(0x2c3b6b);
    const dayMid = new THREE.Color(0x8cbce4), nightMid = new THREE.Color(0x101a33), duskMid = new THREE.Color(0x7a5a7e);
    const dayBot = new THREE.Color(0xd9dfd4), nightBot = new THREE.Color(0x141c2b), duskBot = new THREE.Color(0xe08a54);
    const mix = (d, n, k) => d.clone().lerp(n, night).lerp(k, dusk * 0.8);
    const gray = new THREE.Color(0x8e98a2);
    su.uTop.value.copy(mix(dayTop, nightTop, duskTop)).lerp(gray.clone().multiplyScalar(0.5 + dayAmt * 0.5), cloudy * 0.8);
    su.uMid.value.copy(mix(dayMid, nightMid, duskMid)).lerp(gray.clone().multiplyScalar(0.6 + dayAmt * 0.4), cloudy * 0.8);
    su.uBottom.value.copy(mix(dayBot, nightBot, duskBot)).lerp(gray.clone().multiplyScalar(0.7 + dayAmt * 0.3), cloudy * 0.7);
    su.uSunCol.value.setHSL(lerp(0.12, 0.05, dusk), 0.75, lerp(0.6, 0.5, night));

    // --- lights
    this.sun.position.copy(playerPos).addScaledVector(this.sunDir, 180);
    this.sun.target.position.copy(playerPos);
    this.sun.target.updateMatrixWorld();
    const sunStrength = clamp(elev * 1.8, 0, 1) * (1 - cloudy * 0.75);
    this.sun.intensity = sunStrength * 1.7;
    this.sun.color.setHSL(lerp(0.11, 0.055, dusk), lerp(0.25, 0.7, dusk), lerp(0.72, 0.55, dusk));
    this.hemi.intensity = lerp(0.12, 0.62, dayAmt) * (1 - cloudy * 0.25);
    this.hemi.color.setHSL(0.58, 0.45, lerp(0.16, 0.72, dayAmt));
    this.hemi.groundColor.setHSL(0.1, 0.25, lerp(0.05, 0.28, dayAmt));
    this.ambient.intensity = lerp(0.10, 0.22, dayAmt) + cloudy * 0.06;

    // --- fog
    this.fogColor.copy(su.uBottom.value).lerp(su.uMid.value, 0.45);
    if (w.type === 'fogbank') this.fogColor.lerp(new THREE.Color(0xa8b0b4), 0.5 * w.intensity);
    this.scene.fog.color.copy(this.fogColor);
    this.renderer.setClearColor(this.fogColor);
    const fogFar = w.type === 'fogbank' ? lerp(520, 110, w.intensity)
      : w.type === 'storm' ? lerp(520, 200, w.intensity)
        : w.type === 'rain' ? lerp(520, 300, w.intensity)
          : lerp(520, 420, cloudy);
    this.scene.fog.far = lerp(this.scene.fog.far, fogFar * lerp(0.8, 1.0, dayAmt), dt * 0.5);
    this.scene.fog.near = this.scene.fog.far * 0.06;

    // --- sky follows camera
    this.sky.position.copy(camera.position);

    // --- clouds
    const cd = this.cloudData;
    this.cloudMat.opacity = clamp(0.12 + cloudy * 0.62, 0, 0.8) * lerp(0.4, 1, dayAmt + 0.25);
    this.cloudMat.color.setHSL(0, 0, lerp(0.35, 0.95, dayAmt) * lerp(1, 0.55, cloudy));
    for (let i = 0; i < cd.length; i++) {
      const c = cd[i];
      c.a += dt * c.sp * (0.4 + w.windSpeed);
      const x = playerPos.x + Math.cos(c.a) * c.r;
      const z = playerPos.z + Math.sin(c.a) * c.r;
      this.cloudDummy.position.set(x, c.y, z);
      this.cloudDummy.quaternion.copy(camera.quaternion);
      this.cloudDummy.scale.set(c.s, c.s * 0.45, 1);
      this.cloudDummy.updateMatrix();
      this.clouds.setMatrixAt(i, this.cloudDummy.matrix);
    }
    this.clouds.instanceMatrix.needsUpdate = true;

    // --- precipitation
    const precip = (w.type === 'rain' || w.type === 'storm') ? w.intensity : 0;
    const snow = w.type === 'snow' ? w.intensity : 0;
    this.rainMat.opacity = clamp(precip * 0.55 + snow * 0.8, 0, 0.8);
    this.rainMat.size = snow > 0 ? 0.6 : 0.3;
    this.rainMat.color.setHex(snow > 0 ? 0xffffff : 0x9fb8cc);
    if (this.rainMat.opacity > 0.01) {
      this.rain.visible = true;
      const arr = this.rain.geometry.attributes.position.array;
      const wx = Math.cos(w.windDir) * w.windSpeed * 8;
      const wz = Math.sin(w.windDir) * w.windSpeed * 8;
      for (let i = 0; i < arr.length / 3; i++) {
        arr[i * 3 + 1] -= this.rainVel[i] * dt * (snow > 0 ? 0.18 : 1);
        arr[i * 3] += wx * dt * (snow > 0 ? 2 : 1);
        arr[i * 3 + 2] += wz * dt * (snow > 0 ? 2 : 1);
        if (arr[i * 3 + 1] < -6) {
          arr[i * 3 + 1] = 42;
          arr[i * 3] = (Math.random() - 0.5) * 90;
          arr[i * 3 + 2] = (Math.random() - 0.5) * 90;
        }
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.rain.position.set(playerPos.x, playerPos.y, playerPos.z);
    } else this.rain.visible = false;

    // --- birds (ambient wildlife)
    const bt = shared.uTime.value;
    const bp = this.birds.geometry.attributes.position.array;
    if (night > 0.7) this.birds.visible = false;
    else {
      this.birds.visible = true;
      if (this.birdCenter.distanceTo(playerPos) > 260 || !this.birdInit) {
        this.birdInit = true;
        this.birdCenter.set(playerPos.x + (Math.random() - 0.5) * 160, 0, playerPos.z + (Math.random() - 0.5) * 160);
        this.birdCenter.y = heightAt(this.birdCenter.x, this.birdCenter.z) + 45 + Math.random() * 25;
      }
      for (let i = 0; i < bp.length / 3; i++) {
        const a = bt * 0.25 + i * 0.44;
        const r = 22 + (i % 5) * 5;
        bp[i * 3] = this.birdCenter.x + Math.cos(a) * r;
        bp[i * 3 + 1] = this.birdCenter.y + Math.sin(bt * 1.4 + i) * 2.2 + (i % 3) * 2.5;
        bp[i * 3 + 2] = this.birdCenter.z + Math.sin(a) * r;
      }
      this.birds.geometry.attributes.position.needsUpdate = true;
    }

    this.updateFire(dt, playerPos);
    this.updateSparks(dt);
  }

  updateFire(dt, playerPos) {
    const st = this.state;
    // nearby burning cells (list is rebuilt by the fire simulation, not here)
    const cells = [];
    for (const c of st.burningList) {
      const d = Math.hypot(c.x - playerPos.x, c.z - playerPos.z);
      if (d < 220) cells.push({ x: c.x, z: c.z, v: c.v, d });
    }
    cells.sort((a, c) => a.d - c.d);
    for (let i = 0; i < this.flamePool.length; i++) {
      const m = this.flamePool[i];
      const c = cells[i];
      if (!c) { m.visible = false; continue; }
      m.visible = true;
      const y = heightAt(c.x, c.z);
      const flick = 0.75 + Math.sin(shared.uTime.value * 11 + i * 2.1) * 0.25;
      m.position.set(c.x + Math.sin(shared.uTime.value + i) * 1.2, y, c.z + Math.cos(shared.uTime.value * 1.2 + i) * 1.2);
      const s = (2.2 + c.v * 5) * flick;
      m.scale.set(s * 0.7, s, s * 0.7);
      m.material.color.setHSL(lerp(0.02, 0.11, flick), 1.0, lerp(0.45, 0.62, flick));
      m.material.opacity = 0.75 + flick * 0.2;
      // smoke
      if (Math.random() < dt * 14) this.emitSmoke(c.x, y + 3, c.z);
    }
    if (cells.length) {
      this.fireLight.position.set(cells[0].x, heightAt(cells[0].x, cells[0].z) + 4, cells[0].z);
      this.fireLight.intensity = clamp(6 * cells[0].v, 0, 8) * (0.8 + Math.sin(shared.uTime.value * 9) * 0.2);
      this.fireLight.distance = 70;
    } else this.fireLight.intensity = lerp(this.fireLight.intensity, 0, dt * 4);

    // smoke particles
    const sp = this.smoke.geometry.attributes.position.array;
    for (let i = 0; i < this.smokeParts.length; i++) {
      const p = this.smokeParts[i];
      if (p.life > 0) {
        p.life -= dt;
        p.y += p.vy * dt;
        p.x += Math.cos(st.weather.windDir) * dt * 3.5;
        p.z += Math.sin(st.weather.windDir) * dt * 3.5;
        sp[i * 3] = p.x; sp[i * 3 + 1] = p.y; sp[i * 3 + 2] = p.z;
      } else { sp[i * 3 + 1] = -9999; }
    }
    this.smoke.geometry.attributes.position.needsUpdate = true;
  }

  emitSmoke(x, y, z) {
    for (let k = 0; k < this.smokeParts.length; k++) {
      const i = (this.smokeCursor = (this.smokeCursor || 0) + 1) % this.smokeParts.length;
      const p = this.smokeParts[i];
      if (p.life <= 0) {
        p.life = 3 + Math.random() * 3; p.x = x + (Math.random() - 0.5) * 3;
        p.y = y; p.z = z + (Math.random() - 0.5) * 3; p.vy = 3 + Math.random() * 4;
        return;
      }
    }
  }

  updateSparks(dt) {
    const arr = this.sparks.geometry.attributes.position.array;
    for (let i = 0; i < this.sparkParts.length; i++) {
      const p = this.sparkParts[i];
      if (p.life > 0) {
        p.life -= dt;
        p.vy -= 9.8 * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z;
      } else arr[i * 3 + 1] = -9999;
    }
    this.sparks.geometry.attributes.position.needsUpdate = true;
  }
}
