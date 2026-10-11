// Vim: modal editing core (buffers, windows, motions, operators, text objects, registers,
// undo, macros, visual modes, insert mode and rendering). Ex commands live in vim-ex.js.

import { wcwidth } from '../core/util.js';
import { basename } from '../core/vfs.js';
import { exMixin, synSpans, detectFt, INTRO } from './vim-ex.js';

export const ESC = '\x1b', CR = '\r', BS = '\x7f', TAB = '\t';
const SP = { ArrowLeft: '', ArrowRight: '', ArrowUp: '', ArrowDown: '', Home: '', End: '', PageUp: '', PageDown: '', Delete: '', Insert: '', F1: '', WheelUp: '', WheelDown: '' };
export const [LEFT, RIGHT, UP, DOWN, HOME, END, PGUP, PGDN, DEL, INS, F1, WUP, WDN] = Object.values(SP);
export const C = ch => String.fromCharCode(ch.charCodeAt(0) & 31);
const NAMES = { Esc: ESC, CR, Enter: CR, Return: CR, BS, Tab: TAB, Space: ' ', lt: '<', Bar: '|', Bslash: '\\', Left: LEFT, Right: RIGHT, Up: UP, Down: DOWN, Home: HOME, End: END, PageUp: PGUP, PageDown: PGDN, Del: DEL, Insert: INS, F1, Nop: '' };

// Terminal key event -> single internal key character (control chars / private-use code points).
export function keyOf(ev) {
  if (ev.text) return ev.key;
  const k = ev.key;
  if (ev.ctrl && k.length === 1) {
    if (/[a-z]/.test(k)) return C(k);
    return { '[': ESC, ']': '\x1d', '^': '\x1e', 6: '\x1e', '\\': '\x1c', ' ': '\x00', '@': '\x00', _: '\x1f' }[k] ?? null;
  }
  if (k === 'Escape') return ESC;
  if (k === 'Enter') return CR;
  if (k === 'Backspace') return BS;
  if (k === 'Tab') return TAB;
  return SP[k] ?? (k.length === 1 ? k : null);
}
// "<C-w>jj<Esc>" -> internal keys
export function parseKeys(s, leader = '\\') {
  return s.replace(/<([A-Za-z]-)?([A-Za-z0-9]+)>/g, (m, mod, name) => {
    if (mod && mod[0].toLowerCase() === 'c' && name.length === 1) return C(name);
    if (/^leader$/i.test(name)) return leader;
    const key = Object.keys(NAMES).find(n => n.toLowerCase() === name.toLowerCase());
    return key ? NAMES[key] : m;
  });
}
export function showKeys(s) {
  let out = '';
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (ch === BS) out += '<BS>'; else if (c < 32) out += '^' + String.fromCharCode(c + 64);
    else if (c >= 0xe000 && c <= 0xe0ff) out += '<' + (Object.keys(SP)[c - 0xe001] || '?').replace('Arrow', '') + '>';
    else out += ch;
  }
  return out;
}

class Buf {
  constructor(id, name = '') { Object.assign(this, { id, name, path: null, lines: [''], mod: false, undo: [], redo: [], marks: {}, seq: 0, ft: '', ro: false }); }
}
const INC = Symbol('incomplete');
const OPS = new Set(['d', 'c', 'y', '<', '>', '=', '!', 'g~', 'gu', 'gU', 'g?', 'gq', 'gw']);
const PAIRS = { '(': ')', '[': ']', '{': '}', '<': '>' }, CLOSE = { ')': '(', ']': '[', '}': '{', '>': '<' };
const rot13 = s => s.replace(/[a-z]/gi, ch => String.fromCharCode(((ch.charCodeAt(0) & 31) + 12) % 26 + 1 + (ch.charCodeAt(0) & 96)));
const indentOf = s => /^[ \t]*/.exec(s)[0];
const firstNB = s => { const n = indentOf(s).length; return n >= s.length ? Math.max(0, s.length - 1) : n; };

export class Vim {
  constructor(io) {
    this.io = io; this.fs = io.fs; this.cwd = io.cwd || '/'; this.sc = io.screen;
    this.bufs = []; this.nextBuf = 1; this.mode = 'n'; this.pend = ''; this.regs = {}; this.rec = '';
    this.o = { nu: false, rnu: false, ic: false, scs: false, hls: false, is: true, wrap: true, list: false, ts: 8, sw: 8, sts: 0, et: false, ai: true, si: false, cul: false, so: 5, smd: true, ru: true, ls: 1, ws: true, sc: true, hid: false, sb: false, spr: false, tm: 1000, cb: '', syn: true, tw: 0, mps: '(:),{:},[:]' };
    this.maps = { n: {}, i: {}, v: {}, c: {} }; this.mapBuf = ''; this.leader = '\\';
    this.jumps = []; this.jidx = 0; this.hist = { ':': [], '/': [] };
    this.message = null; this.intro = true; this.queue = []; this.synCache = new Map();
    this.setScheme('default');
    this.args = []; this.argi = 0;
  }

  // ---- lifecycle
  run(argv = []) {
    return new Promise(resolve => {
      this.exit = resolve;
      let goto = null, ro = false;
      const files = [];
      for (const a of argv) { if (/^\+\d*$/.test(a)) goto = a.length > 1 ? +a.slice(1) : Infinity; else if (a === '-R') ro = true; else if (!/^-/.test(a)) files.push(a); }
      this.args = files;
      const first = files.length ? this.loadFile(files[0]) : this.newBuf();
      for (const f of files.slice(1)) this.loadFile(f);
      this.layout = { win: this.newWin(first) };
      this.w = this.layout.win;
      if (ro) first.ro = true;
      this.sourceRc();
      if (first.loadMsg) this.msg(first.loadMsg);
      if (goto !== null) { this.cur.l = Math.min(this.L.length - 1, Math.max(0, goto - 1)); this.cur.c = firstNB(this.L[this.cur.l]); }
      if (files.length) this.intro = false;
      this.render();
    });
  }
  quit(code = 0) { clearTimeout(this.mapT); this.dead = true; this.exit(code); }
  resize() { if (!this.dead) this.render(); }

  get b() { return this.w.buf; }
  get cur() { return this.w.cur; }
  get L() { return this.w.buf.lines; }
  get line() { return this.w.buf.lines[this.w.cur.l]; }
  msg(text, hl = null) { this.message = { text, hl }; }
  err(text) { this.message = { text, hl: this.hl.ErrorMsg }; this.failed = true; }
  bell() { this.failed = true; if (this.io.bell) this.io.bell(); }

  newBuf(name = '') { const b = new Buf(this.nextBuf++, name); this.bufs.push(b); return b; }
  newWin(buf) { return { buf, cur: { l: 0, c: 0 }, top: 0, left: 0, want: 0, rect: { x: 0, y: 0, w: 80, h: 23 } }; }
  wins(node = this.layout, out = []) { if (node.win) out.push(node.win); else node.kids.forEach(k => this.wins(k, out)); return out; }

  loadFile(name) {
    const abs = this.fs.abs(name, this.cwd);
    let buf = this.bufs.find(b => b.path === abs);
    if (buf) return buf;
    buf = this.newBuf(name); buf.path = abs;
    const n = this.fs.stat(abs);
    if (!n) buf.loadMsg = `"${name}" [New]`;
    else if (n.t === 'd') { buf.loadMsg = `"${name}" is a directory`; buf.ro = true; }
    else {
      let text = '';
      try { text = this.fs.read(abs); } catch { buf.loadMsg = `"${name}" [Permission Denied]`; buf.ro = true; }
      if (text.includes('\r\n')) { buf.dos = true; text = text.replace(/\r\n/g, '\n'); }
      const noeol = text !== '' && !text.endsWith('\n');
      buf.lines = text.split('\n');
      if (text.endsWith('\n')) buf.lines.pop();
      if (!buf.lines.length) buf.lines = [''];
      if (!this.fs._can(n, 2)) buf.ro = true;
      buf.loadMsg ||= `"${name}"${buf.ro ? ' [readonly]' : ''}${noeol ? ' [noeol]' : ''}${buf.dos ? ' [dos]' : ''} ${text === '' ? 0 : buf.lines.length}L, ${new Blob([text]).size}B`;
    }
    buf.ft = detectFt(name, buf.lines[0]);
    return buf;
  }
  writeBuf(buf, name, { force = false, l1 = 0, l2 = buf.lines.length - 1, append = false } = {}) {
    const own = !name || this.fs.abs(name, this.cwd) === buf.path;
    if (!name) name = buf.name;
    if (!name) { this.err('E32: No file name'); return false; }
    const abs = this.fs.abs(name, this.cwd), whole = l1 === 0 && l2 === buf.lines.length - 1;
    const exists = this.fs.stat(abs);
    if (exists && exists.t === 'd') { this.err(`E17: "${name}" is a directory`); return false; }
    if (own && buf.ro && !force) { this.err("E45: 'readonly' option is set (add ! to override)"); return false; }
    if (!own && exists && !force && !append) { this.err('E13: File exists (add ! to override)'); return false; }
    const text = buf.lines.slice(l1, l2 + 1).join(buf.dos ? '\r\n' : '\n') + (buf.dos ? '\r\n' : '\n');
    try { this.fs.write(abs, text, { append }); } catch { this.err(`E212: Can't open file for writing`); return false; }
    this.msg(`"${name}"${exists ? '' : ' [New]'}${buf.dos ? ' [dos]' : ''} ${l2 - l1 + 1}L, ${new Blob([text]).size}B ${append ? 'appended' : 'written'}`);
    if (whole && (own || !buf.path)) { buf.mod = false; if (!buf.path) { buf.path = abs; buf.name = name; buf.ft = detectFt(name, buf.lines[0]); } }
    return true;
  }

  // ---- low-level text changes (all edits go through these so undo and marks stay right)
  touch() {
    const b = this.b;
    if (!this.ug) {
      b.undo.push({ lines: b.lines.slice(), cur: { ...this.cur }, seq: b.seq, mod: b.mod, time: Date.now() });
      if (b.undo.length > 300) b.undo.shift();
      b.redo = []; b.seq++; this.ug = true;
      if (b.ro && !b.warned) { b.warned = true; this.msg('W10: Warning: Changing a readonly file', this.hl.WarningMsg); }
    }
    b.mod = true; this.changed = true; this.intro = false;
  }
  setLine(l, s) { this.touch(); this.L[l] = s; }
  shiftMarks(at, n) { for (const m of Object.values(this.b.marks)) if (m.l >= at) m.l = Math.max(at, m.l + n); }
  insertLines(at, arr) { this.touch(); this.b.lines.splice(at, 0, ...arr); this.shiftMarks(at, arr.length); }
  deleteLines(l1, l2) {
    this.touch();
    const gone = this.b.lines.splice(l1, l2 - l1 + 1);
    if (!this.b.lines.length) this.b.lines.push('');
    this.shiftMarks(l1 + 1, -gone.length);
    return gone;
  }
  // Inserts text (may contain newlines) at l,c. Returns the position just after it.
  insertText(l, c, text) {
    this.touch();
    const line = this.L[l], parts = text.split('\n');
    if (parts.length === 1) { this.L[l] = line.slice(0, c) + text + line.slice(c); return { l, c: c + text.length }; }
    const tail = line.slice(c);
    this.L[l] = line.slice(0, c) + parts[0];
    const rest = parts.slice(1);
    const endC = rest.at(-1).length;
    rest[rest.length - 1] += tail;
    this.b.lines.splice(l + 1, 0, ...rest);
    this.shiftMarks(l + 1, rest.length);
    return { l: l + rest.length, c: endC };
  }
  getRange(s, e) {
    if (s.l === e.l) return this.L[s.l].slice(s.c, e.c);
    return [this.L[s.l].slice(s.c), ...this.L.slice(s.l + 1, e.l), this.L[e.l].slice(0, e.c)].join('\n');
  }
  deleteRange(s, e) {   // e exclusive
    this.touch();
    const text = this.getRange(s, e);
    this.L[s.l] = this.L[s.l].slice(0, s.c) + this.L[e.l].slice(e.c);
    if (e.l > s.l) { this.b.lines.splice(s.l + 1, e.l - s.l); this.shiftMarks(s.l + 1, s.l - e.l); }
    return text;
  }

  // ---- undo
  undo(count = 1) {
    const b = this.b;
    for (let k = 0; k < count; k++) {
      const u = b.undo.pop();
      if (!u) { this.msg('Already at oldest change'); return; }
      b.redo.push({ lines: b.lines, cur: { ...this.cur }, seq: b.seq, mod: b.mod, time: Date.now() });
      this.undoMsg(b.lines.length, u, 'before');
      b.lines = u.lines; b.mod = u.mod; b.seq = u.seq; this.cur.l = u.cur.l; this.cur.c = u.cur.c;
    }
  }
  redo(count = 1) {
    const b = this.b;
    for (let k = 0; k < count; k++) {
      const r = b.redo.pop();
      if (!r) { this.msg('Already at newest change'); return; }
      b.undo.push({ lines: b.lines, cur: { ...this.cur }, seq: b.seq, mod: b.mod, time: Date.now() });
      this.undoMsg(b.lines.length, r, 'after');
      b.lines = r.lines; b.mod = r.mod; b.seq = r.seq; this.cur.l = r.cur.l; this.cur.c = r.cur.c;
    }
  }
  undoMsg(oldN, snap, word) {
    const d = snap.lines.length - oldN, secs = Math.round((Date.now() - snap.time) / 1000);
    const what = d === 0 ? '1 change' : d === 1 ? '1 more line' : d === -1 ? '1 line less' : d > 0 ? `${d} more lines` : `${-d} fewer lines`;
    this.msg(`${what}; ${word} #${word === 'before' ? snap.seq + 1 : snap.seq}  ${secs} second${secs === 1 ? '' : 's'} ago`);
  }

