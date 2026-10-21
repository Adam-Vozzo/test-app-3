// The RIFT score: one 4-bar phrase per intensity state, in E Phrygian at 142 BPM.
// Patterns are written one character per sixteenth note:
//   '.' rest   '-' hold the previous note   anything else starts a note.

export const BPM = 142;
export const KEY_NAME = 'E Phrygian';
export const STEPS_PER_BAR = 16;
export const PHRASE_STEPS = 64;
export const VIEW_STEPS = 32;

const SCALE = [0, 1, 3, 5, 7, 8, 10];

export const STATES = [
  { id: 'explore', name: 'Explore', blurb: 'Space to breathe', threat: 12 },
  { id: 'tension', name: 'Tension', blurb: 'Something is near', threat: 37 },
  { id: 'combat', name: 'Combat', blurb: 'Hold your ground', threat: 64 },
  { id: 'overdrive', name: 'Overdrive', blurb: 'All systems red', threat: 90 },
];

export const stateIndex = (id) => STATES.findIndex((s) => s.id === id);
export const stateById = (id) => STATES[stateIndex(id)];

export const LAYERS = [
  { id: 'atmosphere', name: 'Atmosphere', role: 'pad', pan: 0, volume: 0.7 },
  { id: 'pulse', name: 'Low pulse', role: 'bass', pan: 0, volume: 0.78 },
  { id: 'rhythm', name: 'Rhythm', role: 'arp', pan: -0.3, volume: 0.72 },
  { id: 'percussion', name: 'Percussion', role: 'kit', pan: 0, volume: 0.8 },
  { id: 'melody', name: 'Melody', role: 'lead', pan: 0.12, volume: 0.7 },
  { id: 'accents', name: 'Accents', role: 'accent', pan: 0.35, volume: 0.72 },
];

const rest = '.'.repeat(16);
const bars = (...b) => b.join('');

// Chord roots are scale degrees: 0 = i (Em), 1 = bII (F), 5 = bVI (C), 6 = bVII (D).
const SOURCE = {
  explore: {
    progression: [0, 5, 1, 0],
    atmosphere: 'P---------------',
    pulse: '1-------..1-----1-------..5-----',
    rhythm: '',
    percussion: {},
    melody: bars('..5-----8-----7-', '8-------0---8---', '9-------6---4---', '3-----5---------'),
    accents: bars('............f---', rest, '............o---', rest),
  },
  tension: {
    progression: [0, 1, 0, 1],
    atmosphere: 'P---------------',
    pulse: '1.1.1.1.1.1.8.1.',
    rhythm: 'r..t..f..o..f...',
    percussion: {
      l: 'x.........x.....',
      h: '....g.......g...',
      p: bars('x...............', rest, rest, rest),
    },
    melody: bars('1---2---1-------', '2---3---2-------', '5---6---5-------', '6---7---6---4---'),
    accents: bars(rest, '..............r-', rest, '..............r-'),
  },
  combat: {
    progression: [0, 5, 6, 1],
    atmosphere: 'P-------P-------',
    pulse: '1.11.11.1.11.8.5',
    rhythm: 'r.f.o.f.t.f.o.f.',
    percussion: {
      k: 'x.......x.x.....',
      s: '....x.......x...',
      h: 'x.g.x.g.x.g.x.g.',
      c: bars('x...............', rest, rest, rest),
      t: bars(rest, rest, rest, '............x.x.'),
      l: bars(rest, rest, rest, '.............x.x'),
    },
    melody: bars('5-----8-----7-8-', '0-----8-----6---', '7-----A-----9-7-', '6-----9-----A-9-'),
    accents: bars(rest, '..............o-', rest, '............o.o.'),
  },
  overdrive: {
    progression: [0, 1, 0, 6],
    atmosphere: 'P---P---P---P---',
    pulse: '1118111811181118',
    rhythm: 'rtfotfrtfotfrtfo',
    percussion: {
      k: 'x...x...x...x...',
      s: '....X.......X.gg',
      h: 'xgxgxgxgxgxgxgxg',
      c: bars('X...............', rest, 'X...............', rest),
      t: bars(rest, rest, rest, '............x.x.'),
      l: bars(rest, rest, rest, '.............x.x'),
      p: bars(rest, '........x...x...', rest, 'x...............'),
    },
    melody: bars('8-7-8-0-8-7-5-7-', '9-8-9-A-9-8-6-8-', '8-7-8-0-8-0-B-A-', 'A-9-7-9-A---7---'),
    accents: bars('o...............', '..........o...o.', 'o...............', '........o.o.o.o.'),
  },
};

const DRUM_VEL = { x: 0.85, X: 1, g: 0.42 };

function parseLine(str, lane) {
  if (!str) return [];
  const s = str.repeat(Math.ceil(PHRASE_STEPS / str.length)).slice(0, PHRASE_STEPS);
  const events = [];
  for (let i = 0; i < PHRASE_STEPS; i++) {
    const tok = s[i];
    if (tok === '.' || tok === '-') continue;
    let len = 1;
    while (i + len < PHRASE_STEPS && s[i + len] === '-') len++;
    events.push({ step: i, tok, len, lane });
  }
  return events;
}

function velocityFor(role, ev) {
  if (ev.lane) return DRUM_VEL[ev.tok] ?? 0.85;
  switch (role) {
    case 'pad': return ev.tok === 'p' ? 0.5 : 0.8;
    case 'bass': return ev.step % 16 === 0 ? 1 : 0.82;
    case 'arp': return ev.step % 4 === 0 ? 0.78 : 0.6;
    default: return 0.82;
  }
}

