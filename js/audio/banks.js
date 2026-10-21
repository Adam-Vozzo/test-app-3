// Cartridge palettes. None of these ship ROM samples: each bank is a set of
// synthesised instruments voiced after the sound of a classic SNES soundtrack,
// rendered through the same BRR codec and echo the console used.

import { SampleInstrument, BuiltinKit } from './synth.js';

// ---------------------------------------------------------------- instruments

const PRESETS = {
  // Pads (play three-note chord voicings around middle C)
  strings: { range: 'mid', wave: { shape: 'saw', tilt: 1.15 }, maxHz: 6000, chorus: 9, ensemble: true, attack: { time: 0.05, noise: 0.04, freq: 2600 }, env: [0.22, 0.6, 0.85, 0.7], vib: { rate: 5.2, depth: 7, delay: 0.4 } },
  warmStrings: { range: 'mid', wave: { shape: 'saw', tilt: 1.45 }, maxHz: 4200, chorus: 8, ensemble: true, env: [0.32, 0.8, 0.9, 0.9], vib: { rate: 4.8, depth: 6, delay: 0.5 } },
  synthStrings: { range: 'mid', wave: { shape: 'saw', tilt: 1.25 }, maxHz: 5000, chorus: 14, ensemble: true, env: [0.18, 0.6, 0.85, 0.6] },
  synthPad: { range: 'mid', wave: { shape: 'saw', tilt: 1.7 }, maxHz: 3600, chorus: 15, ensemble: true, breath: 0.05, breathFreq: 1800, env: [0.5, 1.2, 0.9, 1.4] },
  choir: { range: 'mid', wave: { shape: 'saw', tilt: 0.9, formants: [[700, 200, 1], [1150, 220, 0.6], [2800, 400, 0.22]] }, maxHz: 5000, chorus: 11, ensemble: true, breath: 0.04, env: [0.3, 0.6, 0.9, 0.8], vib: { rate: 4.8, depth: 10, delay: 0.45 } },
  darkChoir: { range: 'mid', wave: { shape: 'saw', tilt: 1, formants: [[480, 160, 1], [880, 200, 0.5], [2400, 300, 0.12]] }, maxHz: 4000, chorus: 13, ensemble: true, breath: 0.07, breathFreq: 900, env: [0.6, 1, 0.9, 1.4] },
  organ: { range: 'mid', wave: { shape: 'custom', harms: [1, 0.85, 0.55, 0.5, 0, 0.35, 0, 0.3, 0, 0, 0, 0.15] }, chorus: 5, env: [0.012, 0.1, 1, 0.07] },
  pipeOrgan: { range: 'mid', wave: { shape: 'custom', harms: [1, 0.55, 0.7, 0.25, 0.35, 0.12, 0.22, 0.15, 0.1, 0.08] }, chorus: 3, breath: 0.02, env: [0.07, 0.2, 1, 0.3] },
  synthBrass: { range: 'mid', wave: { shape: 'saw', tilt: 1 }, maxHz: 5000, chorus: 7, attack: { time: 0.06, noise: 0.03, freq: 1800 }, env: [0.07, 0.4, 0.7, 0.3] },
  glassPad: { range: 'mid', wave: { fm: { ratio: 2, index: 1.3 } }, chorus: 6, env: [0.35, 1.5, 0.7, 1.2] },
  powerChord: { range: 'mid', wave: { shape: 'saw', tilt: 0.9 }, maxHz: 5000, drive: 3.5, chorus: 10, env: [0.006, 0.4, 0.75, 0.15] },

  // Basses (E2 region)
  fretless: { range: 'bass', wave: { shape: 'custom', harms: [1, 0.5, 0.32, 0.18, 0.12, 0.08, 0.05] }, attack: { time: 0.03, noise: 0.08, freq: 900 }, env: [0.02, 0.5, 0.6, 0.15], vib: { rate: 4.5, depth: 6, delay: 0.4 } },
  synthBass: { range: 'bass', wave: { shape: 'saw', tilt: 1.45 }, maxHz: 2200, env: [0.005, 0.35, 0.55, 0.12] },
  subBass: { range: 'bass', wave: { shape: 'custom', harms: [1, 0.28, 0.1, 0.04] }, env: [0.02, 0.5, 0.8, 0.3] },
  slapBass: { kind: 'pluck', range: 'bass', damp: 0.06, t60: 0.9, bright: 0.9, pick: 0.15 },
  pickBass: { kind: 'pluck', range: 'bass', damp: 0.14, t60: 1.4, bright: 0.65, pick: 0.2 },
  pizz: { kind: 'pluck', range: 'bass', damp: 0.22, t60: 0.7, bright: 0.45 },
  contrabass: { range: 'bass', wave: { shape: 'saw', tilt: 1.5 }, maxHz: 2600, chorus: 5, attack: { time: 0.05, noise: 0.08, freq: 600 }, env: [0.06, 0.4, 0.8, 0.3] },
  squareBass: { range: 'bass', wave: { shape: 'pulse', duty: 0.25 }, maxHz: 3000, env: [0.004, 0.2, 0.6, 0.08] },
  rockBass: { range: 'bass', wave: { shape: 'saw', tilt: 1.1 }, drive: 2.5, maxHz: 3000, env: [0.004, 0.3, 0.7, 0.1] },
  tuba: { range: 'bass', wave: { shape: 'custom', harms: [1, 0.7, 0.45, 0.3, 0.2, 0.12, 0.08] }, attack: { time: 0.04, noise: 0.05, freq: 400 }, env: [0.03, 0.25, 0.75, 0.12] },
  organPedal: { range: 'bass', wave: { shape: 'custom', harms: [1, 0.6, 0.35, 0.3, 0.12, 0.1] }, env: [0.04, 0.2, 1, 0.2] },

  // Rhythm / arpeggio voices (E4 region)
  marimba: { kind: 'mallet', range: 'mid', partials: [[1, 1, 0.45], [3.93, 0.25, 0.09], [9.2, 0.08, 0.03]], click: 0.15 },
  vibes: { kind: 'mallet', range: 'mid', partials: [[1, 1, 1.4], [4, 0.3, 0.4], [10, 0.08, 0.12]], trem: 0.35, tremRate: 5.5 },
  xylophone: { kind: 'mallet', range: 'high', partials: [[1, 1, 0.22], [3, 0.4, 0.07], [6.2, 0.15, 0.04]], click: 0.3 },
  steelDrum: { kind: 'mallet', range: 'mid', partials: [[1, 1, 0.8], [2, 0.55, 0.5], [3, 0.28, 0.3], [4.1, 0.15, 0.2], [5.3, 0.08, 0.12]], click: 0.06 },
  harp: { kind: 'pluck', range: 'mid', damp: 0.12, t60: 1.8, bright: 0.55, pick: 0.3 },
  harpsichord: { kind: 'pluck', range: 'mid', damp: 0.03, t60: 1.2, bright: 1, pick: 0.12 },
  guitar: { kind: 'pluck', range: 'mid', damp: 0.1, t60: 1.4, bright: 0.7, pick: 0.2 },
  kalimba: { kind: 'mallet', range: 'high', partials: [[1, 1, 0.6], [5.4, 0.2, 0.08]], click: 0.2 },
  toyPiano: { kind: 'mallet', range: 'high', partials: [[1, 1, 0.5], [2.92, 0.4, 0.2], [5.8, 0.2, 0.08]], click: 0.15 },
  piano: { kind: 'mallet', range: 'mid', partials: [[1, 1, 1.2], [2, 0.5, 0.8], [3, 0.3, 0.5], [4, 0.2, 0.35], [5, 0.1, 0.25], [6, 0.06, 0.18]], click: 0.12 },
  synthPluck: { range: 'mid', wave: { shape: 'saw', tilt: 1 }, maxHz: 6000, env: [0.002, 0.18, 0, 0.1] },
  squareArp: { range: 'mid', wave: { shape: 'pulse', duty: 0.125 }, maxHz: 7000, env: [0.002, 0.15, 0.3, 0.06] },
  glass: { kind: 'fm', range: 'high', ratio: 3.5, index: 2, idecay: 0.25, decay: 0.9 },

  // Leads (E4 to B5)
  ocarina: { range: 'high', wave: { shape: 'custom', harms: [1, 0.12, 0.05, 0.02] }, breath: 0.06, attack: { time: 0.04, noise: 0.15, freq: 2000 }, env: [0.05, 0.2, 0.85, 0.2], vib: { rate: 5, depth: 14, delay: 0.25 } },
  flute: { range: 'high', wave: { shape: 'custom', harms: [1, 0.3, 0.12, 0.06, 0.03] }, breath: 0.08, attack: { time: 0.03, noise: 0.2, freq: 3000 }, env: [0.04, 0.2, 0.85, 0.15], vib: { rate: 5, depth: 12, delay: 0.3 } },
  panFlute: { range: 'high', wave: { shape: 'custom', harms: [1, 0.15, 0.08] }, breath: 0.15, breathFreq: 3000, attack: { time: 0.05, noise: 0.45, freq: 2500 }, env: [0.03, 0.25, 0.8, 0.2], vib: { rate: 4.6, depth: 10, delay: 0.35 } },
  eerieFlute: { range: 'high', wave: { shape: 'custom', harms: [1, 0.08, 0.2, 0.04] }, breath: 0.12, breathFreq: 1600, env: [0.12, 0.4, 0.85, 0.5], vib: { rate: 3.5, depth: 18, delay: 0.2 } },
  oboe: { range: 'mid', wave: { shape: 'custom', harms: [0.6, 1, 0.85, 0.7, 0.5, 0.4, 0.3, 0.25, 0.18, 0.12, 0.08], formants: [[1100, 450, 1], [2800, 600, 0.4]], floor: 0.15 }, attack: { time: 0.03, noise: 0.06, freq: 1500 }, env: [0.04, 0.2, 0.85, 0.15], vib: { rate: 5.5, depth: 10, delay: 0.3 } },
  horn: { range: 'mid', wave: { shape: 'saw', tilt: 1.75 }, maxHz: 3000, attack: { time: 0.06, noise: 0.04, freq: 800 }, env: [0.06, 0.3, 0.85, 0.2], vib: { rate: 4.5, depth: 7, delay: 0.5 } },
  trumpet: { range: 'mid', wave: { shape: 'saw', tilt: 1, formants: [[1300, 800, 1]], floor: 0.25 }, maxHz: 6500, attack: { time: 0.03, noise: 0.05, freq: 1500 }, env: [0.025, 0.25, 0.8, 0.12], vib: { rate: 5.5, depth: 9, delay: 0.35 } },
  sax: { range: 'mid', wave: { shape: 'saw', tilt: 1.1, formants: [[600, 300, 1], [1600, 500, 0.5]], floor: 0.15 }, drive: 1.4, breath: 0.05, env: [0.03, 0.3, 0.8, 0.15], vib: { rate: 5, depth: 14, delay: 0.3 } },
  violin: { range: 'mid', wave: { shape: 'saw', tilt: 1, formants: [[1000, 500, 1], [2600, 800, 0.5]], floor: 0.2 }, maxHz: 7000, attack: { time: 0.04, noise: 0.06, freq: 3000 }, env: [0.06, 0.3, 0.9, 0.25], vib: { rate: 6, depth: 16, delay: 0.25 } },
  squareLead: { range: 'high', wave: { shape: 'pulse', duty: 0.5 }, maxHz: 7000, env: [0.004, 0.2, 0.7, 0.1], vib: { rate: 6, depth: 12, delay: 0.25 } },
  distLead: { range: 'mid', wave: { shape: 'saw', tilt: 1 }, maxHz: 5000, drive: 5, env: [0.005, 0.3, 0.8, 0.12], vib: { rate: 5.5, depth: 18, delay: 0.25 } },
  guitarLead: { range: 'mid', wave: { shape: 'square', tilt: 1.1 }, maxHz: 4500, drive: 4.5, chorus: 6, env: [0.004, 0.35, 0.75, 0.12], vib: { rate: 6, depth: 20, delay: 0.2 } },
  breathLead: { range: 'high', wave: { shape: 'custom', harms: [1, 0.35, 0.2, 0.1, 0.05] }, chorus: 8, breath: 0.1, breathFreq: 1400, env: [0.12, 0.4, 0.85, 0.5], vib: { rate: 4.5, depth: 9, delay: 0.4 } },

  // Accents (E5 and up)
  glock: { kind: 'mallet', range: 'high', partials: [[1, 1, 0.7], [2.76, 0.3, 0.25], [5.4, 0.12, 0.1]], click: 0.1 },
  chime: { kind: 'mallet', range: 'high', partials: [[1, 1, 1.5], [2, 0.3, 0.6], [3, 0.15, 0.4]] },
  toyBell: { kind: 'mallet', range: 'high', partials: [[1, 1, 0.4], [2.4, 0.5, 0.2], [4.1, 0.2, 0.1]], click: 0.2 },
  tubularBell: { kind: 'fm', range: 'high', ratio: 3.5, index: 3, decay: 2 },
  churchBell: { kind: 'fm', range: 'mid', ratio: 2.4, index: 4, decay: 2.2 },
  metalHit: { kind: 'fm', range: 'mid', ratio: 1.41, index: 5, decay: 1.2 },
  brassStab: { range: 'mid', wave: { shape: 'saw', tilt: 1 }, maxHz: 5000, chorus: 8, attack: { time: 0.02, noise: 0.05, freq: 1500 }, env: [0.012, 0.25, 0.2, 0.15] },
  orchHit: { range: 'mid', wave: { shape: 'saw', tilt: 0.95 }, maxHz: 6000, chorus: 15, ensemble: true, attack: { time: 0.04, noise: 0.5, freq: 1200 }, env: [0.003, 0.35, 0, 0.2] },
};

