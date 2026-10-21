// The adaptive playback engine: a sample-accurate lookahead sequencer over a
// Web Audio graph modelled on the SNES S-DSP (per-voice pitch/ADSR, a shared
// feedback echo with an FIR-style filter, and stereo output).

import {
  BPM, STEPS_PER_BAR, LAYERS, SCORE, STINGERS, FILL, stateIndex,
  padVoicing, bassNote, arpNote, accentNote, melodyNote, timpaniNote,
} from '../score.js';
import { Recorder } from './recorder.js';

export const STEP_SECONDS = 60 / BPM / 4;
const LOOKAHEAD = 0.12;
const HIDDEN_LOOKAHEAD = 0.6;
const ECHO_DELAY = 60 / BPM / 2; // an eighth note: 211 ms, inside the S-DSP's 240 ms limit

const TICKER = `let id = null;
onmessage = (e) => {
  clearInterval(id);
  id = e.data === 'start' ? setInterval(() => postMessage(0), 25) : null;
};`;

const volumeGain = (v) => v * v * 1.5;
const masterGain = (v) => Math.pow(v, 1.6) * 1.15;
const brightness = (threat) => 3200 * Math.pow(2, (threat / 100) * 2.4);

export class Engine {
  constructor(library) {
    this.library = library;
    this.ctx = null;
    this.playing = false;
    this.stateId = 'explore';
    this.pending = null;
    this.step = 0;
    this.stateBar = 0;
    this.nextTime = 0;
    this.threat = 12;
    this.lowHealth = false;
    this.master = 0.8;
    this.stingerQueue = [];
    this.timeline = [];
    this.active = new Set();
    this.layers = LAYERS.map((def) => ({ def, enabled: true, volume: def.volume, sources: [], voices: [], nodes: null, echo: 0.3 }));
  }

  get bar() {
    return Math.floor(this.step / STEPS_PER_BAR) + 1;
  }

  // ------------------------------------------------------------------ graph

  // Call synchronously inside a user gesture so browsers allow audio to start.
  unlock() {
    this.ensureContext();
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  async ensureContext() {
    if (this.ctx) return this.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive' });
    this.buildGraph();
    this.startTicker();
    return this.ctx;
  }

  buildGraph() {
    const ctx = this.ctx;
    this.music = ctx.createGain();
    this.music.gain.value = 0.5;
    this.bright = ctx.createBiquadFilter();
    this.bright.type = 'lowpass';
    this.bright.Q.value = 0.5;
    this.bright.frequency.value = brightness(this.threat);
    this.health = ctx.createBiquadFilter();
    this.health.type = 'lowpass';
    this.health.Q.value = 1.1;
    this.health.frequency.value = this.lowHealth ? 820 : 20000;
    this.transport = ctx.createGain();
    this.transport.gain.value = 0;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 10;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.005;
    this.comp.release.value = 0.2;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0;
    this.out = ctx.createGain();
    this.out.gain.value = masterGain(this.master);

    this.music.connect(this.bright).connect(this.health).connect(this.transport);
    this.transport.connect(this.comp).connect(this.analyser).connect(this.out).connect(ctx.destination);

    // S-DSP style echo: delay line with feedback through an FIR-like filter.
    this.echoIn = ctx.createGain();
    const delay = ctx.createDelay(1);
    delay.delayTime.value = ECHO_DELAY;
    const fir = ctx.createBiquadFilter();
    fir.type = 'lowpass';
    fir.frequency.value = 3200;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 160;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.4;
    const ret = ctx.createGain();
    ret.gain.value = 0.5;
    this.echoIn.connect(delay).connect(fir).connect(hp);
    hp.connect(feedback).connect(delay);
    hp.connect(ret).connect(this.music);

    // Live-event accents bypass the layer mutes but share the echo.
    this.stingerBus = ctx.createGain();
    this.stingerBus.gain.value = 0.9;
    this.stingerBus.connect(this.music);
    const stingerEcho = ctx.createGain();
    stingerEcho.gain.value = 0.4;
    this.stingerBus.connect(stingerEcho).connect(this.echoIn);

    // The heartbeat sits after the low-health filter so it stays clear.
    this.heartBus = ctx.createGain();
    this.heartBus.connect(this.transport);

    for (const layer of this.layers) {
      const input = ctx.createGain();
      // A gentle low-pass stands in for the DSP's Gaussian interpolation.
      const gauss = ctx.createBiquadFilter();
      gauss.type = 'lowpass';
      gauss.frequency.value = 11000;
      gauss.Q.value = 0.4;
      const pan = ctx.createStereoPanner();
      pan.pan.value = layer.def.pan;
      const vol = ctx.createGain();
      vol.gain.value = volumeGain(layer.volume);
      const on = ctx.createGain();
      on.gain.value = layer.enabled ? 1 : 0;
      const send = ctx.createGain();
      send.gain.value = layer.echo;
      input.connect(gauss).connect(pan).connect(vol).connect(on).connect(this.music);
      on.connect(send).connect(this.echoIn);
      layer.nodes = { input, vol, on, send };
    }

    this.recorder = new Recorder(ctx, this.out);
  }

  startTicker() {
    const tick = () => {
      if (this.playing) this.schedule();
    };
    try {
      const url = URL.createObjectURL(new Blob([TICKER], { type: 'application/javascript' }));
      this.worker = new Worker(url);
      URL.revokeObjectURL(url);
      this.worker.onmessage = tick;
      this.worker.postMessage('start');
    } catch {
      setInterval(tick, 25);
    }
  }

  // --------------------------------------------------------------- controls

  setLayerSources(i, sources) {
    const layer = this.layers[i];
    layer.sources = sources;
    layer.voices = this.library.voicesFor(sources, layer.def.role);
    layer.echo = this.library.echoFor(sources, layer.def.role);
    if (layer.nodes) layer.nodes.send.gain.setTargetAtTime(layer.echo, this.ctx.currentTime, 0.05);
  }

  setLayerEnabled(i, on) {
    const layer = this.layers[i];
    layer.enabled = on;
    if (layer.nodes) layer.nodes.on.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.03);
  }

