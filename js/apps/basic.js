// Terminal window, text editor, image viewer, calculator, task manager and the About box.

import { h, fmtBytes, download, evalArith } from '../core/util.js';
import { icon } from '../core/icons.js';
import { basename, dirname, extname } from '../core/vfs.js';
import { popupMenu, menuBar, msgBox, fileDialog, button, fit } from '../core/ui.js';
import { Terminal } from '../term/terminal.js';

// ---------------------------------------------------------------- terminal
export function terminal(os, args = {}) {
  const host = h('div', { class: 'term-host' });
  const wrap = h('div', { class: 'app-col' });
  const win = os.wm.open({ title: os.L.terminal, icon: 'terminal', app: 'terminal', width: 700, height: 440, minW: 320, minH: 160, content: wrap });
  const term = new Terminal(host, { class: os.termClass || 'term-' + os.id, palette: os.termPalette, light: !!os.termLight });
  const paste = () => navigator.clipboard?.readText().then(t => { term.sendText(t); term.focus(); }).catch(() => os.notify(os.L.terminal, 'クリップボードを読み取れませんでした。ブラウザの許可を確認してください。'));
  const copy = () => navigator.clipboard?.writeText(String(getSelection())).catch(() => {});
  if (os.kind === 'linux') {
    wrap.append(menuBar(os, [
      { label: 'ファイル(F)', items: [{ label: '新しいウィンドウ', onClick: () => os.launch('terminal') }, '-', { label: 'ウィンドウを閉じる', onClick: () => win.close() }] },
      { label: '編集(E)', items: [{ label: 'コピー', hint: 'Shift+Ctrl+C', onClick: copy }, { label: '貼り付け', hint: 'Shift+Ctrl+V', onClick: paste }] },
      { label: '表示(V)', items: [{ label: '拡大', onClick: () => zoom(1) }, { label: '縮小', onClick: () => zoom(-1) }, { label: '通常サイズ', onClick: () => zoom(0) }] },
      { label: '端末(T)', items: [{ label: 'リセットしてクリア', onClick: () => { term.clear(); term.focus(); } }] },
      { label: 'ヘルプ(H)', items: [{ label: '使い方のヒント', onClick: () => msgBox(os, { title: '端末', text: 'bash 互換シェルです。ls / cat / grep / sed / awk 風のテキスト処理、パイプ、リダイレクト、シェルスクリプト、vim、nano、less、top、apt などが使えます。\n\n・Tab で補完、↑↓ で履歴、Ctrl+R で履歴検索\n・sudo のパスワードは何でも通ります\n・sudo apt install sl cowsay cmatrix neofetch htop figlet lolcat fortune tree' }) }] },
    ]));
  }
  wrap.append(host);
  let size = 0;
  const zoom = d => { size = d === 0 ? 0 : Math.max(-4, Math.min(10, size + d)); term.el.style.fontSize = 14 + size + 'px'; term._measure(); term.focus(); };
  term.onTitle = t => win.setTitle(t);
  term.onBell = () => os.sound('bell');
  host.addEventListener('contextmenu', e => {
    e.preventDefault();
    const r = os.root.getBoundingClientRect();
    popupMenu(os, [{ label: 'コピー', disabled: !String(getSelection()), onClick: copy }, { label: '貼り付け', onClick: paste }, '-', { label: 'クリア', onClick: () => { term.clear(); term.focus(); } }], e.clientX - r.left, e.clientY - r.top);
  });
  win.on('focus', () => term.focus());
  win.on('close', () => { term.destroy(); if (sh.interrupt) sh.interrupt(); sh.exited = true; });
  const sh = os.shell(term, args);
  win.proc = { cmd: os.kind === 'linux' ? '/usr/libexec/gnome-terminal-server' : os.kind === 'mac' ? 'Terminal' : 'cmd.exe', exe: 'cmd.exe' };
  sh.run().then(() => win.close(true), e => { console.error(e); win.close(true); });
  setTimeout(() => term.focus(), 50);
  return win;
}