// ---------------------------------------------------------------------- drums

const DRUMS = {
  kick: { kind: 'kick', f0: 140, f1: 48, decay: 0.3, click: 0.35, gain: 0.95 },
  kickDeep: { kind: 'kick', f0: 110, f1: 40, decay: 0.48, click: 0.25, gain: 1 },
  kickPunch: { kind: 'kick', f0: 180, f1: 55, pdecay: 0.03, decay: 0.22, click: 0.7, gain: 1 },
  kickSoft: { kind: 'kick', f0: 120, f1: 50, decay: 0.26, click: 0.12, gain: 0.85 },
  kick808: { kind: 'kick', f0: 90, f1: 42, pdecay: 0.05, decay: 0.7, click: 0.05, drive: 1.1, gain: 0.95 },
  snare: { kind: 'snare', tone: 185, decay: 0.16, noise: 0.72, gain: 0.7 },
  snareBig: { kind: 'snare', tone: 170, decay: 0.32, noise: 0.78, lp: 6000, gain: 0.7 },
  snareTight: { kind: 'snare', tone: 220, decay: 0.1, noise: 0.68, lp: 9000, gain: 0.65 },
  snareMarch: { kind: 'snare', tone: 230, decay: 0.24, noise: 0.85, hp: 1600, gain: 0.65 },
  snareMetal: { kind: 'snare', tone: 310, toneDecay: 0.12, decay: 0.2, noise: 0.6, hp: 2000, gain: 0.6 },
  clap: { kind: 'clap', decay: 0.18, gain: 0.65 },
  hat: { kind: 'metal', decay: 0.045, hp: 7000, gain: 0.35, pan: 0.25 },
  hatOpen: { kind: 'metal', decay: 0.28, hp: 6000, gain: 0.3, pan: 0.25 },
  shaker: { kind: 'metal', decay: 0.07, hp: 4500, noise: 0.95, attack: 0.012, gain: 0.32, pan: 0.3 },
  hatLofi: { kind: 'metal', decay: 0.06, hp: 5000, noise: 0.3, gain: 0.32, pan: 0.2 },
  crash: { kind: 'metal', decay: 1.2, hp: 3500, noise: 0.6, gain: 0.35, pan: -0.2 },
  crashShort: { kind: 'metal', decay: 0.5, hp: 4000, noise: 0.5, gain: 0.33, pan: -0.2 },
  gong: { kind: 'fm', range: 'bass', ratio: 1.41, index: 6, decay: 2.2, gain: 0.45, pan: -0.15 },
  tom: { kind: 'tom', f0: 220, f1: 150, decay: 0.28, gain: 0.75, pan: 0.3 },
  tomLow: { kind: 'tom', f0: 150, f1: 100, decay: 0.38, gain: 0.8, pan: -0.3 },
  conga: { kind: 'tom', f0: 340, f1: 300, pdecay: 0.02, decay: 0.18, click: 0.3, gain: 0.7, pan: 0.35 },
  congaLow: { kind: 'tom', f0: 240, f1: 210, pdecay: 0.02, decay: 0.24, click: 0.25, gain: 0.75, pan: -0.35 },
  bongo: { kind: 'tom', f0: 460, f1: 420, pdecay: 0.015, decay: 0.1, click: 0.35, gain: 0.6, pan: 0.4 },
  timbale: { kind: 'tom', f0: 400, f1: 380, decay: 0.25, click: 0.4, gain: 0.6, pan: -0.35 },
  rim: { kind: 'tom', f0: 950, f1: 900, pdecay: 0.01, decay: 0.03, click: 1, gain: 0.45, pan: 0.3 },
  timpani: { kind: 'timpani', decay: 1.4, gain: 0.85 },
  logDrum: { kind: 'mallet', range: 'bass', partials: [[1, 1, 0.3], [2.7, 0.4, 0.12]], click: 0.2, gain: 0.8 },
  cowbell: { kind: 'mallet', f0: 540, fixed: true, partials: [[1, 1, 0.12], [1.48, 0.8, 0.1]], gain: 0.4, pan: 0.3 },
};

