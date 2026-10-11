// GNU-style userland for the bash shell: file and text utilities.
// Each command is `async ctx => exitStatus`; see Bash.runExternal for the ctx shape.

import { globToRe, strftime, columnize, evalArith, fmtBytes } from '../core/util.js';
import { FsError, errMsg, dirname, basename, join, extname } from '../core/vfs.js';

export const commands = {};
export class UsageError extends Error { }

export function def(names, fn, meta = {}) {
  const wrapped = async ctx => {
    try { return await fn(ctx); }
    catch (e) {
      if (e instanceof UsageError) { ctx.err(`${ctx.name}: ${e.message}\nTry '${ctx.name} --help' for more information.\n`); return 2; }
      throw e;
    }
  };
  for (const n of names.split(' ')) commands[n] = { fn: wrapped, ...meta };
}

// getopt: spec 'ab:c' (b takes a value); longs maps long names to short letters.
export function getopt(ctx, spec = '', longs = {}, { args, stop = false } = {}) {
  const o = {}, rest = [], takes = new Set(), flags = new Set();
  for (let i = 0; i < spec.length; i++) { if (spec[i + 1] === ':') { takes.add(spec[i]); i++; } else flags.add(spec[i]); }
  const a = args || ctx.args;
  for (let i = 0; i < a.length; i++) {
    const s = a[i];
    if (s === '--') { rest.push(...a.slice(i + 1)); break; }
    if (stop && (s[0] !== '-' || s === '-')) { rest.push(...a.slice(i)); break; }
    if (s.startsWith('--') && s.length > 2) {
      const eq = s.indexOf('='), k = eq < 0 ? s.slice(2) : s.slice(2, eq), v = eq < 0 ? undefined : s.slice(eq + 1);
      const short = longs[k];
      if (short === undefined) throw new UsageError(`unrecognized option '--${k}'`);
      o[short] = takes.has(short) ? v ?? a[++i] : v ?? true;
    } else if (s[0] === '-' && s.length > 1) {
      for (let k = 1; k < s.length; k++) {
        const c = s[k];
        if (takes.has(c)) { o[c] = s.slice(k + 1) || a[++i]; if (o[c] === undefined) throw new UsageError(`option requires an argument -- '${c}'`); break; }
        if (!flags.has(c)) throw new UsageError(`invalid option -- '${c}'`);
        o[c] = true;
      }
    } else rest.push(s);
  }
  return { o, rest };
}

const ferr = (ctx, arg, e, verb) => ctx.err(`${ctx.name}: ${verb ? `${verb} ` : ''}${verb ? `'${arg}'` : arg}: ${e instanceof FsError ? errMsg(e) : e.message}\n`);

// Reads the named files ('-' or none = stdin). Reports unreadable ones.
export async function inputs(ctx, files) {
  const out = [];
  let status = 0;
  if (!files.length) return { list: [{ name: '', text: await ctx.readAll() }], status };
  for (const f of files) {
    if (f === '-') { out.push({ name: '(standard input)', text: await ctx.readAll() }); continue; }
    try { out.push({ name: f, text: ctx.fs.read(ctx.path(f)) }); } catch (e) { ferr(ctx, f, e); status = 1; }
  }
  return { list: out, status };
}
export const lines = text => { if (text === '') return []; const l = text.split('\n'); if (l.at(-1) === '') l.pop(); return l; };

const CLASSES = { alpha: 'a-zA-Z', digit: '0-9', alnum: 'a-zA-Z0-9', upper: 'A-Z', lower: 'a-z', space: ' \\t\\n\\r\\f\\v', blank: ' \\t', punct: '!-\\/:-@\\[-`{-~', xdigit: '0-9a-fA-F' };
// POSIX basic / extended regex -> JS regex source.
export function posixRe(pat, ere) {
  let out = '';
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === '[') {
      let j = i + 1;
      if (pat[j] === '^') j++;
      if (pat[j] === ']') j++;
      while (j < pat.length && pat[j] !== ']') { if (pat[j] === '[' && pat[j + 1] === ':') j = pat.indexOf(':]', j) + 1; j++; }
      if (j >= pat.length) { out += '\\['; continue; }
      let body = pat.slice(i + 1, j), neg = '';
      if (body[0] === '^') { neg = '^'; body = body.slice(1); }
      body = body.replace(/\[:(\w+):\]/g, (m, k) => '\x00' + k + '\x00').replace(/\\/g, '\\\\').replace(/^\]/, '\\]').replace(/\[/g, '\\[').replace(/\x00(\w+)\x00/g, (m, k) => CLASSES[k] || '');
      out += '[' + neg + body + ']'; i = j; continue;
    }
    if (c === '\\') {
      const d = pat[++i];
      if (d === undefined) { out += '\\\\'; break; }
      if (!ere && '(){}|+?'.includes(d)) out += d;
      else if (d === '<' || d === '>') out += '\\b';
      else if (/[A-Za-z0-9]/.test(d)) out += /[wWsSbBdDnt1-9]/.test(d) ? '\\' + d : d;
      else out += '\\' + d;
      continue;
    }
    if (!ere && '(){}|+?'.includes(c)) { out += '\\' + c; continue; }
    if (c === '/') { out += '\\/'; continue; }
    out += c;
  }
  return out;
}

