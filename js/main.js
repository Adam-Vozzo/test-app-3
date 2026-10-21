import { Engine } from './audio/engine.js';
import { Library, BANKS, MIXES, bankById, mixById } from './audio/banks.js';
import { parseSf2 } from './audio/sf2.js';
import { Scope } from './ui/scope.js';
import { ArrangementEditor, pushHistory, undo } from './ui/editor.js';
import {
  BPM, KEY_NAME, STATES, LAYERS, SCORE, VIEW_STEPS, PHRASE_STEPS, ENCOUNTER_LENGTH,
  stateById, encounterThreat, encounterTimeFor, threatToState,
  exportEdits, importEdits, resetArrangement, isArrangementEdited, isLayerEdited,
} from './score.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'rift:settings:v1';
const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve'];
const LOG_LIMIT = 6;
const DEFAULT_MIX = 'cross';

const library = new Library();
const engine = new Engine(library);

const app = {
  displayState: 'explore',
  threat: 12,
  auto: true,
  arcT: 0,
  lastCtxTime: null,
  lowHealth: false,
  mixId: DEFAULT_MIX,
  sources: LAYERS.map(() => []),
  log: [],
  bar: 1,
  phraseStep: -1,
  started: false,
  view: { state: null, win: -1 },
  popoverLayer: -1,
  loading: null,
  ready: false,
  lastEditorLayer: 4,
};

const ui = {
  playBtn: $('playBtn'),
  playLabel: $('playLabel'),
  stateName: $('stateName'),
  liveTag: $('liveTag'),
  holdText: $('holdText'),
  barText: $('barText'),
  beats: [...document.querySelectorAll('.beats i')],
  progress: $('progress'),
  voiceCount: $('voiceCount'),
  autoToggle: $('autoToggle'),
  threat: $('threat'),
  threatValue: $('threatValue'),
  enemyBtn: $('enemyBtn'),
  clearBtn: $('clearBtn'),
  healthToggle: $('healthToggle'),
  log: $('log'),
  mixSelect: $('mixSelect'),
  mixBlurb: $('mixBlurb'),
  mixCarts: $('mixCarts'),
  mixTitle: $('mixTitle'),
  gameList: $('gameList'),
  gameCount: $('gameCount'),
  gameSearch: $('gameSearch'),
  applyTarget: $('applyTarget'),
  sf2Input: $('sf2Input'),
  sf2Status: $('sf2Status'),
  sf2Message: $('sf2Message'),
  sf2Apply: $('sf2Apply'),
  uploadBtn: $('uploadBtn'),
  popoverUpload: $('popoverUpload'),
  editBtn: $('editBtn'),
  resetBtn: $('resetBtn'),
  resetLabel: $('resetLabel'),
  master: $('master'),
  recordBtn: $('recordBtn'),
  recordLabel: $('recordLabel'),
  footerMix: $('footerMix'),
  footerFonts: $('footerFonts'),
  engineStatus: $('engineStatus'),
  popover: $('sourcePopover'),
  popoverTitle: $('popoverTitle'),
  popoverNote: $('popoverNote'),
  sourcePrimary: $('sourcePrimary'),
  sourceSecondary: $('sourceSecondary'),
};

const cards = [];
const rows = [];
const scope = new Scope($('scope'));

// ---------------------------------------------------------------- settings

let saveTimer = 0;

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    return null;
  }
}

function saveSettings() {
  if (!app.ready) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        master: engine.master,
        arrangement: exportEdits(),
        layers: engine.layers.map((l, i) => ({
          enabled: l.enabled,
          volume: l.volume,
          sources: app.sources[i].filter((s) => s.bank),
        })),
      }));
    } catch {
      // Storage can be unavailable (private mode); settings just won't persist.
    }
  }, 300);
}

// ------------------------------------------------------------------ helpers

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const idle = () => new Promise((r) => setTimeout(r, 0));