// Lanes: k kick, s snare, h hat, o open hat, t high tom, l low tom, c crash, p pitched.
const KITS = {
  orchestral: { k: 'kickSoft', s: 'snareTight', h: 'hat', o: 'hatOpen', t: 'tom', l: 'tomLow', c: 'crash', p: 'timpani' },
  jungle: { k: 'kickDeep', s: 'snareBig', h: 'shaker', o: 'hatOpen', t: 'conga', l: 'congaLow', c: 'crash', p: 'logDrum' },
  latin: { k: 'kickSoft', s: 'snareTight', h: 'hat', o: 'hatOpen', t: 'bongo', l: 'timbale', c: 'crashShort', p: 'cowbell' },
  march: { k: 'kick', s: 'snareMarch', h: 'hat', o: 'hatOpen', t: 'tom', l: 'tomLow', c: 'crash', p: 'timpani' },
  rock: { k: 'kickPunch', s: 'snare', h: 'hat', o: 'hatOpen', t: 'tom', l: 'tomLow', c: 'crash', p: 'tomLow' },
  lofi: { k: 'kick808', s: 'clap', h: 'hatLofi', o: 'hatOpen', t: 'rim', l: 'congaLow', c: 'crashShort', p: 'cowbell' },
  industrial: { k: 'kickDeep', s: 'snareMetal', h: 'hat', o: 'hatOpen', t: 'tom', l: 'tomLow', c: 'gong', p: 'timpani' },
  hand: { k: 'kickSoft', s: 'rim', h: 'shaker', o: 'hatOpen', t: 'conga', l: 'congaLow', c: 'crashShort', p: 'logDrum' },
  gothic: { k: 'kickDeep', s: 'snareMarch', h: 'hat', o: 'hatOpen', t: 'tom', l: 'tomLow', c: 'gong', p: 'timpani' },
};

