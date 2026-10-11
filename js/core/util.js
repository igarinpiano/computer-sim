// Small shared helpers (DOM-free where possible so the shells can be tested in Node).

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') { for (const [p, x] of Object.entries(v)) { if (p.startsWith('--')) el.style.setProperty(p, x); else el.style[p] = x; } }
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) el.append(k.nodeType ? k : String(k));
  return el;
}

export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const pad2 = n => String(n).padStart(2, '0');
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];

export class Emitter {
  constructor() { this._ev = {}; }
  on(e, f) { (this._ev[e] ||= []).push(f); return () => this.off(e, f); }
  off(e, f) { this._ev[e] = (this._ev[e] || []).filter(x => x !== f); }
  emit(e, ...a) { for (const f of [...(this._ev[e] || [])]) f(...a); }
}

export function fmtBytes(n, si = false) {
  if (n < 1024) return n + (si ? ' B' : ' バイト');
  const u = ['KB', 'MB', 'GB', 'TB'];
  let i = -1;
  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
  return (n < 10 ? n.toFixed(1) : Math.round(n)) + ' ' + u[i];
}

// East Asian wide characters take two terminal cells.
export function wcwidth(ch) {
  const c = ch.codePointAt(0);
  if (c < 0x1100) return c === 0 ? 0 : 1;
  if ((c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd)) return 2;
  return 1;
}
export function strWidth(s) { let w = 0; for (const ch of s) w += wcwidth(ch); return w; }
export function padEndW(s, w) { const n = w - strWidth(s); return n > 0 ? s + ' '.repeat(n) : s; }
export function padStartW(s, w) { const n = w - strWidth(s); return n > 0 ? ' '.repeat(n) + s : s; }