// ---------------------------------------------------------------- text editor
export function editor(os, args = {}) {
  const fs = os.fs, xp = os.kind === 'win';
  let path = null, saved = '', wrapOn = os.store.get('editor.wrap', true);
  const ta = h('textarea', { class: 'editor-text', spellcheck: 'false', wrap: wrapOn ? 'soft' : 'off' });
  const status = h('div', { class: 'statusbar' });
  const dirty = () => ta.value !== saved;
  const name = () => (path ? basename(path) : xp ? '無題' : '無題のドキュメント 1');
  const retitle = () => win.setTitle(xp ? `${name()} - ${os.L.editor}` : `${dirty() ? '*' : ''}${name()}${path ? ` (${os.pathLabel(dirname(path))})` : ''} - ${os.L.editor}`);
  const pos = () => { const before = ta.value.slice(0, ta.selectionStart), ln = before.split('\n'); status.textContent = `行 ${ln.length}、列 ${ln.at(-1).length + 1}`; };
  const load = p => {
    try { ta.value = saved = fs.read(p); path = p; }
    catch { msgBox(os, { title: os.L.editor, text: `${os.pathLabel(p)}\nファイルを開けませんでした。アクセス許可を確認してください。`, icon: 'error' }); }
    retitle(); pos(); ta.setSelectionRange(0, 0);
  };
  const write = p => {
    try { fs.write(p, ta.value); path = p; saved = ta.value; retitle(); return true; }
    catch { msgBox(os, { title: os.L.editor, text: `${os.pathLabel(p)}\nこのファイルを保存できませんでした。書き込み権限がない可能性があります。`, icon: 'error' }); return false; }
  };
  const saveAs = async () => { const p = await fileDialog(os, { mode: 'save', dir: path ? dirname(path) : os.docs, name: path ? basename(path) : xp ? '*.txt' : '無題.txt' }); return p ? write(/\.[^./]+$/.test(p) || !xp ? p : p + '.txt') : false; };
  const save = () => (path ? write(path) : saveAs());
  const confirmLose = async () => {
    if (!dirty()) return true;
    const a = await msgBox(os, { title: os.L.editor, text: xp ? `ファイル ${path ? os.pathLabel(path) : '無題'} の内容は変更されています。\n\n変更を保存しますか?` : `"${name()}" への変更を閉じる前に保存しますか?`, icon: 'warning', buttons: ['はい', 'いいえ', 'キャンセル'] });
    if (a === 'キャンセル') return false;
    return a === 'いいえ' ? true : save();
  };
  const exec = c => { ta.focus(); document.execCommand(c); };
  const bar = menuBar(os, [
    { label: 'ファイル(F)', items: () => [
      { label: '新規(N)', hint: 'Ctrl+N', onClick: async () => { if (await confirmLose()) { ta.value = saved = ''; path = null; retitle(); } } },
      { label: '開く(O)...', hint: 'Ctrl+O', onClick: async () => { if (!(await confirmLose())) return; const p = await fileDialog(os, { mode: 'open', dir: path ? dirname(path) : os.docs }); if (p) load(p); } },
      { label: '上書き保存(S)', hint: 'Ctrl+S', onClick: save }, { label: '名前を付けて保存(A)...', onClick: saveAs }, '-',
      { label: '実際の PC にダウンロード', onClick: () => download(name().replace(/^無題.*/, 'untitled.txt'), ta.value) }, '-',
      { label: xp ? 'メモ帳の終了(X)' : '閉じる', onClick: () => win.close() }] },
    { label: '編集(E)', items: () => [
      { label: '元に戻す(U)', hint: 'Ctrl+Z', onClick: () => exec('undo') }, '-',
      { label: '切り取り(T)', hint: 'Ctrl+X', onClick: () => exec('cut') }, { label: 'コピー(C)', hint: 'Ctrl+C', onClick: () => exec('copy') },
      { label: '貼り付け(P)', hint: 'Ctrl+V', onClick: () => navigator.clipboard?.readText().then(t => { ta.focus(); ta.setRangeText(t, ta.selectionStart, ta.selectionEnd, 'end'); retitle(); }).catch(() => {}) },
      { label: '削除(L)', hint: 'Del', onClick: () => exec('delete') }, '-',
      { label: 'すべて選択(A)', hint: 'Ctrl+A', onClick: () => { ta.focus(); ta.select(); } },
      { label: '日付と時刻(D)', hint: 'F5', onClick: stamp }] },
    { label: '書式(O)', items: () => [{ label: '右端で折り返す(W)', checked: wrapOn, onClick: () => { wrapOn = !wrapOn; os.store.set('editor.wrap', wrapOn); ta.wrap = wrapOn ? 'soft' : 'off'; } }] },
    { label: 'ヘルプ(H)', items: [{ label: 'バージョン情報(A)', onClick: () => os.launch('about') }] },
  ]);
  function stamp() { const d = new Date(), s = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')} ${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`; ta.focus(); ta.setRangeText(s, ta.selectionStart, ta.selectionEnd, 'end'); retitle(); }
  const content = h('div', { class: 'app-col' }, bar, ta, xp ? null : status);
  const win = os.wm.open({ title: '', icon: 'editor', app: 'editor', width: 620, height: 420, content });
  win.proc = { cmd: xp ? 'notepad.exe' : 'xed', exe: 'notepad.exe' };
  win.onClose = confirmLose;
  ta.addEventListener('input', () => { retitle(); pos(); });
  ta.addEventListener('click', pos); ta.addEventListener('keyup', pos);
  ta.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    else if (e.key === 'Tab') { e.preventDefault(); ta.setRangeText('\t', ta.selectionStart, ta.selectionEnd, 'end'); retitle(); }
    else if (e.key === 'F5') { e.preventDefault(); stamp(); }
  });
  win.on('focus', () => ta.focus());
  if (args.path) { if (fs.exists(args.path)) load(args.path); else { path = args.path; retitle(); } } else retitle();
  if (args.text != null) { ta.value = args.text; retitle(); }
  setTimeout(() => ta.focus(), 50);
  return win;
}

