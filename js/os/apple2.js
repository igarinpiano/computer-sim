// An 8-bit home computer in the style of the Apple II: it boots straight into a line-numbered
// BASIC with a handful of disk commands. The interpreter is written from scratch.

import { h, sleep } from '../core/util.js';
import { sound } from '../core/sound.js';
import { VFS } from '../core/vfs.js';
import { Terminal, INTR } from '../term/terminal.js';
import { runVim } from '../term/tui.js';
import { apple2Seed } from './seeds.js';

class BasicError extends Error { }
const fmt = v => { if (typeof v === 'string') return v; if (Number.isInteger(v)) return String(v); const s = String(parseFloat(v.toPrecision(9))); return s.replace(/^(-?)0\./, '$1.'); };
const upper = s => s.replace(/"[^"]*"?|[^"]+/g, m => (m[0] === '"' ? m : m.toUpperCase()));

class Basic {
  constructor(term, fs, hooks) { Object.assign(this, { term, fs, hooks }); this.prog = new Map(); this.reset(); this.col = 0; }
  reset() { this.vars = {}; this.arrs = {}; this.fors = []; this.subs = []; this.data = null; this.dp = 0; }
  out(s) { s = String(s); const i = s.lastIndexOf('\n'); this.col = i >= 0 ? s.length - i - 1 : this.col + s.length; this.term.write(s); }
  err(msg) { throw new BasicError(msg); }