function paintRange(input) {
  const min = Number(input.min);
  const max = Number(input.max);
  input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`);
}

function flash(btn) {
  btn.classList.add('fired');
  clearTimeout(btn.flashTimer);
  btn.flashTimer = setTimeout(() => btn.classList.remove('fired'), 450);
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

function sourceKey(s) {
  return s.font ? `f:${s.font}:${s.preset}` : `b:${s.bank}`;
}

function parseSourceKey(key) {
  if (!key) return null;
  const [kind, id, preset] = key.split(':');
  return kind === 'f' ? { font: id, preset: Number(preset) } : { bank: id };
}

function sourceName(s) {
  if (s.font) {
    const font = library.fonts.get(s.font);
    return font ? font.presetByIndex(s.preset).name : 'SoundFont';
  }
  return bankById(s.bank)?.short ?? 'Unknown';
}

function sourceLabel(sources) {
  if (!sources.length) return 'Silent';
  if (sources.length === 1) return sourceName(sources[0]);
  return sources.map((s) => (s.font ? sourceName(s) : bankById(s.bank).abbr)).join(' + ');
}

// ------------------------------------------------------------------- states

function buildStates() {
  const wrap = $('states');
  STATES.forEach((s, i) => {
    const card = el('button', { type: 'button', class: 'state-card', role: 'radio', 'aria-checked': 'false', 'aria-keyshortcuts': String(i + 1) }, [
      el('span', { class: 'num', text: `0${i + 1}` }),
      el('kbd', { text: String(i + 1) }),
      el('span', { class: 'name', text: s.name }),
      el('span', { class: 'blurb', text: s.blurb }),
    ]);
    card.addEventListener('click', () => chooseState(s.id));
    card.addEventListener('keydown', (e) => {
      const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!dir) return;
      e.preventDefault();
      const next = STATES[(i + dir + STATES.length) % STATES.length];
      chooseState(next.id);
      cards[STATES.indexOf(next)].focus();
    });
    cards.push(card);
    wrap.append(card);
  });
}

function chooseState(id) {
  setAuto(false);
  setThreat(stateById(id).threat);
}

function requestState(id) {
  if (engine.requestState(id) === 'now' && app.displayState !== id) {
    app.displayState = id;
    renderPatterns(id, 0);
    setPlayhead(-1);
  }
}

function pendingState() {
  if (!engine.playing) return null;
  return engine.pending || (engine.stateId !== app.displayState ? engine.stateId : null);
}

let statusKey = '';

function renderStatus() {
  const pend = pendingState();
  const key = `${app.displayState}|${pend}|${engine.playing}|${app.started}`;
  if (key === statusKey) return;
  statusKey = key;

  const current = stateById(app.displayState);
  ui.stateName.textContent = current.name.toUpperCase();
  cards.forEach((card, i) => {
    const id = STATES[i].id;
    card.setAttribute('aria-checked', String(id === app.displayState));
    card.tabIndex = id === app.displayState ? 0 : -1;
    card.classList.toggle('pending', id === pend);
  });

  let hold;
  if (!app.started) hold = 'Press play to begin';
  else if (!engine.playing) hold = `Paused · ${current.name}`;
  else if (pend) hold = `Next bar → ${stateById(pend).name}`;
  else hold = `Holding ${current.name}`;
  ui.holdText.textContent = hold;
  ui.holdText.classList.toggle('pending', Boolean(pend));

  ui.liveTag.classList.toggle('on', engine.playing);
  ui.liveTag.lastElementChild.textContent = engine.playing ? 'Live' : app.started ? 'Paused' : 'Ready';
  ui.engineStatus.classList.toggle('running', engine.playing);
  ui.playLabel.textContent = engine.playing ? 'Pause' : app.started ? 'Resume' : 'Play';
  ui.playBtn.querySelector('use').setAttribute('href', engine.playing ? '#i-pause' : '#i-play');
  updateVoiceCount();
}

// ------------------------------------------------------------------- layers

function buildLayers() {
  const list = $('layerList');
  LAYERS.forEach((def, i) => {
    const src = el('button', { type: 'button', class: 'layer-src', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', title: 'Change source' });
    const steps = el('button', { type: 'button', class: 'steps', 'aria-expanded': 'false', 'aria-label': `Edit ${def.name.toLowerCase()} part`, title: `Edit ${def.name.toLowerCase()} part` });
    for (let s = 0; s < VIEW_STEPS; s++) steps.append(el('i'));
    steps.addEventListener('click', () => toggleEditor(i));
    const vol = el('input', { type: 'range', class: 'range', min: '0', max: '1', step: '0.01', 'aria-label': `${def.name} volume` });
    const toggle = el('input', { type: 'checkbox', role: 'switch', 'aria-label': `${def.name} on` });
    const li = el('li', { class: 'layer' }, [
      el('span', { class: 'layer-idx', text: `0${i + 1}` }),
      el('div', { class: 'layer-meta' }, [el('span', { class: 'layer-name', text: def.name }), src]),
      steps,
      vol,
      el('label', { class: 'switch' }, [toggle, el('span')]),
    ]);

    src.addEventListener('click', () => (app.popoverLayer === i ? closePopover() : openPopover(i, src)));
    vol.addEventListener('input', () => {
      engine.setLayerVolume(i, Number(vol.value));
      paintRange(vol);
      saveSettings();
    });
    toggle.addEventListener('change', () => setLayerEnabled(i, toggle.checked));

    rows.push({ li, src, steps, cells: [...steps.children], vol, toggle, head: -1, any: false });
    list.append(li);
  });
}

function setLayerEnabled(i, on) {
  engine.setLayerEnabled(i, on);
  rows[i].toggle.checked = on;
  rows[i].li.classList.toggle('off', !on);
  updateVoiceCount();
  saveSettings();
}

function renderPatterns(stateId, win) {
  const { masks } = SCORE[stateId];
  rows.forEach((row, i) => {
    const mask = masks[LAYERS[i].id];
    row.any = mask.some(Boolean);
    row.steps.classList.toggle('idle', !row.any);
    row.cells.forEach((c, j) => c.classList.toggle('on', mask[win * VIEW_STEPS + j]));
  });
  app.view = { state: stateId, win };
  updateVoiceCount();
}

function setPlayhead(idx) {
  for (const row of rows) {
    if (row.head >= 0) row.cells[row.head].classList.remove('head');
    row.head = -1;
    if (idx >= 0 && row.any) {
      row.cells[idx].classList.add('head');
      row.head = idx;
    }
  }
}

function updateVoiceCount() {
  const { masks } = SCORE[app.displayState];
  const n = LAYERS.filter((l, i) => engine.layers[i].enabled && masks[l.id].some(Boolean)).length;
  ui.voiceCount.textContent = `${n} voice${n === 1 ? '' : 's'}`;
}

// ------------------------------------------------------ arrangement editing

const editor = new ArrangementEditor({
  onEdit: afterEdit,
  onPickState: chooseState,
  onPreview: (layer, note, state) => engine.preview(layer, note, state),
  onClose: syncEditorButtons,
});

// The state the music is on or heading to; the editor always shows it.
const targetState = () => engine.pending || engine.stateId;

function toggleEditor(i) {
  if (editor.layer === i) {
    editor.close();
    return;
  }
  editor.show(i, rows[i].li, targetState());
  app.lastEditorLayer = i;
  syncEditorButtons();
  editor.root.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function syncEditorButtons() {
  rows.forEach((row, i) => {
    row.steps.setAttribute('aria-expanded', String(editor.layer === i));
    row.li.classList.toggle('editing', editor.layer === i);
  });
  ui.editBtn.setAttribute('aria-expanded', String(editor.isOpen));
  ui.editBtn.lastElementChild.textContent = editor.isOpen ? 'Close editor' : 'Edit arrangement';
}

function afterEdit() {
  if (app.view.state) renderPatterns(app.view.state, Math.max(0, app.view.win));
  updateEditMarks();
  saveSettings();
}

function updateEditMarks() {
  rows.forEach((row, i) => {
    row.li.classList.toggle('edited', STATES.some((s) => isLayerEdited(s.id, LAYERS[i].id)));
  });
  ui.resetBtn.disabled = !isArrangementEdited();
  if (ui.resetBtn.disabled) disarmReset();
}

let resetTimer = 0;

function disarmReset() {
  clearTimeout(resetTimer);
  ui.resetBtn.classList.remove('confirm');
  ui.resetLabel.textContent = 'Reset';
}

// Two clicks: the first arms the button, the second restores the original score.
function onResetClick() {
  if (!ui.resetBtn.classList.contains('confirm')) {
    ui.resetBtn.classList.add('confirm');
    ui.resetLabel.textContent = 'Confirm reset';
    clearTimeout(resetTimer);
    resetTimer = setTimeout(disarmReset, 3500);
    return;
  }
  disarmReset();
  pushHistory();
  resetArrangement();
  editor.refresh();
  afterEdit();
}

function undoEdit() {
  if (!undo()) return;
  editor.refresh();
  afterEdit();
}

function renderLayerSource(i) {
  rows[i].src.textContent = sourceLabel(app.sources[i]);
  rows[i].src.title = `Change ${LAYERS[i].name.toLowerCase()} source`;
}

function applySources(i, sources) {
  if (!library.isReady(sources, LAYERS[i].role)) engine.scheduleAhead(0.8);
  app.sources[i] = sources;
  engine.setLayerSources(i, sources);
  renderLayerSource(i);
}

// ----------------------------------------------------------- source popover

function fillSourceSelect(select, withNone) {
  select.replaceChildren();
  if (withNone) select.append(el('option', { value: '', text: 'None' }));
  const carts = el('optgroup', { label: 'Cartridges' });
  for (const b of BANKS) carts.append(el('option', { value: `b:${b.id}`, text: b.name }));
  select.append(carts);
  for (const font of library.fonts.values()) {
    const group = el('optgroup', { label: font.name });
    for (const p of font.presets) group.append(el('option', { value: `f:${font.id}:${p.index}`, text: font.presetLabel(p) }));
    select.append(group);
  }
}

function openPopover(i, anchor) {
  closePopover();
  app.popoverLayer = i;
  const def = LAYERS[i];
  fillSourceSelect(ui.sourcePrimary, false);
  fillSourceSelect(ui.sourceSecondary, true);
  const [a, b] = app.sources[i];
  ui.sourcePrimary.value = a ? sourceKey(a) : `b:${BANKS[0].id}`;
  ui.sourceSecondary.value = b ? sourceKey(b) : '';
  ui.popoverTitle.textContent = `${def.name} source`;
  ui.popoverNote.textContent = def.role === 'kit'
    ? 'Blending splits the kit: kick, snare and hats from the first; toms, cymbals and pitched hits from the second.'
    : 'Blending doubles the part on both instruments.';

  ui.popover.hidden = false;
  const r = anchor.getBoundingClientRect();
  const width = ui.popover.offsetWidth;
  ui.popover.style.left = `${clamp(r.left + window.scrollX, 8, document.documentElement.clientWidth - width - 8)}px`;
  ui.popover.style.top = `${r.bottom + window.scrollY + 8}px`;
  anchor.setAttribute('aria-expanded', 'true');
  ui.sourcePrimary.focus();
}

function closePopover() {
  if (app.popoverLayer < 0) return;
  rows[app.popoverLayer].src.setAttribute('aria-expanded', 'false');
  app.popoverLayer = -1;
  ui.popover.hidden = true;
}

function onPopoverChange() {
  const i = app.popoverLayer;
  if (i < 0) return;
  const sources = [parseSourceKey(ui.sourcePrimary.value)];
  const second = parseSourceKey(ui.sourceSecondary.value);
  if (second && sourceKey(second) !== sourceKey(sources[0])) sources.push(second);
  applySources(i, sources);
  updateMixUI();
  saveSettings();
}

// -------------------------------------------------------------------- mixes

function sourcesForMix(mix) {
  return LAYERS.map((l) => mix.map[l.id].map((bank) => ({ bank })));
}

function sameSources(a, b) {
  return a.length === b.length && a.every((s, i) => sourceKey(s) === sourceKey(b[i]));
}

function detectMix() {
  const match = MIXES.find((m) => sourcesForMix(m).every((s, i) => sameSources(app.sources[i], s)));
  return match ? match.id : 'custom';
}

function applyMix(id) {
  const mix = mixById(id);
  if (!mix) return;
  sourcesForMix(mix).forEach((s, i) => applySources(i, s));
  updateMixUI();
  saveSettings();
}

function distinctSources() {
  const seen = new Map();
  for (const list of app.sources) {
    for (const s of list) {
      const key = s.font ? `f:${s.font}` : `b:${s.bank}`;
      if (!seen.has(key)) seen.set(key, s.font ? library.fonts.get(s.font)?.name ?? 'SoundFont' : bankById(s.bank).short);
    }
  }
  return [...seen.values()];
}

function updateMixUI() {
  app.mixId = detectMix();
  const mix = mixById(app.mixId);

  ui.mixSelect.replaceChildren(...MIXES.map((m) => el('option', { value: m.id, text: m.name })));
  if (!mix) ui.mixSelect.append(el('option', { value: 'custom', text: 'Custom blend' }));
  ui.mixSelect.value = app.mixId;
  ui.mixBlurb.textContent = mix ? mix.blurb : 'Your own blend of cartridges and soundfonts.';

  const names = distinctSources();
  ui.mixCarts.textContent = names.join(' · ');
  const single = names.length === 1 && app.sources.every((l) => l.length === 1 && l[0].bank);
  ui.mixTitle.textContent = `RIFT original · ${single ? bankById(app.sources[0][0].bank).name : 'Combined soundfonts'}`;

  const mixName = mix ? mix.name : 'Custom';
  ui.footerMix.textContent = `Original adaptive score · ${mixName} mix`;
  const count = NUMBER_WORDS[names.length] ?? String(names.length);
  ui.footerFonts.textContent = `${count} SNES soundfont${names.length === 1 ? '' : 's'} · Direct stereo capture`;
  renderGames();
}

// -------------------------------------------------------------------- games

function usageCounts() {
  const counts = new Map();
  for (const list of app.sources) {
    for (const key of new Set(list.map((s) => (s.font ? `f:${s.font}` : `b:${s.bank}`)))) {
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return counts;
}

function renderGames() {
  const q = ui.gameSearch.value.trim().toLowerCase();
  const counts = usageCounts();
  const used = (key) => {
    const n = counts.get(key);
    return n ? `${n} layer${n === 1 ? '' : 's'}` : '';
  };
  const items = [];

  for (const b of BANKS) {
    if (q && !`${b.name} ${b.blurb} ${b.year}`.toLowerCase().includes(q)) continue;
    items.push(el('li', {}, [
      el('button', { type: 'button', class: 'game', 'data-bank': b.id }, [
        el('span', { class: 'game-name', text: b.name }),
        el('span', { class: 'game-meta', text: `${b.year} · ${b.blurb}` }),
        el('span', { class: 'game-use', text: used(`b:${b.id}`) }),
      ]),
    ]));
  }

  const fonts = [...library.fonts.values()].filter((f) => !q || f.name.toLowerCase().includes(q));
  if (fonts.length) {
    items.push(el('li', { class: 'group', text: 'Your soundfonts' }));
    for (const f of fonts) {
      items.push(el('li', {}, [
        el('button', { type: 'button', class: 'game', 'data-font': f.id }, [
          el('span', { class: 'game-name', text: f.name }),
          el('span', { class: 'game-meta', text: `SF2 · ${f.presets.length} preset${f.presets.length === 1 ? '' : 's'}` }),
          el('span', { class: 'game-use', text: used(`f:${f.id}`) }),
        ]),
        el('button', { type: 'button', class: 'game-remove', 'data-remove': f.id, 'aria-label': `Remove ${f.name}`, title: 'Remove soundfont' }, [icon('i-x')]),
      ]));
    }
  }

  if (!items.length) items.push(el('li', { class: 'group', text: 'No cartridges match.' }));
  ui.gameList.replaceChildren(...items);
  ui.gameCount.textContent = String(BANKS.length + library.fonts.size);
}

function icon(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

function buildApplyTarget() {
  ui.applyTarget.replaceChildren(
    el('option', { value: 'all', text: 'All layers' }),
    ...LAYERS.map((l, i) => el('option', { value: String(i), text: l.name })),
  );
}

function applyCartridge(src, target = ui.applyTarget.value) {
  const indexes = target === 'all' ? LAYERS.map((_, i) => i) : [Number(target)];
  for (const i of indexes) {
    const role = LAYERS[i].role;
    const font = src.font ? library.fonts.get(src.font) : null;
    applySources(i, [font ? { font: font.id, preset: font.suggestPreset(role) } : { bank: src.bank }]);
  }
  updateMixUI();
  saveSettings();
}

function setSf2Status(text, applyFont = null) {
  ui.sf2Status.hidden = false;
  ui.sf2Message.textContent = text;
  ui.sf2Apply.hidden = !applyFont;
  ui.sf2Apply.dataset.font = applyFont ?? '';
}

// Loads .sf2 files. With `layer`, the first font goes straight onto that layer;
// otherwise the status offers to put it on every layer.
async function loadSoundfonts(files, layer = null) {
  const loaded = [];
  for (const file of files) {
    if (!/\.sf2$/i.test(file.name)) {
      setSf2Status(`${file.name} isn’t an .sf2 file.`);
      continue;
    }
    setSf2Status(`Reading ${file.name}…`);
    try {
      const font = parseSf2(await file.arrayBuffer(), file.name);
      library.addFont(font);
      loaded.push(font);
    } catch (err) {
      setSf2Status(`Couldn’t read ${file.name}: ${err.message}`);
    }
  }
  renderGames();
  const font = loaded[loaded.length - 1];
  if (!font) return;

  const presets = `${font.presets.length} preset${font.presets.length === 1 ? '' : 's'}`;
  if (layer !== null) {
    applySources(layer, [{ font: font.id, preset: font.suggestPreset(LAYERS[layer].role) }]);
    updateMixUI();
    if (app.popoverLayer === layer) openPopover(layer, rows[layer].src);
    setSf2Status(`${font.name} (${presets}) is now on ${LAYERS[layer].name.toLowerCase()}.`);
    return;
  }
  setSf2Status(`${font.name} loaded with ${presets}. Pick presets from any layer’s source, or:`, font.id);
}

function removeFont(id) {
  const fallback = sourcesForMix(mixById(DEFAULT_MIX));
  app.sources.forEach((list, i) => {
    if (list.some((s) => s.font === id)) {
      const kept = list.filter((s) => s.font !== id);
      applySources(i, kept.length ? kept : fallback[i]);
    }
  });
  library.removeFont(id);
  if (app.popoverLayer >= 0) closePopover();
  if (ui.sf2Apply.dataset.font === id) ui.sf2Status.hidden = true;
  updateMixUI();
}

// ---------------------------------------------------------------- encounter

function setThreat(v) {
  app.threat = clamp(v, 0, 100);
  const rounded = Math.round(app.threat);
  if (Number(ui.threat.value) !== rounded) {
    ui.threat.value = rounded;
    paintRange(ui.threat);
  }
  if (ui.threatValue.textContent !== String(rounded)) ui.threatValue.textContent = rounded;
  engine.setThreat(app.threat);
  requestState(threatToState(app.threat));
}

function setAuto(on) {
  if (app.auto === on) return;
  app.auto = on;
  ui.autoToggle.checked = on;
  if (on) {
    app.arcT = encounterTimeFor(app.threat);
    app.lastCtxTime = engine.ctx ? engine.ctx.currentTime : null;
  }
}

function updateEncounter() {
  if (!engine.ctx) return;
  const now = engine.ctx.currentTime;
  if (engine.playing && app.auto && app.lastCtxTime !== null) {
    app.arcT = (app.arcT + Math.max(0, now - app.lastCtxTime)) % ENCOUNTER_LENGTH;
    setThreat(encounterThreat(app.arcT));
  }
  app.lastCtxTime = now;
}

function addLog(bar, text) {
  app.log.unshift({ bar, text });
  app.log.length = Math.min(app.log.length, LOG_LIMIT);
  renderLog();
}

function renderLog() {
  if (!app.log.length) {
    ui.log.replaceChildren(el('li', { class: 'empty', text: 'Arrangement changes and events appear here.' }));
    return;
  }
  ui.log.replaceChildren(...app.log.map((e) => el('li', {}, [el('b', { text: String(e.bar) }), el('span', { text: e.text })])));
}

const STINGER_LOG = {
  enemy: 'Enemy down · accent played.',
  clear: 'Arena cleared · fanfare, then release.',
};

function enemyDown() {
  flash(ui.enemyBtn);
  engine.stinger('enemy');
  if (!engine.playing) addLog(app.bar, STINGER_LOG.enemy);
  if (!app.auto) setThreat(app.threat - 10);
}

function arenaCleared() {
  flash(ui.clearBtn);
  engine.stinger('clear');
  if (!engine.playing) addLog(app.bar, STINGER_LOG.clear);
  if (app.auto) {
    app.arcT = 0;
    setThreat(encounterThreat(0));
  } else {
    setThreat(6);
  }
}

function setLowHealth(on) {
  app.lowHealth = on;
  ui.healthToggle.checked = on;
  engine.setLowHealth(on);
  addLog(app.bar, on ? 'Low health · heartbeat in.' : 'Low health · recovered.');
}

// ---------------------------------------------------------------- transport

async function togglePlay() {
  if (engine.playing) {
    engine.pause();
    setPlayhead(-1);
    editor.setPlayhead(-1);
    ui.beats.forEach((b) => b.classList.remove('on'));
    return;
  }
  if (!window.AudioContext && !window.webkitAudioContext) {
    ui.holdText.textContent = 'This browser has no Web Audio support';
    return;
  }
  engine.unlock();
  ui.playBtn.setAttribute('aria-busy', 'true');
  ui.playLabel.textContent = 'Loading…';
  try {
    await app.loading;
    await engine.play();
    app.started = true;
    app.lastCtxTime = engine.ctx.currentTime;
  } catch (err) {
    console.error(err);
    ui.holdText.textContent = 'Audio could not start';
  } finally {
    ui.playBtn.removeAttribute('aria-busy');
    statusKey = '';
  }
}

function onStep(e) {
  app.displayState = e.state;
  app.bar = e.bar;
  app.phraseStep = e.phraseStep;
  const win = Math.floor(e.phraseStep / VIEW_STEPS);
  if (app.view.state !== e.state || app.view.win !== win) renderPatterns(e.state, win);
  setPlayhead(e.phraseStep % VIEW_STEPS);
  editor.setPlayhead(e.phraseStep, e.state);
  const beat = Math.floor(e.inBar / 4);
  ui.beats.forEach((b, i) => b.classList.toggle('on', i === beat));
  ui.barText.textContent = `Bar ${e.bar} · ${BPM} BPM`;
}

function frame() {
  if (engine.ctx) {
    let last = null;
    for (const e of engine.drain(engine.audibleTime())) {
      if (e.type === 'step') last = e;
      else if (e.type === 'state') addLog(e.bar, `${stateById(e.state).name} · arrangement changed.`);
      else if (e.type === 'stinger') addLog(e.bar, STINGER_LOG[e.stinger]);
    }
    if (last && engine.playing) onStep(last);
    updateEncounter();
  }
  editor.setState(targetState());
  renderStatus();

  let progress = 0;
  if (app.auto && app.started) progress = app.arcT / ENCOUNTER_LENGTH;
  else if (app.phraseStep >= 0) progress = (app.phraseStep + 1) / PHRASE_STEPS;
  ui.progress.style.width = `${(progress * 100).toFixed(2)}%`;

  scope.draw(engine.analyser, engine.playing, app.lowHealth ? '#ff8a5c' : '#dbe89e');
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- recording

let recordTimer = 0;

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function toggleRecord() {
  engine.unlock();
  await engine.ensureContext();
  const rec = engine.recorder;
  if (!rec.active) {
    try {
      await rec.start();
    } catch (err) {
      console.error(err);
      ui.recordLabel.textContent = 'Capture unavailable';
      return;
    }
    rec.onLimit = () => { if (rec.active) toggleRecord(); };
    ui.recordBtn.classList.add('on');
    const tick = () => {
      const s = Math.floor(rec.elapsed);
      ui.recordLabel.textContent = `Stop capture · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };
    tick();
    recordTimer = setInterval(tick, 250);
    return;
  }
  clearInterval(recordTimer);
  ui.recordBtn.classList.remove('on');
  ui.recordLabel.textContent = 'Saving…';
  const result = await rec.stop();
  ui.recordLabel.textContent = 'Record capture';
  if (result) download(result.blob, `rift-capture-${stamp()}.${result.ext}`);
}

