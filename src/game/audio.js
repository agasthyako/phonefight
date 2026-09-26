// Synthesised sound, so there are no audio files to host. Browsers only allow audio after a
// click or key press on the Game page, so unlock() is wired to the first one.

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
  }

  unlock() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(this.ctx.destination);
      this.noise = this._noiseBuffer();
      this._startSwoosh();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.value = on ? 0.6 : 0;
  }

  get ready() {
    return this.ctx && this.ctx.state === "running";
  }

  /** The blade cutting air: continuous filtered noise that follows swing speed (deg/s). */
  swing(speed) {
    if (!this.ready) return;
    const k = Math.min(1, Math.max(0, (speed - 250) / 900));
    const t = this.ctx.currentTime;
    this.swooshGain.gain.setTargetAtTime(k * 0.5, t, 0.02);
    this.swooshFilter.frequency.setTargetAtTime(500 + k * 1800, t, 0.03);
  }

  clang() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    for (const [f, a, d] of [[1180, 0.25, 0.5], [2530, 0.14, 0.35], [3790, 0.08, 0.25], [5210, 0.05, 0.15]]) {
      this._tone(f * (0.97 + Math.random() * 0.06), a, d, t, "sine");
    }
    this._burst(t, 0.04, 3000, "highpass", 0.4);
  }

  slice() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._burst(t, 0.16, 2500, "highpass", 0.55);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(1600, t);
    o.frequency.exponentialRampToValueAtTime(300, t + 0.12);
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.15);
  }

  hurt() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._tone(70, 0.7, 0.35, t, "sine");
    this._burst(t, 0.2, 400, "lowpass", 0.6);
  }

  chime() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this._tone(660, 0.15, 0.6, t, "triangle");
    this._tone(990, 0.12, 0.8, t + 0.12, "triangle");
  }

  _tone(freq, amp, decay, t, type) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  _burst(t, dur, freq, type, amp) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  _startSwoosh() {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.swooshFilter = this.ctx.createBiquadFilter();
    this.swooshFilter.type = "bandpass";
    this.swooshFilter.Q.value = 1.2;
    this.swooshGain = this.ctx.createGain();
    this.swooshGain.gain.value = 0;
    src.connect(this.swooshFilter).connect(this.swooshGain).connect(this.master);
    src.start();
  }

  _noiseBuffer() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }
}