// Shell-style glob -> RegExp.
export function globToRe(glob, { ci = false, full = true, path = false } = {}) {
  let re = '';
  const any = path ? '[^/]' : '[\\s\\S]';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') re += any + '*';
    else if (c === '?') re += any;
    else if (c === '[') {
      const j = glob.indexOf(']', i + 2);
      if (j < 0) { re += '\\['; continue; }
      let body = glob.slice(i + 1, j);
      if (body[0] === '!' || body[0] === '^') body = '^' + body.slice(1);
      re += '[' + body.replace(/\\/g, '\\\\') + ']';
      i = j;
    } else if (c === '\\' && i + 1 < glob.length) re += glob[++i].replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
    else re += c.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
  }
  return new RegExp(full ? '^' + re + '$' : re, ci ? 'i' : '');
}
export const hasGlob = s => /(^|[^\\])[*?[]/.test(s);

// C-like arithmetic used by $(( )), expr, set /a, bc and the calculator.
// env: { get(name) -> value, set(name, value), int: bool }
export function evalArith(src, env = {}) {
  const int = env.int !== false;
  const toks = [];
  const re = /(0[xX][0-9a-fA-F]+|\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+|[A-Za-z_]\w*|\*\*=?|<<=?|>>=?|&&|\|\||[-+*\/%&|^]=|[<>=!]=|\+\+|--|[-+*\/%()<>!~?:&|^=,])/y;
  let p = 0;
  while (true) {
    while (p < src.length && /\s/.test(src[p])) p++;
    if (p >= src.length) break;
    re.lastIndex = p;
    const m = re.exec(src);
    if (!m) throw new Error(`syntax error: operand expected (error token is "${src.slice(p)}")`);
    toks.push(m[1]); p = re.lastIndex;
  }
  let i = 0;
  const get = n => { const v = env.get ? env.get(n) : undefined; const x = int ? parseInt(v, 10) : parseFloat(v); return Number.isFinite(x) ? x : 0; };
  const set = (n, v) => { if (env.set) env.set(n, v); return v; };
  const fix = v => (int ? Math.trunc(v) : v);
  const BIN = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '<=', '>', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
  const apply = (op, a, b) => {
    switch (op) {
      case '||': return a || b ? 1 : 0; case '&&': return a && b ? 1 : 0;
      case '|': return a | b; case '^': return a ^ b; case '&': return a & b;
      case '==': return a === b ? 1 : 0; case '!=': return a !== b ? 1 : 0;
      case '<': return a < b ? 1 : 0; case '<=': return a <= b ? 1 : 0;
      case '>': return a > b ? 1 : 0; case '>=': return a >= b ? 1 : 0;
      case '<<': return a << b; case '>>': return a >> b;
      case '+': return a + b; case '-': return a - b; case '*': return a * b;
      case '/': if (b === 0) throw new Error('division by 0'); return fix(a / b);
      case '%': if (b === 0) throw new Error('division by 0'); return a % b;
      case '**': return fix(Math.pow(a, b));
    }
  };
  const isId = t => t !== undefined && /^[A-Za-z_]/.test(t);
  function primary() {
    const t = toks[i++];
    if (t === undefined) throw new Error('syntax error: operand expected');
    if (t === '(') { const v = comma(); if (toks[i++] !== ')') throw new Error("syntax error: missing `)'"); return v; }
    if (/^0[xX]/.test(t)) return parseInt(t, 16);
    if (/^[\d.]/.test(t)) return int ? (t.length > 1 && t[0] === '0' && /^[0-7]+$/.test(t) ? parseInt(t, 8) : parseInt(t, 10)) : parseFloat(t);
    if (isId(t)) {
      if (toks[i] === '++' || toks[i] === '--') { const v = get(t); set(t, v + (toks[i++] === '++' ? 1 : -1)); return v; }
      if (!int && toks[i] === '(' && typeof Math[t] === 'function') { i++; const a = comma(); if (toks[i++] !== ')') throw new Error('syntax error'); return Math[t](a); }
      return get(t);
    }
    throw new Error(`syntax error: operand expected (error token is "${t}")`);
  }
  function unary() {
    const t = toks[i];
    if (t === '-') { i++; return -unary(); }
    if (t === '+') { i++; return +unary(); }
    if (t === '!') { i++; return unary() ? 0 : 1; }
    if (t === '~') { i++; return ~unary(); }
    if ((t === '++' || t === '--') && isId(toks[i + 1])) { i++; const n = toks[i++]; return set(n, get(n) + (t === '++' ? 1 : -1)); }
    const base = primary();
    if (toks[i] === '**') { i++; return apply('**', base, unary()); }
    return base;
  }
  function binary(level) {
    if (level >= BIN.length) return unary();
    let a = binary(level + 1);
    while (BIN[level].includes(toks[i])) { const op = toks[i++]; a = apply(op, a, binary(level + 1)); }
    return a;
  }
  function ternary() {
    const c = binary(0);
    if (toks[i] === '?') { i++; const a = assign(); if (toks[i++] !== ':') throw new Error("syntax error: `:' expected"); const b = assign(); return c ? a : b; }
    return c;
  }
  function assign() {
    if (isId(toks[i]) && /^(=|[-+*\/%&|^]=|<<=|>>=|\*\*=)$/.test(toks[i + 1] || '')) {
      const n = toks[i], op = toks[i + 1]; i += 2;
      const v = assign();
      return set(n, op === '=' ? v : apply(op.slice(0, -1), get(n), v));
    }
    return ternary();
  }
  function comma() { let v = assign(); while (toks[i] === ',') { i++; v = assign(); } return v; }
  if (!toks.length) return 0;
  const v = comma();
  if (i < toks.length) throw new Error(`syntax error in expression (error token is "${toks.slice(i).join(' ')}")`);
  return v;
}

export function tzName(d = new Date()) {
  const o = -d.getTimezoneOffset();
  if (o === 540) return 'JST';
  if (o === 0) return 'UTC';
  return (o < 0 ? '-' : '+') + pad2(Math.abs(o) / 60 | 0);
}
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
// strftime subset.
export function strftime(fmt, d = new Date()) {
  return fmt.replace(/%([a-zA-Z%])/g, (_, c) => {
    switch (c) {
      case 'Y': return d.getFullYear(); case 'y': return pad2(d.getFullYear() % 100);
      case 'm': return pad2(d.getMonth() + 1); case 'd': return pad2(d.getDate());
      case 'e': return String(d.getDate()).padStart(2, ' ');
      case 'H': return pad2(d.getHours()); case 'M': return pad2(d.getMinutes()); case 'S': return pad2(d.getSeconds());
      case 'I': return pad2(d.getHours() % 12 || 12); case 'p': return d.getHours() < 12 ? 'AM' : 'PM';
      case 'b': case 'h': return MON[d.getMonth()]; case 'B': return d.toLocaleString('en-US', { month: 'long' });
      case 'a': return DAY[d.getDay()]; case 'A': return d.toLocaleString('en-US', { weekday: 'long' });
      case 'Z': return tzName(d); case 'z': { const o = -d.getTimezoneOffset(); return (o < 0 ? '-' : '+') + pad2(Math.abs(o) / 60 | 0) + pad2(Math.abs(o) % 60); }
      case 's': return Math.floor(d / 1000); case 'j': return String(Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5)).padStart(3, '0');
      case 'u': return d.getDay() || 7; case 'w': return d.getDay();
      case 'F': return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      case 'T': return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
      case 'R': return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
      case 'D': return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${pad2(d.getFullYear() % 100)}`;
      case 'c': return strftime('%a %b %e %H:%M:%S %Y', d);
      case 'n': return '\n'; case 't': return '\t'; case '%': return '%';
      default: return '%' + c;
    }
  });
}

// Lay out names in columns like ls / dir /w.
export function columnize(items, width, gap = 2) {
  if (!items.length) return '';
  const lens = items.map(s => strWidth(s.replace(/\x1b\[[0-9;]*m/g, '')));
  const n = items.length;
  let best = { cols: 1, widths: [Math.max(...lens)] };
  for (let cols = Math.min(n, Math.floor(width / 2) || 1); cols > 1; cols--) {
    const rows = Math.ceil(n / cols);
    const widths = [];
    for (let c = 0; c < cols; c++) { let w = 0; for (let r = 0; r < rows; r++) { const k = c * rows + r; if (k < n) w = Math.max(w, lens[k]); } widths.push(w); }
    if (Math.ceil(n / rows) !== cols) continue;
    if (widths.reduce((a, b) => a + b, 0) + gap * (cols - 1) <= width) { best = { cols, widths }; break; }
  }
  const rows = Math.ceil(n / best.cols);
  const out = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < best.cols; c++) {
      const k = c * rows + r;
      if (k >= n) continue;
      const last = c === best.cols - 1 || k + rows >= n;
      line += items[k] + (last ? '' : ' '.repeat(best.widths[c] - lens[k] + gap));
    }
    out.push(line);
  }
  return out.join('\n') + '\n';
}

export function download(name, data, type = 'text/plain') {
  const a = h('a', { href: URL.createObjectURL(new Blob([data], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
