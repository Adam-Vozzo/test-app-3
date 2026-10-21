// Direct stereo capture of the master bus to a 16-bit WAV file.
// Uses an AudioWorklet tap; falls back to MediaRecorder (WebM/Ogg) elsewhere.

const WORKLET = `
class RiftCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = true;
    this.l = [];
    this.r = [];
    this.n = 0;
    this.port.onmessage = (e) => { if (e.data === 'stop') this.on = false; };
  }
  flush() {
    if (this.n) this.port.postMessage({ l: this.l, r: this.r });
    this.l = []; this.r = []; this.n = 0;
  }
  process(inputs) {
    if (!this.on) {
      this.flush();
      this.port.postMessage({ done: true });
      return false;
    }
    const input = inputs[0];
    const L = input && input[0] ? input[0] : new Float32Array(128);
    const R = input && input[1] ? input[1] : L;
    this.l.push(L.slice());
    this.r.push(R.slice());
    this.n += L.length;
    if (this.n >= 16384) this.flush();
    return true;
  }
}
registerProcessor('rift-capture', RiftCapture);
`;

const MAX_SECONDS = 600;

export class Recorder {
  constructor(ctx, tap) {
    this.ctx = ctx;
    this.tap = tap;
    this.active = false;
    this.startedAt = 0;
    this.moduleReady = null;
  }

  get elapsed() {
    return this.active ? this.ctx.currentTime - this.startedAt : 0;
  }

  async start() {
    if (this.active) return;
    if (this.ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      if (!this.moduleReady) {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        this.moduleReady = this.ctx.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
      }
      await this.moduleReady;
      this.chunksL = [];
      this.chunksR = [];
      this.frames = 0;
      this.node = new AudioWorkletNode(this.ctx, 'rift-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 2,
        channelCountMode: 'explicit',
      });
      this.node.port.onmessage = (e) => {
        if (e.data.l) {
          this.chunksL.push(...e.data.l);
          this.chunksR.push(...e.data.r);
          for (const c of e.data.l) this.frames += c.length;
          if (this.frames > MAX_SECONDS * this.ctx.sampleRate) this.onLimit?.();
        }
        if (e.data.done) this.finish?.();
      };
      this.sink = this.ctx.createGain();
      this.sink.gain.value = 0;
      this.tap.connect(this.node);
      this.node.connect(this.sink);
      this.sink.connect(this.ctx.destination);
      this.mode = 'wav';
    } else {
      this.dest = this.ctx.createMediaStreamDestination();
      this.tap.connect(this.dest);
      this.parts = [];
      this.media = new MediaRecorder(this.dest.stream);
      this.media.ondataavailable = (e) => e.data.size && this.parts.push(e.data);
      this.media.start(1000);
      this.mode = 'media';
    }
    this.active = true;
    this.startedAt = this.ctx.currentTime;
  }

  async stop() {
    if (!this.active) return null;
    this.active = false;
    if (this.mode === 'wav') {
      await new Promise((resolve) => {
        this.finish = resolve;
        this.node.port.postMessage('stop');
        setTimeout(resolve, 1000);
      });
      this.tap.disconnect(this.node);
      this.node.disconnect();
      this.sink.disconnect();
      return { blob: encodeWav(this.chunksL, this.chunksR, this.frames, this.ctx.sampleRate), ext: 'wav' };
    }
    await new Promise((resolve) => {
      this.media.onstop = resolve;
      this.media.stop();
    });
    this.tap.disconnect(this.dest);
    const type = this.media.mimeType || 'audio/webm';
    return { blob: new Blob(this.parts, { type }), ext: type.includes('ogg') ? 'ogg' : 'webm' };
  }
}

function encodeWav(chunksL, chunksR, frames, sampleRate) {
  const bytes = 44 + frames * 4;
  const view = new DataView(new ArrayBuffer(bytes));
  const ascii = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  ascii(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, frames * 4, true);
  let o = 44;
  for (let c = 0; c < chunksL.length; c++) {
    const L = chunksL[c];
    const R = chunksR[c];
    for (let i = 0; i < L.length && o < bytes; i++) {
      view.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 0x7fff, true);
      view.setInt16(o + 2, Math.max(-1, Math.min(1, R[i])) * 0x7fff, true);
      o += 4;
    }
  }
  return new Blob([view], { type: 'audio/wav' });
}
