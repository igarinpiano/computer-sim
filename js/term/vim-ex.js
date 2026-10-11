// Vim: command line, Ex commands, search/substitute, options, syntax highlighting and help.
// Mixed into Vim.prototype by vim.js.

import { evalArith } from '../core/util.js';
import { dirname, basename } from '../core/vfs.js';

const ESC = '\x1b', CR = '\r', BS = '\x7f', TAB = '\t';
const [LEFT, RIGHT, UP, DOWN, HOME, END, , , DEL] = ['', '', '', '', '', '', '', '', ''];
const C = ch => String.fromCharCode(ch.charCodeAt(0) & 31);
const indentOf = s => /^[ \t]*/.exec(s)[0];
const firstNB = s => { const n = indentOf(s).length; return n >= s.length ? Math.max(0, s.length - 1) : n; };

export const INTRO = ['VIM - Vi IMproved', '', 'version 8.2.4919', 'by Bram Moolenaar et al.', 'Vim is open source and freely distributable', '', 'Help poor children in Uganda!', 'type  :help iccf<Enter>       for information ', '', 'type  :q<Enter>               to exit         ', 'type  :help<Enter>  or  <F1>  for on-line help', 'type  :help version8<Enter>   for version info'];

// [full name, minimum abbreviation length]; order matters for ambiguous prefixes.
const CMDS = [['substitute', 1], ['set', 2], ['setlocal', 4], ['split', 2], ['source', 2], ['sort', 3], ['syntax', 2], ['shell', 2], ['silent', 3], ['startinsert', 4], ['stopinsert', 5],
  ['edit', 1], ['echo', 2], ['enew', 3], ['buffer', 1], ['buffers', 7], ['bdelete', 2], ['bnext', 2], ['bNext', 2], ['bprevious', 2], ['bfirst', 2], ['blast', 2], ['brewind', 2],
  ['copy', 2], ['close', 3], ['colorscheme', 4], ['cd', 2], ['chdir', 3], ['delete', 1], ['display', 2], ['delmarks', 4], ['file', 1], ['files', 5], ['first', 3], ['filetype', 5],
  ['global', 1], ['help', 1], ['history', 3], ['highlight', 2], ['join', 1], ['jumps', 2], ['k', 1], ['list', 1], ['ls', 2], ['let', 3], ['last', 2], ['move', 1], ['mark', 2], ['marks', 5], ['map', 3], ['mapclear', 4],
  ['next', 1], ['new', 3], ['nmap', 2], ['nnoremap', 2], ['noremap', 2], ['nohlsearch', 3], ['normal', 4], ['number', 2], ['nunmap', 3], ['only', 2], ['print', 1], ['put', 2], ['pwd', 2], ['previous', 4],
  ['quit', 1], ['quitall', 5], ['qall', 2], ['read', 1], ['redo', 3], ['registers', 3], ['retab', 3], ['rewind', 3], ['t', 1], ['tabnew', 4], ['tabedit', 4], ['tabnext', 4], ['tabprevious', 4], ['tabclose', 4],
  ['undo', 1], ['unmap', 3], ['version', 2], ['vglobal', 1], ['vnew', 3], ['vsplit', 2], ['vmap', 2], ['vnoremap', 2], ['vunmap', 2], ['write', 1], ['wall', 2], ['wq', 2], ['wqall', 3], ['wnext', 2],
  ['xit', 1], ['xall', 2], ['yank', 1], ['imap', 2], ['inoremap', 3], ['iunmap', 2], ['cmap', 2], ['cnoremap', 3], ['Next', 1], ['args', 2], ['autocmd', 2], ['augroup', 3], ['runtime', 2], ['packadd', 3],
  ['scriptencoding', 7], ['if', 2], ['endif', 2], ['else', 2], ['function', 2], ['endfunction', 4], ['call', 3], ['command', 3], ['abbreviate', 2], ['iabbrev', 2], ['digraphs', 3], ['messages', 3], ['redraw', 4], ['terminal', 3], ['Explore', 2], ['wincmd', 4]];
function resolveCmd(name) {
  for (const [full, min] of CMDS) if (full.startsWith(name) && name.length >= min) return full;
  return CMDS.some(([f]) => f === name) ? name : null;
}
const OPTS = { number: 'nu', relativenumber: 'rnu', ignorecase: 'ic', smartcase: 'scs', hlsearch: 'hls', incsearch: 'is', wrap: 'wrap', list: 'list', tabstop: 'ts', shiftwidth: 'sw', softtabstop: 'sts', expandtab: 'et', autoindent: 'ai', smartindent: 'si', cindent: 'si', cursorline: 'cul', scrolloff: 'so', showmode: 'smd', ruler: 'ru', laststatus: 'ls', wrapscan: 'ws', showcmd: 'sc', hidden: 'hid', splitbelow: 'sb', splitright: 'spr', timeoutlen: 'tm', clipboard: 'cb', textwidth: 'tw', matchpairs: 'mps' };
const LONG = Object.fromEntries(Object.entries(OPTS).filter(([k]) => k !== 'cindent').map(([k, v]) => [v, k]));
const NOOP = new Set(['compatible', 'cp', 'backspace', 'bs', 'encoding', 'enc', 'fileencoding', 'fenc', 'fileencodings', 'fencs', 'mouse', 'background', 'bg', 'wildmenu', 'wmnu', 'wildmode', 'wim', 'showmatch', 'sm', 'autoread', 'ar', 'backup', 'bk', 'writebackup', 'wb', 'swapfile', 'swf', 'history', 'hi', 'belloff', 'bo', 'visualbell', 'vb', 'errorbells', 'eb', 't_Co', 'termguicolors', 'tgc', 'foldmethod', 'fdm', 'foldenable', 'fen', 'foldlevel', 'fdl', 'spell', 'paste', 'modeline', 'ml', 'modelines', 'mls', 'ttyfast', 'tf', 'lazyredraw', 'lz', 'magic', 'title', 'cmdheight', 'ch', 'numberwidth', 'nuw', 'linebreak', 'lbr', 'undofile', 'udf', 'nrformats', 'nf', 'fileformat', 'ff', 'fileformats', 'ffs', 'shortmess', 'shm', 'ttimeout', 'ttimeoutlen', 'ttm', 'display', 'dy', 'formatoptions', 'fo', 'complete', 'cpt', 'completeopt', 'cot', 'signcolumn', 'scl', 'updatetime', 'ut', 'colorcolumn', 'cc', 'listchars', 'lcs', 'showtabline', 'stal', 'statusline', 'stl', 'langmenu', 'guifont', 'gfn', 'guioptions', 'go', 'viminfo', 'vi', 'smarttab', 'sta', 'shiftround', 'sr', 'startofline', 'sol', 'confirm', 'cf', 'autowrite', 'aw', 'virtualedit', 've', 'sidescroll', 'ss', 'sidescrolloff', 'siso', 'whichwrap', 'ww', 'iskeyword', 'isk', 'path', 'pa', 'tags', 'tag', 'omnifunc', 'ofu', 'conceallevel', 'cole', 'cursorcolumn', 'cuc', 'emoji', 'ambiwidth', 'ambw', 'termencoding', 'tenc', 'secure', 'exrc', 'ex']);
const DEFAULTS = { nu: false, rnu: false, ic: false, scs: false, hls: false, is: true, wrap: true, list: false, ts: 8, sw: 8, sts: 0, et: false, ai: true, si: false, cul: false, so: 5, smd: true, ru: true, ls: 1, ws: true, sc: true, hid: false, sb: false, spr: false, tm: 1000, cb: '', tw: 0, mps: '(:),{:},[:]' };
const POSIX = { alpha: 'A-Za-z', digit: '0-9', alnum: 'A-Za-z0-9', upper: 'A-Z', lower: 'a-z', space: '\\s', blank: ' \\t', punct: '!-\\/:-@\\[-`{-~', xdigit: '0-9A-Fa-f' };

// Vim pattern -> { source, ic } for a JS RegExp.
export function vimRe(pat) {
  let out = '', mode = 'm', ic = null, i = 0, branch = true, ze = false;
  const lit = ch => ch.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
  const special = (ch, esc) => {   // is ch a metachar given whether it was backslash-escaped
    if (mode === 'v') return !esc;
    if (mode === 'V') return esc;
    return '.*[~'.includes(ch) ? !esc : esc;
  };
  while (i < pat.length) {
    let ch = pat[i++], esc = false;
    if (ch === '\\') {
      if (i >= pat.length) { out += '\\\\'; break; }
      ch = pat[i++]; esc = true;
      if (ch === 'v' || ch === 'm' || ch === 'M' || ch === 'V') { mode = ch === 'M' ? 'm' : ch; continue; }
      if (ch === 'c') { ic = true; continue; }
      if (ch === 'C') { ic = false; continue; }
      if (ch === 'z' && pat[i] === 's') { i++; out = `(?<=${out})`; continue; }
      if (ch === 'z' && pat[i] === 'e') { i++; out += '(?='; ze = true; continue; }
      if (ch === '%' && pat[i] === '(') { i++; out += '(?:'; branch = true; continue; }
      if (ch === '%' && pat[i] === '^') { i++; out += '^'; continue; }
      if (ch === '%' && pat[i] === '$') { i++; out += '$'; continue; }
      const cls = { d: '\\d', D: '\\D', w: '\\w', W: '\\W', s: '[ \\t]', S: '[^ \\t]', a: '[A-Za-z]', A: '[^A-Za-z]', l: '[a-z]', L: '[^a-z]', u: '[A-Z]', U: '[^A-Z]', x: '[0-9A-Fa-f]', X: '[^0-9A-Fa-f]', h: '[A-Za-z_]', H: '[^A-Za-z_]', i: '\\w', k: '\\w', f: '[\\w.\\/~-]', p: '[ -~]', o: '[0-7]', n: '\\n', t: '\\t', r: '\\r', e: '\\x1b', _: '' }[ch];
      if (cls !== undefined && !(mode === 'v' && false)) { out += cls; branch = false; continue; }
      if (/[1-9]/.test(ch)) { out += '\\' + ch; continue; }
    }
    const sp = '()|+?={<>@&%'.includes(ch) ? (mode === 'v' ? !esc : mode === 'V' ? esc && false || esc : esc) : special(ch, esc);
    if (!sp && !(ch === '^' || ch === '$' || ch === '*' || ch === '.' || ch === '[' || ch === '~')) { out += lit(ch); branch = false; continue; }
    switch (ch) {
      case '(': out += '('; branch = true; continue;
      case ')': out += ')'; break;
      case '|': out += '|'; branch = true; continue;
      case '+': out += '+'; break;
      case '?': case '=': out += '?'; break;
      case '<': case '>': out += '\\b'; break;
      case '&': case '@': case '%': out += lit(ch); break;
      case '{': {
        const j = pat.indexOf('}', i);
        if (j < 0) { out += '\\{'; break; }
        let body = pat.slice(i, j).replace(/\\$/, '');
        i = j + 1;
        const lazy = body[0] === '-'; if (lazy) body = body.slice(1);
        out += (body === '' ? '*' : body === '1,' ? '+' : `{${body.includes(',') && body.startsWith(',') ? '0' + body : body}}`) + (lazy ? '?' : '');
        break;
      }
      case '.': out += sp ? '.' : '\\.'; break;
      case '*': out += sp && !branch ? '*' : '\\*'; break;
      case '~': out += '~'; break;
      case '^': out += branch && !esc ? '^' : '\\^'; branch = false; continue;
      case '$': { const atEnd = i >= pat.length || pat.startsWith('\\|', i) || pat.startsWith('\\)', i) || (mode === 'v' && '|)'.includes(pat[i])); out += atEnd && !esc ? '$' : '\\$'; break; }
      case '[': {
        if (!sp) { out += '\\['; break; }
        let j = i;
        if (pat[j] === '^') j++;
        if (pat[j] === ']') j++;
        while (j < pat.length && pat[j] !== ']') { if (pat[j] === '\\') j++; else if (pat[j] === '[' && pat[j + 1] === ':') j = pat.indexOf(':]', j) + 1; j++; }
        if (j >= pat.length) { out += '\\['; break; }
        let body = pat.slice(i, j), neg = '';
        if (body[0] === '^') { neg = '^'; body = body.slice(1); }
        body = body.replace(/\[:(\w+):\]/g, (m, k) => POSIX[k] || '').replace(/^\]/, '\\]').replace(/\[/g, '\\[').replace(/\\([^\\\]^\-enrtbdswx])/g, '\\\\$1').replace(/\\e/g, '\\x1b');
        out += `[${neg}${body}]`; i = j + 1;
        break;
      }
      default: out += lit(ch);
    }
    branch = false;
  }
  if (ze) out += ')';
  return { source: out, ic };
}