function compile() {
  const out = {};
  for (const [stateId, src] of Object.entries(SOURCE)) {
    const layers = {};
    const masks = {};
    for (const layer of LAYERS) {
      const def = src[layer.id];
      const events = typeof def === 'string'
        ? parseLine(def)
        : Object.entries(def).flatMap(([lane, line]) => parseLine(line, lane));
      const slots = Array.from({ length: PHRASE_STEPS }, () => []);
      const mask = new Array(PHRASE_STEPS).fill(false);
      for (const ev of events) {
        ev.vel = velocityFor(layer.role, ev);
        slots[ev.step].push(ev);
        mask[ev.step] = true;
      }
      layers[layer.id] = slots;
      masks[layer.id] = mask;
    }
    out[stateId] = { progression: src.progression, layers, masks };
  }
  return out;
}

export const SCORE = compile();

// ------------------------------------------------------------------- harmony

export function degreeMidi(base, deg) {
  const oct = Math.floor(deg / 7);
  return base + 12 * oct + SCALE[((deg % 7) + 7) % 7];
}

const BASS_OFF = { 1: 0, 3: 2, 4: 3, 5: 4, 7: 6, 8: 7 };
const ARP_OFF = { r: 0, t: 2, f: 4, s: 6, o: 7, n: 8 };
const MELODY_DEG = { x: -3, y: -2, z: -1, 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 7, 9: 8, 0: 9, A: 10, B: 11, C: 12 };

const E2 = 40;
const E4 = 64;

// Close-position triad with every tone placed between C4 and B4.
export function padVoicing(root) {
  return [0, 2, 4]
    .map((d) => {
      const pc = (degreeMidi(E4, root + d) - 60) % 12;
      return 60 + pc;
    })
    .sort((a, b) => a - b);
}

export function bassNote(root, tok) {
  const m = degreeMidi(E2, root + (BASS_OFF[tok] ?? 0));
  return SCALE[root] >= 8 ? m - 12 : m;
}

export function arpNote(root, tok) {
  const m = degreeMidi(E4, root + (ARP_OFF[tok] ?? 0));
  return degreeMidi(E4, root) > 68 ? m - 12 : m;
}

export const accentNote = (root, tok) => arpNote(root, tok) + 12;
export const melodyNote = (tok) => degreeMidi(E4, MELODY_DEG[tok] ?? 0);
export const timpaniNote = (root) => bassNote(root, '1') + 12;

// Tom fill played under the last beat before the music escalates.
export const FILL = [
  { lane: 't', vel: 0.8 }, { lane: 't', vel: 0.7 }, { lane: 'l', vel: 0.85 }, { lane: 'l', vel: 1 },
];

// Live-event accents. `quant` is the grid (in sixteenths) they snap to.
// Notes use chord tones ('r', 'f', 'o', ...) or absolute melody degrees ('mel').
export const STINGERS = {
  enemy: {
    label: 'Enemy down',
    quant: 1,
    notes: [
      { step: 0, tok: 'r', len: 1, vel: 0.85 },
      { step: 1, tok: 'f', len: 1, vel: 0.85 },
      { step: 2, tok: 'o', len: 4, vel: 1 },
    ],
    hits: [{ step: 0, lane: 't', vel: 0.9 }],
  },
  clear: {
    label: 'Arena cleared',
    quant: 4,
    notes: [
      { step: 0, mel: '8', len: 1, vel: 0.8 },
      { step: 1, mel: '8', len: 1, vel: 0.8 },
      { step: 2, mel: '8', len: 1, vel: 0.8 },
      { step: 3, mel: '8', len: 5, vel: 0.95 },
      { step: 8, mel: '6', len: 4, vel: 0.9 },
      { step: 12, mel: '7', len: 4, vel: 0.9 },
      // Picardy third: the fanfare resolves to E major.
      { step: 16, midi: 76, len: 14, vel: 1 },
      { step: 16, midi: 80, len: 14, vel: 0.8 },
      { step: 16, midi: 83, len: 14, vel: 0.8 },
    ],
    hits: [{ step: 0, lane: 'c', vel: 0.8 }, { step: 16, lane: 'c', vel: 1 }, { step: 16, lane: 'p', vel: 1 }],
  },
};

// ----------------------------------------------------------------- encounter

// A 74-second arc: exploration, rising threat, battle, and release.
export const ENCOUNTER_LENGTH = 74;
const ARC = [
  [0, 8], [12, 14], [20, 24], [28, 42], [34, 58], [42, 72], [48, 86],
  [56, 94], [61, 74], [66, 40], [70, 18], [74, 8],
];

export function encounterThreat(t) {
  const x = ((t % ENCOUNTER_LENGTH) + ENCOUNTER_LENGTH) % ENCOUNTER_LENGTH;
  for (let i = 0; i < ARC.length - 1; i++) {
    const [t0, v0] = ARC[i];
    const [t1, v1] = ARC[i + 1];
    if (x <= t1) {
      const u = (x - t0) / (t1 - t0);
      return v0 + (v1 - v0) * u * u * (3 - 2 * u);
    }
  }
  return ARC[0][1];
}

// First point on the rising half of the arc at or above `threat`, so switching
// the automatic encounter on picks up from the current intensity.
export function encounterTimeFor(threat) {
  for (let t = 0; t <= 56; t += 0.25) if (encounterThreat(t) >= threat) return t;
  return 56;
}

export function threatToState(v) {
  if (v < 25) return 'explore';
  if (v < 50) return 'tension';
  if (v < 80) return 'combat';
  return 'overdrive';
}
