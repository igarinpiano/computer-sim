// A compact awk: patterns and actions, fields, associative arrays, control flow, printf,
// string functions and output redirection. The program is compiled to closures over a runtime `E`.

import { def, UsageError, inputs, lines, posixRe } from './coreutils.js';
import { sprintf } from './bash.js';
import { errMsg } from '../core/vfs.js';

class Next { }
class Stop { constructor(code) { this.code = code; } }
class Brk { } class Cont { }
const KEYWORDS = new Set(['BEGIN', 'END', 'if', 'else', 'while', 'for', 'in', 'do', 'print', 'printf', 'next', 'exit', 'delete', 'break', 'continue', 'getline', 'function', 'return']);
const OPS = ['&&', '||', '==', '!=', '<=', '>=', '!~', '++', '--', '+=', '-=', '*=', '/=', '%=', '^=', '>>', '**', '{', '}', '(', ')', '[', ']', ';', ',', '+', '-', '*', '/', '%', '^', '!', '<', '>', '~', '?', ':', '=', '$', '|'];
const isNum = v => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)));
const num = v => (typeof v === 'number' ? v : parseFloat(v) || 0);
const str = v => (typeof v === 'number' ? (Number.isInteger(v) ? String(v) : String(parseFloat(v.toPrecision(6)))) : v == null ? '' : String(v));
const truthy = v => (typeof v === 'number' ? v !== 0 : isNum(v) ? Number(v) !== 0 : str(v) !== '');
const re = s => new RegExp(posixRe(String(s), true));