// Parses the replacement part of :s into a function of the match array.
function subRep(rep, prev) {
  const toks = [];
  for (let i = 0; i < rep.length; i++) {
    const ch = rep[i];
    if (ch === '\\' && i + 1 < rep.length) {
      const d = rep[++i];
      if (/\d/.test(d)) toks.push({ g: +d }); else if (d === 'n') toks.push('\0'); else if (d === 'r') toks.push('\n'); else if (d === 't') toks.push('\t');
      else if ('uUlLeE'.includes(d)) toks.push({ c: d }); else toks.push(d);
    } else if (ch === '&') toks.push({ g: 0 }); else if (ch === '~') toks.push(prev || ''); else if (ch === '\r') toks.push('\n'); else toks.push(ch);
  }
  return m => {
    let out = '', once = null, run = null;
    for (const t of toks) {
      if (typeof t === 'object' && t.c) { if (t.c === 'u' || t.c === 'l') once = t.c; else if (t.c === 'U' || t.c === 'L') run = t.c; else run = null; continue; }
      let s = typeof t === 'string' ? t : m[t.g] ?? '';
      if (run) s = run === 'U' ? s.toUpperCase() : s.toLowerCase();
      if (once && s) { s = (once === 'u' ? s[0].toUpperCase() : s[0].toLowerCase()) + s.slice(1); once = null; }
      out += s;
    }
    return out;
  };
}

