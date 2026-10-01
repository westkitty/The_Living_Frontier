// Procedural Audio System
// Generates sound effects and ambient sounds on the fly using Web Audio API
// No external audio files needed - everything is synthesized in real-time

export function createProceduralAudio(audioEngine) {
  const audioContext = audioEngine.ctx;
  const masterGain = audioEngine.masterGain;

  // Master gain for procedural sounds
  const masterGain = audioContext.createGain();
  masterGain.gain.value = 0.7;
  masterGain.connect(audioEngine.masterGain);

  // ============================================================
  // Core synthesis utilities
  // ---------------------------------------------------------------------------

  function createBuffer(duration, generatorFn) {
    const sampleRate = audioContext.sampleRate;
    const length = Math.ceil(duration * audioContext.sampleRate);
    const buffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < length; i++) {
      const t = i / audioContext.sampleRate;
      data[i] = generatorFn(t, duration);
    }
    return buffer;
  }

  function applyADSR(buffer, attack, decay, sustain, release) {
    const data = buffer.getChannelData(0);
    const totalSamples = data.length;
    const a = attack * audioContext.sampleRate;
    const d = decay * audioContext.sampleRate;
    const r = release * audioContext.sampleRate;
    const s = sustain;

    for (let i = 0; i < totalSamples; i++) {
      let gain = 1;
      if (i < a) {
        gain = i / a;
      } else if (i < a + d) {
        gain = 1 - (1 - s) * (i - a) / d;
      } else if (i >= a + d + s) {
        gain = s * (1 - (i - (totalSamples - r)) / r);
      } else {
        gain = s;
      }
      data[i] *= gain;
    }
    return buffer;
  }

  // --- Footstep sounds ---
  function createFootstep(surface = 'dirt') {
    const params = {
      grass: { noise: 0.3, click: 150, decay: 0.05 },
      dirt: { click: 200, decay: 0.03, noise: 0.4 },
      stone: { click: 800, decay: 0.008, noise: 0.3 },
      wood: { click: 300, decay: 0.015, noise: 0.4 },
      water: { splash: true },
      snow: { click: 100, decay: 0.02, noise: 0.6 },
    }[surface] || { click: 200, decay: 0.01, noise: 0.3 };

    const duration = 0.1;
    const buffer = audioContext.createBuffer(1, audioContext.sampleRate * duration, audioContext.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < data.length; i++) {
      const t = i / audioContext.sampleRate;
      const env = Math.exp(-t * (surface === 'stone' ? 200 : surface === 'wood' ? 50 : 20));

      if (surface === 'water') {
        // Water splash - bandpass noise
        data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 15) * 0.15;
      } else {
        // Click + noise
        const click = Math.sin(2 * Math.PI * (surface === 'stone' ? 800 : surface === 'wood' ? 300 : 100) * t) * env * 0.4;
        const noise = (Math.random() * 2 - 1) * env * (surface === 'stone' ? 0.1 : surface === 'wood' ? 0.15 : 0.4);
        data[i] = Math.min(1, Math.max(-1, click + noise));
      }
    }
    return applyADSR(buffer, 0.001, 0.02, 0.05, 0.03);
  }

  // Weapon swing
  const swing = (weaponType = 'sword') => {
    const duration = 0.4;
    const buffer = audioContext.createBuffer(1, audioContext.sampleRate * duration, audioContext.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < data.length; i++) {
      const t = i / audioContext.sampleRate;
      const env = Math.exp(-t * 6);
      // Doppler-like sweep
      const freq = 600 * Math.exp(-t * 4) + 100;
      data[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.25;
      // Wind noise
      data[i] += (Math.random() * 2 - 1) * env * 0.15;
    }
    return applyADSR(buffer, 0.005, 0.02, 0.1, 0.15);
  }

  // Spell cast sounds by element
  const spell = (element) => {
    const configs = {
      fire: { base: 180, harmonics: [2, 3, 4], noise: 0.4, duration: 0.6 },
      ice: { base: 1000, harmonics: [2, 3, 4], noise: 0.2, duration: 0.6 },
      lightning: { base: 150, harmonics: [2, 3, 5, 7], noise: 0.6, duration: 0.4 },
      arcane: { base: 550, harmonics: [1.5, 2.5, 3.5], noise: 0.25, duration: 0.7 },
      nature: { base: 250, harmonics: [1.5, 2.5], noise: 0.3, duration: 0.7 },
      heal: { base: 523, harmonics: [1.25, 1.5, 2], noise: 0.1, duration: 0.8 },
    }[element] || { base: 440, harmonics: [2, 3], noise: 0.2, duration: 0.5 };

    const dur = configs.duration || 0.5;
    const buffer = audioContext.createBuffer(1, audioContext.sampleRate * dur, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    const harmonics = configs.harmonics || [2, 3, 4];
    const noiseAmt = configs.noise || 0.2;
    const baseFreq = configs.base || 440;

    for (let i = 0; i < data.length; i++) {
      const t = i / audioContext.sampleRate;
      const env = Math.exp(-t * (element === 'fire' ? 4 : element === 'ice' ? 2 : 2.5));
      let sum = 0;
      for (const h of harmonics) {
        sum += Math.sin(2 * Math.PI * baseFreq * h * t) * env * (0.3 / h);
      }
      data[i] = sum;
      data[i] += (Math.random() * 2 - 1) * env * noiseAmt;
    }
    return applyADSR(buffer, 0.02, 0.05, 0.4, 0.3);
  }

  // Hit/impact
  const impact = (type = 'flesh') => {
    const configs = {
      flesh: { base: 100, harmonics: [2, 3], noise: 0.4, duration: 0.12 },
      metal: { base: 600, harmonics: [2, 3, 4, 5], noise: 0.15, duration: 0.3 },
      wood: { base: 200, harmonics: [2, 3, 4], noise: 0.25, duration: 0.12 },
      stone: { base: 100, harmonics: [2, 3], noise: 0.15, duration: 0.1 },
      shield: { base: 300, harmonics: [2, 3, 4], noise: 0.15, duration: 0.2 },
      shieldBlock: { base: 300, harmonics: [2, 3], noise: 0.1, duration: 0.15 },
    }[type] || { base: 100, harmonics: [2, 3], noise: 0.3, duration: 0.12 };

    const dur = configs.duration || 0.12;
    const buffer = audioContext.createBuffer(1, audioContext.sampleRate * dur, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    const harmonics = configs.harmonics || [2, 3];
    const noiseAmt = configs.noise || 0.2;

    for (let i = 0; i < data.length; i++) {
      const t = i / audioContext.sampleRate;
      const env = Math.exp(-t * (type === 'metal' ? 15 : type === 'stone' ? 25 : 20));
      let sum = 0;
      for (const h of harmonics) {
        sum += Math.sin(2 * Math.PI * configs.base * h * t) * env * (0.3 / h);
      }
      data[i] = sum;
      data[i] += (Math.random() * 2 - 1) * env * noiseAmt;
      data[i] = Math.min(1, Math.max(-1, data[i]));
    }
    return applyADSR(buffer, 0.001, 0.01, 0.1, 0.05);
  }

  // Level up fanfare
  const levelUp = () => {
    const notes = [523.25, 554.37, 659.25, 698.46, 783.99, 880]; // C5, C#5, E5, F5, G5, A5
    const duration = 1.2;
    const buffer = audioContext.createBuffer(1, audioContext.sampleRate * duration, audioContext.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < data.length; i++) {
      const t = i / audioContext.sampleRate;
      const env = Math.exp(-t * 1.2);
      const notes = [523.25, 554.37, 659.25, 698.46, 783.99, 880, 1046.5];
      for (let n = 0; n < notes.length; n++) {
        const noteTime = (n / notes.length) * duration;
        if (t >= noteTime) {
          const noteEnv = Math.exp(-(t - noteTime) * 8);
          data[i] += Math.sin(2 * Math.PI * notes[n] * (t - noteTime)) * noteEnv * (0.3 / (n + 1));
        }
      }
    }
    return applyADSR(buffer, 0.01, 0.1, 0.3, 0.3);
  }

  // Heartbeat (for low health)
  const heartbeat = (rate = 1.5) => {
    const duration = 60 / rate; // seconds per beat
    const buffer = audioContext.createBuffer(1, audioContext.sampleRate * duration * 2, audioContext.sampleRate);
    const data = buffer.getChannelData(0);

    for (let beat = 0; beat < 2; beat++) {
      const beatTime = beat * duration;
      for (let i = 0; i < audioContext.sampleRate * duration; i++) {
        const t = i / audioContext.sampleRate;
        if (t < 0 || t > duration) continue;
        const env = Math.exp(-t * 15);
        // Lub-dub
        const lub = Math.sin(2 * Math.PI * 60 * t) * Math.exp(-t * 40) * 0.4;
        const dub = Math.sin(2 * Math.PI * 50 * (t - 0.15)) * Math.exp(-(t - 0.15) * 40) * 0.3;
        if (t >= 0 && t < duration) data[i] += (lub + dub) * env;
      }
    }
    return buffer;
  }

  // Heal sound
  const heal = () => {
    const duration = 0.8;
    const buffer = audioContext.createBuffer(1, audioContext.sampleRate * duration, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6

    for (let i = 0; i < data.length; i++) {
      const t = i / audioContext.sampleRate;
      const env = Math.exp(-t * 2);
      for (let n = 0; n < notes.length; n++) {
        const noteTime = (n / notes.length) * duration * 0.8;
        if (t >= noteTime) {
          const noteEnv = Math.exp(-(t - noteTime) * 8);
          data[i] += Math.sin(2 * Math.PI * notes[n] * (t - noteTime)) * noteEnv * (0.2 / (n + 1));
        }
      }
    }
    return applyADSR(buffer, 0.01, 0.1, 0.4, 0.4);
  }

  // Discovery chime
  const discovery = () => {
    const duration = 1.2;
    const buffer = audioContext.createBuffer(1, audioContext.sampleRate * duration, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6

    for (let i = 0; i < data.length; i++) {
      const t = i / audioContext.sampleRate;
      const env = Math.exp(-t * 0.8);
      for (let n = 0; n < notes.length; n++) {
        const noteTime = (n / notes.length) * duration * 0.7;
        if (t >= noteTime) {
          const noteEnv = Math.exp(-(t - noteTime) * 6);
          data[i] += Math.sin(2 * Math.PI * notes[n] * (t - noteTime)) * noteEnv * (0.25 / (n + 1));
        }
      }
    }
    return applyADSR(buffer, 0.01, 0.05, 0.6, 0.4);
  }

  // Warning pulse
  const warning = (urgency = 1) => {
    const duration = 0.4 / urgency;
    const buffer = audioContext.createBuffer(1, audioContext.sampleRate * duration, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    const freq = 400 + urgency * 400;

    for (let i = 0; i < data.length; i++) {
      const t = i / audioContext.sampleRate;
      const env = Math.exp(-t * 10 * urgency);
      // Pulsing warning tone
      const pulse = 0.5 + 0.5 * Math.sin(2 * Math.PI * 8 * urgency * t);
      data[i] = Math.sin(2 * Math.PI * freq * t) * env * pulse * 0.2;
    }
    return applyADSR(buffer, 0.01, 0.05, 0.3, 0.1);
  }

  // --- Ambient soundscapes ---
  const ambiences = {
    forest: () => {
      const buffer = audioContext.createBuffer(1, audioContext.sampleRate * 30, audioContext.sampleRate);
      const data = buffer.getChannelData(0);
      // Generate 30 seconds of forest ambience
      for (let i = 0; i < data.length; i++) {
        const t = i / audioContext.sampleRate;
        // Wind in leaves
        data[i] = (Math.random() * 2 - 1) * 0.02 * (0.5 + Math.sin(t * 0.3) * 0.5);
        // Occasional bird calls
        if (Math.random() < 0.0001) {
          const birdFreq = 2000 + Math.random() * 2000;
          const birdDur = 0.3;
          for (let j = 0; j < audioContext.sampleRate * birdDur && i + j < data.length; j++) {
            const bt = j / audioContext.sampleRate;
            const env = Math.exp(-bt * 15);
            data[i + j] += Math.sin(2 * Math.PI * (2000 + Math.random() * 1000) * bt) * env * 0.05;
          }
        }
      }
      return buffer;
    },

    cave: () => {
      const duration = 15;
      const buffer = audioContext.createBuffer(1, audioContext.sampleRate * duration, audioContext.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        const t = i / audioContext.sampleRate;
        // Deep rumble
        data[i] = Math.sin(2 * Math.PI * 30 * t) * 0.02;
        // Water drips
        if (Math.random() < 0.0002) {
          const dripDur = 0.2;
          for (let j = 0; j < audioContext.sampleRate * dripDur && i + j < data.length; j++) {
            const dt = j / audioContext.sampleRate;
            data[i + j] += Math.sin(2 * Math.PI * (300 + Math.random() * 200) * dt) * Math.exp(-j / (audioContext.sampleRate * 0.1)) * 0.05;
          }
        }
      }
      return buffer;
    },

    // Generic ambient bed
    ambient: (biome = 'forest') => {
      const configs = {
        forest: { baseFreq: 60, noise: 0.05, birdFreq: 0.0002, birdDur: 0.5, birdFreqRange: [2000, 4000] },
        plains: { baseFreq: 50, noise: 0.05, wind: 0.3 },
        cave: { baseFreq: 30, noise: 0.03, drip: 0.0001 },
        desert: { baseFreq: 40, noise: 0.04, wind: 0.4 },
        night: { baseFreq: 40, noise: 0.03, cricket: 0.0003, cricketFreq: [3000, 5000] },
      }[biome] || { baseFreq: 50, noise: 0.04 };

      const duration = 30;
      const buffer = audioContext.createBuffer(1, audioContext.sampleRate * duration, audioContext.sampleRate);
      const data = buffer.getChannelData(0);

      for (let i = 0; i < data.length; i++) {
        const t = i / audioContext.sampleRate;
        const cfg = configs[biome] || configs.forest;
        // Base drone
        data[i] = Math.sin(2 * Math.PI * (cfg.baseFreq || 50) * t) * 0.01;
        // Noise bed
        data[i] += (Math.random() * 2 - 1) * (cfg.noise || 0.04);
        // Wind gusts
        if (cfg.wind) {
          data[i] += (Math.random() * 2 - 1) * Math.exp(-Math.random() * 10) * cfg.wind * 0.1;
        }
        // Occasional creatures
        if (cfg.birdFreq && Math.random() < cfg.birdFreq) {
          const dur = cfg.birdDur || 0.3;
          const freq = cfg.birdFreqRange[Math.floor(Math.random() * cfg.birdFreqRange.length)];
          for (let j = 0; j < audioContext.sampleRate * dur && i + j < data.length; j++) {
            const bt = j / audioContext.sampleRate;
            const env = Math.exp(-bt * 8);
            data[i + j] += Math.sin(2 * Math.PI * freq * bt) * env * 0.04;
          }
        }
        if (cfg.cricket && Math.random() < cfg.cricket) {
          const dur = 0.2;
          const freq = cfg.cricketFreq[Math.floor(Math.random() * cfg.cricketFreq.length)];
          for (let j = 0; j < audioContext.sampleRate * dur && i + j < data.length; j++) {
            const bt = j / audioContext.sampleRate;
            const env = Math.exp(-bt * 10);
            data[i + j] += Math.sin(2 * Math.PI * freq * bt) * env * 0.03;
          }
        }
        if (cfg.drip && Math.random() < cfg.drip) {
          const dur = 0.2;
          for (let j = 0; j < audioContext.sampleRate * dur && i + j < data.length; j++) {
            const dt = j / audioContext.sampleRate;
            data[i + j] += Math.sin(2 * Math.PI * (300 + Math.random() * 200) * dt) * Math.exp(-j / (audioContext.sampleRate * 0.1)) * 0.05;
          }
        }
      }
      return buffer;
    },
  };

  // Play a one-shot effect
  function playEffect(name, options = {}) {
    const buffer = effects[name](options);
    if (buffer) return play(buffer, options);
    return null;
  }

  // Create ambient bed for a biome
  function createAmbience(biome, options = {}) {
    const buffer = ambiences[biome]();
    const source = play(buffer, { loop: true, volume: options.volume || 0.3, ...options });
    return {
      source,
      stop: () => { source.stop(); },
      setVolume: (vol) => { masterGain.gain.value = vol; },
    };
  }

  return {
    effects,
    playEffect,
    createAmbience,
  };
}