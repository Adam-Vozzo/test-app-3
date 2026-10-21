// Piano-roll editor for one layer's part in one state. Notes are edited in
// place in ARRANGEMENT and recompiled, so changes are heard on the next pass.

import {
  LAYERS, STATES, ROWS, CHORDS, ARRANGEMENT, PHRASE_STEPS, STEPS_PER_BAR,
  setLayerNotes, setChord, resetLayer, exportEdits, importEdits, isLayerEdited,
} from '../score.js';

const ROW_HEIGHT = { pad: 34, lead: 16 };
const DEFAULT_LEN = { pad: 16, bass: 2, arp: 1, lead: 2, accent: 2, kit: 1 };
const NEXT_VELOCITY = { x: 'X', X: 'g', g: 'x' };
const HISTORY_LIMIT = 80;
const BARS = PHRASE_STEPS / STEPS_PER_BAR;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// --------------------------------------------------------------- undo stack

const history = [];

export function pushHistory() {
  history.push(JSON.stringify(exportEdits()));
  if (history.length > HISTORY_LIMIT) history.shift();
}

export function undo() {
  if (!history.length) return false;
  importEdits(JSON.parse(history.pop()));
  return true;
}

export const canUndo = () => history.length > 0;

// ------------------------------------------------------------------- editor

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  node.append(...children);
  return node;
}

function icon(id) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

export class ArrangementEditor {
  // onEdit(): the arrangement changed. onPickState(id): the user chose a state
  // tab. onPreview(layer, note, state): audition a note. onClose(): closed.
  constructor({ onEdit, onPickState, onPreview, onClose }) {
    Object.assign(this, { onEdit, onPickState, onPreview, onClose });
    this.layer = -1;
    this.state = STATES[0].id;
    this.drag = null;
    this.cursor = { row: 0, col: 0 };
    this.root = null;
  }

  get isOpen() {
    return this.layer >= 0;
  }

  get def() {
    return LAYERS[this.layer];
  }

  get role() {
    return this.def.role;
  }

  get rows() {
    return ROWS[this.role];
  }

  notes() {
    return ARRANGEMENT[this.state].layers[this.def.id];
  }

  show(layer, afterEl, state) {
    this.close(true);
    this.layer = layer;
    this.state = state;
    this.cursor = { row: Math.floor(this.rows.length / 2), col: 0 };
    this.build();
    afterEl.after(this.root);
    this.render();
  }

  close(silent = false) {
    if (!this.isOpen) return;
    this.root.remove();
    this.root = null;
    this.layer = -1;
    this.drag = null;
    if (!silent) this.onClose?.();
  }

  setState(state) {
    if (!this.isOpen || state === this.state) return;
    this.state = state;
    this.render();
  }

  // Re-reads the arrangement, e.g. after undo or a global reset.
  refresh() {
    if (this.isOpen) this.render();
  }

  setPlayhead(phraseStep, state) {
    if (!this.isOpen) return;
    const on = phraseStep >= 0 && state === this.state;
    this.playhead.hidden = !on;
    if (on) this.playhead.style.left = `${(phraseStep / PHRASE_STEPS) * 100}%`;
  }

  // ---------------------------------------------------------------- building