// ---------------------------------------------------------------------- banks

export const BANKS = [
  { id: 'ct', name: 'Chrono Trigger', short: 'Chrono Trigger', abbr: 'CT', year: 1995, blurb: 'Warm strings, ocarina, marimba and bell trees', echo: 1,
    pad: 'strings', bass: 'fretless', arp: 'marimba', lead: 'ocarina', accent: 'glock', kit: 'orchestral' },
  { id: 'dkc', name: 'Donkey Kong Country', short: 'Donkey Kong', abbr: 'DKC', year: 1994, blurb: 'Misty synth pads, deep bass and a jungle kit', echo: 1.45,
    pad: 'synthPad', bass: 'synthBass', arp: 'kalimba', lead: 'breathLead', accent: 'marimba', kit: 'jungle' },
  { id: 'smw', name: 'Super Mario World', short: 'Mario World', abbr: 'SMW', year: 1990, blurb: 'Steel drums, slap bass, trumpet and bongos', echo: 0.6,
    pad: 'organ', bass: 'slapBass', arp: 'steelDrum', lead: 'trumpet', accent: 'xylophone', kit: 'latin' },
  { id: 'alttp', name: 'Zelda: A Link to the Past', short: 'Zelda', abbr: 'Zelda', year: 1991, blurb: 'Harps, horns, pizzicato and timpani', echo: 0.9,
    pad: 'warmStrings', bass: 'pizz', arp: 'harp', lead: 'horn', accent: 'chime', kit: 'march' },
  { id: 'ff6', name: 'Final Fantasy VI', short: 'Final Fantasy VI', abbr: 'FFVI', year: 1994, blurb: 'Oboe, choir, contrabass and brass stabs', echo: 1,
    pad: 'choir', bass: 'contrabass', arp: 'piano', lead: 'oboe', accent: 'brassStab', kit: 'orchestral' },
  { id: 'eb', name: 'EarthBound', short: 'EarthBound', abbr: 'EB', year: 1994, blurb: 'Lo-fi organ, saxophone and toy bells', echo: 0.85, rate: 16000,
    pad: 'organ', bass: 'squareBass', arp: 'toyPiano', lead: 'sax', accent: 'toyBell', kit: 'lofi' },
  { id: 'sm', name: 'Super Metroid', short: 'Super Metroid', abbr: 'SM', year: 1994, blurb: 'Cold drones, dark choir and metal strikes', echo: 1.6,
    pad: 'darkChoir', bass: 'subBass', arp: 'glass', lead: 'eerieFlute', accent: 'metalHit', kit: 'industrial' },
  { id: 'som', name: 'Secret of Mana', short: 'Secret of Mana', abbr: 'SoM', year: 1993, blurb: 'Glass pads, pan flute, vibes and hand drums', echo: 1.25,
    pad: 'glassPad', bass: 'pickBass', arp: 'vibes', lead: 'panFlute', accent: 'tubularBell', kit: 'hand' },
  { id: 'fzero', name: 'F-Zero', short: 'F-Zero', abbr: 'F-Zero', year: 1990, blurb: 'Synth brass, driving bass and a rock kit', echo: 0.7,
    pad: 'synthBrass', bass: 'rockBass', arp: 'synthPluck', lead: 'distLead', accent: 'orchHit', kit: 'rock' },
  { id: 'mmx', name: 'Mega Man X', short: 'Mega Man X', abbr: 'MMX', year: 1993, blurb: 'Overdriven guitars, square arps and a punchy kit', echo: 0.6,
    pad: 'powerChord', bass: 'pickBass', arp: 'squareArp', lead: 'guitarLead', accent: 'brassStab', kit: 'rock' },
  { id: 'sc4', name: 'Super Castlevania IV', short: 'Castlevania IV', abbr: 'SCIV', year: 1991, blurb: 'Pipe organ, harpsichord, violin and gongs', echo: 1.15,
    pad: 'pipeOrgan', bass: 'organPedal', arp: 'harpsichord', lead: 'violin', accent: 'churchBell', kit: 'gothic' },
  { id: 'sf', name: 'Star Fox', short: 'Star Fox', abbr: 'SF', year: 1993, blurb: 'Brass fanfares, synth strings and a march kit', echo: 0.9,
    pad: 'synthStrings', bass: 'tuba', arp: 'squareArp', lead: 'trumpet', accent: 'orchHit', kit: 'march' },
];

