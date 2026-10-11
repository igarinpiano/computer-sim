// cmd.exe / COMMAND.COM style shell for the Windows XP and DOS machines.
// The VFS root "/" is drive C:. Paths are converted at the edges.

import { evalArith, globToRe, pad2, columnize } from '../core/util.js';
import { FsError, dirname, basename, join, extname } from '../core/vfs.js';
import { INTR } from './terminal.js';
import { runVim, runEditor } from './tui.js';
import { resolve } from './sysutils.js';

class Abort extends Error { }
class Exit extends Error { constructor(code) { super('exit'); this.code = code; } }
class Goto extends Error { constructor(label) { super('goto'); this.label = label; } }

const comma = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const CGA = ['#000000', '#000080', '#008000', '#008080', '#800000', '#800080', '#808000', '#c0c0c0', '#808080', '#0000ff', '#00ff00', '#00ffff', '#ff0000', '#ff00ff', '#ffff00', '#ffffff'];
const GUI = { notepad: 'editor', calc: 'calc', explorer: 'files', mspaint: 'paint', iexplore: 'browser', winmine: 'mines', taskmgr: 'taskmgr', control: 'settings', winver: 'about', cmd: 'terminal', sol: 'mines', desk: 'settings' };
const HELP = [['ATTRIB', 'ファイルの属性を表示します。'], ['CALL', 'バッチ プログラムを別のバッチ プログラムから呼び出します。'], ['CD', '現在のディレクトリを表示または変更します。'], ['CHKDSK', 'ディスクをチェックし、現在の状態を表示します。'], ['CLS', '画面を消去します。'], ['CMD', 'Windows コマンド インタープリタを新しく起動します。'], ['COLOR', 'コンソールの文字と背景の既定の色を設定します。'], ['COPY', '1 個以上のファイルを別の場所にコピーします。'], ['DATE', '日付を表示または設定します。'], ['DEL', '1 個以上のファイルを削除します。'], ['DIR', 'ディレクトリ中のファイルやサブディレクトリを一覧表示します。'], ['DOSKEY', 'コマンド ラインの履歴を表示します。'], ['ECHO', 'メッセージを表示したり、コマンド エコーの ON と OFF を切り替えます。'], ['EDIT', 'テキスト エディタを起動します。'], ['EXIT', 'CMD.EXE プログラム (コマンド インタープリタ) を終了します。'], ['FIND', 'ファイルの中からテキスト文字列を検索します。'], ['FINDSTR', 'ファイルの中から文字列を検索します。'], ['FOR', 'ファイルのセットの各ファイルに対して、指定されたコマンドを実行します。'], ['GOTO', 'バッチ プログラム内の、ラベルで指定されている行へ制御を移動します。'], ['HELP', 'Windows コマンドのヘルプ情報を提供します。'], ['IF', 'バッチ プログラム中で、条件処理を実行します。'], ['IPCONFIG', 'IP 構成を表示します。'], ['MD', 'ディレクトリを作成します。'], ['MORE', '出力を一度に 1 画面ずつ表示します。'], ['MOVE', '1 個以上のファイルをディレクトリから別のディレクトリに移動します。'], ['PATH', '実行可能ファイルの検索パスを表示または設定します。'], ['PAUSE', 'バッチ ファイルの処理を一時停止し、メッセージを表示します。'], ['PING', 'ネットワーク接続を確認します。'], ['PROMPT', 'Windows コマンド プロンプトを変更します。'], ['RD', 'ディレクトリを削除します。'], ['REM', 'バッチ ファイルや CONFIG.SYS に、コメント (注釈) を記録します。'], ['REN', 'ファイルの名前を変更します。'], ['SET', 'Windows 環境変数を表示、設定、または削除します。'], ['SHUTDOWN', 'コンピュータをシャットダウンします。'], ['SORT', '入力を並べ替えます。'], ['START', '別のウィンドウを起動して、指定されたプログラムまたはコマンドを実行します。'], ['SYSTEMINFO', 'コンピュータ固有のプロパティと構成を表示します。'], ['TASKLIST', '現在実行されているすべてのタスクを表示します。'], ['TASKKILL', '実行中のプロセスやアプリケーションを強制終了、または停止します。'], ['TIME', 'システム時刻を表示または設定します。'], ['TITLE', 'CMD.EXE セッションのウィンドウのタイトルを設定します。'], ['TREE', 'ドライブまたはパスのディレクトリ構造を図式表示します。'], ['TYPE', 'テキスト ファイルの内容を表示します。'], ['VER', 'Windows のバージョンを表示します。'], ['VIM', 'Vi IMproved - テキスト エディタを起動します。'], ['VOL', 'ディスクのボリューム ラベルとシリアル番号を表示します。'], ['XCOPY', 'ファイルとディレクトリ ツリーをコピーします。']];

