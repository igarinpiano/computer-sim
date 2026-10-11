// A bash-compatible shell: lexer, recursive-descent parser, expansions, pipelines,
// redirections, control flow, functions, job control lite and readline completion.

import { evalArith, globToRe, hasGlob, strftime } from '../core/util.js';
import { FsError, errMsg, dirname, basename, join } from '../core/vfs.js';
import { INTR } from './terminal.js';
import { commands } from './coreutils.js';

export class Interrupt extends Error { }
class ShellExit extends Error { constructor(code) { super('exit'); this.code = code; } }
class Flow extends Error { constructor(kind, n = 1) { super(kind); this.kind = kind; this.n = n; } }
class Incomplete extends Error { }
class PipeFull extends Error { }

const PIPE_MAX = 400000;
const OPS = ['<<<', '&>>', '<<-', '&&', '||', ';;', '>>', '<<', '&>', '>&', '<&', '|&', '|', '&', ';', '(', ')', '<', '>'];
const REDIR = new Set(['<', '>', '>>', '<<', '<<-', '<<<', '&>', '&>>', '>&', '<&']);
const ARITH_PREV = new Set(['for', 'while', 'until', 'if', 'elif', 'then', 'do', 'else', '!', '{']);

// ---------------------------------------------------------------- lexer
function scanParen(s, i) {
  let depth = 0;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (c === "'") { const j = s.indexOf("'", i + 1); if (j < 0) throw new Incomplete(); i = j; continue; }
    if (c === '"') { i = scanDq(s, i) - 1; continue; }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i + 1;
  }
  throw new Incomplete();
}
function scanBrace(s, i) {
  let depth = 0;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (c === "'") { const j = s.indexOf("'", i + 1); if (j < 0) throw new Incomplete(); i = j; continue; }
    if (c === '"') { i = scanDq(s, i) - 1; continue; }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  throw new Incomplete();
}
function scanTick(s, i) {
  for (i++; i < s.length; i++) { if (s[i] === '\\') { i++; continue; } if (s[i] === '`') return i + 1; }
  throw new Incomplete();
}
function scanDq(s, i) {
  for (i++; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (c === '"') return i + 1;
    if (c === '$' && s[i + 1] === '(') { i = scanParen(s, i + 1) - 1; continue; }
    if (c === '`') { i = scanTick(s, i) - 1; continue; }
  }
  throw new Incomplete();
}
function scanWord(s, i) {
  while (i < s.length) {
    const c = s[i];
    if (c === '\\') { if (i + 1 >= s.length) throw new Incomplete(); i += 2; continue; }
    if (c === "'") { const j = s.indexOf("'", i + 1); if (j < 0) throw new Incomplete(); i = j + 1; continue; }
    if (c === '"') { i = scanDq(s, i); continue; }
    if (c === '`') { i = scanTick(s, i); continue; }
    if (c === '$') {
      if (s[i + 1] === '(') { i = scanParen(s, i + 1); continue; }
      if (s[i + 1] === '{') { i = scanBrace(s, i + 1); continue; }
      if (s[i + 1] === "'") { i += 2; while (i < s.length && s[i] !== "'") i += s[i] === '\\' ? 2 : 1; if (i >= s.length) throw new Incomplete(); i++; continue; }
      i++; continue;
    }
    if (' \t\n|&;()<>'.includes(c)) break;
    i++;
  }
  return i;
}
const unquote = w => w.replace(/\\(.)|'([^']*)'|"((?:\\.|[^"\\])*)"/gs, (m, a, b, c) => a ?? b ?? c.replace(/\\(.)/g, '$1'));

function lex(src) {
  const toks = [], heredocs = [];
  let i = 0, pendHd = null;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '\\' && src[i + 1] === '\n') { i += 2; continue; }
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '\n') {
      toks.push({ t: 'op', v: '\n' }); i++;
      while (heredocs.length) {
        const hd = heredocs.shift();
        let body = '', found = false;
        while (i < src.length) {
          let e = src.indexOf('\n', i); if (e < 0) e = src.length;
          let line = src.slice(i, e); i = Math.min(src.length, e + 1);
          if (hd.strip) line = line.replace(/^\t+/, '');
          if (line === hd.delim) { found = true; break; }
          body += line + '\n';
        }
        if (!found) throw new Incomplete();
        hd.tok.body = body;
      }
      continue;
    }
    const prev = toks[toks.length - 1];
    if (c === '(' && src[i + 1] === '(' && (!prev || prev.t === 'op' || (prev.t === 'w' && ARITH_PREV.has(prev.v)))) {
      let j;
      try { j = scanParen(src, i); } catch { throw new Incomplete(); }
      if (src[j - 2] === ')') { toks.push({ t: 'arith', v: src.slice(i + 2, j - 2) }); i = j; continue; }
    }
    const op = OPS.find(o => src.startsWith(o, i));
    if (op) {
      toks.push({ t: 'op', v: op }); i += op.length;
      if (op === '<<' || op === '<<-') pendHd = { strip: op === '<<-' };
      continue;
    }
    const start = i;
    i = scanWord(src, i);
    const raw = src.slice(start, i);
    if (/^\d+$/.test(raw) && (src[i] === '<' || src[i] === '>')) { toks.push({ t: 'io', v: +raw }); continue; }
    const tok = { t: 'w', v: raw };
    if (pendHd) { pendHd.delim = unquote(raw); pendHd.tok = tok; tok.quoted = /['"\\]/.test(raw); heredocs.push(pendHd); pendHd = null; }
    toks.push(tok);
  }
  if (heredocs.length) throw new Incomplete();
  return toks;
}

// ---------------------------------------------------------------- parser
class Parser {
  constructor(toks) { this.t = toks; this.i = 0; }
  peek() { return this.t[this.i]; }
  isOp(v) { const t = this.t[this.i]; return !!t && t.t === 'op' && (v === undefined || t.v === v); }
  isWord(v) { const t = this.t[this.i]; return !!t && t.t === 'w' && (v === undefined || t.v === v); }
  skipNl() { while (this.isOp('\n')) this.i++; }
  fail() {
    const t = this.peek();
    if (!t) throw new Incomplete();
    throw new SyntaxError(`syntax error near unexpected token \`${t.v === '\n' ? 'newline' : t.t === 'arith' ? '((' : t.v}'`);
  }
  expect(w) { this.skipNl(); if (!this.isWord(w)) this.fail(); this.i++; }
  program() { const l = this.list([]); if (this.peek()) this.fail(); return l; }
  list(stops) {
    const items = [];
    for (;;) {
      this.skipNl();
      const t = this.peek();
      if (!t) break;
      if (t.t === 'w' && stops.includes(t.v)) break;
      if (t.t === 'op' && (t.v === ')' || t.v === ';;')) break;
      const node = this.andOr();
      let bg = false;
      if (this.isOp('&')) { bg = true; this.i++; } else if (this.isOp(';') || this.isOp('\n')) this.i++;
      else { const n = this.peek(); if (n && !(n.t === 'w' && stops.includes(n.v)) && !(n.t === 'op' && (n.v === ')' || n.v === ';;'))) this.fail(); }
      items.push({ node, bg });
    }
    return { type: 'list', items };
  }
  andOr() {
    const first = this.pipeline(), rest = [];
    while (this.isOp('&&') || this.isOp('||')) { const op = this.t[this.i++].v; this.skipNl(); rest.push({ op, node: this.pipeline() }); }
    return rest.length ? { type: 'andor', first, rest } : first;
  }
  pipeline() {
    let neg = false;
    while (this.isWord('!')) { neg = !neg; this.i++; }
    const cmds = [this.command()];
    while (this.isOp('|') || this.isOp('|&')) { const both = this.t[this.i++].v === '|&'; this.skipNl(); cmds[cmds.length - 1].pipeErr = both; cmds.push(this.command()); }
    return cmds.length === 1 && !neg ? cmds[0] : { type: 'pipe', cmds, neg };
  }
  redirs(node) {
    node.redirs = [];
    while (this.peek() && (this.peek().t === 'io' || (this.isOp() && REDIR.has(this.peek().v)))) node.redirs.push(this.redir());
    return node;
  }
  redir() {
    let fd = null;
    if (this.peek().t === 'io') fd = this.t[this.i++].v;
    const op = this.t[this.i++].v;
    const w = this.peek();
    if (!w || w.t !== 'w') this.fail();
    this.i++;
    return { fd, op, target: w.v, body: w.body, quoted: w.quoted };
  }
  command() {
    const t = this.peek();
    if (!t) throw new Incomplete();
    if (t.t === 'arith') { this.i++; return this.redirs({ type: 'arith', expr: t.v }); }
    if (t.t === 'op' && t.v === '(') {
      this.i++;
      const body = this.list([]);
      if (!this.isOp(')')) this.fail();
      this.i++;
      return this.redirs({ type: 'subshell', body });
    }
    if (t.t === 'w') {
      switch (t.v) {
        case 'if': {
          this.i++;
          const clauses = [];
          do {
            const cond = this.list(['then']); this.expect('then');
            clauses.push({ cond, body: this.list(['elif', 'else', 'fi']) });
          } while (this.isWord('elif') && ++this.i);
          let els = null;
          if (this.isWord('else')) { this.i++; els = this.list(['fi']); }
          this.expect('fi');
          return this.redirs({ type: 'if', clauses, els });
        }
        case 'while': case 'until': {
          this.i++;
          const cond = this.list(['do']); this.expect('do');
          const body = this.list(['done']); this.expect('done');
          return this.redirs({ type: 'while', until: t.v === 'until', cond, body });
        }
        case 'for': {
          this.i++;
          if (this.peek() && this.peek().t === 'arith') {
            const parts = this.t[this.i++].v.split(';');
            if (this.isOp(';')) this.i++;
            this.expect('do');
            const body = this.list(['done']); this.expect('done');
            return this.redirs({ type: 'cfor', init: parts[0] || '', cond: parts[1] || '1', step: parts[2] || '', body });
          }
          if (!this.isWord()) this.fail();
          const name = this.t[this.i++].v;
          let words = null;
          this.skipNl();
          if (this.isWord('in')) { this.i++; words = []; while (this.isWord()) words.push(this.t[this.i++].v); }
          if (this.isOp(';')) this.i++;
          this.expect('do');
          const body = this.list(['done']); this.expect('done');
          return this.redirs({ type: 'for', name, words, body });
        }
        case 'case': {
          this.i++;
          if (!this.isWord()) this.fail();
          const word = this.t[this.i++].v, items = [];
          this.expect('in'); this.skipNl();
          while (!this.isWord('esac')) {
            if (!this.peek()) throw new Incomplete();
            if (this.isOp('(')) this.i++;
            const pats = [];
            for (;;) { if (!this.isWord()) this.fail(); pats.push(this.t[this.i++].v); if (this.isOp('|')) { this.i++; continue; } break; }
            if (!this.isOp(')')) this.fail();
            this.i++;
            const body = this.list(['esac']);
            if (this.isOp(';;')) this.i++;
            this.skipNl();
            items.push({ pats, body });
          }
          this.i++;
          return this.redirs({ type: 'case', word, items });
        }
        case '{': {
          this.i++;
          const body = this.list(['}']); this.expect('}');
          return this.redirs({ type: 'group', body });
        }
        case 'function': {
          this.i++;
          if (!this.isWord()) this.fail();
          const name = this.t[this.i++].v;
          if (this.isOp('(')) { this.i++; if (!this.isOp(')')) this.fail(); this.i++; }
          this.skipNl();
          return { type: 'func', name, body: this.command() };
        }
        case '[[': {
          const words = [];
          while (this.peek() && !(this.isWord(']]'))) words.push(this.t[this.i++].v);
          if (!this.peek()) throw new Incomplete();
          words.push(this.t[this.i++].v);
          return this.redirs({ type: 'simple', assigns: [], words, dbl: true });
        }
        case 'then': case 'else': case 'elif': case 'fi': case 'do': case 'done': case 'esac': case '}': this.fail();
      }
      const a = this.t[this.i + 1], b = this.t[this.i + 2];
      if (a && b && a.t === 'op' && a.v === '(' && b.t === 'op' && b.v === ')' && /^[A-Za-z_][\w.-]*$/.test(t.v)) {
        this.i += 3; this.skipNl();
        return { type: 'func', name: t.v, body: this.command() };
      }
    }
    return this.simple();
  }
  simple() {
    const node = { type: 'simple', assigns: [], words: [], redirs: [] };
    for (;;) {
      const t = this.peek();
      if (!t) break;
      if (t.t === 'io' || (t.t === 'op' && REDIR.has(t.v))) { node.redirs.push(this.redir()); continue; }
      if (t.t !== 'w') break;
      if (!node.words.length && /^[A-Za-z_]\w*\+?=/.test(t.v)) node.assigns.push(t.v); else node.words.push(t.v);
      this.i++;
    }
    if (!node.words.length && !node.assigns.length && !node.redirs.length) this.fail();
    return node;
  }
}
export function parse(src) { return new Parser(lex(src)).program(); }