const BANK_MAP = new Map(BANKS.map((b) => [b.id, b]));
export const bankById = (id) => BANK_MAP.get(id);

// ---------------------------------------------------------------------- mixes

export const MIXES = [
  { id: 'cross', name: 'Cross-cartridge', blurb: 'The original blend of six SNES classics.',
    map: { atmosphere: ['ct'], pulse: ['dkc'], rhythm: ['smw'], percussion: ['dkc', 'alttp'], melody: ['ff6'], accents: ['eb'] } },
  { id: 'squaresoft', name: 'Squaresoft suite', blurb: 'Chrono, Mana and Final Fantasy trading lines.',
    map: { atmosphere: ['ff6'], pulse: ['ct'], rhythm: ['som'], percussion: ['ct'], melody: ['ct'], accents: ['som'] } },
  { id: 'jungle', name: 'Jungle canopy', blurb: 'Misty Kong pads under Mario steel drums and Mana flutes.',
    map: { atmosphere: ['dkc'], pulse: ['dkc'], rhythm: ['smw'], percussion: ['dkc'], melody: ['som'], accents: ['dkc'] } },
  { id: 'deepspace', name: 'Deep space', blurb: 'Super Metroid drones with Star Fox brass.',
    map: { atmosphere: ['sm'], pulse: ['sm'], rhythm: ['sf'], percussion: ['sm', 'sf'], melody: ['sf'], accents: ['sm'] } },
  { id: 'gothic', name: 'Gothic halls', blurb: 'Castlevania organ, Zelda timpani and a Final Fantasy choir.',
    map: { atmosphere: ['ff6'], pulse: ['sc4'], rhythm: ['sc4'], percussion: ['sc4', 'alttp'], melody: ['sc4'], accents: ['sc4'] } },
  { id: 'highvoltage', name: 'High voltage', blurb: 'F-Zero and Mega Man X at full throttle.',
    map: { atmosphere: ['mmx'], pulse: ['fzero'], rhythm: ['mmx'], percussion: ['fzero'], melody: ['mmx'], accents: ['fzero'] } },
  { id: 'lofi', name: 'Onett lo-fi', blurb: 'EarthBound oddities with a Mario World bounce.',
    map: { atmosphere: ['eb'], pulse: ['smw'], rhythm: ['eb'], percussion: ['eb'], melody: ['eb'], accents: ['smw'] } },
];