// ------------------------------------------------------------------- wiring

function wire() {
  ui.playBtn.addEventListener('click', togglePlay);

  ui.autoToggle.addEventListener('change', () => setAuto(ui.autoToggle.checked));
  ui.threat.addEventListener('input', () => {
    setAuto(false);
    paintRange(ui.threat);
    setThreat(Number(ui.threat.value));
  });

  ui.enemyBtn.addEventListener('click', enemyDown);
  ui.clearBtn.addEventListener('click', arenaCleared);
  ui.healthToggle.addEventListener('change', () => setLowHealth(ui.healthToggle.checked));

  const tabs = [[$('tabMixes'), $('paneMixes')], [$('tabGames'), $('paneGames')]];
  for (const [tab, pane] of tabs) {
    tab.addEventListener('click', () => {
      for (const [t, p] of tabs) {
        t.setAttribute('aria-selected', String(t === tab));
        p.hidden = t !== tab;
      }
    });
  }

  ui.mixSelect.addEventListener('change', () => applyMix(ui.mixSelect.value));
  ui.gameSearch.addEventListener('input', renderGames);
  ui.gameList.addEventListener('click', (e) => {
    const remove = e.target.closest('[data-remove]');
    if (remove) {
      removeFont(remove.dataset.remove);
      return;
    }
    const game = e.target.closest('.game');
    if (!game) return;
    applyCartridge(game.dataset.font ? { font: game.dataset.font } : { bank: game.dataset.bank });
  });

  let uploadLayer = null;
  ui.uploadBtn.addEventListener('click', () => {
    uploadLayer = null;
    ui.sf2Input.click();
  });
  ui.popoverUpload.addEventListener('click', () => {
    uploadLayer = app.popoverLayer;
    ui.sf2Input.click();
  });
  ui.sf2Input.addEventListener('change', () => {
    loadSoundfonts([...ui.sf2Input.files], uploadLayer);
    ui.sf2Input.value = '';
  });
  ui.sf2Apply.addEventListener('click', () => {
    const font = library.fonts.get(ui.sf2Apply.dataset.font);
    if (!font) return;
    applyCartridge({ font: font.id }, 'all');
    setSf2Status(`${font.name} is on every layer. Fine-tune presets from each layer’s source.`);
  });
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  document.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    ui.uploadBtn.classList.add('drag');
  });
  document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) ui.uploadBtn.classList.remove('drag');
  });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    ui.uploadBtn.classList.remove('drag');
    loadSoundfonts([...e.dataTransfer.files]);
  });

  ui.editBtn.addEventListener('click', () => {
    if (editor.isOpen) editor.close();
    else toggleEditor(app.lastEditorLayer);
  });
  ui.resetBtn.addEventListener('click', onResetClick);
  ui.resetBtn.addEventListener('blur', disarmReset);

  ui.master.addEventListener('input', () => {
    engine.setMaster(Number(ui.master.value));
    paintRange(ui.master);
    saveSettings();
  });
  ui.recordBtn.addEventListener('click', toggleRecord);

  ui.sourcePrimary.addEventListener('change', onPopoverChange);
  ui.sourceSecondary.addEventListener('change', onPopoverChange);
  document.addEventListener('pointerdown', (e) => {
    if (app.popoverLayer < 0) return;
    if (ui.popover.contains(e.target) || rows[app.popoverLayer].src.contains(e.target)) return;
    closePopover();
  });
  window.addEventListener('resize', closePopover);

  document.addEventListener('keydown', (e) => {
    const t = e.target;
    const typing = t.closest('select, textarea, input[type="search"], input[type="text"]');
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault();
      undoEdit();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'Escape') {
      if (app.popoverLayer >= 0) {
        const anchor = rows[app.popoverLayer].src;
        closePopover();
        anchor.focus();
      } else if (editor.isOpen && editor.root.contains(t)) {
        const anchor = rows[editor.layer].steps;
        editor.close();
        anchor.focus();
      }
      return;
    }
    if (t.closest('select, textarea, input[type="search"], input[type="text"], #sourcePopover')) return;
    const key = e.key.toLowerCase();
    if (key === ' ') {
      if (t.closest('button, input, label')) return;
      e.preventDefault();
      togglePlay();
    } else if (/^[1-4]$/.test(key)) {
      chooseState(STATES[Number(key) - 1].id);
    } else if (key === 'k') {
      enemyDown();
    } else if (key === 'c') {
      arenaCleared();
    } else if (key === 'h') {
      setLowHealth(!app.lowHealth);
    } else if (key === 'a') {
      setAuto(!app.auto);
    }
  });

  // Keeps the encounter arc moving when the tab is in the background.
  setInterval(updateEncounter, 250);
}

