// Efectos de sonido sintetizados con Web Audio (el sonido completo llegará en la parte 3).
export class Sound {
  init() {
    if (this.ctx) return;
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain();
    this.master.gain.value = 0.45;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
  }

  tone(freq, dur, type = 'sine', vol = 0.2, slide = 0) {
    if (!this.ctx) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain(), t = this.ctx.currentTime;
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur);
  }

  noise(dur, vol, cutoff) {
    if (!this.ctx) return;
    const s = this.ctx.createBufferSource(), f = this.ctx.createBiquadFilter(), g = this.ctx.createGain(), t = this.ctx.currentTime;
    s.buffer = this.noiseBuf;
    f.type = 'lowpass'; f.frequency.value = cutoff;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start(t); s.stop(t + dur);
  }

  sfx(name) {
    switch (name) {
      case 'jump': this.tone(420, 0.16, 'sine', 0.12, 1.8); break;
      case 'dive': this.tone(300, 0.25, 'triangle', 0.12, 0.5); break;
      case 'hit': this.tone(160, 0.3, 'sawtooth', 0.12, 0.5); this.noise(0.15, 0.15, 900); break;
      case 'splash': this.noise(0.5, 0.3, 1400); this.tone(220, 0.4, 'sine', 0.1, 0.4); break;
      case 'checkpoint': [660, 880].forEach((f, i) => setTimeout(() => this.tone(f, 0.12, 'square', 0.08), i * 90)); break;
      case 'door': this.noise(0.25, 0.25, 600); break;
      case 'finish': [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this.tone(f, 0.22, 'square', 0.1), i * 110)); break;
      case 'beep': this.tone(440, 0.18, 'square', 0.12); break;
      case 'go': this.tone(880, 0.45, 'square', 0.14); break;
      case 'out': [400, 300, 200].forEach((f, i) => setTimeout(() => this.tone(f, 0.25, 'triangle', 0.12), i * 160)); break;
    }
  }
}