// ---------------------------------------------------------------- image viewer
export function imageSrc(text) {
  if (/^data:image\//.test(text)) return text.trim();
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)?<svg[\s>]/.test(text)) return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
  return null;
}
export function viewer(os, args = {}) {
  const fs = os.fs;
  const img = h('img', { class: 'viewer-img', alt: '' });
  const info = h('div', { class: 'statusbar' });
  const stage = h('div', { class: 'viewer-stage' }, img);
  let path = args.path || null, zoom = 1;
  const siblings = () => { if (!path) return []; try { return fs.readdir(dirname(path)).filter(n => ['svg', 'png', 'jpg', 'jpeg', 'gif', 'bmp'].includes(extname(n))).map(n => (dirname(path) === '/' ? '/' : dirname(path) + '/') + n); } catch { return []; } };
  const show = p => {
    path = p; zoom = 1; img.style.transform = '';
    let src = null;
    try { src = imageSrc(fs.read(p)); } catch { /* handled below */ }
    if (!src) { img.removeAttribute('src'); info.textContent = '画像として表示できないファイルです'; } else { img.src = src; img.onload = () => { info.textContent = `${img.naturalWidth} × ${img.naturalHeight} ピクセル　${fmtBytes(fs.size(fs.stat(p)))}`; }; }
    win.setTitle(`${basename(p)} - ${os.L.viewer}`);
  };
  const step = d => { const s = siblings(), i = s.indexOf(path); if (s.length) show(s[(i + d + s.length) % s.length]); };
  const tools = h('div', { class: 'toolbar' }, button('◀ 前へ', () => step(-1)), button('次へ ▶', () => step(1)), button('＋', () => { zoom *= 1.25; img.style.transform = `scale(${zoom})`; }), button('－', () => { zoom /= 1.25; img.style.transform = `scale(${zoom})`; }), button('1:1', () => { zoom = 1; img.style.transform = ''; }),
    button('開く...', async () => { const p = await fileDialog(os, { dir: path ? dirname(path) : os.pics }); if (p) show(p); }));
  const win = os.wm.open({ title: os.L.viewer, icon: 'image', app: 'viewer', width: 560, height: 440, content: h('div', { class: 'app-col' }, tools, stage, info) });
  win.proc = { cmd: os.kind !== 'win' ? 'xviewer' : 'rundll32.exe shimgvw.dll', exe: 'rundll32.exe' };
  if (path) show(path); else info.textContent = '「開く...」から画像を選んでください';
  return win;
}