  // ---- registers
  setReg(name, text, kind, isDelete) {
    if (name === '_') return;
    const r = { t: text, k: kind };
    if (name && /[A-Z]/.test(name)) {
      const low = name.toLowerCase(), old = this.regs[low];
      this.regs[low] = old ? { t: old.t + (old.k === 'l' || kind === 'l' ? '\n' : '') + text, k: old.k === 'l' || kind === 'l' ? 'l' : 'c' } : r;
      this.regs['"'] = this.regs[low];
      return;
    }
    if (name && name !== '"' && name !== '+' && name !== '*') this.regs[name] = r;
    else if (isDelete) {
      if (kind === 'l' || text.includes('\n')) { for (let k = 9; k > 1; k--) if (this.regs[k - 1]) this.regs[k] = this.regs[k - 1]; this.regs[1] = r; } else this.regs['-'] = r;
    } else this.regs[0] = r;
    this.regs['"'] = r;
    if (name === '+' || name === '*' || (!name && /unnamed/.test(this.o.cb))) { this.regs['+'] = r; if (this.io.clipWrite) this.io.clipWrite(text + (kind === 'l' ? '\n' : '')); }
  }
  getReg(name) {
    if (!name || name === '"') return this.regs['"'] || null;
    if (name === '%') return this.b.name ? { t: this.b.name, k: 'c' } : null;
    if (name === ':') return this.lastEx ? { t: this.lastEx, k: 'c' } : null;
    if (name === '/') return this.search ? { t: this.search.pat, k: 'c' } : null;
    if (name === '.') return this.lastIns ? { t: this.lastIns, k: 'c' } : null;
    if (name === '*') name = '+';
    return this.regs[name.toLowerCase()] || null;
  }

  // ---- character classes / word motions
  cls(ch, big) { if (ch === undefined || ch === ' ' || ch === '\t') return 0; if (big) return 1; return /[\wÀ-￿]/.test(ch) ? 1 : 2; }
  wordFwd(p, big) {
    let { l, c } = p, line = this.L[l];
    const cl = this.cls(line[c], big);
    if (cl !== 0) while (c < line.length && this.cls(line[c], big) === cl) c++;
    for (;;) {
      if (c >= line.length) { if (l >= this.L.length - 1) return { l, c: line.length, eob: true }; l++; c = 0; line = this.L[l]; if (!line.length) return { l, c: 0 }; continue; }
      if (this.cls(line[c], big) !== 0) return { l, c };
      c++;
    }
  }
  wordBack(p, big) {
    let { l, c } = p, line = this.L[l];
    for (;;) {
      if (c === 0) { if (l === 0) return { l: 0, c: 0 }; l--; line = this.L[l]; c = line.length; if (c === 0) return { l, c: 0 }; }
      c--;
      if (this.cls(line[c], big) !== 0) break;
    }
    const cl = this.cls(line[c], big);
    while (c > 0 && this.cls(line[c - 1], big) === cl) c--;
    return { l, c };
  }
  wordEnd(p, big) {
    let { l, c } = p, line = this.L[l];
    c++;
    for (;;) {
      while (c >= line.length) { if (l >= this.L.length - 1) return { l, c: Math.max(0, line.length - 1) }; l++; line = this.L[l]; c = 0; }
      if (this.cls(line[c], big) !== 0) break;
      c++;
    }
    const cl = this.cls(line[c], big);
    while (c + 1 < line.length && this.cls(line[c + 1], big) === cl) c++;
    return { l, c };
  }
  wordEndBack(p, big) {
    let { l, c } = p, line = this.L[l];
    const cl = this.cls(line[c], big);
    if (cl !== 0) while (c >= 0 && this.cls(line[c], big) === cl) c--; else c--;
    for (;;) {
      while (c < 0) { if (l === 0) return { l: 0, c: 0 }; l--; line = this.L[l]; c = line.length - 1; if (!line.length) return { l, c: 0 }; }
      if (this.cls(line[c], big) !== 0) return { l, c };
      c--;
    }
  }
  // Finds the bracket matching the one at p (or null).
  matchPair(p) {
    const ch = this.L[p.l][p.c];
    const fwd = PAIRS[ch], back = CLOSE[ch];
    if (!fwd && !back) return null;
    let depth = 0, { l, c } = p;
    const open = fwd ? ch : back, close = fwd || ch, dir = fwd ? 1 : -1;
    for (let guard = 0; guard < 200000; guard++) {
      const x = this.L[l][c];
      if (x === open) depth += dir; else if (x === close) depth -= dir;
      if (depth === 0 && (x === open || x === close)) return { l, c };
      c += dir;
      while (c < 0 || c >= this.L[l].length) { l += dir; if (l < 0 || l >= this.L.length) return null; c = dir > 0 ? 0 : this.L[l].length - 1; if (!this.L[l].length) c = dir > 0 ? 0 : -1; }
    }
    return null;
  }
  // Start of the enclosing open bracket (for text objects and [( etc.).
  enclosing(p, open, close) {
    let depth = 0, { l, c } = p;
    if (this.L[l][c] === open) return { l, c };
    if (this.L[l][c] === close) depth = -1;
    for (let guard = 0; guard < 200000; guard++) {
      c--;
      while (c < 0) { l--; if (l < 0) return null; c = this.L[l].length - 1; }
      const x = this.L[l][c];
      if (x === close) depth++;
      else if (x === open) { if (depth === 0) return { l, c }; depth--; }
    }
    return null;
  }