export const mixById = (id) => MIXES.find((m) => m.id === id);

// How much of each role goes to the S-DSP echo, before the bank's own scaling.
const ROLE_ECHO = { pad: 0.42, bass: 0.04, arp: 0.3, kit: 0.1, lead: 0.32, accent: 0.45 };

// Lanes taken from the second cartridge when a kit blends two banks.
const SECOND_KIT_LANES = new Set(['t', 'l', 'c', 'p']);

class KitVoice {
  constructor(kits) {
    this.kits = kits;
  }

  hit(ctx, dest, lane, t, vel, pitch) {
    const kit = this.kits.length > 1 && SECOND_KIT_LANES.has(lane) ? this.kits[1] : this.kits[0];
    return kit.hit(ctx, dest, lane, t, vel, pitch);
  }
}

// Mix balance per role. Melodic instruments are loudness-matched to this level;
// drums scale their hand-set gains by the kit level.
const ROLE_LEVEL = { pad: 0.5, bass: 0.75, arp: 0.75, lead: 1, accent: 0.9, kit: 0.32 };
const MELODIC_ROLES = ['pad', 'bass', 'arp', 'lead', 'accent'];

// Renders and caches instruments for layer sources. A source is either
// { bank: 'ct' } for a built-in cartridge or { font, preset } for a loaded SF2.
export class Library {
  constructor() {
    this.cache = new Map();
    this.fonts = new Map();
  }

