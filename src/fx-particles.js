// Particle-pool operations shared by the visual-effects owner.
export function emitSmoke(fx, x, y, z) {
  for (let k = 0; k < fx.smokeParts.length; k++) {
    const i = fx.smokeCursor;
    fx.smokeCursor = (i + 1) % fx.smokeParts.length;
    const p = fx.smokeParts[i];
    if (p.life <= 0) {
      p.life = 3 + Math.random() * 3; p.x = x + (Math.random() - 0.5) * 3;
      p.y = y; p.z = z + (Math.random() - 0.5) * 3; p.vy = 3 + Math.random() * 4;
      if (!p.active) { p.active = true; fx.smokeActive.push(i); }
      return;
    }
  }
}

export function updateSmokeParticles(fx, dt) {
  const st = fx.state, sp = fx.smoke.geometry.attributes.position.array;
  const active = fx.smokeActive;
  const windX = Math.cos(st.weather.windDir) * dt * 3.5;
  const windZ = Math.sin(st.weather.windDir) * dt * 3.5;
  let write = 0;
  const dirty = active.length > 0;
  for (let a = 0; a < active.length; a++) {
    const i = active[a], p = fx.smokeParts[i];
    p.life -= dt;
    if (p.life <= 0) {
      p.active = false;
      sp[i * 3 + 1] = -9999;
      continue;
    }
    p.y += p.vy * dt;
    p.x += windX; p.z += windZ;
    sp[i * 3] = p.x; sp[i * 3 + 1] = p.y; sp[i * 3 + 2] = p.z;
    active[write++] = i;
  }
  active.length = write;
  if (dirty) fx.smoke.geometry.attributes.position.needsUpdate = true;
}

export function updateSparkParticles(fx, dt) {
  const arr = fx.sparks.geometry.attributes.position.array;
  const active = fx.sparkActive;
  let write = 0;
  const dirty = active.length > 0;
  for (let a = 0; a < active.length; a++) {
    const i = active[a], p = fx.sparkParts[i];
    p.life -= dt;
    if (p.life <= 0) {
      p.active = false;
      arr[i * 3 + 1] = -9999;
      continue;
    }
    p.vy -= 9.8 * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z;
    active[write++] = i;
  }
  active.length = write;
  if (dirty) fx.sparks.geometry.attributes.position.needsUpdate = true;
}
