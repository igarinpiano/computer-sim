// Small synthesised sound effects (Web Audio). All tones are original compositions.

import { store } from './storage.js';

let ctx = null;
const ac = () => {
  if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; ctx = new AC(); }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
};
export const sound = {
  get enabled() { return store.get('global:sound', true); },
  set enabled(v) { store.set('global:sound', !!v); },
  unlock() { ac(); },
  // notes: [freq, start (s), duration (s), gain?]
  play(notes, { type = 'sine', gain = 0.12, attack = 0.02, release = 0.25 } = {}) {
    if (!this.enabled) return;
    const a = ac();
    if (!a || a.state !== 'running') return;
    const t0 = a.currentTime + 0.02, out = a.createGain();
    out.gain.value = 1; out.connect(a.destination);
    for (const [f, at, dur, g = 1] of notes) {
      const o = a.createOscillator(), v = a.createGain();
      o.type = type; o.frequency.value = f;
      v.gain.setValueAtTime(0, t0 + at);
      v.gain.linearRampToValueAtTime(gain * g, t0 + at + attack);
      v.gain.setValueAtTime(gain * g, t0 + at + Math.max(attack, dur - release));
      v.gain.exponentialRampToValueAtTime(0.0001, t0 + at + dur + release);
      o.connect(v); v.connect(out);
      o.start(t0 + at); o.stop(t0 + at + dur + release + 0.05);
    }
  },
  fx(name, theme = 'xp') {
    const N = { C4: 261.6, D4: 293.7, E4: 329.6, G4: 392, A4: 440, B4: 493.9, C5: 523.3, D5: 587.3, E5: 659.3, G5: 784, A5: 880, C6: 1046.5, E6: 1318.5 };
    switch (name) {
      case 'startup': return theme === 'mint'
        ? this.play([[N.C4, 0, 1.6, 0.6], [N.G4, 0.25, 1.4, 0.7], [N.E5, 0.5, 1.4, 0.8], [N.C6, 0.9, 1.6, 0.6]], { type: 'triangle', release: 0.9, attack: 0.15 })
        : this.play([[N.E5, 0, 0.5], [N.C5, 0.28, 0.4, 0.8], [N.G5, 0.56, 0.5], [N.E5, 0.9, 0.3, 0.7], [N.C6, 1.15, 1.2], [N.G4, 1.15, 1.2, 0.5], [N.E4, 0, 1.6, 0.35]], { type: 'triangle', release: 0.7, attack: 0.04 });
      case 'shutdown': return this.play([[N.C6, 0, 0.3], [N.G5, 0.22, 0.3, 0.9], [N.E5, 0.44, 0.3, 0.8], [N.C5, 0.66, 1, 0.9], [N.C4, 0.66, 1, 0.4]], { type: 'triangle', release: 0.6 });
      case 'ding': return this.play([[N.A5, 0, 0.12], [N.E6, 0.07, 0.25, 0.6]], { type: 'sine', release: 0.3 });
      case 'warn': return this.play([[N.E5, 0, 0.1], [N.E5, 0.16, 0.2]], { type: 'triangle', release: 0.2 });
      case 'error': return this.play([[N.D4, 0, 0.16], [196, 0.14, 0.3, 0.9]], { type: 'square', gain: 0.06, release: 0.2 });
      case 'click': return this.play([[1200, 0, 0.01, 0.3]], { type: 'square', gain: 0.03, attack: 0.001, release: 0.03 });
      case 'bell': return this.play([[N.A5, 0, 0.06]], { type: 'square', gain: 0.04, release: 0.08 });
      case 'boom': return this.play([[70, 0, 0.3], [45, 0.05, 0.5]], { type: 'sawtooth', gain: 0.18, release: 0.5 });
      case 'win': return this.play([[N.C5, 0, 0.12], [N.E5, 0.12, 0.12], [N.G5, 0.24, 0.12], [N.C6, 0.36, 0.5]], { type: 'triangle', release: 0.3 });
      case 'beep': return this.play([[880, 0, 0.14]], { type: 'square', gain: 0.05, release: 0.02, attack: 0.001 });
    }
  },
};