function lex(src) {
  const toks = [];
  let i = 0;
  const operand = () => { const t = toks.at(-1); return !!t && (['num', 'str', 'name', 'ere'].includes(t.t) || t.v === ')' || t.v === ']' || (t.t === 'kw' && false)); };
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { toks.push({ t: 'nl', v: '\n' }); i++; continue; }
    if (c === '\\' && src[i + 1] === '\n') { i += 2; continue; }
    if (/\s/.test(c)) { i++; continue; }
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '"') {
      let s = ''; i++;
      while (i < src.length && src[i] !== '"') { if (src[i] === '\\') { const d = src[++i]; s += { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', '/': '/', a: '\x07', e: '\x1b' }[d] ?? '\\' + d; } else s += src[i]; i++; }
      i++; toks.push({ t: 'str', v: s }); continue;
    }
    if (c === '/' && !operand()) {
      let s = ''; i++;
      while (i < src.length && src[i] !== '/') { if (src[i] === '\\' && src[i + 1] === '/') { s += '/'; i += 2; continue; } if (src[i] === '\\') s += src[i++]; s += src[i++]; }
      i++; toks.push({ t: 'ere', v: s }); continue;
    }
    let m;
    if ((m = /^(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+)/.exec(src.slice(i)))) { toks.push({ t: 'num', v: parseFloat(m[1]) }); i += m[1].length; continue; }
    if ((m = /^[A-Za-z_]\w*/.exec(src.slice(i)))) { toks.push({ t: KEYWORDS.has(m[0]) ? 'kw' : 'name', v: m[0], call: src[i + m[0].length] === '(' }); i += m[0].length; continue; }
    const op = OPS.find(o => src.startsWith(o, i));
    if (!op) throw new Error(`syntax error at source line 1\n context is\n\t${src.slice(Math.max(0, i - 10), i)} >>> ${c} <<<`);
    toks.push({ t: 'op', v: op }); i += op.length;
  }
  return toks;
}

function compile(src) {
  const T = lex(src);
  let p = 0;
  const peek = () => T[p], is = v => T[p] && T[p].t !== 'str' && T[p].v === v, eat = v => { if (is(v)) { p++; return true; } return false; };
  const need = v => { if (!eat(v)) throw new Error(`syntax error near ${T[p] ? JSON.stringify(String(T[p].v)) : 'end of program'}: expected ${v}`); };
  const skipNl = () => { while (T[p] && (T[p].t === 'nl' || is(';'))) p++; };
  const optNl = () => { while (T[p] && T[p].t === 'nl') p++; };

  // ---- expressions (each returns E => value; lvalues also carry .set)
  const lval = (get, set) => Object.assign(get, { set });
  function primary() {
    const t = T[p++];
    if (!t) throw new Error('syntax error: unexpected end of program');
    if (t.t === 'num') return () => t.v;
    if (t.t === 'str') return () => t.v;
    if (t.t === 'ere') { const r = re(t.v); return Object.assign(E => (r.test(E.f[0]) ? 1 : 0), { regex: r }); }
    if (t.v === '(' && t.t === 'op') {
      const g = noGt; noGt = false;
      const e = expr();
      noGt = g;
      if (is(',')) { const keys = [e]; while (eat(',')) keys.push(expr()); need(')'); need('in'); const name = T[p++].v; return E => (keys.map(k => str(k(E))).join('\x1c') in (E.arr[name] ||= {}) ? 1 : 0); }
      need(')'); return Object.assign(E => e(E), { grouped: true, regex: undefined });
    }
    if (t.v === '$' && t.t === 'op') { const e = unaryHigh(); return lval(E => E.getField(num(e(E))), (E, v) => E.setField(num(e(E)), v)); }
    if (t.v === '-' && t.t === 'op') { const e = unaryHigh(); return E => -num(e(E)); }
    if (t.v === '+' && t.t === 'op') { const e = unaryHigh(); return E => num(e(E)); }
    if (t.v === '!' && t.t === 'op') { const e = unaryHigh(); return E => (truthy(e(E)) ? 0 : 1); }
    if ((t.v === '++' || t.v === '--') && t.t === 'op') { const e = unaryHigh(), d = t.v === '++' ? 1 : -1; return E => { const v = num(e(E)) + d; e.set(E, v); return v; }; }
    if (t.t === 'kw' && t.v === 'getline') return E => { if (E.ri + 1 >= E.recs.length) return 0; E.ri++; E.setRecord(E.recs[E.ri]); E.vars.NR++; E.vars.FNR++; return 1; };
    if (t.t === 'name') {
      const name = t.v;
      if (is('(') && t.call) { p++; const args = []; if (!is(')')) do { optNl(); args.push(expr()); } while (eat(',')); need(')'); return call(name, args); }
      if (eat('[')) { const keys = [expr()]; while (eat(',')) keys.push(expr()); need(']'); const key = E => keys.map(k => str(k(E))).join('\x1c'); return Object.assign(lval(E => (E.arr[name] ||= {})[key(E)] ?? '', (E, v) => { (E.arr[name] ||= {})[key(E)] = v; }), { arr: name, key }); }
      return Object.assign(lval(E => E.get(name), (E, v) => E.set(name, v)), { vname: name });
    }
    throw new Error(`syntax error near ${JSON.stringify(String(t.v))}`);
  }
  function unaryHigh() {   // primary with postfix ++/-- and ^
    const e = primary();
    if ((is('++') || is('--')) && e.set) { const d = T[p++].v === '++' ? 1 : -1; return E => { const v = num(e(E)); e.set(E, v + d); return v; }; }
    if (is('^') || is('**')) { p++; const r = unaryHigh(); return E => Math.pow(num(e(E)), num(r(E))); }
    return e;
  }
  const bin = (next, ops, fn) => () => { let l = next(); while (T[p] && T[p].t === 'op' && ops.includes(T[p].v)) { const op = T[p++].v, a = l, b = next(); l = E => fn(op, a(E), b(E)); } return l; };
  const mul = bin(unaryHigh, ['*', '/', '%'], (op, a, b) => { const x = num(a), y = num(b); if (op !== '*' && y === 0) throw new Error('division by zero'); return op === '*' ? x * y : op === '/' ? x / y : x % y; });
  const add = bin(mul, ['+', '-'], (op, a, b) => (op === '+' ? num(a) + num(b) : num(a) - num(b)));
  let noGt = false, noIn = false;
  const startsOperand = () => { const t = T[p]; return !!t && (t.t === 'num' || t.t === 'str' || t.t === 'name' || (t.t === 'op' && (t.v === '$' || t.v === '(' || t.v === '!' && false || t.v === '-' && false || t.v === '++' || t.v === '--'))); };
  function concat() { let l = add(); while (startsOperand()) { const a = l, b = add(); l = E => str(a(E)) + str(b(E)); } return l; }
  function compare() {
    const l = concat();
    if (T[p] && T[p].t === 'op' && ['<', '<=', '==', '!=', '>', '>='].includes(T[p].v) && !(noGt && T[p].v === '>')) {
      const op = T[p++].v, r = concat();
      return E => { let a = l(E), b = r(E); if (isNum(a) && isNum(b)) { a = Number(a); b = Number(b); } else { a = str(a); b = str(b); } return ({ '<': a < b, '<=': a <= b, '==': a === b, '!=': a !== b, '>': a > b, '>=': a >= b }[op]) ? 1 : 0; };
    }
    return l;
  }
  function match() {
    let l = compare();
    while (is('~') || is('!~')) { const neg = T[p++].v === '!~', r = compare(), a = l; l = E => { const rx = r.regex || re(str(r(E))); return rx.test(str(a(E))) !== neg ? 1 : 0; }; }
    return l;
  }
  function inExpr() { let l = match(); while (!noIn && T[p] && T[p].t === 'kw' && T[p].v === 'in') { p++; const name = T[p++].v, a = l; l = E => (str(a(E)) in (E.arr[name] ||= {}) ? 1 : 0); } return l; }
  function and() { let l = inExpr(); while (eat('&&')) { optNl(); const a = l, b = inExpr(); l = E => (truthy(a(E)) && truthy(b(E)) ? 1 : 0); } return l; }
  function or() { let l = and(); while (eat('||')) { optNl(); const a = l, b = and(); l = E => (truthy(a(E)) || truthy(b(E)) ? 1 : 0); } return l; }
  function ternary() { const c = or(); if (eat('?')) { const a = ternary(); need(':'); const b = ternary(); return E => (truthy(c(E)) ? a(E) : b(E)); } return c; }
  function expr() {
    const l = ternary();
    if (l.set && T[p] && T[p].t === 'op' && ['=', '+=', '-=', '*=', '/=', '%=', '^='].includes(T[p].v)) {
      const op = T[p++].v, r = expr();
      return E => { let v = r(E); if (op !== '=') { const a = num(l(E)), b = num(v); v = op === '+=' ? a + b : op === '-=' ? a - b : op === '*=' ? a * b : op === '/=' ? a / b : op === '%=' ? a % b : Math.pow(a, b); } l.set(E, v); return v; };
    }
    return l;
  }
  function call(name, a) {
    const s = k => E => str(a[k] ? a[k](E) : E.f[0]), n = k => E => num(a[k](E));
    switch (name) {
      case 'length': return E => (a[0] && a[0].vname && E.arr[a[0].vname] ? Object.keys(E.arr[a[0].vname]).length : s(0)(E).length);
      case 'substr': return E => { const t = s(0)(E); let st = Math.round(n(1)(E)); let len = a[2] ? Math.round(n(2)(E)) : Infinity; if (st < 1) { len += st - 1; st = 1; } return len > 0 ? t.substr(st - 1, len) : ''; };
      case 'index': return E => s(0)(E).indexOf(s(1)(E)) + 1;
      case 'toupper': return E => s(0)(E).toUpperCase();
      case 'tolower': return E => s(0)(E).toLowerCase();
      case 'int': return E => Math.trunc(n(0)(E));
      case 'sqrt': case 'sin': case 'cos': case 'log': case 'exp': return E => Math[name](n(0)(E));
      case 'atan2': return E => Math.atan2(n(0)(E), n(1)(E));
      case 'rand': return () => Math.random();
      case 'srand': return () => 0;
      case 'systime': return () => Math.floor(Date.now() / 1000);
      case 'sprintf': return E => sprintf(str(a[0](E)), a.slice(1).map(x => str(x(E))));
      case 'split': return E => { const t = s(0)(E), sep = a[2] ? (a[2].regex ? a[2].regex : str(a[2](E))) : E.vars.FS; const parts = t === '' ? [] : E.split(t, sep); const arr = E.arr[a[1].vname] = {}; parts.forEach((x, i) => { arr[i + 1] = x; }); return parts.length; };
      case 'match': return E => { const m = (a[1].regex || re(s(1)(E))).exec(s(0)(E)); E.vars.RSTART = m ? m.index + 1 : 0; E.vars.RLENGTH = m ? m[0].length : -1; return E.vars.RSTART; };
      case 'sub': case 'gsub': return E => {
        const rx = new RegExp((a[0].regex || re(str(a[0](E)))).source, name === 'gsub' ? 'g' : ''), target = a[2] || lval(X => X.f[0], (X, v) => X.setRecord(v));
        const rep = str(a[1](E)); let count = 0;
        const out = str(target(E)).replace(rx, m => { count++; return rep.replace(/\\&|&/g, x => (x === '&' ? m : '&')); });
        if (count) target.set(E, out);
        return count;
      };
      case 'system': return () => 0;
      case 'close': return () => 0;
    }
    throw new Error(`calling undefined function ${name}`);
  }

  // ---- statements (each returns E => void)
  function block() { need('{'); const list = []; skipNl(); while (!is('}')) { if (!T[p]) throw new Error('syntax error: unexpected end of program, missing }'); list.push(stmt()); skipNl(); } p++; return E => { for (const s of list) s(E); }; }
  const body = () => { optNl(); return is('{') ? block() : stmt(); };
  function exprList() { const list = []; noGt = true; if (T[p] && T[p].t !== 'nl' && !is(';') && !is('}') && !is('>') && !is('>>') && !is('|')) do { optNl(); list.push(expr()); } while (eat(',')); noGt = false; return list; }
  function redirect() { if (is('>') || is('>>')) { const append = T[p++].v === '>>', e = concat(); return { append, e }; } if (eat('|')) { concat(); return null; } return null; }
  function stmt() {
    const t = T[p];
    if (is('{')) return block();
    if (t.t === 'kw') {
      p++;
      switch (t.v) {
        case 'print': {
          let list;
          if (is('(')) { const save = p; p++; const inner = []; let ok = true; noGt = false; try { do inner.push(expr()); while (eat(',')); need(')'); } catch { ok = false; } if (ok && (!T[p] || T[p].t === 'nl' || is(';') || is('}') || is('>') || is('>>') || is('|'))) list = inner; else { p = save; list = exprList(); } }
          else list = exprList();
          const r = redirect();
          return E => E.emit(list.length ? list.map(e => str(e(E))).join(str(E.vars.OFS)) + str(E.vars.ORS) : E.f[0] + str(E.vars.ORS), r && { append: r.append, file: str(r.e(E)) });
        }
        case 'printf': { const paren = is('(') && (() => { let d = 0; for (let k = p; k < T.length; k++) { if (T[k].t === 'op' && T[k].v === '(') d++; else if (T[k].t === 'op' && T[k].v === ')' && --d === 0) return !T[k + 1] || T[k + 1].t === 'nl' || [';', '}', '>', '>>'].includes(T[k + 1].v); } return false; })(); if (paren) p++; const list = exprList(); if (paren) need(')'); const r = redirect(); return E => E.emit(sprintf(str(list[0](E)), list.slice(1).map(e => str(e(E)))), r && { append: r.append, file: str(r.e(E)) }); }
        case 'if': { need('('); const c = expr(); need(')'); const a = body(); const save = p; skipNl(); let b = null; if (T[p] && T[p].t === 'kw' && T[p].v === 'else') { p++; b = body(); } else p = save; return E => { if (truthy(c(E))) a(E); else if (b) b(E); }; }
        case 'while': { need('('); const c = expr(); need(')'); const b = body(); return E => { let g = 0; while (truthy(c(E))) { if (++g > 2e6) throw new Error('loop limit exceeded'); try { b(E); } catch (e) { if (e instanceof Brk) break; if (!(e instanceof Cont)) throw e; } } }; }
        case 'do': { const b = body(); skipNl(); p++; need('('); const c = expr(); need(')'); return E => { let g = 0; do { if (++g > 2e6) throw new Error('loop limit exceeded'); try { b(E); } catch (e) { if (e instanceof Brk) break; if (!(e instanceof Cont)) throw e; } } while (truthy(c(E))); }; }
        case 'for': {
          need('(');
          if (T[p].t === 'name' && T[p + 1] && T[p + 1].t === 'kw' && T[p + 1].v === 'in') { const v = T[p].v, arr = T[p + 2].v; p += 3; need(')'); const b = body(); return E => { for (const k of Object.keys(E.arr[arr] ||= {})) { E.set(v, k); try { b(E); } catch (e) { if (e instanceof Brk) break; if (!(e instanceof Cont)) throw e; } } }; }
          noIn = false;
          const init = is(';') ? null : expr(); need(';'); const c = is(';') ? null : expr(); need(';'); const step = is(')') ? null : expr(); need(')');
          const b = body();
          return E => { let g = 0; for (init && init(E); !c || truthy(c(E)); step && step(E)) { if (++g > 2e6) throw new Error('loop limit exceeded'); try { b(E); } catch (e) { if (e instanceof Brk) break; if (!(e instanceof Cont)) throw e; } } };
        }
        case 'next': return () => { throw new Next(); };
        case 'exit': { const e = T[p] && T[p].t !== 'nl' && !is(';') && !is('}') ? expr() : null; return E => { throw new Stop(e ? num(e(E)) : 0); }; }
        case 'break': return () => { throw new Brk(); };
        case 'continue': return () => { throw new Cont(); };
        case 'delete': { const name = T[p++].v; if (eat('[')) { const k = expr(); need(']'); return E => { delete (E.arr[name] ||= {})[str(k(E))]; }; } return E => { E.arr[name] = {}; }; }
        case 'getline': p--; break;
        default: throw new Error(`syntax error near ${t.v}`);
      }
    }
    const e = expr();
    return E => { e(E); };
  }

  const rules = [];
  skipNl();
  while (p < T.length) {
    const t = T[p];
    if (t.t === 'kw' && (t.v === 'BEGIN' || t.v === 'END')) { p++; optNl(); rules.push({ kind: t.v, act: block() }); }
    else if (t.t === 'kw' && t.v === 'function') throw new Error('user-defined functions are not supported in this build');
    else {
      let pat = null, pat2 = null;
      if (!is('{')) { pat = expr(); if (eat(',')) { optNl(); pat2 = expr(); } }
      const act = is('{') ? block() : null;
      rules.push({ kind: 'main', pat, pat2, act, on: false });
    }
    skipNl();
  }
  return rules;
}

export function awk(prog, { files, vars = {}, fs, out, write }) {
  const rules = typeof prog === 'string' ? compile(prog) : prog;
  const E = {
    vars: { FS: fs ?? ' ', OFS: ' ', ORS: '\n', NR: 0, NF: 0, FNR: 0, FILENAME: '', RSTART: 0, RLENGTH: -1, SUBSEP: '\x1c', ...vars }, arr: {}, f: [''], recs: [], ri: 0,
    get(n) { return n === 'NF' ? this.f.length - 1 : this.vars[n] ?? ''; },
    set(n, v) { if (n === 'NF') { const k = Math.max(0, Math.trunc(num(v))); while (this.f.length - 1 < k) this.f.push(''); this.f.length = k + 1; this.rebuild(); } else this.vars[n] = v; },
    split(t, sep) {
      if (sep instanceof RegExp) return t.split(sep);
      sep = str(sep);
      if (sep === ' ') { const s = t.trim(); return s === '' ? [] : s.split(/[ \t\n]+/); }
      if (sep.length === 1 || sep === '\t') return t.split(sep);
      return t.split(re(sep));
    },
    setRecord(r) { this.f = [r, ...this.split(r, this.vars.FS)]; },
    rebuild() { this.f[0] = this.f.slice(1).map(str).join(str(this.vars.OFS)); },
    getField(i) { return i === 0 ? this.f[0] : this.f[i] ?? ''; },
    setField(i, v) { if (i === 0) return this.setRecord(str(v)); while (this.f.length <= i) this.f.push(''); this.f[i] = str(v); this.rebuild(); },
    emit(s, redir) { if (redir) write(redir.file, s, redir.append || this.opened.has(redir.file)), this.opened.add(redir.file); else out(s); },
    opened: new Set(),
  };
  let code = 0;
  const run = kind => { for (const r of rules) if (r.kind === kind) r.act(E); };
  try {
    run('BEGIN');
    if (rules.some(r => r.kind !== 'BEGIN')) {
      for (const file of files) {
        E.vars.FILENAME = file.name; E.vars.FNR = 0;
        E.recs = lines(file.text);
        for (E.ri = 0; E.ri < E.recs.length; E.ri++) {
          E.vars.NR++; E.vars.FNR++;
          E.setRecord(E.recs[E.ri]);
          try {
            for (const r of rules) {
              if (r.kind !== 'main') continue;
              let hit;
              if (r.pat2) { if (r.on) { hit = true; if (truthy(r.pat2(E))) r.on = false; } else if (truthy(r.pat(E))) { hit = true; r.on = !truthy(r.pat2(E)); } else hit = false; }
              else hit = !r.pat || truthy(r.pat(E));
              if (hit) { if (r.act) r.act(E); else E.emit(E.f[0] + str(E.vars.ORS)); }
            }
          } catch (e) { if (!(e instanceof Next)) throw e; }
        }
      }
    }
  } catch (e) { if (e instanceof Stop) code = e.code; else throw e; }
  try { run('END'); } catch (e) { if (e instanceof Stop) code = e.code; else throw e; }
  return code;
}

def('awk gawk mawk nawk', async ctx => {
  const a = ctx.args, vars = {}, files = [];
  let fs, prog = null;
  for (let i = 0; i < a.length; i++) {
    const s = a[i];
    if (prog === null && s === '-F') fs = a[++i];
    else if (prog === null && s.startsWith('-F')) fs = s.slice(2);
    else if (prog === null && s === '-v') { const m = /^(\w+)=(.*)$/s.exec(a[++i] || ''); if (m) vars[m[1]] = m[2]; }
    else if (prog === null && s === '-f') { try { prog = ctx.fs.read(ctx.path(a[++i])); } catch (e) { ctx.err(`awk: fatal: cannot open source file \`${a[i]}' for reading: ${errMsg(e)}\n`); return 2; } }
    else if (prog === null && s === '--version') { ctx.out('GNU Awk 5.1.0, API: 3.0 (compact browser build)\n'); return 0; }
    else if (prog === null && s === '--') continue;
    else if (prog === null) prog = s;
    else if (/^\w+=/.test(s) && !ctx.fs.exists(ctx.path(s))) { const m = /^(\w+)=(.*)$/s.exec(s); vars[m[1]] = m[2]; }
    else files.push(s);
  }
  if (prog === null) throw new UsageError('usage: awk [-F fs][-v var=value][prog | -f progfile][file ...]');
  if (fs !== undefined) fs = fs === 't' ? '\t' : fs.replace(/\\t/g, '\t');
  let rules;
  try { rules = compile(prog); } catch (e) { ctx.err(`awk: cmd. line:1: ${e.message}\n`); return 1; }
  const needInput = rules.some(r => r.kind !== 'BEGIN');
  const { list, status } = needInput ? await inputs(ctx, files) : { list: [], status: 0 };
  try {
    const code = awk(rules, { files: list.map(f => ({ name: f.name === '(standard input)' ? '' : f.name, text: f.text })), vars, fs, out: s => ctx.out(s), write: (file, s, append) => ctx.fs.write(ctx.path(file), s, { append }) });
    return code || status;
  } catch (e) {
    if (e.code) { ctx.err(`awk: cannot open file: ${errMsg(e)}\n`); return 2; }
    if (e.constructor.name === 'Interrupt' || e.constructor.name === 'PipeFull') throw e;
    ctx.err(`awk: cmd. line:1: (FILENAME=- FNR=1) fatal: ${e.message}\n`); return 2;
  }
}, { usage: "awk [-F fs] [-v var=value] 'program' [file ...]", desc: "Pattern scanning and processing language.\n  awk '{print $1}' file      awk -F: '$3 >= 1000 {print $1}' /etc/passwd\n  awk '{s += $1} END {print s}'      awk 'NR % 2 == 0'      awk '/re/ {n++} END {print n}'\nSupports fields, NR/NF/FS/OFS, arrays, if/while/for, printf, length/substr/index/split/sub/gsub/match/toupper/tolower/sprintf.", ownHelp: false });
