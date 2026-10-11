// Full-screen terminal programs: vim launcher, less/more, nano, top/htop, cmatrix, sl.

import { strftime, strWidth, pad2 } from '../core/util.js';
import { errMsg, basename } from '../core/vfs.js';
import { def } from './coreutils.js';
import { Vim } from './vim.js';
import { TUTOR } from './vim-ex.js';
import { procList, upStr, mem, ncpu } from './sysutils.js';

// ---------------------------------------------------------------- vim
// env: { term, fs, cwd, home, vars, run(cmd, {stdin, capture}) -> {out, status} }
export async function runVim(env, argv) {
  const term = env.term;
  let screen = term.enterAlt(), vim, pop;
  const bind = () => { screen.onResize = () => vim.resize(); pop = term.pushHandler(ev => vim.key(ev)); };
  vim = new Vim({
    screen, fs: env.fs, cwd: env.cwd, home: env.home, env: env.vars,
    style: s => term.style(s), bell: () => term.bell(),
    clipRead: () => navigator.clipboard.readText(),
    clipWrite: t => { navigator.clipboard?.writeText(t).catch(() => {}); },
    shell: env.run && (async (cmd, { stdin, capture }) => {
      if (capture) return env.run(cmd, { stdin, capture: true });
      pop(); term.exitAlt(); term.write('\n');
      const res = await env.run(cmd, { stdin, capture: false });
      if (res.status) term.write(`\nshell returned ${res.status}\n`);
      term.write('\n\x1b[32mPress ENTER or type command to continue\x1b[0m');
      await term.readKey();
      term.write('\n');
      screen = term.enterAlt(); bind();
      return { ...res, screen };
    }),
  });
  bind();
  const code = await vim.run(argv);
  pop(); term.exitAlt();
  return code;
}
const bashEnv = ctx => ({
  term: ctx.term, fs: ctx.fs, cwd: ctx.cwd, home: ctx.home, vars: ctx.env,
  run: async (cmd, { stdin, capture }) => {
    const parts = [], sink = capture ? { write: s => parts.push(s) } : { tty: true, write: s => ctx.term.write(s) };
    let status;
    try { status = await ctx.exec(cmd, { in: stdin != null ? { s: stdin, p: 0 } : null, out: sink, err: sink }); }
    catch (e) { if (e.constructor.name !== 'Interrupt') throw e; ctx.sh.abort = false; status = 130; }
    return { out: parts.join(''), status };
  },
});
def('vim vi view ex', async ctx => {
  if (ctx.args.includes('--version')) { ctx.out('VIM - Vi IMproved 8.2 (2019 Dec 12, compiled Oct 11 2026 13:35:00)\nIncluded patches: 1-4919\nHuge version without GUI.\n'); return 0; }
  if (ctx.args.includes('-h') || ctx.args.includes('--help')) { ctx.out('VIM - Vi IMproved 8.2\n\nUsage: vim [arguments] [file ..]       edit specified file(s)\n\nArguments:\n   -R\t\t\tReadonly mode (like "view")\n   +\t\t\tStart at end of file\n   +<lnum>\t\tStart at line <lnum>\n   --version\t\tPrint version information and exit\n'); return 0; }
  if (!ctx.tty) { ctx.err('Vim: Warning: Output is not to a terminal\n'); return 1; }
  const stdin = ctx.hasStdin ? ctx.stdin : null;
  let args = ctx.name === 'view' ? ['-R', ...ctx.args] : [...ctx.args];
  if (stdin !== null && args.includes('-')) { const p = '/tmp/.vim-stdin'; ctx.fs.write(p, stdin); args = args.map(a => (a === '-' ? p : a)); }
  return runVim(bashEnv(ctx), args);
}, { usage: 'vim [arguments] [file ..]', desc: 'Vi IMproved, a programmer\'s text editor.\nRun vimtutor for a hands-on introduction, or type :help inside Vim.', ownHelp: true });
def('vimtutor', async ctx => {
  const p = '/tmp/tutor' + Math.random().toString(36).slice(2, 8);
  ctx.fs.write(p, TUTOR);
  const st = await runVim(bashEnv(ctx), [p]);
  try { ctx.fs.unlink(p); } catch { /* already gone */ }
  return st;
}, { usage: 'vimtutor', desc: 'The Vim tutor: opens a scratch copy of a hands-on tutorial.' });

