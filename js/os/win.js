// The other Windows generations: 3.1 (Program Manager), 98 (classic Start menu), 7 (Aero),
// 8 (Start screen), 10 and 11. They share the XP machine's plumbing (paths, Run box, cmd shell)
// and replace the boot / sign-in flow, the taskbar and the Start menu.

import { h, sleep, pad2 } from '../core/util.js';
import { sound } from '../core/sound.js';
import { store } from '../core/storage.js';
import { popupMenu, closeMenus, menuBar, msgBox, button, fit } from '../core/ui.js';
import { XP } from './xp.js';
import { winSeed } from './seeds.js';
import { Cmd } from '../term/cmd.js';

const PAL = ['#000000', '#800000', '#008000', '#808000', '#000080', '#800080', '#008080', '#c0c0c0', '#808080', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff'];
const BASE = { kind: 'win', user: 'User', host: 'PC', ci: true, perms: false, fsVersion: 1, termClass: 'term-xp', termPalette: PAL, markIcon: 'gem' };
const NT6 = id => ({ home: '/Users/User', docs: '/Users/User/Documents', pics: '/Users/User/Pictures', desktopDir: '/Users/User/Desktop', trashDir: '/$Recycle.Bin', sysDir: '/Windows/System32', seed: b => winSeed(b, id),
  names: { Desktop: 'デスクトップ', Documents: 'ドキュメント', Pictures: 'ピクチャ', Music: 'ミュージック', Videos: 'ビデオ', Downloads: 'ダウンロード', Favorites: 'お気に入り' } });
const LBL = o => ({ terminal: 'コマンド プロンプト', editor: 'メモ帳', browser: 'インターネット ブラウザ', files: 'エクスプローラー', viewer: 'フォト ビューアー', calc: '電卓', mines: 'マインスイーパ', paint: 'ペイント', settings: 'コントロール パネル', taskmgr: 'タスク マネージャー', about: 'バージョン情報', computer: 'コンピューター', docs: 'ドキュメント', trash: 'ごみ箱', emptyTrash: 'ごみ箱を空にする', ...o });

class WinBase extends XP {
  displayName(n) { return (this.names && this.names[n]) || n.replace(/\.(lnk|url)$/i, ''); }
  aboutLines() { return [...this.about, `使用者: ${this.user}　　コンピューター名: ${this.host}`, `仮想ディスクの使用量: ${this.usage()} (ブラウザの localStorage)`]; }
  shell(term, args) {
    const sh = new Cmd({ term, fs: this.fs, os: this, home: this.home, host: this.host, user: this.user, dos: !!this.cmd.dos, gui: true, flavor: this.cmd });
    if (args.cwd && this.fs.isDir(args.cwd)) sh.cwd = args.cwd;
    if (args.run) sh.autorun = args.run;
    return sh;
  }
  apps() {
    const L = this.L;
    return [['browser', L.browser, 'browser'], ['files', L.files, 'folder'], ['terminal', L.terminal, 'terminal'], ['editor', L.editor, 'editor'], ['paint', L.paint, 'paint'], ['calc', L.calc, 'calc'], ['mines', L.mines, 'mines'], ['viewer', L.viewer, 'image'], ['settings', L.settings, 'settings'], ['taskmgr', L.taskmgr, 'taskmgr']]
      .map(([app, label, icon]) => ({ app, label, icon, run: () => this.launch(app, app === 'files' ? { path: this.docs } : {}) }))
      .concat([{ app: 'vim', label: 'Vim', icon: 'script', run: () => this.launch('terminal', { run: 'vim' }) }]);
  }
  systemIcons() {
    const L = this.L;
    return [
      { label: L.computer, icon: 'computer', open: () => this.launch('files', { path: 'computer:' }), props: () => this.launch('settings', { page: 'system' }) },
      { label: L.docs, icon: 'folder', open: () => this.launch('files', { path: this.docs }) },
      { label: L.browser, icon: 'browser', open: () => this.launch('browser') },
      { label: L.terminal, icon: 'terminal', open: () => this.launch('terminal') },
      { label: L.trash, icon: () => (this.trashCount() ? 'trash-full' : 'trash'), trash: true, open: () => this.launch('files', { path: this.trashDir }) },
    ];
  }
  places() {
    const L = this.L;
    return [{ title: this.id === 'win98' ? 'その他' : 'お気に入り', items: [{ label: 'デスクトップ', icon: 'desktop', path: this.desktopDir }, { label: L.docs, icon: 'folder', path: this.docs }, { label: this.names?.Pictures || 'マイ ピクチャ', icon: 'folder', path: this.pics }, { label: L.trash, icon: 'trash', path: this.trashDir }] },
      { title: L.computer, items: [{ label: L.rootName, icon: 'drive', path: '/' }, { label: L.computer, icon: 'computer', path: 'computer:' }] }];
  }
  onFsChange() { if (!this.fs.exists(this.sysDir) && !this.crashed) this.crash('bsod ' + (this.crashClass || ''), this.crashText); }

  // ---- boot / sign-in
  async start({ fast = false } = {}) { if (!fast) await this.bootScreen(); await this.login(); }
  async splash(el, ms) {
    this.root.replaceChildren(el);
    await Promise.race([sleep(ms), new Promise(r => el.addEventListener('pointerdown', r, { once: true }))]);
    el.classList.add('fade'); await sleep(320);
  }
  enter() {
    sound.unlock();
    this.buildDesktop();
    this.root.classList.add('fade-in'); setTimeout(() => this.root.classList.remove('fade-in'), 600);
    this.sound('startup');
    if (!this.store.get('welcomed')) { this.store.set('welcomed', true); setTimeout(() => this.notify('ようこそ', `${this.readmeHint} ファイルはこのブラウザの localStorage に保存されます。`, 12000), 1800); }
    if (!store.persistent) setTimeout(() => this.notify('保存できません', 'このブラウザでは localStorage が無効のため、変更は保存されません。'), 3000);
  }
  // Lock screen (clock) followed by a sign-in card: Windows 8, 10 and 11.
  login() {
    return new Promise(resolve => {
      const d = new Date();
      const lock = h('div', { class: `w-lock wp-${this.id} wp-${this.settings.wallpaper}` }, h('div', { class: 'w-lock-time' }, h('b', null, `${d.getHours()}:${pad2(d.getMinutes())}`), h('span', null, `${d.getMonth() + 1}月${d.getDate()}日 ${'日月火水木金土'[d.getDay()]}曜日`)), h('div', { class: 'w-lock-hint' }, 'クリックまたは任意のキーでロックを解除'));
      const go = h('button', { class: 'w-sign-btn', type: 'button' }, 'サインイン');
      const card = h('div', { class: 'w-sign' }, h('div', { class: 'w-avatar' }, this.icon('user', 96)), h('div', { class: 'w-sign-name' }, this.user), go, h('button', { class: 'w-sign-off', type: 'button', title: 'シャットダウン', onClick: () => this.onExit('poweroff') }, this.icon('power', 22)));
      this.root.replaceChildren(lock);
      const open = () => { window.removeEventListener('keydown', open); lock.classList.add('up'); lock.append(card); setTimeout(() => go.focus(), 50); };
      lock.addEventListener('pointerdown', e => { if (!e.target.closest('.w-sign')) open(); });
      window.addEventListener('keydown', open);
      go.addEventListener('click', async () => { go.disabled = true; go.textContent = 'ようこそ'; card.classList.add('busy'); await sleep(800); this.enter(); resolve(); }, { once: true });
    });
  }
  logoutScreen() { this.sound('shutdown'); return this.login(); }
  async shutdownScreen(kind) {
    this.root.append(h('div', { class: 'w-bye' }, h('div', { class: 'w-spin' }), h('div', null, kind === 'reboot' ? '再起動しています' : 'シャットダウンしています')));
    await sleep(1800);
  }

  // ---- taskbar
  buildPanel() {
    const B = this.bar;
    this.startBtn = h('button', { class: 'start-btn', type: 'button', title: 'スタート', onPointerdown: e => { e.stopPropagation(); this.toggleStart(); } }, this.icon('gem', B.startIcon || 20), B.startLabel ? h('span', null, B.startLabel) : null);
    this.tasks = h('div', { class: 'tasks' });
    this.clock = h('button', { class: 'tray-clock', type: 'button' });
    this.snd = h('button', { class: 'tray-btn', type: 'button', onClick: () => { sound.enabled = !sound.enabled; this.refreshTray(); if (sound.enabled) this.sound('ding'); } });
    const quick = B.quick ? h('div', { class: 'quick' }, h('button', { class: 'tray-btn', type: 'button', title: 'デスクトップの表示', onClick: () => this.showDesktop() }, this.icon('desktop', 16)), h('button', { class: 'tray-btn', type: 'button', title: this.L.browser, onClick: () => this.launch('browser') }, this.icon('browser', 16)), h('button', { class: 'tray-btn', type: 'button', title: this.L.terminal, onClick: () => this.launch('terminal') }, this.icon('terminal', 16))) : null;
    const search = B.search ? h('button', { class: 'tb-search', type: 'button', onPointerdown: e => { e.stopPropagation(); this.toggleStart(); } }, this.icon('search', 16), h('span', null, B.search)) : null;
    this.taskbar = h('div', { class: 'taskbar' }, h('div', { class: 'tb-main' }, this.startBtn, search, quick, this.tasks),
      h('div', { class: 'tray' }, B.net ? h('button', { class: 'tray-btn', type: 'button', title: 'ネットワーク: 接続済み', onClick: () => this.notify('ネットワーク', navigator.onLine ? 'インターネットに接続されています (あなたのブラウザの回線)。' : 'オフラインです。') }, this.icon('network', 16)) : null, this.snd, this.clock, B.peek ? h('button', { class: 'tb-peek', type: 'button', title: 'デスクトップの表示', onClick: () => this.showDesktop() }) : null));
    this.root.append(this.taskbar);
    this.taskbar.addEventListener('contextmenu', e => { e.preventDefault(); const r = this.root.getBoundingClientRect(); popupMenu(this, [{ label: this.L.taskmgr, icon: 'taskmgr', onClick: () => this.launch('taskmgr') }, '-', { label: 'デスクトップを表示', onClick: () => this.showDesktop() }, { label: 'タスク バーの設定', onClick: () => this.launch('settings') }], e.clientX - r.left, e.clientY - r.top - 84); });
    this.wm.on('change', () => this.renderTasks());
    this.wm.taskTarget = w => (this.tasks.querySelector(`[data-pid="${w.pid}"]`) || this.tasks.querySelector(`[data-app="${w.app}"]`))?.getBoundingClientRect();
    this.refreshTray(); this.tick(); this.renderTasks();
  }
  tick() {
    const d = new Date(), t = `${d.getHours()}:${pad2(d.getMinutes())}`, date = `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
    if (this.bar.clock2) this.clock.replaceChildren(h('span', null, t), h('span', null, date)); else this.clock.textContent = t;
    this.clock.title = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }
  renderTasks() {
    const wins = this.wm.windows.filter(w => !w.dialog && !w.hiddenTask), B = this.bar;
    const menu = (w, e) => { e.preventDefault(); e.stopPropagation(); const r = this.root.getBoundingClientRect(); popupMenu(this, [{ label: w.minimized ? '元に戻す' : '最小化', onClick: () => (w.minimized ? w.restore() : w.minimize()) }, { label: '最大化', disabled: w.maximized || !w.resizable, onClick: () => { w.restore(); if (!w.maximized) w.toggleMax(); } }, '-', { label: 'ウィンドウを閉じる', onClick: () => w.close() }], e.clientX - r.left, e.clientY - r.top - 96); };
    if (B.mode !== 'icons') {
      this.tasks.replaceChildren(...wins.map(w => {
        const b = h('button', { class: 'task' + (this.wm.active === w && !w.minimized ? ' active' : ''), type: 'button', dataset: { pid: w.pid }, title: w.title }, this.icon(w.iconName, 16), h('span', null, w.title));
        b.addEventListener('click', () => { if (this.wm.active === w && !w.minimized) w.minimize(); else w.restore(); });
        b.addEventListener('contextmenu', e => menu(w, e));
        return b;
      }));
      return;
    }
    const meta = Object.fromEntries(this.apps().map(a => [a.app, a]));
    const ids = [...new Set([...B.pinned, ...wins.map(w => w.app)])];
    this.tasks.replaceChildren(...ids.map(app => {
      const ws = wins.filter(w => w.app === app).sort((a, b) => b.el.style.zIndex - a.el.style.zIndex), act = ws.includes(this.wm.active) && !this.wm.active.minimized;
      const b = h('button', { class: 'task' + (ws.length ? ' running' : '') + (act ? ' active' : '') + (ws.length > 1 ? ' multi' : ''), type: 'button', dataset: { app }, title: ws[0]?.title || meta[app]?.label || app }, this.icon(ws[0]?.iconName || meta[app]?.icon || 'app', B.taskIcon || 24));
      b.addEventListener('click', () => { if (!ws.length) return meta[app] ? meta[app].run() : this.launch(app); if (act && ws.length === 1) ws[0].minimize(); else (act ? ws.at(-1) : ws[0]).restore(); });
      b.addEventListener('contextmenu', e => { if (ws[0]) menu(ws[0], e); else e.preventDefault(); });
      return b;
    }));
  }
  showStart(el) {
    closeMenus();
    this.startMenu = el;
    this.root.append(el);
    this.startBtn.classList.add('open');
    this.sound('click');
    this._startOut = e => { if (!e.target.closest('.smx') && !e.target.closest('.start-btn') && !e.target.closest('.tb-search') && !e.target.closest('.menu')) this.closePopups(); };
    setTimeout(() => document.addEventListener('pointerdown', this._startOut, true), 0);
    const s = el.querySelector('.sm-search');
    if (s) setTimeout(() => s.focus(), 40);
  }
  powerMenu(e) {
    const r = e.currentTarget.getBoundingClientRect(), rr = this.root.getBoundingClientRect();
    const go = k => () => { this.closePopups(); k === 'sleep' ? setTimeout(() => this.startSaver(true), 250) : this.power(k); };
    popupMenu(this, [{ label: 'スリープ', onClick: go('sleep') }, { label: 'シャットダウン', icon: 'power', onClick: go('poweroff') }, { label: '再起動', icon: 'restart', onClick: go('reboot') }, '-', { label: 'サインアウト', icon: 'logout', onClick: go('logout') }], r.left - rr.left, r.top - rr.top - 120);
  }
  // Search field that filters the program list and falls back to the Run box logic on Enter.
  searchBox(list, render, placeholder) {
    const s = h('input', { class: 'sm-search', type: 'text', placeholder, spellcheck: 'false' });
    s.addEventListener('input', () => render(s.value.trim().toLowerCase()));
    s.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Escape') this.closePopups();
      else if (e.key === 'Enter') { const first = list.querySelector('button'); const v = s.value.trim(); this.closePopups(); if (first && v) first.click(); else if (v) this.runCommand(v); }
    });
    return s;
  }
  appButton(a, size, cls = 'sm-item') { return h('button', { class: cls, type: 'button', onClick: () => { this.closePopups(); a.run(); } }, this.icon(a.icon, size), h('span', null, a.label)); }
  tiles() {
    const d = new Date(), A = Object.fromEntries(this.apps().map(a => [a.app, a]));
    const T = (a, color, cls = '') => h('button', { class: 'tile ' + cls, type: 'button', style: { '--tc': color }, onClick: () => { this.closePopups(); a.run(); } }, this.icon(a.icon, 34), h('span', null, a.label));
    return [T(A.browser, '#0a74d0', 'wide'), T(A.files, '#d9a21b'), T(A.terminal, '#2b2b2b'),
      h('button', { class: 'tile tile-cal', type: 'button', style: { '--tc': '#6b3fa0' }, onClick: () => this.closePopups() }, h('b', null, String(d.getDate())), h('span', null, `${d.getMonth() + 1}月 ${'日月火水木金土'[d.getDay()]}曜日`)),
      T(A.editor, '#0f8f8f'), T(A.paint, '#c2410c'), T(A.calc, '#3b6fb6'), T(A.mines, '#4d7c0f'), T(A.viewer, '#b4256a', 'wide'), T(A.settings, '#5b6470'), T(A.vim, '#1f7a3a')];
  }
}

// ---------------------------------------------------------------- Windows 3.1
export class Win31 extends WinBase {
  constructor(mount, onExit) {
    super(mount, onExit, { ...BASE, id: 'win31', iconTheme: 'win9x', name: 'Windows 3.1 風', tagline: 'プログラム マネージャ ／ 非公式シミュレータ', host: 'WIN31', home: '/', docs: '/DOCS', pics: '/DOCS/PICTURES', desktopDir: '/WINDOWS/DESKTOP', trashDir: '/WINDOWS/TEMP/DELETED', sysDir: '/WINDOWS/SYSTEM', seed: b => winSeed(b, '31'),
      wallpapers: [['gray', '(なし)'], ['teal', 'ティール'], ['weave', '織物']], bar: { mode: 'labels' },
      cmd: { dos: true, cwd: '/WINDOWS', ver: 'MS-DOS Version 6.22', banner: '\nMicrosoft(R) MS-DOS(R) Version 6.22\n             (C)Copyright Microsoft Corp 1981-1994.\n\n■ EXIT と入力すると Windows に戻ります。\n' },
      about: ['Windows 3.1 風デスクトップ', '386 エンハンスト モード (という設定)　空きメモリ: 15,872 KB'], readmeHint: 'C:\\DOCS\\README.TXT に使い方があります。',
      crashText: 'Windows\n\nシステム ファイルが見つからないため、Windows を続行できません。\nC:\\WINDOWS\\SYSTEM が削除されました。\n\n(これはシミュレータの演出です)\n\n何かキーを押すと、仮想ディスクを初期状態に戻して再起動します。',
      L: LBL({ terminal: 'MS-DOS プロンプト', browser: 'Web ブラウザ', files: 'ファイル マネージャ', viewer: '画像ビューア', paint: 'ペイントブラシ', taskmgr: 'タスク リスト', computer: 'ドライブ', docs: 'DOCS', trash: '削除済み', emptyTrash: '削除済みを空にする' }) });
  }
  systemIcons() { return []; }
  places() { return [{ title: 'ディレクトリ', items: [{ label: 'C:\\', icon: 'drive', path: '/' }, { label: 'DOCS', icon: 'folder', path: '/DOCS' }, { label: 'WINDOWS', icon: 'folder', path: '/WINDOWS' }, { label: this.L.trash, icon: 'trash', path: this.trashDir }] }]; }
  async bootScreen() {
    const t = h('pre', { class: 'w31-dos' }, 'HIMEM is testing extended memory...done.\n\nC:\\>C:\\DOS\\SMARTDRV.EXE /X\nC:\\>PROMPT $P$G\nC:\\>WIN\n');
    this.root.replaceChildren(t);
    await sleep(900);
    await this.splash(h('div', { class: 'w31-splash' }, this.icon('gem', 110), h('div', { class: 'w31-name' }, 'Windows', h('sup', null, '風'), h('b', null, ' 3.1')), h('small', null, '非公式の再現シミュレータです ／ クリックでスキップ')), 2400);
  }
  async login() { this.enter(); this.progman(); }
  logoutScreen() { return this.login(); }
  async shutdownScreen() { this.root.append(h('pre', { class: 'w31-dos w-bye' }, '\n\nC:\\>')); await sleep(1100); }
  buildPanel() {
    this.tasks = h('div', { class: 'w31-min' });
    this.desk.append(this.tasks);
    this.startBtn = h('span');
    this.wm.on('change', () => this.renderTasks());
    this.wm.taskTarget = w => this.tasks.querySelector(`[data-pid="${w.pid}"]`)?.getBoundingClientRect();
  }
  tick() { }
  refreshTray() { }
  toggleStart() { this.wm.byApp('progman')[0]?.restore(); }
  renderTasks() {
    this.tasks.replaceChildren(...this.wm.windows.filter(w => w.minimized).map(w => { const b = h('button', { class: 'w31-icon', type: 'button', dataset: { pid: w.pid } }, this.icon(w.iconName, 32), h('span', null, w.title)); b.addEventListener('dblclick', () => w.restore()); b.addEventListener('click', () => { for (const x of this.tasks.children) x.classList.toggle('sel', x === b); }); return b; }));
  }
  async exitWindows() { if ((await msgBox(this, { title: 'Windows の終了', text: 'Windows を終了します。', icon: 'question', buttons: ['OK', 'キャンセル'] })) === 'OK') this.power('poweroff'); }
  progman() {
    const A = Object.fromEntries(this.apps().map(a => [a.app, a]));
    const group = (title, items) => h('div', { class: 'pm-group' }, h('div', { class: 'pm-title' }, title), h('div', { class: 'pm-items' }, items.map(a => { const b = h('button', { class: 'pm-item', type: 'button' }, this.icon(a.icon, 32), h('span', null, a.label)); b.addEventListener('dblclick', () => a.run()); b.addEventListener('keydown', e => { if (e.key === 'Enter') a.run(); }); return b; })));
    const content = h('div', { class: 'app-col' },
      menuBar(this, [{ label: 'アイコン(F)', items: [{ label: 'ファイル名を指定して実行(R)...', onClick: () => this.runBox() }, '-', { label: 'Windows の終了(X)...', onClick: () => this.exitWindows() }] },
        { label: 'オプション(O)', items: [{ label: '壁紙とスクリーン セーバー...', onClick: () => this.launch('settings') }] },
        { label: 'ウィンドウ(W)', items: () => this.wm.windows.filter(w => w.app !== 'progman' && !w.dialog).map(w => ({ label: w.title, onClick: () => w.restore() })).concat(this.wm.windows.length < 2 ? [{ label: '(開いているウィンドウはありません)', disabled: true }] : []) },
        { label: 'ヘルプ(H)', items: [{ label: '使い方 (README.TXT)', onClick: () => this.openPath('/DOCS/README.TXT') }, { label: 'バージョン情報(A)...', onClick: () => this.launch('about') }] }]),
      h('div', { class: 'pm-body' }, group('メイン', [A.files, A.settings, A.terminal, A.browser]), group('アクセサリ', [A.editor, A.paint, A.calc, A.viewer, A.vim, A.taskmgr]), group('ゲーム', [A.mines])));
    const win = this.wm.open({ title: 'プログラム マネージャ', icon: 'app', app: 'progman', width: 620, height: 420, x: 40, y: 30, content });
    win.proc = { cmd: 'progman.exe', exe: 'PROGMAN.EXE' };
    win.onClose = () => { this.exitWindows(); return false; };
  }
}

// ---------------------------------------------------------------- Windows 98
export class Win98 extends WinBase {
  constructor(mount, onExit) {
    super(mount, onExit, { ...BASE, id: 'win98', iconTheme: 'win9x', name: 'Windows 98 風', tagline: 'Second Edition 風 ／ 非公式シミュレータ', host: 'WIN98', home: '/WINDOWS', docs: '/My Documents', pics: '/My Documents/My Pictures', desktopDir: '/WINDOWS/Desktop', trashDir: '/RECYCLED', sysDir: '/WINDOWS/SYSTEM', seed: b => winSeed(b, '9x'),
      names: { Desktop: 'デスクトップ', 'My Documents': 'マイ ドキュメント', 'My Pictures': 'マイ ピクチャ', Favorites: 'お気に入り', 'Start Menu': 'スタート メニュー' },
      wallpapers: [['teal', '(なし)'], ['clouds', '雲'], ['forest', '森'], ['navy', '紺']], bar: { mode: 'labels', startLabel: 'スタート', startIcon: 18, quick: true },
      cmd: { dos: true, cwd: '/WINDOWS', ver: 'Windows 98 [Version 4.10.2222]', banner: '\nMicrosoft(R) Windows 98\n   (C)Copyright Microsoft Corp 1981-1999.\n' },
      about: ['Windows 98 Second Edition 風デスクトップ', 'バージョン 4.10 相当の見た目を目指した再現'], readmeHint: 'デスクトップの「はじめにお読みください.txt」に使い方があります。',
      crashText: 'Windows\n\n致命的な例外 0E が 0028:C0011E36 で発生しました。\n現在のアプリケーションを終了します。\n\n*  C:\\WINDOWS\\SYSTEM が見つかりません。\n*  このまま続行することはできません。\n\n(これはシミュレータの演出です。本物の PC は無事です)\n\n何かキーを押すと、仮想ディスクを初期状態に戻して再起動します _',
      L: LBL({ terminal: 'MS-DOS プロンプト', files: 'エクスプローラ', viewer: '画像ビューア', taskmgr: 'プログラムの強制終了', computer: 'マイ コンピュータ', docs: 'マイ ドキュメント' }) });
  }
  async bootScreen() { await this.splash(h('div', { class: 'w98-boot' }, h('div', { class: 'w98-logo' }, this.icon('gem', 96), h('div', null, h('div', { class: 'w98-name' }, 'Windows', h('sup', null, '風'), h('b', null, '98')), h('small', null, '非公式の再現シミュレータ'))), h('div', { class: 'w98-bar' })), 3000); }
  async login() {
    this.enter();
    if (!this.store.get('tip')) { this.store.set('tip', true); msgBox(this, { title: 'Windows 98 風へようこそ', text: 'ご存知でしたか?\n\n[スタート] → [プログラム] からアプリを、[ファイル名を指定して実行] から command や notepad を起動できます。\n[スタート] → [Windows の終了] で OS 選択画面に戻ります。', icon: 'info', buttons: ['閉じる'], width: 420 }); }
  }
  logoutScreen() { return this.login(); }
  async shutdownScreen(kind) {
    this.root.append(h('div', { class: 'w98-boot w-bye' }, h('div', { class: 'w98-logo' }, this.icon('gem', 96), h('div', { class: 'w98-name' }, kind === 'reboot' ? '再起動しています...' : 'Windows を終了しています...'))));
    await sleep(1500);
    if (kind !== 'reboot') { this.root.append(h('div', { class: 'w98-safe w-bye' }, 'コンピュータの電源を切る準備ができました。')); await sleep(1300); }
  }
  toggleStart() {
    const r = this.startBtn.getBoundingClientRect(), rr = this.root.getBoundingClientRect(), A = Object.fromEntries(this.apps().map(a => [a.app, a]));
    const L = (a, extra = {}) => ({ label: a.label, icon: a.icon, onClick: a.run, ...extra });
    let recent = [];
    try { recent = this.fs.readdir(this.docs).filter(n => this.fs.isFile(this.docs + '/' + n)).slice(0, 6).map(n => ({ label: n, icon: 'text', onClick: () => this.openPath(this.docs + '/' + n) })); } catch { /* folder removed */ }
    this.startBtn.classList.add('open');
    popupMenu(this, [
      { label: 'プログラム(P)', icon: 'app', sub: [{ label: 'アクセサリ', icon: 'folder', sub: [L(A.editor), L(A.paint), L(A.calc), L(A.viewer), { label: 'システム ツール', icon: 'folder', sub: [L(A.taskmgr), { label: 'システム情報', icon: 'info', onClick: () => this.launch('about') }] }, { label: 'ゲーム', icon: 'folder', sub: [L(A.mines)] }] }, { label: 'Vim 8.2', icon: 'folder', sub: [L(A.vim)] }, L(A.terminal), L(A.files), L(A.browser)] },
      { label: 'お気に入り(A)', icon: 'star', sub: [{ label: 'Wikipedia', icon: 'html', onClick: () => this.launch('browser', { url: 'https://ja.wikipedia.org/' }) }] },
      { label: '最近使ったファイル(D)', icon: 'folder', sub: recent.length ? recent : [{ label: '(なし)', disabled: true }] },
      { label: '設定(S)', icon: 'settings', sub: [L(A.settings), { label: '画面のプロパティ', icon: 'desktop', onClick: () => this.launch('settings', { page: 'desktop' }) }] },
      { label: 'ヘルプ(H)', icon: 'help', onClick: () => this.openPath(this.desktopDir + '/はじめにお読みください.txt') },
      { label: 'ファイル名を指定して実行(R)...', icon: 'run', onClick: () => this.runBox() }, '-',
      { label: `${this.user} のログオフ(L)...`, icon: 'logout', onClick: () => this.logoffBox() },
      { label: 'Windows の終了(U)...', icon: 'power', onClick: () => this.offBox() },
    ], 2, r.top - rr.top - 322, { cls: 'sm98' });
    const t = setInterval(() => { if (!document.querySelector('.menu.sm98')) { clearInterval(t); this.startBtn.classList.remove('open'); } }, 150);
  }
  offBox() {
    const opts = [['poweroff', '電源を切れる状態にする(S)'], ['reboot', '再起動する(R)'], ['dos', 'MS-DOS モードで再起動する(M)'], ['sleep', 'スタンバイ(T)']];
    let pick = 'poweroff';
    const content = h('div', { class: 'dlg' }, h('div', { class: 'dlg-row' }, h('div', { class: 'dlg-icon' }, this.icon('computer', 34)), h('div', { class: 'dlg-text' }, '次の中から選んでください。', h('div', { class: 'w98-radios' }, opts.map(([v, label], i) => h('label', null, h('input', { type: 'radio', name: 'w98off', checked: i === 0, onChange: () => { pick = v; } }), ' ' + label))))),
      h('div', { class: 'dlg-btns' }, button('OK', () => { win.close(true); this.desk.classList.remove('dim'); pick === 'sleep' ? setTimeout(() => this.startSaver(true), 250) : this.power(pick === 'dos' ? 'switch:dos' : pick); }, 'default'), button('キャンセル', () => win.close())));
    const win = this.wm.open({ title: 'Windows の終了', icon: 'power', content, width: 360, height: 200, dialog: true, resizable: false, app: 'dialog' });
    this.desk.classList.add('dim');
    win.on('close', () => this.desk.classList.remove('dim'));
    fit(win);
  }
}

// ---------------------------------------------------------------- Windows 7
export class Win7 extends WinBase {
  constructor(mount, onExit) {
    super(mount, onExit, { ...BASE, ...NT6('win7'), id: 'win7', iconTheme: 'aero', tabs: true, name: 'Windows 7 風', tagline: 'Aero グラス ／ 非公式シミュレータ', host: 'WIN7-PC',
      wallpapers: [['harmony', 'ハーモニー'], ['aurora', 'オーロラ'], ['dune', '砂丘'], ['plain', '単色']], bar: { mode: 'icons', startIcon: 26, pinned: ['browser', 'files', 'terminal'], clock2: true, net: true, peek: true, taskIcon: 26 },
      cmd: { ver: 'Microsoft Windows [Version 6.1.7601]', banner: 'Microsoft Windows [Version 6.1.7601]\nCopyright (c) 2009 Microsoft Corporation.  All rights reserved.\n', osName: 'Microsoft Windows 7 Professional', osVersion: '6.1.7601 Service Pack 1 ビルド 7601', whoami: true },
      about: ['Windows 7 風デスクトップ (Aero)', 'Version 6.1 (Build 7601: Service Pack 1) 相当の見た目を目指した再現'], readmeHint: 'デスクトップの「はじめにお読みください.txt」に使い方があります。',
      crashText: '問題が発生したため、コンピューターへの損傷を防ぐために Windows を停止しました。\n\nSYSTEM32_WENT_MISSING\n\nC:\\Windows\\System32 が削除されたため、これ以上続行できません。\n(これはシミュレータの演出です。本物の PC は無事です)\n\n*** STOP: 0x0000007B (0xC0FFEE00, 0xDEADBEEF, 0x00000000, 0x00000000)\n\n何かキーを押すと、仮想ディスクを初期状態に戻して再起動します。',
      L: LBL({}) });
  }
  async bootScreen() { await this.splash(h('div', { class: 'w7-boot' }, h('div', { class: 'w7-orb' }, this.icon('gem', 84)), h('div', null, 'Windows を起動しています'), h('small', null, '非公式の再現シミュレータです ／ クリックでスキップ')), 3200); }
  login() {
    return new Promise(resolve => {
      const tile = h('button', { class: 'w7-user', type: 'button' }, h('span', { class: 'w7-frame' }, this.icon('user', 96)), h('b', null, this.user), h('small', null, 'クリックしてログオン'));
      const el = h('div', { class: 'w7-login' }, tile, h('div', { class: 'w7-brand' }, this.icon('gem', 22), ' Windows', h('sup', null, '風'), ' 7 Professional'), h('button', { class: 'w7-off', type: 'button', title: 'シャットダウン', onClick: () => this.onExit('poweroff') }, this.icon('power', 22)));
      this.root.replaceChildren(el);
      tile.addEventListener('click', async () => { tile.disabled = true; tile.querySelector('small').textContent = 'ようこそ'; tile.classList.add('busy'); await sleep(900); this.enter(); resolve(); }, { once: true });
      setTimeout(() => tile.focus(), 80);
    });
  }
  toggleStart() {
    if (this.startMenu) return this.closePopups();
    const apps = this.apps(), list = h('div', { class: 'sm-list' });
    const render = q => list.replaceChildren(...apps.filter(a => !q || a.label.toLowerCase().includes(q) || a.app.includes(q)).map(a => this.appButton(a, 28)), ...(q && !apps.some(a => a.label.toLowerCase().includes(q) || a.app.includes(q)) ? [h('div', { class: 'sm-none' }, 'Enter キーで「ファイル名を指定して実行」として開きます')] : []));
    render('');
    const R = (label, fn) => h('button', { class: 'sm-r', type: 'button', onClick: () => { this.closePopups(); fn(); } }, label);
    const pw = h('button', { class: 'sm7-more', type: 'button', onClick: e => this.powerMenu(e) }, '▸');
    this.showStart(h('div', { class: 'smx sm7' },
      h('div', { class: 'sm7-left' }, list, h('div', { class: 'sm7-all' }, '▸ すべてのプログラム'), this.searchBox(list, render, 'プログラムとファイルの検索')),
      h('div', { class: 'sm7-right' }, h('div', { class: 'sm7-pic' }, this.icon('user', 44)), R(this.user, () => this.launch('files', { path: this.home })), R('ドキュメント', () => this.launch('files', { path: this.docs })), R('ピクチャ', () => this.launch('files', { path: this.pics })), R('ミュージック', () => this.launch('files', { path: this.home + '/Music' })), h('hr'), R('コンピューター', () => this.launch('files', { path: 'computer:' })), R('コントロール パネル', () => this.launch('settings')), R('ファイル名を指定して実行...', () => this.runBox()), R('ヘルプとサポート', () => this.openPath(this.desktopDir + '/はじめにお読みください.txt')),
        h('div', { class: 'sm7-power' }, h('button', { class: 'sm7-shut', type: 'button', onClick: () => { this.closePopups(); this.power('poweroff'); } }, 'シャットダウン'), pw))));
  }
}

// ---------------------------------------------------------------- Windows 10 / 8
export class Win10 extends WinBase {
  constructor(mount, onExit, over = {}) {
    super(mount, onExit, { ...BASE, ...NT6('win10'), id: 'win10', iconTheme: 'win10', tabs: true, name: 'Windows 10 風', tagline: 'フラット デザイン ／ 非公式シミュレータ', host: 'DESKTOP-SIM10',
      wallpapers: [['beam', 'ビーム'], ['shore', '海辺'], ['night', '夜'], ['plain', '単色']], bar: { mode: 'icons', startIcon: 20, search: 'ここに入力して検索', pinned: ['files', 'browser', 'terminal'], clock2: true, net: true, peek: true, taskIcon: 22 },
      cmd: { ver: 'Microsoft Windows [Version 10.0.19045.4529]', banner: 'Microsoft Windows [Version 10.0.19045.4529]\n(c) Microsoft Corporation. All rights reserved.\n', osName: 'Microsoft Windows 10 Pro', osVersion: '10.0.19045 N/A ビルド 19045', whoami: true },
      about: ['Windows 10 風デスクトップ', 'バージョン 22H2 (OS ビルド 19045) 相当の見た目を目指した再現'], readmeHint: 'デスクトップの「はじめにお読みください.txt」に使い方があります。', crashClass: 'sad',
      crashText: ':(\n\n問題が発生したため、PC を再起動する必要があります。\nC:\\Windows\\System32 が削除されました。\n\n(これはシミュレータの演出です。本物の PC は無事です)\n\n停止コード: SYSTEM32_WENT_MISSING\n\n何かキーを押すと、仮想ディスクを初期状態に戻して再起動します。',
      L: LBL({ settings: '設定', computer: 'PC', files: 'エクスプローラー', browser: 'Web ブラウザー', viewer: 'フォト' }), ...over });
  }
  async bootScreen() { await this.splash(h('div', { class: 'w10-boot' }, this.icon('gem', 96), h('div', { class: 'w-spin' }), h('small', null, '非公式の再現シミュレータです ／ クリックでスキップ')), 2800); }
  toggleStart() {
    if (this.startMenu) return this.closePopups();
    const apps = [...this.apps()].sort((a, b) => a.label.localeCompare(b.label, 'ja')), list = h('div', { class: 'sm-list' });
    const render = q => list.replaceChildren(...apps.filter(a => !q || a.label.toLowerCase().includes(q) || a.app.includes(q)).map(a => this.appButton(a, 24)));
    render('');
    const rail = (ic, label, fn) => h('button', { class: 'sm10-rail', type: 'button', title: label, onClick: fn }, this.icon(ic, 20));
    this.showStart(h('div', { class: 'smx sm10' },
      h('div', { class: 'sm10-side' }, rail('user', this.user, () => { this.closePopups(); this.launch('files', { path: this.home }); }), rail('folder', 'ドキュメント', () => { this.closePopups(); this.launch('files', { path: this.docs }); }), rail('image', 'ピクチャ', () => { this.closePopups(); this.launch('files', { path: this.pics }); }), rail('settings', '設定', () => { this.closePopups(); this.launch('settings'); }), rail('power', '電源', e => this.powerMenu(e))),
      h('div', { class: 'sm10-apps' }, this.searchBox(list, render, 'アプリを検索'), list),
      h('div', { class: 'sm10-tiles' }, h('div', { class: 'sm10-head' }, '仕事効率化'), h('div', { class: 'tiles' }, this.tiles()))));
  }
}
export class Win8 extends Win10 {
  constructor(mount, onExit) {
    super(mount, onExit, { ...NT6('win8'), id: 'win8', name: 'Windows 8 風', tagline: 'スタート画面とタイル ／ 非公式シミュレータ', host: 'WIN8-PC',
      wallpapers: [['ribbon', 'リボン'], ['meadow', '草原'], ['plain', '単色']], bar: { mode: 'icons', startIcon: 20, pinned: ['browser', 'files'], clock2: true, net: true, peek: true, taskIcon: 24 },
      cmd: { ver: 'Microsoft Windows [Version 6.3.9600]', banner: 'Microsoft Windows [Version 6.3.9600]\n(c) 2013 Microsoft Corporation. All rights reserved.\n', osName: 'Microsoft Windows 8.1 Pro', osVersion: '6.3.9600 N/A ビルド 9600', whoami: true },
      about: ['Windows 8.1 風デスクトップ', 'Version 6.3 (Build 9600) 相当の見た目を目指した再現'], L: LBL({ settings: 'PC 設定', computer: 'PC', viewer: 'フォト' }) });
  }
  enter() { super.enter(); setTimeout(() => this.toggleStart(), 400); }
  toggleStart() {
    if (this.startMenu) return this.closePopups();
    this.showStart(h('div', { class: 'smx sm8' },
      h('div', { class: 'sm8-head' }, h('h1', null, 'スタート'), h('div', { class: 'sm8-user' }, h('span', null, this.user), this.icon('user', 36), h('button', { class: 'sm8-power', type: 'button', title: '電源', onClick: e => this.powerMenu(e) }, this.icon('power', 26)))),
      h('div', { class: 'tiles' }, h('button', { class: 'tile wide tile-desk', type: 'button', style: { '--tc': '#3a6ea5' }, onClick: () => this.closePopups() }, this.icon('desktop', 34), h('span', null, 'デスクトップ')), this.tiles()),
      h('div', { class: 'sm8-hint' }, 'タイルをクリックするとアプリが開きます。タスク バー左下のボタンでいつでもここに戻れます。')));
  }
}

// ---------------------------------------------------------------- Windows 11
export class Win11 extends WinBase {
  constructor(mount, onExit) {
    super(mount, onExit, { ...BASE, ...NT6('win11'), id: 'win11', iconTheme: 'win10', tabs: true, bigIcons: false, name: 'Windows 11 風', tagline: '角丸と中央揃えのタスク バー ／ 非公式シミュレータ', host: 'DESKTOP-SIM11',
      wallpapers: [['bloom', 'ブルーム'], ['glow', 'グロー'], ['dusk', '夕暮れ'], ['plain', '単色']], bar: { mode: 'icons', startIcon: 24, pinned: ['files', 'browser', 'terminal', 'settings'], clock2: true, net: true, peek: true, taskIcon: 24 },
      cmd: { ver: 'Microsoft Windows [Version 10.0.22631.3880]', banner: 'Microsoft Windows [Version 10.0.22631.3880]\n(c) Microsoft Corporation. All rights reserved.\n', osName: 'Microsoft Windows 11 Pro', osVersion: '10.0.22631 N/A ビルド 22631', whoami: true },
      about: ['Windows 11 風デスクトップ', 'バージョン 23H2 (OS ビルド 22631) 相当の見た目を目指した再現'], readmeHint: 'デスクトップの「はじめにお読みください.txt」に使い方があります。', crashClass: 'sad dark',
      crashText: ':(\n\n問題が発生したため、PC を再起動する必要があります。\nC:\\Windows\\System32 が削除されました。\n\n(これはシミュレータの演出です。本物の PC は無事です)\n\n停止コード: SYSTEM32_WENT_MISSING\n\n何かキーを押すと、仮想ディスクを初期状態に戻して再起動します。',
      L: LBL({ settings: '設定', computer: 'PC', files: 'エクスプローラー', browser: 'Web ブラウザー', viewer: 'フォト', terminal: 'ターミナル (コマンド プロンプト)' }) });
  }
  async bootScreen() { await this.splash(h('div', { class: 'w10-boot w11' }, this.icon('gem', 96), h('div', { class: 'w-spin' }), h('small', null, '非公式の再現シミュレータです ／ クリックでスキップ')), 2800); }
  toggleStart() {
    if (this.startMenu) return this.closePopups();
    const apps = this.apps(), grid = h('div', { class: 'sm11-grid' });
    const render = q => grid.replaceChildren(...apps.filter(a => !q || a.label.toLowerCase().includes(q) || a.app.includes(q)).map(a => this.appButton(a, 32, 'sm11-app')));
    render('');
    let recent = [];
    try { recent = this.fs.readdir(this.docs).filter(n => this.fs.isFile(this.docs + '/' + n)).slice(0, 4); } catch { /* folder removed */ }
    this.showStart(h('div', { class: 'smx sm11' }, this.searchBox(grid, render, 'アプリ、設定、ドキュメントの検索'),
      h('div', { class: 'sm11-h' }, 'ピン留め済み'), grid,
      h('div', { class: 'sm11-h' }, 'おすすめ'), h('div', { class: 'sm11-rec' }, recent.map(n => h('button', { class: 'sm11-file', type: 'button', onClick: () => { this.closePopups(); this.openPath(this.docs + '/' + n); } }, this.icon('text', 28), h('span', null, h('b', null, n), h('small', null, '最近追加したファイル'))))),
      h('div', { class: 'sm11-foot' }, h('button', { class: 'sm11-user', type: 'button', onClick: () => { this.closePopups(); this.launch('files', { path: this.home }); } }, this.icon('user', 28), this.user), h('button', { class: 'sm11-power', type: 'button', title: '電源', onClick: e => this.powerMenu(e) }, this.icon('power', 22)))));
  }
}