// ---------------------------------------------------------------- helpers
function braceExpand(s) {
  let depth = 0, start = -1, commas = [], quote = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i++; continue; }
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === '$' && s[i + 1] === '{') { const j = s.indexOf('}', i); if (j < 0) break; i = j; continue; }
    if (c === '{') { if (depth++ === 0) { start = i; commas = []; } }
    else if (c === ',' && depth === 1) commas.push(i);
    else if (c === '}' && depth > 0 && --depth === 0) {
      const body = s.slice(start + 1, i);
      let alts = null, m;
      if (commas.length) { alts = []; let p = start + 1; for (const k of [...commas, i]) { alts.push(s.slice(p, k)); p = k + 1; } }
      else if ((m = /^(-?\d+)\.\.(-?\d+)(?:\.\.(-?\d+))?$/.exec(body))) {
        const a = +m[1], b = +m[2], st = Math.abs(+m[3] || 1), w = /^-?0\d/.test(m[1]) || /^-?0\d/.test(m[2]) ? Math.max(m[1].length, m[2].length) : 0;
        alts = [];
        for (let v = a; a <= b ? v <= b : v >= b; v += a <= b ? st : -st) alts.push(w ? String(Math.abs(v)).padStart(w, '0') : String(v));
      } else if ((m = /^([a-zA-Z])\.\.([a-zA-Z])$/.exec(body))) {
        const a = m[1].charCodeAt(0), b = m[2].charCodeAt(0);
        alts = [];
        for (let v = a; a <= b ? v <= b : v >= b; v += a <= b ? 1 : -1) alts.push(String.fromCharCode(v));
      }
      if (alts) {
        const pre = s.slice(0, start), posts = braceExpand(s.slice(i + 1)), out = [];
        for (const a of alts) for (const ea of braceExpand(a)) for (const p of posts) out.push(pre + ea + p);
        return out;
      }
      start = -1;
    }
  }
  return [s];
}