// --------------------------------------------------------------------- init

async function loadSources(sources) {
  for (let i = 0; i < LAYERS.length; i++) {
    await idle();
    applySources(i, sources[i]);
  }
  updateMixUI();
  app.ready = true;
  warmBanks();
}

// Render every cartridge in the background so switching mixes is instant.
function warmBanks() {
  const tasks = library.warmTasks();
  const later = window.requestIdleCallback
    ? (fn) => requestIdleCallback(fn, { timeout: 500 })
    : (fn) => setTimeout(fn, 30);
  const next = () => {
    const task = tasks.shift();
    if (!task) return;
    task();
    later(next);
  };
  later(next);
}

function init() {
  $('bpmStatus').textContent = `${BPM} BPM`;
  $('keyStatus').textContent = KEY_NAME;
  buildStates();
  buildLayers();
  buildApplyTarget();
  wire();

  const saved = loadSettings();
  const defaults = sourcesForMix(mixById(DEFAULT_MIX));
  const sources = LAYERS.map((_, i) => {
    const list = saved?.layers?.[i]?.sources?.filter((s) => bankById(s.bank)).slice(0, 2);
    return list?.length ? list.map((s) => ({ bank: s.bank })) : defaults[i];
  });

  engine.setMaster(clamp(Number(saved?.master ?? 0.8), 0, 1));
  ui.master.value = engine.master;
  paintRange(ui.master);
  rows.forEach((row, i) => {
    const s = saved?.layers?.[i];
    const volume = clamp(Number(s?.volume ?? LAYERS[i].volume), 0, 1);
    engine.setLayerVolume(i, volume);
    row.vol.value = volume;
    paintRange(row.vol);
    setLayerEnabled(i, s?.enabled ?? true);
    row.src.textContent = '…';
  });

  importEdits(saved?.arrangement);
  updateEditMarks();
  paintRange(ui.threat);
  renderPatterns(app.displayState, 0);
  renderLog();
  renderGames();
  app.loading = loadSources(sources);
  requestAnimationFrame(frame);
}

init();