  // One render job per uncached instrument, so callers can spread the work
  // over idle time instead of blocking the audio scheduler.
  warmTasks() {
    const tasks = [];
    for (const bank of BANKS) {
      for (const role of MELODIC_ROLES) tasks.push(() => this.instrumentFor({ bank: bank.id }, role));
      for (const name of Object.values(KITS[bank.kit])) tasks.push(() => this.drum(name, bank.rate));
    }
    return tasks;
  }

  isReady(sources, role) {
    return sources.every((s) => {
      if (s.font) return true;
      const bank = bankById(s.bank);
      if (!bank) return true;
      if (role === 'kit') return Object.values(KITS[bank.kit]).every((name) => this.cache.has(drumKey(name, bank.rate)));
      return this.cache.has(melodicKey(bank, role));
    });
  }

  addFont(font) {
    this.fonts.set(font.id, font);
  }

  removeFont(id) {
    this.fonts.delete(id);
  }

  voicesFor(sources, role) {
    if (role === 'kit') {
      const kits = sources.map((s) => this.kitFor(s)).filter(Boolean);
      return kits.length ? [new KitVoice(kits)] : [];
    }
    return sources.map((s) => this.instrumentFor(s, role)).filter(Boolean);
  }

  echoFor(sources, role) {
    const first = sources[0];
    const bank = first?.bank ? bankById(first.bank) : null;
    return ROLE_ECHO[role] * (bank ? bank.echo : 0.8);
  }

