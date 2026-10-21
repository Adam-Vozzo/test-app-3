// SoundFont 2 loader. Parses the RIFF structure, flattens preset and
// instrument zones, and plays them with the generators that matter for SNES
// rips: key/velocity splits, tuning, loops, volume envelope, pan, filter.

const GEN = {
  startAddrsOffset: 0, endAddrsOffset: 1, startloopAddrsOffset: 2, endloopAddrsOffset: 3,
  startAddrsCoarseOffset: 4, initialFilterFc: 8, initialFilterQ: 9, endAddrsCoarseOffset: 12,
  pan: 17, delayVolEnv: 33, attackVolEnv: 34, holdVolEnv: 35, decayVolEnv: 36,
  sustainVolEnv: 37, releaseVolEnv: 38, instrument: 41, keyRange: 43, velRange: 44,
  startloopAddrsCoarseOffset: 45, keynum: 46, initialAttenuation: 48,
  endloopAddrsCoarseOffset: 50, coarseTune: 51, fineTune: 52, sampleID: 53,
  sampleModes: 54, scaleTuning: 56, overridingRootKey: 58,
};

const DEFAULTS = {
  [GEN.initialFilterFc]: 13500, [GEN.delayVolEnv]: -12000, [GEN.attackVolEnv]: -12000,
  [GEN.holdVolEnv]: -12000, [GEN.decayVolEnv]: -12000, [GEN.releaseVolEnv]: -12000,
  [GEN.scaleTuning]: 100, [GEN.keynum]: -1, [GEN.overridingRootKey]: -1,
};

// Preset-level generators are offsets added to the instrument level.
const ADDITIVE = new Set([
  GEN.initialFilterFc, GEN.initialFilterQ, GEN.pan, GEN.delayVolEnv, GEN.attackVolEnv,
  GEN.holdVolEnv, GEN.decayVolEnv, GEN.sustainVolEnv, GEN.releaseVolEnv,
  GEN.initialAttenuation, GEN.coarseTune, GEN.fineTune, GEN.scaleTuning,
]);

// General MIDI percussion notes for each kit lane.
const GM_DRUMS = { k: 36, s: 38, h: 42, o: 46, t: 48, l: 45, c: 49, p: 41 };

let fontSeq = 0;