  setLayerVolume(i, v) {
    const layer = this.layers[i];
    layer.volume = v;
    if (layer.nodes) layer.nodes.vol.gain.setTargetAtTime(volumeGain(v), this.ctx.currentTime, 0.03);
  }

  setMaster(v) {
    this.master = v;
    if (this.ctx) this.out.gain.setTargetAtTime(masterGain(v), this.ctx.currentTime, 0.03);
  }

  setThreat(v) {
    if (Math.abs(v - this.threat) < 0.5) return;
    this.threat = v;
    if (this.ctx) this.bright.frequency.setTargetAtTime(brightness(v), this.ctx.currentTime, 0.4);
  }

  setLowHealth(on) {
    this.lowHealth = on;
    if (this.ctx) this.health.frequency.setTargetAtTime(on ? 820 : 20000, this.ctx.currentTime, 0.25);
  }

  // Changes land on the next bar while playing; immediately while stopped.
  requestState(id) {
    if (!this.playing) {
      if (id !== this.stateId) {
        this.stateId = id;
        // Resuming advances a bar, so start one early to land on the phrase top.
        this.stateBar = this.step > 0 ? -1 : 0;
      }
      this.pending = null;
      return 'now';
    }
    this.pending = id === this.stateId ? null : id;
    return 'queued';
  }

  // While stopped the transport is closed; open it for one-off sounds.
  async ensureAudible() {
    this.unlock();
    if (this.ctx.state !== 'running') await this.ctx.resume();
    if (!this.playing) {
      this.transport.gain.cancelScheduledValues(this.ctx.currentTime);
      this.transport.gain.setTargetAtTime(1, this.ctx.currentTime, 0.01);
    }
  }

  async stinger(type) {
    if (this.playing) {
      this.stingerQueue.push(type);
      return;
    }
    await this.ensureAudible();
    const root = SCORE[this.stateId].progression[Math.max(0, this.stateBar) % 4];
    this.playStinger(type, this.ctx.currentTime + 0.03, root);
  }

  // Auditions one note from the arrangement editor, even on a muted layer.
  async preview(layerIndex, note, stateId) {
    const layer = this.layers[layerIndex];
    if (!layer.voices.length) return;
    await this.ensureAudible();
    const root = SCORE[stateId].progression[Math.floor(note.step / STEPS_PER_BAR)];
    const ev = { ...note, len: Math.min(note.len, 8), vel: note.lane ? 0.85 : 0.8 };
    this.playEvent(layer, ev, root, this.ctx.currentTime + 0.02, this.stingerBus);
  }

