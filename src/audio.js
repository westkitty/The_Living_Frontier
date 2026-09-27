// Fully procedural WebAudio: wind, rain, fire, birds, footsteps, tools, UI.
export class AudioEngine {
  constructor() {
    this.enabled = false;
    this.ctx = null;
    this.muted = false;
  }
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(ctx.destination);

    // noise buffer reused by wind / rain / footsteps
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;

    // wind bed
    this.wind = this.makeNoiseLoop(420, 0.0, 'lowpass');
    this.windLfo = ctx.createOscillator();
    this.windLfoGain = ctx.createGain();
    this.windLfo.frequency.value = 0.09;
    this.windLfoGain.gain.value = 260;
    this.windLfo.connect(this.windLfoGain).connect(this.wind.filter.frequency);
    this.windLfo.start();

    // rain bed
    this.rain = this.makeNoiseLoop(2800, 0.0, 'highpass');
    // fire bed
    this.fire = this.makeNoiseLoop(700, 0.0, 'bandpass');
    this.fire.filter.Q.value = 1.2;

    this.enabled = true;
  }
  makeNoiseLoop(freq, gain, type) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type; filter.frequency.value = freq;
    const g = ctx.createGain(); g.gain.value = gain;
    src.connect(filter).connect(g).connect(this.master);
    src.start();
    return { src, filter, gain: g };
  }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.7; }

  ambience(windStrength, rainAmt, fireAmt, night) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    this.wind.gain.gain.setTargetAtTime(0.02 + windStrength * 0.10, t, 0.6);
    this.wind.filter.frequency.setTargetAtTime(300 + windStrength * 700, t, 0.8);
    this.rain.gain.gain.setTargetAtTime(rainAmt * 0.10, t, 0.8);
    this.fire.gain.gain.setTargetAtTime(Math.min(0.14, fireAmt * 0.16), t, 0.5);
  }

  blip(freq, dur, type = 'sine', vol = 0.12, slide = 0) {
    if (!this.enabled || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  noiseBurst(dur, freq, vol = 0.2, type = 'bandpass') {
    if (!this.enabled || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this.noiseBuf;
    s.playbackRate.value = 0.8 + Math.random() * 0.6;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t); s.stop(t + dur + 0.02);
  }

  play(name) {
    if (!this.enabled || this.muted) return;
    switch (name) {
      case 'step': this.noiseBurst(0.10, 320 + Math.random() * 160, 0.11, 'lowpass'); break;
      case 'splash': this.noiseBurst(0.22, 1400, 0.13, 'highpass'); break;
      case 'jump': this.blip(330, 0.14, 'triangle', 0.08, 180); break;
      case 'chop': this.noiseBurst(0.16, 900, 0.22, 'bandpass'); this.blip(120, 0.14, 'square', 0.05, -40); break;
      case 'mine': this.noiseBurst(0.14, 2200, 0.2, 'bandpass'); this.blip(180, 0.1, 'square', 0.05, -80); break;
      case 'pick': this.blip(760, 0.10, 'sine', 0.09, 240); break;
      case 'hurt': this.blip(180, 0.28, 'sawtooth', 0.12, -90); this.noiseBurst(0.2, 400, 0.12, 'lowpass'); break;
      case 'hit': this.noiseBurst(0.12, 700, 0.2); this.blip(90, 0.12, 'square', 0.07, -30); break;
      case 'ui': this.blip(620, 0.07, 'sine', 0.06, 120); break;
      case 'quest': this.blip(520, 0.16, 'triangle', 0.09, 180); setTimeout(() => this.blip(780, 0.22, 'triangle', 0.08, 120), 120); break;
      case 'discover': this.blip(400, 0.3, 'sine', 0.1, 200); setTimeout(() => this.blip(600, 0.3, 'sine', 0.09, 200), 160); setTimeout(() => this.blip(800, 0.5, 'sine', 0.08, 100), 320); break;
      case 'fire': this.noiseBurst(0.5, 500, 0.18, 'bandpass'); break;
      case 'build': this.blip(300, 0.2, 'triangle', 0.09, 260); break;
      case 'bird': this.blip(1800 + Math.random() * 900, 0.09, 'sine', 0.045, 700); break;
      case 'owl': this.blip(420, 0.35, 'sine', 0.05, -120); break;
      case 'wolfhowl': this.blip(300, 1.1, 'sawtooth', 0.045, 90); break;
    }
  }
}