const escGlob = s => s.replace(/[*?[\]\\]/g, '\\$&');
const ESCAPES = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', v: '\v', '\\': '\\', "'": "'", '"': '"' };
export function unescapeC(s) {
  return s.replace(/\\(x[0-9a-fA-F]{1,2}|0[0-7]{0,3}|[0-7]{1,3}|u[0-9a-fA-F]{1,4}|c|.)/gs, (m, c) => {
    if (c[0] === 'x' && c.length > 1) return String.fromCharCode(parseInt(c.slice(1), 16));
    if (c[0] === 'u' && c.length > 1) return String.fromCharCode(parseInt(c.slice(1), 16));
    if (/^[0-7]+$/.test(c)) return String.fromCharCode(parseInt(c, 8));
    return ESCAPES[c] ?? m;
  });
}
export function sprintf(fmt, args) {
  let out = '', ai = 0, used;
  do {
    used = false;
    out += unescapeC(fmt.replace(/%%/g, '\x00')).replace(/%([-+ 0#]*)(\*|\d+)?(?:\.(\d+))?([sdiuxXofeEgGcb])/g, (m, flags, width, prec, conv) => {
      if (width === '*') width = args[ai++];
      const a = args[ai++]; used = used || a !== undefined;
      let s;
      const num = () => { const n = Number(a); return Number.isNaN(n) ? 0 : n; };
      switch (conv) {
        case 's': s = a ?? ''; if (prec !== undefined) s = s.slice(0, +prec); break;
        case 'b': s = unescapeC(a ?? ''); break;
        case 'c': s = (a ?? '').slice(0, 1); break;
        case 'd': case 'i': case 'u': s = String(Math.trunc(num())); break;
        case 'x': s = Math.trunc(num()).toString(16); break;
        case 'X': s = Math.trunc(num()).toString(16).toUpperCase(); break;
        case 'o': s = Math.trunc(num()).toString(8); break;
        case 'f': s = num().toFixed(prec === undefined ? 6 : +prec); break;
        case 'e': case 'E': s = num().toExponential(prec === undefined ? 6 : +prec); if (conv === 'E') s = s.toUpperCase(); break;
        default: s = String(num());
      }
      if (flags.includes('+') && /[dif]/.test(conv) && num() >= 0) s = '+' + s;
      const w = +width || 0;
      if (s.length < w) s = flags.includes('-') ? s.padEnd(w) : flags.includes('0') && conv !== 's' ? s.padStart(w, '0') : s.padStart(w);
      return s;
    }).replace(/\x00/g, '%');
  } while (used && ai < args.length);
  return out;
}

const bufSink = limit => ({ parts: [], n: 0, write(s) { this.parts.push(s); this.n += s.length; if (limit && this.n > limit) throw new PipeFull(); }, text() { return this.parts.join(''); } });
const reader = s => (s == null ? null : { s, p: 0 });
const takeAll = r => { if (!r) return null; const v = r.s.slice(r.p); r.p = r.s.length; return v; };
const takeLine = r => {
  if (r.p >= r.s.length) return null;
  let e = r.s.indexOf('\n', r.p); if (e < 0) e = r.s.length;
  const v = r.s.slice(r.p, e); r.p = e + 1; return v;
};

// ---------------------------------------------------------------- shell
export class Bash {
  // flavor: { shell: 'bash'|'zsh', family: 'debian'|'arch'|'mac', homeBase, env, ps1, rc, hist, pkgFile }
  constructor({ term, fs, os = {}, user = 'user', host = 'mint-pc', home = '/home/user', flavor = {} }) {
    Object.assign(this, { term, fs, os, user, host, home });
    this.flavor = { shell: 'bash', family: 'debian', homeBase: '/home', rc: '.bashrc', hist: '.bash_history', pkgFile: '/var/lib/dpkg/status', ...flavor };
    this.vars = new Map(); this.exported = new Set(); this.aliases = new Map(); this.funcs = new Map();
    this.cwd = home; this.status = 0; this.params = []; this.name0 = this.flavor.family === 'mac' ? '-' + this.flavor.shell : 'bash';
    this.history = []; this.jobs = []; this.dirstack = []; this.locals = []; this.users = [];
    this.wakers = new Set(); this.sudoUntil = 0; this.started = Date.now(); this.pid = 2000 + Math.floor(Math.random() * 3000);
    const env = {
      USER: user, LOGNAME: user, HOME: home, SHELL: '/bin/bash', PWD: home, OLDPWD: home, HOSTNAME: host, LANG: 'en_US.UTF-8',
      TERM: 'xterm-256color', PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/games', EDITOR: 'vim',
      DISPLAY: ':0', XDG_CURRENT_DESKTOP: 'X-Cinnamon', XDG_SESSION_TYPE: 'x11', DESKTOP_SESSION: 'cinnamon', COLORTERM: 'truecolor',
    };
    for (const [k, v] of Object.entries(env)) { this.vars.set(k, v); this.exported.add(k); }
    for (const [k, v] of Object.entries(this.flavor.env || {})) { if (v === null) { this.vars.delete(k); this.exported.delete(k); } else { this.vars.set(k, v); this.exported.add(k); } }
    this.vars.set('PS1', this.flavor.ps1 || '\\u@\\h:\\w\\$ '); this.vars.set('PS2', '> '); this.vars.set('IFS', ' \t\n');
  }

  // ---- variables
  get(name) {
    switch (name) {
      case '?': return String(this.status);
      case '$': return String(this.pid);
      case '!': return String(this.lastBg || '');
      case '#': return String(this.params.length);
      case '*': case '@': return this.params.join(' ');
      case '0': return this.name0;
      case '-': return 'himBHs';
      case 'RANDOM': return String(Math.floor(Math.random() * 32768));
      case 'SECONDS': return String(Math.floor((Date.now() - this.started) / 1000));
      case 'COLUMNS': return String(this.term.cols);
      case 'LINES': return String(this.term.rows);
      case 'UID': case 'EUID': return this.user === 'root' ? '0' : '1000';
      case 'BASH_VERSION': return '5.1.16(1)-release';
      case 'BASH': return '/usr/bin/bash';
      case 'HOSTTYPE': return 'x86_64'; case 'OSTYPE': return 'linux-gnu';
      case 'PPID': return String(this.pid - 7);
    }
    if (/^\d+$/.test(name)) return this.params[+name - 1] ?? '';
    return this.vars.get(name) ?? '';
  }
  isSet(name) { return /^[?$!#*@0-]$/.test(name) || (/^\d+$/.test(name) ? +name <= this.params.length : this.vars.has(name)) || ['RANDOM', 'SECONDS', 'UID'].includes(name); }
  set(name, val) { this.vars.set(name, String(val)); }
  env() { const o = {}; for (const k of this.exported) if (this.vars.has(k)) o[k] = this.vars.get(k); return o; }
  arith(expr) { return evalArith(expr, { get: n => this.get(n), set: (n, v) => this.set(n, v) }); }
  tilde(p) { return p === this.home ? '~' : p.startsWith(this.home + '/') ? '~' + p.slice(this.home.length) : p; }
  abs(p) { return this.fs.abs(p, this.cwd); }

  // ---- expansion
  async expand(raw, { split = true, tilde = true } = {}) {
    const fields = [];
    let cur = null;
    const lit = (text, quoted) => {
      cur ||= { s: '', pat: '', q: false, glob: false };
      cur.s += text; cur.pat += quoted ? escGlob(text) : text;
      if (quoted) cur.q = true; else if (/[*?[]/.test(text)) cur.glob = true;
    };
    const end = () => { if (cur) { fields.push(cur); cur = null; } };
    const addSplit = text => {
      if (!split) return lit(text, true);
      const parts = text.split(/[ \t\n]+/);
      parts.forEach((p, k) => { if (k > 0) end(); if (p) lit(p, false); });
    };
    const dollar = async (i, quoted) => {
      const r = await this.dollar(raw, i);
      if (r.at) {
        if (quoted) r.at.forEach((p, k) => { if (k > 0) end(); lit(p, true); });
        else r.at.forEach((p, k) => { if (k > 0) end(); addSplit(p); });
        return [r.next, r.at.length === 0];
      }
      if (quoted) lit(r.val, true); else addSplit(r.val);
      return [r.next, false];
    };
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (c === '\\') { if (raw[i + 1] !== '\n') lit(raw[i + 1] ?? '', true); i++; }
      else if (c === "'") { const j = raw.indexOf("'", i + 1); lit(raw.slice(i + 1, j), true); i = j; }
      else if (c === '"') {
        let emptyAt = false, any = false;
        for (i++; i < raw.length && raw[i] !== '"'; i++) {
          const d = raw[i];
          if (d === '\\' && '$`"\\\n'.includes(raw[i + 1])) { if (raw[i + 1] !== '\n') lit(raw[i + 1], true); i++; any = true; }
          else if (d === '$' || d === '`') { const [next, e] = await dollar(i, true); i = next - 1; if (e) emptyAt = true; else any = true; }
          else { lit(d, true); any = true; }
        }
        if (!any && !emptyAt) lit('', true);
      }
      else if (c === '$' && raw[i + 1] === "'") { let j = i + 2; while (raw[j] !== "'") j += raw[j] === '\\' ? 2 : 1; lit(unescapeC(raw.slice(i + 2, j)), true); i = j; }
      else if (c === '$' || c === '`') { const [next] = await dollar(i, false); i = next - 1; }
      else if (c === '~' && i === 0 && tilde) {
        const m = /^~([A-Za-z0-9_+-]*)(?=\/|$)/.exec(raw);
        if (m) { lit(m[1] === '' ? this.get('HOME') : m[1] === '+' ? this.cwd : m[1] === '-' ? this.get('OLDPWD') : m[1] === 'root' ? this.rootHome() : this.flavor.homeBase + '/' + m[1], true); i = m[0].length - 1; }
        else lit(c, false);
      }
      else lit(c, false);
    }
    end();
    return fields;
  }

  // Expands the $-construct or backtick at raw[i]. Returns { val, next } or { at: [...], next }.
  async dollar(raw, i) {
    if (raw[i] === '`') {
      const j = scanTick(raw, i);
      return { val: await this.capture(raw.slice(i + 1, j - 1).replace(/\\([`\\$])/g, '$1')), next: j };
    }
    const c = raw[i + 1];
    if (c === '(') {
      const j = scanParen(raw, i + 1);
      if (raw[i + 2] === '(' && raw[j - 2] === ')') {
        const expr = await this.expandStr(raw.slice(i + 3, j - 2), true);
        try { return { val: String(this.arith(expr)), next: j }; } catch (e) { throw new SyntaxError(`${expr}: ${e.message}`); }
      }
      return { val: await this.capture(raw.slice(i + 2, j - 1)), next: j };
    }
    if (c === '{') { const j = scanBrace(raw, i + 1); return { ...(await this.param(raw.slice(i + 2, j - 1))), next: j }; }
    if (c === '@') return { at: [...this.params], next: i + 2 };
    if (c !== undefined && '?$!#*-0123456789'.includes(c)) return { val: this.get(c), next: i + 2 };
    const m = /^[A-Za-z_]\w*/.exec(raw.slice(i + 1));
    if (m) return { val: this.get(m[0]), next: i + 1 + m[0].length };
    return { val: '$', next: i + 1 };
  }

  async param(body) {
    if (/^#[\w@*?$!-]+$/.test(body)) { const n = body.slice(1); return { val: String(n === '@' || n === '*' ? this.params.length : this.get(n).length) }; }
    if (body[0] === '!') { const n = this.get(body.slice(1)); return { val: this.get(n) }; }
    const m = /^([A-Za-z_]\w*|\d+|[@*#?$!-])(.*)$/s.exec(body);
    if (!m) throw new SyntaxError(`\${${body}}: bad substitution`);
    const name = m[1], rest = m[2];
    const val = this.get(name), set = this.isSet(name);
    if (!rest) return name === '@' ? { at: [...this.params] } : { val };
    let mm;
    if ((mm = /^(:?)([-=+?])(.*)$/s.exec(rest))) {
      const useAlt = mm[1] ? !set || val === '' : !set;
      const word = () => this.expandStr(mm[3]);
      switch (mm[2]) {
        case '-': return { val: useAlt ? await word() : val };
        case '=': if (useAlt) { const w = await word(); this.set(name, w); return { val: w }; } return { val };
        case '+': return { val: useAlt ? '' : await word() };
        case '?': if (useAlt) throw new SyntaxError(`${name}: ${(await word()) || 'parameter null or not set'}`); return { val };
      }
    }
    if ((mm = /^(##?|%%?)(.*)$/s.exec(rest))) {
      const re = globToRe(await this.expandPat(mm[2])), long = mm[1].length === 2, pre = mm[1][0] === '#';
      const n = val.length, order = [];
      for (let k = 0; k <= n; k++) order.push(k);
      if (pre ? long : !long) order.reverse();
      for (const k of order) { if (re.test(pre ? val.slice(0, k) : val.slice(k))) return { val: pre ? val.slice(k) : val.slice(0, k) }; }
      return { val };
    }
    if ((mm = /^(\/\/?)((?:\\.|[^/])*)(?:\/(.*))?$/s.exec(rest))) {
      const re = new RegExp(globToRe(await this.expandPat(mm[2]), { full: false }).source, mm[1] === '//' ? 'g' : '');
      const rep = await this.expandStr(mm[3] || '');
      return { val: val.replace(re, () => rep) };
    }
    if (rest === '^^') return { val: val.toUpperCase() };
    if (rest === ',,') return { val: val.toLowerCase() };
    if (rest === '^') return { val: val.charAt(0).toUpperCase() + val.slice(1) };
    if (rest === ',') return { val: val.charAt(0).toLowerCase() + val.slice(1) };
    if ((mm = /^:([^:]*)(?::(.*))?$/s.exec(rest))) {
      let off = this.arith(mm[1] || '0'); if (off < 0) off = Math.max(0, val.length + off);
      if (mm[2] === undefined) return { val: val.slice(off) };
      const len = this.arith(mm[2]);
      return { val: len < 0 ? val.slice(off, len) : val.slice(off, off + len) };
    }
    throw new SyntaxError(`\${${body}}: bad substitution`);
  }

  // No word splitting / globbing; `heredoc` leaves quote characters alone.
  async expandStr(raw, heredoc = false) {
    if (heredoc) {
      let out = '';
      for (let i = 0; i < raw.length; i++) {
        const c = raw[i];
        if (c === '\\' && '$`\\'.includes(raw[i + 1])) out += raw[++i];
        else if (c === '$' || c === '`') { const r = await this.dollar(raw, i); out += r.at ? r.at.join(' ') : r.val; i = r.next - 1; }
        else out += c;
      }
      return out;
    }
    return (await this.expand(raw, { split: false })).map(f => f.s).join(' ');
  }
  async expandPat(raw) { return (await this.expand(raw, { split: false, tilde: false })).map(f => f.pat).join(' '); }
  async expandWord(raw, opts = {}) {
    const out = [];
    for (const r of braceExpand(raw)) {
      for (const f of await this.expand(r, opts)) {
        if (opts.glob !== false && f.glob) { const m = this.glob(f.pat); if (m.length) { out.push(...m); continue; } }
        out.push(f.s);
      }
    }
    return out;
  }

  glob(pat) {
    const segs = pat.split('/');
    let bases = [pat.startsWith('/') ? '/' : ''];
    const cat = (b, n) => (b === '' ? n : b.endsWith('/') ? b + n : b + '/' + n);
    segs.forEach((seg, idx) => {
      if (seg === '') return;
      const next = [];
      for (const b of bases) {
        if (!hasGlob(seg)) { const p = cat(b, seg.replace(/\\(.)/g, '$1')); if (this.fs.lstat(this.abs(p))) next.push(p); continue; }
        let names; try { names = this.fs.readdir(this.abs(b || '.')); } catch { continue; }
        const re = globToRe(seg);
        for (const n of names) { if (n[0] === '.' && seg[0] !== '.') continue; if (re.test(n)) next.push(cat(b, n)); }
      }
      bases = next;
    });
    if (pat.endsWith('/')) bases = bases.filter(b => this.fs.isDir(this.abs(b))).map(b => b + '/');
    return bases.filter(b => b !== '' && b !== '/' || pat === '/');
  }

  async capture(src) {
    const buf = bufSink(), snap = this.snapshot();
    try { await this.execNode(parse(src), { in: null, out: buf, err: this.ttySink() }); }
    catch (e) { if (!(e instanceof ShellExit || e instanceof Flow || e instanceof PipeFull)) throw e; }
    finally { this.restore(snap); }
    return buf.text().replace(/\n+$/, '');
  }
  snapshot() { return { vars: new Map(this.vars), exported: new Set(this.exported), cwd: this.cwd, params: this.params, funcs: new Map(this.funcs), aliases: new Map(this.aliases) }; }
  restore(s) { Object.assign(this, s); }

  // ---- execution
  rootHome() { return this.flavor.family === 'mac' ? '/var/root' : '/root'; }
  ttySink() { return this.flavor.shell === 'zsh' ? { tty: true, write: s => this.term.write(s.replace(/(^|\n)bash: /g, '$1zsh: ')) } : { tty: true, write: s => this.term.write(s) }; }
  ttyIO() { const s = this.ttySink(); return { in: null, out: s, err: s }; }
  check() { if (this.abort) throw new Interrupt(); }
  interrupt() { this.abort = true; for (const w of [...this.wakers]) w(); }
  sleep(ms) {
    this.check();
    return new Promise((res, rej) => {
      const w = () => { clearTimeout(t); this.wakers.delete(w); rej(new Interrupt()); };
      const t = setTimeout(() => { this.wakers.delete(w); res(); }, ms);
      this.wakers.add(w);
    });
  }
  // Let the event loop breathe during long loops so Ctrl+C can arrive.
  async tick() {
    this.check();
    const now = Date.now();
    if (now - (this._tick || 0) > 12) { await new Promise(r => setTimeout(r)); this._tick = Date.now(); this.check(); }
  }

  async execNode(node, io) {
    switch (node.type) {
      case 'list': {
        let st = this.status;
        for (const it of node.items) {
          if (it.bg) { this.background(it.node, io); st = 0; } else st = await this.execNode(it.node, io);
          this.status = st;
        }
        return st;
      }
      case 'andor': {
        let st = this.status = await this.execNode(node.first, io);
        for (const r of node.rest) if ((r.op === '&&') === (st === 0)) st = this.status = await this.execNode(r.node, io);
        return st;
      }
      case 'pipe': {
        let input = io.in, st = 0;
        for (let k = 0; k < node.cmds.length; k++) {
          const cmd = node.cmds[k];
          if (k === node.cmds.length - 1) { st = await this.execNode(cmd, { in: input, out: io.out, err: io.err }); break; }
          const buf = bufSink(PIPE_MAX);
          try { await this.execNode(cmd, { in: input, out: buf, err: cmd.pipeErr ? buf : io.err }); }
          catch (e) { if (!(e instanceof PipeFull)) throw e; }
          input = reader(buf.text());
        }
        return node.neg ? (st ? 0 : 1) : st;
      }
      case 'simple': return this.execSimple(node, io);
      case 'func': this.funcs.set(node.name, node.body); return 0;
    }
    // Compound commands share redirection handling.
    let io2;
    try { io2 = await this.redirect(node.redirs || [], io); } catch (e) { return this.redirFail(e, io); }
    switch (node.type) {
      case 'group': return this.execNode(node.body, io2);
      case 'subshell': {
        const snap = this.snapshot();
        try { return await this.execNode(node.body, io2); }
        catch (e) { if (e instanceof ShellExit) return e.code; throw e; }
        finally { this.restore(snap); }
      }
      case 'if': {
        for (const c of node.clauses) if ((await this.execNode(c.cond, io2)) === 0) return this.execNode(c.body, io2);
        return node.els ? this.execNode(node.els, io2) : 0;
      }
      case 'while': {
        let st = 0;
        for (;;) {
          await this.tick();
          const c = await this.execNode(node.cond, io2);
          if ((c === 0) === node.until) break;
          const r = await this.loopBody(node.body, io2);
          if (r.st !== undefined) st = r.st;
          if (r.brk) break;
        }
        return st;
      }
      case 'for': {
        let items = node.words === null ? [...this.params] : [];
        if (node.words) for (const w of node.words) items.push(...await this.expandWord(w));
        let st = 0;
        for (const v of items) {
          await this.tick();
          this.set(node.name, v);
          const r = await this.loopBody(node.body, io2);
          if (r.st !== undefined) st = r.st;
          if (r.brk) break;
        }
        return st;
      }
      case 'cfor': {
        let st = 0;
        if (node.init.trim()) this.arith(node.init);
        while (this.arith(node.cond) !== 0) {
          await this.tick();
          const r = await this.loopBody(node.body, io2);
          if (r.st !== undefined) st = r.st;
          if (r.brk) break;
          if (node.step.trim()) this.arith(node.step);
        }
        return st;
      }
      case 'case': {
        const word = await this.expandStr(node.word);
        for (const it of node.items) {
          for (const p of it.pats) if (globToRe(await this.expandPat(p)).test(word)) return this.execNode(it.body, io2);
        }
        return 0;
      }
      case 'arith': try { return this.arith(await this.expandStr(node.expr, true)) !== 0 ? 0 : 1; } catch (e) { io2.err.write(`bash: ((: ${node.expr}: ${e.message}\n`); return 1; }
    }
    return 0;
  }
  async loopBody(body, io) {
    try { return { st: await this.execNode(body, io) }; }
    catch (e) {
      if (!(e instanceof Flow) || e.kind === 'return') throw e;
      if (--e.n > 0) throw e;
      return { brk: e.kind === 'break' };
    }
  }

  redirFail(e, io) {
    if (e instanceof FsError) { io.err.write(`bash: ${e.arg ?? e.path}: ${errMsg(e)}\n`); return 1; }
    throw e;
  }
  async redirect(redirs, io) {
    if (!redirs.length) return io;
    const o = { in: io.in, out: io.out, err: io.err };
    for (const r of redirs) {
      if (r.op === '<<' || r.op === '<<-') { o.in = reader(r.quoted ? r.body : await this.expandStr(r.body, true)); continue; }
      const target = (await this.expandWord(r.target)).join(' ');
      const fileSink = append => {
        const path = this.abs(target);
        try { if (!append || !this.fs.exists(path)) this.fs.write(path, ''); else this.fs.write(path, '', { append: true }); } catch (e) { e.arg = target; throw e; }
        return { write: s => this.fs.write(path, s, { append: true }) };
      };
      switch (r.op) {
        case '<': try { o.in = reader(this.fs.read(this.abs(target))); } catch (e) { e.arg = target; throw e; } break;
        case '<<<': o.in = reader(target + '\n'); break;
        case '>': case '>>': { const s = fileSink(r.op === '>>'); if (r.fd === 2) o.err = s; else o.out = s; break; }
        case '&>': case '&>>': o.out = o.err = fileSink(r.op === '&>>'); break;
        case '>&': case '<&':
          if (/^\d+$/.test(target)) { const src = target === '2' ? o.err : o.out; if (r.fd === 2) o.err = src; else o.out = src; }
          else if (target !== '-') o.out = o.err = fileSink(false);
          break;
      }
    }
    return o;
  }

  async execSimple(node, io) {
    let io2, words = [];
    try {
      io2 = await this.redirect(node.redirs || [], io);
      for (const w of node.words) words.push(...await this.expandWord(w, node.dbl ? { split: false, glob: false } : {}));
    } catch (e) {
      if (e instanceof SyntaxError) { io.err.write(`bash: ${e.message}\n`); return 1; }
      return this.redirFail(e, io);
    }
    // alias expansion (first word, unquoted)
    const w0 = node.words[0];
    if (w0 && this.aliases.has(w0) && !(this._aliasing || []).includes(w0)) {
      this._aliasing = [...(this._aliasing || []), w0];
      try {
        const ast = parse(node.assigns.join(' ') + ' ' + this.aliases.get(w0) + ' ' + node.words.slice(1).join(' '));
        return await this.execNode(ast, io2);
      } catch (e) { if (e instanceof SyntaxError || e instanceof Incomplete) { io.err.write(`bash: ${e.message || 'syntax error'}\n`); return 2; } throw e; }
      finally { this._aliasing = this._aliasing.slice(0, -1); }
    }
    const assign = async a => {
      const m = /^([A-Za-z_]\w*)(\+?)=(.*)$/s.exec(a);
      const v = await this.expandStr(m[3]);
      return [m[1], m[2] ? this.get(m[1]) + v : v];
    };
    if (!words.length) {
      for (const a of node.assigns) { const [k, v] = await assign(a); this.set(k, v); }
      return node.assigns.some(a => /\$\(|`/.test(a)) ? this.status : 0;
    }
    const saved = [];
    for (const a of node.assigns) {
      const [k, v] = await assign(a);
      saved.push([k, this.vars.get(k), this.exported.has(k)]);
      this.set(k, v); this.exported.add(k);
    }
    try { return await this.runCommand(words[0], words.slice(1), io2); }
    finally { for (const [k, v, ex] of saved) { if (v === undefined) this.vars.delete(k); else this.vars.set(k, v); if (!ex) this.exported.delete(k); } }
  }

  hasCmd(name) {
    const c = commands[name], fam = this.flavor.family;
    if (!c || (c.only && !c.only.includes(fam)) || (c.not && c.not.includes(fam))) return false;
    return !c.pkg || this.pkgs().has(c.pkg);
  }
  pkgs() {
    let s = '';
    try { s = this.fs.stat(this.flavor.pkgFile)?.d || ''; } catch { /* ignore */ }
    return new Set([...s.matchAll(/^Package: (\S+)/gm)].map(m => m[1]));
  }

  async runCommand(name, args, io, { noFunc = false } = {}) {
    if (!noFunc && this.funcs.has(name)) return this.callFunc(name, args, io);
    const b = BUILTINS[name];
    if (b) return (await b.call(this, args, io)) ?? 0;
    if (name.includes('/')) return this.runFile(name, args, io);
    if (this.hasCmd(name)) return this.runExternal(name, commands[name], args, io);
    for (const dir of this.get('PATH').split(':')) {
      const p = join(dir || '.', name), n = this.fs.stat(this.abs(p));
      if (n && n.t === 'f' && (n.m & 0o111) && !n.d.startsWith('\x7fELF')) return this.runFile(p, args, io);
    }
    const c = commands[name], fam = this.flavor.family;
    if (this.flavor.shell === 'zsh') io.err.write(`zsh: command not found: ${name}\n`);
    else if (fam === 'mac') io.err.write(`-bash: ${name}: command not found\n`);
    else if (fam === 'arch') io.err.write(`bash: ${name}: command not found\n`);
    else if (c && c.pkg && (!c.only || c.only.includes(fam))) io.err.write(`Command '${name}' not found, but can be installed with:\nsudo apt install ${c.pkg}\n`);
    else io.err.write(`${name}: command not found\n`);
    return 127;
  }

  async runExternal(name, cmd, args, io) {
    const sh = this;
    if (args[0] === '--help' && cmd.usage && !cmd.ownHelp) { io.out.write(`Usage: ${cmd.usage}\n${cmd.desc || ''}\n`); return 0; }
    const ctx = {
      name, args, sh, fs: this.fs, term: this.term, os: this.os, cwd: this.cwd, user: this.user, home: this.get('HOME'),
      env: this.env(), tty: !!io.out.tty, hasStdin: io.in != null, io,
      get cols() { return sh.term.cols; }, get rows() { return sh.term.rows; },
      get stdin() { return takeAll(io.in); },
      out: s => io.out.write(String(s)), err: s => io.err.write(String(s)),
      path: p => this.abs(p), sleep: ms => this.sleep(ms), tick: () => this.tick(),
      readLine: async (opts = {}) => {
        if (io.in) return takeLine(io.in);
        const v = await this.term.readLine(opts);
        if (v === INTR) { this.abort = true; throw new Interrupt(); }
        return v;
      },
      readAll: async () => {
        if (io.in) return takeAll(io.in);
        const lines = [];
        for (;;) { const l = await ctx.readLine(); if (l === null) break; lines.push(l); }
        return lines.length ? lines.join('\n') + '\n' : '';
      },
      run: (argv, io2) => this.runCommand(argv[0], argv.slice(1), io2 || io),
      exec: (src, io2) => this.execSrc(src, io2 || io),
      fail: (msg, code = 1) => { io.err.write(`${name}: ${msg}\n`); return code; },
    };
    try { return (await cmd.fn(ctx)) ?? 0; }
    catch (e) {
      if (e instanceof FsError) { io.err.write(`${name}: ${e.arg ?? e.path}: ${errMsg(e)}\n`); return 1; }
      throw e;
    }
  }

  async runFile(name, args, io) {
    const path = this.abs(name), n = this.fs.stat(path);
    if (!n) { io.err.write(`bash: ${name}: No such file or directory\n`); return 127; }
    if (n.t === 'd') { io.err.write(`bash: ${name}: Is a directory\n`); return 126; }
    if (!(n.m & 0o111) || !this.fs._can(n, 1)) { io.err.write(`bash: ${name}: Permission denied\n`); return 126; }
    let src;
    try { src = this.fs.read(path); } catch (e) { io.err.write(`bash: ${name}: ${errMsg(e)}\n`); return 126; }
    if (src.startsWith('\x7fELF')) {
      const cmd = commands[basename(path)];
      if (cmd) return this.runExternal(basename(path), cmd, args, io);
      io.err.write(`bash: ${name}: cannot execute binary file: Exec format error\n`); return 126;
    }
    const m = /^#!\s*(\S+)(?:\s+(\S+))?/.exec(src);
    const interp = m ? basename(m[1] === '/usr/bin/env' ? m[2] || '' : m[1]) : 'bash';
    if (!['bash', 'sh', 'dash'].includes(interp)) {
      if (this.hasCmd(interp)) return this.runCommand(interp, [name, ...args], io);
      io.err.write(`bash: ${name}: ${m[1]}: bad interpreter: No such file or directory\n`); return 126;
    }
    return this.runScript(src, name, args, io, true);
  }

  async runScript(src, name, args, io, sub) {
    const snap = sub ? this.snapshot() : null, p = this.params, n0 = this.name0;
    if (sub || args.length) this.params = args;
    if (sub) this.name0 = name;
    try { return await this.execNode(parse(src), io); }
    catch (e) {
      if (e instanceof ShellExit && sub) return e.code;
      if (e instanceof Flow && e.kind === 'return') return e.n;
      if (e instanceof SyntaxError) { io.err.write(`${name}: ${e.message}\n`); return 2; }
      if (e instanceof Incomplete) { io.err.write(`${name}: syntax error: unexpected end of file\n`); return 2; }
      throw e;
    } finally { if (sub) { this.restore(snap); this.name0 = n0; } else this.params = p; }
  }
  async execSrc(src, io) {
    try { return await this.execNode(parse(src), io); }
    catch (e) {
      if (e instanceof SyntaxError) { io.err.write(`bash: ${e.message}\n`); return 2; }
      if (e instanceof Incomplete) { io.err.write('bash: syntax error: unexpected end of file\n'); return 2; }
      throw e;
    }
  }

  async callFunc(name, args, io) {
    const p = this.params;
    this.params = args; this.locals.push(new Map());
    try { return await this.execNode(this.funcs.get(name), io); }
    catch (e) { if (e instanceof Flow && e.kind === 'return') return e.n; throw e; }
    finally {
      this.params = p;
      for (const [k, v] of this.locals.pop()) { if (v === undefined) this.vars.delete(k); else this.vars.set(k, v); }
    }
  }

  background(node, io) {
    const job = { id: (this.jobs.at(-1)?.id || 0) + 1, pid: this.lastBg = this.pid + 10 + Math.floor(Math.random() * 500), src: unparse(node), done: false };
    job.promise = this.execNode(node, io).catch(() => 1).then(st => { job.done = true; job.status = st; });
    this.jobs.push(job);
    io.err.write(`[${job.id}] ${job.pid}\n`);
  }
  flushJobs() {
    for (const j of this.jobs.filter(j => j.done)) this.term.write(`[${j.id}]+  ${j.status ? 'Exit ' + j.status : 'Done'}                    ${j.src}\n`);
    this.jobs = this.jobs.filter(j => !j.done);
  }

  // ---- interactive loop
  async init() {
    try { this.history = this.fs.read(this.home + '/' + this.flavor.hist).split('\n').filter(Boolean).slice(-500); } catch { /* none */ }
    const rc = this.fs.stat(this.home + '/' + this.flavor.rc);
    if (rc && rc.t === 'f') { try { await this.runScript(rc.d, this.flavor.rc, [], this.ttyIO(), false); } catch (e) { if (!(e instanceof ShellExit)) console.error(e); } }
  }
  async prompt() {
    let p = this.get('PS1').replace(/\\\[|\\\]/g, '').replace(/\\(\d{3}|.)/gs, (m, c) => {
      switch (c) {
        case 'u': return this.user; case 'h': return this.host.split('.')[0]; case 'H': return this.host;
        case 'w': return this.tilde(this.cwd); case 'W': return this.cwd === this.home ? '~' : basename(this.cwd) || '/';
        case '$': return this.user === 'root' ? '#' : '\x00'; case 'n': return '\n'; case 'e': return '\x1b'; case 'a': return '\x07';
        case 't': return strftime('%T'); case 'T': case '@': case 'A': return strftime('%R'); case 'd': return strftime('%a %b %d');
        case 's': return 'bash'; case 'v': return '5.1'; case 'V': return '5.1.16'; case '\\': return '\\'; case 'j': return String(this.jobs.length);
        case '!': case '#': return String(this.history.length + 1);
      }
      return /^\d{3}$/.test(c) ? String.fromCharCode(parseInt(c, 8)) : m;
    });
    if (/\$[({A-Za-z_]|`/.test(p)) { try { p = await this.expandStr(p, true); } catch { /* keep raw */ } }
    return p.replace(/\x00/g, '$');
  }
  addHistory(line) {
    line = line.trim();
    if (!line || line === this.history.at(-1)) return;
    this.history.push(line);
    if (this.history.length > 500) this.history.shift();
    const u = this.fs.user; this.fs.user = 'root';
    try { this.fs.write(this.home + '/' + this.flavor.hist, this.history.join('\n') + '\n'); } catch { /* read-only home */ }
    this.fs.user = u;
  }
  histExpand(src) {
    if (!/![!$\w-]/.test(src)) return src;
    let changed = false;
    const out = src.replace(/'[^']*'|!(!|\$|-?\d+|[A-Za-z][\w-]*)/g, (m, x) => {
      if (x === undefined) return m;
      let h;
      if (x === '!') h = this.history.at(-1);
      else if (x === '$') h = (this.history.at(-1) || '').trim().split(/\s+/).pop();
      else if (/^-?\d+$/.test(x)) h = +x < 0 ? this.history.at(+x) : this.history[+x - 1];
      else h = [...this.history].reverse().find(l => l.startsWith(x));
      if (h === undefined) throw new SyntaxError(`!${x}: event not found`);
      changed = true; return h;
    });
    if (changed) this.term.write(out + '\n');
    return out;
  }

  async run() {
    await this.init();
    if (this.autorun) {
      const c = this.autorun; this.autorun = null;
      this.term.write((await this.prompt()) + c + '\n'); this.addHistory(c);
      try { await this.runTop(parse(c)); } catch (e) { this.term.write(`bash: ${e.message || 'syntax error'}\n`); }
    }
    while (!this.exited) {
      this.flushJobs();
      let src = await this.term.readLine({ prompt: await this.prompt(), history: this.history, complete: (l, p) => this.complete(l, p) });
      if (src === INTR) { this.status = 130; continue; }
      if (src === null) { this.term.write('exit\n'); if (this.popUser()) continue; break; }
      let ast = null;
      try { src = this.histExpand(src); } catch (e) { this.term.write(`bash: ${e.message}\n`); continue; }
      for (;;) {
        try { ast = parse(src); break; }
        catch (e) {
          if (e instanceof Incomplete) {
            const more = await this.term.readLine({ prompt: this.get('PS2') });
            if (more === INTR) break;
            if (more === null) { this.term.write('bash: syntax error: unexpected end of file\n'); break; }
            src += '\n' + more;
          } else { this.term.write(`bash: ${e.message}\n`); this.status = 2; break; }
        }
      }
      this.addHistory(src);
      if (ast) await this.runTop(ast);
    }
    return this.status;
  }

  async runTop(ast) {
    this.abort = false;
    const pop = this.term.pushHandler(ev => {
      if (ev.ctrl && ev.key === 'c') { this.term.write('^C'); this.interrupt(); return true; }
      if (ev.ctrl && (ev.key === 'v' || ev.key === 'r')) return false;
      this.term.typeahead.push(ev); return true;
    });
    try { this.status = await this.execNode(ast, this.ttyIO()); }
    catch (e) {
      if (e instanceof Interrupt) { this.status = 130; this.term.write('\n'); }
      else if (e instanceof ShellExit) { this.status = e.code; if (!this.popUser()) this.exited = true; }
      else if (e instanceof Flow) { /* break/continue/return outside of a loop */ }
      else if (e instanceof SyntaxError) { this.term.write(`bash: ${e.message}\n`); this.status = 1; }
      else { this.term.write(`bash: ${e.message}\n`); console.error(e); this.status = 1; }
    } finally { pop(); this.abort = false; }
  }

  // su / sudo -i / nested bash: a stack of identities.
  pushUser(user, login) {
    this.users.push({ user: this.user, fsUser: this.fs.user, home: this.get('HOME'), cwd: this.cwd, ps1: this.get('PS1') });
    this.user = this.fs.user = user;
    const home = user === 'root' ? this.rootHome() : this.flavor.homeBase + '/' + user;
    for (const k of ['USER', 'LOGNAME']) this.set(k, user);
    this.set('HOME', home);
    if (login) { this.cwd = home; this.set('PWD', home); }
  }
  popUser() {
    const u = this.users.pop();
    if (!u) return false;
    this.user = u.user; this.fs.user = u.fsUser; this.cwd = u.cwd;
    for (const k of ['USER', 'LOGNAME']) this.set(k, u.user);
    this.set('HOME', u.home); this.set('PWD', u.cwd); this.set('PS1', u.ps1);
    return true;
  }

  // ---- completion
  commandNames() {
    const s = new Set([...Object.keys(BUILTINS), ...this.funcs.keys(), ...this.aliases.keys()]);
    for (const k of Object.keys(commands)) if (this.hasCmd(k)) s.add(k);
    return [...s].filter(n => /^[\w.+-]+$/.test(n)).sort();
  }
  async complete(line) {
    const m = /((?:\\.|[^\s;|&<>()\\])*)$/.exec(line);
    const word = m[1], start = line.length - word.length, before = line.slice(0, start);
    if (/^\$\w*$/.test(word)) {
      const items = [...this.vars.keys()].filter(k => k.startsWith(word.slice(1))).sort().map(k => '$' + k);
      return { start, items };
    }
    const cmdPos = /(^|[;|&(]|\b(sudo|then|do|else|time|exec|command|xargs|watch|man|which|type|whereis)\s)\s*$/.test(before);
    if (cmdPos && !word.includes('/')) return { start, items: this.commandNames().filter(n => n.startsWith(word)) };
    const first = (/(?:^|[;|&]\s*)(\S+)\s[^;|&]*$/.exec(before) || [])[1];
    const dirsOnly = ['cd', 'rmdir', 'pushd'].includes(first);
    const un = word.replace(/\\(.)/g, '$1');
    const slash = un.lastIndexOf('/');
    const dirPart = slash >= 0 ? un.slice(0, slash + 1) : '', prefix = un.slice(slash + 1);
    const look = dirPart.startsWith('~') ? this.get('HOME') + dirPart.slice(1) : dirPart;
    let names;
    try { names = this.fs.readdir(this.abs(look || '.')); } catch { return null; }
    const isDir = n => this.fs.isDir(this.abs(look + n));
    names = names.filter(n => n.startsWith(prefix) && (prefix.startsWith('.') || n[0] !== '.') && (!dirsOnly || isDir(n)));
    const q = s => s.replace(/[ '"\\$`!&;|<>()*?[\]#~]/g, '\\$&');
    const items = names.map(n => (dirPart.startsWith('~') ? '~' + q(dirPart.slice(1)) : q(dirPart)) + q(n));
    return { start, items, display: names.map(n => (isDir(n) ? n + '/' : n)), suffix: it => (isDir(it.replace(/\\(.)/g, '$1').slice(dirPart.length)) ? '/' : ' ') };
  }
}

function unparse(node) {
  if (node.type === 'simple') return [...node.assigns, ...node.words].join(' ');
  if (node.type === 'pipe') return node.cmds.map(unparse).join(' | ');
  if (node.type === 'andor') return unparse(node.first) + node.rest.map(r => ` ${r.op} ${unparse(r.node)}`).join('');
  return node.type;
}

// ---------------------------------------------------------------- test / [
function testExpr(a, sh, dbl) {
  let i = 0;
  const fs = sh.fs, st = p => fs.stat(sh.abs(p));
  const unary = (op, v) => {
    const n = 'ednfLhrwxs'.includes(op[1]) && op !== '-n' ? (op === '-L' || op === '-h' ? fs.lstat(sh.abs(v)) : st(v)) : null;
    switch (op) {
      case '-e': return !!n; case '-f': return !!n && n.t === 'f'; case '-d': return !!n && n.t === 'd';
      case '-L': case '-h': return !!n && n.t === 'l';
      case '-r': return !!n && fs._can(n, 4); case '-w': return !!n && fs._can(n, 2); case '-x': return !!n && fs._can(n, 1) && (n.t === 'd' || !!(n.m & 0o111));
      case '-s': return !!n && fs.size(n) > 0;
      case '-z': return v === ''; case '-n': return v !== ''; case '-t': return true;
      case '-v': return sh.vars.has(v);
    }
    return false;
  };
  const num = v => { const n = parseInt(v, 10); if (Number.isNaN(n) && v.trim() !== '') throw new Error(`${v}: integer expression expected`); return n || 0; };
  const BIN = ['=', '==', '!=', '-eq', '-ne', '-lt', '-le', '-gt', '-ge', '-nt', '-ot', '<', '>', '=~'];
  function primary() {
    const t = a[i];
    if (t === '!') { i++; return !primary(); }
    if (t === '(') { i++; const v = or(); i++; return v; }
    if (BIN.includes(a[i + 1]) && i + 2 < a.length + 0 && a[i + 2] !== undefined) {
      const l = a[i], op = a[i + 1], r = a[i + 2]; i += 3;
      switch (op) {
        case '=': case '==': return dbl ? globToRe(r).test(l) : l === r;
        case '!=': return dbl ? !globToRe(r).test(l) : l !== r;
        case '=~': return new RegExp(r).test(l);
        case '<': return l < r; case '>': return l > r;
        case '-eq': return num(l) === num(r); case '-ne': return num(l) !== num(r);
        case '-lt': return num(l) < num(r); case '-le': return num(l) <= num(r);
        case '-gt': return num(l) > num(r); case '-ge': return num(l) >= num(r);
        case '-nt': return (st(l)?.mt || 0) > (st(r)?.mt || 0); case '-ot': return (st(l)?.mt || 0) < (st(r)?.mt || 0);
      }
    }
    if (/^-[a-zA-Z]$/.test(t) && a[i + 1] !== undefined && !['-a', '-o', '&&', '||', ')'].includes(a[i + 1])) { i += 2; return unary(t, a[i - 1]); }
    i++;
    return t !== undefined && t !== '';
  }
  function and() { let v = primary(); while (a[i] === '-a' || a[i] === '&&') { i++; const r = primary(); v = v && r; } return v; }
  function or() { let v = and(); while (a[i] === '-o' || a[i] === '||') { i++; const r = and(); v = v || r; } return v; }
  if (!a.length) return false;
  const v = or();
  if (i < a.length) throw new Error('too many arguments');
  return v;
}

// ---------------------------------------------------------------- builtins
const BUILTINS = {
  ':': () => 0, true: () => 0, false: () => 1,
  cd(args, io) {
    args = args.filter(a => a !== '--' && a !== '-P' && a !== '-L');
    if (args.length > 1) { io.err.write('bash: cd: too many arguments\n'); return 1; }
    let t = args[0] ?? this.get('HOME');
    if (t === '-') { t = this.get('OLDPWD'); io.out.write(t + '\n'); }
    const p = this.abs(t);
    let n;
    try { n = this.fs._get(p); } catch (e) { io.err.write(`bash: cd: ${t}: ${errMsg(e)}\n`); return 1; }
    if (n.t !== 'd') { io.err.write(`bash: cd: ${t}: Not a directory\n`); return 1; }
    if (!this.fs._can(n, 1)) { io.err.write(`bash: cd: ${t}: Permission denied\n`); return 1; }
    this.set('OLDPWD', this.cwd); this.cwd = p; this.set('PWD', p);
    return 0;
  },
  pwd(args, io) { io.out.write((args.includes('-P') ? this.fs.realpath(this.cwd) : this.cwd) + '\n'); },
  echo(args, io) {
    let nl = true, esc = false;
    while (args.length && /^-[neE]+$/.test(args[0])) { const f = args.shift(); if (f.includes('n')) nl = false; if (f.includes('e')) esc = true; if (f.includes('E')) esc = false; }
    let s = args.join(' ');
    if (esc) { const c = s.indexOf('\\c'); if (c >= 0) { s = s.slice(0, c); nl = false; } s = unescapeC(s); }
    io.out.write(s + (nl ? '\n' : ''));
  },
  printf(args, io) {
    if (args[0] === '-v') { this.set(args[1], sprintf(args[2] || '', args.slice(3))); return 0; }
    if (!args.length) { io.err.write('printf: usage: printf [-v var] format [arguments]\n'); return 2; }
    io.out.write(sprintf(args[0], args.slice(1)));
  },
  export(args, io) {
    if (!args.length || args[0] === '-p') { for (const k of [...this.exported].sort()) if (this.vars.has(k)) io.out.write(`declare -x ${k}="${this.vars.get(k)}"\n`); return 0; }
    const un = args[0] === '-n'; if (un) args = args.slice(1);
    for (const a of args) {
      const m = /^([A-Za-z_]\w*)(?:=(.*))?$/s.exec(a);
      if (!m) { io.err.write(`bash: export: \`${a}': not a valid identifier\n`); return 1; }
      if (m[2] !== undefined) this.set(m[1], m[2]);
      if (un) this.exported.delete(m[1]); else this.exported.add(m[1]);
    }
  },
  unset(args) { for (const a of args) { if (a === '-f' || a === '-v') continue; this.vars.delete(a); this.exported.delete(a); this.funcs.delete(a); } },
  set(args, io) {
    if (!args.length) { for (const k of [...this.vars.keys()].sort()) io.out.write(`${k}=${/[^\w./:@-]/.test(this.vars.get(k)) ? `'${this.vars.get(k)}'` : this.vars.get(k)}\n`); return 0; }
    if (args[0] === '--') this.params = args.slice(1);
    else if (!/^[-+]/.test(args[0])) this.params = args;
  },
  shift(args) { const n = +(args[0] || 1); if (n > this.params.length) return 1; this.params = this.params.slice(n); },
  local(args) { return BUILTINS.declare.call(this, args, null, true); },
  readonly(args, io) { return BUILTINS.declare.call(this, args, io); },
  typeset(args, io) { return BUILTINS.declare.call(this, args, io); },
  declare(args, io, local) {
    const flags = args.filter(a => /^[-+][a-zA-Z]+$/.test(a)).join('');
    const names = args.filter(a => !/^[-+][a-zA-Z]+$/.test(a));
    if (!names.length && io) {
      if (flags.includes('f')) { for (const k of this.funcs.keys()) io.out.write(`${k} () \n{ ... }\n`); return 0; }
      for (const k of [...this.vars.keys()].sort()) io.out.write(`declare ${this.exported.has(k) ? '-x' : '--'} ${k}="${this.vars.get(k)}"\n`);
      return 0;
    }
    for (const a of names) {
      const m = /^([A-Za-z_]\w*)(?:=(.*))?$/s.exec(a);
      if (!m) continue;
      const scope = this.locals.at(-1);
      if ((local || this.locals.length) && scope && !scope.has(m[1])) scope.set(m[1], this.vars.get(m[1]));
      if (m[2] !== undefined) this.set(m[1], flags.includes('i') ? this.arith(m[2]) : m[2]); else if (!this.vars.has(m[1])) this.set(m[1], '');
      if (flags.includes('x')) this.exported.add(m[1]);
    }
  },
  let(args, io) { let v = 0; try { for (const a of args) v = this.arith(a); } catch (e) { io.err.write(`bash: let: ${e.message}\n`); return 1; } return v !== 0 ? 0 : 1; },
  alias(args, io) {
    const show = k => io.out.write(`alias ${k}='${this.aliases.get(k)}'\n`);
    if (!args.length) { [...this.aliases.keys()].sort().forEach(show); return 0; }
    let st = 0;
    for (const a of args) {
      const eq = a.indexOf('=');
      if (eq > 0) this.aliases.set(a.slice(0, eq), a.slice(eq + 1));
      else if (this.aliases.has(a)) show(a);
      else { io.err.write(`bash: alias: ${a}: not found\n`); st = 1; }
    }
    return st;
  },
  unalias(args, io) {
    let st = 0;
    for (const a of args) { if (a === '-a') this.aliases.clear(); else if (!this.aliases.delete(a)) { io.err.write(`bash: unalias: ${a}: not found\n`); st = 1; } }
    return st;
  },
  async source(args, io) {
    if (!args.length) { io.err.write('bash: source: filename argument required\n'); return 2; }
    let src;
    try { src = this.fs.read(this.abs(args[0])); } catch (e) { io.err.write(`bash: ${args[0]}: ${errMsg(e)}\n`); return 1; }
    return this.runScript(src, args[0], args.slice(1), io, false);
  },
  '.'(args, io) { return BUILTINS.source.call(this, args, io); },
  async eval(args, io) { return this.execSrc(args.join(' '), io); },
  async exec(args, io) { if (!args.length) return 0; const st = await this.runCommand(args[0], args.slice(1), io); throw new ShellExit(st); },
  exit(args) { throw new ShellExit(args.length ? +args[0] & 255 : this.status); },
  logout(args) { throw new ShellExit(args.length ? +args[0] & 255 : this.status); },
  return(args) { throw new Flow('return', args.length ? +args[0] & 255 : this.status); },
  break(args) { throw new Flow('break', +(args[0] || 1)); },
  continue(args) { throw new Flow('continue', +(args[0] || 1)); },
  test(args, io) { try { return testExpr(args, this) ? 0 : 1; } catch (e) { io.err.write(`bash: test: ${e.message}\n`); return 2; } },
  '['(args, io) {
    if (args.at(-1) !== ']') { io.err.write("bash: [: missing `]'\n"); return 2; }
    try { return testExpr(args.slice(0, -1), this) ? 0 : 1; } catch (e) { io.err.write(`bash: [: ${e.message}\n`); return 2; }
  },
  '[['(args, io) { try { return testExpr(args.slice(0, -1), this, true) ? 0 : 1; } catch (e) { io.err.write(`bash: [[: ${e.message}\n`); return 2; } },
  async read(args, io) {
    let prompt = '', silent = false, raw = false, nchars = 0;
    const names = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-p') prompt = args[++i] || ''; else if (a === '-n' || a === '-N') nchars = +args[++i]; else if (a === '-t' || a === '-d' || a === '-u') i++;
      else if (/^-[rsea]+$/.test(a)) { if (a.includes('s')) silent = true; if (a.includes('r')) raw = true; }
      else names.push(a);
    }
    let line;
    if (io.in) line = takeLine(io.in);
    else {
      line = await this.term.readLine({ prompt, mask: silent });
      if (line === INTR) { this.abort = true; throw new Interrupt(); }
    }
    if (line === null) return 1;
    if (!raw) line = line.replace(/\\(.)/g, '$1');
    if (nchars) line = line.slice(0, nchars);
    if (!names.length) { this.set('REPLY', line); return 0; }
    const parts = line.trim().split(/[ \t]+/);
    names.forEach((n, k) => this.set(n, k === names.length - 1 ? parts.slice(k).join(' ') : parts[k] ?? ''));
    return 0;
  },
  type(args, io) {
    let st = 0;
    const tOnly = args[0] === '-t'; if (/^-[tpaP]+$/.test(args[0] || '')) args = args.slice(1);
    for (const a of args) {
      let kind = null, msg;
      if (this.aliases.has(a)) { kind = 'alias'; msg = `${a} is aliased to \`${this.aliases.get(a)}'`; }
      else if (['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac', 'function', 'in', '{', '}', '!', '[[', ']]', 'time'].includes(a)) { kind = 'keyword'; msg = `${a} is a shell keyword`; }
      else if (this.funcs.has(a)) { kind = 'function'; msg = `${a} is a function`; }
      else if (BUILTINS[a]) { kind = 'builtin'; msg = `${a} is a shell builtin`; }
      else if (this.hasCmd(a)) { kind = 'file'; msg = `${a} is ${commands[a].sbin ? '/usr/sbin/' : commands[a].pkg && commands[a].games ? '/usr/games/' : '/usr/bin/'}${a}`; }
      if (!kind) { if (!tOnly) io.err.write(`bash: type: ${a}: not found\n`); st = 1; } else io.out.write((tOnly ? kind : msg) + '\n');
    }
    return st;
  },
  async command(args, io) {
    if (args[0] === '-v' || args[0] === '-V') {
      let st = 1;
      for (const a of args.slice(1)) { if (BUILTINS[a] || this.funcs.has(a)) { io.out.write(a + '\n'); st = 0; } else if (this.aliases.has(a)) { io.out.write(`alias ${a}='${this.aliases.get(a)}'\n`); st = 0; } else if (this.hasCmd(a)) { io.out.write(`/usr/bin/${a}\n`); st = 0; } }
      return st;
    }
    return args.length ? this.runCommand(args[0], args.slice(1), io, { noFunc: true }) : 0;
  },
  async builtin(args, io) { const b = BUILTINS[args[0]]; if (!b) { io.err.write(`bash: builtin: ${args[0]}: not a shell builtin\n`); return 1; } return (await b.call(this, args.slice(1), io)) ?? 0; },
  history(args, io) {
    if (args[0] === '-c') { this.history.length = 0; try { this.fs.write(this.home + '/.bash_history', ''); } catch { /* ignore */ } return 0; }
    const n = args.length ? +args[0] : this.history.length;
    this.history.slice(-n).forEach((l, k) => io.out.write(`${String(this.history.length - Math.min(n, this.history.length) + k + 1).padStart(5)}  ${l}\n`));
  },
  jobs(args, io) { for (const j of this.jobs) io.out.write(`[${j.id}]+  ${j.done ? 'Done' : 'Running'}                 ${j.src} &\n`); },
  async fg(args, io) { const j = this.jobs.at(-1); if (!j) { io.err.write('bash: fg: current: no such job\n'); return 1; } io.out.write(j.src + '\n'); await j.promise; this.jobs = this.jobs.filter(x => x !== j); return j.status; },
  bg(args, io) { if (!this.jobs.length) { io.err.write('bash: bg: current: no such job\n'); return 1; } },
  async wait() { await Promise.all(this.jobs.map(j => j.promise)); return 0; },
  kill(args, io) {
    const ids = args.filter(a => !/^-/.test(a));
    if (!ids.length) { io.err.write('kill: usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]\n'); return 2; }
    if (args[0] === '-l') { io.out.write(' 1) SIGHUP\t 2) SIGINT\t 3) SIGQUIT\t 9) SIGKILL\t15) SIGTERM\n'); return 0; }
    let st = 0;
    for (const id of ids) {
      const proc = this.os.procs ? this.os.procs().find(p => String(p.pid) === id) : null;
      if (proc && proc.kill) { if (this.user !== 'root' && proc.user === 'root') { io.err.write(`bash: kill: (${id}) - Operation not permitted\n`); st = 1; } else proc.kill(); }
      else if (!proc) { io.err.write(`bash: kill: (${id}) - No such process\n`); st = 1; }
    }
    return st;
  },
  pushd(args, io) { const d = args[0]; if (!d) { io.err.write('bash: pushd: no other directory\n'); return 1; } const old = this.cwd; const st = BUILTINS.cd.call(this, [d], io); if (!st) { this.dirstack.unshift(old); BUILTINS.dirs.call(this, [], io); } return st; },
  popd(args, io) { if (!this.dirstack.length) { io.err.write('bash: popd: directory stack empty\n'); return 1; } const st = BUILTINS.cd.call(this, [this.dirstack.shift()], io); BUILTINS.dirs.call(this, [], io); return st; },
  dirs(args, io) { io.out.write([this.cwd, ...this.dirstack].map(d => this.tilde(d)).join(' ') + '\n'); },
  umask(args, io) { if (!args.length) io.out.write('0022\n'); },
  ulimit(args, io) { io.out.write('unlimited\n'); },
  shopt() { return 0; }, bind() { return 0; }, trap() { return 0; }, hash() { return 0; }, enable() { return 0; }, complete() { return 0; }, disown() { return 0; },
  async time(args, io) {
    const t = performance.now();
    const st = args.length ? await this.runCommand(args[0], args.slice(1), io) : 0;
    const d = (performance.now() - t) / 1000, f = x => `${Math.floor(x / 60)}m${(x % 60).toFixed(3)}s`;
    io.err.write(`\nreal\t${f(d)}\nuser\t${f(d * 0.6)}\nsys\t${f(d * 0.1)}\n`);
    return st;
  },
  help(args, io) {
    io.out.write(`GNU bash, version 5.1.16(1)-release (x86_64-pc-linux-gnu)\nThese shell commands are defined internally.  Type \`help' to see this list.\nType \`man name' to find out more about commands not in this list.\n\n`);
    const names = Object.keys(BUILTINS).filter(n => /^\w/.test(n)).sort();
    for (let k = 0; k < names.length; k += 4) io.out.write(' ' + names.slice(k, k + 4).map(n => n.padEnd(18)).join('') + '\n');
  },
  async sudo(args, io) {
    if (!args.length || args[0] === '-h' || args[0] === '--help') { io.out.write('usage: sudo -h | -K | -k | -V\nusage: sudo [-u user] [command]\nusage: sudo -i | -s\n'); return args.length ? 0 : 1; }
    if (args[0] === '-k' || args[0] === '-K') { this.sudoUntil = 0; return 0; }
    if (args[0] === '-V' || args[0] === '--version') { io.out.write('Sudo version 1.9.9\n'); return 0; }
    if (this.user !== 'root' && Date.now() > this.sudoUntil) {
      let ok = false;
      for (let k = 0; k < 3 && !ok; k++) {
        const pw = await this.term.readLine({ prompt: this.flavor.family === 'mac' ? 'Password:' : `[sudo] password for ${this.user}: `, mask: true });
        if (pw === INTR) { this.abort = true; throw new Interrupt(); }
        if (pw) ok = true; else if (k < 2) io.err.write('Sorry, try again.\n');
      }
      if (!ok) { io.err.write('sudo: 3 incorrect password attempts\n'); return 1; }
      this.sudoUntil = Date.now() + 15 * 60000;
    }
    if (args[0] === '-v') return 0;
    let target = 'root';
    if (args[0] === '-u') { target = args[1]; args = args.slice(2); }
    if (['-i', '-s'].includes(args[0]) || (args[0] === 'su' && args.every(a => a === 'su' || a === '-' || a === '-l' || a === 'root')) || ((args[0] === 'bash' || args[0] === 'sh') && args.length === 1)) {
      this.pushUser(target, args[0] === '-i' || args.includes('-') || args.includes('-l'));
      return 0;
    }
    if (args[0] === '--') args = args.slice(1);
    const prev = { user: this.user, fsUser: this.fs.user, sudoUser: this.vars.get('SUDO_USER') };
    this.user = this.fs.user = target; this.set('SUDO_USER', prev.user); this.set('USER', target);
    try { return await this.runCommand(args[0], args.slice(1), io); }
    finally {
      this.user = prev.user; this.fs.user = prev.fsUser; this.set('USER', prev.user);
      if (prev.sudoUser === undefined) this.vars.delete('SUDO_USER'); else this.set('SUDO_USER', prev.sudoUser);
    }
  },
  async su(args, io) {
    const target = args.find(a => !a.startsWith('-')) || 'root';
    if (this.user !== 'root') {
      const pw = await this.term.readLine({ prompt: 'Password: ', mask: true });
      if (pw === INTR) { this.abort = true; throw new Interrupt(); }
      await this.sleep(1200);
      io.err.write('su: Authentication failure\n'); return 1;
    }
    if (target !== 'root' && !this.fs.isDir(this.flavor.homeBase + '/' + target)) { io.err.write(`su: user ${target} does not exist or the user entry does not contain all the required fields\n`); return 1; }
    this.pushUser(target, args.includes('-') || args.includes('-l'));
    return 0;
  },
  async bash(args, io) {
    if (args[0] === '--version') { io.out.write('GNU bash, version 5.1.16(1)-release (x86_64-pc-linux-gnu)\nCopyright (C) 2020 Free Software Foundation, Inc.\nLicense GPLv3+: GNU GPL version 3 or later <http://gnu.org/licenses/gpl.html>\n'); return 0; }
    if (args[0] === '-c') {
      const snap = this.snapshot(), p = this.params;
      this.params = args.slice(3);
      try { return await this.execSrc(args[1] || '', io); } catch (e) { if (e instanceof ShellExit) return e.code; throw e; } finally { this.restore(snap); this.params = p; }
    }
    const files = args.filter(a => !/^-/.test(a));
    if (!files.length) {
      if (io.in) return this.runScript(takeAll(io.in), 'bash', [], io, true);
      this.pushUser(this.user, false); return 0;
    }
    let src;
    try { src = this.fs.read(this.abs(files[0])); } catch (e) { io.err.write(`bash: ${files[0]}: ${errMsg(e)}\n`); return 127; }
    return this.runScript(src, files[0], files.slice(1), io, true);
  },
  sh(args, io) { return BUILTINS.bash.call(this, args, io); },
  dash(args, io) { return BUILTINS.bash.call(this, args, io); },
};
export { BUILTINS, dirname };