// ---------------------------------------------------------------- less / more
function ansiSegs(term, line) {
  const segs = [];
  let s = {}, last = 0;
  const st = () => (Object.keys(s).length ? term.style(s) : null);
  for (const m of line.matchAll(/\x1b\[([0-9;]*)m/g)) {
    if (m.index > last) segs.push([line.slice(last, m.index), st()]);
    last = m.index + m[0].length;
    const a = m[1] === '' ? [0] : m[1].split(';').map(Number);
    s = { ...s };
    for (let k = 0; k < a.length; k++) {
      const n = a[k];
      if (n === 0) s = {}; else if (n === 1) s.b = true; else if (n === 4) s.u = true; else if (n === 7) s.inv = true; else if (n === 22) delete s.b; else if (n === 24) delete s.u;
      else if (n >= 30 && n <= 37) s.fg = n - 30; else if (n >= 90 && n <= 97) s.fg = n - 82; else if (n >= 40 && n <= 47) s.bg = n - 40; else if (n === 39) delete s.fg;
      else if (n === 38 && a[k + 1] === 5) { s.fg = a[k + 2]; k += 2; } else if (n === 38 && a[k + 1] === 2) { s.fg = `rgb(${a[k + 2]},${a[k + 3]},${a[k + 4]})`; k += 4; }
    }
  }
  if (last < line.length) segs.push([line.slice(last), st()]);
  return segs;
}
def('less more pager', async ctx => {
  let text = ctx.pagerText, name = ctx.pagerTitle || '';
  const files = ctx.args.filter(a => !/^[-+]/.test(a));
  if (text == null) {
    if (files.length) { try { text = ctx.fs.read(ctx.path(files[0])); name = files[0]; } catch (e) { ctx.err(`${ctx.name === 'more' ? 'more: cannot open ' + files[0] : files[0]}: ${errMsg(e)}\n`); return 1; } }
    else if (ctx.hasStdin) text = ctx.stdin;
    else { ctx.err(ctx.name === 'more' ? 'more: bad usage\nTry \'more --help\' for more information.\n' : 'Missing filename ("less --help" for help)\n'); return 1; }
  }
  if (!ctx.tty) { ctx.out(text); return 0; }
  const term = ctx.term, isMore = ctx.name === 'more';
  const raw = text.replace(/\n$/, '').split('\n').map(l => l.replace(/\t/g, '        '));
  if (isMore && raw.length < term.rows) { ctx.out(text); return 0; }
  const sc = term.enterAlt(), inv = term.style({ inv: true }), hi = term.style({ inv: true });
  let top = 0, query = null, prompt = null, msg = null, done;
  const plain = l => l.replace(/\x1b\[[0-9;]*m/g, '');
  const page = () => sc.rows - 1;
  const maxTop = () => Math.max(0, raw.length - page());
  const draw = () => {
    sc.clear();
    for (let r = 0; r < page(); r++) {
      const l = raw[top + r];
      if (l === undefined) { if (!isMore) sc.put(r, 0, '~', term.style({ b: true })); continue; }
      let x = 0;
      for (const [t, st] of ansiSegs(term, l)) x = sc.put(r, x, t, st);
      if (query) { const p = plain(l); query.lastIndex = 0; let m; while ((m = query.exec(p)) && m[0]) sc.put(r, strWidth(p.slice(0, m.index)), m[0], hi); }
    }
    const end = top >= maxTop(), br = sc.rows - 1;
    let status;
    if (prompt !== null) status = prompt.ch + prompt.text;
    else if (msg) status = msg;
    else if (isMore) status = `--More--(${Math.min(100, Math.round(((top + page()) / raw.length) * 100))}%)`;
    else status = name ? (ctx.pagerTitle ? `${name} line ${top + 1}${end ? '/' + raw.length + ' (END)' : ''} (press h for help or q to quit)` : top === 0 ? name + (end ? ' (END)' : '') : end ? '(END)' : ':') : end ? '(END)' : ':';
    const x = sc.put(br, 0, status, prompt !== null || status === ':' ? null : inv);
    sc.cursor = { r: br, c: Math.min(sc.cols - 1, x), shape: 'block', visible: true };
    sc.flush();
  };
  const search = (fwd, from) => {
    if (!query) return;
    for (let i = from; i >= 0 && i < raw.length; i += fwd ? 1 : -1) { query.lastIndex = 0; if (query.test(plain(raw[i]))) { top = Math.min(maxTop(), i); return; } }
    msg = 'Pattern not found  (press RETURN)';
  };
  sc.onResize = draw;
  const pop = term.pushHandler(ev => {
    const k = ev.key;
    msg = null;
    if (prompt !== null) {
      if (k === 'Enter') { const p = prompt; prompt = null; if (p.text) { try { query = new RegExp(p.text, 'g' + (/[A-Z]/.test(p.text) ? '' : 'i')); } catch { query = null; msg = 'Invalid pattern  (press RETURN)'; } p.fwd = p.ch === '/'; prompt = null; searchDir = p.fwd; search(p.fwd, p.fwd ? top + 1 : top - 1); } }
      else if (k === 'Escape' || (ev.ctrl && k === 'c')) prompt = null;
      else if (k === 'Backspace') { if (!prompt.text) prompt = null; else prompt.text = prompt.text.slice(0, -1); }
      else if (ev.text) prompt.text += k;
      draw(); return true;
    }
    const half = Math.max(1, Math.floor(page() / 2));
    if (k === 'q' || k === 'Q' || (ev.ctrl && k === 'c' && isMore)) return done(0), true;
    else if (k === 'j' || k === 'ArrowDown' || k === 'Enter' || k === 'e' || k === 'WheelDown') { if (isMore && top >= maxTop()) return done(0), true; top += k === 'WheelDown' ? 3 : 1; }
    else if (k === 'k' || k === 'ArrowUp' || k === 'y' || k === 'WheelUp') top -= k === 'WheelUp' ? 3 : 1;
    else if (k === ' ' || k === 'f' || k === 'PageDown' || (ev.ctrl && (k === 'f' || k === 'v'))) { if (isMore && top >= maxTop()) return done(0), true; top += page(); }
    else if (k === 'b' || k === 'PageUp' || (ev.ctrl && k === 'b')) top -= page();
    else if (k === 'd' || (ev.ctrl && k === 'd')) top += half;
    else if (k === 'u' || (ev.ctrl && k === 'u')) top -= half;
    else if (k === 'g' || k === 'Home' || k === '<') top = 0;
    else if (k === 'G' || k === 'End' || k === '>') top = maxTop();
    else if (k === '/' || k === '?') prompt = { ch: k, text: '' };
    else if (k === 'n') search(searchDir, searchDir ? top + 1 : top - 1);
    else if (k === 'N') search(!searchDir, !searchDir ? top + 1 : top - 1);
    else if (k === '=') msg = `${name || 'stdin'} lines ${top + 1}-${Math.min(raw.length, top + page())}/${raw.length} ${Math.round((Math.min(raw.length, top + page()) / raw.length) * 100)}%  (press RETURN)`;
    else if (k === 'h' || k === 'H') msg = 'q quit  j/k line  SPACE/b page  d/u half  g/G top/bottom  /pat ?pat n N search  (press RETURN)';
    else if (ev.ctrl && k === 'c') { /* less ignores ^C */ }
    else return false;
    top = Math.max(0, Math.min(maxTop(), top));
    draw();
    return true;
  });
  let searchDir = true;
  draw();
  const st = await new Promise(res => { done = res; });
  pop(); term.exitAlt();
  return st;
}, { usage: 'less [options] file...', desc: 'Opposite of more: page through text one screenful at a time.\n  j/k line  SPACE/b page  /pattern search  n/N next  g/G top/bottom  q quit' });

// ---------------------------------------------------------------- nano (also the engine behind cmd.exe's "edit")
// env: { term, fs, cwd }; skin: 'nano' | 'dos'
export async function runEditor(env, file, skin = 'nano') {
  const term = env.term, fs = env.fs, dos = skin === 'dos';
  const sc = term.enterAlt();
  const inv = term.style(dos ? { fg: 0, bg: 7 } : { inv: true }), body = dos ? term.style({ fg: 15, bg: '#0000a8' }) : null, key = dos ? term.style({ fg: 15, bg: 0, b: true }) : inv;
  let name = file || '', path = file ? fs.abs(file, env.cwd) : null;
  let lines = [''], cur = { l: 0, c: 0 }, top = 0, left = 0, want = 0, modified = false, status = '', cut = [], lastCut = false, prompt = null, done, lastSearch = '';
  const undo = [], redo = [];
  if (path) {
    const n = fs.stat(path);
    if (n && n.t === 'd') status = `"${name}" is a directory`;
    else if (n) { try { const t = fs.read(path); lines = t.replace(/\n$/, '').split('\n'); status = `Read ${lines.length} line${lines.length === 1 ? '' : 's'}`; } catch (e) { status = `Error reading ${name}: ${errMsg(e)}`; } }
    else status = 'New File';
  }
  const snap = () => { undo.push({ lines: lines.slice(), cur: { ...cur } }); if (undo.length > 200) undo.shift(); redo.length = 0; modified = true; };
  const textRows = () => sc.rows - (dos ? 3 : 5);
  const HELP1 = [['^G', 'Help'], ['^O', 'Write Out'], ['^W', 'Where Is'], ['^K', 'Cut'], ['^T', 'Execute'], ['^C', 'Location']];
  const HELP2 = [['^X', 'Exit'], ['^R', 'Read File'], ['^\\', 'Replace'], ['^U', 'Paste'], ['^J', 'Justify'], ['^/', 'Go To Line']];
  const draw = () => {
    sc.clear(body);
    const rows = textRows(), y0 = dos ? 2 : 2;
    if (cur.l < top) top = cur.l; if (cur.l >= top + rows) top = cur.l - rows + 1;
    const cx = strWidth(lines[cur.l].slice(0, cur.c).replace(/\t/g, '        '));
    if (cx < left) left = Math.max(0, cx - 8); if (cx >= left + sc.cols - 1) left = cx - sc.cols + 9;
    if (dos) {
      sc.fill(0, 0, sc.cols, ' ', inv); sc.put(0, 2, 'File  Edit  Search  View  Options  Help', inv);
      sc.fill(1, 0, sc.cols, '─', body); const t = ` ${name || 'UNTITLED1'} `; sc.put(1, Math.max(0, Math.floor((sc.cols - t.length) / 2)), t, inv);
    } else {
      sc.fill(0, 0, sc.cols, ' ', inv); sc.put(0, 2, 'GNU nano 6.2', inv);
      const t = name || 'New Buffer'; sc.put(0, Math.max(16, Math.floor((sc.cols - strWidth(t)) / 2)), t, inv);
      if (modified) sc.put(0, sc.cols - 10, 'Modified', inv);
    }
    for (let r = 0; r < rows; r++) {
      const l = lines[top + r];
      if (l === undefined) continue;
      const shown = l.replace(/\t/g, '        ');
      sc.put(y0 + r, 0, [...shown].slice(left).join(''), body);
      if (left > 0 && shown.length) sc.put(y0 + r, 0, '<', inv);
    }
    const br = sc.rows - 1;
    if (dos) {
      sc.fill(br, 0, sc.cols, ' ', inv);
      sc.put(br, 1, prompt ? prompt.label + prompt.text : status || 'Ctrl+S=Save  Ctrl+O=Save As  Ctrl+F=Find  Ctrl+Q=Exit', inv);
      sc.put(br, sc.cols - 22, `Line:${cur.l + 1}  Col:${cur.c + 1}`.padEnd(20), inv);
    } else {
      if (prompt) { sc.fill(br - 2, 0, sc.cols, ' ', inv); sc.put(br - 2, 0, prompt.label + prompt.text, inv); }
      else if (status) { const s = `[ ${status} ]`; sc.put(br - 2, Math.max(0, Math.floor((sc.cols - strWidth(s)) / 2)), s, inv); }
      const w = Math.floor(sc.cols / 6);
      const bar = prompt ? (prompt.yn ? [[[' Y', 'Yes'], [' N', 'No'], ...(prompt.all ? [[' A', 'All']] : [])], [['^C', 'Cancel']]] : [[['^G', 'Help']], [['^C', 'Cancel']]]) : [HELP1, HELP2];
      bar.forEach((row, ri) => row.forEach(([k, label], i) => { sc.put(br - 1 + ri, i * w, k, key); sc.put(br - 1 + ri, i * w + 3, label.slice(0, w - 4)); }));
    }
    sc.cursor = prompt ? { r: dos ? br : br - 2, c: Math.min(sc.cols - 1, strWidth(prompt.label + prompt.text) + (dos ? 1 : 0)), shape: 'block', visible: true } : { r: y0 + cur.l - top, c: cx - left, shape: dos ? 'underline' : 'block', visible: true };
    sc.flush();
  };
  const ask = (label, text = '', opts = {}) => new Promise(res => { prompt = { label, text, res, ...opts }; draw(); });
  const save = async asName => {
    let target = name;
    if (asName || !name) { target = await ask('File Name to Write: ', name); if (target === null || target === '') { status = 'Cancelled'; return false; } }
    try { fs.write(fs.abs(target, env.cwd), lines.join('\n') + '\n'); } catch (e) { status = `Error writing ${target}: ${errMsg(e)}`; return false; }
    name = target; path = fs.abs(target, env.cwd); modified = false;
    status = `Wrote ${lines.length} line${lines.length === 1 ? '' : 's'}`;
    return true;
  };
  const find = (q, from) => {
    const lc = q.toLowerCase();
    for (let i = 0; i <= lines.length; i++) {
      const l = (from.l + i) % lines.length;
      const idx = lines[l].toLowerCase().indexOf(lc, i === 0 ? from.c + 1 : 0);
      if (idx >= 0 && !(i === lines.length && idx > from.c)) return { l, c: idx };
    }
    return null;
  };
  const command = async (k, ev) => {
    const line = lines[cur.l];
    const isCut = ev.ctrl && k === 'k';
    if (ev.text) { snap(); lines[cur.l] = line.slice(0, cur.c) + k + line.slice(cur.c); cur.c += k.length; }
    else if (k === 'Enter') { snap(); const ind = /^[ \t]*/.exec(line)[0]; lines.splice(cur.l, 1, line.slice(0, cur.c), (dos ? '' : ind) + line.slice(cur.c)); cur.l++; cur.c = dos ? 0 : ind.length; }
    else if (k === 'Tab') { snap(); lines[cur.l] = line.slice(0, cur.c) + '\t' + line.slice(cur.c); cur.c++; }
    else if (k === 'Backspace' || (ev.ctrl && k === 'h')) { if (cur.c > 0) { snap(); lines[cur.l] = line.slice(0, cur.c - 1) + line.slice(cur.c); cur.c--; } else if (cur.l > 0) { snap(); cur.c = lines[cur.l - 1].length; lines.splice(cur.l - 1, 2, lines[cur.l - 1] + line); cur.l--; } }
    else if (k === 'Delete' || (ev.ctrl && k === 'd')) { if (cur.c < line.length) { snap(); lines[cur.l] = line.slice(0, cur.c) + line.slice(cur.c + 1); } else if (cur.l < lines.length - 1) { snap(); lines.splice(cur.l, 2, line + lines[cur.l + 1]); } }
    else if (k === 'ArrowLeft' || (ev.ctrl && k === 'b')) { if (cur.c > 0) cur.c--; else if (cur.l > 0) { cur.l--; cur.c = lines[cur.l].length; } }
    else if (k === 'ArrowRight' || (ev.ctrl && k === 'f' && !dos)) { if (cur.c < line.length) cur.c++; else if (cur.l < lines.length - 1) { cur.l++; cur.c = 0; } }
    else if (k === 'ArrowUp' || (ev.ctrl && k === 'p')) { if (cur.l > 0) { cur.l--; cur.c = Math.min(lines[cur.l].length, want); } return; }
    else if (k === 'ArrowDown' || (ev.ctrl && k === 'n')) { if (cur.l < lines.length - 1) { cur.l++; cur.c = Math.min(lines[cur.l].length, want); } return; }
    else if (k === 'Home' || (ev.ctrl && k === 'a')) cur.c = 0;
    else if (k === 'End' || (ev.ctrl && k === 'e')) cur.c = line.length;
    else if (k === 'PageUp' || (ev.ctrl && k === 'y')) { cur.l = Math.max(0, cur.l - textRows()); top = Math.max(0, top - textRows()); cur.c = Math.min(lines[cur.l].length, want); return; }
    else if (k === 'PageDown' || (ev.ctrl && k === 'v')) { cur.l = Math.min(lines.length - 1, cur.l + textRows()); cur.c = Math.min(lines[cur.l].length, want); return; }
    else if (k === 'WheelUp' || k === 'WheelDown') { top = Math.max(0, Math.min(Math.max(0, lines.length - 1), top + (k === 'WheelUp' ? -3 : 3))); cur.l = Math.max(top, Math.min(top + textRows() - 1, cur.l, lines.length - 1)); cur.c = Math.min(lines[cur.l].length, cur.c); return; }
    else if (isCut) { snap(); const [gone] = lines.splice(cur.l, 1); if (!lines.length) lines.push(''); if (lastCut) cut.push(gone); else cut = [gone]; cur.l = Math.min(cur.l, lines.length - 1); cur.c = 0; }
    else if (ev.ctrl && k === 'u') { if (cut.length) { snap(); lines.splice(cur.l, 0, ...cut); cur.l += cut.length; cur.c = 0; } }
    else if (ev.ctrl && (k === 'o' || k === 's')) await save(k === 'o');
    else if (ev.ctrl && (k === 'x' || k === 'q')) {
      if (modified) { const a = await ask(dos ? 'Save changes? (Y/N) ' : 'Save modified buffer? ', '', { yn: true }); if (a === null) { status = 'Cancelled'; return; } if (a === 'y' && !(await save(false))) return; }
      return done(0);
    }
    else if ((ev.ctrl && k === 'w') || (ev.ctrl && k === 'f' && dos)) {
      const q = await ask(`Search${lastSearch ? ` [${lastSearch}]` : ''}: `);
      if (q === null) { status = 'Cancelled'; return; }
      lastSearch = q || lastSearch;
      const hit = lastSearch && find(lastSearch, cur);
      if (hit) { if (hit.l < cur.l || (hit.l === cur.l && hit.c <= cur.c)) status = 'Search Wrapped'; cur = hit; } else status = `"${lastSearch}" not found`;
    }
    else if (ev.alt && k === 'w') { const hit = lastSearch && find(lastSearch, cur); if (hit) cur = hit; else status = lastSearch ? `"${lastSearch}" not found` : 'No current search pattern'; }
    else if (ev.ctrl && k === '\\') {
      const q = await ask('Search (to replace): ', lastSearch);
      if (!q) { status = 'Cancelled'; return; }
      const rep = await ask('Replace with: ');
      if (rep === null) { status = 'Cancelled'; return; }
      lastSearch = q;
      let n = 0, all = false, pos = { l: cur.l, c: cur.c - 1 };
      const start = { ...cur };
      for (let guard = 0; guard < 100000; guard++) {
        const hit = find(q, pos);
        if (!hit || (n > 0 && guard > 0 && hit.l === start.l && hit.c === start.c && !all && false)) break;
        cur = hit;
        let a = 'y';
        if (!all) { a = await ask('Replace this instance? ', '', { yn: true, all: true }); if (a === null) break; if (a === 'a') all = true; }
        if (a === 'y' || a === 'a') { if (!n) snap(); lines[hit.l] = lines[hit.l].slice(0, hit.c) + rep + lines[hit.l].slice(hit.c + q.length); n++; pos = { l: hit.l, c: hit.c + rep.length - 1 }; } else pos = hit;
        if (guard > lines.length * 50) break;
        if (!lines.some(l => l.toLowerCase().includes(q.toLowerCase()))) break;
        if (rep.toLowerCase().includes(q.toLowerCase()) && all && n > 5000) break;
      }
      status = `Replaced ${n} occurrence${n === 1 ? '' : 's'}`;
    }
    else if (ev.ctrl && (k === '_' || k === '/' || k === '7')) { const a = await ask('Enter line number, column number: '); const m = /^(\d+)(?:[ ,]+(\d+))?/.exec(a || ''); if (m) { cur.l = Math.max(0, Math.min(lines.length - 1, +m[1] - 1)); cur.c = Math.min(lines[cur.l].length, Math.max(0, (+m[2] || 1) - 1)); } else status = 'Cancelled'; }
    else if (ev.ctrl && k === 'c') { const chars = lines.join('\n').length, at = lines.slice(0, cur.l).join('\n').length + (cur.l ? 1 : 0) + cur.c; status = `line ${cur.l + 1}/${lines.length} (${Math.round(((cur.l + 1) / lines.length) * 100)}%), col ${cur.c + 1}/${line.length + 1} (${Math.round(((cur.c + 1) / (line.length + 1)) * 100)}%), char ${at}/${chars} (${chars ? Math.round((at / chars) * 100) : 0}%)`; }
    else if (ev.ctrl && k === 'r') { const f = await ask('File to insert [from ./]: '); if (!f) { status = 'Cancelled'; return; } try { const ins = fs.read(fs.abs(f, env.cwd)).replace(/\n$/, '').split('\n'); snap(); lines.splice(cur.l, 0, ...ins); status = `Inserted ${ins.length} line${ins.length === 1 ? '' : 's'}`; } catch (e) { status = `Error reading ${f}: ${errMsg(e)}`; } }
    else if (ev.alt && k === 'u') { const u = undo.pop(); if (u) { redo.push({ lines: lines.slice(), cur: { ...cur } }); lines = u.lines; cur = u.cur; status = 'Undid action'; } else status = 'Nothing to undo'; }
    else if (ev.alt && k === 'e') { const r = redo.pop(); if (r) { undo.push({ lines: lines.slice(), cur: { ...cur } }); lines = r.lines; cur = r.cur; status = 'Redid action'; } else status = 'Nothing to redo'; }
    else if (ev.ctrl && k === 'g') status = 'nano: ^O save  ^X exit  ^W search  ^\\ replace  ^K cut  ^U paste  ^/ go to line  M-U undo  M-E redo';
    else if (ev.ctrl && (k === 'j' || k === 't')) status = 'This function is disabled in the browser build';
    else return false;
    lastCut = isCut;
    want = cur.c;
  };
  let chain = Promise.resolve();
  sc.onResize = draw;
  const pop = term.pushHandler(ev => {
    const k = ev.key;
    if (prompt) {
      const p = prompt;
      const finish = v => { prompt = null; p.res(v); };
      if (ev.ctrl && k === 'c' || k === 'Escape') finish(null);
      else if (p.yn) { const c = k.toLowerCase(); if (c === 'y' || c === 'n' || (c === 'a' && p.all)) finish(c); }
      else if (k === 'Enter') finish(p.text);
      else if (k === 'Backspace') p.text = p.text.slice(0, -1);
      else if (ev.text) p.text += k;
      draw();
      return true;
    }
    if (!ev.text && !ev.ctrl && !ev.alt && k.length > 1 && !['Enter', 'Tab', 'Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown', 'WheelUp', 'WheelDown'].includes(k)) return false;
    status = '';
    chain = chain.then(() => command(k, ev)).then(() => draw(), e => { console.error(e); draw(); });
    return true;
  });
  draw();
  const st = await new Promise(res => { done = res; });
  pop(); term.exitAlt();
  return st;
}
def('nano pico', async ctx => {
  if (ctx.args.includes('--version')) { ctx.out(' GNU nano, version 6.2\n (C) 1999-2011, 2013-2022 Free Software Foundation, Inc.\n'); return 0; }
  if (!ctx.tty) { ctx.err('Too many errors from stdin\n'); return 1; }
  return runEditor({ term: ctx.term, fs: ctx.fs, cwd: ctx.cwd }, ctx.args.find(a => !/^[-+]/.test(a)));
}, { usage: 'nano [options] [file]', desc: "Nano's ANOther editor, inspired by Pico.\n  ^O save  ^X exit  ^W search  ^\\ replace  ^K cut  ^U paste  M-U undo", ownHelp: true });

// ---------------------------------------------------------------- top / htop
const topFn = async ctx => {
  const term = ctx.term, fancy = ctx.name === 'htop';
  if (!ctx.tty) { ctx.err(`${ctx.name}: failed tty get\n`); return 1; }
  const dIdx = ctx.args.indexOf('-d'), delay = (dIdx >= 0 ? parseFloat(ctx.args[dIdx + 1]) : fancy ? 1.5 : 3) * 1000;
  const sc = term.enterAlt();
  const inv = term.style({ inv: true }), bold = term.style({ b: true }), green = term.style({ fg: 2 }), cyan = term.style({ fg: 6 }), red = term.style({ fg: 1 }), blue = term.style({ fg: 12, b: true }), hdr = term.style({ fg: 0, bg: 2 }), fkey = term.style({ fg: 0, bg: 6 }), dim = term.style({ fg: 8 });
  let sort = 'cpu', done, timer;
  const draw = () => {
    sc.clear();
    const m = mem(), up = Date.now() - (ctx.os.bootTime || ctx.sh.started);
    const procs = [...procList(ctx), { pid: ctx.sh.pid + 61, user: ctx.user, cmd: ctx.name, cpu: 0.7, mem: 0.1, tty: 'pts/0' }]
      .map(p => ({ ...p, cpu: Math.max(0, p.cpu + (Math.random() - 0.45) * (p.cpu > 0.5 ? 2 : 0.3)) }))
      .sort((a, b) => (sort === 'cpu' ? b.cpu - a.cpu : sort === 'mem' ? b.mem - a.mem : a.pid - b.pid));
    const total = procs.reduce((s, p) => s + p.cpu, 0), n = ncpu();
    let y = 0;
    if (fancy) {
      const bar = (r, x, label, frac, text, w) => { sc.put(r, x, label, cyan); sc.put(r, x + label.length, '[', bold); const inner = w - label.length - 2, fill = Math.round(inner * Math.min(1, frac)); sc.put(r, x + label.length + 1, '|'.repeat(Math.max(0, fill)), frac > 0.8 ? red : green); sc.put(r, x + label.length + 1 + inner - text.length, text, dim); sc.put(r, x + w - 1, ']', bold); };
      const cores = Math.min(n, 8), half = Math.ceil(cores / 2), bw = Math.floor(sc.cols / 2) - 2;
      for (let c = 0; c < cores; c++) { const f = Math.min(1, (total / n / 100) * (0.5 + Math.random())); bar(c % half, c < half ? 1 : bw + 3, String(c).padStart(3), f, (f * 100).toFixed(1) + '%', bw); }
      y = half;
      bar(y, 1, 'Mem', m.used / m.total, `${(m.used / 1048576).toFixed(2)}G/${(m.total / 1048576).toFixed(2)}G`, bw);
      sc.put(y, bw + 3, 'Tasks: ', cyan); sc.put(y, bw + 10, `${procs.length + 96}, ${procs.length * 3} thr; 1 running`, bold); y++;
      bar(y, 1, 'Swp', 0, '0K/2.00G', bw);
      sc.put(y, bw + 3, 'Load average: ', cyan); sc.put(y, bw + 17, '0.31 0.42 0.35', bold); y++;
      sc.put(y, bw + 3, 'Uptime: ', cyan); sc.put(y, bw + 11, upStr(up).replace(' min', ':00').padStart(8, '0'), bold); y += 2;
      sc.fill(y, 0, sc.cols, ' ', hdr); sc.put(y, 0, '    PID USER      PRI  NI  VIRT   RES   SHR S CPU% MEM%   TIME+  Command', hdr); y++;
    } else {
      sc.put(y++, 0, `top - ${strftime('%T')} up ${upStr(up).padStart(5)},  1 user,  load average: 0.31, 0.42, 0.35`);
      sc.put(y++, 0, `Tasks: ${procs.length + 196} total,   1 running, ${procs.length + 195} sleeping,   0 stopped,   0 zombie`);
      const us = total / n;
      sc.put(y++, 0, `%Cpu(s): ${us.toFixed(1).padStart(4)} us,  0.7 sy,  0.0 ni, ${(99.2 - us).toFixed(1).padStart(4)} id,  0.1 wa,  0.0 hi,  0.0 si,  0.0 st`);
      sc.put(y++, 0, `MiB Mem : ${(m.total / 1024).toFixed(1).padStart(8)} total, ${(m.free / 1024).toFixed(1).padStart(8)} free, ${(m.used / 1024).toFixed(1).padStart(8)} used, ${(m.cache / 1024).toFixed(1).padStart(8)} buff/cache`);
      sc.put(y++, 0, `MiB Swap:   2048.0 total,   2048.0 free,      0.0 used. ${((m.total - m.used) / 1024).toFixed(1).padStart(8)} avail Mem `);
      y++;
      sc.fill(y, 0, sc.cols, ' ', inv); sc.put(y, 0, '    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND', inv); y++;
    }
    for (const p of procs) {
      if (y >= sc.rows - (fancy ? 1 : 0)) break;
      const res = Math.round((p.mem * m.total) / 100), virt = res * 4 + 9000, t = Math.floor((up / 1000) * (p.cpu / 100) * 4 + p.pid % 50);
      const time = `${Math.floor(t / 60)}:${pad2(t % 60)}.${pad2(p.pid % 100)}`;
      const cmd = fancy ? p.cmd : p.cmd.split(' ')[0].replace(/^.*\//, '').replace(/[[\]]/g, '');
      const row = fancy
        ? `${String(p.pid).padStart(7)} ${p.user.padEnd(9)}  20   0 ${(virt > 9999 ? (virt / 1024).toFixed(0) + 'M' : virt + 'K').padStart(5)} ${(res > 9999 ? (res / 1024).toFixed(0) + 'M' : res + 'K').padStart(5)} ${String(Math.round(res / 3)).padStart(5).slice(0, 5)} ${p.cmd === ctx.name ? 'R' : 'S'} ${p.cpu.toFixed(1).padStart(4)} ${p.mem.toFixed(1).padStart(4)} ${time.padStart(8)}  `
        : `${String(p.pid).padStart(7)} ${p.user.padEnd(9)} 20   0 ${String(virt).padStart(7)} ${String(res).padStart(6)} ${String(Math.round(res / 3)).padStart(6)} ${p.cmd === ctx.name ? 'R' : 'S'} ${p.cpu.toFixed(1).padStart(5)} ${p.mem.toFixed(1).padStart(5)} ${time.padStart(9)} `;
      const x = sc.put(y, 0, row, p.cmd === ctx.name && !fancy ? bold : null);
      sc.put(y, x, cmd, fancy ? (p.user === 'root' ? null : green) : p.cmd === ctx.name ? bold : null);
      if (fancy && p.user === 'root') sc.put(y, 8, p.user.padEnd(9), dim);
      y++;
    }
    if (fancy) { let x = 0; for (const [k, l] of [['F1', 'Help  '], ['F2', 'Setup '], ['F3', 'Search'], ['F4', 'Filter'], ['F5', 'Tree  '], ['F6', 'SortBy'], ['F7', 'Nice -'], ['F8', 'Nice +'], ['F9', 'Kill  '], ['F10', 'Quit  ']]) { x = sc.put(sc.rows - 1, x, k, null); x = sc.put(sc.rows - 1, x, l, fkey); } }
    sc.cursor = { r: fancy ? sc.rows - 1 : 5, c: fancy ? sc.cols - 1 : 0, shape: 'block', visible: !fancy };
    sc.flush();
    void blue;
  };
  sc.onResize = draw;
  const pop = term.pushHandler(ev => {
    const k = ev.key;
    if (k === 'q' || k === 'F10' || (ev.ctrl && k === 'c')) done(0);
    else if (k === 'M') sort = 'mem'; else if (k === 'P') sort = 'cpu'; else if (k === 'N') sort = 'pid';
    else if (k !== ' ' && k !== 'Enter') return k.length === 1 || undefined;
    draw();
    return true;
  });
  draw();
  timer = setInterval(draw, delay);
  const st = await new Promise(res => { done = res; });
  clearInterval(timer); pop(); term.exitAlt();
  return st;
};
def('top', topFn, { usage: 'top [-d secs]', desc: 'Display Linux processes.  q quit, M sort by memory, P sort by CPU.' });
def('htop', topFn, { usage: 'htop [-d secs]', desc: 'Interactive process viewer.  q or F10 quits.', pkg: 'htop' });

// ---------------------------------------------------------------- cmatrix / sl
async function animate(ctx, frame, ms, { anyKey = false } = {}) {
  const term = ctx.term, sc = term.enterAlt();
  let stop = false;
  sc.cursor.visible = false;
  const pop = term.pushHandler(ev => { if (anyKey || ev.key === 'q' || (ev.ctrl && ev.key === 'c')) stop = true; return true; });
  let t = 0;
  while (!stop) {
    if (frame(sc, t++) === false) break;
    sc.flush();
    await new Promise(r => setTimeout(r, ms));
    if (term.dead) break;
  }
  pop(); term.exitAlt();
  return 0;
}
def('cmatrix', ctx => {
  const term = ctx.term, bright = term.style({ fg: 15, b: true }), g = [term.style({ fg: 10, b: true }), term.style({ fg: 2 }), term.style({ fg: 2, dim: true })];
  const chars = 'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ0123456789@#$%&*+=<>';
  let drops = [];
  return animate(ctx, sc => {
    if (drops.length !== sc.cols) drops = Array.from({ length: sc.cols }, () => ({ y: -Math.floor(Math.random() * sc.rows * 2), len: 5 + Math.floor(Math.random() * sc.rows), speed: Math.random() < 0.3 ? 2 : 1 }));
    sc.clear();
    drops.forEach((d, x) => {
      if (x % 2) return;
      for (let i = 0; i < d.len; i++) { const y = d.y - i; if (y < 0 || y >= sc.rows) continue; sc.put(y, x, chars[Math.floor(Math.random() * chars.length)], i === 0 ? bright : g[i < 3 ? 0 : i < d.len - 3 ? 1 : 2]); }
      d.y += d.speed;
      if (d.y - d.len > sc.rows) { d.y = -Math.floor(Math.random() * 10); d.len = 5 + Math.floor(Math.random() * sc.rows); }
    });
  }, 70);
}, { usage: 'cmatrix', desc: 'Simulates the display from "The Matrix".  q or Ctrl+C quits.', pkg: 'cmatrix', games: true });

const TRAIN = ['          o O o', '        o', '     ___I_   _________   _________   _________', '    |  ___|  | []  [] |  | []  [] |  | []  [] |', '  __|_|___|__|________|__|________|__|________|', ' /-O=O=O--O-\' \'O----O\'  \'O----O\'  \'O----O\''];
const SMOKE = [['          o O o', '        o'], ['         O o  o', '       o'], ['        o  O o', '         o']];
def('sl', ctx => {
  const w = Math.max(...TRAIN.map(l => l.length));
  return animate(ctx, (sc, t) => {
    const x = sc.cols - t * 2, y = Math.max(0, Math.floor((sc.rows - TRAIN.length) / 2));
    if (x < -w) return false;
    sc.clear();
    const art = [...SMOKE[Math.floor(t / 3) % 3], ...TRAIN.slice(2)];
    art.forEach((l, i) => { const s = x < 0 ? l.slice(-x) : l; sc.put(y + i, Math.max(0, x), s.replace(/O/g, t % 2 ? 'O' : '0')); });
  }, 45);
}, { usage: 'sl', desc: 'Cure your bad habit of mistyping "ls": a steam locomotive crosses the screen.', pkg: 'sl', games: true });
export { basename };
