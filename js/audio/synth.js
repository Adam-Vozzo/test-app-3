// Offline sample renderer. Each recipe is rendered once into a short (often
// looped) mono sample at an SNES-like sample rate, pushed through the BRR codec
// and wrapped in an AudioBuffer. Playback then works the way the S-DSP did:
// pitch by resampling, loop the sustain, shape with an ADSR envelope.

import { brrRoundTrip } from './brr.js';

const TAU = Math.PI * 2;
const TABLE = 4096;

// Base pitch of each sample. Periods are whole numbers of samples (and multiples
// of 16) at 32 kHz and 16 kHz so loops stay seamless and BRR blocks line up.
export const RANGE_FREQ = { bass: 125, mid: 250, high: 500 };
const DEFAULT_MAX_HZ = { bass: 4000, mid: 7000, high: 9000 };

const ceil16 = (n) => Math.max(16, Math.ceil(n / 16) * 16);

export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

// RBJ cookbook biquad for offline processing.
function biquad(type, freq, q, sr) {
  const w = (TAU * Math.min(freq, sr * 0.45)) / sr;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  let b0;
  let b1;
  let b2;
  if (type === 'highpass') {
    b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0;
  } else if (type === 'bandpass') {
    b0 = alpha; b1 = 0; b2 = -alpha;
  } else {
    b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0;
  }
  const a0 = 1 + alpha;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  b0 /= a0; b1 /= a0; b2 /= a0;
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
  return (x) => {
    const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

function harmonicAmps(wave, f0, maxHz) {
  const K = Math.max(1, Math.floor(maxHz / f0));
  const amps = new Float64Array(K + 1);
  const tilt = wave.tilt ?? 1;
  for (let k = 1; k <= K; k++) {
    let a;
    switch (wave.shape) {
      case 'square': a = k % 2 ? 1 / Math.pow(k, tilt) : 0; break;
      case 'pulse': a = Math.sin(Math.PI * k * (wave.duty ?? 0.25)) / Math.pow(k, tilt); break;
      case 'tri': a = k % 2 ? ((((k - 1) / 2) % 2) ? -1 : 1) / (k * k) : 0; break;
      case 'sine': a = k === 1 ? 1 : 0; break;
      case 'custom': a = wave.harms[k - 1] || 0; break;
      default: a = 1 / Math.pow(k, tilt);
    }
    if (wave.even !== undefined && k % 2 === 0) a *= wave.even;
    if (wave.formants) {
      let g = wave.floor ?? 0.06;
      for (const [fc, bw, amp] of wave.formants) {
        const d = (k * f0 - fc) / bw;
        g += amp * Math.exp(-d * d);
      }
      a *= g;
    }
    amps[k] = a;
  }
  return amps;
}

function cycleTable(wave, f0, maxHz, drive) {
  const t = new Float32Array(TABLE);
  if (wave.fm) {
    const { ratio = 2, index = 1, carrier = 1 } = wave.fm;
    for (let i = 0; i < TABLE; i++) {
      const ph = (TAU * i) / TABLE;
      t[i] = Math.sin(carrier * ph + index * Math.sin(ratio * ph));
    }
  } else {
    const amps = harmonicAmps(wave, f0, maxHz);
    for (let k = 1; k < amps.length; k++) {
      const a = amps[k];
      if (!a) continue;
      for (let i = 0; i < TABLE; i++) t[i] += a * Math.sin((TAU * k * i) / TABLE);
    }
  }
  normalize(t, 1);
  if (drive) {
    const n = Math.tanh(drive);
    for (let i = 0; i < TABLE; i++) t[i] = Math.tanh(drive * t[i]) / n;
  }
  return t;
}

function normalize(buf, peak) {
  let max = 0;
  for (let i = 0; i < buf.length; i++) max = Math.max(max, Math.abs(buf[i]));
  if (max > 0) {
    const k = peak / max;
    for (let i = 0; i < buf.length; i++) buf[i] *= k;
  }
  return buf;
}

// Filtered noise that loops seamlessly over `len` samples (the filter runs over
// the sequence twice so its state has settled by the wrap point).
function periodicNoise(len, sr, freq, q, rnd) {
  const white = new Float32Array(len);
  for (let i = 0; i < len; i++) white[i] = rnd() * 2 - 1;
  const f = biquad('bandpass', freq, q, sr);
  for (let i = 0; i < len; i++) f(white[i]);
  const out = new Float32Array(len);
  let sum = 0;
  for (let i = 0; i < len; i++) {
    out[i] = f(white[i]);
    sum += out[i] * out[i];
  }
  const rms = Math.sqrt(sum / len) || 1;
  for (let i = 0; i < len; i++) out[i] *= 0.3 / rms;
  return out;
}

// Sustained, looped tone. Detuned copies complete N±1 cycles over an N-cycle
// loop, so chorus beating is baked in without breaking the loop.
function renderTone(r, sr, rnd) {
  const range = r.range || 'mid';
  const f0 = RANGE_FREQ[range];
  const P = Math.round(sr / f0);
  const table = cycleTable(r.wave || {}, f0, r.maxHz ?? DEFAULT_MAX_HZ[range], r.drive);
  let N = 8;
  if (r.chorus) N = Math.round(1 / (Math.pow(2, r.chorus / 1200) - 1));
  N = Math.max(4, Math.min(N, Math.floor(((r.loopSec ?? 0.9) * sr) / P)));
  const L = N * P;
  const A = r.attack?.time ? ceil16(r.attack.time * sr) : 0;
  const len = A + L;
  const out = new Float32Array(len);
  const step = TABLE / P;
  const copies = r.chorus ? (r.ensemble ? [N + 1, N - 1] : [N + 1]) : [];
  const mix = r.chorusMix ?? 0.8;
  const breath = r.breath ? periodicNoise(L, sr, r.breathFreq ?? 2400, 0.9, rnd) : null;
  const atk = r.attack;
  const atkFilter = atk ? biquad('bandpass', atk.freq ?? 3000, 0.7, sr) : null;

  for (let n = 0; n < len; n++) {
    let x = table[(n % P) * step];
    if (copies.length) {
      let sum = x;
      for (const c of copies) {
        const q = (((n * c) % L) * TABLE) / L;
        const i0 = q | 0;
        const fr = q - i0;
        sum += mix * (table[i0 % TABLE] * (1 - fr) + table[(i0 + 1) % TABLE] * fr);
      }
      x = sum / (1 + mix * copies.length);
    }
    if (breath) x += r.breath * breath[(((n - A) % L) + L) % L];
    if (n < A) {
      const e = 1 - n / A;
      x += e * e * (atk.noise ?? 0) * 3 * atkFilter(rnd() * 2 - 1);
    }
    out[n] = x;
  }
  return { data: out, baseFreq: sr / P, loop: true, loopStart: A, loopEnd: len };
}

// Karplus-Strong plucked string with a zero-phase damping filter so the pitch
// lands exactly on the base frequency.
function renderPluck(r, sr, rnd) {
  const f0 = RANGE_FREQ[r.range || 'mid'];
  const P = Math.round(sr / f0);
  const len = ceil16((r.length ?? 1.6) * sr);
  const y = new Float32Array(len);
  const exc = new Float32Array(P);
  const bright = r.bright ?? 0.6;
  let lp = 0;
  for (let i = 0; i < P; i++) {
    lp += bright * (rnd() * 2 - 1 - lp);
    exc[i] = lp;
  }
  if (r.pick) {
    const d = Math.max(1, Math.round(r.pick * P));
    const tmp = exc.slice();
    for (let i = 0; i < P; i++) exc[i] = tmp[i] - tmp[(i + d) % P];
  }
  let mean = 0;
  for (let i = 0; i < P; i++) mean += exc[i];
  mean /= P;
  for (let i = 0; i < P; i++) y[i] = exc[i] - mean;
  const g = Math.pow(10, (-3 * P) / (sr * (r.t60 ?? 1.5)));
  const w1 = r.damp ?? 0.12;
  const w0 = 1 - 2 * w1;
  for (let n = P; n < len; n++) {
    const before = n - P - 1 >= 0 ? y[n - P - 1] : 0;
    y[n] = g * (w0 * y[n - P] + w1 * (before + y[n - P + 1]));
  }
  return { data: y, baseFreq: sr / P, loop: false };
}

// Struck bars and bells: a handful of decaying (often inharmonic) partials.
function renderMallet(r, sr, rnd) {
  const f0 = r.f0 ?? RANGE_FREQ[r.range || 'mid'];
  const longest = Math.max(...r.partials.map((p) => p[2]));
  const len = ceil16(Math.min(r.length ?? longest * 5, 2.5) * sr);
  const out = new Float32Array(len);
  const ramp = 0.0015 * sr;
  const click = r.click ? biquad('bandpass', 3200, 0.8, sr) : null;
  for (let n = 0; n < len; n++) {
    const t = n / sr;
    let x = 0;
    for (const [ratio, amp, decay] of r.partials) {
      if (f0 * ratio >= sr / 2) continue;
      x += amp * Math.exp(-t / decay) * Math.sin(TAU * f0 * ratio * t);
    }
    if (r.trem) x *= 1 - r.trem * 0.5 * (1 - Math.cos(TAU * (r.tremRate ?? 5) * t));
    if (n < ramp) x *= n / ramp;
    if (click) x += r.click * Math.exp(-t / 0.004) * click(rnd() * 2 - 1) * 2;
    out[n] = x;
  }
  return { data: out, baseFreq: f0, loop: false };
}

// Two-operator FM strike with a decaying modulation index (bells, glass, metal).
function renderFm(r, sr) {
  const f0 = RANGE_FREQ[r.range || 'mid'];
  const len = ceil16(Math.min(r.decay * 5, 3) * sr);
  const out = new Float32Array(len);
  const idecay = r.idecay ?? r.decay * 0.5;
  const ramp = 0.001 * sr;
  for (let n = 0; n < len; n++) {
    const t = n / sr;
    const I = r.index * Math.exp(-t / idecay);
    let x = Math.sin(TAU * f0 * t + I * Math.sin(TAU * f0 * r.ratio * t)) * Math.exp(-t / r.decay);
    if (n < ramp) x *= n / ramp;
    out[n] = x;
  }
  return { data: out, baseFreq: f0, loop: false };
}

function renderKick(r, sr, rnd) {
  const len = ceil16(Math.min(r.decay * 6, 1.2) * sr);
  const out = new Float32Array(len);
  const lp = biquad('lowpass', 2500, 0.7, sr);
  const f0 = r.f0 ?? 140;
  const f1 = r.f1 ?? 48;
  const pd = r.pdecay ?? 0.035;
  const drive = r.drive ?? 1.6;
  let phase = 0;
  for (let n = 0; n < len; n++) {
    const t = n / sr;
    const f = f1 + (f0 - f1) * Math.exp(-t / pd);
    phase += (TAU * f) / sr;
    let x = Math.sin(phase) * Math.exp(-t / r.decay);
    x += (r.click ?? 0.3) * Math.exp(-t / 0.003) * lp(rnd() * 2 - 1);
    out[n] = Math.tanh(drive * x);
  }
  return { data: out, baseFreq: null, loop: false };
}

function renderSnare(r, sr, rnd) {
  const decay = r.decay ?? 0.16;
  const len = ceil16(Math.min(decay * 6, 1.2) * sr);
  const out = new Float32Array(len);
  const hp = biquad('highpass', r.hp ?? 900, 0.7, sr);
  const lp = biquad('lowpass', r.lp ?? 7000, 0.7, sr);
  const tone = r.tone ?? 185;
  const noiseAmt = r.noise ?? 0.75;
  for (let n = 0; n < len; n++) {
    const t = n / sr;
    const body = (Math.sin(TAU * tone * t) + 0.5 * Math.sin(TAU * tone * 1.72 * t)) * Math.exp(-t / (r.toneDecay ?? 0.06));
    const nz = lp(hp(rnd() * 2 - 1)) * Math.exp(-t / decay);
    out[n] = (1 - noiseAmt) * body + noiseAmt * nz * 2.2;
  }
  return { data: out, baseFreq: null, loop: false };
}

const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];

function renderMetal(r, sr, rnd) {
  const decay = r.decay ?? 0.05;
  const len = ceil16(Math.min(decay * 4.5 + (r.attack ?? 0), 1.8) * sr);
  const out = new Float32Array(len);
  const hp1 = biquad('highpass', r.hp ?? 7000, 0.7, sr);
  const hp2 = biquad('highpass', r.hp ?? 7000, 0.7, sr);
  const noiseAmt = r.noise ?? 0.5;
  const steps = METAL.map((f) => (f * (r.tune ?? 1)) / sr);
  const phases = METAL.map(() => 0);
  const atk = (r.attack ?? 0) * sr;
  for (let n = 0; n < len; n++) {
    const t = n / sr;
    let m = 0;
    for (let i = 0; i < 6; i++) {
      phases[i] = (phases[i] + steps[i]) % 1;
      m += phases[i] < 0.5 ? 1 : -1;
    }
    let x = hp2(hp1((1 - noiseAmt) * (m / 6) + noiseAmt * (rnd() * 2 - 1)));
    let env = Math.exp(-t / decay);
    if (n < atk) env *= n / atk;
    x *= env;
    out[n] = x;
  }
  return { data: out, baseFreq: null, loop: false };
}

function renderTom(r, sr, rnd) {
  const len = ceil16(Math.min(r.decay * 6, 1.4) * sr);
  const out = new Float32Array(len);
  const lp = biquad('lowpass', 3000, 0.7, sr);
  const f0 = r.f0 ?? 200;
  const f1 = r.f1 ?? 140;
  const pd = r.pdecay ?? 0.08;
  let phase = 0;
  for (let n = 0; n < len; n++) {
    const t = n / sr;
    phase += (TAU * (f1 + (f0 - f1) * Math.exp(-t / pd))) / sr;
    let x = (Math.sin(phase) + 0.25 * Math.sin(phase * 1.6)) * Math.exp(-t / r.decay);
    x += (r.click ?? 0.15) * Math.exp(-t / 0.006) * lp(rnd() * 2 - 1) * 2;
    out[n] = Math.tanh(1.3 * x);
  }
  return { data: out, baseFreq: null, loop: false };
}

// Pitched membrane: inharmonic modes of a kettle drum.
function renderTimpani(r, sr, rnd) {
  const f0 = RANGE_FREQ.bass;
  const decay = r.decay ?? 1.4;
  const len = ceil16(Math.min(decay * 3, 2) * sr);
  const out = new Float32Array(len);
  const lp = biquad('lowpass', 900, 0.7, sr);
  const modes = [[1, 1, decay], [1.5, 0.5, decay * 0.6], [1.98, 0.35, decay * 0.45], [2.44, 0.2, decay * 0.3], [2.9, 0.12, decay * 0.2]];
  for (let n = 0; n < len; n++) {
    const t = n / sr;
    let x = 0;
    for (const [ratio, amp, d] of modes) x += amp * Math.exp(-t / d) * Math.sin(TAU * f0 * ratio * t);
    x += 0.8 * Math.exp(-t / 0.02) * lp(rnd() * 2 - 1);
    out[n] = x;
  }
  return { data: out, baseFreq: f0, loop: false };
}

function renderClap(r, sr, rnd) {
  const decay = r.decay ?? 0.18;
  const len = ceil16(Math.min(decay * 5 + 0.04, 1) * sr);
  const out = new Float32Array(len);
  const bp = biquad('bandpass', r.freq ?? 1100, 1.4, sr);
  for (let n = 0; n < len; n++) {
    const t = n / sr;
    let env = Math.exp(-Math.max(0, t - 0.022) / decay) * 0.7;
    for (const s of [0, 0.009, 0.018]) if (t >= s) env = Math.max(env, Math.exp(-(t - s) / 0.005));
    out[n] = bp(rnd() * 2 - 1) * env;
  }
  return { data: out, baseFreq: null, loop: false };
}

const RENDERERS = {
  tone: renderTone,
  pluck: renderPluck,
  mallet: renderMallet,
  fm: renderFm,
  kick: renderKick,
  snare: renderSnare,
  metal: renderMetal,
  tom: renderTom,
  timpani: renderTimpani,
  clap: renderClap,
};

const DEFAULT_ENV = {
  tone: [0.01, 0.3, 0.8, 0.2],
  pluck: [0.002, 0.1, 1, 0.35],
  mallet: [0.002, 0.1, 1, 0.45],
  fm: [0.002, 0.1, 1, 0.6],
};

export function renderRecipe(recipe, sampleRate, seedKey = '') {
  const kind = recipe.kind || 'tone';
  const render = RENDERERS[kind];
  if (!render) throw new Error(`Unknown instrument kind: ${kind}`);
  const sr = recipe.rate ?? sampleRate ?? 32000;
  const rnd = makeRng(hashSeed(seedKey || JSON.stringify(recipe)));
  const res = render(recipe, sr, rnd);
  let data = res.data;
  if (data.length % 16) {
    const padded = new Float32Array(ceil16(data.length));
    padded.set(data);
    data = padded;
  }
  normalize(data, 0.92);
  if (recipe.brr !== false) data = brrRoundTrip(data);
  const buffer = new AudioBuffer({ length: data.length, numberOfChannels: 1, sampleRate: sr });
  buffer.copyToChannel(data, 0);

  // Loudness of the sustained part (the loop, or the first 300 ms of a one-shot).
  const from = res.loop ? res.loopStart : 0;
  const to = res.loop ? res.loopEnd : Math.min(data.length, Math.round(0.3 * sr));
  let sum = 0;
  for (let i = from; i < to; i++) sum += data[i] * data[i];

  return {
    buffer,
    baseFreq: res.baseFreq,
    loop: res.loop,
    loopStart: res.loop ? res.loopStart / sr : 0,
    loopEnd: res.loop ? res.loopEnd / sr : 0,
    rms: Math.sqrt(sum / Math.max(1, to - from)),
  };
}

export function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

// A rendered sample plus how to play it. With a `level`, the instrument is
// loudness-matched so banks can be swapped without rebalancing the mix;
// without one (drums) the recipe's own gain applies.
export class SampleInstrument {
  constructor(recipe, sampleRate, seedKey, level) {
    Object.assign(this, renderRecipe(recipe, sampleRate, seedKey));
    if (recipe.fixed) this.baseFreq = null;
    this.env = recipe.env ?? DEFAULT_ENV[recipe.kind || 'tone'] ?? [0.001, 0.1, 1, 0.08];
    this.gain = level == null ? recipe.gain ?? 0.6 : (level * 0.25) / Math.max(this.rms, 0.03);
    this.vib = recipe.vib ?? null;
    this.oct = recipe.oct ?? 0;
    this.pan = recipe.pan ?? 0;
    this.tune = recipe.tune ?? 0;
  }

  play(ctx, dest, midi, t, dur, vel) {
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    let rate = 1;
    if (this.baseFreq && midi != null) rate = midiToFreq(midi + 12 * this.oct) / this.baseFreq;
    else if (this.tune) rate = Math.pow(2, this.tune / 12);
    src.playbackRate.value = rate;
    if (this.loop) {
      src.loop = true;
      src.loopStart = this.loopStart;
      src.loopEnd = this.loopEnd;
    }

    const env = ctx.createGain();
    const [a, d, s, r] = this.env;
    const peak = Math.max(0.0001, vel * this.gain);
    const g = env.gain;
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(peak, t + a);
    if (s < 1) g.setTargetAtTime(peak * s, t + a, Math.max(d, 0.005) / 3);
    const off = t + Math.max(dur, a + 0.005);
    g.setTargetAtTime(0, off, Math.max(r, 0.005) / 4);
    let stopAt = off + r * 1.5 + 0.02;
    if (!this.loop) stopAt = Math.min(stopAt, t + this.buffer.duration / rate + 0.01);

    src.connect(env);
    let out = env;
    if (this.pan) {
      out = ctx.createStereoPanner();
      out.pan.value = this.pan;
      env.connect(out);
    }
    out.connect(dest);

    if (this.vib && dur > this.vib.delay) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = this.vib.rate;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0, t);
      depth.gain.setValueAtTime(0, t + this.vib.delay);
      depth.gain.linearRampToValueAtTime(this.vib.depth, t + this.vib.delay + 0.3);
      lfo.connect(depth);
      depth.connect(src.detune);
      lfo.start(t);
      lfo.stop(stopAt);
    }

    src.addEventListener('ended', () => out.disconnect());
    src.start(t);
    src.stop(stopAt);
    return src;
  }
}

// A drum kit: one sample per lane. Pitched lanes (timpani) follow the harmony.
export class BuiltinKit {
  constructor(lanes) {
    this.lanes = lanes;
  }

  hit(ctx, dest, lane, t, vel, pitch) {
    const inst = this.lanes[lane];
    if (!inst) return null;
    const midi = inst.baseFreq ? pitch : null;
    return inst.play(ctx, dest, midi, t, inst.buffer.duration + 0.05, vel);
  }
}
