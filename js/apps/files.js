// File manager (Explorer / Nemo style) backed by the virtual filesystem.

import { h, fmtBytes, download, strftime } from '../core/util.js';
import { icon, iconFor } from '../core/icons.js';
import { basename, dirname, join, extname, errMsg } from '../core/vfs.js';
import { popupMenu, msgBox, inputBox, button, fit } from '../core/ui.js';
import { modeStr } from '../term/coreutils.js';

const COMPUTER = 'computer:';

export function uniqueName(fs, dir, name) {
  if (!fs.exists(join(dir, name))) return name;
  const m = /^(.*?)(\.[^.]*)?$/.exec(name);
  for (let i = 2; ; i++) { const n = `${m[1]} (${i})${m[2] || ''}`; if (!fs.exists(join(dir, n))) return n; }
}

export function properties(os, path) {
  const fs = os.fs, n = fs.lstat(path);
  if (!n) return;
  const xp = os.id !== 'mint';
  let count = 0;
  if (n.t === 'd') fs.walk(path, () => count++);
  const rows = [
    ['名前', os.displayName(basename(path)) || os.pathLabel(path)],
    ['種類', n.t === 'd' ? (xp ? 'ファイル フォルダ' : 'フォルダー') : n.t === 'l' ? 'リンク' : typeName(os, basename(path))],
    ['場所', os.pathLabel(dirname(path))],
    ['サイズ', n.t === 'd' ? `${fmtBytes(fs.du(n))} (${count - 1} 項目)` : `${fmtBytes(fs.size(n))} (${fs.size(n).toLocaleString()} バイト)`],
    ['更新日時', strftime('%Y年%m月%d日 %H:%M:%S', new Date(n.mt))],
    ...(xp ? [['属性', n.m & 0o200 ? 'アーカイブ' : '読み取り専用']] : [['所有者', n.o], ['アクセス権', `${modeStr(n)} (${(n.m & 0o777).toString(8)})`]]),
  ];
  const content = h('div', { class: 'dlg props' },
    h('div', { class: 'props-head' }, icon(iconFor(basename(path), n), os.theme, 32), h('strong', null, os.displayName(basename(path)) || os.pathLabel(path))),
    h('table', { class: 'props-table' }, ...rows.map(([k, v]) => h('tr', null, h('th', null, k + ':'), h('td', null, v)))),
    h('div', { class: 'dlg-btns' }, button('OK', () => win.close(), 'default')));
  const win = os.wm.open({ title: `${os.displayName(basename(path)) || 'ディスク'} のプロパティ`, icon: 'info', content, width: 360, height: 300, dialog: true, resizable: false, app: 'dialog' });
  fit(win);
}
function typeName(os, name) {
  const e = extname(name);
  const T = { txt: 'テキスト ドキュメント', md: 'Markdown ドキュメント', html: 'HTML ドキュメント', htm: 'HTML ドキュメント', svg: 'SVG 画像', png: 'PNG 画像', jpg: 'JPEG 画像', sh: 'シェルスクリプト', bat: 'MS-DOS バッチ ファイル', py: 'Python スクリプト', c: 'C ソース ファイル', json: 'JSON ファイル', url: 'インターネット ショートカット', ini: '構成設定', log: 'テキスト ドキュメント', exe: 'アプリケーション', dll: 'アプリケーション拡張', sys: 'システム ファイル' };
  return T[e] || (e ? `${e.toUpperCase()} ファイル` : 'ファイル');
}

