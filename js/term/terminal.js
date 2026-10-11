// Terminal emulator widget: scrollback "line mode" with a readline, plus an alternate
// full-screen cell grid used by vim, less, top, nano and friends.

import { h, esc, wcwidth, columnize } from '../core/util.js';

export const INTR = Symbol('intr');

const PALETTE = ['#2e3436', '#cc0000', '#4e9a06', '#c4a000', '#3465a4', '#75507b', '#06989a', '#d3d7cf',
  '#555753', '#ef2929', '#8ae234', '#fce94f', '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec'];
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export class Terminal {
  constructor(host, opts = {}) {
    this.palette = opts.palette || PALETTE;
    this.out = h('div', { class: 'term-out' });
    this.active = h('div', { class: 'term-line' });
    this.scroll = h('div', { class: 'term-scroll' }, this.out, this.active);
    this.altEl = h('div', { class: 'term-alt', hidden: true });
    this.ta = h('textarea', { class: 'term-input', autocapitalize: 'off', autocomplete: 'off', autocorrect: 'off', spellcheck: 'false', 'aria-label': 'terminal input' });
    this.meas = h('span', { class: 'term-measure' }, 'M'.repeat(20));
    this.el = h('div', { class: 'term ' + (opts.class || '') }, this.scroll, this.altEl, this.ta, this.meas);
    host.append(this.el);

    this.line = []; this.col = 0;           // cells of the line being written
    this.pending = [];                       // finished lines waiting for the next frame
    this.sgr = {}; this.curSt = null; this.styles = new Map();
    this.handlers = []; this.typeahead = [];
    this.rl = null; this.altOn = false; this.resizeCbs = new Set();
    this.cols = 80; this.rows = 24; this.maxLines = opts.scrollback || 3000;
    this.cursorOn = true;

    this.el.addEventListener('mouseup', () => { if (!String(getSelection())) this.focus(); });
    this.ta.addEventListener('keydown', e => this._keydown(e));
    this.ta.addEventListener('input', () => { if (!this.composing) this._takeInput(); });
    this.ta.addEventListener('compositionstart', () => { this.composing = true; this.ta.classList.add('composing'); });
    this.ta.addEventListener('compositionend', () => { this.composing = false; this.ta.classList.remove('composing'); this._takeInput(); });
    this.ta.addEventListener('focus', () => this.el.classList.add('focused'));
    this.ta.addEventListener('blur', () => this.el.classList.remove('focused'));
    this.altEl.addEventListener('wheel', e => {
      e.preventDefault();
      this._dispatch({ key: e.deltaY < 0 ? 'WheelUp' : 'WheelDown' });
    }, { passive: false });
    this.ro = new ResizeObserver(() => this._measure());
    this.ro.observe(this.el);
    this._measure();
  }

  destroy() { this.ro.disconnect(); this.dead = true; }
  focus() { this.ta.focus({ preventScroll: true }); }

  // ---- geometry ----
  _measure() {
    const r = this.meas.getBoundingClientRect();
    if (!r.width) return;
    this.cw = r.width / 20; this.lh = r.height;
    const cs = getComputedStyle(this.el);
    const w = this.el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const hgt = this.el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const cols = Math.max(20, Math.floor(w / this.cw)), rows = Math.max(4, Math.floor(hgt / this.lh));
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols; this.rows = rows;
    if (this.altOn) this._buildGrid();
    for (const cb of this.resizeCbs) cb(cols, rows);
  }
  onResize(cb) { this.resizeCbs.add(cb); return () => this.resizeCbs.delete(cb); }

  // ---- styles ----
  color(n) {
    if (n < 16) return this.palette[n];
    if (n < 232) { n -= 16; const v = x => (x ? 55 + x * 40 : 0); return `rgb(${v(n / 36 | 0)},${v((n / 6 | 0) % 6)},${v(n % 6)})`; }
    const g = 8 + (n - 232) * 10; return `rgb(${g},${g},${g})`;
  }
  // style({fg, bg, b, i, u, inv, dim}) -> cached object; fg/bg are palette indexes or CSS colors.
  style(s) {
    const key = `${s.fg ?? ''}|${s.bg ?? ''}|${s.b ? 1 : ''}${s.i ? 2 : ''}${s.u ? 3 : ''}${s.inv ? 4 : ''}${s.dim ? 5 : ''}`;
    let st = this.styles.get(key);
    if (!st) {
      const col = c => (c == null ? null : typeof c === 'number' ? this.color(c) : c);
      let f = col(s.fg), b = col(s.bg);
      if (s.inv) [f, b] = [b || 'var(--term-bg)', f || 'var(--term-fg)'];
      st = { css: (f ? `color:${f};` : '') + (b ? `background:${b};` : '') + (s.b ? 'font-weight:bold;' : '') + (s.i ? 'font-style:italic;' : '') + (s.u ? 'text-decoration:underline;' : '') + (s.dim ? 'opacity:.6;' : ''), raw: { ...s } };
      this.styles.set(key, st);
    }
    return st;
  }
  setColors(fg, bg) {
    if (fg) this.el.style.setProperty('--term-fg', fg); else this.el.style.removeProperty('--term-fg');
    if (bg) this.el.style.setProperty('--term-bg', bg); else this.el.style.removeProperty('--term-bg');
  }

  _html(cells, cur = -1) {
    let html = '', run = '', st = null;
    const flush = () => { if (run) { html += st && st.css ? `<span style="${st.css}">${esc(run)}</span>` : esc(run); run = ''; } };
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (i === cur) { flush(); html += `<span class="term-cursor">${esc(c.ch || ' ')}</span>`; continue; }
      if (c.ch === '') continue;
      if (c.st !== st) { flush(); st = c.st; }
      run += c.ch;
    }
    flush();
    return html;
  }

  // ---- line mode output ----
  write(str) {
    if (!str) return;
    str = String(str);
    for (let i = 0; i < str.length; i++) {
      let ch = str[i];
      const code = ch.charCodeAt(0);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) ch += str[++i];
      if (ch === '\n') this._newline();
      else if (ch === '\r') this.col = 0;
      else if (ch === '\b') this.col = Math.max(0, this.col - 1);
      else if (ch === '\t') { const n = 8 - (this.col % 8); for (let k = 0; k < n; k++) this._put(' '); }
      else if (ch === '\x07') this.bell();
      else if (ch === '\x1b') i = this._escape(str, i);
      else if (code >= 32) this._put(ch);
    }
    this._schedule();
  }
  _put(ch) {
    while (this.line.length < this.col) this.line.push({ ch: ' ', st: null });
    this.line[this.col++] = { ch, st: this.curSt };
  }
  _newline() {
    this.pending.push(`<div class="term-line">${this._html(this.line)}</div>`);
    this.line = []; this.col = 0;
  }
  _escape(str, i) {
    const c = str[i + 1];
    if (c === '[') {
      let j = i + 2;
      while (j < str.length && !/[@-~]/.test(str[j])) j++;
      const args = str.slice(i + 2, j), fin = str[j];
      if (fin === 'm') this._sgr(args);
      else if (fin === 'K') this.line.length = Math.min(this.line.length, this.col);
      else if (fin === 'J') { if (args === '2' || args === '3') this.clear(); }
      else if (fin === 'G') this.col = Math.max(0, (parseInt(args, 10) || 1) - 1);
      return j;
    }
    if (c === ']') {   // OSC: window title
      let j = i + 2;
      while (j < str.length && str[j] !== '\x07' && str[j] !== '\x1b') j++;
      const m = /^[012];(.*)$/s.exec(str.slice(i + 2, j));
      if (m && this.onTitle) this.onTitle(m[1]);
      return str[j] === '\x1b' ? j + 1 : j;
    }
    return i + 1;
  }
  _sgr(args) {
    const a = args === '' ? [0] : args.split(';').map(x => parseInt(x, 10) || 0);
    const s = this.sgr;
    for (let k = 0; k < a.length; k++) {
      const n = a[k];
      if (n === 0) { for (const key of Object.keys(s)) delete s[key]; }
      else if (n === 1) s.b = true; else if (n === 2) s.dim = true; else if (n === 3) s.i = true;
      else if (n === 4) s.u = true; else if (n === 7) s.inv = true;
      else if (n === 22) { s.b = s.dim = false; } else if (n === 23) s.i = false; else if (n === 24) s.u = false; else if (n === 27) s.inv = false;
      else if (n >= 30 && n <= 37) s.fg = n - 30; else if (n >= 90 && n <= 97) s.fg = n - 82;
      else if (n >= 40 && n <= 47) s.bg = n - 40; else if (n >= 100 && n <= 107) s.bg = n - 92;
      else if (n === 39) delete s.fg; else if (n === 49) delete s.bg;
      else if (n === 38 || n === 48) {
        const key = n === 38 ? 'fg' : 'bg';
        if (a[k + 1] === 5) { s[key] = a[k + 2]; k += 2; }
        else if (a[k + 1] === 2) { s[key] = `rgb(${a[k + 2]},${a[k + 3]},${a[k + 4]})`; k += 4; }
      }
    }
    this.curSt = Object.values(s).some(v => v !== false && v != null) ? this.style(s) : null;
  }
  clear() { this.out.innerHTML = ''; this.pending = []; this.line = []; this.col = 0; this._schedule(); }
  bell() { this.el.classList.add('bell'); setTimeout(() => this.el.classList.remove('bell'), 120); if (this.onBell) this.onBell(); }

  _schedule() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._render(); });
    // Background tabs throttle rAF heavily; make sure output still lands.
    clearTimeout(this._rt); this._rt = setTimeout(() => { if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; this._render(); } }, 120);
  }
  _render() {
    if (this.pending.length) {
      this.out.insertAdjacentHTML('beforeend', this.pending.join(''));
      this.pending = [];
      let extra = this.out.childElementCount - this.maxLines;
      if (extra > 0) { const r = document.createRange(); r.setStartBefore(this.out.firstChild); r.setEndAfter(this.out.children[extra - 1]); r.deleteContents(); }
    }
    const rl = this.rl;
    let html;
    if (rl && rl.search) {
      html = this._html(this.line.slice(0, rl.pre)) + esc(`(reverse-i-search)\`${rl.search.q}': `) + esc(rl.buf.slice(0, rl.pos)) +
        `<span class="term-cursor">${esc(rl.buf[rl.pos] || ' ')}</span>` + esc(rl.buf.slice(rl.pos + 1));
    } else if (rl && !rl.mask) {
      html = this._html(this.line) + esc(rl.buf.slice(0, rl.pos).join('')) +
        `<span class="term-cursor">${esc(rl.buf[rl.pos] || ' ')}</span>` + esc(rl.buf.slice(rl.pos + 1).join(''));
    } else {
      html = this._html(this.line, this.cursorOn && this.col < this.line.length ? this.col : -1);
      if (this.cursorOn && this.col >= this.line.length) html += '<span class="term-cursor"> </span>';
    }
    this.active.innerHTML = html;
    if (!this.altOn) { this.scroll.scrollTop = this.scroll.scrollHeight; this._placeInput(this.active.querySelector('.term-cursor')); }
  }
  _placeInput(cur) {
    if (!cur) return;
    const a = cur.getBoundingClientRect(), b = this.el.getBoundingClientRect();
    this.ta.style.left = Math.max(0, a.left - b.left) + 'px';
    this.ta.style.top = Math.max(0, a.top - b.top) + 'px';
  }

  // ---- keyboard ----
  pushHandler(fn) {
    this.handlers.push(fn);
    return () => { const i = this.handlers.lastIndexOf(fn); if (i >= 0) this.handlers.splice(i, 1); };
  }
  _dispatch(ev) {
    const fn = this.handlers[this.handlers.length - 1];
    if (!fn) { this.typeahead.push(ev); return true; }
    return fn(ev);
  }
  _keydown(e) {
    if (e.isComposing || e.keyCode === 229 || e.metaKey) return;
    let k = e.key;
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Dead', 'Process', 'Unidentified'].includes(k)) return;
    if (e.ctrlKey && e.shiftKey && k.toLowerCase() === 'c') { e.preventDefault(); navigator.clipboard?.writeText(String(getSelection())).catch(() => {}); return; }
    if (e.ctrlKey && e.shiftKey && k.toLowerCase() === 'v') return;
    if (k.length === 1 && !e.ctrlKey && (!e.altKey || IS_MAC)) return;       // printable -> input event (IME friendly)
    if (e.altKey && /^Key[A-Z]$/.test(e.code)) k = e.code[3].toLowerCase();
    if (k.length === 1) k = k.toLowerCase();
    const handled = this._dispatch({ key: k, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey });
    if (handled !== false) e.preventDefault();
  }
  _takeInput() {
    const text = this.ta.value;
    this.ta.value = '';
    this.sendText(text);
  }
  sendText(text) {
    text = text.replace(/\r\n?/g, '\n');
    for (const ch of text) this._dispatch(ch === '\n' ? { key: 'Enter', pasted: text.length > 1 } : ch === '\t' ? { key: 'Tab', pasted: text.length > 1 } : { key: ch, text: true });
  }

  // Raw single key (for "press any key" prompts).
  readKey() {
    return new Promise(res => { const pop = this.pushHandler(ev => { pop(); res(ev); return true; }); });
  }

  // ---- readline ----
  // opts: { prompt, history, complete(line, pos) -> {start, items, dirs?}, cycle, mask, escClears }
  // Resolves to the line, null on EOF (Ctrl+D) or INTR on Ctrl+C.
  readLine(opts = {}) {
    return new Promise(resolve => {
      const rl = this.rl = { buf: [], pos: 0, hist: opts.history || [], hi: -1, saved: null, mask: !!opts.mask, pre: this.line.length, kill: '' };
      if (opts.prompt) { this.write(opts.prompt); rl.pre = Math.min(rl.pre, this.line.length); }
      rl.hi = rl.hist.length;
      const done = v => {
        pop(); this.rl = null;
        if (v !== INTR && !rl.mask) for (const ch of rl.buf) this._put(ch);
        if (v === INTR) { for (const ch of rl.buf) this._put(ch); this.write('^C'); }
        this.write('\n');
        resolve(v === undefined ? rl.buf.join('') : v);
      };
      const set = (s, pos) => { rl.buf = [...s]; rl.pos = pos ?? rl.buf.length; };
      const isWord = c => /[\w]/.test(c);
      const wordLeft = () => { let p = rl.pos; while (p > 0 && !isWord(rl.buf[p - 1])) p--; while (p > 0 && isWord(rl.buf[p - 1])) p--; return p; };
      const wordRight = () => { let p = rl.pos; while (p < rl.buf.length && !isWord(rl.buf[p])) p++; while (p < rl.buf.length && isWord(rl.buf[p])) p++; return p; };
      const histMove = d => {
        const n = rl.hi + d;
        if (n < 0 || n > rl.hist.length) return this.bell();
        if (rl.hi === rl.hist.length) rl.saved = rl.buf.join('');
        rl.hi = n;
        set(n === rl.hist.length ? rl.saved || '' : rl.hist[n]);
      };
      const searchStep = from => {
        const q = rl.search.q;
        for (let i = from; i >= 0; i--) if (rl.hist[i].includes(q)) { rl.search.idx = i; rl.buf = rl.hist[i]; rl.pos = rl.hist[i].indexOf(q); return; }
        this.bell();
      };
      const complete = async () => {
        if (!opts.complete) return;
        const line = rl.buf.join(''), before = rl.buf.slice(0, rl.pos).join('');
        if (opts.cycle) {   // cmd.exe style: every Tab swaps in the next match
          if (!rl.cyc || rl.cyc.line !== line) {
            const r = await opts.complete(before, before.length);
            if (!r || !r.items.length) return this.bell();
            rl.cyc = { ...r, i: -1, tail: rl.buf.slice(rl.pos).join('') };
          }
          const c = rl.cyc; c.i = (c.i + (rl.shiftTab ? -1 : 1) + c.items.length) % c.items.length;
          const head = before.slice(0, c.start) + c.items[c.i];
          set(head + c.tail, [...head].length); c.line = rl.buf.join('');
          return;
        }
        const r = await opts.complete(before, before.length);
        if (!r || !r.items.length) return this.bell();
        const word = before.slice(r.start);
        let common = r.items[0];
        for (const it of r.items) { let k = 0; while (k < common.length && common[k] === it[k]) k++; common = common.slice(0, k); }
        if (r.items.length === 1) common += r.suffix ? r.suffix(r.items[0]) : ' ';
        if (common.length > word.length) {
          const head = before.slice(0, r.start) + common;
          set(head + rl.buf.slice(rl.pos).join(''), [...head].length); rl.tabbed = false;
        } else if (rl.tabbed) {
          const saved = rl.buf, pos = rl.pos;
          for (const ch of rl.buf) this._put(ch);
          rl.buf = [];
          this.write('\n' + columnize((r.display || r.items).slice(0, 400), this.cols));
          rl.pre = this.line.length;
          if (opts.prompt) this.write(opts.prompt.slice(opts.prompt.lastIndexOf('\n') + 1));
          rl.buf = saved; rl.pos = pos;
        } else { rl.tabbed = true; this.bell(); }
      };
      const handler = ev => {
        const { key, ctrl, alt } = ev;
        if (rl.search) {
          if (ev.text) { rl.search.q += key; searchStep(rl.search.idx); }
          else if (key === 'Backspace') { rl.search.q = rl.search.q.slice(0, -1); searchStep(rl.hist.length - 1); }
          else if (ctrl && key === 'r') searchStep(rl.search.idx - 1);
          else {
            const s = typeof rl.buf === 'string' ? rl.buf : ''; rl.search = null; set(s);
            if (ctrl && (key === 'g' || key === 'c')) set('');
            else if (key !== 'Escape') { this._schedule(); return handler(ev); }
          }
          this._schedule(); return true;
        }
        if (key !== 'Tab') { rl.tabbed = false; if (!ev.pasted) rl.cyc = null; }
        if (ev.text) { rl.buf.splice(rl.pos++, 0, key); }
        else if (key === 'Enter') done();
        else if (ctrl && key === 'c') done(INTR);
        else if (ctrl && key === 'd') { if (!rl.buf.length) { done(null); } else rl.buf.splice(rl.pos, 1); }
        else if (ctrl && key === 'v') return false;
        else if (key === 'Backspace' || (ctrl && key === 'h')) {
          if (ctrl && key === 'Backspace') { const p = wordLeft(); rl.buf.splice(p, rl.pos - p); rl.pos = p; }
          else if (rl.pos > 0) rl.buf.splice(--rl.pos, 1);
        }
        else if (key === 'Delete') rl.buf.splice(rl.pos, 1);
        else if (key === 'ArrowLeft' || (ctrl && key === 'b')) rl.pos = ctrl && key !== 'b' ? wordLeft() : Math.max(0, rl.pos - 1);
        else if (key === 'ArrowRight' || (ctrl && key === 'f')) rl.pos = ctrl && key !== 'f' ? wordRight() : Math.min(rl.buf.length, rl.pos + 1);
        else if (alt && key === 'b') rl.pos = wordLeft();
        else if (alt && key === 'f') rl.pos = wordRight();
        else if (alt && key === 'd') { const p = wordRight(); rl.kill = rl.buf.splice(rl.pos, p - rl.pos).join(''); }
        else if (key === 'Home' || (ctrl && key === 'a')) rl.pos = 0;
        else if (key === 'End' || (ctrl && key === 'e')) rl.pos = rl.buf.length;
        else if (key === 'ArrowUp' || (ctrl && key === 'p')) histMove(-1);
        else if (key === 'ArrowDown' || (ctrl && key === 'n')) histMove(1);
        else if (ctrl && key === 'u') { rl.kill = rl.buf.splice(0, rl.pos).join(''); rl.pos = 0; }
        else if (ctrl && key === 'k') rl.kill = rl.buf.splice(rl.pos).join('');
        else if (ctrl && key === 'w') { let p = rl.pos; while (p > 0 && rl.buf[p - 1] === ' ') p--; while (p > 0 && rl.buf[p - 1] !== ' ') p--; rl.kill = rl.buf.splice(p, rl.pos - p).join(''); rl.pos = p; }
        else if (ctrl && key === 'y') { rl.buf.splice(rl.pos, 0, ...rl.kill); rl.pos += [...rl.kill].length; }
        else if (ctrl && key === 't') { if (rl.pos > 0 && rl.buf.length > 1) { const p = Math.min(rl.pos, rl.buf.length - 1); [rl.buf[p - 1], rl.buf[p]] = [rl.buf[p], rl.buf[p - 1]]; rl.pos = p + 1; } }
        else if (ctrl && key === 'l') { const b = rl.buf; rl.buf = []; this.clear(); rl.pre = 0; if (opts.prompt) this.write(opts.prompt.slice(opts.prompt.lastIndexOf('\n') + 1)); rl.buf = b; }
        else if (ctrl && key === 'r' && !opts.cycle) { rl.search = { q: '', idx: rl.hist.length }; rl.buf = rl.buf.join(''); rl.pos = 0; }
        else if (key === 'Escape') { if (opts.escClears) set(''); }
        else if (key === 'Tab') { rl.shiftTab = ev.shift; complete().then(() => this._schedule()); }
        else if (opts.onKey && opts.onKey(ev, rl) === true) { /* handled by caller */ }
        else return false;
        this._schedule();
        return true;
      };
      const pop = this.pushHandler(handler);
      this._schedule();
      // Replay keys typed while the previous command was still running.
      const q = this.typeahead; this.typeahead = [];
      while (q.length) { if (this.rl === rl) handler(q.shift()); else this.typeahead.push(q.shift()); }
    });
  }

  // ---- alternate screen ----
  enterAlt() {
    this.altOn = true;
    this.scroll.hidden = true; this.altEl.hidden = false;
    const t = this;
    this.screen = {
      get rows() { return t.rows; }, get cols() { return t.cols; },
      cursor: { r: 0, c: 0, shape: 'block', visible: true },
      clear(st = null) { for (const row of t.grid) for (let c = 0; c < row.length; c++) row[c] = { ch: ' ', st }; },
      // Writes text at (r, c), clipped to the row. Returns the next column.
      put(r, c, text, st = null) {
        const row = t.grid[r];
        if (!row) return c;
        for (const ch of text) {
          const w = wcwidth(ch);
          if (c + w > row.length) break;
          if (c >= 0) { row[c] = { ch, st }; if (w === 2) row[c + 1] = { ch: '', st }; }
          c += w;
        }
        return c;
      },
      fill(r, c, n, ch = ' ', st = null) { const row = t.grid[r]; if (row) for (let k = Math.max(0, c); k < Math.min(row.length, c + n); k++) row[k] = { ch, st }; },
      flush() { t._flushAlt(); },
      onResize: null,
    };
    this._buildGrid();
    return this.screen;
  }
  exitAlt() {
    this.altOn = false; this.screen = null; this.grid = null;
    this.altEl.hidden = true; this.altEl.innerHTML = ''; this.scroll.hidden = false;
    this._schedule();
  }
  _buildGrid() {
    this.grid = Array.from({ length: this.rows }, () => Array.from({ length: this.cols }, () => ({ ch: ' ', st: null })));
    this.altEl.innerHTML = '';
    this.rowEls = []; this.rowHtml = [];
    for (let r = 0; r < this.rows; r++) { const d = h('div', { class: 'term-row' }); this.rowEls.push(d); this.rowHtml.push(null); this.altEl.append(d); }
    if (this.screen && this.screen.onResize) this.screen.onResize(this.cols, this.rows);
  }
  _flushAlt() {
    if (!this.grid) return;
    const cur = this.screen.cursor;
    for (let r = 0; r < this.rows; r++) {
      const on = cur.visible && cur.r === r;
      const html = this._html(this.grid[r], on ? cur.c : -1) + (on ? `<!--${cur.shape}-->` : '');
      if (html !== this.rowHtml[r]) { this.rowHtml[r] = html; this.rowEls[r].innerHTML = html; }
    }
    this.altEl.dataset.cursor = cur.shape;
    if (cur.visible && this.rowEls[cur.r]) this._placeInput(this.rowEls[cur.r].querySelector('.term-cursor'));
  }
}