// ---------------------------------------------------------------- calculator
export function calc(os) {
  let cur = '0', acc = null, op = null, fresh = true, mem = 0;
  const disp = h('div', { class: 'calc-display' }, '0');
  const show = () => { disp.textContent = cur.length > 16 ? Number(cur).toPrecision(10) : cur; };
  const num = () => parseFloat(cur);
  const fmt = v => (Number.isFinite(v) ? String(parseFloat(v.toPrecision(15))) : 'エラー');
  const apply = () => { if (op === null || acc === null) return; const b = num(); const v = op === '+' ? acc + b : op === '-' ? acc - b : op === '*' ? acc * b : b === 0 ? NaN : acc / b; cur = fmt(v); acc = null; if (!Number.isFinite(v)) os.sound('error'); };
  const press = k => {
    if (/^\d$/.test(k)) { cur = fresh || cur === '0' ? k : cur + k; fresh = false; }
    else if (k === '.') { if (fresh) { cur = '0.'; fresh = false; } else if (!cur.includes('.')) cur += '.'; }
    else if ('+-*/'.includes(k)) { if (!fresh || acc === null) { apply(); acc = num(); } op = k; fresh = true; }
    else if (k === '=') { apply(); op = null; fresh = true; }
    else if (k === 'C') { cur = '0'; acc = null; op = null; fresh = true; }
    else if (k === 'CE') { cur = '0'; fresh = true; }
    else if (k === '←') { if (!fresh) cur = cur.length > 1 ? cur.slice(0, -1) : '0'; }
    else if (k === '±') cur = fmt(-num());
    else if (k === '√') { cur = fmt(Math.sqrt(num())); fresh = true; }
    else if (k === '1/x') { cur = fmt(1 / num()); fresh = true; }
    else if (k === '%') { cur = fmt((acc ?? 0) * num() / 100); fresh = true; }
    else if (k === 'MC') mem = 0; else if (k === 'MR') { cur = fmt(mem); fresh = true; } else if (k === 'MS') mem = num(); else if (k === 'M+') mem += num();
    if (cur === 'エラー') { acc = null; op = null; fresh = true; }
    show();
  };
  const KEYS = ['MC', 'MR', 'MS', 'M+', '←', 'CE', 'C', '±', '√', '%', '7', '8', '9', '/', '1/x', '4', '5', '6', '*', '-', '1', '2', '3', '+', '=', '0', '.'];
  const grid = h('div', { class: 'calc-grid' });
  for (const k of KEYS) grid.append(h('button', { class: 'btn calc-key' + (/[\d.]/.test(k) ? ' num' : /^M/.test(k) ? ' mem' : ' op') + (k === '0' ? ' wide' : ''), type: 'button', onClick: () => press(k) }, k === '*' ? '×' : k === '/' ? '÷' : k === '-' ? '−' : k));
  const content = h('div', { class: 'calc', tabindex: '0' }, disp, grid);
  content.addEventListener('keydown', e => {
    const k = e.key === 'Enter' ? '=' : e.key === 'Backspace' ? '←' : e.key === 'Escape' ? 'C' : e.key === 'Delete' ? 'CE' : e.key;
    if (/^[\d.+\-*/=%]$/.test(k) || ['←', 'C', 'CE'].includes(k)) { e.preventDefault(); press(k); }
  });
  const win = os.wm.open({ title: os.L.calc, icon: 'calc', app: 'calc', width: 262, height: 300, resizable: false, content });
  win.proc = { cmd: os.kind !== 'win' ? 'gnome-calculator' : 'calc.exe', exe: 'calc.exe' };
  win.on('focus', () => content.focus());
  setTimeout(() => { fit(win); content.focus(); }, 0);
  void evalArith;
  return win;
}

