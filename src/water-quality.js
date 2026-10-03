// WaterQualityPolicy — water's share of the quality system the game already
// has. Quality must change how water *looks*, never what water *is*: depth,
// band, flow and buoyancy come from WaterQuery and are identical on every
// tier, so a low-end machine and a desktop agree on whether you can swim.
//
// Layer 2: pure data plus one lookup, no imports at all.

export const WATER_QUALITY = {
  high: {
    ripples: 96, splash: 48, foam: 1, caustics: 1.0, wake: 1.0, segments: 96,
    bubbles: 160, waveDetail: 1.0, rainRipples: 1.0,
  },
  medium: {
    ripples: 48, splash: 24, foam: 1, caustics: 0.35, wake: 0.6, segments: 64,
    bubbles: 64, waveDetail: 0.7, rainRipples: 0.5,
  },
  low: {
    ripples: 16, splash: 8, foam: 0, caustics: 0.0, wake: 0.25, segments: 48,
    bubbles: 24, waveDetail: 0.4, rainRipples: 0.0,
  },
};

// `reducedMotion` follows the player's motion preference: water keeps its
// colour and shoreline truth but stops churning. This is a visual choice, so
// it belongs here rather than in WaterQuery.
export function waterQualityFor(quality, reducedMotion = false) {
  const base = WATER_QUALITY[quality] || WATER_QUALITY.high;
  if (!reducedMotion) return base;
  return {
    ...base,
    waveDetail: Math.min(base.waveDetail, 0.25),
    rainRipples: 0,
    caustics: Math.min(base.caustics, 0.25),
    wake: Math.min(base.wake, 0.4),
  };
}

// True when a tier can afford an effect at all. Keeps call sites from
// repeating `q.foam > 0` style tests.
export function waterAllows(q, key) {
  return !!q && q[key] > 0;
}