export const exMixin = {
  sourceRc() {
    const home = this.io.home || '/home/user';
    for (const f of ['.vimrc', '.vim/vimrc', '_vimrc']) {
      const n = this.fs.stat(home + '/' + f);
      if (n && n.t === 'f') { this.sourceText(n.d, f); return; }
    }
  },
  sourceText(text, name) {
    const errs = [];
    this.sourcing = true;
    text.split('\n').forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line[0] === '"') return;
      this.message = null; this.failed = false;
      this.ex(line);
      if (this.message && this.message.hl === this.hl.ErrorMsg) errs.push({ text: `line ${String(i + 1).padStart(4)}:`, hl: this.hl.ModeMsg }, { text: this.message.text, hl: this.hl.ErrorMsg });
    });
    this.sourcing = false; this.message = null; this.failed = false; this.ug = false; this.changed = false;
    if (errs.length) this.pager = { lines: [{ text: `Error detected while processing ${name}:`, hl: this.hl.ErrorMsg }, ...errs], off: 0 };
  },

  // ---- command line
  openCmd(type, text) {
    this.intro = false; this.message = null;
    const prev = this.mode;
    this.cmd = { type, text, pos: text.length, start: { ...this.cur }, top: this.w.top, prev, hi: null };
    this.mode = 'c';
  },
  cmdKey(k) {
    const cl = this.cmd, hist = this.hist[cl.type === ':' ? ':' : '/'];
    const cancel = () => { this.cur.l = cl.start.l; this.cur.c = cl.start.c; this.w.top = cl.top; this.mode = cl.prev; this.cmd = null; this.incMatch = null; this.opPending = null; };
    if (cl.lit) { cl.lit = false; cl.text = cl.text.slice(0, cl.pos) + k + cl.text.slice(cl.pos); cl.pos++; return; }
    if (cl.reg) {
      cl.reg = false;
      let t = '';
      if (k === C('w')) { const line = this.L[cl.start.l]; t = /[\w]*$/.exec(line.slice(0, cl.start.c))[0] + /^[\w]*/.exec(line.slice(cl.start.c))[0]; } else t = (this.getReg(k) || { t: '' }).t.replace(/\n/g, '\r');
      cl.text = cl.text.slice(0, cl.pos) + t + cl.text.slice(cl.pos); cl.pos += t.length;
      return this.incSearch();
    }
    if (k !== TAB) cl.tab = null;
    switch (k) {
      case ESC: case C('c'): return cancel();
      case CR: case '\n': {
        const { type, text } = cl;
        this.cur.l = cl.start.l; this.cur.c = cl.start.c; this.w.top = cl.top;
        this.mode = cl.prev; this.cmd = null; this.incMatch = null;
        if (text && hist.at(-1) !== text) hist.push(text);
        if (type === ':') { if (text.trim()) { if (!/^\s*@:/.test(text)) this.lastEx = text; this.exDepth = (this.exDepth || 0); this.ex(text); } }
        else this.doSearch(type, text);
        return;
      }
      case BS: case '\b': if (!cl.text) return cancel(); if (cl.pos > 0) { cl.text = cl.text.slice(0, cl.pos - 1) + cl.text.slice(cl.pos); cl.pos--; } break;
      case DEL: cl.text = cl.text.slice(0, cl.pos) + cl.text.slice(cl.pos + 1); break;
      case LEFT: cl.pos = Math.max(0, cl.pos - 1); return;
      case RIGHT: cl.pos = Math.min(cl.text.length, cl.pos + 1); return;
      case HOME: case C('b'): cl.pos = 0; return;
      case END: case C('e'): cl.pos = cl.text.length; return;
      case C('u'): cl.text = cl.text.slice(cl.pos); cl.pos = 0; break;
      case C('w'): { let p = cl.pos; while (p > 0 && cl.text[p - 1] === ' ') p--; while (p > 0 && cl.text[p - 1] !== ' ') p--; cl.text = cl.text.slice(0, p) + cl.text.slice(cl.pos); cl.pos = p; break; }
      case C('v'): case C('q'): cl.lit = true; return;
      case C('r'): cl.reg = true; return;
      case UP: case DOWN: case C('p'): case C('n'): {
        if (cl.hi === null) { cl.hi = hist.length; cl.prefix = cl.text; }
        let n = cl.hi;
        const d = k === UP || k === C('p') ? -1 : 1;
        do n += d; while (n >= 0 && n < hist.length && !hist[n].startsWith(cl.prefix));
        if (n < 0) return;
        cl.hi = Math.min(n, hist.length);
        cl.text = n >= hist.length ? cl.prefix : hist[n]; cl.pos = cl.text.length;
        break;
      }
      case TAB: return this.cmdComplete();
      default:
        if (k.charCodeAt(0) < 32 || (k.charCodeAt(0) >= 0xe000 && k.charCodeAt(0) < 0xe100)) return;
        cl.text = cl.text.slice(0, cl.pos) + k + cl.text.slice(cl.pos); cl.pos += k.length; cl.hi = null;
    }
    this.incSearch();
  },
  incSearch() {
    const cl = this.cmd;
    if (!cl || cl.type === ':' || !this.o.is) return;
    this.incMatch = null;
    this.cur.l = cl.start.l; this.cur.c = cl.start.c; this.w.top = cl.top;
    if (!cl.text) return;
    const quiet = this.message;
    const p = this.find(cl.text, cl.start, cl.type === '/', true);
    this.message = quiet; this.failed = false;
    if (p) { this.incMatch = p; this.cur.l = p.l; this.cur.c = p.c; }
  },
  cmdComplete() {
    const cl = this.cmd;
    if (cl.type !== ':') { cl.text = cl.text.slice(0, cl.pos) + '\t' + cl.text.slice(cl.pos); cl.pos++; return; }
    if (!cl.tab) {
      const before = cl.text.slice(0, cl.pos);
      const m = /^\s*(\S+)\s+(.*)$/.exec(before);
      let items, start;
      if (!m) { start = before.length - before.trimStart().length; const w = before.trim(); items = [...new Set(CMDS.map(c => c[0]))].filter(c => c.startsWith(w)).sort(); }
      else if (/^(se|set|setl|setlocal)$/.test(m[1])) { const w = /\S*$/.exec(m[2])[0]; start = before.length - w.length; items = Object.keys(OPTS).filter(o => o.startsWith(w.replace(/^no/, ''))).map(o => (w.startsWith('no') ? 'no' + o : o)); }
      else if (/^(h|help)$/.test(m[1])) { start = before.length - m[2].length; items = [...new Set([...HELP.join('\n').matchAll(/\*([^*\s]+)\*/g)].map(x => x[1]))].filter(t => t.startsWith(m[2])); }
      else if (/^(colo|colorscheme)$/.test(m[1])) { start = before.length - m[2].length; items = ['default', 'desert', 'elflord', 'murphy', 'slate'].filter(t => t.startsWith(m[2])); }
      else {
        const w = /\S*$/.exec(m[2])[0]; start = before.length - w.length;
        const slash = w.lastIndexOf('/'), dir = w.slice(0, slash + 1), pre = w.slice(slash + 1);
        const look = this.fs.abs((dir.replace(/^~/, this.io.home || '~')) || '.', this.cwd);
        try { items = this.fs.readdir(look).filter(n => n.startsWith(pre) && (pre.startsWith('.') || n[0] !== '.')).map(n => dir + n + (this.fs.isDir(look + '/' + n) ? '/' : '')); } catch { items = []; }
      }
      if (!items.length) return this.bell();
      cl.tab = { items, i: -1, start, tail: cl.text.slice(cl.pos) };
    }
    const t = cl.tab;
    t.i = (t.i + 1) % t.items.length;
    cl.text = cl.text.slice(0, t.start) + t.items[t.i] + t.tail; cl.pos = t.start + t.items[t.i].length;
    if (t.items.length > 1) { this.message = { text: t.items.join('  ').slice(0, this.sc.cols - 2), hl: null, keep: true }; }
  },

  // ---- searching
  regex(pat, flags = '') {
    const { source, ic } = vimRe(pat);
    const insens = ic ?? (this.o.ic && !(this.o.scs && /[A-Z]/.test(pat.replace(/\\./g, ''))));
    return new RegExp(source, flags + (insens ? 'i' : ''));
  },
  // Next match after (or before) `from`. Returns { l, c, n } or null.
  find(pat, from, fwd, quiet) {
    let re;
    try { re = this.regex(pat, 'g'); } catch { if (!quiet) this.err(`E486: Pattern not found: ${pat}`); return null; }
    const L = this.L, n = L.length;
    const all = l => { const out = []; re.lastIndex = 0; let m; while ((m = re.exec(L[l]))) { out.push({ l, c: m.index, n: m[0].length }); if (!m[0]) re.lastIndex++; if (re.lastIndex > L[l].length) break; } return out; };
    for (let i = 0; i <= n; i++) {
      const l = ((from.l + (fwd ? i : -i)) % n + n) % n;
      let hits = all(l);
      if (i === 0) hits = hits.filter(h => (fwd ? h.c > from.c : h.c < from.c));
      else if (i === n) hits = hits.filter(h => (fwd ? h.c <= from.c : h.c >= from.c));
      if (!hits.length) continue;
      const hit = fwd ? hits[0] : hits.at(-1);
      const wrapped = fwd ? l < from.l || i === n : l > from.l || i === n;
      if (wrapped) {
        if (!this.o.ws) { if (!quiet) this.err(`E38${fwd ? 5 : 4}: Search hit ${fwd ? 'BOTTOM' : 'TOP'} without match for: ${pat}`); return null; }
        if (!quiet) this.msg(fwd ? 'search hit BOTTOM, continuing at TOP' : 'search hit TOP, continuing at BOTTOM', this.hl.WarningMsg);
      }
      if (hit.c >= L[l].length && L[l].length) hit.c = L[l].length - 1;
      return hit;
    }
    if (!quiet) this.err(`E486: Pattern not found: ${pat}`);
    return null;
  },
  doSearch(type, text) {
    const fwd = type === '/';
    // "/pat/e" style offsets
    let pat = text, off = '';
    const m = new RegExp(`^((?:\\\\.|[^\\\\${fwd ? '/' : '?'}])*)\\${fwd ? '/' : '?'}(.*)$`).exec(text);
    if (m) { pat = m[1]; off = m[2]; }
    if (!pat) { if (!this.search) { this.opPending = null; return this.err('E35: No previous regular expression'); } pat = this.search.pat; }
    this.search = { pat, fwd }; this.hlOff = false;
    const op = this.opPending; this.opPending = null;
    const p = this.find(pat, this.cur, fwd);
    if (!p) return;
    const mv = { l: p.l, c: p.c, jump: true };
    let om;
    if ((om = /^([esb]?)([+-]\d*)?$/.exec(off)) && off) {
      const n = om[2] ? parseInt(om[2] === '+' || om[2] === '-' ? om[2] + '1' : om[2], 10) : 0;
      if (om[1] === 'e') { mv.c = p.c + Math.max(0, p.n - 1) + n; mv.inc = true; } else if (om[1]) mv.c = p.c + n;
      else { mv.l = Math.max(0, Math.min(this.L.length - 1, p.l + n)); mv.c = firstNB(this.L[mv.l]); mv.lw = true; }
    }
    if (op) { this.execOp({ ...op, target: mv }); return; }
    this.moveTo(mv);
    if (this.message?.hl !== this.hl.WarningMsg) this.msg(type + text);
  },

  // ---- ex
  ex(text) {
    this.exDepth = (this.exDepth || 0) + 1;
    try { this.exLine(text); } finally { this.exDepth--; }
  },
  parseRange(p) {
    const L = this.L, last = L.length - 1;
    const addrs = [];
    let base = this.cur.l;
    const ws = () => { while (p.s[p.i] === ' ') p.i++; };
    for (;;) {
      ws();
      let a = null, any = false;
      const ch = p.s[p.i];
      if (ch === '%') { p.i++; addrs.push(0, last); any = true; ws(); if (p.s[p.i] === ',' || p.s[p.i] === ';') { p.i++; continue; } break; }
      if (/\d/.test(ch || '')) { let s = ''; while (/\d/.test(p.s[p.i] || '')) s += p.s[p.i++]; a = +s - 1; any = true; }
      else if (ch === '.') { p.i++; a = base; any = true; }
      else if (ch === '$') { p.i++; a = last; any = true; }
      else if (ch === "'") { const m = this.getMark(p.s[p.i + 1] || ''); if (!m) throw new Error('E20: Mark not set'); a = m.l; p.i += 2; any = true; }
      else if (ch === '/' || ch === '?') {
        let j = p.i + 1, pat = '';
        while (j < p.s.length && p.s[j] !== ch) { if (p.s[j] === '\\' && j + 1 < p.s.length) pat += p.s[j++]; pat += p.s[j++]; }
        p.i = Math.min(p.s.length, j + 1);
        if (!pat) pat = this.search?.pat || '';
        const hit = this.find(pat, ch === '/' ? { l: base, c: 1e9 } : { l: base, c: -1 }, ch === '/', true);
        if (!hit) throw new Error(`E486: Pattern not found: ${pat}`);
        this.search = { pat, fwd: ch === '/' };
        a = hit.l; any = true;
      }
      for (;;) {
        ws();
        const m = /^([+-])(\d*)/.exec(p.s.slice(p.i));
        if (!m) break;
        p.i += m[0].length;
        if (a === null) a = base;
        a += (m[1] === '+' ? 1 : -1) * (m[2] === '' ? 1 : +m[2]); any = true;
      }
      if (any) addrs.push(a);
      ws();
      if (p.s[p.i] === ',' || p.s[p.i] === ';') { if (!any) addrs.push(base); if (p.s[p.i] === ';' && a !== null) base = Math.max(0, Math.min(last, a)); p.i++; ws(); if (p.i >= p.s.length || /[A-Za-z!<>&=]/.test(p.s[p.i])) { addrs.push(base); break; } continue; }
      break;
    }
    if (!addrs.length) return { n: 0, l1: this.cur.l, l2: this.cur.l };
    let l2 = addrs.at(-1), l1 = addrs.length > 1 ? addrs.at(-2) : l2;
    if (l1 > l2) [l1, l2] = [l2, l1];
    return { n: Math.min(2, addrs.length), l1: Math.max(0, Math.min(last, l1)), l2: Math.max(0, Math.min(last, l2)), raw: addrs.at(-1) };
  },
  expandName(s) {
    return s.replace(/\\ /g, '\x00').replace(/(^|[^\\])%(:[a-z])*/g, (m, a) => a + (this.b.name || '')).replace(/(^|[^\\])#/g, (m, a) => a + (this.alt?.name || '')).replace(/^~/, this.io.home || '~').replace(/\x00/g, ' ').replace(/\\([%#])/g, '$1');
  },

  exLine(text) {
    text = text.replace(/^[\s:]+/, '');
    if (!text || text[0] === '"') return;
    const p = { s: text, i: 0 };
    let r;
    try { r = this.parseRange(p); } catch (e) { return this.err(e.message); }
    let rest = text.slice(p.i).replace(/^\s+/, '');
    if (!rest) {
      if (r.n) { this.pushJump(); this.cur.l = Math.max(0, Math.min(this.L.length - 1, r.raw)); this.cur.c = firstNB(this.line); }
      return;
    }
    let m = /^([A-Za-z]+|[!&<>=#@~])(.*)$/s.exec(rest);
    if (!m) return this.err(`E492: Not an editor command: ${rest}`);
    let name = m[1], arg = m[2];
    // ":s/a/b/", ":g/x/d", ":k a": the name stops where the delimiter starts
    if (/^[A-Za-z]/.test(name) && !resolveCmd(name)) {
      for (const short of ['s', 'g', 'v', 'k', 'd', 't', 'm', 'y', 'j', 'b', 'w', 'e', 'r', 'co', 'pu', 'norm', 'normal']) {
        if (name.startsWith(short) && name.length > short.length && (short.length > 1 || !resolveCmd(name))) {
          const tail = name.slice(short.length);
          if ((short === 's' && /^[gciIne&r]+$/.test(tail)) || (short !== 's' && short.length === 1 && /^[a-z"*+]$/.test(tail) && 'dykmtj'.includes(short)) || /^\d+$/.test(tail)) { name = short; arg = tail + arg; break; }
        }
      }
    }
    let bang = false;
    if (/^[A-Za-z]/.test(name) && arg[0] === '!') { bang = true; arg = arg.slice(1); }
    const full = /^[A-Za-z]/.test(name) ? resolveCmd(name) : name;
    if (!full) return this.err(`E492: Not an editor command: ${rest}`);
    // "|" separates commands, except where it belongs to the argument
    let next = null;
    if (!['global', 'vglobal', 'normal', '!', 'map', 'nmap', 'imap', 'vmap', 'cmap', 'noremap', 'nnoremap', 'inoremap', 'vnoremap', 'cnoremap', 'autocmd', 'command'].includes(full) && !(full === 'write' && /^\s*!/.test(arg)) && !(full === 'read' && /^\s*!/.test(arg))) {
      let q = null;
      for (let i = 0; i < arg.length; i++) {
        const ch = arg[i];
        if (ch === '\\') { i++; continue; }
        if (full === 'echo' || full === 'let') { if (q) { if (ch === q) q = null; continue; } if (ch === '"' || ch === "'") { q = ch; continue; } }
        if (ch === '|') { next = arg.slice(i + 1); arg = arg.slice(0, i); break; }
      }
    }
    const a = arg.trim();
    this.exCmd(full, a, bang, r, arg);
    if (next !== null && !this.dead && !this.failed) this.exLine(next);
  },

  exCmd(cmd, a, bang, r, rawArg) {
    const { cur } = this, L = this.L, last = L.length - 1, b = this.b;
    const whole = r.n ? r : { l1: 0, l2: last, n: 0 };
    const lineCount = r.l2 - r.l1 + 1;
    const dest = s => { const p = { s, i: 0 }; const x = this.parseRange(p); return s.trim() === '0' ? -1 : x.raw ?? x.l2; };
    const others = () => this.wins().filter(w => w !== this.w && w.buf === b).length > 0;
    const canLeave = () => { if (b.mod && !bang && !this.o.hid && !others() && !b.help) { this.err('E37: No write since last change (add ! to override)'); return false; } return true; };
    const switchTo = buf => { if (buf === b) return; this.alt = b; b.marks['"'] = { l: cur.l, c: cur.c }; this.pushJump(); this.w.buf = buf; const m = buf.marks['"']; this.w.cur = { l: m ? Math.min(buf.lines.length - 1, m.l) : 0, c: m ? m.c : 0 }; this.w.top = 0; if (buf.loadMsg && !this.sourcing) this.msg(buf.name ? `"${buf.name}"${buf.mod ? ' [Modified]' : ''} ${buf.lines.length} line${buf.lines.length === 1 ? '' : 's'} --${Math.floor(((this.w.cur.l + 1) * 100) / buf.lines.length)}%--` : ''); };
    const listed = () => this.bufs.filter(x => !x.help);
    switch (cmd) {
      case 'write': case 'wq': case 'xit': case 'wall': case 'wqall': case 'xall': case 'wnext': {
        if (cmd === 'wall' || cmd === 'wqall' || cmd === 'xall') {
          for (const x of listed()) if (x.mod || cmd === 'wall') { if (!x.name) { if (x.mod) return this.err(`E141: No file name for buffer ${x.id}`); continue; } if (!this.writeBuf(x, null, { force: bang })) return; }
          return cmd === 'wall' ? undefined : this.quit();
        }
        if (/^!/.test(a)) return this.shellOut(a.slice(1).trim(), { stdin: L.slice(whole.l1, whole.l2 + 1).join('\n') + '\n' });
        let append = false, name = a;
        if (name.startsWith('>>')) { append = true; name = name.slice(2).trim(); }
        name = this.expandName(name);
        if (cmd === 'xit' && !b.mod && !name) return this.exCmd('quit', '', bang, { n: 0 }, '');
        if (!this.writeBuf(b, name || null, { force: bang, l1: whole.l1, l2: whole.l2, append })) return;
        if (cmd === 'wq' || cmd === 'xit') return this.exCmd('quit', '', bang, { n: 0 }, '');
        if (cmd === 'wnext') return this.exCmd('next', '', bang, { n: 0 }, '');
        return;
      }
      case 'quit': case 'close': {
        if (this.wins().length > 1) { if (!canLeave()) return; this.closeWin(this.w); return; }
        if (cmd === 'close') return this.err('E444: Cannot close last window');
        if (!bang) {
          if (b.mod && !b.help) return this.err('E37: No write since last change (add ! to override)');
          const other = listed().find(x => x.mod);
          if (other) return this.err(`E162: No write since last change for buffer "${other.name || '[No Name]'}"`);
          if (this.args.length > 1 && this.argi < this.args.length - 1 && !this.warnedArgs) { this.warnedArgs = true; return this.err(`E173: ${this.args.length - 1 - this.argi} more file${this.args.length - 1 - this.argi > 1 ? 's' : ''} to edit`); }
        }
        return this.quit();
      }
      case 'quitall': case 'qall': {
        const other = !bang && listed().find(x => x.mod);
        if (other) return this.err(`E37: No write since last change\nE162: No write since last change for buffer "${other.name || '[No Name]'}"`.split('\n')[other === b ? 0 : 1]);
        return this.quit();
      }
      case 'only': for (const w of this.wins()) if (w !== this.w) this.closeWin(w); return;
      case 'edit': case 'enew': {
        if (cmd === 'enew' || (!a && !b.name)) { if (cmd === 'enew') { if (!canLeave()) return; switchTo(this.newBuf()); } return; }
        if (!a) {
          if (!bang && b.mod) return this.err('E37: No write since last change (add ! to override)');
          const pos = { ...cur }; this.bufs.splice(this.bufs.indexOf(b), 1);
          const nb = this.loadFile(b.name); nb.id = b.id; this.w.buf = nb; for (const w of this.wins()) if (w.buf === b) w.buf = nb;
          cur.l = Math.min(nb.lines.length - 1, pos.l); cur.c = pos.c; return this.msg(nb.loadMsg);
        }
        const name = this.expandName(a);
        if (!name) return this.err('E23: No alternate file');
        const target = this.bufs.find(x => x.path === this.fs.abs(name, this.cwd));
        if (target !== b && !canLeave()) return;
        const nb = this.loadFile(name);
        switchTo(nb);
        if (nb.loadMsg) this.msg(nb.loadMsg);
        return;
      }
      case 'buffer': case 'bnext': case 'bprevious': case 'bNext': case 'bfirst': case 'blast': case 'brewind': {
        const bl = listed(), i = bl.indexOf(b);
        let t;
        if (cmd === 'bnext') t = bl[(i + 1) % bl.length]; else if (cmd === 'bprevious' || cmd === 'bNext') t = bl[(i - 1 + bl.length) % bl.length];
        else if (cmd === 'bfirst' || cmd === 'brewind') t = bl[0]; else if (cmd === 'blast') t = bl.at(-1);
        else if (a === '#') t = this.alt; else if (/^\d+$/.test(a) || r.n) t = bl.find(x => x.id === (+a || r.l2 + 1)); else if (a) { const hits = bl.filter(x => x.name.includes(a)); if (hits.length > 1) return this.err(`E93: More than one match for ${a}`); t = hits[0]; } else return;
        if (!t) return this.err(a === '#' ? 'E23: No alternate file' : /^\d+$/.test(a) ? `E86: Buffer ${a} does not exist` : `E94: No matching buffer for ${a}`);
        if (t !== b && !canLeave()) return;
        switchTo(t); return;
      }
      case 'bdelete': {
        const t = a ? listed().find(x => x.id === +a || x.name === a) : b;
        if (!t) return this.err(`E516: No buffers were deleted: bdelete ${a}`);
        if (t.mod && !bang) return this.err(`E89: No write since last change for buffer ${t.id} (add ! to override)`);
        let repl = listed().find(x => x !== t);
        if (!repl) repl = this.newBuf();
        for (const w of this.wins()) if (w.buf === t) { w.buf = repl; w.cur = { l: 0, c: 0 }; w.top = 0; }
        this.bufs.splice(this.bufs.indexOf(t), 1);
        if (this.alt === t) this.alt = null;
        return;
      }
      case 'ls': case 'buffers': case 'files':
        return this.showLines(listed().map(x => `${String(x.id).padStart(3)} ${x === b ? '%' : x === this.alt ? '#' : ' '}${this.wins().some(w => w.buf === x) ? 'a' : 'h'} ${x.mod ? '+' : ' '} ${`"${x.name || '[No Name]'}"`.padEnd(30)} line ${x === b ? cur.l + 1 : (x.marks['"']?.l ?? 0) + 1}`));
      case 'args': return this.msg(this.args.map((f, i) => (i === this.argi ? `[${f}]` : f)).join(' '));
      case 'next': case 'previous': case 'Next': case 'first': case 'rewind': case 'last': {
        const n = cmd === 'next' ? this.argi + 1 : cmd === 'first' || cmd === 'rewind' ? 0 : cmd === 'last' ? this.args.length - 1 : this.argi - 1;
        if (n >= this.args.length) return this.err(this.args.length > 1 ? 'E165: Cannot go beyond last file' : 'E163: There is only one file to edit');
        if (n < 0) return this.err(this.args.length > 1 ? 'E164: Cannot go before first file' : 'E163: There is only one file to edit');
        if (!canLeave()) return;
        this.argi = n; const nb = this.loadFile(this.args[n]); switchTo(nb); if (nb.loadMsg) this.msg(nb.loadMsg);
        return;
      }
      case 'split': case 'vsplit': case 'new': case 'vnew': {
        let buf = null;
        if (cmd === 'new' || cmd === 'vnew') buf = a ? this.loadFile(this.expandName(a)) : this.newBuf();
        else if (a) buf = this.loadFile(this.expandName(a));
        const min = cmd[0] === 'v' ? 3 : 2;
        if ((cmd[0] === 'v' ? this.w.rect.w : this.w.rect.h) < min * 2) return this.err('E36: Not enough room');
        const nw = this.splitWin(cmd[0] === 'v', buf);
        if (buf) { nw.cur = { l: 0, c: 0 }; nw.top = 0; if (buf.loadMsg) this.msg(buf.loadMsg); }
        return;
      }
      case 'wincmd': return this.winCmd(a[0], 1, false);
      case 'tabnew': case 'tabedit': case 'tabnext': case 'tabprevious': case 'tabclose': return this.err('Tab pages are not available in this build — use :split / :vsplit or :e');
      case 'read': {
        const at = r.n ? (r.raw < 0 ? -1 : r.l2) : cur.l;
        if (/^!/.test(a)) return this.shellOut(a.slice(1).trim(), { read: at });
        const name = this.expandName(a) || b.name;
        if (!name) return this.err('E32: No file name');
        let text;
        try { text = this.fs.read(this.fs.abs(name, this.cwd)); } catch { return this.err(`E484: Can't open file ${name}`); }
        const ls = text.replace(/\n$/, '').split('\n');
        this.insertLines(at + 1, ls); cur.l = at + 1; cur.c = firstNB(this.line);
        return this.msg(`"${name}" ${ls.length}L, ${new Blob([text]).size}B`);
      }
      case '!': {
        if (!a) return this.err('E471: Argument required');
        if (r.n) return this.shellOut(a, { filter: [r.l1, r.l2] });
        return this.shellOut(a, {});
      }
      case 'shell': case 'terminal': return this.err('E-: :shell is not available here — use :!cmd, or :w and exit');
      case 'substitute': case '&': case '~': return this.substitute(r, cmd === 'substitute' ? rawArg.replace(/^\s+(?=\w*$)/, '') : cmd === '&' ? (a.startsWith('&') ? a : '') : a, cmd !== 'substitute');
      case 'global': case 'vglobal': return this.global(whole, a, cmd === 'vglobal' || bang);
      case 'delete': case 'yank': {
        const m = /^(?:"?([a-zA-Z0-9"*+_-]))?\s*(\d+)?$/.exec(a);
        if (!m) return this.err('E488: Trailing characters');
        let l1 = r.l1, l2 = r.l2;
        if (m[2]) { l1 = r.l2; l2 = Math.min(last, r.l2 + +m[2] - 1); }
        const rng = { s: { l: l1, c: 0 }, e: { l: l2, c: 0 }, lw: true };
        if (cmd === 'delete') { cur.l = l1; this.applyOp('d', rng, m[1] || null); } else { const keep = { ...cur }; this.applyOp('y', rng, m[1] || null); cur.l = keep.l; cur.c = keep.c; }
        return;
      }
      case 'put': { const reg = a.replace(/^"/, '') || null; if (r.n) cur.l = r.raw < 0 ? 0 : r.l2; return this.doPutLines(reg, bang || (r.n && r.raw < 0)); }
      case 'copy': case 't': case 'move': {
        let d;
        try { d = dest(a); } catch (e) { return this.err(e.message); }
        if (a === '') return this.err('E14: Invalid address');
        const ls = L.slice(r.l1, r.l2 + 1);
        if (cmd === 'move') {
          if (d >= r.l1 && d < r.l2) return this.err('E134: Cannot move a range of lines into itself');
          if (d === r.l2 || d === r.l1 - 1) { cur.l = r.l2; return; }
          this.touch(); this.b.lines.splice(r.l1, ls.length);
          const at = d > r.l2 ? d - ls.length + 1 : d + 1;
          this.b.lines.splice(at, 0, ...ls);
          cur.l = at + ls.length - 1; cur.c = firstNB(this.line);
          if (ls.length > 2) this.msg(`${ls.length} lines moved`);
        } else { this.insertLines(d + 1, ls); cur.l = d + ls.length; cur.c = firstNB(this.line); if (ls.length > 2) this.msg(`${ls.length} more lines`); }
        return;
      }
      case 'join': { const l2 = r.n < 2 ? Math.min(last, r.l1 + Math.max(1, (+a || 2) - 1)) : r.l2; if (r.l1 >= last) return; return this.join(r.l1, Math.max(r.l1 + 1, l2), !bang); }
      case '>': case '<': { const n = 1 + (/^[<>]*/.exec(a)[0].length); for (let l = r.l1; l <= r.l2; l++) this.shiftLine(l, cmd === '>' ? n : -n, true); cur.l = r.l2; cur.c = firstNB(this.line); if (lineCount > 2) this.msg(`${lineCount} lines ${cmd}ed ${n} time${n > 1 ? 's' : ''}`); return; }
      case 'normal': {
        if (!a) return this.err('E471: Argument required');
        const keys = rawArg.replace(/^ /, '');
        const run = () => { for (const ch of keys) { if (this.dead) return; this.handle(ch); } for (let i = 0; i < 3 && (this.mode !== 'n' || this.pend); i++) this.handle(ESC); this.failed = false; };
        const saveRec = this.rec;
        if (!r.n) run();
        else {
          // track target lines with marks so edits that add/remove lines do not derail the loop
          for (let l = r.l1; l <= r.l2; l++) b.marks[`n#${l}`] = { l, c: 0 };
          for (let l = r.l1; l <= r.l2; l++) { const m = b.marks[`n#${l}`]; if (!m) continue; delete b.marks[`n#${l}`]; this.cur.l = Math.min(this.L.length - 1, m.l); this.cur.c = 0; run(); }
        }
        this.rec = saveRec;
        return;
      }
      case 'print': case 'number': case '#': case 'list': case 'k': case 'mark': {
        if (cmd === 'k' || cmd === 'mark') { if (!/^[a-zA-Z'`[\]<>]$/.test(a)) return this.err('E191: Argument must be a letter or forward/backward quote'); b.marks[a] = { l: r.l2, c: 0 }; return; }
        const w = String(L.length).length, out = [];
        for (let l = r.l1; l <= r.l2; l++) out.push({ text: (cmd === 'number' || cmd === '#' || this.o.nu ? String(l + 1).padStart(Math.max(3, w)) + ' ' : '') + (cmd === 'list' ? L[l].replace(/\t/g, '^I') + '$' : L[l]), hl: null });
        cur.l = r.l2; cur.c = firstNB(this.line);
        return this.showLines(out.map(o => o.text));
      }
      case '=': return this.msg(String(r.n ? r.l2 + 1 : L.length));
      case 'set': case 'setlocal': return this.setOpts(a);
      case 'nohlsearch': this.hlOff = true; return;
      case 'syntax': if (/^(on|enable)$/.test(a)) this.o.syn = true; else if (a === 'off' || a === 'clear') this.o.syn = false; else if (!a) this.msg(this.o.syn ? 'syntax on' : 'syntax off'); return;
      case 'colorscheme': if (!a) return this.msg(this.scheme); if (!this.setScheme(a)) return this.err(`E185: Cannot find color scheme '${a}'`); return;
      case 'registers': case 'display': {
        const out = [{ text: 'Type Name Content', hl: this.hl.Title }];
        const names = ['"', ...'0123456789', '-', ...'abcdefghijklmnopqrstuvwxyz', '+', '.', ':', '%', '/'];
        for (const n of names) {
          if (a && !a.includes(n)) continue;
          const reg = n === '"' ? this.regs['"'] : this.getReg(n);
          if (!reg || reg.t === '') continue;
          out.push(`  ${reg.k}  "${n}   ${(reg.t.replace(/\n/g, '^J').replace(/\x1b/g, '^[').replace(/\r/g, '^M').replace(/\t/g, '^I') + (reg.k === 'l' ? '^J' : '')).slice(0, this.sc.cols - 12)}`);
        }
        return this.showLines(out);
      }
      case 'marks': {
        const out = [{ text: 'mark line  col file/text', hl: this.hl.Title }];
        const row = (n, m, t) => out.push(` ${n} ${String(m.l + 1).padStart(6)} ${String(m.c).padStart(4)} ${t}`);
        for (const [n, m] of Object.entries(b.marks).sort()) if (n.length === 1 && (!a || a.includes(n)) && m.l < L.length) row(n, { l: m.l, c: Math.min(m.c, 999) }, L[m.l].trim().slice(0, 50));
        for (const [n, m] of Object.entries(this.gmarks || {})) row(n, m, m.buf.name);
        return this.showLines(out);
      }
      case 'delmarks': if (bang) { for (const k of Object.keys(b.marks)) if (/^[a-z]$/.test(k)) delete b.marks[k]; } else for (const k of a.replace(/\s/g, '')) { delete b.marks[k]; if (this.gmarks) delete this.gmarks[k]; } return;
      case 'jumps': return this.showLines([{ text: ' jump line  col file/text', hl: this.hl.Title }, ...this.jumps.map((j, i) => `${String(Math.abs(this.jidx - i)).padStart(4)} ${String(j.l + 1).padStart(5)} ${String(j.c).padStart(4)} ${j.buf === b ? (L[j.l] || '').trim().slice(0, 50) : j.buf.name}`), '>']);
      case 'history': return this.showLines([{ text: '      #  cmd history', hl: this.hl.Title }, ...this.hist[':'].slice(-30).map((h, i, arr) => `${i === arr.length - 1 ? '>' : ' '}${String(this.hist[':'].length - arr.length + i + 1).padStart(6)}  ${h}`)]);
      case 'messages': return;
      case 'undo': return this.undo(1);
      case 'redo': return this.redo(1);
      case 'help': return this.help(a);
      case 'version': return this.showLines(['VIM - Vi IMproved 8.2 (2019 Dec 12, compiled Oct 11 2026 13:35:00)', 'Included patches: 1-4919', 'Modified by the browser sandbox team', 'Huge version without GUI.  Features included (+) or not (-):', '+autoindent  +clipboard  +cmdline_hist  +ex_extra  +incsearch  +jumplist  +listcmds', '+multi_byte  +registers  +search  +smartindent  +syntax  +textobjects  +visual', '+visualextra  +windows  +wrapscan  -folding  -python3  -tabpages  -terminal', '   system vimrc file: "$VIM/vimrc"', '     user vimrc file: "$HOME/.vimrc"']);
      case 'source': { const name = this.expandName(a); let t; try { t = this.fs.read(this.fs.abs(name, this.cwd)); } catch { return this.err(`E484: Can't open file ${a}`); } return this.sourceText(t, name); }
      case 'cd': case 'chdir': { const t = this.fs.abs(this.expandName(a) || this.io.home || '/', this.cwd); if (!this.fs.isDir(t)) return this.err("E344: Can't find directory \"" + a + '" in cdpath'); this.cwd = t; return this.msg(t); }
      case 'pwd': return this.msg(this.cwd);
      case 'file': if (!a) return this.fileInfo(); b.name = this.expandName(a); b.path = this.fs.abs(b.name, this.cwd); return this.fileInfo();
      case 'sort': {
        const ls = L.slice(whole.l1, whole.l2 + 1), num = /n/.test(a), key = s => { if (num) { const m = /-?\d+/.exec(s); return m ? +m[0] : -Infinity; } return /i/.test(a) ? s.toLowerCase() : s; };
        let out = ls.map((s, i) => [key(s), i, s]).sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : x[1] - y[1])).map(x => x[2]);
        if (bang) out.reverse();
        if (/u/.test(a)) out = out.filter((s, i) => i === 0 || key(s) !== key(out[i - 1]));
        this.touch(); this.b.lines.splice(whole.l1, ls.length, ...out); cur.l = whole.l1; cur.c = 0;
        if (out.length < ls.length && ls.length - out.length > 2) this.msg(`${ls.length - out.length} fewer lines`);
        return;
      }
      case 'retab': {
        const ts = this.o.ts;
        for (let l = whole.l1; l <= whole.l2; l++) {
          const ind = indentOf(L[l]);
          if (!ind) continue;
          let w = 0; for (const ch of ind) w = ch === '\t' ? w + ts - (w % ts) : w + 1;
          const ni = this.o.et ? ' '.repeat(w) : bang ? '\t'.repeat(Math.floor(w / ts)) + ' '.repeat(w % ts) : ind;
          if (ni !== ind) this.setLine(l, ni + L[l].slice(ind.length));
        }
        return;
      }
      case 'startinsert': return this.startInsert(bang ? 'A' : 'i', 1);
      case 'stopinsert': return;
      case 'echo': {
        if (!a) return;
        const parts = a.match(/"(?:\\.|[^"])*"|'[^']*'|\S+/g) || [];
        try {
          return this.showLines([parts.map(x => (x[0] === '"' ? x.slice(1, -1).replace(/\\n/g, '\n').replace(/\\(.)/g, '$1') : x[0] === "'" ? x.slice(1, -1) : x[0] === '&' ? String(this.o[OPTS[x.slice(1)] || x.slice(1)] ?? '') : x[0] === '@' ? (this.getReg(x[1])?.t ?? '') : x[0] === '$' ? (this.io.env?.[x.slice(1)] ?? '') : /^(line|col)\(['"]\.['"]\)$/.test(x) ? String(x.startsWith('line') ? cur.l + 1 : cur.c + 1) : String(evalArith(x, { int: !/[.]/.test(x) })))).join(' ')]);
        } catch { return this.err(`E121: Undefined variable: ${a.split(/\W/)[0] || a}`); }
      }
      case 'let': { const m = /^(?:g:)?mapleader\s*=\s*["'](.*)["']$/.exec(a); if (m) this.leader = m[1].replace(/\\<space>/i, ' ').replace(/\\\\/, '\\'); return; }
      case 'map': case 'nmap': case 'imap': case 'vmap': case 'cmap': case 'noremap': case 'nnoremap': case 'inoremap': case 'vnoremap': case 'cnoremap': {
        const modes = cmd[0] === 'n' && cmd !== 'noremap' ? ['n'] : cmd[0] === 'i' ? ['i'] : cmd[0] === 'v' ? ['v'] : cmd[0] === 'c' ? ['c'] : bang ? ['i', 'c'] : ['n', 'v'];
        const m = /^(?:<(?:silent|buffer|expr|nowait|unique)>\s*)*(\S+)\s+(.*)$/i.exec(rawArg.trim());
        if (!m) {
          const out = [];
          for (const md of modes) for (const [l, rhs] of Object.entries(this.maps[md])) out.push(`${md}  ${this.keyNames(l).padEnd(12)} ${this.keyNames(rhs)}`);
          return this.showLines(out.length ? out : ['No mapping found']);
        }
        const lhs = this.parseKeys(m[1]), rhs = this.parseKeys(m[2].replace(/^<(silent|buffer|expr)>\s*/i, ''));
        if (!lhs) return;
        for (const md of modes) this.maps[md][lhs] = rhs;
        return;
      }
      case 'unmap': case 'nunmap': case 'iunmap': case 'vunmap': { const lhs = this.parseKeys(a); let ok = false; for (const md of cmd[0] === 'n' ? ['n'] : cmd[0] === 'i' ? ['i'] : cmd[0] === 'v' ? ['v'] : ['n', 'v']) { if (this.maps[md][lhs] !== undefined) ok = true; delete this.maps[md][lhs]; } if (!ok) return this.err('E31: No such mapping'); return; }
      case 'mapclear': for (const md of bang ? ['i', 'c'] : ['n', 'v']) this.maps[md] = {}; return;
      case 'silent': return this.exLine(a);
      case 'redraw': return;
      case 'Explore': return this.err('E-: the netrw file browser is not included; use :e <Tab> to complete file names');
      case 'filetype': case 'highlight': case 'autocmd': case 'augroup': case 'runtime': case 'packadd': case 'scriptencoding': case 'if': case 'endif': case 'else': case 'function': case 'endfunction': case 'call': case 'command': case 'abbreviate': case 'iabbrev': case 'digraphs':
        if (!this.sourcing && cmd !== 'filetype' && cmd !== 'highlight') this.msg(`:${cmd} is accepted but has no effect in this build`);
        return;
    }
    this.err(`E492: Not an editor command: ${cmd} ${a}`.trim());
  },
  parseKeys(s) {
    const names = { esc: ESC, cr: CR, enter: CR, return: CR, bs: BS, tab: TAB, space: ' ', lt: '<', bar: '|', bslash: '\\', left: LEFT, right: RIGHT, up: UP, down: DOWN, home: HOME, end: END, del: DEL, nop: '', leader: this.leader };
    return s.replace(/<([A-Za-z]-)?([A-Za-z0-9]+)>/g, (m, mod, name) => { if (mod && mod[0].toLowerCase() === 'c' && name.length === 1) return C(name); const v = names[name.toLowerCase()]; return v === undefined ? m : v; });
  },
  keyNames(s) { return [...s].map(ch => (ch === ESC ? '<Esc>' : ch === CR ? '<CR>' : ch === ' ' ? '<Space>' : ch === TAB ? '<Tab>' : ch === BS ? '<BS>' : ch.charCodeAt(0) < 32 ? `<C-${String.fromCharCode(ch.charCodeAt(0) + 64)}>` : ch)).join(''); },
  doPutLines(reg, above) {
    const rg = this.getReg(reg);
    if (!rg) return this.err(`E353: Nothing in register ${reg || '"'}`);
    const ls = rg.t.split('\n'), at = above ? this.cur.l : this.cur.l + 1;
    this.insertLines(at, ls); this.cur.l = at + ls.length - 1; this.cur.c = firstNB(this.line);
  },

  setOpts(a) {
    if (!a || a === 'all') {
      const diff = Object.keys(DEFAULTS).filter(k => a === 'all' || this.o[k] !== DEFAULTS[k]).map(k => (typeof this.o[k] === 'boolean' ? (this.o[k] ? '  ' : 'no') + LONG[k] : `  ${LONG[k]}=${this.o[k]}`));
      return this.showLines([{ text: a ? '--- Options ---' : '--- Options ---', hl: this.hl.Title }, ...diff, ...(this.b.ft ? [`  filetype=${this.b.ft}`] : [])]);
    }
    for (const item of a.split(/\s+/)) {
      const m = /^(no|inv)?([A-Za-z_0-9]+)([?!&]|[-+^]?=(.*))?$/.exec(item);
      if (!m) return this.err(`E518: Unknown option: ${item}`);
      let [, pre, name, opx, val] = m;
      if (name === 'ft' || name === 'filetype' || name === 'syntax' || name === 'syn') { if (val !== undefined) { this.b.ft = val; this.synCache.clear(); } else this.msg(`  filetype=${this.b.ft}`); continue; }
      if (pre && !OPTS[name] && !Object.values(OPTS).includes(name) && (OPTS[pre + name] || Object.values(OPTS).includes(pre + name))) { name = pre + name; pre = undefined; }
      const key = OPTS[name] || (Object.values(OPTS).includes(name) ? name : null);
      if (!key) { if (NOOP.has(name) || NOOP.has(name.replace(/^no/, ''))) continue; return this.err(`E518: Unknown option: ${name}`); }
      const isBool = typeof DEFAULTS[key] === 'boolean';
      if (opx === '?') { this.msg(isBool ? (this.o[key] ? '  ' : 'no') + LONG[key] : `  ${LONG[key]}=${this.o[key]}`); continue; }
      if (opx === '&') { this.o[key] = DEFAULTS[key]; continue; }
      if (isBool) {
        if (val !== undefined) return this.err(`E474: Invalid argument: ${item}`);
        this.o[key] = opx === '!' || pre === 'inv' ? !this.o[key] : pre !== 'no';
      } else if (val === undefined) { if (pre) return this.err(`E474: Invalid argument: ${item}`); this.msg(`  ${LONG[key]}=${this.o[key]}`); }
      else if (typeof DEFAULTS[key] === 'number') {
        if (!/^\d+$/.test(val)) return this.err(`E521: Number required after =: ${item}`);
        const n = +val, op = opx[0];
        this.o[key] = op === '+' ? this.o[key] + n : op === '-' ? this.o[key] - n : op === '^' ? this.o[key] * n : n;
        if ((key === 'ts' || key === 'sw') && this.o[key] < (key === 'ts' ? 1 : 0)) { this.o[key] = DEFAULTS[key]; return this.err(`E487: Argument must be positive: ${item}`); }
      } else this.o[key] = val;
      if (key === 'hls') this.hlOff = false;
    }
  },

  substitute(r, a, again) {
    let pat, rep, flags;
    const last = this.lastSub;
    const m0 = /^([^\w\s"|\\])/.exec(a);
    if (!again && m0) {
      const d = m0[1];
      const parts = [];
      let cur = '', i = 1;
      for (; i < a.length && parts.length < 2; i++) { const ch = a[i]; if (ch === '\\' && i + 1 < a.length) { cur += a[i + 1] === d ? d : ch + a[i + 1]; i++; } else if (ch === d) { parts.push(cur); cur = ''; } else cur += ch; }
      if (parts.length < 2) { parts.push(cur); cur = ''; }
      pat = parts[0]; rep = parts[1] ?? ''; flags = parts.length === 2 ? a.slice(i) : '';
      if (pat === '') { if (!this.search) return this.err('E35: No previous regular expression'); pat = this.search.pat; }
    } else {
      if (!last) return this.err('E35: No previous regular expression');
      pat = last.pat; rep = last.rep; flags = a.replace(/^&/, last.flags);
      if (again && !a) flags = '';
    }
    if (flags.startsWith('&')) flags = (last?.flags || '') + flags.slice(1);
    const fm = /^([&cegiInp#lr]*)\s*(\d+)?\s*$/.exec(flags.trim());
    if (!fm) return this.err('E488: Trailing characters');
    flags = fm[1];
    let { l1, l2 } = r;
    if (fm[2]) { l1 = r.l2; l2 = Math.min(this.L.length - 1, r.l2 + +fm[2] - 1); }
    let re;
    try { re = this.regex(pat, 'g'); } catch { return this.err(`E486: Pattern not found: ${pat}`); }
    if (flags.includes('i')) re = new RegExp(re.source, 'gi'); else if (flags.includes('I')) re = new RegExp(re.source, 'g');
    const fn = subRep(rep, last?.rep);
    this.lastSub = { pat, rep, flags };
    this.search = { pat, fwd: true }; this.hlOff = false;
    const st = { re, fn, l: l1, l2, from: 0, subs: 0, lines: 0, global: flags.includes('g'), lastLine: -1, quiet: flags.includes('e'), pat, countOnly: flags.includes('n') };
    if (flags.includes('c') && !st.countOnly) { this.pushJump(); return this.subConfirm(st); }
    while (this.subStep(st, true)) { /* all matches */ }
    this.subDone(st);
  },
  // Finds the next match; with `apply` replaces it. Returns false when the range is exhausted.
  subStep(st, apply) {
    while (st.l <= st.l2) {
      const line = this.L[st.l];
      st.re.lastIndex = st.from;
      const m = st.from <= line.length ? st.re.exec(line) : null;
      if (!m) { st.l++; st.from = 0; continue; }
      st.m = m;
      if (apply) this.subApply(st);
      return true;
    }
    return false;
  },
  subApply(st) {
    const m = st.m, line = this.L[st.l];
    if (st.countOnly) { st.subs++; if (st.lastLine !== st.l) { st.lines++; st.lastLine = st.l; } if (st.global && m.index + Math.max(1, m[0].length) <= line.length) st.from = m.index + Math.max(1, m[0].length); else { st.l++; st.from = 0; } return; }
    const text = st.fn(m), out = line.slice(0, m.index) + text + line.slice(m.index + m[0].length);
    st.subs++; if (st.lastLine !== st.l) { st.lines++; }
    const parts = out.split('\n');
    this.touch();
    this.b.lines.splice(st.l, 1, ...parts);
    const added = parts.length - 1;
    if (added) this.shiftMarks(st.l + 1, added);
    const tn = text.split('\n');
    const endL = st.l + tn.length - 1, endC = tn.length > 1 ? tn.at(-1).length : m.index + text.length;
    st.l2 += added; st.lastLine = endL;
    this.cur.l = endL; this.cur.c = 0;
    if (st.global && endC + (m[0].length ? 0 : 1) <= this.L[endL].length) { st.l = endL; st.from = endC + (m[0].length ? 0 : 1); } else { st.l = endL + 1; st.from = 0; }
  },
  subSkip(st) { const m = st.m; if (st.global && m.index + Math.max(1, m[0].length) <= this.L[st.l].length) st.from = m.index + Math.max(1, m[0].length); else { st.l++; st.from = 0; } },
  subDone(st) {
    this.asking = null; this.incMatch = null;
    if (!st.subs) { if (!st.quiet) this.err(`E486: Pattern not found: ${st.pat}`); return; }
    if (st.countOnly) return this.msg(`${st.subs} match${st.subs > 1 ? 'es' : ''} on ${st.lines} line${st.lines > 1 ? 's' : ''}`);
    this.cur.c = firstNB(this.L[this.cur.l] ?? '');
    if (st.lines > 2) this.msg(`${st.subs} substitution${st.subs > 1 ? 's' : ''} on ${st.lines} line${st.lines > 1 ? 's' : ''}`);
  },
  subConfirm(st) {
    const ask = () => {
      if (!this.subStep(st, false)) return this.subDone(st);
      this.cur.l = st.l; this.cur.c = st.m.index;
      this.incMatch = { l: st.l, c: st.m.index, n: st.m[0].length };
      this.message = { text: `replace with ${st.fn(st.m).replace(/\n/g, '^M')} (y/n/a/q/l/^E/^Y)?`, hl: this.hl.MoreMsg, keep: true };
      this.asking = k => {
        if (k === 'y') { this.subApply(st); ask(); }
        else if (k === 'n') { this.subSkip(st); ask(); }
        else if (k === 'a') { this.subApply(st); while (this.subStep(st, true)) { /* rest */ } this.message = null; this.subDone(st); }
        else if (k === 'l') { this.subApply(st); this.message = null; this.subDone(st); }
        else if (k === 'q' || k === ESC || k === C('c')) { this.message = null; st.quiet = true; this.subDone(st); }
        else if (k === C('e')) this.w.top++;
        else if (k === C('y')) this.w.top = Math.max(0, this.w.top - 1);
      };
    };
    ask();
  },

  global(r, a, invert) {
    const d = a[0];
    if (!d || /[\w\s"|]/.test(d)) return this.err('E476: Invalid command');
    let i = 1, pat = '';
    for (; i < a.length && a[i] !== d; i++) { if (a[i] === '\\' && i + 1 < a.length) { pat += a[i + 1] === d ? d : a[i] + a[i + 1]; i++; } else pat += a[i]; }
    const cmd = a.slice(i + 1).trim() || 'p';
    if (!pat) { if (!this.search) return this.err('E35: No previous regular expression'); pat = this.search.pat; }
    let re;
    try { re = this.regex(pat); } catch { return this.err(`E486: Pattern not found: ${pat}`); }
    this.search = { pat, fwd: true }; this.hlOff = false;
    const b = this.b, ids = [];
    for (let l = r.l1; l <= r.l2; l++) if (re.test(this.L[l]) !== invert) { b.marks[`g#${l}`] = { l, c: 0 }; ids.push(`g#${l}`); }
    if (!ids.length) return this.msg(invert ? `Pattern found in every line: ${pat}` : `Pattern not found: ${pat}`);
    if (/^(p|print|nu|number|#|l|list)?$/.test(cmd)) {
      const w = Math.max(3, String(this.L.length).length);
      const out = ids.map(id => { const l = b.marks[id].l; delete b.marks[id]; return (/^(nu|number|#)$/.test(cmd) || this.o.nu ? String(l + 1).padStart(w) + ' ' : '') + this.L[l]; });
      this.cur.l = +ids.at(-1).slice(2); this.cur.c = firstNB(this.line);
      return this.showLines(out);
    }
    const before = this.L.length, pagerBefore = this.pager;
    for (const id of ids) {
      const m = b.marks[id];
      if (!m) continue;
      delete b.marks[id];
      this.cur.l = Math.min(this.L.length - 1, m.l); this.cur.c = 0;
      this.message = null; this.failed = false;
      this.exLine(cmd);
      if (this.dead) return;
      if (this.failed && this.message?.hl === this.hl.ErrorMsg && /E492/.test(this.message.text)) break;
    }
    for (const k of Object.keys(b.marks)) if (k.startsWith('g#')) delete b.marks[k];
    if (this.pager === pagerBefore && !(this.message?.hl === this.hl.ErrorMsg)) {
      const d2 = this.L.length - before;
      this.message = null; this.failed = false;
      if (d2 < -2) this.msg(`${-d2} fewer lines`); else if (d2 > 2) this.msg(`${d2} more lines`);
    }
  },

  shellOut(cmd, { stdin, filter, read }) {
    if (!this.io.shell) return this.err('E282: Cannot run shell commands in this session');
    cmd = cmd.replace(/(^|[^\\])%/g, (m, a) => a + (this.b.name || '')).replace(/\\%/g, '%');
    if (cmd === '!' || cmd.startsWith('! ')) cmd = (this.lastShell || '') + cmd.slice(1);
    this.lastShell = cmd;
    const capture = !!filter || read !== undefined;
    if (filter) stdin = this.L.slice(filter[0], filter[1] + 1).join('\n') + '\n';
    this.busy = capture ? true : 'shell';
    this.io.shell(cmd, { stdin, capture }).then(res => {
      this.busy = false;
      if (res.screen) this.sc = res.screen;
      if (capture) {
        const ls = res.out.replace(/\n$/, '').split('\n');
        if (filter) { this.touch(); this.b.lines.splice(filter[0], filter[1] - filter[0] + 1, ...(res.out === '' ? [] : ls)); if (!this.b.lines.length) this.b.lines.push(''); this.cur.l = Math.min(this.L.length - 1, filter[0]); this.cur.c = 0; const n = filter[1] - filter[0] + 1; if (n > 2) this.msg(`${n} lines filtered`); }
        else if (res.out !== '') { this.insertLines(read + 1, ls); this.cur.l = read + 1; this.cur.c = 0; }
        this.ug = false;
      }
      this.drain();
    }).catch(e => { this.busy = false; this.err('E485: ' + e.message); this.drain(); });
  },

  help(topic) {
    let buf = this.bufs.find(x => x.help);
    if (!buf) { buf = this.newBuf('help.txt'); buf.help = true; buf.ro = true; buf.ft = 'help'; buf.lines = [...HELP]; }
    let line = 0;
    if (topic) {
      const t = topic.replace(/^:/, ':');
      line = buf.lines.findIndex(l => l.includes(`*${t}*`));
      if (line < 0) line = buf.lines.findIndex(l => l.toLowerCase().includes(t.toLowerCase()));
      if (line < 0) return this.err(`E149: Sorry, no help for ${topic}`);
    }
    const existing = this.wins().find(w => w.buf === buf);
    if (existing) this.w = existing;
    else { const sb = this.o.sb; this.o.sb = false; const w = this.splitWin(false, buf); this.o.sb = sb; w.cur = { l: 0, c: 0 }; }
    this.w.cur = { l: line, c: 0 }; this.w.top = line;
    this.noSo = true;
  },
};

// ---------------------------------------------------------------- filetypes & syntax
const EXT = { sh: 'sh', bash: 'sh', zsh: 'sh', bashrc: 'sh', profile: 'sh', py: 'python', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', js: 'javascript', mjs: 'javascript', ts: 'javascript', jsx: 'javascript', json: 'json', html: 'html', htm: 'html', xml: 'html', svg: 'html', css: 'css', md: 'markdown', vim: 'vim', vimrc: 'vim', conf: 'conf', cfg: 'conf', ini: 'conf', list: 'conf', desktop: 'conf', bat: 'dosbatch', cmd: 'dosbatch', java: 'java', go: 'go', rs: 'rust', php: 'php', rb: 'ruby', lua: 'lua', sql: 'sql', yml: 'yaml', yaml: 'yaml', toml: 'conf', mk: 'make', txt: '' };
export function detectFt(name, first = '') {
  const base = basename(name || '');
  if (/^\.?(bashrc|bash_profile|bash_aliases|profile|bash_logout|zshrc)$/.test(base)) return 'sh';
  if (/^\.?_?g?vimrc$/.test(base)) return 'vim';
  if (/^(Makefile|makefile|GNUmakefile)$/.test(base)) return 'make';
  if (/^(fstab|hosts|passwd|group|sources\.list|os-release|lsb-release|hostname)$/.test(base) || /^\/etc\//.test(name || '')) return 'conf';
  const m = /\.([^.\/]+)$/.exec(base);
  if (m && EXT[m[1].toLowerCase()] !== undefined) return EXT[m[1].toLowerCase()];
  const sb = /^#!\s*\S*?(bash|sh|python\d*|node|perl|ruby)\b/.exec(first);
  if (sb) return /sh$/.test(sb[1]) ? 'sh' : /^python/.test(sb[1]) ? 'python' : sb[1] === 'node' ? 'javascript' : sb[1];
  return '';
}
const W = s => new Set(s.split(' '));
const CLIKE = { com: ['//'], block: ['/*', '*/'], str: '"\'' };
const LANG = {
  sh: { com: ['#'], str: '"\'`', kw: W('if then else elif fi for while until do done case esac in function return break continue exit local export readonly declare unset shift source alias select time'), types: W('echo printf read cd test eval exec set trap pwd let true false'), special: /\$\{[^}]*\}|\$\([^)]*\)|\$[\w@#?*!$-]+/y },
  python: { com: ['#'], str: '"\'', kw: W('def class return if elif else for while in not and or import from as try except finally raise with lambda pass break continue yield global nonlocal assert del is async await'), consts: W('True False None self'), types: W('int str float list dict set tuple bool bytes object print len range open type isinstance enumerate zip map filter sorted sum min max abs'), special: /@\w+/y, defs: W('def class') },
  c: { ...CLIKE, kw: W('if else for while do switch case default break continue return goto sizeof typedef struct union enum static extern const volatile inline register'), types: W('int char float double void long short unsigned signed size_t ssize_t bool FILE uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t'), consts: W('NULL true false EOF stdin stdout stderr'), pre: /^\s*#\s*\w+/ },
  javascript: { ...CLIKE, str: '"\'`', kw: W('if else for while do switch case default break continue return function var let const new delete typeof instanceof in of class extends super import export from as try catch finally throw async await yield static get set void with'), consts: W('true false null undefined NaN Infinity this'), types: W('Array Object String Number Boolean Map Set Promise Date Math JSON RegExp Error Symbol console window document') },
  java: { ...CLIKE, kw: W('if else for while do switch case default break continue return new class interface extends implements import package public private protected static final abstract try catch finally throw throws this super instanceof synchronized void'), types: W('int char float double long short byte boolean String Integer Object List Map'), consts: W('true false null') },
  go: { ...CLIKE, str: '"\'`', kw: W('if else for switch case default break continue return func var const type struct interface map chan go defer select package import range fallthrough goto'), types: W('int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 float32 float64 string bool byte rune error'), consts: W('true false nil iota') },
  rust: { ...CLIKE, kw: W('if else for while loop match break continue return fn let mut const static struct enum impl trait pub use mod crate self super as in ref move where unsafe async await dyn type'), types: W('i8 i16 i32 i64 u8 u16 u32 u64 usize isize f32 f64 bool char str String Vec Option Result Box'), consts: W('true false None Some Ok Err') },
  php: { com: ['//', '#'], block: ['/*', '*/'], str: '"\'', kw: W('if else elseif for foreach while do switch case default break continue return function class extends new echo print public private protected static use namespace require include try catch finally throw as'), consts: W('true false null'), special: /\$\w+/y },
  ruby: { com: ['#'], str: '"\'', kw: W('if elsif else unless while until for in do end def class module return yield begin rescue ensure raise require include attr_accessor then case when break next'), consts: W('true false nil self'), special: /[:@]\w+/y },
  lua: { com: ['--'], str: '"\'', kw: W('if then else elseif end for while do repeat until function local return break in and or not'), consts: W('true false nil') },
  sql: { com: ['--'], str: "'\"", kw: W('select from where insert into values update set delete create table drop alter index join left right inner outer on group by order having limit as and or not null primary key SELECT FROM WHERE INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE DROP ALTER INDEX JOIN LEFT RIGHT INNER OUTER ON GROUP BY ORDER HAVING LIMIT AS AND OR NOT NULL PRIMARY KEY') },
  vim: { com: [], str: "'", kw: W('set let if else elseif endif function endfunction return for endfor while endwhile map nmap imap vmap noremap nnoremap inoremap vnoremap syntax colorscheme filetype autocmd augroup call execute source highlight command silent unmap'), types: W('on off enable plugin indent'), special: /<[A-Za-z-]+>/y, vimCom: true },
  conf: { com: ['#', ';'], str: '"\'', section: true },
  yaml: { com: ['#'], str: '"\'', yamlKey: true, consts: W('true false null yes no') },
  make: { com: ['#'], str: '"\'', special: /\$[({][^)}]*[)}]|\$[@<^*?]/y, target: true },
  dosbatch: { com: [], str: '"', kw: W('echo set if else for in do goto call exit pause not exist defined errorlevel setlocal endlocal shift start cd md rd del copy move type cls ECHO SET IF ELSE FOR IN DO GOTO CALL EXIT PAUSE NOT EXIST DEFINED'), special: /%[\w~]+%?|%%\w/y, bat: true },
  css: { com: [], block: ['/*', '*/'], str: '"\'', cssProp: true },
  json: { com: [], str: '"', consts: W('true false null'), jsonKey: true },
};
LANG.cpp = { ...LANG.c, kw: new Set([...LANG.c.kw, ...W('class namespace template public private protected virtual new delete using try catch throw this operator friend override nullptr constexpr auto')]) };
export function synSpans(line, ft, first) {
  const out = [], n = line.length;
  if (ft === 'markdown') {
    if (/^#{1,6}\s/.test(line)) return [[0, n, 'Title']];
    if (/^\s*```/.test(line)) return [[0, n, 'Special']];
    if (/^\s*>/.test(line)) return [[0, n, 'Comment']];
    const m = /^\s*([-*+]|\d+\.)\s/.exec(line);
    if (m) out.push([0, m[0].length, 'Statement']);
    for (const x of line.matchAll(/`[^`]+`/g)) out.push([x.index, x.index + x[0].length, 'Constant']);
    for (const x of line.matchAll(/\*\*[^*]+\*\*|__[^_]+__/g)) out.push([x.index, x.index + x[0].length, 'Bold']);
    for (const x of line.matchAll(/\[[^\]]*\]\([^)]*\)|https?:\/\/\S+/g)) out.push([x.index, x.index + x[0].length, 'Underlined']);
    return out;
  }
  if (ft === 'html') {
    for (const x of line.matchAll(/<!--.*?(-->|$)|<\/?[A-Za-z][\w:-]*|\/?>|&\w+;|"[^"]*"|'[^']*'|\b[\w:-]+(?==)/g)) {
      const t = x[0];
      out.push([x.index, x.index + t.length, t.startsWith('<!--') ? 'Comment' : t[0] === '<' || t === '>' || t === '/>' ? 'Statement' : t[0] === '&' ? 'Special' : t[0] === '"' || t[0] === "'" ? 'Constant' : 'Type']);
    }
    return out;
  }
  if (ft === 'help') {
    if (/^[A-Z0-9][A-Z0-9 /&()-]{3,}(\s|$)/.test(line) && !/[a-z]{3}/.test(line.split('*')[0])) out.push([0, line.search(/\s{2,}|\*|$/), 'Statement']);
    if (/^[=-]{10,}$/.test(line)) return [[0, n, 'PreProc']];
    for (const x of line.matchAll(/\*[^*\s]+\*/g)) out.push([x.index, x.index + x[0].length, 'Constant']);
    for (const x of line.matchAll(/\|[^|\s]+\|/g)) out.push([x.index, x.index + x[0].length, 'Identifier']);
    for (const x of line.matchAll(/<[A-Za-z0-9-]+>|CTRL-\S+|(?<=^|\s):\w\S*/g)) out.push([x.index, x.index + x[0].length, 'Special']);
    return out;
  }
  const L = LANG[ft];
  if (!L) return out;
  if (first && line.startsWith('#!')) return [[0, n, 'PreProc']];
  let i = 0;
  if (L.pre) { const m = L.pre.exec(line); if (m) { out.push([m.index, m[0].length, 'PreProc']); i = m[0].length; const inc = /^\s*<[^>]*>/.exec(line.slice(i)); if (inc) { out.push([i, i + inc[0].length, 'Constant']); i += inc[0].length; } } }
  if (L.vimCom && /^\s*"/.test(line)) return [[0, n, 'Comment']];
  if (L.bat) { if (/^\s*(@?rem\b|::)/i.test(line)) return [[0, n, 'Comment']]; const m = /^\s*:\w+/.exec(line); if (m) return [[0, n, 'Type']]; }
  if (L.section) { const m = /^\s*\[[^\]]*\]/.exec(line); if (m) { out.push([0, m[0].length, 'Type']); i = m[0].length; } else { const k = /^\s*[\w.-]+(?=\s*=)/.exec(line); if (k) { out.push([0, k[0].length, 'Identifier']); i = k[0].length; } } }
  if (L.target) { const m = /^[\w.%/-]+(?=\s*:(?!=))/.exec(line); if (m) { out.push([0, m[0].length, 'Identifier']); i = m[0].length; } }
  if (L.yamlKey) { const m = /^\s*(-\s+)?[\w.-]+(?=\s*:)/.exec(line); if (m) { out.push([0, m[0].length, 'Identifier']); i = m[0].length; } }
  let defNext = false;
  while (i < n) {
    const ch = line[i];
    if (L.com.some(c => line.startsWith(c, i) && (c !== '#' || ft !== 'sh' || i === 0 || /\s/.test(line[i - 1])))) { out.push([i, n, 'Comment']); break; }
    if (L.block && line.startsWith(L.block[0], i)) { const e = line.indexOf(L.block[1], i + 2), end = e < 0 ? n : e + L.block[1].length; out.push([i, end, 'Comment']); i = end; continue; }
    if (L.str.includes(ch)) {
      let j = i + 1;
      while (j < n && line[j] !== ch) { if (line[j] === '\\') j++; j++; }
      j = Math.min(n, j + 1);
      let g = 'Constant';
      if (L.jsonKey && /^\s*:/.test(line.slice(j))) g = 'Statement';
      out.push([i, j, g]); i = j; continue;
    }
    if (/\d/.test(ch) && (i === 0 || !/[\w.]/.test(line[i - 1]))) { const m = /^(0[xX][\da-fA-F]+|\d+\.?\d*(?:[eE][-+]?\d+)?)\w*%?/.exec(line.slice(i)); out.push([i, i + m[0].length, 'Constant']); i += m[0].length; continue; }
    if (L.special) { L.special.lastIndex = i; const m = L.special.exec(line); if (m) { out.push([i, i + m[0].length, 'PreProc']); i += m[0].length; continue; } }
    if (/[A-Za-z_]/.test(ch)) {
      const w = /^[A-Za-z_][\w-]*/.exec(line.slice(i))[0].replace(L.cssProp ? /$^/ : /-.*$/, m => (ft === 'sh' || ft === 'conf' ? '' : m));
      const word = L.cssProp ? w : /^[A-Za-z_]\w*/.exec(w)[0];
      let g = null;
      if (defNext) { g = 'Identifier'; defNext = false; }
      else if (L.kw?.has(word)) { g = 'Statement'; if (L.defs?.has(word)) defNext = true; }
      else if (L.types?.has(word)) g = 'Type'; else if (L.consts?.has(word)) g = 'Constant';
      else if (L.cssProp && /^\s*:/.test(line.slice(i + word.length)) && /^\s/.test(line)) g = 'Type';
      if (g) out.push([i, i + word.length, g]);
      i += word.length; continue;
    }
    i++;
  }
  return out;
}

const HELP = `*help.txt*      Vim ブラウザ版  クイックリファレンス

                        VIM - メインヘルプファイル
                                                                         k
      移動:  カーソルキー、または "h" で左、"j" で下、               h   l
             "k" で上、"l" で右に動きます。                            j
ヘルプを閉じる:  ":q<Enter>"
   Vim を終了:  ":qa!<Enter>" (変更は破棄されます)
     話題を探す:  ":help {話題}"   例: ":help :s"  ":help registers"

================================================================================
MODES                                                   *modes* *vim-modes*

  Normal        <Esc>             コマンドを入力する基本モード
  Insert        i a I A o O       文字を入力する ( "-- INSERT --" )
  Replace       R                 上書き入力
  Visual        v V CTRL-V        文字 / 行 / 矩形で範囲選択
  Command-line  : / ?             Ex コマンドと検索

================================================================================
MOTIONS                                                 *motions* *cursor-motions*

  h j k l       左 下 上 右               w b e ge      単語単位 (W B E gE は空白区切り)
  0 ^ $ g_      行頭 / 最初の非空白 / 行末       gg G {N}G     先頭行 / 最終行 / N 行目
  f{c} t{c} F T ; ,   行内の文字へ              %             対応する括弧
  { }  ( )      段落 / 文                  H M L         画面の上 / 中 / 下
  CTRL-D CTRL-U CTRL-F CTRL-B CTRL-E CTRL-Y   スクロール      zt zz zb      カーソル行を上/中/下に
  * # n N       カーソル下の単語を検索 / 次 / 前      '{a} \`{a}     マークへ   CTRL-O CTRL-I  ジャンプ履歴

================================================================================
EDITING                                                 *editing* *operators*

  オペレータ + モーション:   d (削除)  c (変更)  y (ヤンク)  > < (インデント)  = (整形)
                          gu gU g~ (大文字/小文字)  gq (整形)  g? (rot13)
  例:  dw  d$  dd  3dd  cw  ci"  ya(  yip  >ap  gUiw  dt,  d/foo<CR>
  テキストオブジェクト *text-objects*:  iw aw  i" a"  i( a(  i{ a{  i[ a[  i< a<  it at  ip ap
  x X D C s S Y r{c} R J ~ p P   単発の編集コマンド
  u / CTRL-R    アンドゥ / リドゥ *undo*           .             直前の変更を繰り返す *repeat*
  CTRL-A CTRL-X 数値を増減                   q{a} ... q  @{a} @@   マクロ *recording*

================================================================================
REGISTERS                                               *registers* *quote*

  "{a-z}  名前付き ("A-Z で追記)    ""  無名    "0  ヤンク    "1-"9  削除履歴    "-  小削除
  "+ "*   システムのクリップボード         "_  ブラックホール    ":  "/  ".  "%  読み取り専用
  :reg    一覧を表示        CTRL-R {reg}   挿入モード / コマンドラインで貼り付け

================================================================================
SEARCH & REPLACE                                        *search* *:s* *:substitute*

  /{pattern}  ?{pattern}  n  N        検索 ( \\c 大小無視  \\v very magic  \\< \\> 単語境界 )
  :[range]s/{pat}/{str}/[gci]         置換   & = マッチ全体  \\1 = グループ  \\r = 改行
  :%s/foo/bar/gc                      ファイル全体を確認しながら置換
  :[range]g/{pat}/{cmd}  :v/{pat}/{cmd}   マッチする(しない)行でコマンド実行 *:g* *:global*
  :noh    ハイライトを消す        :set hls is ic scs   検索関連オプション

================================================================================
FILES, BUFFERS, WINDOWS                                 *windows* *buffers* *:w* *:q*

  :w [file]  :w!  :wq  :x  ZZ         保存          :q  :q!  :qa  ZQ          終了
  :e {file}  :e!  :r {file}           開く / 読み直す / 挿入       gf   カーソル下のファイルを開く
  :ls  :b{N}  :bn  :bp  :bd  CTRL-^   バッファ操作
  :sp  :vs  :new  :only  :close       ウィンドウ分割 *:split* *:vsplit*
  CTRL-W s v w h j k l c o q          ウィンドウコマンド *CTRL-W*
  :!{cmd}  :r !{cmd}  :{range}!{cmd}  シェルコマンド *:!*        :w !sudo tee %

================================================================================
OPTIONS                                                 *options* *:set*

  :set nu rnu cul list wrap hls is ic scs et ai si      ブール値 ( no{opt} / {opt}! / {opt}? )
  :set ts=4 sw=4 sts=4 so=5 tw=78 ls=2 clipboard=unnamedplus
  :syntax on|off     :colorscheme default|desert|elflord|murphy|slate
  :map :nmap :imap :vmap :nnoremap :inoremap ...  :let mapleader=","    *mapping*
  ~/.vimrc に書いた設定は起動時に読み込まれます。                        *vimrc*

================================================================================
NOT INCLUDED                                            *limitations* *iccf* *version8*

  折りたたみ・タブページ・Vim script の関数・プラグイン・:terminal は含まれません。
  これはブラウザ上で動く再実装です。本物の Vim は https://www.vim.org/ から。
  Vim はチャリティウェアです。ウガンダの子供たちへの支援については本家の :help iccf を。

 vim:tw=78:ts=8:ft=help:`.split('\n');

export const TUTOR = `===============================================================================
=    V I M  チ ュ ー ト リ ア ル  ( ブ ラ ウ ザ 版 )    ―  所要時間 約 10 分    =
===============================================================================

   このファイルは練習用のコピーです。どれだけ壊しても大丈夫。
   読むだけでなく、実際にキーを打って試してください。

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
                    レッスン 1: カーソルを動かす

             ^
             k              h: 左   j: 下   k: 上   l: 右
       < h       l >
             j              j を何度か押してレッスン 2 まで進みましょう。
             v

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
                    レッスン 2: 文字を消す ( x )

  下の ---> の行で、余分な文字の上にカーソルを置いて x を押します。

---> Thhe quiick broown foxx juumps ovver thee fence.

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
                    レッスン 3: 文字を挿入する ( i と A )

  i でカーソル位置に挿入、A で行末に追記。<Esc> でノーマルモードに戻ります。

---> Ths lne is mssing sme lettrs.
---> This line is missing some letters.

---> この行の最後に「できた！」と追記してみましょう:

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
                    レッスン 4: オペレータとモーション ( dw  d$  dd )

  dw  : 単語を削除        d$ : 行末まで削除        dd : 行ごと削除
  2dd : 2 行削除          u  : 元に戻す            CTRL-R : やり直す

---> This sentence apple has banana some extra words cherry in it.
---> This line was typed with its ending doubled. its ending doubled.

---> 1)  Monday
---> 2)  Curry rice
---> 3)  Tuesday
---> 4)  Mount Fuji
---> 5)  Shinkansen
---> 6)  Wednesday

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
                    レッスン 5: 貼り付け・置き換え・変更 ( p  r  cw )

  dd で消した行は p でカーソルの下に貼り付けられます。順番を直しましょう。

---> d) Winter brings snow.
---> b) Summer brings fireworks,
---> c) Autumn brings red leaves,
---> a) Spring brings cherry blossoms,

  r{文字} で 1 文字置き換え、cw で単語を変更します。

---> Thas lune hes somi wreng lettirs in at.
---> This lxxx has a few wzzz that nqqq changing wiyy the change operator.

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
                    レッスン 6: 検索と置換 ( /  n  %  :s )

  /typpo<Enter> で検索、n で次へ、N で前へ。 % は対応する括弧に飛びます。

---> A "typpo" is easy to make; fixing a typpo is easy too.
---> Jump ( between [ these { nested } brackets ] with the percent key ).

  :s/teh/the/g でその行を、:%s/old/new/gc でファイル全体を確認しながら置換。

---> teh cat sat on teh mat next to teh door.

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
                    レッスン 7: ビジュアルモードとテキストオブジェクト

  v で選択開始 → 動かす → d / y / c。 V は行単位、CTRL-V は矩形。
  ci" で引用符の中身を変更、da( で括弧ごと削除、yiw で単語をヤンク。

---> print("change me") and delete (this part) please.

~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
                    レッスン 8: 保存と終了

  :w<Enter>    保存            :q<Enter>     終了
  :wq<Enter>   保存して終了    :q!<Enter>    保存せずに終了
  :help<Enter> ヘルプ          :!ls<Enter>   シェルコマンドを実行

  おつかれさまでした。 :q! でこのチュートリアルを閉じましょう。
~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
`;
export { HELP, dirname };