export class Cmd {
  constructor({ term, fs, os = {}, dos = false, home = '/Documents and Settings/User', host = 'XP-PC', user = 'User' }) {
    Object.assign(this, { term, fs, os, dos, home, host, user });
    this.cwd = dos ? '/' : home;
    this.echo = true; this.status = 0; this.history = []; this.dirstack = []; this.started = Date.now();
    const W = p => 'C:' + p.replace(/\//g, '\\');
    this.env = dos
      ? { COMSPEC: 'C:\\DOS\\COMMAND.COM', PATH: 'C:\\DOS;C:\\VIM', PROMPT: '$P$G', TEMP: 'C:\\DOS' }
      : { ALLUSERSPROFILE: 'C:\\Documents and Settings\\All Users', APPDATA: W(home) + '\\Application Data', CommonProgramFiles: 'C:\\Program Files\\Common Files', COMPUTERNAME: host, ComSpec: 'C:\\WINDOWS\\system32\\cmd.exe', HOMEDRIVE: 'C:', HOMEPATH: home.replace(/\//g, '\\'), LOGONSERVER: '\\\\' + host, NUMBER_OF_PROCESSORS: '1', OS: 'Windows_NT', Path: 'C:\\WINDOWS\\system32;C:\\WINDOWS;C:\\WINDOWS\\System32\\Wbem;C:\\Program Files\\Vim\\vim82', PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH', PROCESSOR_ARCHITECTURE: 'x86', PROCESSOR_IDENTIFIER: 'x86 Family 6 Model 13 Stepping 8, GenuineBrowser', ProgramFiles: 'C:\\Program Files', PROMPT: '$P$G', SystemDrive: 'C:', SystemRoot: 'C:\\WINDOWS', TEMP: 'C:\\DOCUME~1\\User\\LOCALS~1\\Temp', TMP: 'C:\\DOCUME~1\\User\\LOCALS~1\\Temp', USERDOMAIN: host, USERNAME: user, USERPROFILE: W(home), windir: 'C:\\WINDOWS' };
  }
  t(jp, en) { return this.dos ? en : jp; }

  // ---- paths
  win(p) { let r = p; try { r = this.fs.realpath(p); } catch { /* keep as typed */ } return 'C:' + (r === '/' ? '\\' : r.replace(/\//g, '\\')); }
  // Windows path -> VFS path. Throws a printable message for other drives.
  vfs(p) {
    p = p.replace(/"/g, '').trim();
    const d = /^([A-Za-z]):/.exec(p);
    if (d) {
      if (d[1].toUpperCase() !== 'C') throw new Error(d[1].toUpperCase() === 'A' ? this.t('デバイスの準備ができていません。', 'Not ready reading drive A\nAbort, Retry, Fail?') : this.t('指定されたドライブが見つかりません。', 'Invalid drive specification'));
      p = p.slice(2);
    }
    p = p.replace(/\\/g, '/');
    return this.fs.abs(p === '' ? '.' : p, this.cwd);
  }
  getenv(name) {
    const u = name.toUpperCase();
    if (u === 'CD') return this.win(this.cwd);
    if (u === 'DATE') return this.date();
    if (u === 'TIME') { const d = new Date(); return `${String(d.getHours()).padStart(2)}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad2(Math.floor(d.getMilliseconds() / 10))}`; }
    if (u === 'RANDOM') return String(Math.floor(Math.random() * 32768));
    if (u === 'ERRORLEVEL') return String(this.status);
    const k = Object.keys(this.env).find(x => x.toUpperCase() === u);
    return k ? this.env[k] : undefined;
  }
  setenv(name, val) { const k = Object.keys(this.env).find(x => x.toUpperCase() === name.toUpperCase()); if (val === '') { if (k) delete this.env[k]; } else this.env[k || name] = val; }
  date(d = new Date()) { return this.dos ? `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${d.getFullYear()}` : `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`; }
  prompt() {
    return (this.getenv('PROMPT') || '$P$G').replace(/\$(.)/g, (m, c) => ({ p: this.win(this.cwd), g: '>', l: '<', n: 'C:', d: this.date(), t: this.getenv('TIME'), v: this.ver(), _: '\n', $: '$', b: '|', q: '=', s: ' ', e: '\x1b', h: '\b', a: '&', c: '(', f: ')' }[c.toLowerCase()] ?? ''));
  }
  ver() { return this.dos ? 'MS-DOS Version 6.22' : 'Microsoft Windows XP [Version 5.1.2600]'; }
  glob(pattern) {   // -> [{ path, name }]; pattern is a Windows path possibly ending in wildcards
    const v = this.vfs(pattern);
    if (!/[*?]/.test(basename(v))) return this.fs.lstat(v) ? [{ path: v, name: basename(v) }] : [];
    const dir = dirname(v), pat = basename(v) === '*.*' ? '*' : basename(v);
    const re = globToRe(pat.replace(/\[/g, '\\['), { ci: true });
    let names = [];
    try { names = this.fs.readdir(dir); } catch { /* missing directory */ }
    return names.filter(n => re.test(n) || (pat.endsWith('.*') && re.test(n + '.'))).map(n => ({ path: join(dir, n), name: n }));
  }

  // ---- io
  check() { if (this.abort) throw new Abort(); }
  sleep(ms) { this.check(); return new Promise((res, rej) => { const t = setTimeout(() => { this.wake = null; res(); }, ms); this.wake = () => { clearTimeout(t); rej(new Abort()); }; }); }
  async tick() { this.check(); if (Date.now() - (this._t || 0) > 12) { await new Promise(r => setTimeout(r)); this._t = Date.now(); this.check(); } }

  async run() {
    const term = this.term;
    term.write(this.dos ? '' : `${this.ver()}\n(C) Copyright 1985-2001 Microsoft Corp.\n`);
    if (this.autorun) { const c = this.autorun; this.autorun = null; term.write(`\n${this.prompt()}${c}\n`); this.history.push(c); await this.top(c); }
    while (!this.exited) {
      const line = await term.readLine({ prompt: (this.echo ? '\n' + this.prompt() : ''), history: this.history, cycle: true, escClears: true, complete: l => this.complete(l) });
      if (line === INTR) continue;
      if (line === null) continue;
      if (line.trim()) { if (this.history.at(-1) !== line) this.history.push(line); if (this.history.length > 50) this.history.shift(); }
      await this.top(line);
    }
    return this.status;
  }
  async top(line) {
    this.abort = false;
    const pop = this.term.pushHandler(ev => {
      if (ev.ctrl && (ev.key === 'c' || ev.key === 'Pause')) { this.term.write('^C'); this.abort = true; if (this.wake) this.wake(); return true; }
      if (ev.ctrl && ev.key === 'v') return false;
      this.term.typeahead.push(ev); return true;
    });
    const io = { in: null, out: s => this.term.write(s), tty: true };
    try { await this.exec(line, io); }
    catch (e) {
      if (e instanceof Exit) { this.exited = true; this.status = e.code ?? this.status; }
      else if (e instanceof Abort) this.term.write('\n');
      else if (e instanceof Goto) this.term.write(this.t('バッチ ラベルが見つかりません - ', 'Label not found - ') + e.label + '\n');
      else { this.term.write(String(e.message) + '\n'); console.error(e); }
    } finally { pop(); this.abort = false; }
  }
  complete(line) {
    const m = /("[^"]*|[^\s"]*)$/.exec(line), word = m[1].replace(/^"/, ''), start = line.length - m[1].length;
    const slash = Math.max(word.lastIndexOf('\\'), word.lastIndexOf('/')), dir = word.slice(0, slash + 1), pre = word.slice(slash + 1).toLowerCase();
    let names;
    try { names = this.fs.readdir(this.vfs(dir || '.')); } catch { return null; }
    const dirsOnly = /^\s*(cd|chdir|rd|rmdir|md|mkdir|pushd)\s/i.test(line);
    const items = names.filter(n => n.toLowerCase().startsWith(pre) && (!dirsOnly || this.fs.isDir(this.vfs(dir + n)))).map(n => (/[ &()^]/.test(dir + n) ? `"${dir}${n}"` : dir + n));
    return { start, items };
  }

  // ---- parsing
  expand(s, args) {
    return s.replace(/%(\*|\d|%|[^%\s]+%)/g, (m, k) => {
      if (k === '%') return '%';
      if (k === '*') return args ? args.slice(1).join(' ') : m;
      if (/^\d$/.test(k)) return args ? args[+k] ?? '' : m;
      const v = this.getenv(k.slice(0, -1).replace(/:.*$/, ''));
      if (v === undefined) return args ? '' : m;
      const sub = /:~(-?\d+)(?:,(-?\d+))?$/.exec(k.slice(0, -1));
      if (sub) { const a = +sub[1], n = sub[2] === undefined ? undefined : +sub[2]; const st = a < 0 ? Math.max(0, v.length + a) : a; return n === undefined ? v.slice(st) : n < 0 ? v.slice(st, n) : v.substr(st, n); }
      const rep = /:([^=]+)=(.*)$/.exec(k.slice(0, -1));
      return rep ? v.split(rep[1]).join(rep[2]) : v;
    });
  }
  // Splits on unquoted operators. Returns [{ text, op }] where op follows the segment.
  split(s) {
    const out = [];
    let cur = '', q = false, depth = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '^' && i + 1 < s.length && !q) { cur += '^' + s[++i]; continue; }
      if (c === '"') q = !q;
      if (!q) {
        if (c === '(') depth++; else if (c === ')') depth = Math.max(0, depth - 1);
        if (depth === 0) {
          const two = s.substr(i, 2);
          if (two === '&&' || two === '||') { out.push({ text: cur, op: two }); cur = ''; i++; continue; }
          if (c === '&' && s[i - 1] !== '>' && !(s[i - 1] === '2' && s[i - 2] === '>')) { out.push({ text: cur, op: '&' }); cur = ''; continue; }
          if (c === '|') { out.push({ text: cur, op: '|' }); cur = ''; continue; }
        }
      }
      cur += c;
    }
    out.push({ text: cur, op: null });
    return out;
  }
  args(s) { return (s.match(/"[^"]*"?|[^\s"]+("[^"]*"?[^\s"]*)*/g) || []); }

  async exec(line, io, args) {
    line = line.replace(/^\s*@/, '');
    const trimmed = line.trim();
    if (!trimmed || /^(rem(\s|$)|::)/i.test(trimmed)) return;
    // if / for own the rest of the line, operators included
    if (/^(if|for)\s/i.test(trimmed)) return this.simple(this.expand(trimmed, args), io, args);
    const segs = this.split(this.expand(line, args));
    let input = io.in, skip = false;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i];
      if (!skip) {
        if (seg.op === '|') { let buf = ''; await this.simple(seg.text, { in: input, out: s => { buf += s; if (buf.length > 400000) throw new Abort(); }, tty: false }, args); input = buf; }
        else { await this.simple(seg.text, { ...io, in: input }, args); input = io.in; }
      }
      skip = seg.op === '&&' ? this.status !== 0 || skip : seg.op === '||' ? this.status === 0 || skip : false;
      if (seg.op === '&') skip = false;
    }
  }