// ---------------------------------------------------------------- task manager
export function taskmgr(os) {
  const xp = os.kind === 'win';
  const tbody = h('tbody');
  const table = h('table', { class: 'grid-table' }, h('thead', null, h('tr', null, ...(xp ? ['イメージ名', 'PID', 'ユーザー名', 'CPU', 'メモリ使用量'] : ['プロセス名', 'ユーザー', '% CPU', 'ID', 'メモリー']).map(t => h('th', null, t)))), tbody);
  const canvas = h('canvas', { class: 'tm-graph', width: 300, height: 70 });
  const hist = Array(60).fill(4);
  let sel = null;
  const sysProcs = xp
    ? [['System Idle Process', 0, 'SYSTEM', 16], ['System', 4, 'SYSTEM', 212], ['smss.exe', 548, 'SYSTEM', 372], ['csrss.exe', 612, 'SYSTEM', 3164], ['winlogon.exe', 636, 'SYSTEM', 4128], ['services.exe', 680, 'SYSTEM', 3204], ['lsass.exe', 692, 'SYSTEM', 1412], ['svchost.exe', 852, 'SYSTEM', 4460], ['explorer.exe', 1580, os.user, 17904]]
    : [['systemd', 1, 'root', 11200], ['Xorg', 955, 'root', 88400], ['cinnamon', 1588, os.user, 214000], ['nemo-desktop', 1640, os.user, 52000], ['pulseaudio', 1502, os.user, 14200]];
  const refresh = () => {
    const apps = os.wm.windows.filter(w => !w.dialog).map(w => ({ name: (xp ? w.proc?.exe : w.proc?.cmd) || w.app, pid: w.pid, user: os.user, mem: 6000 + (w.pid * 37) % 30000, win: w }));
    const rows = [...apps, ...sysProcs.map(([name, pid, user, mem]) => ({ name, pid, user, mem }))];
    let total = 0;
    tbody.replaceChildren(...rows.map(p => {
      const cpu = p.pid === 0 ? 0 : Math.random() < 0.25 ? Math.floor(Math.random() * 6) : 0; total += cpu;
      const cells = xp ? [p.name, p.pid, p.user, String(cpu).padStart(2, '0'), `${p.mem.toLocaleString()} K`] : [p.name, p.user, cpu, p.pid, `${(p.mem / 1024).toFixed(1)} MiB`];
      const tr = h('tr', { class: sel === p.pid ? 'sel' : '' }, ...cells.map(c => h('td', null, String(c))));
      tr.addEventListener('click', () => { sel = p.pid; for (const r of tbody.children) r.classList.remove('sel'); tr.classList.add('sel'); });
      tr._p = p;
      return tr;
    }));
    hist.push(Math.min(100, total + 2 + Math.random() * 6)); hist.shift();
    const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    g.strokeStyle = '#0a5c0a'; g.lineWidth = 1;
    for (let x = 0; x < W; x += 15) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, H); g.stroke(); }
    for (let y = 0; y < H; y += 14) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(W, y + 0.5); g.stroke(); }
    g.strokeStyle = '#3cff3c'; g.lineWidth = 1.5; g.beginPath();
    hist.forEach((v, i) => { const x = (i / (hist.length - 1)) * W, y = H - 2 - (v / 100) * (H - 4); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
    g.stroke();
    cpuLabel.textContent = `CPU 使用率: ${Math.round(hist.at(-1))}%　プロセス: ${rows.length}`;
  };
  const cpuLabel = h('div', { class: 'statusbar' });
  const end = async () => {
    const row = [...tbody.children].find(r => r._p.pid === sel);
    if (!row) return;
    const p = row._p;
    if (!p.win) { await msgBox(os, { title: os.L.taskmgr, text: xp ? '重要なシステム プロセスは、タスク マネージャで終了できません。\n\n操作は完了できませんでした。アクセスが拒否されました。' : 'このプロセスを終了する権限がありません。', icon: 'error' }); return; }
    p.win.close(true); refresh();
  };
  const content = h('div', { class: 'app-col tm' }, h('div', { class: 'tm-top' }, canvas), h('div', { class: 'tm-list' }, table), h('div', { class: 'dlg-btns' }, button(xp ? 'プロセスの終了(E)' : 'プロセスを終了', end)), cpuLabel);
  const win = os.wm.open({ title: os.L.taskmgr, icon: 'taskmgr', app: 'taskmgr', width: 420, height: 440, content });
  win.proc = { cmd: xp ? 'taskmgr.exe' : 'gnome-system-monitor', exe: 'taskmgr.exe' };
  refresh();
  const t = setInterval(refresh, 1500);
  win.on('close', () => clearInterval(t));
  return win;
}

// ---------------------------------------------------------------- about
export function about(os) {
  const lines = os.aboutLines();
  const content = h('div', { class: 'dlg about' },
    h('div', { class: 'about-banner' }, icon(os.markIcon, os.theme, 44), h('div', null, h('div', { class: 'about-name' }, os.name), h('div', { class: 'about-sub' }, os.tagline))),
    h('div', { class: 'about-body' }, ...lines.map(l => h('p', null, l)),
      h('p', { class: 'about-note' }, 'これはブラウザ上で動作する非公式の再現シミュレータです。各 OS の開発元とは関係がなく、ロゴ・壁紙・アイコン・効果音はすべて独自に作成したものです。')),
    h('div', { class: 'dlg-btns' }, button('OK', () => win.close(), 'default')));
  const win = os.wm.open({ title: `${os.name} のバージョン情報`, icon: 'info', app: 'about', width: 440, height: 320, dialog: true, resizable: false, content });
  fit(win);
  return win;
}