  // ---- expressions
  tokens(src) {
    const t = [], re = /\s*(?:(\d+\.?\d*(?:E[-+]?\d+)?|\.\d+)|"([^"]*)"?|([A-Z][A-Z0-9]*[$%]?)|(<>|<=|>=|=<|=>|><|[-+*\/^=<>(),;:]))/y;
    let p = 0;
    while (p < src.length) { re.lastIndex = p; const m = re.exec(src); if (!m) { if (/^\s*$/.test(src.slice(p))) break; this.err('SYNTAX'); } p = re.lastIndex; t.push(m[1] !== undefined ? { n: parseFloat(m[1]) } : m[2] !== undefined ? { s: m[2] } : m[3] ? { id: m[3] } : { op: m[4] }); }
    return t;
  }
  eval(src) { const t = this.tokens(src), st = { t, i: 0 }; const v = this.or(st); if (st.i < t.length) this.err('SYNTAX'); return v; }
  isOp(st, ...ops) { const x = st.t[st.i]; return !!x && ((x.op && ops.includes(x.op)) || (x.id && ops.includes(x.id))); }
  num(v) { if (typeof v !== 'number') this.err('TYPE MISMATCH'); return v; }
  or(st) { let a = this.and(st); while (this.isOp(st, 'OR')) { st.i++; const b = this.and(st); a = this.num(a) || this.num(b) ? 1 : 0; } return a; }
  and(st) { let a = this.not(st); while (this.isOp(st, 'AND')) { st.i++; const b = this.not(st); a = this.num(a) && this.num(b) ? 1 : 0; } return a; }
  not(st) { if (this.isOp(st, 'NOT')) { st.i++; return this.num(this.not(st)) ? 0 : 1; } return this.cmp(st); }
  cmp(st) {
    let a = this.add(st);
    while (this.isOp(st, '=', '<>', '><', '<', '>', '<=', '=<', '>=', '=>')) {
      const op = st.t[st.i++].op, b = this.add(st);
      if (typeof a !== typeof b) this.err('TYPE MISMATCH');
      a = (op === '=' ? a === b : op === '<>' || op === '><' ? a !== b : op === '<' ? a < b : op === '>' ? a > b : op === '<=' || op === '=<' ? a <= b : a >= b) ? 1 : 0;
    }
    return a;
  }
  add(st) { let a = this.mul(st); while (this.isOp(st, '+', '-')) { const op = st.t[st.i++].op, b = this.mul(st); if (op === '+' && typeof a === 'string' && typeof b === 'string') a += b; else a = op === '+' ? this.num(a) + this.num(b) : this.num(a) - this.num(b); } return a; }
  mul(st) { let a = this.unary(st); while (this.isOp(st, '*', '/')) { const op = st.t[st.i++].op, b = this.num(this.unary(st)); if (op === '/' && b === 0) this.err('DIVISION BY ZERO'); a = op === '*' ? this.num(a) * b : this.num(a) / b; } return a; }
  unary(st) { if (this.isOp(st, '-')) { st.i++; return -this.num(this.unary(st)); } if (this.isOp(st, '+')) { st.i++; return this.num(this.unary(st)); } return this.pow(st); }
  pow(st) { const a = this.atom(st); if (this.isOp(st, '^')) { st.i++; return Math.pow(this.num(a), this.num(this.unary(st))); } return a; }
  args(st) { const a = []; if (!this.isOp(st, '(')) this.err('SYNTAX'); st.i++; if (!this.isOp(st, ')')) do a.push(this.or(st)); while (this.isOp(st, ',') && ++st.i); if (!this.isOp(st, ')')) this.err('SYNTAX'); st.i++; return a; }
  atom(st) {
    const x = st.t[st.i++];
    if (!x) this.err('SYNTAX');
    if (x.n !== undefined) return x.n;
    if (x.s !== undefined) return x.s;
    if (x.op === '(') { const v = this.or(st); if (!this.isOp(st, ')')) this.err('SYNTAX'); st.i++; return v; }
    if (!x.id) this.err('SYNTAX');
    const F = { INT: a => Math.floor(a), ABS: Math.abs, SQR: a => { if (a < 0) this.err('ILLEGAL QUANTITY'); return Math.sqrt(a); }, SIN: Math.sin, COS: Math.cos, TAN: Math.tan, ATN: Math.atan, LOG: a => { if (a <= 0) this.err('ILLEGAL QUANTITY'); return Math.log(a); }, EXP: Math.exp, SGN: Math.sign, RND: () => Math.random(), PEEK: () => 0, FRE: () => 36863, POS: () => this.col,
      LEN: a => String(a).length, VAL: a => parseFloat(a) || 0, ASC: a => (a.length ? a.charCodeAt(0) : this.err('ILLEGAL QUANTITY')), STR$: a => fmt(a), CHR$: a => String.fromCharCode(a), LEFT$: (a, n) => String(a).slice(0, n), RIGHT$: (a, n) => (n ? String(a).slice(-n) : ''), MID$: (a, s, n) => String(a).substr(s - 1, n ?? 1e9), TAB: n => ' '.repeat(Math.max(0, n - 1 - this.col)), SPC: n => ' '.repeat(Math.max(0, n)) };
    if (F[x.id]) return F[x.id](...this.args(st));
    if (this.isOp(st, '(')) { const idx = this.args(st); return this.arr(x.id, idx)[idx.join(',')] ?? (x.id.endsWith('$') ? '' : 0); }
    return this.vars[x.id] ?? (x.id.endsWith('$') ? '' : 0);
  }
  arr(name, idx) { const a = this.arrs[name] ||= { dims: idx.map(() => 10), v: {} }; if (idx.some((v, k) => v < 0 || v > (a.dims[k] ?? -1))) this.err('BAD SUBSCRIPT'); return a.v; }
  assign(target, v) {
    const m = /^([A-Z][A-Z0-9]*[$%]?)\s*(?:\((.*)\))?$/.exec(target.trim());
    if (!m) this.err('SYNTAX');
    if (m[1].endsWith('$') !== (typeof v === 'string')) this.err('TYPE MISMATCH');
    if (m[1].endsWith('%')) v = Math.trunc(v);
    if (m[2] !== undefined) { const idx = this.split(m[2], ',').map(e => Math.floor(this.num(this.eval(e)))); this.arr(m[1], idx)[idx.join(',')] = v; } else this.vars[m[1]] = v;
  }
  // Splits on a separator outside of strings and parentheses.
  split(s, sep) { const out = []; let d = 0, q = false, cur = ''; for (const ch of s) { if (ch === '"') q = !q; if (!q) { if (ch === '(') d++; else if (ch === ')') d--; if (ch === sep && d === 0) { out.push(cur); cur = ''; continue; } } cur += ch; } out.push(cur); return out; }

  // ---- statements
  async stmt(s, ctl) {
    s = s.trim();
    if (!s) return;
    let m;
    if (/^REM\b/.test(s)) return void (ctl.skipLine = true);
    if ((m = /^(?:PRINT|\?)\s*(.*)$/.exec(s))) {
      let rest = m[1], nl = true, buf = '';
      const flush = () => { this.out(buf); buf = ''; };
      while (rest.length) {
        let d = 0, q = false, k = 0;
        for (; k < rest.length; k++) { const ch = rest[k]; if (ch === '"') q = !q; if (!q) { if (ch === '(') d++; else if (ch === ')') d--; else if ((ch === ';' || ch === ',') && d === 0) break; } }
        const item = rest.slice(0, k).trim(), sep = rest[k];
        if (item) { flush(); this.out(fmt(this.eval(item))); }
        if (sep === ',') { flush(); this.out(' '.repeat(16 - (this.col % 16))); }
        nl = sep === undefined;
        rest = rest.slice(k + 1);
        if (sep !== undefined && !rest.trim()) { nl = false; break; }
      }
      flush();
      if (nl) this.out('\n');
      return;
    }
    if ((m = /^INPUT\s*(?:"([^"]*)"\s*[;,]\s*)?(.+)$/.exec(s))) {
      const names = this.split(m[2], ',');
      for (;;) {
        const line = await this.term.readLine({ prompt: m[1] ?? '?' });
        if (line === INTR || line === null) { ctl.brk = true; return; }
        this.col = 0;
        const vals = this.split(line, ',');
        try { names.forEach((n, i) => { const raw = (vals[i] ?? '').trim(); if (n.trim().endsWith('$')) this.assign(n, raw.replace(/^"|"$/g, '')); else { if (!/^[-+]?(\d+\.?\d*|\.\d+)(E[-+]?\d+)?$/i.test(raw)) throw new BasicError('REENTER'); this.assign(n, parseFloat(raw)); } }); return; }
        catch (e) { if (e.message !== 'REENTER') throw e; this.out('?REENTER\n'); }
      }
    }
    if ((m = /^GET\s+(.+)$/.exec(s))) { const k = await this.term.readKey(); if (k.ctrl && k.key === 'c') { ctl.brk = true; return; } const ch = k.key === 'Enter' ? '\r' : k.key.length === 1 ? k.key.toUpperCase() : ''; return this.assign(m[1], m[1].trim().endsWith('$') ? ch : parseFloat(ch) || 0); }
    if ((m = /^IF\s*(.+?)\s*(?:THEN|GOTO)\s*(.*)$/.exec(s))) {
      if (!this.num(this.eval(m[1]))) return void (ctl.skipLine = true);
      if (/^\d+$/.test(m[2].trim())) return void (ctl.goto = +m[2]);
      ctl.inject = m[2]; return;
    }
    if ((m = /^ON\s*(.+?)\s*(GOTO|GOSUB)\s*(.+)$/.exec(s))) { const k = Math.floor(this.num(this.eval(m[1]))), t = m[3].split(',')[k - 1]; if (!t) return; if (m[2] === 'GOSUB') this.subs.push(ctl.here()); ctl.goto = +t; return; }
    if ((m = /^GO\s*TO\s*(\d+)$/.exec(s))) return void (ctl.goto = +m[1]);
    if ((m = /^GOSUB\s*(\d+)$/.exec(s))) { this.subs.push(ctl.here()); ctl.goto = +m[1]; return; }
    if (s === 'RETURN') { const r = this.subs.pop(); if (!r) this.err('RETURN WITHOUT GOSUB'); ctl.jump = r; return; }
    if ((m = /^FOR\s*([A-Z][A-Z0-9]*%?)\s*=\s*(.+?)\s*TO\s*(.+?)(?:\s*STEP\s*(.+))?$/.exec(s))) {
      this.vars[m[1]] = this.num(this.eval(m[2]));
      this.fors = this.fors.filter(f => f.v !== m[1]);
      this.fors.push({ v: m[1], to: this.num(this.eval(m[3])), step: m[4] ? this.num(this.eval(m[4])) : 1, at: ctl.here() });
      return;
    }
    if ((m = /^NEXT\s*(.*)$/.exec(s))) {
      for (const name of m[1].trim() ? m[1].split(',').map(x => x.trim()) : [null]) {
        let f = this.fors.at(-1);
        if (name) { while (f && f.v !== name) { this.fors.pop(); f = this.fors.at(-1); } }
        if (!f) this.err('NEXT WITHOUT FOR');
        this.vars[f.v] += f.step;
        if (f.step >= 0 ? this.vars[f.v] <= f.to : this.vars[f.v] >= f.to) { ctl.jump = f.at; return; }
        this.fors.pop();
      }
      return;
    }
    if ((m = /^DIM\s*(.+)$/.exec(s))) { for (const d of this.split(m[1], ',')) { const mm = /^\s*([A-Z][A-Z0-9]*[$%]?)\s*\((.+)\)\s*$/.exec(d); if (!mm) this.err('SYNTAX'); if (this.arrs[mm[1]]) this.err('REDIM\'D ARRAY'); this.arrs[mm[1]] = { dims: this.split(mm[2], ',').map(e => Math.floor(this.num(this.eval(e)))), v: {} }; } return; }
    if (/^DATA\b/.test(s)) return;
    if ((m = /^READ\s*(.+)$/.exec(s))) {
      if (!this.data) { this.data = []; for (const [, text] of [...this.prog].sort((a, b) => a[0] - b[0])) for (const part of this.split(text, ':')) { const dm = /^\s*DATA\s*(.*)$/.exec(part); if (dm) this.data.push(...this.split(dm[1], ',').map(x => x.trim().replace(/^"|"$/g, ''))); } }
      for (const n of this.split(m[1], ',')) { if (this.dp >= this.data.length) this.err('OUT OF DATA'); const raw = this.data[this.dp++]; this.assign(n, n.trim().endsWith('$') ? raw : parseFloat(raw) || 0); }
      return;
    }
    if (s === 'RESTORE') { this.dp = 0; return; }
    if (s === 'END' || s === 'STOP') { ctl.end = true; if (s === 'STOP') ctl.brk = true; return; }
    if (s === 'HOME' || s === 'TEXT' || s === 'CLS' || /^CALL\s*-936$/.test(s)) { this.term.clear(); this.col = 0; return; }
    if (s === 'INVERSE') return void this.term.write('\x1b[7m');
    if (s === 'NORMAL') return void this.term.write('\x1b[0m');
    if ((m = /^HTAB\s*(.+)$/.exec(s))) { const n = Math.max(1, Math.floor(this.num(this.eval(m[1])))); this.term.write(`\x1b[${n}G`); this.col = n - 1; return; }
    if (/^(VTAB|FLASH|SPEED|POKE|CALL|GR|HGR|COLOR|HCOLOR|PLOT|HPLOT|HLIN|VLIN|PR#|IN#|TRACE|NOTRACE|CLEAR|ONERR|DEF)\b/.test(s)) { if (s === 'CLEAR') this.reset(); return; }
    if ((m = /^(?:LET\s*)?([A-Z][A-Z0-9]*[$%]?\s*(?:\(.*?\))?)\s*=\s*(.+)$/.exec(s))) return this.assign(m[1], this.eval(m[2]));
    this.err('SYNTAX');
  }

  async run(immediate) {
    const lines = [...this.prog].sort((a, b) => a[0] - b[0]).map(([n, text]) => ({ n, parts: this.split(text, ':') }));
    const find = n => { const k = lines.findIndex(l => l.n === n); if (k < 0) this.err("UNDEF'D STATEMENT"); return k; };
    if (!immediate) { this.reset(); if (!lines.length) return; }
    // pos.li < 0 means "immediate mode"; pos.parts may also be the tail of an IF ... THEN line
    let pos = immediate ? { parts: this.split(immediate, ':'), si: 0, li: -1 } : { parts: lines[0].parts, si: 0, li: 0 }, count = 0, lineNo = null;
    const goLine = k => { pos = { parts: lines[k].parts, si: 0, li: k }; };
    this.brk = false;
    const pop = this.term.pushHandler(ev => { if (ev.ctrl && ev.key === 'c') this.brk = true; return true; });
    try {
      for (;;) {
        if (pos.si >= pos.parts.length) { if (pos.li < 0 || pos.li + 1 >= lines.length) break; goLine(pos.li + 1); continue; }
        lineNo = pos.li >= 0 ? lines[pos.li].n : null;
        const text = pos.parts[pos.si], isIf = /^\s*IF\b/.test(text), at = pos;
        const ctl = { here: () => ({ parts: at.parts, si: at.si + 1, li: at.li }) };
        await this.stmt(isIf ? pos.parts.slice(pos.si).join(':') : text, ctl);
        if (ctl.brk || this.brk) { this.out(`\nBREAK${lineNo !== null ? ' IN ' + lineNo : ''}\n`); break; }
        if (ctl.end) break;
        if (ctl.goto !== undefined) goLine(find(ctl.goto));
        else if (ctl.jump) pos = { ...ctl.jump };
        else if (ctl.inject !== undefined) pos = { parts: this.split(ctl.inject, ':'), si: 0, li: pos.li };
        else if (ctl.skipLine || isIf) pos.si = pos.parts.length;
        else pos.si++;
        if (++count % 300 === 0) await new Promise(r => setTimeout(r));
      }
    } catch (e) {
      if (!(e instanceof BasicError)) throw e;
      sound.fx('beep');
      this.out(`\n?${e.message} ERROR${lineNo !== null ? ' IN ' + lineNo : ''}\n`);
    } finally { pop(); this.term.write('\x1b[0m'); }
  }

  async command(raw) {
    const line = upper(raw).trim();
    if (!line) return;
    let m;
    if ((m = /^(\d+)\s*(.*)$/.exec(line))) { if (m[2]) this.prog.set(+m[1], m[2]); else this.prog.delete(+m[1]); return; }
    const name = s => s.trim().replace(/^"|"$/g, '');
    try {
      if ((m = /^LIST\s*(\d+)?\s*[-,]?\s*(\d+)?$/.exec(line))) { const a = m[1] ? +m[1] : 0, b = m[2] ? +m[2] : m[1] && !/[-,]/.test(line) ? a : 1e9; for (const [n, t] of [...this.prog].sort((x, y) => x[0] - y[0])) if (n >= a && n <= b) this.out(`${n}  ${t}\n`); return; }
      if (line === 'NEW') { this.prog.clear(); this.reset(); return; }
      if ((m = /^RUN\s+(\S.*)$/.exec(line)) && !/^\d+$/.test(m[1])) { await this.command('LOAD ' + m[1]); return this.run(); }
      if (line === 'RUN') return this.run();
      if (line === 'CATALOG' || line === 'CAT' || line === 'DIR') { this.out('\nDISK VOLUME 254\n\n'); for (const f of this.fs.readdir('/')) this.out(` ${/^\d+\s/m.test(this.fs.read('/' + f)) ? 'A' : 'T'} ${String(Math.max(2, Math.ceil(this.fs.read('/' + f).length / 256) + 1)).padStart(3, '0')} ${f}\n`); this.out('\n'); return; }
      if ((m = /^LOAD\s+(.+)$/.exec(line))) { const f = '/' + name(m[1]); if (!this.fs.isFile(f)) this.err('FILE NOT FOUND'); const text = this.fs.read(f); if (!/^\d+\s/m.test(text)) { this.out(text.endsWith('\n') ? text : text + '\n'); return; } this.prog.clear(); this.reset(); for (const l of upper(text).split('\n')) { const mm = /^(\d+)\s*(.+)$/.exec(l.trim()); if (mm) this.prog.set(+mm[1], mm[2]); } return; }
      if ((m = /^SAVE\s+(.+)$/.exec(line))) { this.fs.write('/' + name(m[1]), [...this.prog].sort((x, y) => x[0] - y[0]).map(([n, t]) => `${n} ${t}\n`).join('')); return; }
      if ((m = /^(?:DELETE|UNLOCK)\s+(.+)$/.exec(line))) { const f = '/' + name(m[1]); if (!this.fs.isFile(f)) this.err('FILE NOT FOUND'); this.fs.unlink(f); return; }
      if ((m = /^DEL\s*(\d+)\s*,\s*(\d+)$/.exec(line))) { for (const n of [...this.prog.keys()]) if (n >= +m[1] && n <= +m[2]) this.prog.delete(n); return; }
      if ((m = /^(?:TYPE|CAT)\s+(.+)$/.exec(line))) { const f = '/' + name(m[1]); if (!this.fs.isFile(f)) this.err('FILE NOT FOUND'); const t = this.fs.read(f); this.out(t.endsWith('\n') ? t : t + '\n'); return; }
      if ((m = /^(?:VIM|VI|EDIT)\s*(.*)$/.exec(line))) { await runVim({ term: this.term, fs: this.fs, cwd: '/', home: '/', vars: {} }, m[1] ? [name(m[1])] : []); return; }
      if (line === 'HELP') { this.out('\nBASIC:  PRINT INPUT LET IF..THEN GOTO GOSUB\n        RETURN FOR..NEXT DIM DATA READ END\n        HOME INVERSE NORMAL HTAB GET REM\nFUNCS:  INT RND ABS SQR SIN COS LEN VAL\n        STR$ CHR$ ASC LEFT$ RIGHT$ MID$ TAB\nSYSTEM: LIST RUN NEW CATALOG LOAD SAVE\n        DELETE TYPE VIM BYE  (CTRL+C: BREAK)\n\n'); return; }
      if (/^(BYE|EXIT|QUIT)$/.test(line)) return this.hooks.power('poweroff');
      if (/^PR#\s*6$/.test(line)) return this.hooks.power('reboot');
    } catch (e) { if (!(e instanceof BasicError)) throw e; sound.fx('beep'); this.out(`\n?${e.message} ERROR\n`); return; }
    await this.run(line);
  }
}

export class Apple2 {
  constructor(mount, onExit) {
    this.id = 'apple2'; this.onExit = onExit;
    this.fs = new VFS({ storeKey: 'apple2:fs', ci: true, perms: false, user: 'root', seed: apple2Seed, version: 1 });
    this.root = h('div', { class: 'machine os-dos os-apple2' });
    mount.append(this.root);
    this._unload = e => { if (this.running) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', this._unload);
  }
  async start({ fast = false } = {}) {
    const host = h('div', { class: 'dos-screen tint-green' });
    this.root.append(h('div', { class: 'dos-bar' }, h('span', null, 'Apple II 風マシン ／ 非公式シミュレータ　　HELP でコマンド一覧'), h('span', { class: 'dos-bar-btns' }, h('button', { type: 'button', onClick: () => { host.classList.toggle('tint-green'); host.classList.toggle('tint-white'); term.focus(); } }, '画面の色'), h('button', { type: 'button', onClick: () => this.power('poweroff') }, '電源を切る'))), host, h('div', { class: 'dos-scan' }));
    const term = this.term = new Terminal(host, { class: 'term-dos term-a2' });
    term.onBell = () => sound.fx('beep');
    host.addEventListener('pointerdown', () => { sound.unlock(); setTimeout(() => term.focus(), 0); });
    term.focus();
    this.running = true;
    const basic = new Basic(term, this.fs, { power: k => this.power(k) });
    if (!fast) { await sleep(500); sound.fx('beep'); }
    term.write(`${' '.repeat(Math.max(0, Math.floor((Math.min(term.cols, 40) - 6) / 2)))}WEB ][\n\n`);
    if (!fast) await sleep(600);
    if (this.fs.isFile('/HELLO')) { await basic.command('LOAD HELLO'); await basic.run(); basic.prog.clear(); term.write('\n'); }
    while (this.running) {
      const line = await term.readLine({ prompt: ']', history: this.hist ||= [] });
      if (line === INTR || line === null) continue;
      if (line.trim() && this.hist.at(-1) !== line) this.hist.push(line);
      basic.col = 0;
      await basic.command(line);
    }
  }
  async power(kind) {
    if (this.off) return;
    this.off = true; this.running = false;
    this.fs.save();
    this.root.classList.add('crt-off');
    await sleep(650);
    window.removeEventListener('beforeunload', this._unload);
    this.onExit(kind);
  }
}