export function parseSf2(arrayBuffer, fileName = 'soundfont.sf2') {
  const dv = new DataView(arrayBuffer);
  const u8 = new Uint8Array(arrayBuffer);
  const fourcc = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  const text = (o, n) => {
    let s = '';
    for (let i = 0; i < n && u8[o + i]; i++) s += String.fromCharCode(u8[o + i]);
    return s.trim();
  };

  if (arrayBuffer.byteLength < 12 || fourcc(0) !== 'RIFF' || fourcc(8) !== 'sfbk') {
    throw new Error('Not a SoundFont 2 (.sf2) file.');
  }

  const chunks = {};
  const walk = (start, end) => {
    let o = start;
    while (o + 8 <= end) {
      const id = fourcc(o);
      const size = dv.getUint32(o + 4, true);
      const body = o + 8;
      if (id === 'LIST') walk(body + 4, Math.min(body + size, end));
      else if (!chunks[id]) chunks[id] = { o: body, size: Math.min(size, end - body) };
      o = body + size + (size & 1);
    }
  };
  walk(12, Math.min(arrayBuffer.byteLength, 8 + dv.getUint32(4, true)));

  for (const id of ['smpl', 'phdr', 'pbag', 'pgen', 'inst', 'ibag', 'igen', 'shdr']) {
    if (!chunks[id]) throw new Error(`SoundFont is missing its "${id}" chunk.`);
  }

  const records = (id, size, read) => {
    const { o, size: bytes } = chunks[id];
    const list = [];
    for (let i = 0; i + size <= bytes; i += size) list.push(read(o + i));
    return list;
  };

  const phdr = records('phdr', 38, (o) => ({ name: text(o, 20), program: dv.getUint16(o + 20, true), bank: dv.getUint16(o + 22, true), bag: dv.getUint16(o + 24, true) }));
  const pbag = records('pbag', 4, (o) => dv.getUint16(o, true));
  const inst = records('inst', 22, (o) => ({ name: text(o, 20), bag: dv.getUint16(o + 20, true) }));
  const ibag = records('ibag', 4, (o) => dv.getUint16(o, true));
  const readGen = (o) => {
    const oper = dv.getUint16(o, true);
    if (oper === GEN.keyRange || oper === GEN.velRange) return { oper, value: [u8[o + 2], u8[o + 3]] };
    if (oper === GEN.instrument || oper === GEN.sampleID) return { oper, value: dv.getUint16(o + 2, true) };
    return { oper, value: dv.getInt16(o + 2, true) };
  };
  const pgen = records('pgen', 4, readGen);
  const igen = records('igen', 4, readGen);
  const shdr = records('shdr', 46, (o) => ({
    name: text(o, 20),
    start: dv.getUint32(o + 20, true),
    end: dv.getUint32(o + 24, true),
    loopStart: dv.getUint32(o + 28, true),
    loopEnd: dv.getUint32(o + 32, true),
    rate: dv.getUint32(o + 36, true),
    pitch: u8[o + 40],
    correction: dv.getInt8(o + 41),
    type: dv.getUint16(o + 44, true),
  }));

  const smpl = chunks.smpl;
  const pcm = smpl.o % 2 === 0
    ? new Int16Array(arrayBuffer, smpl.o, smpl.size >> 1)
    : new Int16Array(arrayBuffer.slice(smpl.o, smpl.o + (smpl.size & ~1)));

  const zonesOf = (bags, gens, from, to) => {
    const zones = [];
    for (let b = from; b < to && b + 1 < bags.length; b++) {
      const z = {};
      for (let g = bags[b]; g < bags[b + 1] && g < gens.length; g++) z[gens[g].oper] = gens[g].value;
      zones.push(z);
    }
    return zones;
  };

  const instruments = inst.slice(0, -1).map((ins, i) => {
    const zones = zonesOf(ibag, igen, ins.bag, inst[i + 1].bag);
    const global = zones.length && zones[0][GEN.sampleID] === undefined ? zones.shift() : {};
    return zones.filter((z) => z[GEN.sampleID] !== undefined).map((z) => ({ ...global, ...z }));
  });

  const presets = phdr.slice(0, -1).map((p, i) => {
    const pz = zonesOf(pbag, pgen, p.bag, phdr[i + 1].bag);
    const global = pz.length && pz[0][GEN.instrument] === undefined ? pz.shift() : {};
    const zones = [];
    for (const local of pz) {
      if (local[GEN.instrument] === undefined) continue;
      const pzone = { ...global, ...local };
      for (const iz of instruments[pzone[GEN.instrument]] || []) {
        const sample = shdr[iz[GEN.sampleID]];
        if (!sample || sample.type & 0x8000) continue;
        const gen = { ...DEFAULTS, ...iz };
        for (const [oper, value] of Object.entries(pzone)) {
          if (ADDITIVE.has(+oper)) gen[oper] = (gen[oper] ?? 0) + value;
        }
        const [pk0, pk1] = pzone[GEN.keyRange] ?? [0, 127];
        const [ik0, ik1] = iz[GEN.keyRange] ?? [0, 127];
        const [pv0, pv1] = pzone[GEN.velRange] ?? [0, 127];
        const [iv0, iv1] = iz[GEN.velRange] ?? [0, 127];
        const keyLo = Math.max(pk0, ik0);
        const keyHi = Math.min(pk1, ik1);
        const velLo = Math.max(pv0, iv0);
        const velHi = Math.min(pv1, iv1);
        if (keyLo > keyHi || velLo > velHi) continue;
        const g = (n) => gen[n] ?? 0;
        zones.push({
          keyLo, keyHi, velLo, velHi, gen, sample,
          start: sample.start + g(GEN.startAddrsOffset) + g(GEN.startAddrsCoarseOffset) * 32768,
          end: sample.end + g(GEN.endAddrsOffset) + g(GEN.endAddrsCoarseOffset) * 32768,
          loopStart: sample.loopStart + g(GEN.startloopAddrsOffset) + g(GEN.startloopAddrsCoarseOffset) * 32768,
          loopEnd: sample.loopEnd + g(GEN.endloopAddrsOffset) + g(GEN.endloopAddrsCoarseOffset) * 32768,
        });
      }
    }
    return { index: i, name: p.name || `Preset ${i + 1}`, bank: p.bank, program: p.program, zones };
  }).filter((p) => p.zones.length);

  if (!presets.length) throw new Error('No playable presets found in this SoundFont.');
  presets.sort((a, b) => a.bank - b.bank || a.program - b.program);

  const name = text(chunks.INAM?.o ?? 0, chunks.INAM ? Math.min(chunks.INAM.size, 256) : 0) || fileName.replace(/\.sf2$/i, '');
  return new SoundFont(`sf${++fontSeq}`, name, fileName, presets, pcm);
}