  async play() {
    await this.ensureContext();
    if (this.ctx.state !== 'running') await this.ctx.resume();
    const now = this.ctx.currentTime;
    this.transport.gain.cancelScheduledValues(now);
    this.transport.gain.setValueAtTime(this.transport.gain.value, now);
    this.transport.gain.linearRampToValueAtTime(1, now + 0.03);
    if (this.step % STEPS_PER_BAR) this.step += STEPS_PER_BAR - (this.step % STEPS_PER_BAR);
    this.nextTime = now + 0.06;
    this.playing = true;
    this.schedule();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    const now = this.ctx.currentTime;
    const g = this.transport.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + 0.12);
    for (const src of this.active) {
      try { src.stop(now + 0.14); } catch { /* already stopped */ }
    }
    this.active.clear();
    this.stingerQueue = [];
    this.timeline = this.timeline.filter((e) => e.time <= now);
  }

  // ------------------------------------------------------------- sequencing

  // Time at which scheduled events are actually heard.
  audibleTime() {
    return this.ctx ? this.ctx.currentTime - (this.ctx.outputLatency || 0) : 0;
  }

  // Timeline entries that have become audible since the last call.
  drain(now) {
    let n = 0;
    while (n < this.timeline.length && this.timeline[n].time <= now) n++;
    return n ? this.timeline.splice(0, n) : [];
  }

  // Queue extra notes with the current instruments before a slow re-render
  // blocks the main thread.
  scheduleAhead(seconds) {
    if (this.playing) this.schedule(seconds);
  }

  schedule(ahead) {
    const now = this.ctx.currentTime;
    if (this.nextTime < now - 0.25) this.nextTime = now + 0.05;
    const horizon = now + (ahead ?? (document.hidden ? HIDDEN_LOOKAHEAD : LOOKAHEAD));
    while (this.nextTime < horizon) {
      this.scheduleStep(this.nextTime);
      this.nextTime += STEP_SECONDS;
      this.step++;
    }
  }

  scheduleStep(t) {
    const inBar = this.step % STEPS_PER_BAR;
    if (inBar === 0) {
      if (this.step > 0) this.stateBar++;
      if (this.pending && this.pending !== this.stateId) {
        this.stateId = this.pending;
        this.stateBar = 0;
        this.timeline.push({ time: t, type: 'state', state: this.stateId, bar: this.bar });
      }
      this.pending = null;
    }

    const score = SCORE[this.stateId];
    const phraseStep = (this.stateBar % 4) * STEPS_PER_BAR + inBar;
    const root = score.progression[this.stateBar % 4];
    this.timeline.push({ time: t, type: 'step', step: this.step, inBar, bar: this.bar, phraseStep, state: this.stateId });

    for (const layer of this.layers) {
      if (!layer.enabled || !layer.voices.length) continue;
      for (const ev of score.layers[layer.def.id][phraseStep]) this.playEvent(layer, ev, root, t);
    }

    const perc = this.layers[3];
    if (inBar >= 12 && this.pending && stateIndex(this.pending) > stateIndex(this.stateId) && perc.enabled) {
      const f = FILL[inBar - 12];
      this.hit(perc, perc.nodes.input, f.lane, t, f.vel, root);
    }

    if (this.lowHealth && inBar % 8 === 0) this.heartbeat(t);

    if (this.stingerQueue.length) {
      const waiting = [];
      for (const type of this.stingerQueue) {
        if (inBar % STINGERS[type].quant === 0) {
          this.playStinger(type, t, root);
          this.timeline.push({ time: t, type: 'stinger', stinger: type, bar: this.bar });
        } else {
          waiting.push(type);
        }
      }
      this.stingerQueue = waiting;
    }
  }

  playEvent(layer, ev, root, t, dest = layer.nodes.input) {
    const dur = ev.len * STEP_SECONDS;
    switch (layer.def.role) {
      case 'pad':
        for (const m of padVoicing(root)) this.voice(layer, dest, m, t, dur, ev.vel * 0.75);
        break;
      case 'bass':
        this.voice(layer, dest, bassNote(root, ev.tok), t, dur * 0.92, ev.vel);
        break;
      case 'arp':
        this.voice(layer, dest, arpNote(root, ev.tok), t, dur * 0.9, ev.vel);
        break;
      case 'lead':
        this.voice(layer, dest, melodyNote(ev.tok), t, dur * 0.97, ev.vel);
        break;
      case 'accent':
        this.voice(layer, dest, accentNote(root, ev.tok), t, dur, ev.vel);
        break;
      case 'kit':
        this.hit(layer, dest, ev.lane, t, ev.vel, root);
        break;
      default:
    }
  }

  voice(layer, dest, midi, t, dur, vel) {
    const k = layer.voices.length > 1 ? 0.72 : 1;
    for (const v of layer.voices) this.track(v.play(this.ctx, dest, midi, t, dur, vel * k));
  }

  hit(layer, dest, lane, t, vel, root) {
    for (const v of layer.voices) this.track(v.hit(this.ctx, dest, lane, t, vel, timpaniNote(root)));
  }

  track(src) {
    if (!src) return;
    if (Array.isArray(src)) {
      src.forEach((s) => this.track(s));
      return;
    }
    this.active.add(src);
    src.addEventListener('ended', () => this.active.delete(src));
  }

  playStinger(type, t, root) {
    const st = STINGERS[type];
    const accents = this.layers[5];
    const perc = this.layers[3];
    for (const n of st.notes) {
      const midi = n.midi ?? (n.mel ? melodyNote(n.mel) : accentNote(root, n.tok));
      this.voice(accents, this.stingerBus, midi, t + n.step * STEP_SECONDS, n.len * STEP_SECONDS, n.vel);
    }
    for (const h of st.hits) this.hit(perc, this.stingerBus, h.lane, t + h.step * STEP_SECONDS, h.vel, 0);
  }

  heartbeat(t) {
    const ctx = this.ctx;
    for (const [dt, v] of [[0, 1], [0.19, 0.65]]) {
      const at = t + dt;
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(72, at);
      osc.frequency.exponentialRampToValueAtTime(38, at + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.6 * v, at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.001, at + 0.22);
      osc.connect(g).connect(this.heartBus);
      osc.addEventListener('ended', () => g.disconnect());
      osc.start(at);
      osc.stop(at + 0.25);
      this.track(osc);
    }
  }
}