  async simple(text, io, bargs) {
    // redirections
    let out = io.out, input = io.in, tty = io.tty, errOut = s => this.term.write(s);
    const noCaret = s => s.replace(/\^(.)/g, '$1');
    if (!/^\s*(if|for)\s/i.test(text)) {
      text = text.replace(/(\d?)(>>?)\s*("[^"]*"|[^\s&|<>]+)|<\s*("[^"]*"|[^\s&|<>]+)/g, (m, fd, op, target, inFile, off) => {
        if (off > 0 && text[off - 1] === '^') return m;
        if (inFile !== undefined) { try { input = this.fs.read(this.vfs(inFile)); } catch { input = ''; this.fail = this.t('指定されたファイルが見つかりません。', 'File not found'); } return ''; }
        if (target === '&1') { errOut = out; return ''; }
        const nul = /^"?nul"?$/i.test(target);
        let sink;
        if (nul) sink = () => {};
        else {
          let p;
          try { p = this.vfs(target); if (op === '>' || !this.fs.exists(p)) this.fs.write(p, ''); } catch (e) { this.fail = e instanceof FsError ? this.t('アクセスが拒否されました。', 'Access denied') : e.message; return ''; }
          sink = s => this.fs.write(p, s, { append: true });
        }
        if (fd === '2') errOut = sink; else { out = sink; tty = false; }
        return '';
      });
      if (this.fail) { const f = this.fail; this.fail = null; this.term.write(f + '\n'); this.status = 1; return; }
    }
    text = text.trim();
    if (text.startsWith('(') && text.endsWith(')')) { for (const part of text.slice(1, -1).split(/\n/)) await this.exec(part, { in: input, out, tty }, bargs); return; }
    if (!text) return;
    let m = /^([^\s\/\\.,;=+(]+|\.+[^\s\/]*)(.*)$/s.exec(text) || [null, text, ''];
    let name = m[1], rest = m[2];
    // a path such as "foo\bar.bat" or ".\x" is a program name, not "foo" + switches
    if (/^[\\.]/.test(rest) && !/^(cd|chdir|md|mkdir|rd|rmdir|dir|echo|type|del|start)$/i.test(name)) { const mm = /^("[^"]*"|\S+)(.*)$/s.exec(text); name = mm[1].replace(/"/g, ''); rest = mm[2]; }
    if (text[0] === '"') { const mm = /^"([^"]*)"(.*)$/s.exec(text); if (mm) { name = mm[1]; rest = mm[2]; } }
    const ctx = { name: name.toLowerCase(), rest: noCaret(rest), raw: rest, argv: this.args(noCaret(rest).trim()), out, err: errOut, in: input, tty, bargs, io: { in: input, out, tty } };
    ctx.sw = ctx.argv.filter(a => /^\/[^\\/]+$/.test(a) || /^-[a-z?]$/i.test(a)).map(a => a.toLowerCase().replace(/^-/, '/'));
    ctx.files = ctx.argv.filter(a => !/^\/[^\\/]+$/.test(a)).map(a => a.replace(/"/g, ''));
    ctx.has = s => ctx.sw.some(x => x === s || x.startsWith(s + ':'));
    const fn = COMMANDS[ctx.name];
    try {
      if (fn && !(this.dos && WIN_ONLY.has(ctx.name))) {
        if (ctx.sw.includes('/?') && ctx.name !== 'echo') { const h = HELP.find(x => x[0].toLowerCase() === ctx.name); out((h ? h[1] : ctx.name.toUpperCase()) + '\n\n' + ctx.name.toUpperCase() + this.t(' [オプション]\n', ' [options]\n')); this.status = 0; return; }
        const st = await fn.call(this, ctx);
        if (typeof st === 'number') this.status = st;
      } else await this.external(name, ctx);
    } catch (e) {
      if (e instanceof FsError) { errOut(this.fsMsg(e) + '\n'); this.status = 1; }
      else if (e instanceof Abort || e instanceof Exit || e instanceof Goto) throw e;
      else if (e.name === 'Error' && !e.stack?.includes('cmd.js:')) { errOut(e.message + '\n'); this.status = 1; }
      else { errOut(e.message + '\n'); this.status = 1; }
    }
  }
  fsMsg(e) {
    return { ENOENT: this.t('指定されたファイルが見つかりません。', 'File not found'), ENOTDIR: this.t('指定されたパスが見つかりません。', 'Invalid directory'), EEXIST: this.t('サブディレクトリまたはファイルは既に存在します。', 'Directory already exists'), ENOTEMPTY: this.t('ディレクトリが空ではありません。', 'Directory not empty'), EISDIR: this.t('アクセスが拒否されました。', 'Access denied'), EACCES: this.t('アクセスが拒否されました。', 'Access denied'), EINVAL: this.t('パラメータが間違っています。', 'Invalid parameter') }[e.code] || e.message;
  }

  async external(name, ctx) {
    const base = name.toLowerCase().replace(/\.(exe|com)$/, '');
    if (!this.dos && GUI[base] && !/[\\/]/.test(name)) {
      if (!this.os.launch) { ctx.err('このシステムではウィンドウを開けません。\n'); this.status = 1; return; }
      const f = ctx.files[0];
      this.os.launch(GUI[base], base === 'iexplore' ? { url: f } : f ? { path: this.vfs(f) } : base === 'explorer' ? { path: this.cwd } : base === 'cmd' ? { cwd: this.cwd } : {});
      this.status = 0; return;
    }
    if (base === 'win' && this.dos) { ctx.out('\nStarting Windows...\n'); await this.sleep(900); if (this.os.power) this.os.power('xp'); await this.sleep(5000); return; }
    // batch files and documents on disk
    for (const cand of [name, name + '.bat', name + '.cmd']) {
      let p;
      try { p = this.vfs(cand); } catch { continue; }
      const n = this.fs.stat(p);
      if (!n || n.t !== 'f') continue;
      const ext = extname(p);
      if (ext === 'bat' || ext === 'cmd') return this.batch(n.d, [cand, ...ctx.argv.map(a => a.replace(/^"(.*)"$/, '$1'))], ctx.io);
      if (ext === 'exe' || ext === 'com') { if (COMMANDS[basename(p).replace(/\.\w+$/, '').toLowerCase()]) return COMMANDS[basename(p).replace(/\.\w+$/, '').toLowerCase()].call(this, ctx); ctx.err(this.t(`${this.win(p)} は有効な Win32 アプリケーションではありません。\n`, 'Cannot execute ' + cand + '\n')); this.status = 1; return; }
      if (this.os.openPath && !this.dos) { this.os.openPath(p); this.status = 0; return; }
    }
    ctx.err(this.t(`'${name}' は、内部コマンドまたは外部コマンド、\n操作可能なプログラムまたはバッチ ファイルとして認識されていません。\n`, 'Bad command or file name\n'));
    this.status = this.dos ? 1 : 9009;
  }

  async batch(src, args, io) {
    const lines = src.replace(/\r/g, '').split('\n');
    const labels = {};
    lines.forEach((l, i) => { const m = /^\s*:([^\s:]+)/.exec(l); if (m) labels[m[1].toLowerCase()] = i; });
    const saveEcho = this.echo;
    let pc = 0, guard = 0;
    try {
      while (pc < lines.length) {
        if (++guard > 100000) throw new Abort();
        await this.tick();
        let line = lines[pc++];
        if (/^\s*:/.test(line) || !line.trim()) continue;
        // gather a parenthesised block that spans lines
        while ((line.match(/\(/g) || []).length > (line.match(/\)/g) || []).length && pc < lines.length) line += '\n' + lines[pc++];
        const silent = /^\s*@/.test(line);
        if (this.echo && !silent) io.out(`\n${this.prompt()}${line.trim()}\n`);
        try { await this.exec(line.replace(/\n\s*/g, ' & ').replace(/\(\s*&/g, '(').replace(/&\s*\)/g, ')'), io, args); }
        catch (e) {
          if (!(e instanceof Goto)) throw e;
          const lab = e.label.toLowerCase().replace(/^:/, '');
          if (lab === 'eof') return;
          if (!(lab in labels)) throw e;
          pc = labels[lab] + 1;
        }
      }
    } catch (e) { if (e instanceof Exit && e.batchOnly) { this.status = e.code ?? this.status; return; } throw e; }
    finally { this.echo = saveEcho; }
  }

  procs() {
    const base = [['System Idle Process', 0, 16], ['System', 4, 212], ['smss.exe', 548, 372], ['csrss.exe', 612, 3164], ['winlogon.exe', 636, 4128], ['services.exe', 680, 3204], ['lsass.exe', 692, 1412], ['svchost.exe', 852, 4460], ['svchost.exe', 936, 3980], ['svchost.exe', 1028, 18220], ['spoolsv.exe', 1364, 4312], ['explorer.exe', 1580, 17904], ['ctfmon.exe', 1712, 2896]].map(([name, pid, mem]) => ({ name, pid, mem, sys: pid < 1500 }));
    const apps = (this.os.procs ? this.os.procs() : []).map(p => ({ name: p.exe || p.cmd, pid: p.pid, mem: 6000 + (p.pid * 37) % 9000, kill: p.kill }));
    return [...base, ...apps];
  }
}

const WIN_ONLY = new Set(['start', 'tasklist', 'taskkill', 'systeminfo', 'shutdown', 'ipconfig', 'ping', 'color', 'title', 'findstr', 'hostname', 'xcopy', 'pushd', 'popd', 'setlocal', 'endlocal', 'tracert', 'net', 'telnet', 'doskey']);

function dirList(sh, ctx, target) {
  const fs = sh.fs, out = ctx.out, bare = ctx.has('/b'), wide = ctx.has('/w'), rec = ctx.has('/s'), all = ctx.has('/a');
  const order = (ctx.sw.find(s => s.startsWith('/o')) || '/on').slice(2).replace(':', '') || 'n';
  let v, pat = null;
  v = sh.vfs(target || '.');
  if (!fs.isDir(v)) { pat = basename(v); v = dirname(v); if (!fs.isDir(v)) { out(sh.t('指定されたパスが見つかりません。\n', 'Path not found\n')); return 1; } }
  const re = pat ? globToRe(pat === '*.*' ? '*' : pat, { ci: true }) : null;
  let totalF = 0, totalB = 0, totalD = 0, shown = false;
  const fmtDate = mt => { const d = new Date(mt); return sh.dos ? `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getFullYear() % 100)}  ${String(d.getHours() % 12 || 12).padStart(2)}:${pad2(d.getMinutes())}${d.getHours() < 12 ? 'a' : 'p'}` : `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}  ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  const one = dir => {
    const node = fs.stat(dir);
    let ents = Object.keys(node.c).filter(n => (!re || re.test(n) || (pat.endsWith('.*') && re.test(n + '.'))) && (all || !n.startsWith('.'))).map(n => [n, node.c[n]]);
    const dirsFirst = (a, b) => (b[1].t === 'd') - (a[1].t === 'd');
    const cmp = { n: (a, b) => a[0].localeCompare(b[0], 'ja', { sensitivity: 'base' }), s: (a, b) => fs.size(a[1]) - fs.size(b[1]), d: (a, b) => a[1].mt - b[1].mt, e: (a, b) => extname(a[0]).localeCompare(extname(b[0])) }[order.replace('-', '')[0]] || (() => 0);
    ents.sort((a, b) => (order.includes('g') ? dirsFirst(a, b) : 0) || (order.startsWith('-') ? -cmp(a, b) : cmp(a, b)));
    if (!ents.length && (re || rec)) return;
    shown = true;
    if (bare) { for (const [n] of ents) out((rec ? sh.win(join(dir, n)) : n) + '\n'); return; }
    out(sh.t(`\n ${sh.win(dir)} のディレクトリ\n\n`, `\n Directory of ${sh.win(dir)}\n\n`));
    if (dir !== '/' && !re) ents = [['.', node], ['..', node], ...ents];
    let nf = 0, nb = 0, nd = 0;
    if (wide) { out(columnize(ents.map(([n, e]) => (e.t === 'd' ? `[${n}]` : n)), sh.term.cols - 1, 3)); ents.forEach(([, e]) => { if (e.t === 'd') nd++; else { nf++; nb += fs.size(e); } }); }
    else for (const [n, e] of ents) {
      if (e.t === 'd') { nd++; out(sh.dos ? `${n.toUpperCase().padEnd(12)} <DIR>        ${fmtDate(e.mt)}\n` : `${fmtDate(e.mt)}    <DIR>          ${n}\n`); }
      else {
        const sz = fs.size(e); nf++; nb += sz;
        if (sh.dos) { const dot = n.lastIndexOf('.'); out(`${(dot > 0 ? n.slice(0, dot) : n).toUpperCase().slice(0, 8).padEnd(8)} ${(dot > 0 ? n.slice(dot + 1) : '').toUpperCase().slice(0, 3).padEnd(3)} ${comma(sz).padStart(13)} ${fmtDate(e.mt)}\n`); }
        else out(`${fmtDate(e.mt)} ${comma(sz).padStart(17)} ${n}\n`);
      }
    }
    out(sh.t(`${String(nf).padStart(16)} 個のファイル ${comma(nb).padStart(19)} バイト\n`, `${String(nf).padStart(9)} file(s) ${comma(nb).padStart(14)} bytes\n`));
    totalF += nf; totalB += nb; totalD += nd;
    if (!rec) out(sh.t(`${String(nd).padStart(16)} 個のディレクトリ  ${comma(freeBytes(sh))} バイトの空き領域\n`, `${comma(freeBytes(sh)).padStart(33)} bytes free\n`));
  };
  if (!bare) out(sh.t(` ドライブ C のボリューム ラベルがありません。\n ボリューム シリアル番号は 3C5A-1F0B です\n`, `\n Volume in drive C is MS-DOS_6\n Volume Serial Number is 1F0B-3C5A\n`));
  if (rec) fs.walk(v, (p, n) => { if (n.t === 'd') one(p); }); else one(v);
  if (!shown) { out(sh.t(bare ? 'ファイルが見つかりません\n' : `\n ${sh.win(v)} のディレクトリ\n\nファイルが見つかりません\n`, 'File not found\n')); return 1; }
  if (rec && !bare) out(sh.t(`\n     ファイルの総数:\n${String(totalF).padStart(16)} 個のファイル ${comma(totalB).padStart(19)} バイト\n${String(totalD).padStart(16)} 個のディレクトリ  ${comma(freeBytes(sh))} バイトの空き領域\n`, `\nTotal files listed:\n${String(totalF).padStart(9)} file(s) ${comma(totalB).padStart(14)} bytes\n`));
  return 0;
}
const freeBytes = sh => (sh.dos ? 104857600 : 38654705664) - sh.fs.du(sh.fs.root);
const yes = async (sh, q) => { const a = await sh.term.readLine({ prompt: q }); if (a === INTR) { sh.abort = true; throw new Abort(); } return /^y/i.test(a || ''); };

const COMMANDS = {
  cd(c) {
    const t = c.rest.trim().replace(/^\/d\s+/i, '').replace(/"/g, '');
    if (!t) return void c.out(this.win(this.cwd) + '\n');
    const p = this.vfs(t), n = this.fs.stat(p);
    if (!n || n.t !== 'd') { c.err(this.t('指定されたパスが見つかりません。\n', 'Invalid directory\n')); return 1; }
    this.cwd = this.fs.realpath(p); return 0;
  },
  chdir(c) { return COMMANDS.cd.call(this, c); },
  dir(c) { let st = 0; const targets = c.files.length ? c.files : ['']; for (const t of targets) st = dirList(this, c, t) || st; return st; },
  cls() { this.term.clear(); },
  ver(c) { c.out(`\n${this.ver()}\n`); },
  vol(c) { c.out(this.t(' ドライブ C のボリューム ラベルがありません。\n ボリューム シリアル番号は 3C5A-1F0B です\n', '\n Volume in drive C is MS-DOS_6\n Volume Serial Number is 1F0B-3C5A\n')); },
  echo(c) {
    const r = c.raw.replace(/\^(.)/g, '$1');
    const t = r.replace(/^[\s.,;:=\/\\+([]/, '');
    if (!r.trim() && !/^[.,;:=\/\\+([]/.test(r)) return void c.out(this.t(`ECHO は <${this.echo ? 'ON' : 'OFF'}> です。\n`, `ECHO is ${this.echo ? 'on' : 'off'}\n`));
    if (/^(on|off)$/i.test(t.trim()) && r[0] !== '.') { this.echo = /^on$/i.test(t.trim()); return; }
    c.out(t + '\n');
  },
  rem() { },
  pause: async function (c) { c.out(this.t('続行するには何かキーを押してください . . . ', 'Press any key to continue . . . ')); await this.term.readKey(); c.out('\n'); this.check(); },
  exit(c) { const e = new Exit(c.files[0] !== undefined ? +c.files[0] : undefined); if (c.has('/b') && c.bargs) e.batchOnly = true; throw e; },
  title(c) { if (this.term.onTitle) this.term.onTitle(c.rest.trim()); },
  color(c) {
    const a = c.rest.trim();
    if (!a) { this.term.setColors(); return 0; }
    if (!/^[0-9a-f]{1,2}$/i.test(a) || (a.length === 2 && a[0].toLowerCase() === a[1].toLowerCase())) { c.out('コンソールの文字と背景の既定の色を設定します。\n\nCOLOR [属性]\n\n  属性   コンソール出力の色属性を指定します。  例: COLOR 0A (黒地に明るい緑)\n'); return 1; }
    const [bg, fg] = a.length === 2 ? a : '0' + a;
    this.term.setColors(CGA[parseInt(fg, 16)], CGA[parseInt(bg, 16)]); return 0;
  },
  prompt(c) { this.setenv('PROMPT', c.rest.trim() || '$P$G'); },
  path(c) { const a = c.rest.trim(); if (!a) return void c.out(`PATH=${this.getenv('PATH')}\n`); this.setenv('PATH', a === ';' ? '' : a); },
  set: async function (c) {
    const a = c.rest.replace(/^\s+/, '');
    if (!a) { for (const k of Object.keys(this.env).sort((x, y) => x.localeCompare(y, 'en', { sensitivity: 'base' }))) c.out(`${k}=${this.env[k]}\n`); return 0; }
    let m;
    if ((m = /^\/a\s+(.*)$/i.exec(a))) {
      let v = 0;
      try { for (const part of m[1].replace(/"/g, '').split(',')) v = evalArith(part, { get: n => this.getenv(n) ?? 0, set: (n, x) => this.setenv(n, String(x)) }); }
      catch (e) { c.err(/division/.test(e.message) ? this.t('ゼロによる除算です。\n', 'Divide by zero error.\n') : this.t('オペランドがありません。\n', 'Missing operand.\n')); return 1; }
      if (!c.bargs) c.out(String(v));
      return 0;
    }
    if ((m = /^\/p\s+"?([^=]+)=(.*?)"?$/i.exec(a))) { const v = await this.term.readLine({ prompt: m[2] }); if (v === INTR) { this.abort = true; throw new Abort(); } if (v) this.setenv(m[1], v); return 0; }
    if ((m = /^"?([^=]+)=(.*?)"?$/.exec(a))) { this.setenv(m[1], m[2]); return 0; }
    const hits = Object.keys(this.env).filter(k => k.toUpperCase().startsWith(a.trim().toUpperCase()));
    if (!hits.length) { c.err(this.t(`環境変数 ${a.trim()} が定義されていません\n`, `Environment variable ${a.trim()} not defined\n`)); return 1; }
    for (const k of hits.sort()) c.out(`${k}=${this.env[k]}\n`);
    return 0;
  },
  date: async function (c) {
    if (c.has('/t')) return void c.out(this.date() + ' \n');
    c.out(this.t(`現在の日付: ${this.date()} \n`, `Current date is ${new Date().toLocaleString('en-US', { weekday: 'short' })} ${this.date()}\n`));
    await this.term.readLine({ prompt: this.t('新しい日付を入力してください: (年-月-日) ', 'Enter new date (mm-dd-yy): ') });
  },
  time: async function (c) {
    const d = new Date();
    if (c.has('/t')) return void c.out(`${pad2(d.getHours())}:${pad2(d.getMinutes())}\n`);
    c.out(this.t(`現在の時刻: ${this.getenv('TIME')}\n`, `Current time is ${this.getenv('TIME')}\n`));
    await this.term.readLine({ prompt: this.t('新しい時刻を入力してください: ', 'Enter new time: ') });
  },
  type(c) {
    if (!c.files.length) { c.err(this.t('コマンドの構文が誤っています。\n', 'Required parameter missing\n')); return 1; }
    let st = 0;
    for (const f of c.files) {
      const hits = this.glob(f);
      if (!hits.length) { c.err(this.t('指定されたファイルが見つかりません。\n', `File not found - ${f}\n`)); st = 1; continue; }
      for (const h of hits) {
        if (this.fs.isDir(h.path)) { c.err(this.t('アクセスが拒否されました。\n', 'Access denied\n')); st = 1; continue; }
        if (hits.length > 1 || c.files.length > 1) c.err(`\n${h.name}\n\n\n`);
        const t = this.fs.read(h.path); c.out(t.endsWith('\n') || !t ? t : t + '\n');
      }
    }
    return st;
  },
  more: async function (c) {
    let text = c.in;
    if (c.files.length) text = this.fs.read(this.vfs(c.files[0]));
    if (text == null) return;
    const ls = text.replace(/\n$/, '').split('\n');
    if (!c.tty) return void c.out(text);
    for (let i = 0; i < ls.length; i++) {
      c.out(ls[i] + '\n');
      if ((i + 1) % (this.term.rows - 1) === 0 && i < ls.length - 1) { c.out('-- More  -- '); const k = await this.term.readKey(); c.out('\r            \r'); this.check(); if (k.key === 'q') break; }
    }
  },
  md(c) {
    if (!c.files.length) { c.err(this.t('コマンドの構文が誤っています。\n', 'Required parameter missing\n')); return 1; }
    let st = 0;
    for (const f of c.files) { const p = this.vfs(f); if (this.fs.exists(p)) { c.err(this.t(`サブディレクトリまたはファイル ${f} は既に存在します。\n`, 'Directory already exists\n')); st = 1; } else this.fs.mkdir(p, { p: true }); }
    return st;
  },
  mkdir(c) { return COMMANDS.md.call(this, c); },
  rd: async function (c) {
    if (!c.files.length) { c.err(this.t('コマンドの構文が誤っています。\n', 'Required parameter missing\n')); return 1; }
    let st = 0;
    for (const f of c.files) {
      const p = this.vfs(f), n = this.fs.stat(p);
      if (!n) { c.err(this.t('指定されたファイルが見つかりません。\n', 'Invalid path, not directory,\nor directory not empty\n')); st = 1; continue; }
      if (n.t !== 'd') { c.err(this.t('ディレクトリ名が無効です。\n', 'Invalid path, not directory,\nor directory not empty\n')); st = 1; continue; }
      if (p === this.cwd || (this.cwd + '/').startsWith(p + '/')) { c.err(this.t('プロセスはファイルにアクセスできません。別のプロセスが使用中です。\n', 'Attempt to remove current directory\n')); st = 1; continue; }
      if (c.has('/s')) { if (!c.has('/q') && !(await yes(this, `${f}、よろしいですか (Y/N)? `))) continue; this.fs.rm(p, { r: true }); }
      else if (Object.keys(n.c).length) { c.err(this.t('ディレクトリが空ではありません。\n', 'Invalid path, not directory,\nor directory not empty\n')); st = 1; }
      else this.fs.rmdir(p);
    }
    return st;
  },
  rmdir(c) { return COMMANDS.rd.call(this, c); },
  del: async function (c) {
    if (!c.files.length) { c.err(this.t('コマンドの構文が誤っています。\n', 'Required parameter missing\n')); return 1; }
    let st = 0;
    for (const f of c.files) {
      let target = f;
      try { if (this.fs.isDir(this.vfs(f))) target = f.replace(/[\\/]$/, '') + '\\*'; } catch { /* reported below */ }
      const hits = this.glob(target).filter(h => !this.fs.isDir(h.path));
      if (!hits.length) { c.err(this.t(`${this.win(this.vfs(f)).replace(/^C:\\$/, 'C:\\')} が見つかりませんでした。\n`, 'File not found\n')); st = 1; continue; }
      if (/\*(\.\*)?$/.test(target) && !c.has('/q') && !(await yes(this, this.t(`${this.win(dirname(this.vfs(target)))}\\*、よろしいですか (Y/N)? `, 'All files in directory will be deleted!\nAre you sure (Y/N)?')))) continue;
      for (const h of hits) this.fs.unlink(h.path);
    }
    return st;
  },
  erase(c) { return COMMANDS.del.call(this, c); },
  copy: async function (c) {
    if (c.files.length < 1) { c.err(this.t('コマンドの構文が誤っています。\n', 'Required parameter missing\n')); return 1; }
    const [src, dstArg] = c.files, fs = this.fs;
    if (/^con$/i.test(src)) {
      const ls = [];
      for (;;) {
        const l = await this.term.readLine({ onKey: (ev, rl) => { if (ev.ctrl && ev.key === 'z') { rl.buf.push('^', 'Z'); rl.pos = rl.buf.length; return true; } return false; } });
        if (l === INTR) { this.abort = true; throw new Abort(); }
        const z = l.indexOf('^Z');
        if (z >= 0) { if (z > 0) ls.push(l.slice(0, z)); break; }
        ls.push(l);
      }
      fs.write(this.vfs(dstArg), ls.map(l => l + '\n').join(''));
      c.out(this.t('        1 個のファイルをコピーしました。\n', '        1 file(s) copied\n')); return 0;
    }
    const parts = src.split('+');
    if (parts.length > 1) { fs.write(this.vfs(dstArg || parts[0]), parts.map(p => fs.read(this.vfs(p))).join('')); c.out(this.t('        1 個のファイルをコピーしました。\n', '        1 file(s) copied\n')); return 0; }
    let hits = this.glob(src);
    if (hits.length === 1 && fs.isDir(hits[0].path)) hits = this.glob(src.replace(/[\\/]$/, '') + '\\*');
    hits = hits.filter(h => !fs.isDir(h.path));
    if (!hits.length) { c.err(this.t('指定されたファイルが見つかりません。\n', `File not found - ${src}\n`)); return 1; }
    const dst = this.vfs(dstArg || '.'), intoDir = fs.isDir(dst);
    if (hits.length > 1 && !intoDir && dstArg) { let all = ''; for (const h of hits) all += fs.read(h.path); fs.write(dst, all); c.out(hits.map(h => h.name).join('\n') + this.t('\n        1 個のファイルをコピーしました。\n', '\n        1 file(s) copied\n')); return 0; }
    let n = 0;
    for (const h of hits) {
      const to = intoDir ? join(dst, h.name) : dst;
      if (to === h.path) { c.err(this.t('同じファイルへ上書きすることはできません。\n', 'File cannot be copied onto itself\n')); c.out(this.t('        0 個のファイルをコピーしました。\n', '        0 file(s) copied\n')); return 1; }
      if (fs.exists(to) && !c.has('/y') && !c.bargs && c.tty) { const a = await this.term.readLine({ prompt: this.t(`${this.win(to)} を上書きしますか? (Yes/No/All): `, `Overwrite ${this.win(to)} (Yes/No/All)?`) }); if (!/^[ya]/i.test(a === INTR ? '' : a || '')) continue; }
      if (hits.length > 1) c.out(this.win(h.path) + '\n');
      fs.copy(h.path, to); n++;
    }
    c.out(this.t(`        ${n} 個のファイルをコピーしました。\n`, `        ${n} file(s) copied\n`));
    return 0;
  },
  xcopy(c) {
    if (c.files.length < 2) { c.err('パラメータの数が無効です\n0 個のファイルをコピーしました\n'); return 4; }
    const fs = this.fs, src = this.vfs(c.files[0]), dst = this.vfs(c.files[1]);
    if (!fs.exists(src)) { c.err(`ファイルが見つかりません - ${basename(src)}\n0 個のファイルをコピーしました\n`); return 4; }
    let n = 0;
    if (fs.isDir(src)) {
      fs.mkdir(dst, { p: true });
      fs.walk(src, (p, node) => {
        const rel = p.slice(src.length), to = dst + rel;
        if (node.t === 'd') { if ((c.has('/e') || c.has('/s')) || rel === '') fs.mkdir(to, { p: true }); return; }
        if (rel.split('/').length > 2 && !(c.has('/e') || c.has('/s'))) return;
        fs.mkdir(dirname(to), { p: true }); fs.copy(p, to); c.out(this.win(p) + '\n'); n++;
      });
    } else { fs.copy(src, fs.isDir(dst) ? join(dst, basename(src)) : dst); c.out(this.win(src) + '\n'); n = 1; }
    c.out(`${n} 個のファイルをコピーしました\n`);
    return 0;
  },
  move(c) {
    if (c.files.length < 2) { c.err(this.t('コマンドの構文が誤っています。\n', 'Required parameter missing\n')); return 1; }
    const hits = this.glob(c.files[0]), dst = this.vfs(c.files[1]);
    if (!hits.length) { c.err(this.t('指定されたファイルが見つかりません。\n', 'File not found\n')); return 1; }
    for (const h of hits) this.fs.rename(h.path, this.fs.isDir(dst) ? join(dst, h.name) : dst);
    if (!this.dos) c.out(`        ${hits.length} 個のファイルを移動しました。\n`);
    return 0;
  },
  ren(c) {
    if (c.files.length < 2) { c.err(this.t('コマンドの構文が誤っています。\n', 'Required parameter missing\n')); return 1; }
    const p = this.vfs(c.files[0]);
    if (!this.fs.lstat(p)) { c.err(this.t('指定されたファイルが見つかりません。\n', 'File not found\n')); return 1; }
    if (/[\\/:]/.test(c.files[1])) { c.err(this.t('コマンドの構文が誤っています。\n', 'Invalid parameter\n')); return 1; }
    const to = join(dirname(p), c.files[1]);
    if (this.fs.exists(to) && this.fs.realpath(to) !== this.fs.realpath(p)) { c.err(this.t('重複するファイル名が存在するか、またはファイルが見つかりません。\n', 'Duplicate file name or file not found\n')); return 1; }
    this.fs.rename(p, to); return 0;
  },
  rename(c) { return COMMANDS.ren.call(this, c); },
  attrib(c) {
    const hits = this.glob(c.files[0] || '*');
    if (!hits.length) { c.err(this.t(`ファイルが見つかりません - ${c.files[0]}\n`, 'File not found\n')); return 1; }
    for (const h of hits) if (!this.fs.isDir(h.path)) c.out(`A          ${this.win(h.path)}\n`);
  },
  tree(c) {
    const root = this.vfs(c.files[0] || '.'), fs = this.fs, files = c.has('/f'), ascii = c.has('/a');
    const [T, L, V] = ascii ? ['+---', '\\---', '|   '] : ['\u251c\u2500\u2500\u2500', '\u2514\u2500\u2500\u2500', '\u2502   '];
    c.out(this.t('フォルダ パスの一覧\nボリューム シリアル番号は 3C5A-1F0B です\n', 'Directory PATH listing\nVolume serial number is 1F0B-3C5A\n') + (c.files[0] ? this.win(root).toUpperCase() : 'C:.') + '\n');
    let any = false;
    const walk = (dir, prefix) => {
      const node = fs.stat(dir), names = Object.keys(node.c).sort((a, b) => a.localeCompare(b, 'ja', { sensitivity: 'base' }));
      const dirs = names.filter(n => node.c[n].t === 'd');
      if (files) { for (const n of names.filter(x => node.c[x].t !== 'd')) c.out(prefix + (dirs.length ? V : '    ') + n + '\n'); if (names.length > dirs.length) c.out(prefix + (dirs.length ? V : '    ').trimEnd() + '\n'); }
      dirs.forEach((n, i) => { any = true; const last = i === dirs.length - 1; c.out(prefix + (last ? L : T) + n + '\n'); walk(join(dir, n), prefix + (last ? '    ' : V)); });
    };
    walk(root, '');
    if (!any && !files) c.out(this.t('サブフォルダは存在しません\n\n', 'No subfolders exist\n\n'));
  },
  find(c) {
    const m = /"([^"]*)"/.exec(c.rest);
    if (!m) { c.err(this.t('FIND: パラメータの書式が違います\n', 'FIND: Parameter format not correct\n')); return 2; }
    const files = this.args(c.rest.replace(m[0], '')).filter(a => !/^\/[a-z]$/i.test(a)).map(a => a.replace(/"/g, ''));
    const ci = c.has('/i'), inv = c.has('/v'), cnt = c.has('/c'), num = c.has('/n');
    const test = l => (ci ? l.toLowerCase().includes(m[1].toLowerCase()) : l.includes(m[1])) !== inv;
    let any = false;
    const scan = (text, label) => {
      const ls = text.replace(/\n$/, '').split('\n'), hits = ls.map((l, i) => [l, i]).filter(([l]) => test(l));
      if (hits.length) any = true;
      if (label !== null) c.out(`\n---------- ${label.toUpperCase()}${cnt ? `: ${hits.length}` : ''}\n`); else if (cnt) c.out(hits.length + '\n');
      if (!cnt) for (const [l, i] of hits) c.out((num ? `[${i + 1}]` : '') + l + '\n');
    };
    if (!files.length) scan(c.in || '', null);
    else for (const f of files) { const hits = this.glob(f); if (!hits.length) { c.err(this.t(`ファイルが見つかりません - ${f.toUpperCase()}\n`, `File not found - ${f.toUpperCase()}\n`)); continue; } for (const h of hits) if (!this.fs.isDir(h.path)) scan(this.fs.read(h.path), this.win(h.path).replace(this.win(this.cwd) + '\\', '')); }
    return any ? 0 : 1;
  },
  findstr(c) {
    const a = c.argv.filter(x => !/^\/[a-z]$/i.test(x) && !/^\/c:/i.test(x)).map(x => x.replace(/"/g, ''));
    const lit = (c.argv.find(x => /^\/c:/i.test(x)) || '').slice(3).replace(/"/g, '');
    const pats = lit ? [lit] : (a.shift() || '').split(' ').filter(Boolean);
    if (!pats.length) { c.err('FINDSTR: コマンド ラインが間違っています\n'); return 2; }
    const flags = c.has('/i') ? 'i' : '';
    const res = pats.map(p => new RegExp(c.has('/l') || lit ? p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : p.replace(/[+?{}()|]/g, '\\$&'), flags));
    let any = false;
    const scan = (text, label) => text.replace(/\n$/, '').split('\n').forEach((l, i) => { if (res.some(r => r.test(l)) !== c.has('/v')) { any = true; c.out((label ? label + ':' : '') + (c.has('/n') ? `${i + 1}:` : '') + l + '\n'); } });
    if (!a.length) scan(c.in || '', '');
    else { const all = a.flatMap(f => this.glob(f)).filter(h => !this.fs.isDir(h.path)); for (const h of all) scan(this.fs.read(h.path), all.length > 1 ? h.name : ''); }
    return any ? 0 : 1;
  },
  sort(c) {
    const text = c.files.length ? this.fs.read(this.vfs(c.files[0])) : c.in || '';
    const ls = text.replace(/\n$/, '').split('\n').sort((x, y) => x.localeCompare(y, 'ja', { sensitivity: 'base' }));
    if (c.has('/r')) ls.reverse();
    c.out(ls.join('\n') + '\n');
  },
  hostname(c) { c.out(this.host + '\n'); },
  help(c) {
    if (c.files[0]) { const h = HELP.find(x => x[0].toLowerCase() === c.files[0].toLowerCase()); if (h) return void c.out(h[1] + '\n'); c.out('このコマンドは、ヘルプ ユーティリティではサポートされていません。\n'); return 1; }
    c.out(this.t('特定のコマンドの詳細情報は、"HELP コマンド名" を入力してください\n', 'For more information on a specific command, type HELP command-name\n'));
    for (const [n, d] of HELP) if (!(this.dos && WIN_ONLY.has(n.toLowerCase()))) c.out(n.padEnd(9) + d + '\n');
  },
  doskey(c) { if (c.has('/history') || c.has('/h')) this.history.forEach(h => c.out(h + '\n')); },
  pushd(c) { const old = this.cwd; const st = COMMANDS.cd.call(this, c); if (!st && c.rest.trim()) this.dirstack.push(old); return st; },
  popd() { const d = this.dirstack.pop(); if (d) this.cwd = d; },
  setlocal() { }, endlocal() { }, shift(c) { if (c.bargs) c.bargs.splice(1, 1); },
  goto(c) { throw new Goto(c.rest.trim().split(/\s/)[0] || ''); },
  call: async function (c) {
    const t = c.rest.trim();
    if (t[0] === ':') { c.err('このバッチ機能 (CALL :label) は使用できません。\n'); return 1; }
    await this.exec(t, c.io, undefined);
  },
  start: async function (c) {
    const a = c.files.filter(x => !/^".*"$/.test(x));
    if (!this.os.launch) { c.err('このシステムではウィンドウを開けません。\n'); return 1; }
    const t = a[0];
    if (!t) { this.os.launch('terminal', { cwd: this.cwd }); return 0; }
    if (/^(https?:\/\/|www\.)/i.test(t)) { this.os.launch('browser', { url: t }); return 0; }
    const base = t.toLowerCase().replace(/\.exe$/, '');
    if (GUI[base]) { this.os.launch(GUI[base], a[1] ? { path: this.vfs(a[1]) } : base === 'explorer' ? { path: this.cwd } : {}); return 0; }
    const p = this.vfs(t);
    if (!this.fs.exists(p)) { c.err(`ファイル '${t}' (またはそのコンポーネントの 1 つ) が見つかりません。名前を正しく入力したかどうかを確認し、再実行してください。\n`); return 1; }
    this.os.openPath ? this.os.openPath(p) : this.os.launch('files', { path: p });
    return 0;
  },
  if: async function (c) {
    let s = c.raw.trim(), not = false, ci = false;
    for (;;) { const m = /^(not|\/i)\s+/i.exec(s); if (!m) break; if (m[1].toLowerCase() === 'not') not = !not; else ci = true; s = s.slice(m[0].length); }
    let cond, m;
    if ((m = /^exist\s+("[^"]*"|\S+)\s*/i.exec(s))) { let ok = false; try { ok = this.glob(m[1]).length > 0; } catch { /* other drive */ } cond = ok; }
    else if ((m = /^defined\s+(\S+)\s*/i.exec(s))) cond = this.getenv(m[1]) !== undefined;
    else if ((m = /^errorlevel\s+(-?\d+)\s*/i.exec(s))) cond = this.status >= +m[1];
    else if ((m = /^("[^"]*"|[^\s=]*)\s*(==|\s(?:equ|neq|lss|leq|gtr|geq)\s)\s*("[^"]*"|\S*)\s*/i.exec(s))) {
      let a = m[1], b = m[3]; const op = m[2].trim().toLowerCase();
      if (ci) { a = a.toLowerCase(); b = b.toLowerCase(); }
      const num = /^-?\d+$/.test(a) && /^-?\d+$/.test(b), x = num ? +a : a, y = num ? +b : b;
      cond = { '==': a === b, equ: x === y, neq: x !== y, lss: x < y, leq: x <= y, gtr: x > y, geq: x >= y }[op];
    } else { c.err(this.t('コマンドの構文が誤っています。\n', 'Syntax error\n')); return 1; }
    s = s.slice(m[0].length);
    // "(then) else (other)" or "then-cmd"
    let thenPart = s, elsePart = null;
    if (s.startsWith('(')) { let d = 0, i = 0; for (; i < s.length; i++) { if (s[i] === '(') d++; else if (s[i] === ')' && --d === 0) break; } thenPart = s.slice(1, i); const r = /^\s*else\s+(.*)$/is.exec(s.slice(i + 1)); if (r) elsePart = r[1].trim().replace(/^\((.*)\)$/s, '$1'); }
    else { const r = /^(.*?)\s+else\s+(.*)$/is.exec(s); if (r && /\)\s*$/.test(r[1]) === false && /^\(/.test(r[2])) { thenPart = r[1]; elsePart = r[2].replace(/^\((.*)\)$/s, '$1'); } }
    const run = cond !== not ? thenPart : elsePart;
    if (run) await this.exec(run, c.io, c.bargs);
  },
  for: async function (c) {
    const m = /^\s*(\/[ldr]\s+)?%%?([A-Za-z])\s+in\s+\(([^)]*)\)\s+do\s+(.*)$/is.exec(c.raw);
    if (!m) { c.err(this.t('コマンドの構文が誤っています。\n', 'Syntax error\n')); return 1; }
    const [, sw, v, setRaw, bodyRaw] = m;
    let items = [];
    if (sw && /l/i.test(sw)) { const [a, st, b] = setRaw.split(/[\s,]+/).filter(Boolean).map(Number); if (st) for (let x = a, k = 0; (st > 0 ? x <= b : x >= b) && k < 100000; x += st, k++) items.push(String(x)); }
    else for (const it of this.args(setRaw.replace(/,/g, ' '))) { if (/[*?]/.test(it)) items.push(...this.glob(it).filter(h => (sw && /d/i.test(sw)) === this.fs.isDir(h.path)).map(h => (/[\\/]/.test(it) ? it.replace(/[^\\/]*$/, '') : '') + h.name)); else items.push(it.replace(/^"(.*)"$/, '$1')); }
    const body = bodyRaw.trim().replace(/^\((.*)\)$/s, '$1');
    for (const it of items) { await this.tick(); await this.exec(body.replace(new RegExp(`%%?${v}`, 'g'), () => it), c.io, c.bargs); }
  },

  // ---- "external" programs
  ipconfig(c) {
    const all = c.has('/all');
    c.out(`\nWindows IP Configuration\n\n${all ? `        Host Name . . . . . . . . . . . . : ${this.host}\n        Primary Dns Suffix  . . . . . . . :\n        Node Type . . . . . . . . . . . . : Unknown\n        IP Routing Enabled. . . . . . . . : No\n        WINS Proxy Enabled. . . . . . . . : No\n\n` : '\n'}Ethernet adapter ローカル エリア接続:\n\n        Connection-specific DNS Suffix  . :\n${all ? '        Description . . . . . . . . . . . : Fetch API Fast Ethernet Adapter\n        Physical Address. . . . . . . . . : 08-00-27-4E-66-A1\n        Dhcp Enabled. . . . . . . . . . . : Yes\n' : ''}        IP Address. . . . . . . . . . . . : 192.168.1.42\n        Subnet Mask . . . . . . . . . . . : 255.255.255.0\n        Default Gateway . . . . . . . . . : 192.168.1.1\n${all ? '        DHCP Server . . . . . . . . . . . : 192.168.1.1\n        DNS Servers . . . . . . . . . . . : 192.168.1.1\n' : ''}`);
  },
  ping: async function (c) {
    const host = c.files.find(a => !/^-/.test(a) && !/^\d+$/.test(a));
    if (!host) { c.out('\nUsage: ping [-t] [-n count] target_name\n'); return 1; }
    const ni = c.argv.findIndex(a => /^[-/]n$/i.test(a)), n = c.argv.some(a => /^[-/]t$/i.test(a)) ? Infinity : ni >= 0 ? +c.argv[ni + 1] || 4 : 4;
    const ip = await resolve(host);
    if (!ip) { c.out(`Ping request could not find host ${host}. Please check the name and try again.\n`); return 1; }
    const local = ip.startsWith('127.') || ip.startsWith('192.168.');
    c.out(`\nPinging ${host === ip ? ip : `${host} [${ip}]`} with 32 bytes of data:\n\n`);
    const times = [];
    let sent = 0;
    const stats = () => { c.out(`\nPing statistics for ${ip}:\n    Packets: Sent = ${sent}, Received = ${times.length}, Lost = ${sent - times.length} (${sent ? Math.round(((sent - times.length) / sent) * 100) : 0}% loss),\n`); if (times.length) c.out(`Approximate round trip times in milli-seconds:\n    Minimum = ${Math.min(...times)}ms, Maximum = ${Math.max(...times)}ms, Average = ${Math.round(times.reduce((a, b) => a + b, 0) / times.length)}ms\n`); };
    try {
      for (let i = 0; i < n; i++) {
        sent++;
        let ms = 0;
        if (!local) { const t = performance.now(); try { await fetch(`https://${host}/favicon.ico?_=${Date.now()}`, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(3000) }); ms = Math.max(1, Math.round((performance.now() - t) / (i ? 3 : 6))); } catch { ms = null; } }
        this.check();
        if (ms === null) c.out('Request timed out.\n'); else { times.push(ms); c.out(`Reply from ${ip}: bytes=32 time${ms < 1 ? '<1ms' : '=' + ms + 'ms'} TTL=${local ? 128 : 117}\n`); }
        if (i < n - 1) await this.sleep(1000);
      }
    } catch (e) { stats(); c.out('Control-C\n'); throw e; }
    stats();
    return times.length ? 0 : 1;
  },
  systeminfo: async function (c) {
    c.out('\n'); await this.sleep(500);
    const up = Date.now() - (this.os.bootTime || this.started), h = Math.floor(up / 36e5), mi = Math.floor(up / 6e4) % 60, s = Math.floor(up / 1000) % 60;
    c.out(`ホスト名:               ${this.host}\nOS 名:                  Microsoft Windows XP Professional\nOS バージョン:          5.1.2600 Service Pack 3 ビルド 2600\nOS 製造元:              Microsoft Corporation\nOS 構成:                スタンドアロン ワークステーション\nOS ビルドの種類:        Uniprocessor Free\n登録されている所有者:   ${this.user}\nプロダクト ID:          00000-000-0000000-00000\nシステム起動時間:       0 日 ${h} 時間 ${mi} 分 ${s} 秒\nシステム製造元:         Browser Virtual Machines\nシステム モデル:        WebPC-2001\nシステムの種類:         X86-based PC\nプロセッサ:             1 プロセッサインストール済みです。\n                        [01]: x86 Family 6 Model 13 Stepping 8 GenuineBrowser ~1700 Mhz\nBIOS バージョン:        WEBBIOS - 20011025\nWindows ディレクトリ:   C:\\WINDOWS\nシステム ディレクトリ:  C:\\WINDOWS\\system32\n起動デバイス:           \\Device\\HarddiskVolume1\nシステム ロケール:      ja;日本語\n入力ロケール:           ja;日本語\nタイム ゾーン:          (GMT+09:00) 大阪、札幌、東京\n物理メモリの合計:       512 MB\n利用可能な物理メモリ:   298 MB\n仮想メモリ: 最大サイズ: 2,048 MB\nドメイン:               WORKGROUP\nログオン サーバー:      \\\\${this.host}\nホットフィックス:       1 ホットフィックスがインストールされています。\n                        [01]: Q147222\nネットワーク カード:    1 NIC(s) インストール済みです。\n                        [01]: Fetch API Fast Ethernet Adapter\n`);
  },
  tasklist(c) {
    c.out('\nイメージ名                   PID セッション名     セッション# メモリ使用量\n========================= ====== ================ ======== ============\n');
    for (const p of [...this.procs(), { name: 'tasklist.exe', pid: 3000 + Math.floor(Math.random() * 900), mem: 4204 }]) c.out(`${p.name.slice(0, 25).padEnd(25)} ${String(p.pid).padStart(6)} Console                 0 ${comma(p.mem).padStart(10)} K\n`);
  },
  taskkill(c) {
    const get = sw => { const i = c.argv.findIndex(a => a.toLowerCase() === sw); return i >= 0 ? c.argv[i + 1] : null; };
    const im = get('/im'), pid = get('/pid');
    if (!im && !pid) { c.err('エラー: 無効な構文です。/PID または /IM のいずれかを指定してください。\n"TASKKILL /?" と入力すると使用法が表示されます。\n'); return 1; }
    const hits = this.procs().filter(p => (im ? p.name.toLowerCase() === im.toLowerCase() : String(p.pid) === pid));
    if (!hits.length) { c.err(`エラー: プロセス "${im || pid}" が見つかりませんでした。\n`); return 128; }
    for (const p of hits) { if (p.kill) { p.kill(); c.out(`成功: プロセス "${p.name}" (PID ${p.pid}) は強制終了されました。\n`); } else c.err(`エラー: PID ${p.pid} のプロセスを強制終了できませんでした。\n理由: これは重要なシステム プロセスです。Taskkill でこのプロセスを終了することはできません。\n`); }
  },
  shutdown: async function (c) {
    const a = c.argv.map(x => x.toLowerCase().replace(/^\//, '-'));
    if (!a.length) { c.out('使用法: shutdown [-l | -s | -r | -a] [-t xx]\n\n\t-l\t\tログオフ\n\t-s\t\tコンピュータをシャットダウンする\n\t-r\t\tコンピュータをシャットダウンして再起動する\n\t-a\t\tシステム シャットダウンを中止する\n\t-t xx\t\tシャットダウンのタイムアウトを xx 秒に設定する\n'); return 0; }
    if (a.includes('-a')) { clearTimeout(this.os._shutT); return 0; }
    const kind = a.includes('-r') ? 'reboot' : a.includes('-l') ? 'logout' : 'poweroff', ti = a.indexOf('-t'), secs = ti >= 0 ? +a[ti + 1] || 0 : 30;
    if (!this.os.power) { c.err('この環境ではシャットダウンできません。\n'); return 1; }
    if (this.os.notify && secs > 0) this.os.notify('システムのシャットダウン', `このシステムはシャットダウンされます。作業中のファイルを保存してください。残り ${secs} 秒 (shutdown -a で中止)`);
    this.os._shutT = setTimeout(() => this.os.power(kind), secs * 1000);
  },
  chkdsk: async function (c) {
    c.out(this.t('ファイル システムの種類は NTFS です。\n\n警告!  F パラメータが指定されていません。\nCHKDSK を読み取り専用モードで実行します。\n\n', 'Volume MS-DOS_6 created 05-31-1994\n\n'));
    for (const [i, s] of ['ファイルを検査しています', 'インデックスを検査しています', 'セキュリティ記述子を検査しています'].entries()) { c.out(this.t(`CHKDSK は${s} (ステージ ${i + 1}/3)...\n`, '')); for (let p = 0; p <= 100; p += 20) { if (!this.dos) c.out(`\r${p} % が完了しました。`); await this.sleep(120); } if (!this.dos) c.out('\n'); }
    const used = this.fs.du(this.fs.root);
    c.out(this.t(`\n  ${comma(37752832)} KB : 全ディスク領域\n  ${comma(Math.ceil(used / 1024))} KB : ユーザー ファイル\n  ${comma(Math.floor(freeBytes(this) / 1024))} KB : 使用可能領域\n\n       4,096 バイト : アロケーション ユニット サイズ\n`, `  104,857,600 bytes total disk space\n  ${comma(used).padStart(11)} bytes in user files\n  ${comma(freeBytes(this)).padStart(11)} bytes available on disk\n`));
  },
  format: async function (c) { if (!c.files.length) { c.err(this.t('必要なパラメータが指定されていません。\n', 'Required parameter missing\n')); return 1; } await this.sleep(400); c.err(this.t('アクセスが拒否されました。このユーティリティを実行するための特権がありません。\n(ご安心ください。このシミュレータはディスクをフォーマットしません)\n', 'Access denied.\n')); return 1; },
  tracert: async function (c) { const h = c.files[0]; if (!h) { c.out('\nUsage: tracert target_name\n'); return 1; } const ip = await resolve(h); if (!ip) { c.out(`Unable to resolve target system name ${h}.\n`); return 1; } c.out(`\nTracing route to ${h} [${ip}]\nover a maximum of 30 hops:\n\n`); const hops = ['192.168.1.1', '10.24.0.1', '172.16.48.9', ip]; for (let i = 0; i < hops.length; i++) { await this.sleep(500); c.out(`  ${String(i + 1).padStart(2)}    ${String(1 + i * 4).padStart(2)} ms    ${String(1 + i * 4).padStart(2)} ms    ${String(2 + i * 4).padStart(2)} ms  ${hops[i]}\n`); } c.out('\nTrace complete.\n'); },
  telnet: async function (c) { const h = c.files[0]; if (!h) { c.out('Microsoft Telnet> '); await this.term.readLine({}); return; } c.out(`接続中: ${h}...`); await this.sleep(1500); c.out('ホストへ接続できませんでした。 ポート番号 23: 接続に失敗しました\n'); return 1; },
  net(c) { c.out('このコマンドの構文は次のとおりです:\n\nNET [ ACCOUNTS | COMPUTER | CONFIG | CONTINUE | FILE | GROUP | HELP |\n      HELPMSG | LOCALGROUP | NAME | PAUSE | PRINT | SEND | SESSION |\n      SHARE | START | STATISTICS | STOP | TIME | USE | USER | VIEW ]\n'); return 1; },
  mem(c) { c.out('\n    655360 bytes total conventional memory\n    655360 bytes available to MS-DOS\n    578720 largest executable program size\n\n   7340032 bytes total contiguous extended memory\n   7340032 bytes available XMS memory\n           MS-DOS resident in High Memory Area\n'); },
  vim: async function (c) {
    if (!c.tty) { c.err('Vim: Warning: Output is not to a terminal\n'); return 1; }
    const toV = a => (/^[+-]/.test(a) ? a : a.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/'));
    return runVim({ term: this.term, fs: this.fs, cwd: this.cwd, home: this.home, vars: this.env, run: async (cmd, { stdin, capture }) => { let out = ''; await this.exec(cmd, { in: stdin ?? null, out: capture ? s => { out += s; } : s => this.term.write(s), tty: !capture }); return { out, status: this.status }; } }, c.argv.map(a => toV(a.replace(/"/g, ''))));
  },
  vi(c) { return COMMANDS.vim.call(this, c); },
  gvim(c) { return COMMANDS.vim.call(this, c); },
  edit: async function (c) { if (!c.tty) return 1; let f = c.files[0]; if (f) f = this.vfs(f); return runEditor({ term: this.term, fs: this.fs, cwd: this.cwd }, f, 'dos'); },
};
export { COMMANDS, CGA };