  build() {
    const { def, role } = this;
    const rowH = ROW_HEIGHT[role] ?? 20;

    this.tabs = STATES.map((s) => el('button', { type: 'button', role: 'tab', class: 'seg-btn', 'data-state': s.id, text: s.name }));
    const tabBar = el('div', { class: 'seg', role: 'tablist', 'aria-label': 'State to edit' }, this.tabs);
    tabBar.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-state]');
      if (!tab) return;
      this.setState(tab.dataset.state);
      this.onPickState(tab.dataset.state);
    });

    this.undoBtn = el('button', { type: 'button', class: 'btn-ghost', 'data-act': 'undo', title: 'Undo (Ctrl+Z)' }, [icon('i-undo'), el('span', { text: 'Undo' })]);
    const actions = el('div', { class: 'editor-actions' }, [
      this.undoBtn,
      el('button', { type: 'button', class: 'btn-ghost', 'data-act': 'clear', text: 'Clear' }),
      el('button', { type: 'button', class: 'btn-ghost', 'data-act': 'reset', text: 'Reset part' }),
      el('button', { type: 'button', class: 'btn-icon', 'data-act': 'close', 'aria-label': 'Close editor', title: 'Close' }, [icon('i-x')]),
    ]);
    actions.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'undo') this.undo();
      else if (act === 'clear') this.edit(() => setLayerNotes(this.state, def.id, []));
      else if (act === 'reset') this.edit(() => resetLayer(this.state, def.id));
      else if (act === 'close') this.close();
    });

    this.chordSelects = Array.from({ length: BARS }, (_, bar) => {
      const select = el('select', { 'aria-label': `Bar ${bar + 1} chord` },
        CHORDS.map((c) => el('option', { value: String(c.degree), text: `${c.name}  ${c.roman}` })));
      select.addEventListener('change', () => {
        pushHistory();
        setChord(this.state, bar, Number(select.value));
        this.onEdit();
        this.renderTabs();
        this.onPreview(0, { step: bar * STEPS_PER_BAR, tok: 'P', len: 8 }, this.state);
      });
      return el('div', { class: 'chord-cell' }, [select]);
    });

    this.grid = el('div', {
      class: `roll-grid role-${role}`,
      tabindex: '0',
      role: 'application',
      'aria-label': `${def.name} part. Arrow keys move, Enter adds or removes a note.`,
    });
    this.grid.style.setProperty('--row', `${rowH}px`);
    this.grid.style.height = `${rowH * this.rows.length}px`;
    this.playhead = el('i', { class: 'roll-head' });
    this.playhead.hidden = true;
    this.cursorEl = el('i', { class: 'roll-cursor' });
    this.notesLayer = el('div', { class: 'roll-notes' });
    this.grid.append(this.notesLayer, this.playhead, this.cursorEl);

    this.grid.addEventListener('pointerdown', (e) => this.pointerDown(e));
    this.grid.addEventListener('pointermove', (e) => this.pointerMove(e));
    this.grid.addEventListener('pointerup', (e) => this.pointerUp(e));
    this.grid.addEventListener('pointercancel', (e) => this.pointerUp(e));
    this.grid.addEventListener('keydown', (e) => this.keyDown(e));

    const labels = this.rows.map((r) => el('div', { class: 'roll-label', text: r.label }));
    const barNums = Array.from({ length: BARS }, (_, i) => el('span', { text: `Bar ${i + 1}` }));
    const roll = el('div', { class: 'roll' }, [
      el('div', { class: 'roll-corner', text: 'Chord' }),
      el('div', { class: 'roll-chords' }, this.chordSelects),
      el('div', { class: 'roll-labels' }, labels),
      this.grid,
      el('div', { class: 'roll-corner' }),
      el('div', { class: 'roll-bars' }, barNums),
    ]);
    roll.style.setProperty('--row', `${rowH}px`);

    const hint = role === 'kit'
      ? 'Click or drag along a row to add hits. Click a hit to remove it; Shift-click to cycle accent, normal and ghost.'
      : 'Click to add a note, drag right to lengthen it, drag a note’s end to resize, click a note to remove it.';

    this.root = el('li', { class: 'editor', role: 'region', 'aria-label': `${def.name} part editor` }, [
      el('div', { class: 'editor-bar' }, [
        el('div', { class: 'editor-title' }, [el('b', { text: def.name }), el('span', { text: 'Part editor' })]),
        tabBar,
        actions,
      ]),
      el('div', { class: 'roll-wrap' }, [roll]),
      el('p', { class: 'editor-hint', text: `${hint} Edits play from the next pass.` }),
    ]);
  }

  // --------------------------------------------------------------- rendering

  render() {
    const prog = ARRANGEMENT[this.state].progression;
    this.chordSelects.forEach((cell, bar) => { cell.firstChild.value = String(prog[bar]); });
    this.renderTabs();
    this.renderNotes();
    this.renderCursor();
  }

  renderTabs() {
    for (const tab of this.tabs) {
      tab.setAttribute('aria-selected', String(tab.dataset.state === this.state));
      tab.classList.toggle('edited', isLayerEdited(tab.dataset.state, this.def.id));
    }
    this.undoBtn.disabled = !canUndo();
  }

  rowOf(note) {
    const key = this.role === 'kit' ? note.lane : note.tok;
    return this.rows.findIndex((r) => r.key === key);
  }

  renderNotes() {
    const rowH = ROW_HEIGHT[this.role] ?? 20;
    const nodes = [];
    this.notes().forEach((n, i) => {
      const row = this.rowOf(n);
      if (row < 0) return;
      const node = el('div', { class: `roll-note${n.lane ? ` vel-${n.tok === 'X' ? 'accent' : n.tok === 'g' ? 'ghost' : 'normal'}` : ''}`, 'data-i': String(i) });
      node.style.left = `${(n.step / PHRASE_STEPS) * 100}%`;
      node.style.width = `${(n.len / PHRASE_STEPS) * 100}%`;
      node.style.top = `${row * rowH}px`;
      node.style.height = `${rowH}px`;
      nodes.push(node);
    });
    this.notesLayer.replaceChildren(...nodes);
  }

  renderCursor() {
    const rowH = ROW_HEIGHT[this.role] ?? 20;
    this.cursorEl.style.left = `${(this.cursor.col / PHRASE_STEPS) * 100}%`;
    this.cursorEl.style.top = `${this.cursor.row * rowH}px`;
    this.cursorEl.style.height = `${rowH}px`;
  }

  // ----------------------------------------------------------------- editing

  edit(fn) {
    pushHistory();
    fn();
    this.commit();
  }

  commit() {
    setLayerNotes(this.state, this.def.id, this.notes());
    this.renderNotes();
    this.renderTabs();
    this.onEdit();
  }

  undo() {
    if (undo()) {
      this.render();
      this.onEdit();
    }
  }

  makeNote(row, col) {
    const key = this.rows[row].key;
    if (this.role === 'kit') return { step: col, tok: 'x', len: 1, lane: key };
    const len = this.role === 'pad' ? STEPS_PER_BAR - (col % STEPS_PER_BAR) : DEFAULT_LEN[this.role];
    return { step: col, tok: key, len: Math.min(len, PHRASE_STEPS - col) };
  }

  noteAt(row, col) {
    return this.notes().find((n) => this.rowOf(n) === row && col >= n.step && col < n.step + n.len);
  }

  // Adds or re-fits a note, trimming or dropping whatever it overlaps in its row.
  place(note) {
    const notes = this.notes();
    const row = this.rowOf(note);
    const end = note.step + note.len;
    for (let i = notes.length - 1; i >= 0; i--) {
      const other = notes[i];
      if (other === note || this.rowOf(other) !== row) continue;
      if (other.step >= note.step && other.step < end) notes.splice(i, 1);
      else if (other.step < note.step && other.step + other.len > note.step) other.len = note.step - other.step;
    }
    if (!notes.includes(note)) notes.push(note);
  }

  remove(note) {
    const notes = this.notes();
    notes.splice(notes.indexOf(note), 1);
  }

  preview(note) {
    this.onPreview(this.layer, note, this.state);
  }

  cellAt(e) {
    const r = this.grid.getBoundingClientRect();
    const rowH = ROW_HEIGHT[this.role] ?? 20;
    return {
      col: clamp(Math.floor(((e.clientX - r.left) / r.width) * PHRASE_STEPS), 0, PHRASE_STEPS - 1),
      row: clamp(Math.floor((e.clientY - r.top) / rowH), 0, this.rows.length - 1),
    };
  }

  pointerDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    this.grid.focus({ preventScroll: true });
    const { col, row } = this.cellAt(e);
    this.cursor = { col, row };
    this.renderCursor();
    this.grid.setPointerCapture(e.pointerId);

    const hit = e.target.closest('.roll-note');
    const note = hit ? this.notes()[Number(hit.dataset.i)] : null;
    pushHistory();

    if (note) {
      if (this.role === 'kit' && e.shiftKey) {
        note.tok = NEXT_VELOCITY[note.tok] ?? 'x';
        this.commit();
        this.preview(note);
        return;
      }
      const rect = hit.getBoundingClientRect();
      if (this.role !== 'kit' && rect.right - e.clientX <= Math.min(8, rect.width / 3)) {
        this.drag = { mode: 'resize', note };
        return;
      }
      this.remove(note);
      this.drag = { mode: 'erase', row };
      this.commit();
      return;
    }

    const created = this.makeNote(row, col);
    this.place(created);
    this.drag = this.role === 'kit'
      ? { mode: 'paint', row, last: col }
      : { mode: 'draw', note: created, start: col, moved: false };
    this.commit();
    this.preview(created);
  }

  pointerMove(e) {
    const d = this.drag;
    if (!d) return;
    const { col } = this.cellAt(e);
    if (d.mode === 'draw' || d.mode === 'resize') {
      if (d.mode === 'draw' && !d.moved && col === d.start) return;
      d.moved = true;
      const len = clamp(col - d.note.step + 1, 1, PHRASE_STEPS - d.note.step);
      if (len !== d.note.len) {
        d.note.len = len;
        this.place(d.note);
        this.commit();
      }
    } else if (d.mode === 'paint' && col !== d.last) {
      d.last = col;
      if (!this.noteAt(d.row, col)) {
        const n = this.makeNote(d.row, col);
        this.place(n);
        this.commit();
        this.preview(n);
      }
    } else if (d.mode === 'erase') {
      const n = this.noteAt(d.row, col);
      if (n) {
        this.remove(n);
        this.commit();
      }
    }
  }

  pointerUp(e) {
    if (!this.drag) return;
    this.drag = null;
    if (this.grid.hasPointerCapture(e.pointerId)) this.grid.releasePointerCapture(e.pointerId);
  }

  keyDown(e) {
    const c = this.cursor;
    const move = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[e.key];
    if (move) {
      e.preventDefault();
      e.stopPropagation();
      const existing = this.noteAt(c.row, c.col);
      if (e.shiftKey && existing && this.role !== 'kit' && move[1]) {
        this.edit(() => {
          existing.len = clamp(existing.len + move[1], 1, PHRASE_STEPS - existing.step);
          this.place(existing);
        });
        return;
      }
      c.row = clamp(c.row + move[0], 0, this.rows.length - 1);
      c.col = clamp(c.col + move[1], 0, PHRASE_STEPS - 1);
      this.renderCursor();
      return;
    }
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      e.stopPropagation();
      const existing = this.noteAt(c.row, c.col);
      if (existing) {
        this.edit(() => this.remove(existing));
      } else if (e.key === 'Enter' || e.key === ' ') {
        const n = this.makeNote(c.row, c.col);
        this.edit(() => this.place(n));
        this.preview(n);
      }
    }
  }
}