const timecents = (tc) => Math.min(20, Math.pow(2, tc / 1200));

export class SoundFont {
  constructor(id, name, fileName, presets, pcm) {
    this.id = id;
    this.name = name;
    this.fileName = fileName;
    this.presets = presets;
    this.pcm = pcm;
    this.buffers = new Map();
    this.voices = new Map();
  }

  presetLabel(p) {
    return `${String(p.bank).padStart(3, '0')}:${String(p.program).padStart(3, '0')} ${p.name}`;
  }

  presetByIndex(index) {
    return this.presets.find((p) => p.index === index) ?? this.presets[0];
  }

  voice(index) {
    const preset = this.presetByIndex(index);
    if (!this.voices.has(preset.index)) this.voices.set(preset.index, new Sf2Voice(this, preset));
    return this.voices.get(preset.index);
  }

  bufferFor(zone) {
    const start = Math.max(0, zone.start);
    const end = Math.min(this.pcm.length, Math.max(zone.end, start + 1));
    const key = `${start}:${end}:${zone.sample.rate}`;
    if (!this.buffers.has(key)) {
      const rate = Math.min(192000, Math.max(3000, zone.sample.rate || 32000));
      const data = new Float32Array(end - start);
      for (let i = 0; i < data.length; i++) data[i] = this.pcm[start + i] / 32768;
      const buffer = new AudioBuffer({ length: Math.max(1, data.length), numberOfChannels: 1, sampleRate: rate });
      buffer.copyToChannel(data, 0);
      this.buffers.set(key, buffer);
    }
    return this.buffers.get(key);
  }

  // Best preset for a layer role, guessed from preset names.
  suggestPreset(role) {
    const hints = {
      pad: /string|pad|choir|aah|organ|ensemble|voice|strs|warm/i,
      bass: /bass/i,
      arp: /harp|marimba|xylo|vibe|piano|guitar|kalimba|steel|pluck|harpsi|celest|music ?box/i,
      lead: /flute|oboe|ocarina|clarinet|trumpet|horn|sax|lead|violin|whistle|recorder|pipe/i,
      accent: /bell|glock|brass|hit|chime|celesta|stab|tubular|orch/i,
    };
    if (role === 'kit') {
      return (this.presets.find((p) => p.bank === 128) ?? this.presets.find((p) => /drum|kit|perc|snare|kick/i.test(p.name)) ?? this.presets[0]).index;
    }
    return (this.presets.find((p) => p.bank !== 128 && hints[role]?.test(p.name)) ?? this.presets.find((p) => p.bank !== 128) ?? this.presets[0]).index;
  }
}

class Sf2Voice {
  constructor(font, preset) {
    this.font = font;
    this.preset = preset;
    this.isFont = true;
  }