// ---------------------------------------------------------------- ls & friends
export function modeStr(n) {
  const t = n.t === 'd' ? 'd' : n.t === 'l' ? 'l' : n.dev ? 'c' : '-';
  let s = '';
  for (let k = 2; k >= 0; k--) { const b = (n.m >> (k * 3)) & 7; s += (b & 4 ? 'r' : '-') + (b & 2 ? 'w' : '-') + (b & 1 ? 'x' : '-'); }
  if (n.m & 0o1000) s = s.slice(0, 8) + 't';
  return t + s;
}
const human = n => { if (n < 1024) return String(n); const u = 'KMGTP'; let i = -1; do { n /= 1024; i++; } while (n >= 1024); return (n < 10 ? n.toFixed(1) : Math.ceil(n)) + u[i]; };
const lsDate = mt => { const d = new Date(mt); return Math.abs(Date.now() - mt) < 15552e6 ? strftime('%b %e %H:%M', d) : strftime('%b %e  %Y', d); };
const ARCH = new Set(['tar', 'gz', 'tgz', 'zip', 'bz2', 'xz', '7z', 'deb', 'rpm', 'jar']);
const IMG = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'mp4', 'mkv', 'webm', 'ico']);
export function lsColor(name, n, target) {
  let c = '';
  if (n.t === 'd') c = n.m & 0o002 ? '30;42' : '01;34';
  else if (n.t === 'l') c = target === null ? '40;31;01' : '01;36';
  else if (n.m & 0o111) c = '01;32';
  else { const e = extname(name); if (ARCH.has(e)) c = '01;31'; else if (IMG.has(e)) c = '01;35'; else if (['mp3', 'ogg', 'wav', 'flac'].includes(e)) c = '00;36'; }
  return c ? `\x1b[${c}m${name}\x1b[0m` : name;
}
const nameSort = (a, b) => a.replace(/^\.+/, '').localeCompare(b.replace(/^\.+/, ''), 'en', { sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);

def('ls dir', ctx => {
  const { o, rest } = getopt(ctx, 'laAhRr1tSdFCgGoXQpnisU', { all: 'a', 'almost-all': 'A', 'human-readable': 'h', recursive: 'R', reverse: 'r', color: 'C', directory: 'd', classify: 'F', 'group-directories-first': 'X' });
  const fs = ctx.fs, color = o.C === 'always' || ((o.C === true || o.C === 'auto') && ctx.tty);
  const long = o.l || o.g || o.o || o.n, one = o['1'] || !ctx.tty;
  let status = 0, first = true;
  const quote = name => (ctx.tty && /[ '"$&;()<>|*?\\]/.test(name) ? `'${name.replace(/'/g, "'\\''")}'` : name);
  const fmt = (name, n, dir) => {
    let target = null;
    if (n.t === 'l') target = fs.stat(fs.abs(n.d, dir)) ? n.d : null;
    let s = color ? lsColor(quote(name), n, n.t === 'l' ? target : undefined) : quote(name);
    if (o.F || o.p) s += n.t === 'd' ? '/' : !o.F ? '' : n.t === 'l' ? (long ? '' : '@') : n.m & 0o111 ? '*' : '';
    if (long && n.t === 'l') { const tn = fs.stat(fs.abs(n.d, dir)); s += ' -> ' + (color && tn ? lsColor(n.d, tn) : n.d); }
    return s;
  };
  const show = (entries, dir) => {   // entries: [name, node]
    if (o.t) entries.sort((a, b) => b[1].mt - a[1].mt);
    else if (o.S) entries.sort((a, b) => fs.size(b[1]) - fs.size(a[1]));
    else if (!o.U) entries.sort((a, b) => nameSort(a[0], b[0]));
    if (o.X) entries.sort((a, b) => (b[1].t === 'd') - (a[1].t === 'd'));
    if (o.r) entries.reverse();
    if (long) {
      const rows = entries.map(([name, n]) => {
        const nl = n.t === 'd' ? 2 + Object.values(n.c).filter(c => c.t === 'd').length : 1;
        const sz = n.t === 'l' ? n.d.length : fs.size(n);
        const own = o.n ? (n.o === 'root' ? '0' : '1000') : n.o;
        return [modeStr(n), String(nl), own, own, o.h ? human(sz) : String(sz), lsDate(n.mt), fmt(name, n, dir)];
      });
      const w = [1, 2, 3, 4].map(k => Math.max(0, ...rows.map(r => r[k].length)));
      return rows.map(r => `${r[0]} ${r[1].padStart(w[0])} ${o.g ? '' : r[2].padEnd(w[1]) + ' '}${o.G || o.o ? '' : r[3].padEnd(w[2]) + ' '}${r[4].padStart(w[3])} ${r[5]} ${r[6]}`).join('\n') + (rows.length ? '\n' : '');
    }
    const names = entries.map(([name, n]) => fmt(name, n, dir));
    if (one) return names.map(n => n + '\n').join('');
    return columnize(names, ctx.cols);
  };
  const listDir = (arg, path, header) => {
    let names;
    try { names = fs.readdir(path); } catch (e) { ctx.err(`ls: cannot open directory '${arg}': ${errMsg(e)}\n`); status = 2; return; }
    const dirNode = fs.stat(path);
    let entries = names.filter(n => o.a || o.A || n[0] !== '.').map(n => [n, dirNode.c[n]]);
    if (o.a) entries.unshift(['.', dirNode], ['..', fs.stat(dirname(path)) || dirNode]);
    if (header) ctx.out(`${first ? '' : '\n'}${arg}:\n`);
    first = false;
    if (long) ctx.out(`total ${entries.reduce((s, [, n]) => s + (n.t === 'd' ? 4 : n.t === 'l' ? 0 : Math.ceil(fs.size(n) / 4096) * 4), 0)}\n`);
    ctx.out(show(entries, path));
    if (o.R) for (const [n, node] of entries) if (node.t === 'd' && n !== '.' && n !== '..') listDir(join(arg, n).replace(/^\/\//, '/'), join(path, n), true);
  };
  const targets = rest.length ? rest : ['.'];
  const files = [], dirs = [];
  for (const t of targets) {
    const p = ctx.path(t), n = fs.lstat(p);
    if (!n) { ctx.err(`ls: cannot access '${t}': No such file or directory\n`); status = 2; continue; }
    const real = n.t === 'l' && !long && !o.d ? fs.stat(p) || n : n;
    if (real.t === 'd' && !o.d) dirs.push([t, p]); else files.push([t, n]);
  }
  if (files.length) { ctx.out(show(files, ctx.cwd)); first = false; }
  dirs.sort((a, b) => nameSort(a[0], b[0]));
  for (const [t, p] of dirs) listDir(t, p, targets.length > 1 || o.R);
  return status;
}, { usage: 'ls [OPTION]... [FILE]...', desc: 'List information about the FILEs (the current directory by default).' });

def('cat', async ctx => {
  const { o, rest } = getopt(ctx, 'nbEATsetv', { number: 'n', 'show-ends': 'E', 'show-all': 'A' });
  let no = 1, status = 0;
  const emit = text => {
    if (!(o.n || o.b || o.E || o.A || o.T || o.s)) return ctx.out(text);
    let ls = text.split('\n');
    const tail = ls.at(-1) === '' ? (ls.pop(), '\n') : '';
    if (o.s) ls = ls.filter((l, i) => !(l === '' && ls[i - 1] === ''));
    ctx.out(ls.map(l => {
      if (o.T || o.A) l = l.replace(/\t/g, '^I');
      if (o.E || o.A) l += '$';
      return (o.b ? (l.replace(/\$$/, '') ? String(no++).padStart(6) + '\t' : '') : o.n ? String(no++).padStart(6) + '\t' : '') + l;
    }).join('\n') + tail);
  };
  if (!rest.length || rest.every(f => f === '-')) {
    if (ctx.hasStdin) { emit(ctx.stdin); return 0; }
    for (;;) { const l = await ctx.readLine(); if (l === null) break; emit(l + '\n'); }
    return 0;
  }
  for (const f of rest) {
    if (f === '-') { emit(await ctx.readAll()); continue; }
    try { emit(ctx.fs.read(ctx.path(f))); } catch (e) { ferr(ctx, f, e); status = 1; }
    await ctx.tick();
  }
  return status;
}, { usage: 'cat [OPTION]... [FILE]...', desc: 'Concatenate FILE(s) to standard output.' });

def('tac', async ctx => { const { list, status } = await inputs(ctx, ctx.args); for (const f of list) ctx.out(lines(f.text).reverse().map(l => l + '\n').join('')); return status; }, { usage: 'tac [FILE]...', desc: 'Write each FILE to standard output, last line first.' });
def('rev', async ctx => { const { list, status } = await inputs(ctx, ctx.args); for (const f of list) ctx.out(lines(f.text).map(l => [...l].reverse().join('') + '\n').join('')); return status; }, { usage: 'rev [file ...]', desc: 'Reverse lines characterwise.' });
def('nl', async ctx => { const { list, status } = await inputs(ctx, ctx.args.filter(a => !a.startsWith('-'))); let n = 1; for (const f of list) ctx.out(lines(f.text).map(l => (l ? String(n++).padStart(6) + '\t' + l : '') + '\n').join('')); return status; }, { usage: 'nl [FILE]...', desc: 'Write each FILE to standard output, with line numbers added.' });

async function headTail(ctx, isTail) {
  const args = ctx.args.map(a => (/^-\d+$/.test(a) ? '-n' + a.slice(1) : /^\+\d+$/.test(a) && isTail ? '-n' + a : a));
  const { o, rest } = getopt(ctx, 'n:c:qvfF', { lines: 'n', bytes: 'c', follow: 'f', quiet: 'q' }, { args });
  const spec = o.c ?? o.n ?? '10', n = parseInt(String(spec).replace(/^[+-]/, ''), 10);
  if (Number.isNaN(n)) throw new UsageError(`invalid number of ${o.c ? 'bytes' : 'lines'}: '${spec}'`);
  const { list, status } = await inputs(ctx, rest);
  const cutText = text => {
    if (o.c) return isTail ? (String(spec)[0] === '+' ? text.slice(n - 1) : text.slice(-n)) : String(spec)[0] === '-' ? text.slice(0, -n) : text.slice(0, n);
    const l = lines(text);
    const sel = isTail ? (String(spec)[0] === '+' ? l.slice(n - 1) : n ? l.slice(-n) : []) : String(spec)[0] === '-' ? l.slice(0, -n || l.length) : l.slice(0, n);
    return sel.map(x => x + '\n').join('');
  };
  list.forEach((f, i) => { if ((list.length > 1 && !o.q) || o.v) ctx.out(`${i ? '\n' : ''}==> ${f.name || 'standard input'} <==\n`); ctx.out(cutText(f.text)); });
  if (isTail && (o.f || o.F) && rest.length) {
    const p = ctx.path(rest.at(-1));
    let len = (ctx.fs.stat(p)?.d || '').length;
    for (;;) { await ctx.sleep(400); const d = ctx.fs.stat(p)?.d || ''; if (d.length > len) ctx.out(d.slice(len)); len = d.length; }
  }
  return status;
}
def('head', ctx => headTail(ctx, false), { usage: 'head [OPTION]... [FILE]...', desc: 'Print the first 10 lines of each FILE to standard output.\n  -n NUM  print the first NUM lines\n  -c NUM  print the first NUM bytes' });
def('tail', ctx => headTail(ctx, true), { usage: 'tail [OPTION]... [FILE]...', desc: 'Print the last 10 lines of each FILE to standard output.\n  -n NUM  output the last NUM lines\n  -f      output appended data as the file grows' });

def('touch', ctx => {
  const { o, rest } = getopt(ctx, 'acmd:t:r:', { 'no-create': 'c', date: 'd' });
  if (!rest.length) throw new UsageError('missing file operand');
  let st = 0;
  const when = o.d ? Date.parse(o.d) || Date.now() : Date.now();
  for (const f of rest) {
    const p = ctx.path(f);
    try { if (o.c && !ctx.fs.exists(p)) continue; ctx.fs.touch(p, when); } catch (e) { ferr(ctx, f, e, 'cannot touch'); st = 1; }
  }
  return st;
}, { usage: 'touch [OPTION]... FILE...', desc: 'Update the access and modification times of each FILE to the current time.\nA FILE argument that does not exist is created empty.' });

def('mkdir', ctx => {
  const { o, rest } = getopt(ctx, 'pvm:', { parents: 'p', verbose: 'v', mode: 'm' });
  if (!rest.length) throw new UsageError('missing operand');
  let st = 0;
  for (const d of rest) {
    try { ctx.fs.mkdir(ctx.path(d), { p: o.p, mode: o.m ? parseInt(o.m, 8) : 0o755 }); if (o.v) ctx.out(`mkdir: created directory '${d}'\n`); }
    catch (e) { ferr(ctx, d, e, 'cannot create directory'); st = 1; }
  }
  return st;
}, { usage: 'mkdir [OPTION]... DIRECTORY...', desc: 'Create the DIRECTORY(ies), if they do not already exist.\n  -p  no error if existing, make parent directories as needed' });

def('rmdir', ctx => {
  const { o, rest } = getopt(ctx, 'pv', { parents: 'p' });
  if (!rest.length) throw new UsageError('missing operand');
  let st = 0;
  for (const d of rest) {
    try { let p = ctx.path(d); ctx.fs.rmdir(p); if (o.p) while ((p = dirname(p)) !== '/' && p.length >= ctx.cwd.length) { try { ctx.fs.rmdir(p); } catch { break; } } }
    catch (e) { ferr(ctx, d, e, 'failed to remove'); st = 1; }
  }
  return st;
}, { usage: 'rmdir [OPTION]... DIRECTORY...', desc: 'Remove the DIRECTORY(ies), if they are empty.' });

def('rm', async ctx => {
  const { o, rest } = getopt(ctx, 'rRfivdI', { recursive: 'r', force: 'f', verbose: 'v', 'no-preserve-root': 'P', 'preserve-root': 'p', interactive: 'i', dir: 'd' });
  if (!rest.length) { if (o.f) return 0; throw new UsageError('missing operand'); }
  const fs = ctx.fs, rec = o.r || o.R;
  let st = 0;
  // Remove bottom-up so that permission errors are reported per entry, like the real thing.
  const rmTree = (arg, p) => {
    const n = fs.lstat(p);
    if (n.t === 'd') {
      let ok = true, names;
      try { names = fs.readdir(p); } catch (e) { ferr(ctx, arg, e, 'cannot remove'); return false; }
      for (const k of names) ok = rmTree(join(arg, k), join(p, k)) && ok;
      if (!ok) return false;
      try { fs.rmdir(p); } catch (e) { ferr(ctx, arg, e, 'cannot remove'); return false; }
    } else { try { fs.unlink(p); } catch (e) { ferr(ctx, arg, e, 'cannot remove'); return false; } }
    if (o.v) ctx.out(`removed ${n.t === 'd' ? 'directory ' : ''}'${arg}'\n`);
    return true;
  };
  for (const f of rest) {
    const p = ctx.path(f), n = fs.lstat(p);
    if (p === '/' && !o.P) { ctx.err("rm: it is dangerous to operate recursively on '/'\nrm: use --no-preserve-root to override this failsafe\n"); st = 1; continue; }
    if (f === '.' || f === '..' || f.endsWith('/.') || f.endsWith('/..')) { ctx.err(`rm: refusing to remove '.' or '..' directory: skipping '${f}'\n`); st = 1; continue; }
    if (!n) { if (!o.f) { ctx.err(`rm: cannot remove '${f}': No such file or directory\n`); st = 1; } continue; }
    if (n.t === 'd' && !rec && !o.d) { ctx.err(`rm: cannot remove '${f}': Is a directory\n`); st = 1; continue; }
    if (o.i) { const a = await ctx.readLine({ prompt: `rm: remove ${n.t === 'd' ? 'directory' : n.d === '' ? 'regular empty file' : 'regular file'} '${f}'? ` }); if (!/^y/i.test(a || '')) continue; }
    if (p === '/') {
      for (const k of fs.readdir('/')) rmTree('/' + k, '/' + k);
      if (ctx.os.panic) ctx.os.panic();
      continue;
    }
    if (!rmTree(f, p)) st = 1;
    await ctx.tick();
  }
  return st;
}, { usage: 'rm [OPTION]... [FILE]...', desc: 'Remove (unlink) the FILE(s).\n  -f  ignore nonexistent files, never prompt\n  -r  remove directories and their contents recursively\n  -i  prompt before every removal' });

function cpmv(ctx, move) {
  const { o, rest } = getopt(ctx, 'rRafvniuTptd', { recursive: 'r', force: 'f', verbose: 'v', 'no-clobber': 'n', archive: 'a', preserve: 'p' });
  const fs = ctx.fs, name = ctx.name;
  if (!rest.length) throw new UsageError('missing file operand');
  if (rest.length === 1) throw new UsageError(`missing destination file operand after '${rest[0]}'`);
  const dest = rest.pop(), dp = ctx.path(dest), destDir = fs.isDir(dp);
  if (rest.length > 1 && !destDir) { ctx.err(`${name}: target '${dest}' is not a directory\n`); return 1; }
  let st = 0;
  for (const src of rest) {
    const sp = ctx.path(src), n = fs.lstat(sp);
    if (!n) { ctx.err(`${name}: cannot stat '${src}': No such file or directory\n`); st = 1; continue; }
    const tp = destDir ? join(dp, basename(sp)) : dp, shown = destDir ? join(dest, basename(sp)).replace(/\/+/g, '/') : dest;
    if (!move && n.t === 'd' && !(o.r || o.R || o.a)) { ctx.err(`cp: -r not specified; omitting directory '${src}'\n`); st = 1; continue; }
    if (sp === tp) { ctx.err(`${name}: '${src}' and '${shown}' are the same file\n`); st = 1; continue; }
    if ((tp + '/').startsWith(sp + '/')) { ctx.err(`${name}: cannot ${move ? 'move' : 'copy'} ${move ? '' : 'a directory, '}'${src}'${move ? ' to a subdirectory of' : ', into'} itself, '${shown}'\n`); st = 1; continue; }
    if (o.n && fs.exists(tp)) continue;
    try {
      if (move) fs.rename(sp, tp); else fs.copy(sp, tp, { r: true, preserve: o.a || o.p });
      if (o.v) ctx.out(move ? `renamed '${src}' -> '${shown}'\n` : `'${src}' -> '${shown}'\n`);
    } catch (e) { ctx.err(`${name}: cannot ${move ? 'move' : 'create regular file'} '${move ? src : shown}'${move ? ` to '${shown}'` : ''}: ${errMsg(e)}\n`); st = 1; }
  }
  return st;
}
def('cp', ctx => cpmv(ctx, false), { usage: 'cp [OPTION]... SOURCE... DEST', desc: 'Copy SOURCE to DEST, or multiple SOURCE(s) to DIRECTORY.\n  -r  copy directories recursively\n  -v  explain what is being done' });
def('mv', ctx => cpmv(ctx, true), { usage: 'mv [OPTION]... SOURCE... DEST', desc: 'Rename SOURCE to DEST, or move SOURCE(s) to DIRECTORY.' });

def('ln', ctx => {
  const { o, rest } = getopt(ctx, 'sfvnT', { symbolic: 's', force: 'f' });
  if (!rest.length) throw new UsageError('missing file operand');
  const fs = ctx.fs, target = rest[0];
  let dest = rest[1] ?? basename(target), dp = ctx.path(dest);
  if (fs.isDir(dp)) { dp = join(dp, basename(target)); dest = join(dest, basename(target)); }
  try {
    if (o.f && fs.lstat(dp)) fs.rm(dp, { r: true });
    if (o.s) fs.symlink(target, dp);
    else {
      const n = fs.stat(ctx.path(target));
      if (!n) { ctx.err(`ln: failed to access '${target}': No such file or directory\n`); return 1; }
      if (n.t === 'd') { ctx.err(`ln: ${target}: hard link not allowed for directory\n`); return 1; }
      fs.copy(ctx.path(target), dp, { preserve: true });
    }
    if (o.v) ctx.out(`'${dest}' -> '${target}'\n`);
  } catch (e) { ctx.err(`ln: failed to create ${o.s ? 'symbolic ' : 'hard '}link '${dest}': ${errMsg(e)}\n`); return 1; }
}, { usage: 'ln [OPTION]... TARGET LINK_NAME', desc: 'Create a link to TARGET with the name LINK_NAME.\n  -s  make symbolic links instead of hard links' });

function parseMode(spec, old, isDir) {
  if (/^[0-7]{1,4}$/.test(spec)) return parseInt(spec, 8);
  let m = old;
  for (const part of spec.split(',')) {
    const mm = /^([ugoa]*)([-+=])([rwxXst]*)$/.exec(part);
    if (!mm) return null;
    const who = mm[1] || 'a';
    let bits = 0;
    if (mm[3].includes('r')) bits |= 4;
    if (mm[3].includes('w')) bits |= 2;
    if (mm[3].includes('x') || (mm[3].includes('X') && (isDir || old & 0o111))) bits |= 1;
    for (const [w, sh] of [['u', 6], ['g', 3], ['o', 0]]) {
      if (!who.includes(w) && !who.includes('a')) continue;
      // a bare "+w" respects the umask for group/other, as chmod does
      const b = !mm[1] && sh !== 6 ? bits & ~2 : bits;
      if (mm[2] === '+') m |= b << sh; else if (mm[2] === '-') m &= ~(bits << sh); else m = (m & ~(7 << sh)) | (b << sh);
    }
  }
  return m;
}
def('chmod', ctx => {
  const args = ctx.args.filter(a => !/^-[Rvcf]+$/.test(a)), rec = ctx.args.some(a => /^-\w*R/.test(a));
  if (args.length < 2) throw new UsageError(args.length ? `missing operand after '${args[0]}'` : 'missing operand');
  let st = 0;
  for (const f of args.slice(1)) {
    const apply = p => { const n = ctx.fs.stat(p); const m = parseMode(args[0], n.m, n.t === 'd'); if (m === null) throw new UsageError(`invalid mode: '${args[0]}'`); ctx.fs.chmod(p, m); };
    try {
      const p = ctx.path(f);
      if (!ctx.fs.stat(p)) { ctx.err(`chmod: cannot access '${f}': No such file or directory\n`); st = 1; continue; }
      if (rec) ctx.fs.walk(p, q => apply(q)); else apply(p);
    } catch (e) { if (e instanceof UsageError) throw e; ctx.err(`chmod: changing permissions of '${f}': ${errMsg(e)}\n`); st = 1; }
  }
  return st;
}, { usage: 'chmod [OPTION]... MODE[,MODE]... FILE...', desc: 'Change the mode of each FILE to MODE (octal like 755, or symbolic like u+x).' });

def('chown chgrp', ctx => {
  const args = ctx.args.filter(a => !/^-[Rvcfh]+$/.test(a)), rec = ctx.args.some(a => /^-\w*R/.test(a));
  if (args.length < 2) throw new UsageError(args.length ? `missing operand after '${args[0]}'` : 'missing operand');
  const owner = args[0].split(/[:.]/)[0];
  let st = 0;
  for (const f of args.slice(1)) {
    try {
      const p = ctx.path(f);
      if (!ctx.fs.stat(p)) { ctx.err(`${ctx.name}: cannot access '${f}': No such file or directory\n`); st = 1; continue; }
      if (ctx.name === 'chown' && owner) { if (rec) ctx.fs.walk(p, q => ctx.fs.chown(q, owner)); else ctx.fs.chown(p, owner); }
    } catch (e) { ctx.err(`${ctx.name}: changing ownership of '${f}': ${errMsg(e)}\n`); st = 1; }
  }
  return st;
}, { usage: 'chown [OPTION]... [OWNER][:[GROUP]] FILE...', desc: 'Change the owner and/or group of each FILE.' });

export function fileType(name, n) {
  if (n.t === 'd') return 'directory';
  if (n.t === 'l') return `symbolic link to ${n.d}`;
  if (n.dev) return 'character special';
  const d = n.dyn ? '' : n.d, e = extname(name);
  if (d === '') return 'empty';
  if (d.startsWith('\x7fELF')) return 'ELF 64-bit LSB pie executable, x86-64, version 1 (SYSV), dynamically linked, interpreter /lib64/ld-linux-x86-64.so.2, for GNU/Linux 3.2.0, stripped';
  if (d.startsWith('data:image/png')) return 'PNG image data, 8-bit/color RGBA, non-interlaced';
  if (d.startsWith('data:image/jpeg')) return 'JPEG image data, JFIF standard 1.01';
  const m = /^#!\s*(\S+)(?:\s+(\S+))?/.exec(d);
  const uni = /[^\x00-\x7f]/.test(d) ? 'Unicode text, UTF-8 text' : 'ASCII text';
  if (m) { const i = basename(m[1] === '/usr/bin/env' ? m[2] || '' : m[1]); return `${/^(ba|da)?sh$/.test(i) ? (i === 'bash' ? 'Bourne-Again shell script' : 'POSIX shell script') : /python/.test(i) ? 'Python script' : i + ' script'}, ${uni} executable`; }
  if (e === 'svg' || /^\s*(<\?xml[^>]*>\s*)?<svg/.test(d)) return 'SVG Scalable Vector Graphics image';
  if (/^\s*<!DOCTYPE html|^\s*<html/i.test(d)) return `HTML document, ${uni}`;
  if (e === 'json' && /^\s*[[{]/.test(d)) return 'JSON text data';
  if (e === 'c' || /#include\s*</.test(d)) return `C source, ${uni}`;
  if (e === 'py') return `Python script, ${uni} executable`;
  if (e === 'tar') return 'POSIX tar archive (GNU)';
  return uni + (d.includes('\r\n') ? ', with CRLF line terminators' : '');
}
def('file', ctx => {
  if (!ctx.args.length) { ctx.err('Usage: file [-bchiLlNnprsSvzZ0] [--apple] [--extension] [--mime-encoding]\n            [--mime-type] [-e <testname>] [-F <separator>]  [-f <namefile>]\n            [-m <magicfiles>] [-P <parameter=value>] [--exclude-quiet]\n            <file> ...\n'); return 1; }
  const files = ctx.args.filter(a => !a.startsWith('-')), brief = ctx.args.includes('-b');
  const w = Math.max(...files.map(f => f.length)) + 1;
  for (const f of files) {
    const n = ctx.fs.lstat(ctx.path(f));
    ctx.out((brief ? '' : (f + ':').padEnd(w) + ' ') + (n ? fileType(f, n) : `cannot open \`${f}' (No such file or directory)`) + '\n');
  }
}, { usage: 'file [OPTION...] [FILE...]', desc: 'Determine type of FILEs.' });

def('stat', ctx => {
  const files = ctx.args.filter(a => !a.startsWith('-'));
  if (!files.length) throw new UsageError('missing operand');
  let st = 0;
  for (const f of files) {
    const p = ctx.path(f), n = ctx.fs.lstat(p);
    if (!n) { ctx.err(`stat: cannot statx '${f}': No such file or directory\n`); st = 1; continue; }
    const sz = n.t === 'l' ? n.d.length : ctx.fs.size(n), uid = n.o === 'root' ? 0 : 1000;
    const kind = n.t === 'd' ? 'directory' : n.t === 'l' ? 'symbolic link' : sz ? 'regular file' : 'regular empty file';
    const ts = strftime('%F %T', new Date(n.mt)) + '.' + String(n.mt % 1000).padStart(3, '0') + '000000 ' + strftime('%z');
    let ino = 0; for (const ch of p) ino = (ino * 31 + ch.charCodeAt(0)) % 9000000;
    ctx.out(`  File: ${f}${n.t === 'l' ? ' -> ' + n.d : ''}\n  Size: ${String(sz).padEnd(10)}\tBlocks: ${String(Math.ceil(sz / 4096) * 8).padEnd(10)} IO Block: 4096   ${kind}\n` +
      `Device: 801h/2049d\tInode: ${String(ino + 131072).padEnd(11)} Links: ${n.t === 'd' ? 2 + Object.values(n.c).filter(c => c.t === 'd').length : 1}\n` +
      `Access: (${(n.m & 0o7777).toString(8).padStart(4, '0')}/${modeStr(n)})  Uid: (${String(uid).padStart(5)}/${n.o.padStart(8)})   Gid: (${String(uid).padStart(5)}/${n.o.padStart(8)})\n` +
      `Access: ${ts}\nModify: ${ts}\nChange: ${ts}\n Birth: -\n`);
  }
  return st;
}, { usage: 'stat [OPTION]... FILE...', desc: 'Display file or file system status.' });

def('readlink', ctx => { const f = ctx.args.find(a => !a.startsWith('-')); const n = f && ctx.fs.lstat(ctx.path(f)); if (!n || n.t !== 'l') return 1; ctx.out((ctx.args.includes('-f') ? ctx.fs.realpath(ctx.path(f)) : n.d) + '\n'); }, { usage: 'readlink [OPTION]... FILE...', desc: 'Print value of a symbolic link or canonical file name.' });
def('realpath', ctx => {
  let st = 0;
  for (const f of ctx.args.filter(a => !a.startsWith('-'))) { try { ctx.out(ctx.fs.realpath(ctx.path(f)) + '\n'); } catch (e) { if (ctx.fs.exists(dirname(ctx.path(f)))) ctx.out(ctx.path(f) + '\n'); else { ferr(ctx, f, e); st = 1; } } }
  return st;
}, { usage: 'realpath [OPTION]... FILE...', desc: 'Print the resolved absolute file name.' });
def('basename', ctx => { if (!ctx.args.length) throw new UsageError('missing operand'); let b = basename(ctx.args[0].replace(/\/+$/, '')) || '/'; if (ctx.args[1] && b.endsWith(ctx.args[1]) && b !== ctx.args[1]) b = b.slice(0, -ctx.args[1].length); ctx.out(b + '\n'); }, { usage: 'basename NAME [SUFFIX]', desc: 'Print NAME with any leading directory components removed.' });
def('dirname', ctx => { if (!ctx.args.length) throw new UsageError('missing operand'); for (const a of ctx.args) { const s = a.replace(/\/+$/, ''); ctx.out((s.includes('/') ? s.slice(0, s.lastIndexOf('/')) || '/' : '.') + '\n'); } }, { usage: 'dirname NAME...', desc: 'Output each NAME with its last non-slash component and trailing slashes removed.' });
def('mktemp', ctx => { const d = ctx.args.includes('-d'); const p = '/tmp/tmp.' + Math.random().toString(36).slice(2, 12); if (d) ctx.fs.mkdir(p, { mode: 0o700 }); else ctx.fs.write(p, '', { mode: 0o600 }); ctx.out(p + '\n'); }, { usage: 'mktemp [OPTION]... [TEMPLATE]', desc: 'Create a temporary file or directory, safely, and print its name.' });

def('tree', ctx => {
  const { o, rest } = getopt(ctx, 'adL:fCFh', {});
  const fs = ctx.fs, color = ctx.tty;
  let nd = 0, nf = 0, st = 0;
  const walk = (path, prefix, depth) => {
    if (o.L && depth >= +o.L) return;
    let names;
    try { names = fs.readdir(path); } catch { ctx.out(prefix + '└── [error opening dir]\n'); return; }
    const dir = fs.stat(path);
    names = names.filter(n => (o.a || n[0] !== '.') && (!o.d || dir.c[n].t === 'd')).sort(nameSort);
    names.forEach((n, i) => {
      const node = dir.c[n], last = i === names.length - 1;
      const label = o.f ? join(path, n) : n;
      ctx.out(prefix + (last ? '└── ' : '├── ') + (color ? lsColor(label, node, '') : label) + (node.t === 'l' ? ' -> ' + node.d : '') + '\n');
      if (node.t === 'd') { nd++; walk(join(path, n), prefix + (last ? '    ' : '│   '), depth + 1); } else nf++;
    });
  };
  for (const t of rest.length ? rest : ['.']) {
    const p = ctx.path(t);
    if (!fs.isDir(p)) { ctx.out(`${t}  [error opening dir]\n`); st = 2; continue; }
    ctx.out((color ? `\x1b[01;34m${t}\x1b[0m` : t) + '\n');
    walk(p, '', 0);
  }
  ctx.out(`\n${nd} director${nd === 1 ? 'y' : 'ies'}${o.d ? '' : `, ${nf} file${nf === 1 ? '' : 's'}`}\n`);
  return st;
}, { usage: 'tree [-adfL level] [directory ...]', desc: 'List contents of directories in a tree-like format.', pkg: 'tree' });

def('find', async ctx => {
  const a = ctx.args, fs = ctx.fs;
  let i = 0;
  const roots = [];
  while (i < a.length && !/^[-!(]/.test(a[i])) roots.push(a[i++]);
  if (!roots.length) roots.push('.');
  let maxd = Infinity, mind = 0, acted = false;
  // Expression: OR-groups of AND-ed predicates, each (path, node, name, depth) => bool | Promise<bool>.
  const groups = [[]];
  let neg = false;
  const add = fn => { const f = neg ? async (...x) => !(await fn(...x)) : fn; neg = false; groups.at(-1).push(f); };
  const need = () => { if (i >= a.length) throw new UsageError(`missing argument to \`${a[i - 1]}'`); return a[i++]; };
  while (i < a.length) {
    const t = a[i++];
    switch (t) {
      case '-name': { const re = globToRe(need()); add((p, n, name) => re.test(name)); break; }
      case '-iname': { const re = globToRe(need(), { ci: true }); add((p, n, name) => re.test(name)); break; }
      case '-path': case '-wholename': { const re = globToRe(need()); add(p => re.test(p)); break; }
      case '-regex': { const re = new RegExp('^' + posixRe(need(), false) + '$'); add(p => re.test(p)); break; }
      case '-type': { const ty = need(); add((p, n) => (ty === 'f' ? n.t === 'f' : ty === 'd' ? n.t === 'd' : ty === 'l' ? n.t === 'l' : false)); break; }
      case '-maxdepth': maxd = +need(); break;
      case '-mindepth': mind = +need(); break;
      case '-empty': add((p, n) => (n.t === 'd' ? !Object.keys(n.c).length : n.t === 'f' && n.d === '')); break;
      case '-user': { const u = need(); add((p, n) => n.o === u); break; }
      case '-executable': add((p, n) => !!(n.m & 0o111)); break;
      case '-perm': { const m = parseInt(need().replace(/^[-/]/, ''), 8); add((p, n) => (n.m & 0o777) === m); break; }
      case '-newer': { const ref = fs.stat(ctx.path(need())); add((p, n) => !!ref && n.mt > ref.mt); break; }
      case '-mtime': case '-mmin': {
        const v = need(), unit = t === '-mtime' ? 864e5 : 6e4, num = Math.abs(parseInt(v, 10));
        add((p, n) => { const age = Math.floor((Date.now() - n.mt) / unit); return v[0] === '+' ? age > num : v[0] === '-' ? age < num : age === num; });
        break;
      }
      case '-size': {
        const m = /^([+-]?)(\d+)([ckMGb]?)$/.exec(need());
        if (!m) throw new UsageError('invalid -size argument');
        const unit = { c: 1, k: 1024, M: 1048576, G: 1073741824, b: 512, '': 512 }[m[3]], num = +m[2];
        add((p, n) => { const s = Math.ceil(fs.size(n) / unit); return m[1] === '+' ? s > num : m[1] === '-' ? s < num : s === num; });
        break;
      }
      case '-not': case '!': neg = !neg; break;
      case '-o': case '-or': groups.push([]); break;
      case '-a': case '-and': case '(': case ')': break;
      case '-print': acted = true; add(p => { ctx.out(p + '\n'); return true; }); break;
      case '-print0': acted = true; add(p => { ctx.out(p + '\0'); return true; }); break;
      case '-ls': acted = true; add((p, n) => { ctx.out(`${modeStr(n)} 1 ${n.o} ${n.o} ${String(fs.size(n)).padStart(8)} ${lsDate(n.mt)} ${p}\n`); return true; }); break;
      case '-delete': acted = true; add((p, n, name, d, abs) => { try { fs.rm(abs, { r: true }); } catch (e) { ctx.err(`find: cannot delete '${p}': ${errMsg(e)}\n`); } return true; }); break;
      case '-exec': case '-ok': {
        const argv = [];
        while (i < a.length && a[i] !== ';' && a[i] !== '+') argv.push(a[i++]);
        if (i >= a.length) throw new UsageError("missing argument to `-exec'");
        i++; acted = true;
        add(async p => (await ctx.run(argv.map(x => x.replace(/\{\}/g, p)))) === 0);
        break;
      }
      default: throw new UsageError(t.startsWith('-') ? `unknown predicate \`${t}'` : `paths must precede expression: \`${t}'`);
    }
  }
  let st = 0;
  const visit = async (shown, abs, depth) => {
    const n = fs.lstat(abs);
    if (!n) return;
    await ctx.tick();
    if (depth >= mind) {
      for (const g of groups) {
        let ok = true;
        for (const f of g) if (!(await f(shown, n, basename(shown) || shown, depth, abs))) { ok = false; break; }
        if (ok) { if (!acted) ctx.out(shown + '\n'); break; }
      }
    }
    if (n.t === 'd' && depth < maxd && fs.lstat(abs)) {
      let names;
      try { names = fs.readdir(abs); } catch { ctx.err(`find: '${shown}': Permission denied\n`); st = 1; return; }
      for (const k of names) await visit(shown.endsWith('/') ? shown + k : shown + '/' + k, join(abs, k), depth + 1);
    }
  };
  for (const r of roots) {
    if (!fs.lstat(ctx.path(r))) { ctx.err(`find: '${r}': No such file or directory\n`); st = 1; continue; }
    await visit(r, ctx.path(r), 0);
  }
  return st;
}, { usage: 'find [path...] [expression]', desc: 'Search for files in a directory hierarchy.\n  -name PATTERN  -iname PATTERN  -type [fdl]  -maxdepth N  -size [+-]N[ckM]\n  -mtime [+-]N  -empty  -newer FILE  -not  -o  -print  -delete  -exec CMD {} \\;' });

def('du', ctx => {
  const { o, rest } = getopt(ctx, 'shacd:kmb', { 'max-depth': 'd', summarize: 's', 'human-readable': 'h', all: 'a', total: 'c' });
  const fs = ctx.fs, maxd = o.s ? 0 : o.d !== undefined ? +o.d : Infinity;
  const fmt = n => (o.h ? human(n) : o.b ? String(n) : String(Math.ceil(n / 1024)));
  let st = 0, total = 0;
  const walk = (shown, abs, depth) => {
    const n = fs.lstat(abs);
    if (n.t !== 'd') { const s = Math.ceil(fs.size(n) / 4096) * 4096; if (o.a && depth <= maxd || depth === 0) ctx.out(`${fmt(s)}\t${shown}\n`); return s; }
    let sum = 4096, names;
    try { names = fs.readdir(abs); } catch { ctx.err(`du: cannot read directory '${shown}': Permission denied\n`); st = 1; names = []; }
    for (const k of names) sum += walk(shown.endsWith('/') ? shown + k : shown + '/' + k, join(abs, k), depth + 1);
    if (depth <= maxd) ctx.out(`${fmt(sum)}\t${shown}\n`);
    return sum;
  };
  for (const t of rest.length ? rest : ['.']) {
    if (!fs.lstat(ctx.path(t))) { ctx.err(`du: cannot access '${t}': No such file or directory\n`); st = 1; continue; }
    total += walk(t, ctx.path(t), 0);
  }
  if (o.c) ctx.out(`${fmt(total)}\ttotal\n`);
  return st;
}, { usage: 'du [OPTION]... [FILE]...', desc: 'Summarize device usage of the set of FILEs, recursively for directories.\n  -h  human readable   -s  only a total for each argument   -a  all files' });

// ---------------------------------------------------------------- text
def('wc', async ctx => {
  const { o, rest } = getopt(ctx, 'lwcmL', { lines: 'l', words: 'w', bytes: 'c', chars: 'm' });
  const { list, status } = await inputs(ctx, rest);
  const all = !(o.l || o.w || o.c || o.m || o.L);
  const rows = list.map(f => {
    const r = [];
    if (o.l || all) r.push((f.text.match(/\n/g) || []).length);
    if (o.w || all) r.push((f.text.match(/\S+/g) || []).length);
    if (o.c || all) r.push(new TextEncoder().encode(f.text).length);
    if (o.m) r.push([...f.text].length);
    if (o.L) r.push(Math.max(0, ...f.text.split('\n').map(l => l.length)));
    return { r, name: f.name };
  });
  if (rows.length > 1) rows.push({ r: rows[0].r.map((_, k) => rows.reduce((s, x) => s + x.r[k], 0)), name: 'total' });
  const single = rows.length === 1 && rows[0].r.length === 1;
  const w = single ? 0 : !rest.length ? 7 : String(list.reduce((s, f) => s + new TextEncoder().encode(f.text).length, 0)).length;
  for (const x of rows) ctx.out(x.r.map(v => String(v).padStart(w)).join(' ') + (x.name && rest.length ? ' ' + x.name : '') + '\n');
  return status;
}, { usage: 'wc [OPTION]... [FILE]...', desc: 'Print newline, word, and byte counts for each FILE.\n  -l lines  -w words  -c bytes  -m characters' });

def('grep egrep fgrep rgrep', async ctx => {
  const args = ctx.args.map(a => (/^-\d+$/.test(a) ? '-C' + a.slice(1) : a));
  const { o, rest } = getopt(ctx, 'ivnclLrREFowxqshHe:A:B:C:m:PIaz', {
    'ignore-case': 'i', 'invert-match': 'v', 'line-number': 'n', count: 'c', 'files-with-matches': 'l', recursive: 'r', 'extended-regexp': 'E',
    'fixed-strings': 'F', 'only-matching': 'o', 'word-regexp': 'w', 'line-regexp': 'x', quiet: 'q', silent: 'q', color: 'K', colour: 'K',
    'no-filename': 'h', 'with-filename': 'H', regexp: 'e', 'max-count': 'm', 'perl-regexp': 'P', include: 'J', exclude: 'j', 'exclude-dir': 'j',
  }, { args });
  const pat = o.e ?? rest.shift();
  if (pat === undefined) { ctx.err("Usage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information.\n"); return 2; }
  const ere = o.E || o.P || ctx.name === 'egrep', fixed = o.F || ctx.name === 'fgrep', rec = o.r || o.R || ctx.name === 'rgrep';
  let src = pat.split('\n').map(p => (fixed ? p.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&') : o.P ? p : posixRe(p, ere))).join('|');
  if (o.w) src = `\\b(?:${src})\\b`;
  if (o.x) src = `^(?:${src})$`;
  let re;
  try { re = new RegExp(src, 'g' + (o.i ? 'i' : '')); } catch { ctx.err(`grep: Unmatched [, [^, [:, [., or [=\n`); return 2; }
  const color = o.K === 'always' || ((o.K === true || o.K === 'auto') && ctx.tty);
  const fs = ctx.fs, targets = [];
  let status = 2, err = false;
  const inc = o.J ? globToRe(o.J) : null;
  if (!rest.length && rec) rest.push('.');
  for (const f of rest) {
    if (f === '-') { targets.push({ name: '(standard input)', text: await ctx.readAll() }); continue; }
    const p = ctx.path(f), n = fs.stat(p);
    if (!n) { if (!o.s) ctx.err(`grep: ${f}: No such file or directory\n`); err = true; continue; }
    if (n.t === 'd') {
      if (!rec) { if (!o.s) ctx.err(`grep: ${f}: Is a directory\n`); err = true; continue; }
      fs.walk(p, (q, node) => {
        if (node.t !== 'f' || node.dyn || node.d.startsWith('\x7fELF')) return;
        if (inc && !inc.test(basename(q))) return;
        if (!fs._can(node, 4)) { if (!o.s) ctx.err(`grep: ${f === '.' ? q.slice(p.length + 1) : f.replace(/\/$/, '') + q.slice(p.length)}: Permission denied\n`); return; }
        targets.push({ name: f === '.' ? q.slice(p.length + 1) : f.replace(/\/$/, '') + q.slice(p.length), text: node.d });
      });
      continue;
    }
    try { targets.push({ name: f, text: fs.read(p) }); } catch (e) { if (!o.s) ferr(ctx, f, e); err = true; }
  }
  if (!rest.length) targets.push({ name: '(standard input)', text: await ctx.readAll() });
  const showName = o.H || (!o.h && (targets.length > 1 || rec));
  const A = +(o.A ?? o.C ?? 0), B = +(o.B ?? o.C ?? 0);
  const cFile = s => (color ? `\x1b[35m${s}\x1b[0m` : s), cSep = s => (color ? `\x1b[36m${s}\x1b[0m` : s), cNum = s => (color ? `\x1b[32m${s}\x1b[0m` : s);
  let any = false;
  for (const t of targets) {
    await ctx.tick();
    const ls = lines(t.text);
    let count = 0, lastShown = -1;
    const prefix = (k, sep) => (showName ? cFile(t.name) + cSep(sep) : '') + (o.n ? cNum(k + 1) + cSep(sep) : '');
    for (let k = 0; k < ls.length; k++) {
      re.lastIndex = 0;
      const hit = re.test(ls[k]);
      if (hit === !!o.v) continue;
      count++; any = true;
      if (o.q) return 0;
      if (o.c || o.l || o.L) { if (o.m && count >= +o.m) break; continue; }
      if (o.o && !o.v) { re.lastIndex = 0; for (const m of ls[k].matchAll(re)) if (m[0]) ctx.out(prefix(k, ':') + (color ? `\x1b[01;31m${m[0]}\x1b[0m` : m[0]) + '\n'); }
      else {
        if ((A || B) && lastShown >= 0 && k - B > lastShown + 1) ctx.out(cSep('--') + '\n');
        for (let b = Math.max(lastShown + 1, k - B); b < k; b++) ctx.out(prefix(b, '-') + ls[b] + '\n');
        ctx.out(prefix(k, ':') + (color && !o.v ? ls[k].replace(re, m => (m ? `\x1b[01;31m${m}\x1b[0m` : m)) : ls[k]) + '\n');
        lastShown = k;
        for (let f = k + 1; f <= Math.min(ls.length - 1, k + A); f++) { re.lastIndex = 0; if (re.test(ls[f]) !== !!o.v) break; ctx.out(prefix(f, '-') + ls[f] + '\n'); lastShown = f; }
      }
      if (o.m && count >= +o.m) break;
    }
    if (o.c) ctx.out((showName ? cFile(t.name) + cSep(':') : '') + count + '\n');
    if (o.l && count) ctx.out(cFile(t.name) + '\n');
    if (o.L && !count) ctx.out(cFile(t.name) + '\n');
  }
  status = any ? 0 : 1;
  return err && !any ? 2 : status;
}, { usage: 'grep [OPTION]... PATTERNS [FILE]...', desc: 'Search for PATTERNS in each FILE.\n  -i ignore case   -v invert   -n line numbers   -c count   -l file names only\n  -r recursive     -E extended regex   -F fixed strings   -o only matching   -w whole words\n  -A/-B/-C NUM  lines of context', ownHelp: false });

// sed -------------------------------------------------------------
function sedParse(script, ere) {
  const cmds = [];
  let i = 0;
  const ws = () => { while (i < script.length && /[ \t]/.test(script[i])) i++; };
  const delimited = d => { let s = ''; while (i < script.length && script[i] !== d) { if (script[i] === '\\' && script[i + 1] === d) { s += d; i += 2; continue; } if (script[i] === '\\') s += script[i++]; s += script[i++]; } if (script[i] !== d) throw new Error(`unterminated command`); i++; return s; };
  const addr = () => {
    ws();
    if (/\d/.test(script[i])) { let s = ''; while (/\d/.test(script[i] || '')) s += script[i++]; let step = null; if (script[i] === '~') { i++; let t = ''; while (/\d/.test(script[i] || '')) t += script[i++]; step = +t; } return { n: +s, step }; }
    if (script[i] === '$') { i++; return { last: true }; }
    if (script[i] === '/') { i++; const p = delimited('/'); let f = ''; if (script[i] === 'I') { f = 'i'; i++; } return { re: new RegExp(posixRe(p, ere), f) }; }
    return null;
  };
  while (i < script.length) {
    while (i < script.length && /[\s;]/.test(script[i])) i++;
    if (i >= script.length) break;
    if (script[i] === '#') { while (i < script.length && script[i] !== '\n') i++; continue; }
    const c = { a1: addr(), a2: null, neg: false };
    ws();
    if (c.a1 && script[i] === ',') { i++; c.a2 = addr(); if (!c.a2 && script[i] === '+') { i++; let s = ''; while (/\d/.test(script[i] || '')) s += script[i++]; c.a2 = { plus: +s }; } }
    ws();
    while (script[i] === '!') { c.neg = !c.neg; i++; ws(); }
    c.cmd = script[i++];
    if (c.cmd === undefined) throw new Error('missing command');
    if (c.cmd === '{' || c.cmd === '}') { cmds.push(c); continue; }
    if (c.cmd === 's') {
      const d = script[i++], pat = delimited(d), rep = delimited(d);
      let flags = '';
      while (i < script.length && /[gipIeMm0-9]/.test(script[i])) flags += script[i++];
      c.re = new RegExp(posixRe(pat, ere), (flags.includes('g') ? 'g' : '') + (/[iI]/.test(flags) ? 'i' : ''));
      c.rep = rep; c.print = flags.includes('p'); c.nth = +(/\d+/.exec(flags) || [0])[0];
      if (script[i] === 'w') { i++; ws(); }
    } else if (c.cmd === 'y') { const d = script[i++]; c.from = [...delimited(d)]; c.to = [...delimited(d)]; }
    else if ('aic'.includes(c.cmd)) {
      ws(); if (script[i] === '\\') { i++; if (script[i] === '\n') i++; }
      let s = ''; while (i < script.length && script[i] !== '\n') s += script[i++];
      c.text = s.replace(/\\(.)/g, '$1');
    } else if ('rw'.includes(c.cmd)) { ws(); let s = ''; while (i < script.length && script[i] !== '\n' && script[i] !== ';') s += script[i++]; c.file = s.trim(); }
    else if ('qQ'.includes(c.cmd)) { ws(); let s = ''; while (/\d/.test(script[i] || '')) s += script[i++]; c.code = +s || 0; }
    else if (!'dpDPnNgGhHx=l'.includes(c.cmd)) throw new Error(`unknown command: \`${c.cmd}'`);
    cmds.push(c);
  }
  return cmds;
}
const sedRep = (rep, m) => rep.replace(/\\([0-9&nt\\])|&/g, (x, c) => (x === '&' ? m[0] : c === 'n' ? '\n' : c === 't' ? '\t' : c === '&' ? '&' : c === '\\' ? '\\' : m[+c] ?? ''));
function sedRun(cmds, text, quiet, ctx) {
  const ls = lines(text), out = [];
  let hold = '';
  const active = new Map();
  const match = (a, k, pat) => (a.last ? k === ls.length - 1 : a.re ? a.re.test(pat) : a.step ? k + 1 >= a.n && (k + 1 - a.n) % a.step === 0 : k + 1 === a.n);
  outer: for (let k = 0; k < ls.length; k++) {
    let pat = ls[k], del = false;
    const after = [];
    let skipDepth = 0;
    for (let ci = 0; ci < cmds.length; ci++) {
      const c = cmds[ci];
      if (skipDepth) { if (c.cmd === '{') skipDepth++; else if (c.cmd === '}') skipDepth--; continue; }
      if (c.cmd === '}') continue;
      let sel = true;
      if (c.a1 && !c.a2) sel = match(c.a1, k, pat);
      else if (c.a1 && c.a2) {
        if (active.has(c)) { sel = true; const end = active.get(c); if (c.a2.plus !== undefined ? k >= end : c.a2.n ? k + 1 >= c.a2.n : match(c.a2, k, pat)) active.delete(c); }
        else if (match(c.a1, k, pat)) { sel = true; if (!(c.a2.n && c.a2.n <= k + 1)) active.set(c, k + (c.a2.plus || 0)); if (c.a2.plus === 0) active.delete(c); }
        else sel = false;
      }
      if (sel === c.neg) { if (c.cmd === '{') skipDepth = 1; continue; }
      switch (c.cmd) {
        case '{': break;
        case 's': {
          let n = 0, hit = false;
          c.re.lastIndex = 0;
          const re = c.nth ? new RegExp(c.re.source, c.re.flags.includes('g') ? c.re.flags : c.re.flags + 'g') : c.re;
          const np = pat.replace(re, (...m) => { n++; if (c.nth && (c.re.flags.includes('g') ? n < c.nth : n !== c.nth)) return m[0]; hit = true; return sedRep(c.rep, m); });
          if (hit) { pat = np; if (c.print) out.push(pat); }
          break;
        }
        case 'y': pat = [...pat].map(ch => { const x = c.from.indexOf(ch); return x >= 0 ? c.to[x] ?? ch : ch; }).join(''); break;
        case 'd': del = true; break;
        case 'p': out.push(pat); break;
        case '=': out.push(String(k + 1)); break;
        case 'a': after.push(c.text); break;
        case 'i': out.push(c.text); break;
        case 'c': out.push(c.text); del = true; break;
        case 'q': if (!quiet) out.push(pat); out.push(...after); break outer;
        case 'Q': break outer;
        case 'n': if (!quiet) out.push(pat); if (k + 1 < ls.length) pat = ls[++k]; else { del = true; } break;
        case 'N': if (k + 1 < ls.length) pat += '\n' + ls[++k]; break;
        case 'h': hold = pat; break; case 'H': hold += '\n' + pat; break;
        case 'g': pat = hold; break; case 'G': pat += '\n' + hold; break;
        case 'x': [pat, hold] = [hold, pat]; break;
        case 'r': try { after.push(ctx.fs.read(ctx.path(c.file)).replace(/\n$/, '')); } catch { /* sed ignores unreadable files */ } break;
        case 'l': out.push(pat.replace(/\t/g, '\\t') + '$'); break;
      }
      if (del) break;
    }
    if (!del && !quiet) out.push(pat);
    out.push(...after);
  }
  return out.map(l => l + '\n').join('');
}
def('sed', async ctx => {
  const scripts = [], files = [];
  let quiet = false, ere = false, inplace = null;
  const a = ctx.args;
  for (let i = 0; i < a.length; i++) {
    const s = a[i];
    if (s === '-n' || s === '--quiet' || s === '--silent') quiet = true;
    else if (s === '-E' || s === '-r' || s === '--regexp-extended') ere = true;
    else if (s === '-e') scripts.push(a[++i]);
    else if (s === '-f') { try { scripts.push(ctx.fs.read(ctx.path(a[++i]))); } catch (e) { ctx.err(`sed: couldn't open file ${a[i]}: ${errMsg(e)}\n`); return 1; } }
    else if (/^-i/.test(s) || /^--in-place/.test(s)) inplace = s.replace(/^-i|^--in-place=?/, '');
    else if (/^-[nEr]+$/.test(s)) { if (s.includes('n')) quiet = true; if (/[Er]/.test(s)) ere = true; }
    else if (s === '--') { files.push(...a.slice(i + 1)); break; }
    else if (s.startsWith('-') && s.length > 1) throw new UsageError(`invalid option -- '${s[1]}'`);
    else files.push(s);
  }
  if (!scripts.length) { if (!files.length) { ctx.err('Usage: sed [OPTION]... {script-only-if-no-other-script} [input-file]...\n'); return 1; } scripts.push(files.shift()); }
  let cmds;
  try { cmds = sedParse(scripts.join('\n'), ere); } catch (e) { ctx.err(`sed: -e expression #1, char ${scripts[0].length}: ${e.message}\n`); return 1; }
  if (inplace !== null) {
    if (!files.length) { ctx.err('sed: no input files\n'); return 1; }
    let st = 0;
    for (const f of files) {
      try { const p = ctx.path(f), t = ctx.fs.read(p); if (inplace) ctx.fs.write(p + inplace, t); ctx.fs.write(p, sedRun(cmds, t, quiet, ctx)); }
      catch (e) { ctx.err(`sed: can't read ${f}: ${errMsg(e)}\n`); st = 1; }
    }
    return st;
  }
  const { list, status } = await inputs(ctx, files);
  ctx.out(sedRun(cmds, list.map(f => f.text).join(''), quiet, ctx));
  return status;
}, { usage: 'sed [OPTION]... {script} [input-file]...', desc: 'Stream editor for filtering and transforming text.\n  -n  suppress automatic printing   -e script   -i[SUFFIX]  edit files in place   -E  extended regex\nCommands: s/re/rep/[gip]  d  p  q  y/abc/xyz/  a text  i text  c text  =  n  N  h  H  g  G  x', ownHelp: false });

def('sort', async ctx => {
  const { o, rest } = getopt(ctx, 'rnuk:t:fhVRbsco:Mg', { reverse: 'r', 'numeric-sort': 'n', unique: 'u', key: 'k', 'field-separator': 't', 'ignore-case': 'f', 'human-numeric-sort': 'h', 'random-sort': 'R', output: 'o', 'version-sort': 'V' });
  const { list, status } = await inputs(ctx, rest);
  let ls = list.flatMap(f => lines(f.text));
  const key = l => {
    if (!o.k) return l;
    const [a, b] = String(o.k).split(',').map(x => parseInt(x, 10));
    const f = o.t ? l.split(o.t) : l.trim().split(/\s+/);
    return f.slice(a - 1, b || (o.k.includes(',') ? b : undefined)).join(o.t || ' ');
  };
  const hnum = s => { const m = /^\s*(-?[\d.]+)\s*([KMGTP]?)/i.exec(s); return m ? parseFloat(m[1]) * 1024 ** ' KMGTP'.indexOf(m[2].toUpperCase() || ' ') : 0; };
  const cmp = (a, b) => {
    const x = key(a), y = key(b);
    let r;
    if (o.n || o.g) r = (parseFloat(x) || 0) - (parseFloat(y) || 0);
    else if (o.h) r = hnum(x) - hnum(y);
    else if (o.V) r = x.localeCompare(y, 'en', { numeric: true });
    else if (o.f) r = x.toLowerCase() < y.toLowerCase() ? -1 : x.toLowerCase() > y.toLowerCase() ? 1 : 0;
    else r = x.localeCompare(y, 'en') || (x < y ? -1 : x > y ? 1 : 0);
    return r || (o.s || o.u ? 0 : a < b ? -1 : a > b ? 1 : 0);
  };
  if (o.R) ls = ls.map(l => [Math.random(), l]).sort((a, b) => a[0] - b[0]).map(x => x[1]); else ls.sort(cmp);
  if (o.r) ls.reverse();
  if (o.u) ls = ls.filter((l, i) => i === 0 || cmp(l, ls[i - 1]) !== 0);
  const text = ls.map(l => l + '\n').join('');
  if (o.o) ctx.fs.write(ctx.path(o.o), text); else ctx.out(text);
  return status;
}, { usage: 'sort [OPTION]... [FILE]...', desc: 'Write sorted concatenation of all FILE(s) to standard output.\n  -r reverse  -n numeric  -u unique  -k KEY  -t SEP  -f fold case  -h human numeric  -R random' });

def('uniq', async ctx => {
  const { o, rest } = getopt(ctx, 'cduif:s:w:', { count: 'c', repeated: 'd', unique: 'u', 'ignore-case': 'i' });
  const text = rest[0] && rest[0] !== '-' ? ctx.fs.read(ctx.path(rest[0])) : await ctx.readAll();
  const norm = l => { let s = l; if (o.f) s = s.trim().split(/\s+/).slice(+o.f).join(' '); if (o.s) s = s.slice(+o.s); if (o.w) s = s.slice(0, +o.w); return o.i ? s.toLowerCase() : s; };
  const groups = [];
  for (const l of lines(text)) { const g = groups.at(-1); if (g && norm(g.l) === norm(l)) g.n++; else groups.push({ l, n: 1 }); }
  const res = groups.filter(g => (o.d ? g.n > 1 : o.u ? g.n === 1 : true)).map(g => (o.c ? String(g.n).padStart(7) + ' ' : '') + g.l + '\n').join('');
  if (rest[1]) ctx.fs.write(ctx.path(rest[1]), res); else ctx.out(res);
}, { usage: 'uniq [OPTION]... [INPUT [OUTPUT]]', desc: 'Filter adjacent matching lines from INPUT.\n  -c prefix lines by the number of occurrences  -d only duplicates  -u only unique  -i ignore case' });

function ranges(spec) {
  const rs = spec.split(',').map(r => { const m = /^(\d*)(-?)(\d*)$/.exec(r); if (!m || (!m[1] && !m[3])) throw new UsageError(`invalid field value '${r}'`); return [m[1] ? +m[1] : 1, m[2] ? (m[3] ? +m[3] : Infinity) : +m[1]]; });
  return n => rs.some(([a, b]) => n >= a && n <= b);
}
def('cut', async ctx => {
  const { o, rest } = getopt(ctx, 'd:f:c:b:sz', { delimiter: 'd', fields: 'f', characters: 'c', bytes: 'b', 'only-delimited': 's', complement: 'X', 'output-delimiter': 'O' });
  if (!o.f && !o.c && !o.b) throw new UsageError('you must specify a list of bytes, characters, or fields');
  const sel = ranges(o.f || o.c || o.b), d = o.d ?? '\t', od = o.O ?? d;
  const pick = n => sel(n) !== !!o.X;
  const { list, status } = await inputs(ctx, rest);
  for (const f of list) {
    for (const l of lines(f.text)) {
      if (o.f) { if (!l.includes(d)) { if (!o.s) ctx.out(l + '\n'); continue; } ctx.out(l.split(d).filter((_, i) => pick(i + 1)).join(od) + '\n'); }
      else ctx.out([...l].filter((_, i) => pick(i + 1)).join('') + '\n');
    }
  }
  return status;
}, { usage: 'cut OPTION... [FILE]...', desc: 'Print selected parts of lines from each FILE.\n  -d DELIM  -f LIST  -c LIST  -s  --complement' });

function trSet(s) {
  const out = [];
  s = s.replace(/\[:(\w+):\]/g, (m, k) => ({ upper: 'A-Z', lower: 'a-z', digit: '0-9', alpha: 'a-zA-Z', alnum: 'a-zA-Z0-9', space: ' \t\n\r\f\v', blank: ' \t', punct: '!-/:-@[-`{-~', xdigit: '0-9a-fA-F' }[k] || m));
  const cs = [];
  for (let i = 0; i < s.length; i++) { if (s[i] === '\\' && i + 1 < s.length) { const c = s[++i]; cs.push({ n: '\n', t: '\t', r: '\r', '\\': '\\', 0: '\0' }[c] ?? c); } else cs.push(s[i]); }
  for (let i = 0; i < cs.length; i++) {
    if (cs[i + 1] === '-' && i + 2 < cs.length) { for (let c = cs[i].charCodeAt(0); c <= cs[i + 2].charCodeAt(0); c++) out.push(String.fromCharCode(c)); i += 2; }
    else out.push(cs[i]);
  }
  return out;
}
def('tr', async ctx => {
  const { o, rest } = getopt(ctx, 'dscCt', { delete: 'd', 'squeeze-repeats': 's', complement: 'c' });
  if (!rest.length) throw new UsageError('missing operand');
  const a = trSet(rest[0]), b = rest[1] !== undefined ? trSet(rest[1]) : [];
  if (!o.d && !o.s && !b.length) throw new UsageError(`missing operand after '${rest[0]}'\nTwo strings must be given when translating.`);
  const comp = o.c || o.C, inA = ch => a.includes(ch) !== !!comp;
  const text = await ctx.readAll();
  let out = '';
  for (const ch of text) {
    if (o.d) { if (!inA(ch)) out += ch; continue; }
    if (b.length && inA(ch)) { const i = comp ? b.length - 1 : a.indexOf(ch); out += b[Math.min(i, b.length - 1)]; } else out += ch;
  }
  if (o.s) { const set = o.d ? b : b.length ? b : a; out = [...out].filter((ch, i, arr) => !(i > 0 && ch === arr[i - 1] && (b.length || o.d ? set.includes(ch) : inA(ch)))).join(''); }
  ctx.out(out);
}, { usage: 'tr [OPTION]... SET1 [SET2]', desc: 'Translate, squeeze, and/or delete characters from standard input.\n  -d delete  -s squeeze repeats  -c complement' });

def('tee', async ctx => {
  const { o, rest } = getopt(ctx, 'ai', { append: 'a' });
  let st = 0;
  const write = text => { ctx.out(text); for (const f of rest) { try { ctx.fs.write(ctx.path(f), text, { append: true }); } catch (e) { ferr(ctx, f, e); st = 1; } } };
  if (!o.a) for (const f of rest) { try { ctx.fs.write(ctx.path(f), ''); } catch { /* reported on write */ } }
  if (ctx.hasStdin) write(ctx.stdin);
  else for (;;) { const l = await ctx.readLine(); if (l === null) break; write(l + '\n'); }
  return st;
}, { usage: 'tee [OPTION]... [FILE]...', desc: 'Copy standard input to each FILE, and also to standard output.\n  -a  append to the given FILEs, do not overwrite' });

def('paste', async ctx => {
  const { o, rest } = getopt(ctx, 'd:s', { delimiters: 'd', serial: 's' });
  const { list, status } = await inputs(ctx, rest);
  const d = o.d ?? '\t', cols = list.map(f => lines(f.text));
  if (o.s) cols.forEach(c => ctx.out(c.join(d) + '\n'));
  else for (let i = 0; i < Math.max(...cols.map(c => c.length)); i++) ctx.out(cols.map(c => c[i] ?? '').join(d) + '\n');
  return status;
}, { usage: 'paste [OPTION]... [FILE]...', desc: 'Write lines consisting of the sequentially corresponding lines from each FILE.' });

def('column', async ctx => {
  const { o, rest } = getopt(ctx, 'ts:o:c:', { table: 't', separator: 's' });
  const { list } = await inputs(ctx, rest);
  const ls = list.flatMap(f => lines(f.text)).filter(l => l.trim());
  if (!o.t) return void ctx.out(columnize(ls, ctx.cols));
  const rows = ls.map(l => (o.s ? l.split(new RegExp(`[${o.s.replace(/[\]\\^-]/g, '\\$&')}]`)) : l.trim().split(/\s+/)));
  const w = [];
  rows.forEach(r => r.forEach((c, i) => { w[i] = Math.max(w[i] || 0, c.length); }));
  for (const r of rows) ctx.out(r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(w[i]))).join(o.o ?? '  ') + '\n');
}, { usage: 'column [-t] [-s sep] [file ...]', desc: 'Columnate lists.' });

def('fold', async ctx => { const { o, rest } = getopt(ctx, 'w:s', {}); const w = +(o.w || 80); const { list } = await inputs(ctx, rest); for (const f of list) for (const l of lines(f.text)) { for (let i = 0; i < Math.max(1, l.length); i += w) ctx.out(l.slice(i, i + w) + '\n'); } }, { usage: 'fold [-w WIDTH] [FILE]...', desc: 'Wrap input lines in each FILE, writing to standard output.' });
def('expand', async ctx => { const { list } = await inputs(ctx, ctx.args.filter(a => !a.startsWith('-'))); for (const f of list) ctx.out(f.text.replace(/\t/g, '        ')); }, { usage: 'expand [FILE]...', desc: 'Convert tabs in each FILE to spaces.' });
def('strings', async ctx => { const { list } = await inputs(ctx, ctx.args.filter(a => !a.startsWith('-'))); for (const f of list) for (const m of f.text.matchAll(/[\x20-\x7e]{4,}/g)) ctx.out(m[0] + '\n'); }, { usage: 'strings [file...]', desc: 'Print the sequences of printable characters in files.' });

def('seq', ctx => {
  const { o, rest } = getopt(ctx, 's:wf:', { separator: 's', 'equal-width': 'w' }, { args: ctx.args.map(a => (/^-[\d.]/.test(a) ? ' ' + a : a)) });
  const n = rest.map(Number);
  if (!n.length || n.some(Number.isNaN)) throw new UsageError(rest.length ? `invalid floating point argument: '${rest.find(x => Number.isNaN(Number(x))).trim()}'` : 'missing operand');
  const [a, st, b] = n.length === 1 ? [1, 1, n[0]] : n.length === 2 ? [n[0], 1, n[1]] : n;
  if (st === 0) throw new UsageError("invalid Zero increment value: '0'");
  const dec = Math.max(...[a, st, b].map(x => (String(x).split('.')[1] || '').length)), out = [];
  for (let v = a, k = 0; (st > 0 ? v <= b + 1e-9 : v >= b - 1e-9) && k < 1e6; v = a + st * ++k) out.push(v.toFixed(dec));
  const w = o.w ? Math.max(...out.map(x => x.length)) : 0;
  ctx.out(out.map(x => (w ? x.padStart(w, '0') : x)).join(o.s ?? '\n') + (out.length ? '\n' : ''));
}, { usage: 'seq [OPTION]... [FIRST [INCREMENT]] LAST', desc: 'Print numbers from FIRST to LAST, in steps of INCREMENT.' });

def('yes', async ctx => { const s = (ctx.args.join(' ') || 'y') + '\n'; for (;;) { ctx.out(s.repeat(50)); await ctx.tick(); if (ctx.tty) await ctx.sleep(8); } }, { usage: 'yes [STRING]...', desc: 'Repeatedly output a line with all specified STRING(s), or \'y\'.' });
def('shuf', async ctx => {
  const { o, rest } = getopt(ctx, 'n:i:er', { 'head-count': 'n', 'input-range': 'i', echo: 'e' });
  let items;
  if (o.i) { const [a, b] = o.i.split('-').map(Number); items = Array.from({ length: b - a + 1 }, (_, k) => String(a + k)); }
  else if (o.e) items = rest;
  else items = lines((await inputs(ctx, rest)).list.map(f => f.text).join(''));
  for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
  if (o.n !== undefined) items = items.slice(0, +o.n);
  ctx.out(items.map(x => x + '\n').join(''));
}, { usage: 'shuf [OPTION]... [FILE]', desc: 'Write a random permutation of the input lines to standard output.' });

def('xargs', async ctx => {
  const { o, rest } = getopt(ctx, 'n:I:d:0trpL:P:', { 'max-args': 'n', replace: 'I', delimiter: 'd', null: '0', 'no-run-if-empty': 'r' }, { stop: true });
  const text = await ctx.readAll();
  const items = o['0'] ? text.split('\0').filter(Boolean) : o.d ? text.split(o.d === '\\n' ? '\n' : o.d).filter(Boolean) : o.I || o.L ? lines(text).filter(l => l.trim()) : (text.match(/"[^"]*"|'[^']*'|\S+/g) || []).map(s => s.replace(/^(['"])(.*)\1$/, '$2'));
  const cmd = rest.length ? rest : ['echo'];
  let st = 0;
  const run = async argv => { if (o.t) ctx.err(argv.join(' ') + '\n'); const r = await ctx.run(argv); if (r) st = 123; await ctx.tick(); };
  if (o.I) { for (const it of items) await run(cmd.map(c => c.split(o.I).join(it))); return st; }
  const n = +(o.n || o.L || 0);
  if (!items.length) { if (!o.r) await run(cmd); return st; }
  if (n) for (let i = 0; i < items.length; i += n) await run([...cmd, ...items.slice(i, i + n)]);
  else await run([...cmd, ...items]);
  return st;
}, { usage: 'xargs [OPTION]... COMMAND [INITIAL-ARGS]...', desc: 'Run COMMAND with arguments INITIAL-ARGS and more arguments read from input.\n  -n MAX  -I REPL  -0  -d DELIM  -t' });

// diff ------------------------------------------------------------
export function diffLines(a, b) {
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) { if (a[i] === b[j]) { ops.push([' ', a[i], i++, j++]); } else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push(['-', a[i], i++, j]); else ops.push(['+', b[j], i, j++]); }
  while (i < n) ops.push(['-', a[i], i++, j]);
  while (j < m) ops.push(['+', b[j], i, j++]);
  return ops;
}
def('diff', ctx => {
  const { o, rest } = getopt(ctx, 'uqsirNwBcyU:', { unified: 'u', brief: 'q', 'report-identical-files': 's', 'ignore-case': 'i', recursive: 'r', color: 'K' });
  if (rest.length < 2) throw new UsageError(rest.length ? `missing operand after '${rest[0]}'` : 'missing operand after \'diff\'');
  const fs = ctx.fs, color = o.K === 'always' || (o.K && ctx.tty);
  let status = 0;
  const one = (fa, fb) => {
    let ta, tb;
    try { ta = fs.read(ctx.path(fa)); } catch (e) { ctx.err(`diff: ${fa}: ${errMsg(e)}\n`); status = 2; return; }
    try { tb = fs.read(ctx.path(fb)); } catch (e) { ctx.err(`diff: ${fb}: ${errMsg(e)}\n`); status = 2; return; }
    const norm = s => { if (o.i) s = s.toLowerCase(); if (o.w) s = s.replace(/\s+/g, ''); return s; };
    if (norm(ta) === norm(tb)) { if (o.s) ctx.out(`Files ${fa} and ${fb} are identical\n`); return; }
    status ||= 1;
    if (o.q) { ctx.out(`Files ${fa} and ${fb} differ\n`); return; }
    const a = lines(ta), b = lines(tb), ops = diffLines(a.map(norm), b.map(norm));
    ops.forEach(op => { op[1] = op[0] === '+' ? b[op[3]] : a[op[2]]; });
    const paint = (s, c) => (color ? `\x1b[${c}m${s}\x1b[0m` : s);
    if (o.u || o.U) {
      const C = +(o.U || 3);
      ctx.out(paint(`--- ${fa}\t${strftime('%F %T.000000000 %z', new Date(fs.stat(ctx.path(fa)).mt))}`, 1) + '\n' + paint(`+++ ${fb}\t${strftime('%F %T.000000000 %z', new Date(fs.stat(ctx.path(fb)).mt))}`, 1) + '\n');
      let k = 0;
      while (k < ops.length) {
        while (k < ops.length && ops[k][0] === ' ') k++;
        if (k >= ops.length) break;
        const s = Math.max(0, k - C);
        let e = k, last = k;
        while (e < ops.length && e - last <= C * 2) { if (ops[e][0] !== ' ') last = e; e++; }
        e = Math.min(ops.length, last + C + 1);
        const hunk = ops.slice(s, e), na = hunk.filter(h => h[0] !== '+').length, nb = hunk.filter(h => h[0] !== '-').length;
        ctx.out(paint(`@@ -${na ? ops[s][2] + 1 : ops[s][2]}${na === 1 ? '' : ',' + na} +${nb ? ops[s][3] + 1 : ops[s][3]}${nb === 1 ? '' : ',' + nb} @@`, 36) + '\n');
        for (const h of hunk) ctx.out(paint(h[0] + h[1], h[0] === '+' ? 32 : h[0] === '-' ? 31 : 0) + '\n');
        k = e;
      }
      return;
    }
    let k = 0;
    while (k < ops.length) {
      if (ops[k][0] === ' ') { k++; continue; }
      const s = k;
      while (k < ops.length && ops[k][0] !== ' ') k++;
      const del = ops.slice(s, k).filter(h => h[0] === '-'), add = ops.slice(s, k).filter(h => h[0] === '+');
      const ra = del.length ? `${del[0][2] + 1}${del.length > 1 ? ',' + (del.at(-1)[2] + 1) : ''}` : String(ops[s][2]);
      const rb = add.length ? `${add[0][3] + 1}${add.length > 1 ? ',' + (add.at(-1)[3] + 1) : ''}` : String(ops[s][3]);
      ctx.out(paint(`${ra}${del.length && add.length ? 'c' : del.length ? 'd' : 'a'}${rb}`, 36) + '\n');
      for (const h of del) ctx.out(paint('< ' + h[1], 31) + '\n');
      if (del.length && add.length) ctx.out('---\n');
      for (const h of add) ctx.out(paint('> ' + h[1], 32) + '\n');
    }
  };
  const [fa, fb] = rest;
  const da = fs.isDir(ctx.path(fa)), db = fs.isDir(ctx.path(fb));
  if (da && db) {
    const walk = (x, y) => {
      const na = fs.readdir(ctx.path(x)), nb = fs.readdir(ctx.path(y));
      for (const n of [...new Set([...na, ...nb])].sort()) {
        if (!na.includes(n)) { ctx.out(`Only in ${y}: ${n}\n`); status ||= 1; } else if (!nb.includes(n)) { ctx.out(`Only in ${x}: ${n}\n`); status ||= 1; }
        else if (fs.isDir(ctx.path(join(x, n))) && fs.isDir(ctx.path(join(y, n)))) { if (o.r) walk(join(x, n), join(y, n)); else ctx.out(`Common subdirectories: ${join(x, n)} and ${join(y, n)}\n`); }
        else { if (!o.q) ctx.out(`diff ${o.u ? '-u ' : ''}${o.r ? '-r ' : ''}${join(x, n)} ${join(y, n)}\n`); one(join(x, n), join(y, n)); }
      }
    };
    walk(fa.replace(/\/$/, ''), fb.replace(/\/$/, ''));
  } else one(da ? join(fa, basename(fb)) : fa, db ? join(fb, basename(fa)) : fb);
  return status;
}, { usage: 'diff [OPTION]... FILES', desc: 'Compare FILES line by line.\n  -u unified  -q brief  -r recursive  -i ignore case  -w ignore whitespace' });
def('cmp', ctx => {
  const f = ctx.args.filter(a => !a.startsWith('-'));
  if (f.length < 2) throw new UsageError(`missing operand after '${f[0] || 'cmp'}'`);
  let a, b;
  try { a = ctx.fs.read(ctx.path(f[0])); b = ctx.fs.read(ctx.path(f[1])); } catch (e) { ctx.err(`cmp: ${e.path}: ${errMsg(e)}\n`); return 2; }
  if (a === b) return 0;
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  if (!ctx.args.includes('-s')) ctx.out(i >= Math.min(a.length, b.length) ? `cmp: EOF on ${a.length < b.length ? f[0] : f[1]} after byte ${i}\n` : `${f[0]} ${f[1]} differ: byte ${i + 1}, line ${a.slice(0, i).split('\n').length}\n`);
  return 1;
}, { usage: 'cmp [OPTION]... FILE1 FILE2', desc: 'Compare two files byte by byte.' });

// ---------------------------------------------------------------- encoding / hashing / math
const utf8 = s => new TextEncoder().encode(s);
const b64e = s => btoa(String.fromCharCode(...utf8(s)));
const b64d = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\s+/g, '')), c => c.charCodeAt(0)));
def('base64', async ctx => {
  const { o, rest } = getopt(ctx, 'dDiw:', { decode: 'd', wrap: 'w' });
  const { list, status } = await inputs(ctx, rest);
  const text = list.map(f => f.text).join('');
  try { if (o.d || o.D) ctx.out(b64d(text)); else { const e = b64e(text), w = o.w === undefined ? 76 : +o.w; ctx.out((w ? e.replace(new RegExp(`.{${w}}`, 'g'), '$&\n').replace(/\n$/, '') : e) + '\n'); } }
  catch { ctx.err('base64: invalid input\n'); return 1; }
  return status;
}, { usage: 'base64 [OPTION]... [FILE]', desc: 'Base64 encode or decode FILE, or standard input, to standard output.\n  -d  decode data' });

function md5(bytes) {
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const len = bytes.length, n = ((len + 8) >> 6) + 1, w = new Uint32Array(n * 16);
  for (let i = 0; i < len; i++) w[i >> 2] |= bytes[i] << ((i % 4) * 8);
  w[len >> 2] |= 0x80 << ((len % 4) * 8);
  w[n * 16 - 2] = (len * 8) >>> 0; w[n * 16 - 1] = Math.floor(len / 2 ** 29);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  for (let k = 0; k < n; k++) {
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f, g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; } else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; } else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      f = (f + a + K[i] + w[k * 16 + g]) >>> 0;
      a = d; d = c; c = b;
      const s = S[(i >> 4) * 4 + (i % 4)];
      b = (b + ((f << s) | (f >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + a) >>> 0; b0 = (b0 + b) >>> 0; c0 = (c0 + c) >>> 0; d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0].map(x => [0, 8, 16, 24].map(s => ((x >>> s) & 255).toString(16).padStart(2, '0')).join('')).join('');
}
async function digest(algo, text) {
  if (algo === 'MD5') return md5(utf8(text));
  const buf = await crypto.subtle.digest(algo, utf8(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}
for (const [name, algo] of [['md5sum', 'MD5'], ['sha1sum', 'SHA-1'], ['sha256sum', 'SHA-256'], ['sha512sum', 'SHA-512']]) {
  def(name, async ctx => {
    const { list, status } = await inputs(ctx, ctx.args.filter(a => !a.startsWith('-') || a === '-'));
    for (const f of list) ctx.out(`${await digest(algo, f.text)}  ${f.name && f.name !== '(standard input)' ? f.name : '-'}\n`);
    return status;
  }, { usage: `${name} [OPTION]... [FILE]...`, desc: `Print ${algo} checksums.` });
}

function hexdump(ctx, text, style) {
  const b = utf8(text);
  for (let i = 0; i < b.length; i += 16) {
    const row = [...b.slice(i, i + 16)], hex = row.map(x => x.toString(16).padStart(2, '0'));
    const asc = row.map(x => (x >= 32 && x < 127 ? String.fromCharCode(x) : '.')).join('');
    if (style === 'xxd') ctx.out(`${i.toString(16).padStart(8, '0')}: ${Array.from({ length: 8 }, (_, k) => (hex[k * 2] || '  ') + (hex[k * 2 + 1] || '  ')).join(' ')}  ${asc}\n`);
    else if (style === 'C') ctx.out(`${i.toString(16).padStart(8, '0')}  ${hex.slice(0, 8).join(' ').padEnd(23)}  ${hex.slice(8).join(' ').padEnd(23)}  |${asc}|\n`);
    else if (style === 'od') ctx.out(`${i.toString(8).padStart(7, '0')} ${Array.from({ length: Math.ceil(row.length / 2) }, (_, k) => (((row[k * 2 + 1] || 0) << 8) | row[k * 2]).toString(8).padStart(6, '0')).join(' ')}\n`);
    else ctx.out(`${i.toString(16).padStart(7, '0')} ${Array.from({ length: Math.ceil(row.length / 2) }, (_, k) => (hex[k * 2 + 1] || '00') + hex[k * 2]).join(' ')}\n`);
  }
  if (style !== 'xxd') ctx.out((style === 'od' ? b.length.toString(8).padStart(7, '0') : b.length.toString(16).padStart(style === 'C' ? 8 : 7, '0')) + '\n');
}
def('xxd', async ctx => { const { list, status } = await inputs(ctx, ctx.args.filter(a => !a.startsWith('-'))); hexdump(ctx, list.map(f => f.text).join(''), 'xxd'); return status; }, { usage: 'xxd [file]', desc: 'Make a hexdump.' });
def('hexdump hd', async ctx => { const { list, status } = await inputs(ctx, ctx.args.filter(a => !a.startsWith('-'))); hexdump(ctx, list.map(f => f.text).join(''), ctx.args.includes('-C') || ctx.name === 'hd' ? 'C' : 'hex'); return status; }, { usage: 'hexdump [-C] [file ...]', desc: 'Display file contents in hexadecimal.' });
def('od', async ctx => { const { list, status } = await inputs(ctx, ctx.args.filter(a => !a.startsWith('-'))); hexdump(ctx, list.map(f => f.text).join(''), ctx.args.includes('-c') || ctx.args.includes('-x') ? 'C' : 'od'); return status; }, { usage: 'od [OPTION]... [FILE]...', desc: 'Write an unambiguous representation, octal bytes by default, of FILE.' });

def('expr', ctx => {
  const a = ctx.args;
  if (!a.length) throw new UsageError('missing operand');
  let v;
  if (a[1] === ':') { const m = new RegExp('^' + posixRe(a[2] || '', false)).exec(a[0]); v = m ? m[1] ?? m[0].length : /\\\(/.test(a[2]) ? '' : 0; }
  else if (a[0] === 'length') v = (a[1] || '').length;
  else if (a[0] === 'substr') v = (a[1] || '').substr(+a[2] - 1, +a[3]);
  else if (a[0] === 'index') { const i = [...(a[1] || '')].findIndex(c => (a[2] || '').includes(c)); v = i + 1; }
  else if (a.length === 3 && ['=', '!=', '<', '>', '<=', '>='].includes(a[1]) && (Number.isNaN(+a[0]) || Number.isNaN(+a[2]))) v = { '=': a[0] === a[2], '!=': a[0] !== a[2], '<': a[0] < a[2], '>': a[0] > a[2], '<=': a[0] <= a[2], '>=': a[0] >= a[2] }[a[1]] ? 1 : 0;
  else if (a.length === 1) v = a[0];
  else { try { v = evalArith(a.map(x => (x === '=' ? '==' : x)).join(' ')); } catch (e) { ctx.err(`expr: ${/division/.test(e.message) ? 'division by zero' : /operand|token/.test(e.message) ? 'non-integer argument' : 'syntax error'}\n`); return 2; } }
  ctx.out(v + '\n');
  return v === 0 || v === '' || v === '0' ? 1 : 0;
}, { usage: 'expr EXPRESSION', desc: 'Print the value of EXPRESSION to standard output.' });

def('bc', async ctx => {
  const vars = { scale: ctx.args.includes('-l') ? 20 : 0 };
  const run = line => {
    for (let stmt of line.split(';')) {
      stmt = stmt.replace(/#.*$/, '').trim();
      if (!stmt) continue;
      if (stmt === 'quit') return true;
      try {
        const isAssign = /^[a-z_]\w*\s*([-+*\/%^]?=)(?!=)/.test(stmt);
        const src = stmt.replace(/\^/g, '**').replace(/\bsqrt\b/g, 'sqrt').replace(/\bs\(/g, 'sin(').replace(/\bc\(/g, 'cos(').replace(/\ba\(/g, 'atan(').replace(/\bl\(/g, 'log(').replace(/\be\(/g, 'exp(');
        let v = evalArith(src, { int: false, get: n => vars[n] ?? 0, set: (n, x) => { vars[n] = x; } });
        if (isAssign) continue;
        const sc = vars.scale;
        if (/\//.test(stmt) || !Number.isInteger(v)) { const f = 10 ** sc; v = Math.trunc(v * f) / f; let s = v.toFixed(sc); if (Math.abs(v) < 1 && v !== 0) s = s.replace(/^(-?)0\./, '$1.'); ctx.out((sc ? s : String(Math.trunc(v))) + '\n'); }
        else ctx.out(String(v) + '\n');
      } catch (e) { ctx.err(/division/.test(e.message) ? 'Runtime error (func=(main), adr=0): Divide by zero\n' : '(standard_in) 1: syntax error\n'); }
    }
    return false;
  };
  if (ctx.hasStdin) { for (const l of lines(ctx.stdin)) if (run(l)) break; return 0; }
  if (!ctx.args.includes('-q')) ctx.out('bc 1.07.1\nCopyright 1991-1994, 1997, 1998, 2000, 2004, 2006, 2008, 2012-2017 Free Software Foundation, Inc.\nThis is free software with ABSOLUTELY NO WARRANTY.\nFor details type `warranty\'. \n');
  for (;;) { const l = await ctx.readLine(); if (l === null || run(l)) break; }
}, { usage: 'bc [-l] [-q]', desc: 'An arbitrary precision calculator language (floating point in this build).' });

def('factor', async ctx => {
  const nums = ctx.args.length ? ctx.args : (await ctx.readAll()).split(/\s+/).filter(Boolean);
  for (const s of nums) {
    let n = Number(s);
    if (!Number.isInteger(n) || n < 0) { ctx.err(`factor: ‘${s}’ is not a valid positive integer\n`); continue; }
    const f = [];
    for (let p = 2; p * p <= n; p++) while (n % p === 0) { f.push(p); n /= p; }
    if (n > 1) f.push(n);
    ctx.out(`${s}:${f.map(x => ' ' + x).join('')}\n`);
  }
}, { usage: 'factor [NUMBER]...', desc: 'Print the prime factors of each specified integer NUMBER.' });

def('sleep', async ctx => {
  if (!ctx.args.length) throw new UsageError('missing operand');
  let ms = 0;
  for (const a of ctx.args) { const m = /^([\d.]+)([smhd]?)$/.exec(a); if (!m) throw new UsageError(`invalid time interval ‘${a}’`); ms += parseFloat(m[1]) * { '': 1e3, s: 1e3, m: 6e4, h: 36e5, d: 864e5 }[m[2]]; }
  await ctx.sleep(ms);
}, { usage: 'sleep NUMBER[SUFFIX]...', desc: 'Pause for NUMBER seconds. SUFFIX may be s, m, h or d.' });

def('true', () => 0, { usage: 'true', desc: 'Do nothing, successfully.' });
def('false', () => 1, { usage: 'false', desc: 'Do nothing, unsuccessfully.' });
export { human, lsDate, b64e, b64d, digest, fmtBytes };
