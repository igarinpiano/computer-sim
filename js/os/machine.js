// Base class shared by the graphical machines: virtual disk, window manager, desktop icons,
// file associations, notifications, trash, screensaver and power transitions.

import { h, sleep, fmtBytes } from '../core/util.js';
import { store } from '../core/storage.js';
import { VFS, basename, dirname, join, extname } from '../core/vfs.js';
import { WM } from '../core/wm.js';
import { icon, iconFor } from '../core/icons.js';
import { sound } from '../core/sound.js';
import { popupMenu, closeMenus, msgBox, inputBox } from '../core/ui.js';
import { terminal, editor, viewer, calc, taskmgr, about } from '../apps/basic.js';
import { files, properties, uniqueName } from '../apps/files.js';
import { browser } from '../apps/browser.js';
import { mines, paint, settings, screensaver } from '../apps/extra.js';

const APPS = { terminal, editor, viewer, calc, taskmgr, about, files, browser, mines, paint, settings };
const TEXT_EXT = new Set(['txt', 'md', 'log', 'ini', 'cfg', 'conf', 'json', 'csv', 'c', 'h', 'cpp', 'py', 'js', 'ts', 'sh', 'bat', 'cmd', 'vim', 'css', 'xml', 'yml', 'yaml', 'toml', 'list', 'sys', 'inf']);
const IMG_EXT = new Set(['svg', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp']);

export class Machine {
  constructor(mount, cfg, onExit) {
    Object.assign(this, cfg);
    this.onExit = onExit; this.theme = cfg.iconTheme || cfg.id; this.kind = cfg.kind || 'win'; this.store = store.scoped(cfg.id); this.bootTime = Date.now(); this.clip = null;
    this.settings = { wallpaper: cfg.wallpapers[0][0], saver: 'pipes', saverWait: 5, animate: true, ...this.store.get('settings', {}) };
    this.fs = new VFS({ storeKey: `${cfg.id}:fs`, ci: !!cfg.ci, perms: !!cfg.perms, user: cfg.user, seed: cfg.seed, version: cfg.fsVersion || 1 });
    this.fs.on('quota', () => this.notify('ディスクの空き領域がありません', 'ブラウザの保存領域 (localStorage) がいっぱいです。これ以降の変更は再読み込みすると失われます。不要なファイルを削除してください。'));
    this.L = { rootName: this.kind === 'win' ? 'ローカル ディスク (C:)' : 'ファイルシステム', openTerm: this.kind === 'win' ? 'コマンド プロンプトをここで開く' : `${cfg.L.terminal}で開く`, ...cfg.L };
    this.root = h('div', { class: `machine os-${cfg.id} k-${this.kind} ${cfg.rootClass || ''}` });
    mount.append(this.root);
    this._unload = e => { if (this.running) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', this._unload);
  }
  icon(name, size = 32) { return icon(name, this.theme, size); }
  sound(name) { sound.fx(name, this.soundTheme || (this.kind === 'win' ? 'xp' : 'mint')); }
  set(key, val) { this.settings[key] = val; this.store.set('settings', this.settings); this.applySettings(); }
  applySettings() {
    if (this.desk) this.desk.className = `desk wp-${this.id} wp-${this.settings.wallpaper}`;
    if (this.wm) { this.wm.animate = this.settings.animate; this.root.classList.toggle('no-anim', !this.settings.animate); }
    this.resetIdle();
  }

  // ---- desktop
  buildDesktop() {
    this.root.replaceChildren();
    this.desk = h('div', { class: 'desk' });
    this.iconsEl = h('div', { class: 'desk-icons' });
    this.wmRoot = h('div', { class: 'wm-root' });
    this.notes = h('div', { class: 'notes' });
    this.desk.append(this.iconsEl, this.wmRoot);
    this.root.append(this.desk, this.notes);
    this.wm = new WM(this.wmRoot, { theme: this.theme, workspaces: this.workspaces || 1, tilt: this.kind !== 'win' ? 35 : 0 });
    this.buildPanel();
    this.applySettings();
    this.selIcon = null;
    this.renderIcons();
    this._offFs = this.fs.on('change', () => { this.renderIcons(); this.onFsChange?.(); });
    this.desk.addEventListener('pointerdown', e => {
      if (e.target === this.desk || e.target === this.iconsEl || e.target === this.wmRoot || e.target.classList.contains('ws-layer') || e.target.classList.contains('ws-cube')) { this.wm.blurAll(); this.selIcon = null; this.markIcons(); this.closePopups?.(); }
    });
    this.desk.addEventListener('contextmenu', e => {
      if (e.target.closest('.win')) return;
      e.preventDefault();
      const r = this.root.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, item = e.target.closest('.desk-icon');
      if (item) return this.iconMenu(this.deskItems().find(i => i.key === item.dataset.key), x, y);
      popupMenu(this, this.deskMenu(), x, y);
    });
    this._keys = e => this.onKey(e);
    window.addEventListener('keydown', this._keys, true);
    this._idle = () => this.resetIdle();
    for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) window.addEventListener(ev, this._idle, { passive: true, capture: true });
    this.clockTimer = setInterval(() => this.tick?.(), 1000);
    this.running = true;
    this.resetIdle();
  }
  onKey() { }
  deskItems() {
    const items = this.systemIcons().map(s => ({ ...s, key: 'sys:' + s.label, system: true }));
    try {
      const node = this.fs.stat(this.desktopDir);
      for (const n of this.fs.readdir(this.desktopDir)) {
        if (n.startsWith('.')) continue;
        const p = join(this.desktopDir, n), e = node.c[n];
        items.push({ key: p, label: this.displayName(n), icon: iconFor(n, e), path: p, open: () => this.openPath(p) });
      }
    } catch { /* desktop folder removed */ }
    return items;
  }
  renderIcons() {
    if (!this.iconsEl) return;
    this.iconsEl.replaceChildren(...this.deskItems().map(it => {
      const el = h('div', { class: 'desk-icon', dataset: { key: it.key }, tabindex: '0' }, h('div', { class: 'desk-ico' }, this.icon(typeof it.icon === 'function' ? it.icon() : it.icon, this.bigIcons ? 48 : 32)), h('div', { class: 'desk-label' }, it.label));
      el.addEventListener('pointerdown', () => { this.selIcon = it.key; this.markIcons(); this.wm.blurAll(); });
      el.addEventListener('dblclick', () => it.open());
      el.addEventListener('keydown', e => { if (e.key === 'Enter') it.open(); else if (e.key === 'Delete' && it.path) this.deleteItems([it.path]); else if (e.key === 'F2' && it.path) this.renameItem(it.path); });
      return el;
    }));
    this.markIcons();
  }
  markIcons() { for (const el of this.iconsEl.children) el.classList.toggle('sel', el.dataset.key === this.selIcon); }
  iconMenu(it, x, y) {
    if (!it) return;
    popupMenu(this, [
      { label: '開く(O)', onClick: () => it.open() },
      it.path && !this.fs.isDir(it.path) && { label: this.L.editor + ' で編集', onClick: () => this.launch('editor', { path: it.path }) },
      it.trash && { label: this.L.emptyTrash, disabled: !this.trashCount(), onClick: () => this.emptyTrash() },
      it.path && '-', it.path && { label: '切り取り(T)', onClick: () => { this.clip = { paths: [it.path], cut: true }; } }, it.path && { label: 'コピー(C)', onClick: () => { this.clip = { paths: [it.path], cut: false }; } },
      it.path && '-', it.path && { label: '削除(D)', onClick: () => this.deleteItems([it.path]) }, it.path && { label: '名前の変更(M)', onClick: () => this.renameItem(it.path) },
      it.path && '-', it.path && { label: 'プロパティ(R)', onClick: () => properties(this, it.path) },
      it.props && '-', it.props && { label: 'プロパティ(R)', onClick: it.props },
    ], x, y);
  }
  deskMenu() {
    const dir = this.desktopDir, fs = this.fs;
    const make = (name, isDir) => { try { const n = uniqueName(fs, dir, name); if (isDir) fs.mkdir(join(dir, n)); else fs.write(join(dir, n), ''); this.selIcon = join(dir, n); } catch { this.notify('デスクトップ', '作成できませんでした。'); } };
    return [
      { label: '最新の情報に更新(E)', onClick: () => this.renderIcons() }, '-',
      { label: '貼り付け(P)', disabled: !this.clip, onClick: () => { try { for (const src of this.clip.paths) { const to = join(dir, uniqueName(fs, dir, basename(src))); if (this.clip.cut) fs.rename(src, to); else fs.copy(src, to, { r: true }); } if (this.clip.cut) this.clip = null; } catch { this.notify('デスクトップ', '貼り付けできませんでした。'); } } }, '-',
      { label: '新規作成(W)', sub: [{ label: 'フォルダ(F)', icon: 'folder', onClick: () => make(this.kind !== 'win' ? '名称未設定フォルダー' : '新しいフォルダ', true) }, { label: 'テキスト ドキュメント', icon: 'text', onClick: () => make(this.kind !== 'win' ? '新しいドキュメント.txt' : '新規テキスト ドキュメント.txt', false) }] },
      { label: this.L.openTerm, icon: 'terminal', onClick: () => this.launch('terminal', { cwd: dir }) }, '-',
      { label: this.kind !== 'win' ? 'デスクトップの背景を変更' : 'プロパティ(R)', onClick: () => this.launch('settings', { page: 'desktop' }) },
    ];
  }
  async renameItem(path) {
    const v = await inputBox(this, { title: '名前の変更', label: `'${basename(path)}' の新しい名前:`, value: basename(path), icon: 'text' });
    if (!v || v === basename(path) || /[\\/]/.test(v)) return;
    try { this.fs.rename(path, join(dirname(path), v)); } catch { msgBox(this, { title: '名前の変更', text: '名前を変更できませんでした。同じ名前のファイルがあるか、アクセスが拒否されました。', icon: 'error' }); }
  }
  async deleteItems(paths) {
    if (this.kind === 'win' && (await msgBox(this, { title: 'ファイルの削除の確認', text: paths.length === 1 ? `'${basename(paths[0])}' をごみ箱に移しますか?` : `これら ${paths.length} 個の項目をごみ箱に移しますか?`, icon: 'question', buttons: ['はい', 'いいえ'] })) !== 'はい') return;
    try { this.trash(paths); } catch { msgBox(this, { title: 'ファイルの削除エラー', text: '削除できませんでした。アクセスが拒否されました。', icon: 'error' }); }
  }

  // ---- trash
  trash(paths) {
    const map = this.store.get('trash', {});
    this.fs.mkdir(this.trashDir, { p: true });
    for (const p of paths) { const n = uniqueName(this.fs, this.trashDir, basename(p)); this.fs.rename(p, join(this.trashDir, n)); map[n] = p; }
    this.store.set('trash', map);
  }
  trashCount() { try { return this.fs.readdir(this.trashDir).length; } catch { return 0; } }
  trashForget(names) { const map = this.store.get('trash', {}); for (const n of names) delete map[n]; this.store.set('trash', map); }
  restoreTrash(names) {
    const map = this.store.get('trash', {});
    for (const n of names) {
      const orig = map[n] || join(this.home, n);
      try { this.fs.mkdir(dirname(orig), { p: true }); this.fs.rename(join(this.trashDir, n), join(dirname(orig), uniqueName(this.fs, dirname(orig), basename(orig)))); delete map[n]; } catch { this.notify(this.L.trash, `${n} を元に戻せませんでした。`); }
    }
    this.store.set('trash', map);
  }
  async emptyTrash() {
    const n = this.trashCount();
    if (!n) return;
    if ((await msgBox(this, { title: this.L.emptyTrash, text: `これら ${n} 個の項目を完全に削除しますか?`, icon: 'warning', buttons: ['はい', 'いいえ'] })) !== 'はい') return;
    for (const f of this.fs.readdir(this.trashDir)) this.fs.rm(join(this.trashDir, f), { r: true });
    this.store.set('trash', {});
    this.sound('ding');
  }

  // ---- apps & files
  launch(app, args = {}) {
    const fn = APPS[app];
    if (!fn) { this.notify(this.name, `アプリ '${app}' が見つかりません。`); return null; }
    closeMenus(); this.closePopups?.();
    const single = { calc: 1, taskmgr: 1, settings: 1, about: 1, mines: 1 }[app] && this.wm.byApp(app)[0];
    if (single) { single.focus(); return single; }
    try { return fn(this, args || {}); } catch (e) { console.error(e); this.notify(this.name, `${this.L[app] || app} を起動できませんでした: ${e.message}`); return null; }
  }
  openPath(p) {
    const fs = this.fs, n = fs.stat(p);
    if (!n) { msgBox(this, { title: this.name, text: `'${this.pathLabel(p)}' が見つかりません。`, icon: 'error' }); return; }
    if (n.t === 'd') return this.launch('files', { path: p });
    const ext = extname(p);
    let text = '';
    try { text = fs.read(p); } catch { msgBox(this, { title: this.name, text: `${this.pathLabel(p)}\nアクセスが拒否されました。`, icon: 'error' }); return; }
    if (ext === 'url') { const m = /^URL=(.+)$/m.exec(text); if (m) return this.launch('browser', { url: m[1].trim() }); }
    if (ext === 'lnk' || ext === 'desktop') { const m = /^(?:app:|Exec=)(\w+)/m.exec(text); if (m && APPS[m[1]]) return this.launch(m[1]); }
    if (ext === 'html' || ext === 'htm') return this.launch('browser', { path: p });
    if (IMG_EXT.has(ext) || /^data:image\//.test(text)) return this.launch('viewer', { path: p });
    if (ext === 'exe' || ext === 'com' || ext === 'dll' || text.startsWith('\x7fELF') || text.startsWith('MZ')) {
      const app = { 'cmd.exe': 'terminal', 'notepad.exe': 'editor', 'calc.exe': 'calc', 'mspaint.exe': 'paint', 'winmine.exe': 'mines', 'taskmgr.exe': 'taskmgr', 'explorer.exe': 'files', 'vim.exe': 'terminal', 'gvim.exe': 'terminal', 'edit.com': 'terminal' }[basename(p).toLowerCase()];
      if (app) return this.launch(app, /vim/i.test(p) ? { run: 'vim' } : /edit/i.test(p) ? { run: 'edit' } : {});
      msgBox(this, { title: basename(p), text: this.kind !== 'win' ? `"${basename(p)}" を開けません。\nこの実行ファイルは端末から実行してください。` : `${this.pathLabel(p)} は有効な Win32 アプリケーションではありません。`, icon: 'error' }); return;
    }
    if (TEXT_EXT.has(ext) || fs.size(n) < 300000) return this.launch('editor', { path: p });
    msgBox(this, { title: this.name, text: 'このファイルを開くプログラムがありません。', icon: 'warning' });
  }
  procs() {
    return this.wm ? this.wm.windows.filter(w => !w.dialog).map(w => ({ pid: w.pid, user: this.user, cmd: w.proc?.cmd || w.app, exe: w.proc?.exe || w.app + '.exe', kill: () => w.close(true) })) : [];
  }
  usage() { return fmtBytes(store.usage(this.id)); }

  // ---- notifications
  notify(title, body = '', ms = 7000) {
    if (!this.notes) return;
    const el = h('div', { class: 'note', role: 'status' }, h('div', { class: 'note-ico' }, this.icon('info', 18)), h('div', { class: 'note-body' }, h('strong', null, title), body ? h('div', null, body) : null), h('button', { class: 'note-x', type: 'button', 'aria-label': '閉じる', onClick: () => el.remove() }, '×'));
    this.notes.append(el);
    this.sound('ding');
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
  }

  // ---- screensaver
  resetIdle() {
    clearTimeout(this._idleT);
    if (!this.running || this.settings.saver === 'none' || this.saverStop) return;
    this._idleT = setTimeout(() => this.startSaver(false), this.settings.saverWait * 60000);
  }
  async startSaver(preview) {
    if (this.saverStop || (!this.running && !preview)) return;
    const kind = this.settings.saver === 'none' ? 'pipes' : this.settings.saver;
    this.saverStop = () => {};
    this.saverStop = await screensaver(this.root, kind, () => { this.saverStop = null; this.resetIdle(); });
  }

  // ---- power
  async closeAll() { for (const w of [...this.wm.windows]) await w.close(true); }
  teardown() {
    this.running = false;
    clearInterval(this.clockTimer); clearTimeout(this._idleT);
    window.removeEventListener('keydown', this._keys, true);
    for (const ev of ['pointermove', 'pointerdown', 'keydown', 'wheel']) window.removeEventListener(ev, this._idle, { capture: true });
    if (this._offFs) this._offFs();
    if (this.wm) this.wm.destroy();
    this.fs.save();
    closeMenus();
  }
  async power(kind) {
    if (this.poweringOff) return;
    this.poweringOff = true;
    closeMenus(); this.closePopups?.();
    if (kind === 'logout') { await this.closeAll(); this.teardown(); this.poweringOff = false; await this.logoutScreen(); return; }
    this.teardown();
    this.sound('shutdown');
    await this.shutdownScreen(kind);
    this.root.classList.add('crt-off');
    await sleep(650);
    window.removeEventListener('beforeunload', this._unload);
    this.onExit(kind);
  }
  factoryReset(all) {
    this.running = false;
    clearTimeout(this.fs._saveT);
    this.fs.storeKey = null;
    store.clear(all ? undefined : this.id);
    window.removeEventListener('beforeunload', this._unload);
    this.onExit(all ? 'poweroff' : 'reboot');
  }
  // Full-screen fatal error (kernel panic / stop screen). Any key restores the factory disk.
  crash(cls, text) {
    if (this.crashed) return;
    this.crashed = true; this.running = false;
    closeMenus();
    const el = h('div', { class: 'crash ' + cls }, h('pre', null, text));
    this.root.append(el);
    this.sound('error');
    const go = () => { window.removeEventListener('keydown', go, true); this.factoryReset(false); };
    setTimeout(() => { window.addEventListener('keydown', go, true); el.addEventListener('pointerdown', go); }, 1500);
  }
}
export { APPS };
