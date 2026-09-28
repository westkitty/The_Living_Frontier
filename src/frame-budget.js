// Keep simulation catch-up capped while monitoring true rendered-frame cost.
export function simulationDelta(elapsed) { return Math.min(elapsed, 0.05); }

// Keep the existing 121-frame decision window and downgrade thresholds.
export function sampleFrameCost(samples, elapsed) {
  samples.push(Math.min(elapsed, 0.25));
  if (samples.length <= 120) return null;
  const average = samples.reduce((sum, frame) => sum + frame, 0) / samples.length;
  samples.length = 0;
  return average;
}

export function nextQuality(quality, averageFrameSeconds) {
  if (averageFrameSeconds > 0.055 && quality === 'high') return 'medium';
  if (averageFrameSeconds > 0.07 && quality === 'medium') return 'low';
  return quality;
}
