// Fully procedural WebAudio: wind, rain, fire, birds, footsteps, tools, UI.
export class AudioEngine {
  constructor() {
    this.enabled = false;
    this.ctx = null;
    this.muted = false;
    this.volume = 0.7;
  }
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
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
    // moving water — rivers, lake shores
    this.water = this.makeNoiseLoop(1500, 0.0, 'bandpass');
    this.water.filter.Q.value = 0.7;
    // the hearth bed: the low warm hum of an inhabited, prospering place
    this.hearth = this.makeNoiseLoop(240, 0.0, 'lowpass');

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
  setMuted(m) { this.muted = m; this.applyGain(); }
  setVolume(v) { this.volume = Math.max(0, Math.min(1, v)); this.applyGain(); }
  applyGain() {
    if (!this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, t, 0.05);
  }

  // Every bed is driven by something the simulation actually knows: wind and
  // rain from the weather, fire from burning cells near you, water from the
  // nearest river or shore, hearth from how alive the nearest village is.
  ambience(a) {
    if (!this.enabled) return;
    const t = this.ctx.currentTime;
    const wind = a.wind || 0, rain = a.rain || 0, fire = a.fire || 0;
    const water = a.water || 0, hearth = a.hearth || 0, night = !!a.night;
    this.wind.gain.gain.setTargetAtTime(0.02 + wind * 0.10, t, 0.6);
    this.wind.filter.frequency.setTargetAtTime((night ? 220 : 300) + wind * 700, t, 0.8);
    this.rain.gain.gain.setTargetAtTime(rain * 0.10, t, 0.8);
    this.fire.gain.gain.setTargetAtTime(Math.min(0.14, fire * 0.16), t, 0.5);
    this.water.gain.gain.setTargetAtTime(Math.min(0.085, water * 0.085), t, 0.7);
    this.water.filter.frequency.setTargetAtTime(1100 + water * 900, t, 0.9);
    this.hearth.gain.gain.setTargetAtTime(Math.min(0.055, hearth * 0.055), t, 1.2);
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
      // footfalls read the ground you are actually standing on
      case 'step-grass': this.noiseBurst(0.12, 260 + Math.random() * 140, 0.085, 'lowpass'); break;
      case 'step-ash': this.noiseBurst(0.16, 1500 + Math.random() * 700, 0.075, 'highpass');
        this.noiseBurst(0.08, 240, 0.05, 'lowpass'); break;
      case 'step-stone': this.noiseBurst(0.07, 900 + Math.random() * 500, 0.09, 'bandpass');
        this.blip(160 + Math.random() * 60, 0.05, 'square', 0.025, -30); break;
      case 'splash': this.noiseBurst(0.22, 1400, 0.13, 'highpass'); break;
      case 'jump': this.blip(280, 0.18, 'triangle', 0.11, 300); this.noiseBurst(0.09, 480, 0.07, 'lowpass'); break; case 'land': this.noiseBurst(0.16, 260, 0.17, 'lowpass'); this.blip(95, 0.12, 'sine', 0.08, -25); break; case 'double': this.blip(520, 0.2, 'triangle', 0.1, 420); this.noiseBurst(0.12, 900, 0.06, 'highpass'); break; case 'grapple': this.noiseBurst(0.18, 1800, 0.09, 'highpass'); break; case 'grappleHit': this.noiseBurst(0.1, 700, 0.16); this.blip(140, 0.1, 'square', 0.06, -40); break; case 'cast': this.blip(660, 0.22, 'triangle', 0.1, 320); break; case 'zap': this.noiseBurst(0.14, 2600, 0.16, 'highpass'); this.blip(190, 0.16, 'sawtooth', 0.09, -90); break; case 'heal': this.blip(520, 0.25, 'sine', 0.08, 260); setTimeout(() => this.blip(780, 0.3, 'sine', 0.07, 180), 110); break; case 'thunder': this.noiseBurst(0.6, 160, 0.2, 'lowpass'); this.blip(70, 0.5, 'sine', 0.1, -20); break;
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