  instrumentFor(source, role) {
    if (source.font) return this.fonts.get(source.font)?.voice(source.preset) ?? null;
    const bank = bankById(source.bank);
    if (!bank) return null;
    const key = melodicKey(bank, role);
    if (!this.cache.has(key)) {
      const recipe = { ...PRESETS[bank[role]], rate: bank.rate };
      this.cache.set(key, new SampleInstrument(recipe, bank.rate, key, ROLE_LEVEL[role]));
    }
    return this.cache.get(key);
  }

  drum(name, rate) {
    const key = drumKey(name, rate);
    if (!this.cache.has(key)) {
      const recipe = { ...DRUMS[name], rate };
      recipe.gain = (recipe.gain ?? 0.6) * ROLE_LEVEL.kit;
      this.cache.set(key, new SampleInstrument(recipe, rate, key));
    }
    return this.cache.get(key);
  }

  kitFor(source) {
    if (source.font) return this.fonts.get(source.font)?.voice(source.preset) ?? null;
    const bank = bankById(source.bank);
    if (!bank) return null;
    const lanes = {};
    for (const [lane, name] of Object.entries(KITS[bank.kit])) lanes[lane] = this.drum(name, bank.rate);
    return new BuiltinKit(lanes);
  }
}

const melodicKey = (bank, role) => `${bank[role]}@${bank.rate ?? 32000}:${role}`;
const drumKey = (name, rate) => `drum:${name}@${rate ?? 32000}`;