  zonesFor(midi, vel127) {
    const zones = this.preset.zones;
    const hits = zones.filter((z) => midi >= z.keyLo && midi <= z.keyHi && vel127 >= z.velLo && vel127 <= z.velHi);
    if (hits.length) return hits;
    let best = null;
    let dist = Infinity;
    for (const z of zones) {
      const d = midi < z.keyLo ? z.keyLo - midi : midi - z.keyHi;
      if (d < dist) { dist = d; best = z; }
    }
    return best ? [best] : [];
  }

  play(ctx, dest, midi, t, dur, vel) {
    const v127 = Math.max(1, Math.min(127, Math.round(vel * 127)));
    return this.zonesFor(midi, v127).map((z) => this.playZone(ctx, dest, z, midi, t, dur, vel));
  }

  hit(ctx, dest, lane, t, vel) {
    return this.play(ctx, dest, GM_DRUMS[lane] ?? 38, t, 0.4, vel);
  }

  playZone(ctx, dest, z, midi, t, dur, vel) {
    const g = z.gen;
    const buffer = this.font.bufferFor(z);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const root = g[GEN.overridingRootKey] >= 0 ? g[GEN.overridingRootKey] : z.sample.pitch <= 127 ? z.sample.pitch : 60;
    const key = g[GEN.keynum] >= 0 ? g[GEN.keynum] : midi;
    const cents = (key - root) * g[GEN.scaleTuning] + (g[GEN.coarseTune] ?? 0) * 100 + (g[GEN.fineTune] ?? 0) + z.sample.correction;
    src.playbackRate.value = Math.pow(2, cents / 1200);

    const mode = (g[GEN.sampleModes] ?? 0) & 3;
    const rate = buffer.sampleRate;
    const loopStart = (z.loopStart - z.start) / rate;
    const loopEnd = (z.loopEnd - z.start) / rate;
    const looped = (mode === 1 || mode === 3) && loopEnd > loopStart && loopEnd <= buffer.duration + 1e-6;
    if (looped) {
      src.loop = true;
      src.loopStart = loopStart;
      src.loopEnd = loopEnd;
    }

    const delay = timecents(g[GEN.delayVolEnv]);
    const attack = timecents(g[GEN.attackVolEnv]);
    const hold = timecents(g[GEN.holdVolEnv]);
    const decay = timecents(g[GEN.decayVolEnv]);
    const release = Math.min(3, timecents(g[GEN.releaseVolEnv]));
    const sustain = Math.pow(10, -Math.max(0, g[GEN.sustainVolEnv] ?? 0) / 200);
    const atten = Math.pow(10, (-Math.max(0, g[GEN.initialAttenuation] ?? 0) * 0.04) / 20);
    const peak = atten * Math.pow(vel, 1.5) * 0.7;

    const env = ctx.createGain();
    const a = env.gain;
    const t0 = t + delay;
    a.setValueAtTime(0, t);
    a.setValueAtTime(0, t0);
    a.linearRampToValueAtTime(peak, t0 + attack + 0.002);
    a.setValueAtTime(peak, t0 + attack + hold + 0.002);
    a.setTargetAtTime(peak * sustain, t0 + attack + hold + 0.002, decay / 5 + 0.001);
    const off = Math.max(t + dur, t0 + attack + 0.01);
    a.setTargetAtTime(0, off, release / 5 + 0.005);
    let stopAt = off + release + 0.05;
    if (!looped) stopAt = Math.min(stopAt, t + buffer.duration / src.playbackRate.value + 0.02);

    let node = env;
    src.connect(env);
    const fc = g[GEN.initialFilterFc];
    if (fc < 13500) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = Math.min(20000, 8.176 * Math.pow(2, fc / 1200));
      f.Q.value = Math.max(0.7, Math.pow(10, (g[GEN.initialFilterQ] ?? 0) / 200));
      node.connect(f);
      node = f;
    }
    const pan = Math.max(-1, Math.min(1, (g[GEN.pan] ?? 0) / 500));
    if (pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      node.connect(p);
      node = p;
    }
    node.connect(dest);
    src.addEventListener('ended', () => node.disconnect());
    src.start(t);
    src.stop(Math.max(stopAt, t + 0.01));
    return src;
  }
}
