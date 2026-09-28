// Audio ambience has long WebAudio smoothing constants; sample its world inputs
// at 8 Hz rather than repeating terrain and burning-list queries on every frame.
import { clamp } from './rng.js';

const SAMPLE_INTERVAL = 0.12;

export function updateAmbientAudio(world, dt) {
  const audio = world.audio;
  if (!audio.enabled || audio.muted || audio.volume <= 0) {
    world.audioAmbientTimer = 0;
    return false;
  }
  world.audioAmbientTimer = (world.audioAmbientTimer || 0) - dt;
  if (world.audioAmbientTimer > 0) return false;
  world.audioAmbientTimer += SAMPLE_INTERVAL;

  const state = world.state;
  const weather = state.weather;
  audio.ambience({
    wind: weather.windSpeed,
    rain: weather.type === 'rain' || weather.type === 'storm' ? weather.intensity : 0,
    fire: clamp(state.burningCount() * 0.25, 0, 1)
      * (1 - clamp(Math.abs(world.nearestFireDist() / 90), 0, 1)),
    water: world.waterNearness(),
    hearth: world.hearthNearness(),
    night: state.time < 0.22 || state.time > 0.8,
  });
  return true;
}