  // ---- motions: returns undefined (not a motion), null (failed) or { l, c, lw, inc, jump, want }
  motion(k, arg, count, hasCount, op) {
    const { l, c } = this.cur, L = this.L, line = L[l], last = L.length - 1;
    const vert = n => { const nl = l + n; if (nl < 0 || nl > last) { if (op || (n < 0 ? l === 0 : l === last)) return null; } const t = Math.max(0, Math.min(last, nl)); return { l: t, c: this.wantCol(t), lw: true, vert: true }; };
    switch (k) {
      case 'h': case LEFT: case '\b': case BS: return c === 0 ? null : { l, c: Math.max(0, c - count) };
      case 'l': case RIGHT: case ' ': { const max = op || this.mode !== 'n' ? line.length : line.length - 1; return c >= max ? (op && line.length ? { l, c: line.length } : null) : { l, c: Math.min(max, c + count) }; }
      case 'j': case DOWN: case C('n'): case C('j'): case 'gj': return vert(count);
      case 'k': case UP: case C('p'): case 'gk': return vert(-count);
      case '+': case CR: { const m = vert(count); return m && { ...m, c: firstNB(L[m.l]), vert: false }; }
      case '-': { const m = vert(-count); return m && { ...m, c: firstNB(L[m.l]), vert: false }; }
      case '_': { const m = count > 1 ? vert(count - 1) : { l, lw: true }; return m && { ...m, c: firstNB(L[m.l]), vert: false }; }
      case '0': case HOME: case 'g0': return { l, c: 0 };
      case '^': case 'g^': return { l, c: firstNB(line) };
      case '$': case END: case 'g$': { const t = Math.min(last, l + count - 1); return { l: t, c: Math.max(0, L[t].length - 1), inc: true, want: Infinity }; }
      case 'g_': { const t = Math.min(last, l + count - 1); return { l: t, c: Math.max(0, L[t].replace(/\s+$/, '').length - 1), inc: true }; }
      case 'gm': return { l, c: Math.min(Math.max(0, line.length - 1), Math.floor(this.w.rect.w / 2)) };
      case '|': return { l, c: Math.min(Math.max(0, line.length - 1), count - 1) };
      case 'w': case 'W': { let p = { l, c }; for (let i = 0; i < count; i++) { const n = this.wordFwd(p, k === 'W'); if (n.eob && !op) { n.c = Math.max(0, n.c - 1); if (n.l === p.l && n.c === p.c) return i ? p : null; } p = n; } return p; }
      case 'b': case 'B': { if (l === 0 && c === 0) return null; let p = { l, c }; for (let i = 0; i < count; i++) p = this.wordBack(p, k === 'B'); return p; }
      case 'e': case 'E': { let p = { l, c }; for (let i = 0; i < count; i++) p = this.wordEnd(p, k === 'E'); return p.l === l && p.c === c ? null : { ...p, inc: true }; }
      case 'ge': case 'gE': { let p = { l, c }; for (let i = 0; i < count; i++) p = this.wordEndBack(p, k === 'gE'); return { ...p, inc: true }; }
      case 'gg': { const t = Math.min(last, hasCount ? count - 1 : 0); return { l: t, c: firstNB(L[t]), lw: true, jump: true }; }
      case 'G': { const t = Math.min(last, hasCount ? count - 1 : last); return { l: t, c: firstNB(L[t]), lw: true, jump: true }; }
      case 'f': case 'F': case 't': case 'T': case ';': case ',': {
        let kind = k, ch = arg;
        if (k === ';' || k === ',') { if (!this.lastF) return null; kind = this.lastF.k; ch = this.lastF.ch; if (k === ',') kind = kind === kind.toLowerCase() ? kind.toUpperCase() : kind.toLowerCase(); }
        else this.lastF = { k, ch };
        const fwd = kind === 'f' || kind === 't', till = kind === 't' || kind === 'T';
        let pos = c;
        for (let i = 0; i < count; i++) {
          let from = pos + (fwd ? 1 : -1);
          if (till && (k === ';' || k === ',') && i === 0) from += fwd ? 1 : -1;   // do not get stuck in front of the same char
          const idx = fwd ? line.indexOf(ch, from) : from < 0 ? -1 : line.lastIndexOf(ch, from);
          if (idx < 0) return null;
          pos = idx;
        }
        if (till) pos += fwd ? -1 : 1;
        return { l, c: pos, inc: fwd };
      }
      case '%': {
        if (hasCount) { const t = Math.min(last, Math.floor((count * L.length + 99) / 100) - 1); return { l: t, c: firstNB(L[t]), lw: true, jump: true }; }
        let i = c;
        while (i < line.length && !PAIRS[line[i]] && !CLOSE[line[i]]) i++;
        if (i >= line.length || line[i] === '<' || line[i] === '>') return null;
        const m = this.matchPair({ l, c: i });
        return m && { ...m, inc: true, jump: true };
      }
      case '[(': case '[{': case '])': case ']}': {
        const open = k[1] === '(' || k[1] === ')' ? '(' : '{', close = PAIRS[open];
        if (k[0] === '[') { let p = { l, c }; for (let i = 0; i < count; i++) { const q = this.enclosing(this.L[p.l][p.c] === open ? this.prev(p) : p, open, close); if (!q) return i ? p : null; p = q; } return p; }
        const s = this.enclosing({ l, c }, open, close), e = s && this.matchPair(s);
        return e ? { ...e, inc: true } : null;
      }
      case '}': { let t = l; for (let i = 0; i < count; i++) { while (t < last && L[t] === '') t++; while (t < last && L[t] !== '') t++; } return t === l && l === last ? null : { l: t, c: t === last && L[t] !== '' ? Math.max(0, L[t].length - (op ? 0 : 1)) : 0, jump: true }; }
      case '{': { let t = l; for (let i = 0; i < count; i++) { while (t > 0 && L[t] === '') t--; while (t > 0 && L[t] !== '') t--; } return t === l && l === 0 ? null : { l: t, c: 0, jump: true }; }
      case ')': case '(': {
        // sentence motions over a flattened view of the buffer
        const starts = [];
        L.forEach((s, li) => { if (s === '') { starts.push({ l: li, c: 0 }); return; } const f = firstNB(s); if (li === 0 || L[li - 1] === '' || /[.!?][)\]"']*$/.test(L[li - 1])) starts.push({ l: li, c: f }); for (const m of s.matchAll(/[.!?][)\]"']*\s+(?=\S)/g)) starts.push({ l: li, c: m.index + m[0].length }); });
        const cmp = (a, b) => a.l - b.l || a.c - b.c;
        let p = { l, c };
        for (let i = 0; i < count; i++) {
          const n = k === ')' ? starts.find(s => cmp(s, p) > 0) : [...starts].reverse().find(s => cmp(s, p) < 0);
          if (!n) { p = k === ')' ? { l: last, c: Math.max(0, L[last].length - 1) } : { l: 0, c: 0 }; break; }
          p = n;
        }
        return { ...p, jump: true };
      }
      case ']]': case '[[': case '][': case '[]': { const ch = k === ']]' || k === '[[' ? '{' : '}', dir = k[0] === ']' ? 1 : -1; let t = l; for (let i = 0; i < count; i++) { do t += dir; while (t > 0 && t < last && L[t][0] !== ch); } t = Math.max(0, Math.min(last, t)); return { l: t, c: 0, jump: true }; }
      case 'H': { const t = Math.min(last, this.w.top + Math.max(count - 1, 0)); return { l: t, c: firstNB(L[t]), lw: true, jump: true }; }
      case 'L': { const t = Math.max(this.w.top, this.botLine() - Math.max(count - 1, 0)); return { l: t, c: firstNB(L[t]), lw: true, jump: true }; }
      case 'M': { const t = Math.floor((this.w.top + this.botLine()) / 2); return { l: t, c: firstNB(L[t]), lw: true, jump: true }; }
      case 'n': case 'N': { if (!this.search) { this.err('E35: No previous regular expression'); return null; } let p = { l, c }; for (let i = 0; i < count; i++) { p = this.find(this.search.pat, p, (k === 'n') === this.search.fwd); if (!p) return null; } return { ...p, jump: true }; }
      case '*': case '#': case 'g*': case 'g#': {
        let s = c;
        while (s < line.length && this.cls(line[s]) !== 1) s++;
        if (s >= line.length) { this.err('E348: No string under cursor'); return null; }
        let a = s, e = s;
        while (a > 0 && this.cls(line[a - 1]) === 1) a--;
        while (e < line.length && this.cls(line[e]) === 1) e++;
        const word = line.slice(a, e).replace(/[\\/.*$^~[\]]/g, '\\$&'), fwd = k.endsWith('*');
        this.search = { pat: k[0] === 'g' ? word : `\\<${word}\\>`, fwd };
        this.hist['/'].push(this.search.pat); this.hlOff = false;
        let p = { l, c: fwd ? c : a };
        for (let i = 0; i < count; i++) { p = this.find(this.search.pat, p, fwd); if (!p) return null; }
        return { ...p, jump: true };
      }
      case "'": case '`': {
        const m = this.getMark(arg);
        if (!m) { this.err('E20: Mark not set'); return null; }
        if (m.buf && m.buf !== this.b) { this.pushJump(); this.w.buf = m.buf; }
        const t = Math.min(this.L.length - 1, m.l);
        return k === "'" ? { l: t, c: firstNB(this.L[t]), lw: true, jump: true } : { l: t, c: Math.min(m.c, Math.max(0, this.L[t].length - 1)), jump: true };
      }
    }
    return undefined;
  }
  prev(p) { if (p.c > 0) return { l: p.l, c: p.c - 1 }; if (p.l === 0) return p; return { l: p.l - 1, c: Math.max(0, this.L[p.l - 1].length - 1) }; }
  wantCol(l) { const len = this.L[l].length, max = this.mode === 'i' || this.mode === 'R' ? len : Math.max(0, len - 1); return Math.min(max, this.w.want); }
  botLine() { const w = this.w; let rows = 0, l = w.top; while (l < this.L.length) { rows += this.rowsOf(w, l); if (rows > w.rect.h) break; l++; } return Math.max(w.top, l - 1); }
  getMark(ch) {
    const b = this.b;
    if (ch === "'" || ch === '`') return b.marks["'"] || { l: 0, c: 0 };
    if (/[A-Z]/.test(ch)) return this.gmarks?.[ch] || null;
    if (ch === '[' || ch === ']' || ch === '<' || ch === '>' || ch === '.' || ch === '^' || ch === '"' || /[a-z]/.test(ch)) return b.marks[ch] || null;
    return null;
  }
  pushJump() {
    const j = { buf: this.b, l: this.cur.l, c: this.cur.c };
    this.b.marks["'"] = { l: j.l, c: j.c };
    this.jumps = this.jumps.filter(x => !(x.buf === j.buf && x.l === j.l));
    this.jumps.push(j);
    if (this.jumps.length > 100) this.jumps.shift();
    this.jidx = this.jumps.length;
  }
  moveTo(m) {
    if (m.jump) this.pushJump();
    this.cur.l = m.l; this.cur.c = m.c;
    if (!m.vert) this.w.want = m.want ?? m.c;
  }
  fix() {
    const w = this.w, cur = w.cur, n = w.buf.lines.length;
    cur.l = Math.max(0, Math.min(n - 1, cur.l));
    const len = w.buf.lines[cur.l].length, max = this.mode === 'i' || this.mode === 'R' ? len : Math.max(0, len - 1);
    cur.c = Math.max(0, Math.min(max, cur.c));
  }

  // ---- text objects: returns { s, e (exclusive), lw }
  textObj(kind, ch, count) {
    const { l, c } = this.cur, L = this.L, line = L[l];
    const inner = kind === 'i';
    if (ch === 'w' || ch === 'W') {
      const big = ch === 'W';
      if (!line.length) return { s: { l, c: 0 }, e: { l, c: 0 } };
      let a = c, e = c;
      const cl = this.cls(line[c], big);
      while (a > 0 && this.cls(line[a - 1], big) === cl) a--;
      for (let i = 0; i < count; i++) {
        const k = this.cls(line[e], big);
        while (e < line.length && this.cls(line[e], big) === k) e++;
        if (!inner && i === count - 1) {
          if (k !== 0) { const t = e; while (e < line.length && this.cls(line[e], big) === 0) e++; if (e === t) while (a > 0 && this.cls(line[a - 1], big) === 0) a--; }
          else { const k2 = this.cls(line[e], big); while (e < line.length && this.cls(line[e], big) === k2) e++; }
        } else if (!inner && k !== 0) { while (e < line.length && this.cls(line[e], big) === 0) e++; }
        if (e >= line.length) break;
      }
      return { s: { l, c: a }, e: { l, c: e } };
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const idx = [];
      for (let i = 0; i < line.length; i++) { if (line[i] === '\\') { i++; continue; } if (line[i] === ch) idx.push(i); }
      let a = -1, e = -1;
      for (let i = 0; i + 1 < idx.length; i += 2) if (c >= idx[i] && c <= idx[i + 1]) { a = idx[i]; e = idx[i + 1]; break; }
      if (a < 0) for (let i = 0; i + 1 < idx.length; i += 2) if (idx[i] > c) { a = idx[i]; e = idx[i + 1]; break; }
      if (a < 0) return null;
      if (inner) return { s: { l, c: a + 1 }, e: { l, c: e } };
      let end = e + 1; const t = end;
      while (end < line.length && /\s/.test(line[end])) end++;
      if (end === t) while (a > 0 && /\s/.test(line[a - 1])) a--;
      return { s: { l, c: a }, e: { l, c: end } };
    }
    const BR = { '(': '()', ')': '()', b: '()', '{': '{}', '}': '{}', B: '{}', '[': '[]', ']': '[]', '<': '<>', '>': '<>' }[ch];
    if (BR) {
      let s = { l, c };
      for (let i = 0; i < count; i++) { s = this.enclosing(i ? this.prev(s) : s, BR[0], BR[1]); if (!s) return null; }
      const e = this.matchPair(s);
      if (!e) return null;
      if (!inner) return { s, e: { l: e.l, c: e.c + 1 } };
      // "i{" spanning whole lines works linewise, like Vim
      if (e.l > s.l && s.c === L[s.l].length - 1 && /^\s*$/.test(L[e.l].slice(0, e.c))) return e.l - s.l < 2 ? { s: { l: s.l, c: s.c + 1 }, e: { l: s.l, c: s.c + 1 } } : { s: { l: s.l + 1, c: 0 }, e: { l: e.l - 1, c: 0 }, lw: true };
      return { s: { l: s.l, c: s.c + 1 }, e };
    }
    if (ch === 'p') {
      const blank = x => /^\s*$/.test(L[x]);
      let a = l, e = l;
      const kindB = blank(l);
      while (a > 0 && blank(a - 1) === kindB) a--;
      for (let i = 0; i < count; i++) {
        const kb = blank(e);
        while (e < L.length - 1 && blank(e + 1) === kb) e++;
        if (!inner && e < L.length - 1) { e++; const k2 = blank(e); while (e < L.length - 1 && blank(e + 1) === k2) e++; }
        if (i < count - 1 && e < L.length - 1) e++;
      }
      return { s: { l: a, c: 0 }, e: { l: e, c: 0 }, lw: true };
    }
    if (ch === 's') {
      const m = [...line.matchAll(/[^.!?]*[.!?]*\s*/g)].filter(x => x[0]);
      const hit = m.find(x => c >= x.index && c < x.index + x[0].length);
      if (!hit) return { s: { l, c: 0 }, e: { l, c: line.length } };
      return { s: { l, c: hit.index }, e: { l, c: hit.index + (inner ? hit[0].replace(/\s+$/, '').length : hit[0].length) } };
    }
    if (ch === 't') {
      const text = L.join('\n'), offs = [];
      let o = 0; for (const s of L) { offs.push(o); o += s.length + 1; }
      const at = offs[l] + c, stack = [];
      let best = null;
      for (const m of text.matchAll(/<(\/?)([A-Za-z][\w:-]*)(?:"[^"]*"|'[^']*'|[^>"'])*?(\/?)>/g)) {
        if (m[3]) continue;
        if (!m[1]) stack.push(m);
        else { let k = stack.length - 1; while (k >= 0 && stack[k][2] !== m[2]) k--; if (k < 0) continue; const open = stack[k]; stack.length = k; if (open.index <= at && at < m.index + m[0].length && (!best || open.index > best[0].index)) best = [open, m]; }
      }
      if (!best) return null;
      const pos = x => { let li = offs.findLastIndex(v => v <= x); return { l: li, c: x - offs[li] }; };
      return inner ? { s: pos(best[0].index + best[0][0].length), e: pos(best[1].index) } : { s: pos(best[0].index), e: pos(best[1].index + best[1][0].length) };
    }
    return undefined;
  }

  // ---- key input
  key(ev) {
    if (this.dead) return true;
    const k = keyOf(ev);
    if (k === null) return false;
    this.typed(k);
    return true;
  }
  typed(k) {
    if (this.recording != null) this.macro += k;
    const mode = this.pager ? null : this.mode === 'i' || this.mode === 'R' ? 'i' : this.mode === 'c' ? 'c' : this.mode === 'n' ? (this.pend ? null : 'n') : 'v';
    const maps = mode && this.maps[mode];
    if (maps && Object.keys(maps).length) {
      this.mapBuf += k;
      clearTimeout(this.mapT);
      const buf = this.mapBuf;
      if (Object.keys(maps).some(l => l.length > buf.length && l.startsWith(buf))) { this.mapT = setTimeout(() => this.flushMap(maps), this.o.tm); return; }
      this.flushMap(maps);
      return;
    }
    this.feed(k);
  }
  flushMap(maps) {
    let s = this.mapBuf;
    this.mapBuf = '';
    while (s) {
      const hit = Object.keys(maps).filter(l => s.startsWith(l)).sort((a, b) => b.length - a.length)[0];
      if (hit) { this.feed(maps[hit], true); s = s.slice(hit.length); } else { this.feed(s[0], true); s = s.slice(1); }
    }
    this.render();
  }
  feed(keys, quiet) {
    for (const k of keys) { if (this.dead) return; this.handle(k); }
    if (!quiet && !this.dead) this.render();
  }
  handle(k) {
    if (this.busy) { this.queue.push(k); return; }
    if (this.pager) return this.pagerKey(k);
    if (this.asking) { this.asking(k); if (!this.asking) this.ug = false; this.fix(); return; }
    if (k === WUP || k === WDN) { this.scrollLines(k === WUP ? -3 : 3); return; }
    this.failed = false;
    this.rec += k;
    if (this.mode === 'i' || this.mode === 'R') this.insertKey(k);
    else if (this.mode === 'c') this.cmdKey(k);
    else this.normalKey(k);
    if (this.dead) return;
    if (this.exDepth) { this.fix(); return; }   // nested via :normal / :g — the outer command owns undo grouping
    // command boundary: back in normal mode with nothing pending
    if (this.mode === 'n' && !this.pend) {
      if (this.changed && this.rec && !this.dotting && !/^[:u.\x12]/.test(this.rec) && !/^(".)?\d*[@q]/.test(this.rec)) this.dot = this.rec;
      if (this.oneShot) { const st = this.oneShot; if (!st.armed) st.armed = true; else { this.oneShot = null; this.mode = st.mode; this.ins = st.ins; this.fix(); this.rec = ''; this.changed = false; return; } }
      this.rec = ''; this.changed = false; this.ug = false;
    } else if (this.mode !== 'i' && this.mode !== 'R' && this.mode !== 'c' && !this.pend) { this.ug = false; }
    this.fix();
  }

  // ---- normal / visual command parsing
  parse(vis) {
    const s = this.pend;
    let i = 0, reg = null, c1 = '';
    while (s[i] === '"') { if (i + 1 >= s.length) return INC; reg = s[i + 1]; i += 2; }
    while (i < s.length && /\d/.test(s[i]) && !(c1 === '' && s[i] === '0')) c1 += s[i++];
    if (i >= s.length) return INC;
    let k = s[i++];
    if ('gzZ[]'.includes(k) || k === C('w')) { if (i >= s.length) return INC; k += s[i++]; }
    const cmd = { reg, count: c1 ? +c1 : null, key: k };
    const needArg = key => 'fFtT\'`'.includes(key) && key.length === 1;
    if (OPS.has(k) && !vis) {
      let c2 = '';
      while (i < s.length && /\d/.test(s[i]) && !(c2 === '' && s[i] === '0')) c2 += s[i++];
      if (i >= s.length) return INC;
      let m = s[i++];
      if ('gz[]'.includes(m) && !(k.length === 2 && m === k[1])) { if (i >= s.length) return INC; m += s[i++]; }
      cmd.op = k; cmd.motion = m;
      if (c2) cmd.count = (cmd.count ?? 1) * +c2;
      if (m === k || (k.length === 2 && (m === k[1] || m === k))) cmd.same = true;
      else if (needArg(m) || m === 'i' || m === 'a') { if (i >= s.length) return INC; cmd.arg = s[i++]; }
      return cmd;
    }
    if (needArg(k) || 'rm@'.includes(k) || (k === 'q' && this.recording == null) || (vis && (k === 'i' || k === 'a'))) { if (i >= s.length) return INC; cmd.arg = s[i++]; }
    return cmd;
  }
  normalKey(k) {
    if (k === ESC || k === C('c')) {
      if (this.mode !== 'n') this.exitVisual(); else if (!this.pend) this.bell();
      this.pend = ''; return;
    }
    this.pend += k;
    const vis = this.mode !== 'n';
    const cmd = this.parse(vis);
    if (cmd === INC) return;
    this.pend = '';
    if (this.message && !this.message.keep) this.message = null;
    if (vis) this.visualCmd(cmd); else if (cmd.op) this.execOp(cmd); else this.normalCmd(cmd);
  }

  normalCmd(cmd) {
    const count = cmd.count ?? 1, has = cmd.count != null, k = cmd.key, { cur } = this;
    const mv = this.motion(k, cmd.arg, count, has, false);
    if (mv !== undefined) { if (mv) this.moveTo(mv); else this.bell(); return; }
    const op = (o, m, extra = {}) => this.execOp({ op: o, motion: m, count: cmd.count, reg: cmd.reg, ...extra });
    switch (k) {
      case 'i': case 'a': case 'I': case 'A': case 'o': case 'O': case 'gI': case 'gi': case INS: return this.startInsert(k === INS ? 'i' : k, count);
      case 'x': case DEL: return this.line.length ? op('d', 'l') : this.bell();
      case 'X': return cur.c ? op('d', 'h') : this.bell();
      case 'D': return op('d', '$');
      case 'C': return op('c', '$');
      case 's': return this.line.length ? op('c', 'l') : this.startInsert('i', 1);
      case 'S': return op('c', 'c', { same: true });
      case 'Y': return op('y', 'y', { same: true });
      case 'r': {
        if (cur.c + count > this.line.length) return this.bell();
        const ch = cmd.arg === CR ? '\n' : cmd.arg;
        if (ch === ESC) return;
        if (ch === '\n') { this.deleteRange(cur, { l: cur.l, c: cur.c + count }); const p = this.insertText(cur.l, cur.c, '\n'); this.setLine(p.l, this.L[p.l].replace(/^\s*/, indentOf(this.L[cur.l]))); cur.l = p.l; cur.c = firstNB(this.L[p.l]); return; }
        this.setLine(cur.l, this.line.slice(0, cur.c) + ch.repeat(count) + this.line.slice(cur.c + count));
        cur.c += count - 1; return;
      }
      case 'R': return this.startInsert('R', count);
      case 'J': case 'gJ': return this.join(cur.l, Math.min(this.L.length - 1, cur.l + Math.max(1, count - 1)), k === 'J');
      case '~': {
        if (!this.line.length) return this.bell();
        const n = Math.min(count, this.line.length - cur.c), seg = this.line.substr(cur.c, n);
        this.setLine(cur.l, this.line.slice(0, cur.c) + [...seg].map(ch => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase())).join('') + this.line.slice(cur.c + n));
        cur.c = Math.min(this.line.length - 1, cur.c + n); return;
      }
      case 'p': case 'P': case 'gp': case 'gP': case ']p': case '[p': return this.put(cmd.reg, k.endsWith('p') && k !== '[p', count, k[0] === 'g');
      case 'u': return this.undo(count);
      case C('r'): return this.redo(count);
      case 'U': return this.undo(1);
      case '.': {
        if (!this.dot) return this.bell();
        let keys = this.dot;
        if (has) keys = keys.replace(/^((?:".)*)\d*/, `$1${count}`);
        const saveRec = this.rec;
        this.dotting = true; this.rec = '';
        for (const ch of keys) this.handle(ch);
        this.dotting = false; this.rec = saveRec; this.changed = false;
        return;
      }
      case 'v': case 'V': case C('v'): this.intro = false; this.vis = { l: cur.l, c: cur.c }; this.mode = k; return;
      case 'gv': { const lv = this.b.lastVis; if (!lv) return this.bell(); this.mode = lv.mode; this.vis = { ...lv.a }; cur.l = lv.b.l; cur.c = lv.b.c; return; }
      case ':': return this.openCmd(':', has ? (count === 1 ? '.' : `.,.+${count - 1}`) : '');
      case '/': case '?': return this.openCmd(k, '');
      case 'm': {
        if (!/[a-zA-Z'`[\]<>]/.test(cmd.arg)) return this.bell();
        if (/[A-Z]/.test(cmd.arg)) (this.gmarks ||= {})[cmd.arg] = { l: cur.l, c: cur.c, buf: this.b }; else this.b.marks[cmd.arg === '`' ? "'" : cmd.arg] = { l: cur.l, c: cur.c };
        return;
      }
      case 'q': {
        if (this.recording != null) { const r = this.recording; this.recording = null; this.setRegRaw(r, this.macro.slice(0, -1)); return; }
        if (!/[a-zA-Z0-9"]/.test(cmd.arg)) return this.bell();
        this.recording = cmd.arg; this.macro = ''; return;
      }
      case '@': {
        let r = cmd.arg;
        if (r === '@') r = this.lastMacro;
        if (r === ':') { if (!this.lastEx) return this.err('E30: No previous command line'); for (let i = 0; i < count; i++) this.ex(this.lastEx); return; }
        const reg = r && this.getReg(r);
        if (!reg) return this.bell();
        this.lastMacro = r;
        const keys = reg.t + (reg.k === 'l' ? '\r' : '');
        if ((this.macroDepth || 0) > 50) return this.err('E132: Function call depth is higher than \'maxfuncdepth\'');
        this.macroDepth = (this.macroDepth || 0) + 1;
        const saveRec = this.rec; this.rec = '';
        outer: for (let i = 0; i < count; i++) for (const ch of keys) { this.handle(ch); if (this.failed || this.dead) break outer; }
        this.macroDepth--; this.rec = saveRec;
        return;
      }
      case C('a'): case C('x'): return this.increment(k === C('a') ? count : -count);
      case C('d'): case C('u'): { const n = has ? (this.scr = count) : this.scr || Math.max(1, Math.floor(this.w.rect.h / 2)); const d = k === C('d') ? n : -n; if ((d > 0 && cur.l >= this.L.length - 1) || (d < 0 && cur.l === 0)) return this.bell(); this.w.top = Math.max(0, Math.min(this.L.length - 1, this.w.top + d)); cur.l = Math.max(0, Math.min(this.L.length - 1, cur.l + d)); cur.c = firstNB(this.line); return; }
      case C('f'): case PGDN: case C('b'): case PGUP: {
        const h = Math.max(1, this.w.rect.h - 2), down = k === C('f') || k === PGDN;
        if (down ? this.w.top >= this.L.length - 1 : this.w.top === 0) return this.bell();
        this.w.top = Math.max(0, Math.min(this.L.length - 1, this.w.top + (down ? h : -h) * count));
        cur.l = down ? Math.max(cur.l, this.w.top) : Math.min(cur.l, this.w.top + this.w.rect.h - 1);
        this.noSo = true; cur.c = firstNB(this.L[Math.min(cur.l, this.L.length - 1)]); return;
      }
      case C('e'): return this.scrollLines(count);
      case C('y'): return this.scrollLines(-count);
      case 'zt': case 'z' + CR: case 'zz': case 'z.': case 'zb': case 'z-': {
        if (has) cur.l = Math.min(this.L.length - 1, count - 1);
        const h = this.w.rect.h;
        this.w.top = Math.max(0, k === 'zt' || k === 'z' + CR ? cur.l : k === 'zz' || k === 'z.' ? cur.l - Math.floor(h / 2) : cur.l - h + 1);
        this.noSo = true;
        if (k.length === 2 && !/[tzb]/.test(k[1])) cur.c = firstNB(this.line);
        return;
      }
      case 'zo': case 'zc': case 'za': case 'zR': case 'zM': case 'zO': case 'zC': return this.err('E490: No fold found');
      case C('g'): return this.fileInfo();
      case C('l'): this.message = null; return;
      case C('^'): return this.ex('b#');
      case C('o'): case TAB: {
        const dir = k === TAB ? 1 : -1;
        if (dir < 0 && this.jidx >= this.jumps.length) { const at = this.jumps.length; this.pushJump(); this.jidx = Math.min(at, this.jumps.length - 1); }
        const n = this.jidx + dir * count;
        if (n < 0 || n >= this.jumps.length) return this.bell();
        this.jidx = n;
        const j = this.jumps[n];
        if (j.buf !== this.b) { if (!this.bufs.includes(j.buf)) return this.bell(); this.w.buf = j.buf; }
        cur.l = Math.min(this.L.length - 1, j.l); cur.c = j.c; return;
      }
      case C(']'): return this.err('E433: No tags file');
      case 'ZZ': return this.ex('x');
      case 'ZQ': return this.ex('q!');
      case '&': return this.ex('s');
      case 'g&': return this.ex('%s//~/&');
      case 'ga': { const ch = this.line[cur.c]; if (ch === undefined) return this.msg('NUL'); const n = ch.codePointAt(0); return this.msg(`<${ch}>  ${n},  Hex ${n.toString(16).padStart(2, '0')},  Oct ${n.toString(8).padStart(3, '0')}`); }
      case 'gf': { const m = /[\w./~+-]*$/.exec(this.line.slice(0, cur.c))[0] + /^[\w./~+-]*/.exec(this.line.slice(cur.c))[0]; if (!m) return this.bell(); const p = m.replace(/^~/, this.io.home || '~'); if (!this.fs.exists(this.fs.abs(p, this.cwd))) return this.err(`E447: Can't find file "${m}" in path`); return this.ex('e ' + p); }
      case 'gd': case 'gD': {
        const m = /\w*$/.exec(this.line.slice(0, cur.c))[0] + /^\w*/.exec(this.line.slice(cur.c))[0];
        if (!m) return this.bell();
        this.search = { pat: `\\<${m}\\>`, fwd: true }; this.hlOff = false;
        const p = this.find(this.search.pat, { l: 0, c: -1 }, true, true);
        if (p) this.moveTo({ ...p, jump: true });
        return;
      }
      case 'K': return this.msg(`"man ${/\w*$/.exec(this.line.slice(0, cur.c))[0] + /^\w*/.exec(this.line.slice(cur.c))[0]}" — close Vim and run it in the shell`);
      case F1: return this.ex('help');
      case C('z'): return this.msg("Job control isn't available here — use :sh or :!cmd");
      case 'Q': case 'gQ': return this.msg("Entering Ex mode is not supported; use ':' for commands");
      case 'g8': case 'g?': case 'gs': case 'gt': case 'gT': case 'g<': return;
    }
    if (k[0] === C('w')) return this.winCmd(k[1], count, has);
    this.bell();
  }
  setRegRaw(name, text) { if (/[A-Z]/.test(name)) { const low = name.toLowerCase(); this.regs[low] = { t: (this.regs[low]?.t || '') + text, k: 'c' }; } else this.regs[name] = { t: text, k: 'c' }; }
  scrollLines(n) {
    const w = this.w, max = this.L.length - 1;
    w.top = Math.max(0, Math.min(max, w.top + n));
    this.noSo = true;
    if (this.cur.l < w.top) { this.cur.l = w.top; this.cur.c = this.wantCol(w.top); }
    const bot = this.botLine();
    if (this.cur.l > bot) { this.cur.l = bot; this.cur.c = this.wantCol(bot); }
  }
  fileInfo() {
    const b = this.b, l = this.cur.l + 1, n = b.lines.length;
    this.msg(`"${b.name || '[No Name]'}"${b.mod ? ' [Modified]' : ''}${b.ro ? ' [readonly]' : ''} ${b.lines.length === 1 && !b.lines[0] ? '--No lines in buffer--' : `${n} line${n === 1 ? '' : 's'} --${Math.floor((l * 100) / n)}%--`}`);
  }
  join(l1, l2, spaces) {
    if (l1 >= this.L.length - 1) return this.bell();
    let s = this.L[l1], col = s.length;
    for (let l = l1 + 1; l <= l2; l++) {
      let nx = this.L[l];
      if (spaces) {
        nx = nx.replace(/^\s+/, '');
        s = s.replace(/\s+$/, m => (nx ? m : ''));
        col = s.length;
        if (nx && s && !/\s$/.test(s) && nx[0] !== ')') { s += ' '; }
        else if (nx && s && /\s$/.test(s)) col = s.length - 1;
      } else col = s.length;
      s += nx;
    }
    this.touch();
    this.b.lines.splice(l1, l2 - l1 + 1, s);
    this.shiftMarks(l1 + 1, l1 - l2);
    this.cur.l = l1; this.cur.c = Math.min(col, Math.max(0, s.length - 1));
  }
  increment(delta) {
    const line = this.line, re = /-?\d+/g;
    let m;
    while ((m = re.exec(line))) {
      if (m.index + m[0].length > this.cur.c) {
        let text = m[0], idx = m.index;
        if (text[0] === '-' && idx > 0 && /\w/.test(line[idx - 1])) { text = text.slice(1); idx++; }
        const v = String(parseInt(text, 10) + delta);
        const out = /^-?0\d/.test(text) && !v.startsWith('-') ? v.padStart(text.replace('-', '').length, '0') : v;
        this.setLine(this.cur.l, line.slice(0, idx) + out + line.slice(idx + text.length));
        this.cur.c = idx + out.length - 1; return;
      }
    }
    this.bell();
  }

  // ---- operators
  execOp(cmd) {
    const count = cmd.count ?? 1, has = cmd.count != null, { cur } = this, L = this.L;
    let r;
    if (cmd.same) {
      if (cur.l + count - 1 > L.length - 1 && count > 1 && cur.l === L.length - 1) return this.bell();
      r = { s: { l: cur.l, c: 0 }, e: { l: Math.min(L.length - 1, cur.l + count - 1), c: 0 }, lw: true };
    } else if (cmd.motion === 'i' || cmd.motion === 'a') {
      r = this.textObj(cmd.motion, cmd.arg, count);
      if (!r) return this.bell();
    } else if ((cmd.motion === '/' || cmd.motion === '?') && !cmd.target) {
      this.opPending = cmd; return this.openCmd(cmd.motion, '');
    } else {
      let m = cmd.motion;
      if (cmd.op === 'c' && (m === 'w' || m === 'W') && this.cls(this.line[cur.c]) !== 0) m = m === 'w' ? 'e' : 'E';
      const from = { l: cur.l, c: cur.c };
      const mv = cmd.target || this.motion(m, cmd.arg, count, has, true);
      if (!mv) return this.bell();
      r = this.motionRange(from, mv, m);
    }
    this.applyOp(cmd.op, r, cmd.reg, count);
    if (this.mode === 'n') this.w.want = this.cur.c;
  }
  motionRange(from, mv, m) {
    let s = from, e = { l: mv.l, c: mv.c };
    if (e.l < s.l || (e.l === s.l && e.c < s.c)) [s, e] = [e, s];
    if (mv.lw) return { s: { l: s.l, c: 0 }, e: { l: e.l, c: 0 }, lw: true };
    if (mv.inc) e = { l: e.l, c: Math.min(this.L[e.l].length, e.c + 1) };
    else if (e.c === 0 && e.l > s.l && !'`'.includes(m)) {
      // ":help exclusive": back up to the previous line end, or go linewise
      if (s.c <= indentOf(this.L[s.l]).length && m !== 'w' && m !== 'W') return { s: { l: s.l, c: 0 }, e: { l: e.l - 1, c: 0 }, lw: true };
      e = { l: e.l - 1, c: this.L[e.l - 1].length };
    }
    return { s, e };
  }
  applyOp(op, r, reg, count = 1) {
    const { s, e, lw } = r, { cur } = this, L = this.L, nl = e.l - s.l + 1;
    const text = () => (lw ? L.slice(s.l, e.l + 1).join('\n') : this.getRange(s, e));
    this.b.marks['['] = { l: s.l, c: lw ? 0 : s.c }; this.b.marks[']'] = { l: e.l, c: lw ? Math.max(0, L[e.l].length - 1) : Math.max(0, e.c - 1) };
    switch (op) {
      case 'y':
        this.setReg(reg, text(), lw ? 'l' : 'c', false);
        if (lw) { if (s.l !== cur.l) { cur.l = s.l; cur.c = Math.min(cur.c, Math.max(0, L[s.l].length - 1)); } } else { cur.l = s.l; cur.c = s.c; }
        if (nl > 2) this.msg(`${nl} lines yanked`);
        return;
      case 'd':
        if (!lw && s.l === e.l && s.c === e.c) return;
        this.setReg(reg, text(), lw ? 'l' : 'c', true);
        if (lw) { this.deleteLines(s.l, e.l); cur.l = Math.min(s.l, this.L.length - 1); cur.c = firstNB(this.L[cur.l]); if (nl > 2) this.msg(`${nl} fewer lines`); }
        else { this.deleteRange(s, e); cur.l = s.l; cur.c = s.c; if (nl > 3) this.msg(`${nl - 1} fewer lines`); }
        this.w.want = cur.c;
        return;
      case 'c':
        this.setReg(reg, text(), lw ? 'l' : 'c', true);
        if (lw) { const ind = this.o.ai ? indentOf(L[s.l]) : ''; this.touch(); this.b.lines.splice(s.l, nl, ind); this.shiftMarks(s.l + 1, 1 - nl); cur.l = s.l; cur.c = ind.length; }
        else { if (!(s.l === e.l && s.c === e.c)) this.deleteRange(s, e); else this.touch(); cur.l = s.l; cur.c = s.c; }
        return this.startInsert('c', 1);
      case '<': case '>':
        for (let l = s.l; l <= e.l; l++) this.shiftLine(l, op === '>' ? count : -count, true);
        cur.l = s.l; cur.c = firstNB(this.L[s.l]);
        if (nl > 2) this.msg(`${nl} lines ${op}ed ${count} time${count > 1 ? 's' : ''}`);
        return;
      case '=': this.reindent(s.l, e.l); cur.l = s.l; cur.c = firstNB(this.L[s.l]); if (nl > 2) this.msg(`${nl} lines indented `); return;
      case 'g~': case 'gu': case 'gU': case 'g?': {
        const f = op === 'gu' ? x => x.toLowerCase() : op === 'gU' ? x => x.toUpperCase() : op === 'g?' ? rot13 : x => [...x].map(ch => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase())).join('');
        if (lw) for (let l = s.l; l <= e.l; l++) this.setLine(l, f(L[l]));
        else { const t = f(this.getRange(s, e)); this.deleteRange(s, e); this.insertText(s.l, s.c, t); }
        cur.l = s.l; cur.c = lw ? cur.c : s.c;
        return;
      }
      case 'gq': case 'gw': {
        const tw = this.o.tw || 79, out = [];
        let para = [];
        const flush = () => { if (!para.length) return; const ind = indentOf(para[0]); let line = ''; for (const w of para.join(' ').split(/\s+/).filter(Boolean)) { if (line && (ind + line + ' ' + w).length > tw) { out.push(ind + line); line = w; } else line = line ? line + ' ' + w : w; } if (line) out.push(ind + line); para = []; };
        for (let l = s.l; l <= e.l; l++) { if (/^\s*$/.test(L[l])) { flush(); out.push(''); } else para.push(L[l]); }
        flush();
        this.touch(); this.b.lines.splice(s.l, nl, ...out); this.shiftMarks(s.l + 1, out.length - nl);
        cur.l = Math.min(this.L.length - 1, s.l + out.length - 1); cur.c = firstNB(this.L[cur.l]);
        return;
      }
      case '!': return this.openCmd(':', (s.l === e.l ? '.' : `.,.+${e.l - s.l}`) + '!');
    }
  }
  shiftLine(l, n, round) {
    const line = this.L[l];
    if (!line && n > 0) return;
    const sw = this.o.sw || this.o.ts, ts = this.o.ts;
    let w = 0;
    for (const ch of indentOf(line)) w = ch === '\t' ? w + ts - (w % ts) : w + 1;
    const nw = Math.max(0, round ? (n > 0 ? Math.floor(w / sw) + n : Math.ceil(w / sw) + n) * sw : w + n * sw);
    this.setLine(l, (this.o.et ? ' '.repeat(nw) : '\t'.repeat(Math.floor(nw / ts)) + ' '.repeat(nw % ts)) + line.slice(indentOf(line).length));
  }
  reindent(l1, l2) {
    if (!['c', 'cpp', 'javascript', 'java', 'json', 'css', 'php', 'go', 'rust'].includes(this.b.ft)) return;
    const sw = this.o.sw || this.o.ts;
    let depth = 0;
    const strip = s => s.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '').replace(/\/\/.*$/, '');
    for (let l = 0; l < l1; l++) { const s = strip(this.L[l]); depth += (s.match(/[{[(]/g) || []).length - (s.match(/[}\])]/g) || []).length; }
    for (let l = l1; l <= l2; l++) {
      const raw = this.L[l].trim(), s = strip(raw);
      const lead = (/^[}\])]+/.exec(s) || [''])[0].length;
      const d = Math.max(0, depth - lead) - (/^(case\b.*|default\s*):/.test(raw) ? 1 : 0);
      const w = Math.max(0, d) * sw;
      const ind = raw ? (this.o.et ? ' '.repeat(w) : '\t'.repeat(Math.floor(w / this.o.ts)) + ' '.repeat(w % this.o.ts)) : '';
      if (ind + raw !== this.L[l]) this.setLine(l, ind + raw);
      depth += (s.match(/[{[(]/g) || []).length - (s.match(/[}\])]/g) || []).length;
    }
  }

  put(regName, after, count, gmove) {
    if (regName === '+' || regName === '*') {
      if (this.io.clipRead) {
        this.busy = true;
        this.io.clipRead().then(t => { if (typeof t === 'string' && t) this.regs['+'] = t.endsWith('\n') && t.indexOf('\n') === t.length - 1 ? { t: t.slice(0, -1), k: 'l' } : { t, k: 'c' }; }).catch(() => {}).finally(() => { this.busy = false; this.doPut('+', after, count, gmove); this.ug = false; this.drain(); });
        return;
      }
    }
    this.doPut(regName, after, count, gmove);
  }
  drain() { const q = this.queue; this.queue = []; for (const k of q) this.handle(k); this.fix(); this.render(); }
  doPut(regName, after, count, gmove) {
    const r = this.getReg(regName);
    if (!r) return this.err(`E353: Nothing in register ${regName || '"'}`);
    const { cur } = this;
    if (r.k === 'l') {
      const ls = [];
      for (let i = 0; i < count; i++) ls.push(...r.t.split('\n'));
      const at = after ? cur.l + 1 : cur.l;
      this.insertLines(at, ls);
      this.b.marks['['] = { l: at, c: 0 }; this.b.marks[']'] = { l: at + ls.length - 1, c: 0 };
      cur.l = gmove ? Math.min(this.L.length - 1, at + ls.length) : at; cur.c = gmove ? 0 : firstNB(this.L[cur.l]);
      if (ls.length > 2) this.msg(`${ls.length} more lines`);
    } else if (r.k === 'b') {
      const rows = r.t.split('\n'), col = after && this.line.length ? cur.c + 1 : cur.c, w = Math.max(...rows.map(x => x.length));
      rows.forEach((seg, i) => {
        const l = cur.l + i;
        if (l >= this.L.length) this.insertLines(l, ['']);
        const line = this.L[l].padEnd(col);
        this.setLine(l, line.slice(0, col) + (line.length > col ? seg.padEnd(w) : seg) + line.slice(col));
      });
      cur.c = col;
    } else {
      const text = r.t.repeat(count), c = after && this.line.length ? cur.c + 1 : cur.c;
      const end = this.insertText(cur.l, c, text);
      this.b.marks['['] = { l: cur.l, c }; this.b.marks[']'] = { l: end.l, c: Math.max(0, end.c - 1) };
      if (gmove) { cur.l = end.l; cur.c = end.c; } else if (text.includes('\n')) cur.c = c; else cur.c = Math.max(0, end.c - 1);
      const n = text.split('\n').length - 1;
      if (n > 2) this.msg(`${n} more lines`);
    }
    this.w.want = cur.c;
  }

  // ---- visual mode
  visRange() {
    const a = this.vis, b = this.cur;
    let s = a, e = b;
    if (e.l < s.l || (e.l === s.l && e.c < s.c)) [s, e] = [e, s];
    if (this.mode === 'V') return { s: { l: s.l, c: 0 }, e: { l: e.l, c: 0 }, lw: true };
    if (this.mode === C('v')) return { block: true, l1: s.l, l2: e.l, c1: Math.min(a.c, b.c), c2: b.c === Infinity || this.w.want === Infinity ? Infinity : Math.max(a.c, b.c) };
    return { s: { l: s.l, c: s.c }, e: { l: e.l, c: Math.min(this.L[e.l].length, e.c + 1) } };
  }
  exitVisual() {
    if (this.mode === 'n') return;
    const r = this.visRange();
    this.b.lastVis = { mode: this.mode, a: { ...this.vis }, b: { ...this.cur } };
    if (r.block) { this.b.marks['<'] = { l: r.l1, c: r.c1 }; this.b.marks['>'] = { l: r.l2, c: r.c2 === Infinity ? 1e9 : r.c2 }; }
    else { this.b.marks['<'] = { ...r.s }; this.b.marks['>'] = { l: r.e.l, c: r.lw ? 1e9 : Math.max(0, r.e.c - 1) }; }
    this.mode = 'n'; this.vis = null;
  }
  visualCmd(cmd) {
    const count = cmd.count ?? 1, has = cmd.count != null, { cur } = this;
    let k = cmd.key;
    if (k === 'i' || k === 'a') {
      const r = this.textObj(k, cmd.arg, count);
      if (!r) return this.bell();
      if (r.lw) { if (this.mode === 'v') this.mode = 'V'; this.vis = { l: r.s.l, c: 0 }; cur.l = r.e.l; cur.c = 0; }
      else { const same = this.vis.l === cur.l && this.vis.c === cur.c; if (same || r.s.l < this.vis.l || (r.s.l === this.vis.l && r.s.c < this.vis.c)) this.vis = { ...r.s }; const e = r.e.c > 0 ? { l: r.e.l, c: r.e.c - 1 } : r.e; cur.l = e.l; cur.c = e.c; }
      return;
    }
    const mv = this.motion(k, cmd.arg, count, has, false);
    if (mv !== undefined) { if (mv) this.moveTo(mv); else this.bell(); return; }
    if (k === this.mode) return this.exitVisual();
    if (k === 'v' || k === 'V' || k === C('v')) { this.mode = k; return; }
    if (k === 'o' || k === 'O') { const t = { ...this.vis }; this.vis = { l: cur.l, c: cur.c }; cur.l = t.l; cur.c = t.c; return; }
    if (k === ':') { this.exitVisual(); return this.openCmd(':', "'<,'>"); }
    if (k === '/' || k === '?') return this.openCmd(k, '');
    if (k === C('d') || k === C('u') || k === C('f') || k === C('b') || k === C('e') || k === C('y') || k === PGUP || k === PGDN || k[0] === 'z') return this.normalCmd(cmd);
    const r = this.visRange();
    if (r.block) return this.blockCmd(k, r, cmd);
    const alias = { x: 'd', DEL: 'd', X: 'D', s: 'c', u: 'gu', U: 'gU', '~': 'g~', R: 'S', Y: 'y' };
    if (k === DEL) k = 'd';
    k = alias[k] || k;
    if (k === 'D' || k === 'S' || k === 'C') { r.s = { l: r.s.l, c: 0 }; r.e = { l: r.e.l, c: 0 }; r.lw = true; k = k === 'D' ? 'd' : 'c'; }
    const done = () => { this.exitVisual(); };
    if (OPS.has(k)) {
      const linesN = r.e.l - r.s.l + 1;
      done();
      if (k === '!') { return this.openCmd(':', "'<,'>!"); }
      this.cur.l = r.s.l; this.cur.c = r.s.c;
      this.applyOp(k, r, cmd.reg, count);
      if (this.mode === 'n') this.w.want = this.cur.c;
      if ((k === '<' || k === '>') && linesN <= 2) this.message = null;
      return;
    }
    switch (k) {
      case 'J': case 'gJ': done(); return this.join(r.s.l, Math.max(r.s.l + 1, r.e.l), k === 'J');
      case 'r': {
        if (cmd.arg === ESC) return done();
        done();
        if (r.lw) for (let l = r.s.l; l <= r.e.l; l++) this.setLine(l, cmd.arg.repeat(this.L[l].length));
        else { const t = this.getRange(r.s, r.e).replace(/[^\n]/g, cmd.arg); this.deleteRange(r.s, r.e); this.insertText(r.s.l, r.s.c, t); }
        cur.l = r.s.l; cur.c = r.s.c; return;
      }
      case 'p': case 'P': {
        const reg = this.getReg(cmd.reg);
        if (!reg) { done(); return this.err('E353: Nothing in register "'); }
        const keep = { ...reg };
        done();
        cur.l = r.s.l; cur.c = r.s.c;
        const lastLine = r.lw && r.e.l === this.L.length - 1;
        this.applyOp('d', r, k === 'P' ? '_' : null);
        this.regs.__put = keep;
        if (r.lw) { if (keep.k !== 'l') { this.insertLines(lastLine ? this.L.length : cur.l, ['']); if (!lastLine) { /* placed above */ } else cur.l = this.L.length - 1; cur.c = 0; this.doPut('__put', false, count, false); } else this.doPut('__put', lastLine, count, false); }
        else this.doPut('__put', cur.c < r.s.c || (keep.k === 'l'), count, false);
        delete this.regs.__put;
        return;
      }
      case 'I': done(); cur.l = r.s.l; cur.c = r.lw ? 0 : r.s.c; return this.startInsert(r.lw ? 'I' : 'i', 1);
      case 'A': done(); cur.l = r.e.l; cur.c = r.lw ? this.L[r.e.l].length : r.e.c; this.mode = 'i'; this.fix(); this.mode = 'n'; return this.startInsert('A*', 1);
      case C('a'): case C('x'): { done(); for (let l = r.s.l; l <= r.e.l; l++) { cur.l = l; cur.c = l === r.s.l && !r.lw ? r.s.c : 0; this.increment(k === C('a') ? count : -count); } cur.l = r.s.l; this.failed = false; return; }
      case '*': case '#': { const t = this.getRange(r.s, r.e).replace(/[\\/.*$^~[\]]/g, '\\$&').replace(/\n/g, '\\n'); done(); this.search = { pat: t, fwd: k === '*' }; this.hlOff = false; const p = this.find(t, cur, k === '*'); if (p) this.moveTo({ ...p, jump: true }); return; }
      case 'gv': { const lv = this.b.lastVis; if (lv) { this.b.lastVis = { mode: this.mode, a: { ...this.vis }, b: { ...cur } }; this.mode = lv.mode; this.vis = { ...lv.a }; cur.l = lv.b.l; cur.c = lv.b.c; } return; }
    }
    this.bell();
  }
  blockCmd(k, r, cmd) {
    const { cur } = this, { l1, l2, c1 } = r, c2 = r.c2;
    const seg = l => this.L[l].slice(c1, c2 === Infinity ? undefined : c2 + 1);
    const each = f => { for (let l = l1; l <= l2; l++) f(l, this.L[l]); };
    const cut = () => each((l, s) => { if (s.length > c1) this.setLine(l, s.slice(0, c1) + (c2 === Infinity ? '' : s.slice(c2 + 1))); });
    const yank = del => { const rows = []; each(l => rows.push(seg(l))); this.setReg(cmd.reg, rows.join('\n'), 'b', del); };
    const end = () => { this.exitVisual(); cur.l = l1; cur.c = c1; };
    switch (k) {
      case 'y': yank(false); end(); if (l2 - l1 > 1) this.msg(`block of ${l2 - l1 + 1} lines yanked`); return;
      case 'd': case 'x': case DEL: case 'X': case 'D': yank(true); if (k === 'D' || k === 'X') r.c2 = Infinity; cut(); end(); return;
      case 'c': case 's': case 'C': yank(true); cut(); end(); return this.startInsert('i', 1, { l1, l2, col: c1 });
      case 'I': end(); return this.startInsert('i', 1, { l1, l2, col: c1 });
      case 'A': { end(); const col = c2 === Infinity ? Infinity : c2 + 1; if (col !== Infinity) each((l, s) => { if (s.length < col) this.setLine(l, s.padEnd(col)); }); cur.c = col === Infinity ? this.L[l1].length : col; this.mode = 'i'; this.fix(); this.mode = 'n'; return this.startInsert('A*', 1, { l1, l2, col, append: c2 === Infinity }); }
      case 'r': if (cmd.arg !== ESC) each((l, s) => { if (s.length > c1) this.setLine(l, s.slice(0, c1) + seg(l).replace(/./g, cmd.arg) + (c2 === Infinity ? '' : s.slice(c2 + 1))); }); end(); return;
      case '~': case 'u': case 'U': each((l, s) => { const t = seg(l); this.setLine(l, s.slice(0, c1) + (k === 'u' ? t.toLowerCase() : k === 'U' ? t.toUpperCase() : [...t].map(ch => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase())).join('')) + (c2 === Infinity ? '' : s.slice(c2 + 1))); }); end(); return;
      case '<': case '>': each(l => this.shiftLine(l, k === '>' ? 1 : -1, true)); end(); return;
      case 'J': end(); return this.join(l1, Math.max(l1 + 1, l2), true);
      case 'o': case 'O': { const t = { ...this.vis }; this.vis = { l: cur.l, c: cur.c }; cur.l = t.l; cur.c = t.c; return; }
      case 'p': case 'P': yank(true); cut(); end(); return this.doPut(cmd.reg === null ? '-' : cmd.reg, false, 1, false);
    }
    this.bell();
  }

  // ---- insert / replace mode
  startInsert(kind, count, block) {
    const { cur } = this;
    this.intro = false;
    if (this.b.help) return this.err("E21: Cannot make changes, 'modifiable' is off");
    switch (kind) {
      case 'a': if (this.line.length) cur.c++; break;
      case 'I': cur.c = indentOf(this.line).length; break;
      case 'gI': cur.c = 0; break;
      case 'A': cur.c = this.line.length; break;
      case 'gi': { const m = this.b.marks['^']; if (m) { cur.l = Math.min(this.L.length - 1, m.l); cur.c = Math.min(this.L[cur.l].length, m.c); } break; }
      case 'o': case 'O': this.openLine(kind === 'o'); break;
    }
    this.ins = { kind, count, keys: '', block, l: cur.l, c: cur.c, orig: [] };
    this.mode = kind === 'R' ? 'R' : 'i';
    this.w.want = cur.c;
  }
  openLine(below) {
    const { cur } = this;
    let ind = this.o.ai ? indentOf(this.line) : '';
    if (this.o.si && below && /[{]\s*$/.test(this.line)) ind += this.o.et ? ' '.repeat(this.o.sw || this.o.ts) : '\t';
    const at = below ? cur.l + 1 : cur.l;
    this.insertLines(at, [ind]);
    cur.l = at; cur.c = ind.length;
  }
  insertKey(k) {
    const { cur, ins } = this;
    if (ins.lit) { ins.lit = false; ins.keys += k; if (k.charCodeAt(0) < 0xe000) this.typeChar(k === CR ? '\n' : k); return; }
    if (ins.reg) { ins.reg = false; ins.keys += k; const r = this.getReg(k === C('w') ? null : k); if (r) { const p = this.insertText(cur.l, cur.c, r.t + (r.k === 'l' ? '\n' : '')); cur.l = p.l; cur.c = p.c; } return; }
    if (k === ESC || k === C('c')) return this.endInsert();
    if (this.pum && k !== C('n') && k !== C('p')) this.pum = null;
    ins.keys += k;
    const line = this.line;
    switch (k) {
      case CR: case C('j'): {
        let ind = this.o.ai ? indentOf(line) : '';
        if (this.o.si && /[{]\s*$/.test(line.slice(0, cur.c))) ind += this.o.et ? ' '.repeat(this.o.sw || this.o.ts) : '\t';
        const head = line.slice(0, cur.c), tail = line.slice(cur.c).replace(/^\s+/, m => (this.o.ai ? '' : m));
        this.setLine(cur.l, this.o.ai && /^\s*$/.test(head) ? '' : head);
        this.insertLines(cur.l + 1, [ind + tail]);
        cur.l++; cur.c = ind.length; break;
      }
      case BS: case '\b': {
        if (this.mode === 'R') { if (cur.c > ins.c || cur.l > ins.l) { if (cur.c === 0) return; cur.c--; const o = ins.orig.pop(); if (o !== undefined) this.setLine(cur.l, line.slice(0, cur.c) + o + line.slice(cur.c + 1)); } else if (cur.c > 0) cur.c--; break; }
        if (cur.c === 0) { if (cur.l === 0) return; const pl = this.L[cur.l - 1].length; this.join(cur.l - 1, cur.l, false); cur.l--; cur.c = pl; this.mode === 'i' && (cur.c = pl); break; }
        let n = 1;
        const sts = this.o.sts || (this.o.et ? this.o.sw : 0);
        if (sts && /^ +$/.test(line.slice(0, cur.c))) n = (cur.c % sts) || sts;
        this.setLine(cur.l, line.slice(0, cur.c - n) + line.slice(cur.c)); cur.c -= n; break;
      }
      case DEL: if (cur.c < line.length) this.setLine(cur.l, line.slice(0, cur.c) + line.slice(cur.c + 1)); else if (cur.l < this.L.length - 1) { const c = cur.c; this.join(cur.l, cur.l + 1, false); cur.c = c; } break;
      case C('w'): { if (cur.c === 0) return this.insertKey(BS); let p = cur.c; while (p > 0 && this.cls(line[p - 1]) === 0) p--; const cl = this.cls(line[p - 1]); while (p > 0 && this.cls(line[p - 1]) === cl) p--; this.setLine(cur.l, line.slice(0, p) + line.slice(cur.c)); cur.c = p; break; }
      case C('u'): { const from = cur.l === ins.l && ins.c < cur.c ? ins.c : indentOf(line).length < cur.c ? indentOf(line).length : 0; this.setLine(cur.l, line.slice(0, from) + line.slice(cur.c)); cur.c = from; break; }
      case C('t'): case C('d'): { const before = line.length; this.shiftLine(cur.l, k === C('t') ? 1 : -1, true); cur.c = Math.max(0, cur.c + this.line.length - before); break; }
      case TAB: {
        if (this.o.et || this.o.sts) { const w = this.o.sts || this.o.sw || this.o.ts; let col = 0; for (const ch of line.slice(0, cur.c)) col = ch === '\t' ? col + this.o.ts - (col % this.o.ts) : col + 1; this.typeChar(' '.repeat(w - (col % w))); }
        else this.typeChar('\t');
        break;
      }
      case C('v'): case C('q'): ins.lit = true; break;
      case C('r'): ins.reg = true; break;
      case C('o'): this.oneShot = { mode: this.mode, ins }; this.mode = 'n'; this.rec = ''; this.fix(); if (cur.c >= this.line.length && this.line.length) cur.c = this.line.length; break;
      case C('n'): case C('p'): this.complete(k === C('n') ? 1 : -1); break;
      case C('e'): case C('y'): { const o = this.L[cur.l + (k === C('e') ? 1 : -1)]; if (o && o[cur.c]) this.typeChar(o[cur.c]); break; }
      case C('a'): if (this.lastIns) { const p = this.insertText(cur.l, cur.c, this.lastIns); cur.l = p.l; cur.c = p.c; } break;
      case LEFT: if (cur.c > 0) cur.c--; ins.moved = true; break;
      case RIGHT: if (cur.c < line.length) cur.c++; ins.moved = true; break;
      case UP: case DOWN: { const t = cur.l + (k === UP ? -1 : 1); if (t >= 0 && t < this.L.length) { cur.l = t; cur.c = Math.min(this.L[t].length, this.w.want); } ins.moved = true; return; }
      case HOME: cur.c = 0; break;
      case END: cur.c = line.length; break;
      case PGUP: case PGDN: { const h = this.w.rect.h - 2; cur.l = Math.max(0, Math.min(this.L.length - 1, cur.l + (k === PGUP ? -h : h))); cur.c = Math.min(this.line.length, cur.c); break; }
      case INS: this.mode = this.mode === 'i' ? 'R' : 'i'; break;
      default:
        if (k.charCodeAt(0) < 32 || k.charCodeAt(0) >= 0xe000 && k.charCodeAt(0) < 0xe100) return;
        if (k === '}' && this.o.si && /^\s+$/.test(line.slice(0, cur.c))) { const before = line.length; this.shiftLine(cur.l, -1, true); cur.c = Math.max(0, cur.c + this.line.length - before); }
        this.typeChar(k);
    }
    this.w.want = cur.c;
  }
  typeChar(text) {
    const { cur, ins } = this, line = this.line;
    if (text === '\n') return this.insertKey(CR);
    if (this.mode === 'R') { for (const ch of text) { ins.orig.push(this.line[cur.c]); this.setLine(cur.l, this.line.slice(0, cur.c) + ch + this.line.slice(cur.c + 1)); cur.c++; } return; }
    this.setLine(cur.l, line.slice(0, cur.c) + text + line.slice(cur.c));
    cur.c += text.length;
    if (this.o.tw && cur.c > this.o.tw && text !== ' ') { const sp = this.line.lastIndexOf(' ', this.o.tw); if (sp > indentOf(this.line).length) { const tail = this.line.slice(sp + 1), ind = this.o.ai ? indentOf(this.line) : ''; this.setLine(cur.l, this.line.slice(0, sp)); this.insertLines(cur.l + 1, [ind + tail]); cur.l++; cur.c = ind.length + tail.length; } }
  }
  endInsert() {
    const { cur, ins } = this;
    this.pum = null;
    const typed = ins.keys;
    // count: "3ihey<Esc>" repeats the typed keys
    if (ins.count > 1 && !ins.replay && !this.oneShot) {
      ins.replay = true;
      const keys = ins.keys;
      for (let i = 1; i < ins.count; i++) { if (ins.kind === 'o' || ins.kind === 'O') this.openLine(ins.kind === 'o'); for (const ch of keys) this.insertKey(ch); }
    }
    // visual block insert/append: copy the typed text to the other rows
    if (ins.block && cur.l === ins.block.l1 && !/[\r\n]/.test(typed)) {
      const b = ins.block, text = this.L[b.l1].slice(ins.c, cur.c);
      if (text && cur.c >= ins.c) for (let l = b.l1 + 1; l <= b.l2; l++) { const s = this.L[l]; if (b.append) this.setLine(l, s + text); else if (s.length >= b.col || ins.kind === 'A*') this.setLine(l, s.padEnd(b.col).slice(0, b.col) + text + s.slice(b.col)); }
      cur.l = b.l1; cur.c = b.col === Infinity ? cur.c : b.col + 1;
    }
    this.lastIns = [...typed].filter(ch => ch === CR || ch === TAB || (ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) < 0xe000 && ch !== BS)).join('').replace(/\r/g, '\n');
    this.b.marks['^'] = { l: cur.l, c: cur.c };
    if (this.changed) this.b.marks['.'] = { l: cur.l, c: Math.max(0, cur.c - 1) };
    // a line holding only auto-indent is cleared when you leave it
    if (/^[ \t]+$/.test(this.line) && this.o.ai && (ins.kind === 'o' || ins.kind === 'O' || /\r$/.test(typed))) { this.setLine(cur.l, ''); cur.c = 0; }
    this.mode = 'n';
    if (cur.c > 0) cur.c--;
    this.w.want = cur.c;
    this.ins = null;
  }
  complete(dir) {
    const { cur } = this;
    if (!this.pum) {
      const base = /[\wÀ-￿]*$/.exec(this.line.slice(0, cur.c))[0], seen = new Set(), items = [];
      const scan = (buf, from) => { const n = buf.lines.length; for (let i = 0; i < n; i++) { const l = (from + i) % n; for (const m of buf.lines[l].matchAll(/[\wÀ-￿]+/g)) if (m[0].startsWith(base) && m[0] !== base && !seen.has(m[0])) { seen.add(m[0]); items.push(m[0]); } } };
      scan(this.b, cur.l);
      for (const b of this.bufs) if (b !== this.b) scan(b, 0);
      if (!items.length) { this.err('-- Keyword completion (^N^P) Pattern not found'); this.message.hl = this.hl.ErrorMsg; return; }
      this.pum = { base, items, i: -1, c: cur.c - base.length, l: cur.l };
      if (dir < 0) this.pum.i = items.length;
    }
    const p = this.pum, n = p.items.length;
    p.i = ((p.i + dir) % (n + 1) + (n + 1)) % (n + 1);
    const word = p.i === n ? p.base : p.items[p.i];
    this.setLine(cur.l, this.line.slice(0, p.c) + word + this.line.slice(cur.c));
    cur.c = p.c + word.length;
    this.msg(p.i === n ? '-- Keyword completion (^N^P) Back at original' : `-- Keyword completion (^N^P) match ${p.i + 1} of ${n}`, this.hl.ModeMsg);
    this.message.keep = true;
  }

  // ---- windows
  winCmd(k, count, has) {
    const all = this.wins(), i = all.indexOf(this.w);
    const go = w => { if (w) { this.w = w; } else this.bell(); };
    const dirTo = (dx, dy) => {
      const r = this.w.rect, cx = r.x + (dx > 0 ? r.w + 1 : dx < 0 ? -2 : Math.min(r.w - 1, this.curCol || 0)), cy = r.y + (dy > 0 ? r.h + 1 : dy < 0 ? -2 : Math.min(r.h - 1, this.curRow || 0));
      return all.find(w => cx >= w.rect.x && cx < w.rect.x + w.rect.w && cy >= w.rect.y && cy <= w.rect.y + w.rect.h);
    };
    switch (k) {
      case 's': case 'S': case C('s'): return this.ex('split');
      case 'v': case C('v'): return this.ex('vsplit');
      case 'n': case C('n'): return this.ex('new');
      case 'c': return this.ex('close');
      case 'q': case C('q'): return this.ex('q');
      case 'o': case C('o'): return this.ex('only');
      case 'w': case C('w'): return go(has ? all[count - 1] : all[(i + 1) % all.length]);
      case 'W': case 'p': case C('p'): return go(all[(i - 1 + all.length) % all.length]);
      case 't': case C('t'): return go(all[0]);
      case 'b': case C('b'): return go(all.at(-1));
      case 'h': case LEFT: case C('h'): case BS: return go(dirTo(-1, 0));
      case 'l': case RIGHT: case C('l'): return go(dirTo(1, 0));
      case 'j': case DOWN: case C('j'): return go(dirTo(0, 1));
      case 'k': case UP: case C('k'): return go(dirTo(0, -1));
      case 'x': case 'r': case 'R': case C('x'): case C('r'): { if (all.length < 2) return this.bell(); const o = all[(i + 1) % all.length]; for (const key of ['buf', 'cur', 'top']) [this.w[key], o[key]] = [o[key], this.w[key]]; return go(o); }
      case '=': case '+': case '-': case '<': case '>': case '_': case '|': return;
    }
    this.bell();
  }
  splitWin(vertical, buf) {
    const nw = this.newWin(buf || this.b);
    nw.cur = { ...this.cur }; nw.top = this.w.top;
    const dir = vertical ? 'v' : 'h', after = vertical ? this.o.spr : this.o.sb;
    const visit = (node, parent, idx) => {
      if (node.win === this.w) {
        if (parent && parent.dir === dir) parent.kids.splice(after ? idx + 1 : idx, 0, { win: nw });
        else { const old = { win: node.win }; delete node.win; node.dir = dir; node.kids = after ? [old, { win: nw }] : [{ win: nw }, old]; }
        return true;
      }
      return !!node.kids && node.kids.some((kid, i) => visit(kid, node, i));
    };
    visit(this.layout, null, 0);
    this.w = nw; this.intro = false;
    return nw;
  }
  closeWin(w) {
    const all = this.wins();
    if (all.length === 1) return false;
    const idx = all.indexOf(w);
    const prune = node => {
      if (!node.kids) return;
      node.kids = node.kids.filter(k => k.win !== w);
      node.kids.forEach(prune);
      node.kids = node.kids.filter(k => k.win || k.kids.length);
      if (node.kids.length === 1) { const only = node.kids[0]; delete node.kids; delete node.dir; Object.assign(node, only); }
    };
    prune(this.layout);
    if (this.w === w) { const rest = this.wins(); this.w = rest[Math.min(idx, rest.length - 1)]; }
    return true;
  }
  doLayout() {
    const rows = this.sc.rows - 1, cols = this.sc.cols, many = this.wins().length > 1;
    const status = this.o.ls === 2 || (this.o.ls === 1 && many);
    this.seps = [];
    const place = (node, x, y, w, h) => {
      if (node.win) { node.win.rect = { x, y, w, h: Math.max(1, h - (status ? 1 : 0)) }; node.win.status = status ? y + h - 1 : -1; return; }
      const n = node.kids.length;
      if (node.dir === 'v') {
        const each = Math.floor((w - (n - 1)) / n);
        let extra = w - (n - 1) - each * n, cx = x;
        node.kids.forEach((k, i) => { const cw = each + (extra-- > 0 ? 1 : 0); place(k, cx, y, cw, h); cx += cw; if (i < n - 1) { this.seps.push({ x: cx, y, h }); cx++; } });
      } else {
        const each = Math.floor(h / n);
        let extra = h - each * n, cy = y;
        node.kids.forEach(k => { const ch = each + (extra-- > 0 ? 1 : 0); place(k, x, cy, w, ch); cy += ch; });
      }
    };
    place(this.layout, 0, 0, cols, rows);
  }

  // ---- rendering
  setScheme(name) {
    const st = s => (this.io.style ? this.io.style(s) : s);
    const base = { LineNr: { fg: 11 }, CursorLineNr: { fg: 11, b: true }, NonText: { fg: 12, b: true }, Comment: { fg: 14 }, Constant: { fg: 13 }, Special: { fg: 224 }, Identifier: { fg: 14, b: true }, Statement: { fg: 11 }, PreProc: { fg: 81 }, Type: { fg: 121 }, Search: { fg: 0, bg: 11 }, IncSearch: { inv: true }, Visual: { bg: 242 }, MatchParen: { bg: 6 }, StatusLine: { b: true, inv: true }, StatusLineNC: { inv: true }, VertSplit: { inv: true }, ModeMsg: { b: true }, MoreMsg: { fg: 121, b: true }, ErrorMsg: { fg: 15, bg: 1 }, WarningMsg: { fg: 224 }, Title: { fg: 225, b: true }, Directory: { fg: 159 }, Pmenu: { fg: 0, bg: 13 }, PmenuSel: { fg: 242, bg: 0 }, CursorLine: { u: true }, SpecialKey: { fg: 81 }, Underlined: { fg: 81, u: true }, Todo: { fg: 0, bg: 11 }, Bold: { b: true } };
    if (this.io.light) Object.assign(base, { LineNr: { fg: 130 }, CursorLineNr: { fg: 130, b: true }, NonText: { fg: 12, b: true }, Comment: { fg: 4 }, Constant: { fg: 1 }, Special: { fg: 5 }, Identifier: { fg: 6 }, Statement: { fg: 130, b: true }, PreProc: { fg: 5 }, Type: { fg: 2, b: true }, Visual: { bg: 250 }, MoreMsg: { fg: 2, b: true }, WarningMsg: { fg: 1 }, Title: { fg: 5, b: true }, Directory: { fg: 4 }, SpecialKey: { fg: 4 }, Underlined: { fg: 5, u: true }, Pmenu: { fg: 0, bg: 225 }, PmenuSel: { fg: 0, bg: 7 }, MatchParen: { bg: 14 } });
    const schemes = {
      default: {}, elflord: { Comment: { fg: 80 }, Statement: { fg: 87, b: true }, Type: { fg: 50, b: true }, Constant: { fg: 13 }, PreProc: { fg: 13 }, Identifier: { fg: 14 } },
      desert: { Comment: { fg: 110 }, Constant: { fg: 217 }, Statement: { fg: 222, b: true }, Type: { fg: 143, b: true }, PreProc: { fg: 167 }, Identifier: { fg: 120 }, LineNr: { fg: 144 }, NonText: { fg: 152 }, Search: { fg: 223, bg: 172 }, Visual: { fg: 222, bg: 64 } },
      slate: { Comment: { fg: 243 }, Constant: { fg: 217 }, Statement: { fg: 111, b: true }, Type: { fg: 111, b: true }, PreProc: { fg: 203 }, Identifier: { fg: 209 }, LineNr: { fg: 242 } },
      murphy: { Comment: { fg: 208 }, Constant: { fg: 15 }, Statement: { fg: 11 }, Type: { fg: 250 }, PreProc: { fg: 223 }, Identifier: { fg: 14 } },
    };
    if (!schemes[name]) return false;
    this.scheme = name; this.hl = {};
    for (const [k, v] of Object.entries({ ...base, ...schemes[name] })) this.hl[k] = st(v);
    this.styleCache = new Map();
    this.synCache.clear();
    return true;
  }
  // Merges a syntax style with an overlay (visual / search / cursorline).
  mix(a, b) {
    if (!a) return b; if (!b) return a;
    let m = this.styleCache.get(a);
    if (!m) this.styleCache.set(a, m = new Map());
    let r = m.get(b);
    if (!r) { const raw = { ...(a.raw || a), ...(b.raw || b) }; r = this.io.style ? this.io.style(raw) : raw; m.set(b, r); }
    return r;
  }
  dispW(s) { let w = 0; const ts = this.o.ts; for (const ch of s) w += ch === '\t' ? (this.o.list ? 2 : ts - (w % ts)) : wcwidth(ch); return w; }
  gutter(w) { return this.o.nu || this.o.rnu ? Math.max(3, String(w.buf.lines.length).length) + 1 : 0; }
  rowsOf(w, l) { if (!this.o.wrap) return 1; const tw = Math.max(1, w.rect.w - this.gutter(w)); return Math.max(1, Math.ceil((this.dispW(w.buf.lines[l]) + (this.o.list ? 1 : 0)) / tw)); }
  scrollIntoView(w) {
    const cur = w.cur, n = w.buf.lines.length, h = w.rect.h;
    cur.l = Math.max(0, Math.min(n - 1, cur.l));
    w.top = Math.max(0, Math.min(n - 1, w.top));
    const so = w === this.w && !this.noSo ? Math.min(this.o.so, Math.floor((h - 1) / 2)) : 0;
    if (cur.l - so < w.top) w.top = Math.max(0, cur.l - so);
    const last = Math.min(n - 1, cur.l + so);
    let rows = 0;
    for (let l = w.top; l <= last; l++) rows += this.rowsOf(w, l);
    while (rows > h && w.top < cur.l) { rows -= this.rowsOf(w, w.top); w.top++; }
    if (!this.o.wrap) {
      const tw = Math.max(1, w.rect.w - this.gutter(w)), col = this.dispW(w.buf.lines[cur.l].slice(0, cur.c));
      if (col < w.left) w.left = col; else if (col >= w.left + tw) w.left = col - tw + 1;
    } else w.left = 0;
  }
  searchRe() { if (!this.search || !this.o.hls || this.hlOff) return null; try { return this.regex(this.search.pat, 'g'); } catch { return null; } }
  drawWin(w, active) {
    const sc = this.sc, { x, y, w: W, h } = w.rect, buf = w.buf, hl = this.hl;
    const gw = this.gutter(w), tw = Math.max(1, W - gw), ts = this.o.ts;
    this.scrollIntoView(w);
    const sre = this.searchRe(), inc = active && this.incMatch;
    const vis = active && this.vis ? this.visRange() : null;
    let mp = null;
    if (active && this.mode !== 'c') { const ch = buf.lines[w.cur.l][w.cur.c]; if (ch && (('([{'.includes(ch)) || ')]}'.includes(ch))) { const m = this.matchPair(w.cur); if (m) mp = m; } }
    let row = 0, l = w.top;
    for (; l < buf.lines.length && row < h; l++) {
      const line = buf.lines[l];
      // per-character style
      const st = new Array(line.length + 1).fill(null);
      if (this.o.syn && buf.ft && line.length < 2000) for (const [a, b, g] of this.syn(buf, l)) { const s = hl[g]; for (let i = a; i < b && i < line.length; i++) st[i] = s; }
      if (sre) { sre.lastIndex = 0; let m; while ((m = sre.exec(line))) { if (!m[0]) { sre.lastIndex++; continue; } for (let i = m.index; i < m.index + m[0].length; i++) st[i] = this.mix(st[i], hl.Search); } }
      if (inc && inc.l === l) for (let i = inc.c; i < inc.c + Math.max(1, inc.n); i++) st[i] = hl.IncSearch;
      if (mp && mp.l === l) st[mp.c] = this.mix(st[mp.c], hl.MatchParen);
      if (vis) {
        if (vis.block) { if (l >= vis.l1 && l <= vis.l2) for (let i = vis.c1; i <= Math.min(vis.c2, line.length - 1); i++) st[i] = this.mix(st[i], hl.Visual); }
        else if (l >= vis.s.l && l <= vis.e.l) { const a = vis.lw || l > vis.s.l ? 0 : vis.s.c, b = vis.lw || l < vis.e.l ? line.length + 1 : vis.e.c; for (let i = a; i < b; i++) st[i] = this.mix(st[i], hl.Visual); }
      }
      const cul = this.o.cul && l === w.cur.l ? hl.CursorLine : null;
      // cells
      const cells = [];
      let col = 0;
      for (let i = 0; i < line.length; i++) {
        let ch = line[i];
        const code = ch.charCodeAt(0);
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < line.length) { ch += line[i + 1]; }
        const s = cul ? this.mix(st[i], cul) : st[i];
        if (ch === '\t') {
          if (this.o.list) { cells.push({ ch: '^', st: hl.SpecialKey, i, w: 1 }, { ch: 'I', st: hl.SpecialKey, i, w: 1 }); col += 2; }
          else { const n = ts - (col % ts); for (let k = 0; k < n; k++) cells.push({ ch: ' ', st: s, i, w: 1 }); col += n; }
        } else if (code < 32) { cells.push({ ch: '^', st: hl.SpecialKey, i, w: 1 }, { ch: String.fromCharCode(code + 64), st: hl.SpecialKey, i, w: 1 }); col += 2; }
        else { const cw = wcwidth(ch); cells.push({ ch, st: s, i, w: cw }); col += cw; if (ch.length === 2) i++; }
      }
      if (this.o.list) cells.push({ ch: '$', st: hl.NonText, i: line.length, w: 1 });
      else if (st[line.length] || cul) cells.push({ ch: ' ', st: cul ? this.mix(st[line.length], cul) : st[line.length], i: line.length, w: 1 });
      // rows
      const num = gw ? (this.o.rnu && l !== w.cur.l ? String(Math.abs(l - w.cur.l)).padStart(gw - 1) : this.o.rnu && this.o.nu ? String(l + 1).padEnd(gw - 1) : String(this.o.rnu ? 0 : l + 1).padStart(gw - 1)) + ' ' : '';
      let k = 0, first = true, skip = w.left;
      const isCur = active && l === w.cur.l;
      const wantI = w.cur.c;
      let found = false;
      do {
        if (row >= h) break;
        if (gw) sc.put(y + row, x, first ? num : ' '.repeat(gw), l === w.cur.l && (this.o.cul || this.o.rnu) ? hl.CursorLineNr : hl.LineNr);
        let cx = 0;
        while (k < cells.length) {
          const c = cells[k];
          if (skip > 0) { skip -= c.w; k++; continue; }
          if (cx + c.w > tw) break;
          if (isCur && !found && (c.i === wantI && (c.ch !== ' ' || line[c.i] !== '\t' || this.mode === 'i' || this.mode === 'R' || !(cells[k + 1] && cells[k + 1].i === c.i)))) { this.curRow = y + row; this.curCol = x + gw + cx; found = true; }
          sc.put(y + row, x + gw + cx, c.ch, c.st);
          cx += c.w; k++;
        }
        if (cul && cx < tw) sc.fill(y + row, x + gw + cx, tw - cx, ' ', cul);
        if (isCur && !found && k >= cells.length) {
          // cursor past the last character (insert mode at EOL, or empty line)
          if (cx >= tw && this.o.wrap) { if (row + 1 < h) { this.curRow = y + row + 1; this.curCol = x + gw; } else { this.curRow = y + row; this.curCol = x + gw + tw - 1; } }
          else { this.curRow = y + row; this.curCol = x + gw + Math.min(cx, tw - 1); }
          found = true;
        }
        row++; first = false;
      } while (k < cells.length && this.o.wrap);
    }
    for (; row < h; row++) sc.put(y + row, x, l < buf.lines.length ? '@' : '~', hl.NonText);
    if (w.status >= 0) {
      const s = active ? hl.StatusLine : hl.StatusLineNC;
      sc.fill(w.status, x, W, ' ', s);
      sc.put(w.status, x, (buf.help ? 'help.txt [Help][RO]' : (buf.name || '[No Name]') + (buf.mod ? ' [+]' : '') + (buf.ro ? ' [RO]' : '')).slice(0, W), s);
      if (W > 30) sc.put(w.status, x + W - 18, this.ruler(w), s);
    }
  }
  ruler(w) {
    const n = w.buf.lines.length, l = w.cur.l, line = w.buf.lines[l];
    const vc = this.dispW(line.slice(0, w.cur.c)) + 1;
    const col = !line.length ? '0-1' : vc !== w.cur.c + 1 ? `${w.cur.c + 1}-${vc}` : String(w.cur.c + 1);
    if (n === 1 && !line.length) return '0,0-1'.padEnd(14) + 'All';
    let bot = w.top, rows = 0;
    while (bot < n) { rows += this.rowsOf(w, bot); if (rows > w.rect.h) break; bot++; }
    const pos = w.top === 0 && bot >= n ? 'All' : w.top === 0 ? 'Top' : bot >= n ? 'Bot' : Math.floor((w.top * 100) / Math.max(1, n - (bot - w.top))) + '%';
    return `${l + 1},${col}`.padEnd(14) + pos;
  }
  render() {
    if (this.dead || this.busy === 'shell') return;
    const sc = this.sc, hl = this.hl, rows = sc.rows, cols = sc.cols;
    sc.clear();
    this.doLayout();
    const all = this.wins();
    for (const w of all) if (w !== this.w) this.drawWin(w, false);
    this.drawWin(this.w, true);
    for (const s of this.seps) for (let r = 0; r < s.h; r++) sc.put(s.y + r, s.x, '|', hl.VertSplit);
    this.noSo = false;
    if (this.intro && all.length === 1 && !this.b.name && !this.b.mod && rows > INTRO.length + 4) {
      const top = Math.floor((rows - 1 - INTRO.length) / 2);
      INTRO.forEach((s, i) => { let x = Math.floor((cols - s.length) / 2); for (const [text, g] of s.split(/(<[^>]+>|:\S+)/).map(t => [t, /^(<.*>|:\S+)$/.test(t) ? hl.SpecialKey : null])) x = sc.put(top + i, x, text, g); });
    }
    // completion popup
    if (this.pum) {
      const p = this.pum, wd = Math.max(...p.items.map(s => s.length)) + 2, n = Math.min(p.items.length, 10);
      const px = Math.max(0, Math.min(cols - wd, this.curCol - (this.cur.c - p.c) - 1)), below = this.curRow + n < rows - 1;
      const off = Math.max(0, Math.min(p.items.length - n, p.i - n + 1));
      for (let i = 0; i < n; i++) sc.put(below ? this.curRow + 1 + i : this.curRow - n + i, px, (' ' + p.items[off + i]).padEnd(wd), off + i === p.i ? hl.PmenuSel : hl.Pmenu);
    }
    // bottom line
    const br = rows - 1;
    let cursor = { r: this.curRow ?? 0, c: this.curCol ?? 0, shape: this.mode === 'i' ? 'bar' : this.mode === 'R' ? 'underline' : 'block', visible: true };
    if (this.pager) {
      const pg = this.pager, n = Math.min(pg.lines.length - pg.off, rows - 1);
      const startRow = Math.max(0, rows - 1 - n);
      for (let r = startRow; r < rows; r++) sc.fill(r, 0, cols, ' ', null);
      for (let i = 0; i < n; i++) { const ln = pg.lines[pg.off + i]; sc.put(startRow + i, 0, typeof ln === 'string' ? ln : ln.text, typeof ln === 'string' ? null : ln.hl); }
      const more = pg.off + n < pg.lines.length;
      const end = sc.put(br, 0, more ? '-- More --' : 'Press ENTER or type command to continue', hl.MoreMsg);
      cursor = { r: br, c: Math.min(cols - 1, end), shape: 'block', visible: true };
    } else if (this.mode === 'c') {
      const cl = this.cmd, text = cl.type + cl.text;
      const off = Math.max(0, text.length + 1 - cols);
      sc.put(br, 0, text.slice(off));
      cursor = { r: br, c: Math.min(cols - 1, this.dispW(text.slice(off, cl.pos + 1))), shape: 'bar', visible: true };
    } else {
      let left = '', lhl = null;
      if (this.message) { left = this.message.text; lhl = this.message.hl; }
      else if (this.o.smd) {
        const m = this.oneShot ? `-- (${this.oneShot.mode === 'R' ? 'replace' : 'insert'}) --` : { i: '-- INSERT --', R: '-- REPLACE --', v: '-- VISUAL --', V: '-- VISUAL LINE --', [C('v')]: '-- VISUAL BLOCK --' }[this.mode] || '';
        left = m; lhl = hl.ModeMsg;
      }
      const x = sc.put(br, 0, left.split('\n')[0].slice(0, cols - 1), lhl);
      if (this.recording != null && !this.message) sc.put(br, x, (left ? ' ' : '') + 'recording @' + this.recording, hl.ModeMsg);
      const status = this.w.status >= 0;
      if (this.o.sc && cols > 40) sc.put(br, cols - (status || !this.o.ru ? 11 : 29), showKeys(this.pend).slice(-10) + (this.mode !== 'n' && this.mode !== 'i' && this.mode !== 'R' && this.vis ? this.visSize() : ''));
      if (this.o.ru && !status && cols > 40) sc.put(br, cols - 18, this.ruler(this.w));
    }
    sc.cursor = cursor;
    sc.flush();
  }
  visSize() { if (this.pend) return ''; const r = this.visRange(); if (r.block) return `${r.l2 - r.l1 + 1}x${r.c2 === Infinity ? '$' : r.c2 - r.c1 + 1}`; if (r.lw || r.e.l !== r.s.l) return String(r.e.l - r.s.l + 1); return String(r.e.c - r.s.c); }
  syn(buf, l) {
    const key = buf.ft + '\0' + buf.lines[l];
    let s = this.synCache.get(key);
    if (!s) { if (this.synCache.size > 6000) this.synCache.clear(); s = synSpans(buf.lines[l], buf.ft, l === 0); this.synCache.set(key, s); }
    return s;
  }

  // ---- message pager ("Press ENTER")
  showLines(lines) {
    if (lines.length === 1 && typeof lines[0] === 'string' && lines[0].length < this.sc.cols - 12) return this.msg(lines[0]);
    this.pager = { lines, off: 0 };
  }
  pagerKey(k) {
    const pg = this.pager, page = this.sc.rows - 1;
    if (pg.off + page < pg.lines.length) {
      if (k === 'q' || k === ESC || k === C('c')) { this.pager = null; return; }
      if (k === CR || k === 'j' || k === DOWN) pg.off++;
      else if (k === 'd') pg.off += Math.floor(page / 2);
      else if (k === 'b' || k === PGUP) pg.off = Math.max(0, pg.off - page);
      else if (k === 'k' || k === UP) pg.off = Math.max(0, pg.off - 1);
      else pg.off += page;
      pg.off = Math.max(0, Math.min(pg.off, Math.max(0, pg.lines.length - page)));
      return;
    }
    if (k === 'b' || k === PGUP || k === 'k' || k === UP) { pg.off = Math.max(0, pg.off - (k === 'k' || k === UP ? 1 : page)); return; }
    this.pager = null;
    if (k === ':') this.openCmd(':', '');
  }
}
Object.assign(Vim.prototype, exMixin);
export { Buf, firstNB, indentOf, basename };
