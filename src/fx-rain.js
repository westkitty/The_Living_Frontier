// Precipitation is fixed data plus a few frame uniforms. Moving 2,200 points
// on the CPU and marking the full position buffer dirty every rainy frame was
// unnecessary: velocity, drift and wrap are evaluated per point in the shader.
import * as THREE from 'three';

const SPAN = 90;
const FLOOR = -6;

export function makeRain(scene) {
  const count = 2200;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * SPAN;
    positions[i * 3 + 1] = Math.random() * 46;
    positions[i * 3 + 2] = (Math.random() - 0.5) * SPAN;
    velocities[i] = 22 + Math.random() * 18;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aRainVelocity', new THREE.BufferAttribute(velocities, 1));
  const uniforms = {
    uRainFall: { value: 0 },
    uRainDrift: { value: new THREE.Vector2() },
  };
  const material = new THREE.PointsMaterial({
    color: 0xaac4d8, size: 0.26, transparent: true, opacity: 0,
    depthWrite: false, fog: true,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRainFall = uniforms.uRainFall;
    shader.uniforms.uRainDrift = uniforms.uRainDrift;
    shader.vertexShader = `
      uniform float uRainFall;
      uniform vec2 uRainDrift;
      attribute float aRainVelocity;
    ` + shader.vertexShader.replace('#include <begin_vertex>', `
      #include <begin_vertex>
      float fall = uRainFall * aRainVelocity;
      if (position.y > 42.0) {
        float overTop = position.y - 42.0;
        transformed.y = fall < overTop ? position.y - fall : 42.0 - mod(fall - overTop, 48.0);
      } else {
        transformed.y = 42.0 - mod(42.0 - position.y + fall, 48.0);
      }
      transformed.x = mod(position.x + uRainDrift.x + 45.0, 90.0) - 45.0;
      transformed.z = mod(position.z + uRainDrift.y + 45.0, 90.0) - 45.0;
    `);
  };
  material.customProgramCacheKey = () => 'frontier-gpu-rain-v1';
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);
  return { points, material, uniforms };
}

export function updateRain(rain, weather, dt, playerPos) {
  const { material, points, uniforms } = rain;
  const precipitation = weather.type === 'rain' || weather.type === 'storm' ? weather.intensity : 0;
  const snow = weather.type === 'snow' ? weather.intensity : 0;
  material.opacity = Math.min(0.8, Math.max(0, precipitation * 0.55 + snow * 0.8));
  material.size = snow > 0 ? 0.6 : 0.3;
  material.color.setHex(snow > 0 ? 0xffffff : 0x9fb8cc);
  if (material.opacity <= 0.01) {
    points.visible = false;
    return;
  }
  points.visible = true;
  uniforms.uRainFall.value += dt * (snow > 0 ? 0.18 : 1);
  const drift = uniforms.uRainDrift.value;
  const speed = weather.windSpeed * 8 * dt * (snow > 0 ? 2 : 1);
  drift.x += Math.cos(weather.windDir) * speed;
  drift.y += Math.sin(weather.windDir) * speed;
  points.position.set(playerPos.x, playerPos.y, playerPos.z);
}