export function files(os, args = {}) {
  const fs = os.fs, xp = os.id !== 'mint';
  let cwd = args.path && (args.path === COMPUTER || fs.isDir(args.path)) ? args.path : os.home;
  const hist = [cwd];
  let hi = 0, view = os.store.get('files.view', 'icons'), hidden = false, sel = new Set(), anchor = null, entries = [];
  const list = h('div', { class: 'fm-list', tabindex: '0' });
  const addr = h('input', { class: 'input fm-addr', type: 'text', spellcheck: 'false' });
  const side = h('div', { class: 'fm-side' });
  const status = h('div', { class: 'statusbar' });
  const tb = (ic, label, fn) => h('button', { class: 'tbtn', type: 'button', title: label, onClick: fn }, icon(ic, os.theme, xp ? 24 : 18), xp && ['back', 'forward', 'up'].includes(ic) ? h('span', null, label) : null);
  const backB = tb('back', '戻る', () => nav(-1)), fwdB = tb('forward', '進む', () => nav(1));
  const toolbar = h('div', { class: 'toolbar fm-tools' }, backB, fwdB, tb('up', '上へ', () => up()), tb('refresh', '最新の情報に更新', () => render()), tb('new', '新しいフォルダ', () => mkdir()),
    h('button', { class: 'tbtn', type: 'button', title: '表示の切り替え', onClick: () => setView(view === 'icons' ? 'details' : 'icons') }, '☰'));
  const addrRow = h('div', { class: 'fm-addrbar' }, h('label', null, xp ? 'アドレス(D)' : '場所:'), addr, xp ? button('移動', () => goTyped()) : null);
  const main = h('div', { class: 'fm-main' }, side, list);
  const content = h('div', { class: 'app-col fm' }, xp ? toolbar : h('div', { class: 'fm-head' }, toolbar, addrRow), xp ? addrRow : null, main, status);
  const win = os.wm.open({ title: '', icon: 'folder', app: 'files', width: 720, height: 460, minW: 360, content });
  win.proc = { cmd: xp ? 'explorer.exe' : 'nemo', exe: 'explorer.exe' };

  const labelOf = p => (p === COMPUTER ? os.L.computer : p === os.trashDir ? os.L.trash : p === '/' ? (xp ? 'ローカル ディスク (C:)' : 'ファイルシステム') : os.displayName(basename(p)));
  const go = (p, push = true) => {
    if (p !== COMPUTER && !fs.isDir(p)) { msgBox(os, { title: os.L.files, text: `'${os.pathLabel(p)}' が見つかりません。綴りを確認して、再実行してください。`, icon: 'error' }); return; }
    if (p !== COMPUTER) { try { fs.readdir(p); } catch (e) { msgBox(os, { title: os.L.files, text: `${os.pathLabel(p)} にアクセスできません。\n\n${errMsg(e) === 'Permission denied' ? 'アクセスが拒否されました。' : errMsg(e)}`, icon: 'error' }); return; } p = fs.realpath(p); }
    cwd = p;
    if (push) { hist.splice(hi + 1); hist.push(p); hi = hist.length - 1; }
    sel = new Set(); anchor = null;
    render();
  };
  const nav = d => { if (hi + d < 0 || hi + d >= hist.length) return; hi += d; go(hist[hi], false); };
  const up = () => { if (cwd === COMPUTER) return; go(cwd === '/' ? COMPUTER : dirname(cwd)); };
  const goTyped = () => { const v = addr.value.trim(); if (/^(https?:|www\.)/i.test(v)) return os.launch('browser', { url: v }); go(v === os.L.computer ? COMPUTER : os.parsePath(v)); };
  const setView = v => { view = v; os.store.set('files.view', v); render(); };

  function readEntries() {
    if (cwd === COMPUTER) return [{ name: xp ? 'ローカル ディスク (C:)' : 'ファイルシステム', icon: 'drive', path: '/', dir: true, virt: true, type: xp ? 'ローカル ディスク' : 'ボリューム' }, { name: os.L.docs, icon: 'folder', path: os.docs, dir: true, virt: true, type: 'フォルダ' }, { name: os.L.trash, icon: 'trash', path: os.trashDir, dir: true, virt: true, type: 'システム フォルダ' }];
    const node = fs.stat(cwd);
    return fs.readdir(cwd).filter(n => hidden || !n.startsWith('.')).map(n => {
      const e = node.c[n], real = e.t === 'l' ? fs.stat(join(cwd, n)) || e : e;
      return { name: n, node: e, dir: real.t === 'd', path: join(cwd, n), icon: iconFor(n, real), size: real.t === 'f' ? fs.size(real) : null, mt: e.mt, type: real.t === 'd' ? (xp ? 'ファイル フォルダ' : 'フォルダー') : typeName(os, n) };
    }).sort((a, b) => b.dir - a.dir || a.name.localeCompare(b.name, 'ja', { numeric: true, sensitivity: 'base' }));
  }
  function render() {
    if (win.closed) return;
    if (cwd !== COMPUTER && !fs.isDir(cwd)) { cwd = os.home; hist[hi] = cwd; }
    entries = readEntries();
    sel = new Set([...sel].filter(p => entries.some(e => e.path === p)));
    addr.value = cwd === COMPUTER ? os.L.computer : os.pathLabel(cwd);
    win.setTitle(labelOf(cwd) + (xp ? '' : ' - ' + os.L.files));
    win.setIcon(cwd === COMPUTER ? 'computer' : cwd === os.trashDir ? (entries.length ? 'trash-full' : 'trash') : 'folder');
    backB.disabled = hi === 0; fwdB.disabled = hi >= hist.length - 1;
    list.className = `fm-list view-${view}`;
    list.replaceChildren();
    if (view === 'details') list.append(h('div', { class: 'fm-row fm-headrow' }, h('span', null, '名前'), h('span', null, 'サイズ'), h('span', null, '種類'), h('span', null, '更新日時')));
    for (const e of entries) {
      const big = view === 'icons';
      const el = h('div', { class: 'fm-item' + (big ? '' : ' fm-row') + (sel.has(e.path) ? ' sel' : '') + (os.clip?.cut && os.clip.paths.includes(e.path) ? ' cut' : ''), dataset: { path: e.path }, title: e.virt ? e.name : `${e.type}\n更新日時: ${strftime('%Y/%m/%d %H:%M', new Date(e.mt))}${e.size != null ? '\nサイズ: ' + fmtBytes(e.size) : ''}` },
        big ? [h('div', { class: 'fm-ico' }, icon(e.icon, os.theme, xp ? 32 : 48)), h('div', { class: 'fm-name' }, e.virt ? e.name : os.displayName(e.name))]
          : [h('span', { class: 'fm-name' }, icon(e.icon, os.theme, 16), e.virt ? e.name : os.displayName(e.name)), h('span', { class: 'r' }, e.size != null ? fmtBytes(e.size, true) : ''), h('span', null, e.type), h('span', null, e.virt ? '' : strftime('%Y/%m/%d %H:%M', new Date(e.mt)))]);
      list.append(el);
    }
    renderSide(); updateStatus();
  }
  function renderSide() {
    side.replaceChildren();
    for (const group of os.places()) {
      const box = h('div', { class: 'fm-group' }, h('div', { class: 'fm-group-title' }, group.title));
      for (const p of group.items) box.append(h('div', { class: 'fm-place' + (p.path === cwd ? ' cur' : ''), onClick: () => (p.action ? p.action() : go(p.path)) }, icon(p.icon, os.theme, 16), h('span', null, p.label)));
      side.append(box);
    }
    if (xp) {
      const one = sel.size === 1 ? entries.find(e => sel.has(e.path)) : null;
      side.append(h('div', { class: 'fm-group' }, h('div', { class: 'fm-group-title' }, '詳細'), h('div', { class: 'fm-detail' }, h('strong', null, one ? one.name : labelOf(cwd)), h('div', null, one ? one.type : cwd === COMPUTER ? 'システム フォルダ' : 'ファイル フォルダ'), one && one.size != null ? h('div', null, 'サイズ: ' + fmtBytes(one.size)) : null)));
    }
  }
  function updateStatus() {
    const chosen = entries.filter(e => sel.has(e.path));
    status.textContent = chosen.length ? `${chosen.length} 個のオブジェクトを選択${chosen.every(e => e.size != null) ? `　${fmtBytes(chosen.reduce((s, e) => s + e.size, 0))}` : ''}` : `${entries.length} 個のオブジェクト`;
    for (const el of list.querySelectorAll('.fm-item')) el.classList.toggle('sel', sel.has(el.dataset.path));
    if (xp) renderSide();
  }

  const open = e => {
    if (e.dir) return go(e.path);
    os.openPath(e.path);
  };
  const selected = () => entries.filter(e => sel.has(e.path) && !e.virt);
  const inTrash = () => cwd === os.trashDir;
  async function mkdir() {
    if (cwd === COMPUTER) return;
    const name = uniqueName(fs, cwd, xp ? '新しいフォルダ' : '名称未設定フォルダー');
    try { fs.mkdir(join(cwd, name)); } catch (e) { return fail(e); }
    sel = new Set([join(cwd, name)]); render(); rename();
  }
  function mkfile() {
    if (cwd === COMPUTER) return;
    const name = uniqueName(fs, cwd, xp ? '新規テキスト ドキュメント.txt' : '新しいドキュメント.txt');
    try { fs.write(join(cwd, name), ''); } catch (e) { return fail(e); }
    sel = new Set([join(cwd, name)]); render(); rename();
  }
  const fail = e => msgBox(os, { title: os.L.files, text: `この操作を完了できません。\n\n${{ EACCES: 'アクセスが拒否されました。書き込み禁止になっていないか確認してください。', EEXIST: '同じ名前のファイルまたはフォルダが既に存在します。', ENOTEMPTY: 'フォルダが空ではありません。', EINVAL: '受け側のフォルダは、送り側フォルダのサブフォルダです。' }[e.code] || e.message}`, icon: 'error' });
  async function rename() {
    const e = selected()[0];
    if (!e) return;
    const v = await inputBox(os, { title: '名前の変更', label: `'${e.name}' の新しい名前:`, value: e.name, icon: 'text' });
    if (!v || v === e.name) return;
    if (/[\\/:*?"<>|]/.test(v)) { await msgBox(os, { title: '名前の変更', text: 'ファイル名には次の文字は使えません:\n\\ / : * ? " < > |', icon: 'warning' }); return; }
    try { fs.rename(e.path, join(cwd, v)); sel = new Set([join(cwd, v)]); } catch (err) { fail(err); }
    render();
  }
  async function del(permanent) {
    const items = selected();
    if (!items.length) return;
    const perm = permanent || inTrash();
    const what = items.length === 1 ? `'${items[0].name}'` : `これら ${items.length} 個の項目`;
    if (xp || perm) {
      const a = await msgBox(os, { title: perm ? 'ファイルの削除の確認' : (items.length > 1 ? '複数のファイルの削除の確認' : 'ファイルの削除の確認'), text: perm ? `${what} を完全に削除しますか?\nこの操作は元に戻せません。` : `${what} をごみ箱に移しますか?`, icon: perm ? 'warning' : 'question', buttons: ['はい', 'いいえ'] });
      if (a !== 'はい') return;
    }
    try { if (perm) { for (const e of items) fs.rm(e.path, { r: true }); os.trashForget(items.map(e => basename(e.path))); } else os.trash(items.map(e => e.path)); } catch (e) { fail(e); }
    sel = new Set(); render();
  }
  function copy(cut) { const items = selected(); if (items.length) { os.clip = { paths: items.map(e => e.path), cut }; render(); } }
  function paste() {
    if (!os.clip || cwd === COMPUTER) return;
    try {
      for (const src of os.clip.paths) {
        if (!fs.lstat(src)) continue;
        if (os.clip.cut) { if (dirname(src) !== cwd) fs.rename(src, join(cwd, uniqueName(fs, cwd, basename(src)))); }
        else fs.copy(src, join(cwd, dirname(src) === cwd ? uniqueName(fs, cwd, xp ? `コピー ～ ${basename(src)}` : basename(src).replace(/(\.[^.]*)?$/, ' (コピー)$1')) : uniqueName(fs, cwd, basename(src))), { r: true });
      }
      if (os.clip.cut) os.clip = null;
    } catch (e) { fail(e); }
    render();
  }

  // ---- interaction
  const itemAt = t => { const el = t.closest('.fm-item'); return el ? entries.find(e => e.path === el.dataset.path) : null; };
  list.addEventListener('pointerdown', ev => {
    const e = itemAt(ev.target);
    list.focus();
    if (!e) { if (!ev.ctrlKey && !ev.metaKey && ev.button === 0) { sel = new Set(); updateStatus(); } return; }
    if (ev.button === 2) { if (!sel.has(e.path)) { sel = new Set([e.path]); anchor = e.path; } }
    else if (ev.shiftKey && anchor) { const a = entries.findIndex(x => x.path === anchor), b = entries.indexOf(e); sel = new Set(entries.slice(Math.min(a, b), Math.max(a, b) + 1).map(x => x.path)); }
    else if (ev.ctrlKey || ev.metaKey) { if (sel.has(e.path)) sel.delete(e.path); else sel.add(e.path); anchor = e.path; }
    else { sel = new Set([e.path]); anchor = e.path; }
    updateStatus();
  });
  list.addEventListener('dblclick', ev => { const e = itemAt(ev.target); if (e) open(e); });
  list.addEventListener('keydown', ev => {
    const mod = ev.ctrlKey || ev.metaKey, k = ev.key;
    const cur = entries.findIndex(e => e.path === anchor);
    const cols = view === 'icons' ? Math.max(1, Math.floor(list.clientWidth / (list.querySelector('.fm-item')?.offsetWidth || 90))) : 1;
    const move = d => { const n = Math.max(0, Math.min(entries.length - 1, (cur < 0 ? (d > 0 ? -1 : entries.length) : cur) + d)); if (entries[n]) { sel = new Set([entries[n].path]); anchor = entries[n].path; updateStatus(); list.querySelectorAll('.fm-item')[n]?.scrollIntoView({ block: 'nearest' }); } };
    if (k === 'Enter') { const e = selected()[0] || entries.find(x => sel.has(x.path)); if (e) open(e); }
    else if (k === 'Delete') del(ev.shiftKey);
    else if (k === 'F2') rename();
    else if (k === 'F5') render();
    else if (k === 'Backspace') up();
    else if (k === 'ArrowRight') move(view === 'icons' ? 1 : 0); else if (k === 'ArrowLeft') move(view === 'icons' ? -1 : 0);
    else if (k === 'ArrowDown') move(cols); else if (k === 'ArrowUp') move(-cols);
    else if (mod && k.toLowerCase() === 'a') { sel = new Set(entries.map(e => e.path)); updateStatus(); }
    else if (mod && k.toLowerCase() === 'c') copy(false);
    else if (mod && k.toLowerCase() === 'x') copy(true);
    else if (mod && k.toLowerCase() === 'v') paste();
    else if (mod && k.toLowerCase() === 'h') { hidden = !hidden; render(); }
    else return;
    ev.preventDefault();
  });
  list.addEventListener('contextmenu', ev => {
    ev.preventDefault();
    const r = os.root.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top, e = itemAt(ev.target);
    if (e) {
      const text = !e.dir && !e.virt && fs.size(fs.stat(e.path) || { t: 'f', d: '' }) < 400000 && !/^data:/.test(fs.stat(e.path)?.d || '');
      return popupMenu(os, [
        { label: '開く(O)', onClick: () => open(e) },
        text && { label: os.L.editor + ' で編集', icon: 'editor', onClick: () => os.launch('editor', { path: e.path }) },
        text && { label: 'Vim で開く', icon: 'terminal', onClick: () => os.launch('terminal', { cwd, run: `vim "${e.name}"` }) },
        e.dir && { label: xp ? 'コマンド プロンプトをここで開く' : '端末で開く', icon: 'terminal', onClick: () => os.launch('terminal', { cwd: e.path }) },
        !e.virt && '-',
        inTrash() && { label: '元に戻す', onClick: () => { os.restoreTrash(selected().map(s => basename(s.path))); render(); } },
        !e.virt && !inTrash() && { label: '切り取り(T)', onClick: () => copy(true) }, !e.virt && !inTrash() && { label: 'コピー(C)', onClick: () => copy(false) },
        !e.virt && '-', !e.virt && { label: inTrash() ? '完全に削除' : '削除(D)', onClick: () => del(false) }, !e.virt && !inTrash() && { label: '名前の変更(M)', onClick: rename },
        !e.dir && !e.virt && { label: '実際の PC に保存', icon: 'disk', onClick: () => { const d = fs.read(e.path); if (/^data:/.test(d)) { const a = h('a', { href: d, download: e.name }); a.click(); } else download(e.name, d); } },
        '-', { label: 'プロパティ(R)', onClick: () => properties(os, e.path) },
      ], x, y);
    }
    popupMenu(os, [
      { label: '表示(V)', sub: [{ label: 'アイコン', checked: view === 'icons', onClick: () => setView('icons') }, { label: '詳細', checked: view === 'details', onClick: () => setView('details') }, '-', { label: '隠しファイルを表示', checked: hidden, onClick: () => { hidden = !hidden; render(); } }] },
      { label: '最新の情報に更新(E)', onClick: render }, '-',
      { label: '貼り付け(P)', disabled: !os.clip || cwd === COMPUTER, onClick: paste }, '-',
      inTrash() ? { label: os.L.emptyTrash, disabled: !entries.length, onClick: () => os.emptyTrash() } : { label: '新規作成(W)', disabled: cwd === COMPUTER, sub: [{ label: 'フォルダ(F)', icon: 'folder', onClick: mkdir }, { label: 'テキスト ドキュメント', icon: 'text', onClick: mkfile }] },
      cwd !== COMPUTER && { label: xp ? 'コマンド プロンプトをここで開く' : '端末で開く', icon: 'terminal', onClick: () => os.launch('terminal', { cwd }) },
      '-', { label: 'プロパティ(R)', disabled: cwd === COMPUTER, onClick: () => properties(os, cwd) },
    ], x, y);
  });
  addr.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') goTyped(); });
  // Files dragged in from the real computer are imported into the virtual disk.
  list.addEventListener('dragover', e => { if (cwd !== COMPUTER) { e.preventDefault(); list.classList.add('drop'); } });
  list.addEventListener('dragleave', () => list.classList.remove('drop'));
  list.addEventListener('drop', async e => {
    e.preventDefault(); list.classList.remove('drop');
    if (cwd === COMPUTER) return;
    let skipped = 0;
    for (const f of e.dataTransfer.files) {
      if (f.size > 400 * 1024) { skipped++; continue; }
      const isImg = /^image\/(png|jpeg|gif|bmp|webp)$/.test(f.type);
      const data = isImg ? await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); }) : await f.text();
      try { fs.write(join(cwd, uniqueName(fs, cwd, f.name)), data); } catch (err) { fail(err); break; }
    }
    if (skipped) os.notify(os.L.files, `${skipped} 個のファイルは大きすぎるため取り込めませんでした (上限 400KB)。`);
    render();
  });
  const off = fs.on('change', () => render());
  win.on('close', off);
  win.on('focus', () => list.focus({ preventScroll: true }));
  render();
  return win;
}
