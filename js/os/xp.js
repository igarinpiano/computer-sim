// Windows XP style machine: boot and welcome screens, taskbar, Start menu, Run box,
// "Turn off computer" dialog and the cmd.exe shell.

import { h, sleep, pad2 } from '../core/util.js';
import { sound } from '../core/sound.js';
import { store } from '../core/storage.js';
import { popupMenu, closeMenus, msgBox, inputBox, button } from '../core/ui.js';
import { Machine } from './machine.js';
import { xpSeed } from './seeds.js';
import { Cmd } from '../term/cmd.js';

const HOME = '/Documents and Settings/User';
const NAMES = { Desktop: 'デスクトップ', 'My Documents': 'マイ ドキュメント', 'My Pictures': 'マイ ピクチャ', 'My Music': 'マイ ミュージック', Favorites: 'お気に入り', 'Start Menu': 'スタート メニュー' };
const CFG = {
  id: 'xp', kind: 'win', termClass: 'term-xp', name: 'Windows XP 風', tagline: 'Professional 風 ／ 非公式シミュレータ', user: 'User', home: HOME, ci: true, perms: false, seed: xpSeed, fsVersion: 1,
  docs: HOME + '/My Documents', pics: HOME + '/My Documents/My Pictures', desktopDir: HOME + '/Desktop', trashDir: '/RECYCLER', markIcon: 'gem',
  wallpapers: [['hills', '草原'], ['azure', '紺碧'], ['dusk', '夕暮れ'], ['plain', '(なし)']],
  termPalette: ['#000000', '#800000', '#008000', '#808000', '#000080', '#800080', '#008080', '#c0c0c0', '#808080', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff'],
  L: { terminal: 'コマンド プロンプト', editor: 'メモ帳', browser: 'インターネット ブラウザ', files: 'エクスプローラ', viewer: '画像と FAX ビューア', calc: '電卓', mines: 'マインスイーパ', paint: 'ペイント', settings: 'コントロール パネル', taskmgr: 'Windows タスク マネージャ', about: 'バージョン情報', computer: 'マイ コンピュータ', docs: 'マイ ドキュメント', trash: 'ごみ箱', emptyTrash: 'ごみ箱を空にする' },
};

export class XP extends Machine {
  constructor(mount, onExit, cfg = CFG) { super(mount, cfg, onExit); }
  pathLabel(p) { return 'C:' + (p === '/' ? '\\' : p.replace(/\//g, '\\')); }
  parsePath(s) {
    s = s.trim().replace(/"/g, '');
    const special = { 'マイ ドキュメント': this.docs, 'デスクトップ': this.desktopDir, 'ごみ箱': this.trashDir, '%userprofile%': this.home };
    if (special[s.toLowerCase()] || special[s]) return special[s.toLowerCase()] || special[s];
    return this.fs.abs(s.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/') || '/', this.home);
  }
  displayName(n) { return NAMES[n] || n.replace(/\.(lnk|url)$/i, ''); }
  aboutLines() { return ['Windows XP Professional 風デスクトップ', 'Version 5.1 (Build 2600 相当の見た目を目指した再現)', `使用者: ${this.user}　　コンピュータ名: XP-PC`, `仮想ディスクの使用量: ${this.usage()} (ブラウザの localStorage)`]; }
  shell(term, args) {
    const sh = new Cmd({ term, fs: this.fs, os: this, home: this.home });
    if (args.cwd && this.fs.isDir(args.cwd)) sh.cwd = args.cwd;
    if (args.run) sh.autorun = args.run;
    return sh;
  }
  systemIcons() {
    return [
      { label: 'マイ コンピュータ', icon: 'computer', open: () => this.launch('files', { path: 'computer:' }), props: () => this.launch('settings', { page: 'system' }) },
      { label: 'マイ ドキュメント', icon: 'folder', open: () => this.launch('files', { path: this.docs }) },
      { label: 'インターネット', icon: 'browser', open: () => this.launch('browser') },
      { label: 'コマンド プロンプト', icon: 'terminal', open: () => this.launch('terminal') },
      { label: 'ごみ箱', icon: () => (this.trashCount() ? 'trash-full' : 'trash'), trash: true, open: () => this.launch('files', { path: this.trashDir }) },
    ];
  }
  places() {
    return [{ title: 'その他', items: [{ label: 'マイ コンピュータ', icon: 'computer', path: 'computer:' }, { label: 'マイ ドキュメント', icon: 'folder', path: this.docs }, { label: 'マイ ピクチャ', icon: 'folder', path: this.pics }, { label: 'デスクトップ', icon: 'desktop', path: this.desktopDir }, { label: 'ごみ箱', icon: 'trash', path: this.trashDir }] },
      { title: 'システムのタスク', items: [{ label: 'コントロール パネル', icon: 'settings', action: () => this.launch('settings') }, { label: 'コマンド プロンプト', icon: 'terminal', action: () => this.launch('terminal') }] }];
  }

  // ---- boot / login
  async start({ fast = false } = {}) {
    if (!fast) await this.bootScreen();
    await this.welcome('開始するにはユーザー名をクリックしてください');
  }
  async bootScreen() {
    const el = h('div', { class: 'xp-boot' }, h('div', { class: 'xb-logo' }, this.icon('gem', 86), h('div', null, h('div', { class: 'xb-name' }, 'Windows', h('sup', null, '風'), ' ', h('b', null, 'XP')), h('div', { class: 'xb-ed' }, 'Professional Simulator'))), h('div', { class: 'xb-bar' }, h('i'), h('i'), h('i')), h('div', { class: 'xb-foot' }, h('span', null, '非公式の再現シミュレータです'), h('span', null, 'クリックでスキップ')));
    this.root.replaceChildren(el);
    await Promise.race([sleep(3400), new Promise(r => el.addEventListener('pointerdown', r, { once: true }))]);
    el.classList.add('fade'); await sleep(350);
  }
  welcome(hint) {
    return new Promise(resolve => {
      const tile = h('button', { class: 'xw-user', type: 'button' }, h('span', { class: 'xw-avatar' }, this.icon('user', 48)), h('span', null, h('b', null, this.user), h('small', null, 'クリックしてログオン')));
      const off = h('button', { class: 'xw-off', type: 'button', onClick: () => { this.sound('click'); this.onExit('poweroff'); } }, this.icon('power', 22), 'コンピュータの電源を切る');
      const el = h('div', { class: 'xp-welcome' }, h('div', { class: 'xw-top' }),
        h('div', { class: 'xw-mid' }, h('div', { class: 'xw-left' }, this.icon('gem', 96), h('div', { class: 'xw-title' }, 'Windows', h('sup', null, '風'), h('b', null, ' XP')), h('p', null, hint)), h('div', { class: 'xw-div' }), h('div', { class: 'xw-right' }, tile)),
        h('div', { class: 'xw-bottom' }, off, h('span', null, 'ログオンした後は、ファイルや設定がこのブラウザに保存されます。', h('br'), '[コントロール パネル] → [ストレージ] から初期化できます。')));
      this.root.replaceChildren(el);
      tile.addEventListener('click', async () => {
        sound.unlock();
        tile.disabled = true; tile.querySelector('small').textContent = '個人設定を読み込んでいます...';
        el.classList.add('loading');
        await sleep(900);
        this.buildDesktop();
        this.root.classList.add('fade-in'); setTimeout(() => this.root.classList.remove('fade-in'), 600);
        this.sound('startup');
        if (!this.store.get('welcomed')) { this.store.set('welcomed', true); setTimeout(() => this.notify('ようこそ', 'デスクトップの「はじめにお読みください.txt」に使い方があります。ファイルはこのブラウザの localStorage に保存されます。', 12000), 1800); }
        if (!store.persistent) setTimeout(() => this.notify('保存できません', 'このブラウザでは localStorage が無効のため、変更は保存されません。'), 3000);
        resolve();
      }, { once: true });
      setTimeout(() => tile.focus(), 100);
    });
  }
  logoutScreen() { this.sound('shutdown'); return this.welcome('開始するにはユーザー名をクリックしてください'); }
  async shutdownScreen(kind) {
    const el = h('div', { class: 'xp-bye' }, h('div', { class: 'xw-top' }), h('div', { class: 'xp-bye-mid' }, this.icon('gem', 72), h('div', null, kind === 'reboot' ? 'Windows を再起動しています...' : 'Windows をシャットダウンしています...')), h('div', { class: 'xw-bottom' }));
    this.root.append(el);
    await sleep(1900);
  }

  // ---- taskbar & start menu
  buildPanel() {
    this.startBtn = h('button', { class: 'start-btn', type: 'button', onPointerdown: e => { e.stopPropagation(); this.toggleStart(); } }, this.icon('gem', 20), h('span', null, 'スタート'));
    this.tasks = h('div', { class: 'tasks' });
    this.clock = h('div', { class: 'tray-clock' });
    this.snd = h('button', { class: 'tray-btn', type: 'button', onClick: () => { sound.enabled = !sound.enabled; this.refreshTray(); if (sound.enabled) this.sound('ding'); } });
    const quick = h('div', { class: 'quick' },
      h('button', { class: 'tray-btn', type: 'button', title: 'デスクトップの表示', onClick: () => this.showDesktop() }, this.icon('desktop', 16)),
      h('button', { class: 'tray-btn', type: 'button', title: 'インターネット ブラウザ', onClick: () => this.launch('browser') }, this.icon('browser', 16)),
      h('button', { class: 'tray-btn', type: 'button', title: 'コマンド プロンプト', onClick: () => this.launch('terminal') }, this.icon('terminal', 16)));
    this.taskbar = h('div', { class: 'taskbar' }, this.startBtn, quick, this.tasks, h('div', { class: 'tray' }, this.snd, this.clock));
    this.root.append(this.taskbar);
    this.taskbar.addEventListener('contextmenu', e => {
      e.preventDefault();
      const r = this.root.getBoundingClientRect();
      popupMenu(this, [{ label: 'タスク マネージャ(K)', icon: 'taskmgr', onClick: () => this.launch('taskmgr') }, '-', { label: 'デスクトップを表示(S)', onClick: () => this.showDesktop() }, { label: 'プロパティ(R)', onClick: () => this.launch('settings') }], e.clientX - r.left, e.clientY - r.top - 80);
    });
    this.wm.on('change', () => this.renderTasks());
    this.wm.taskTarget = w => this.tasks.querySelector(`[data-pid="${w.pid}"]`)?.getBoundingClientRect();
    this.refreshTray(); this.tick(); this.renderTasks();
  }
  refreshTray() { this.snd.replaceChildren(this.icon(sound.enabled ? 'sound' : 'mute', 16)); this.snd.title = sound.enabled ? '音量 (クリックでミュート)' : 'ミュート中 (クリックで解除)'; }
  tick() { const d = new Date(); this.clock.textContent = `${d.getHours()}:${pad2(d.getMinutes())}`; this.clock.title = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`; }
  renderTasks() {
    const wins = this.wm.windows.filter(w => !w.dialog);
    this.tasks.replaceChildren(...wins.map(w => {
      const b = h('button', { class: 'task' + (this.wm.active === w && !w.minimized ? ' active' : ''), type: 'button', dataset: { pid: w.pid }, title: w.title }, this.icon(w.iconName, 16), h('span', null, w.title));
      b.addEventListener('click', () => { if (this.wm.active === w && !w.minimized) w.minimize(); else w.restore(); });
      b.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); const r = this.root.getBoundingClientRect(); popupMenu(this, [{ label: '元のサイズに戻す(R)', disabled: !w.minimized && !w.maximized, onClick: () => (w.minimized ? w.restore() : w.toggleMax()) }, { label: '最小化(N)', disabled: w.minimized, onClick: () => w.minimize() }, { label: '最大化(X)', disabled: w.maximized || !w.resizable, onClick: () => { w.restore(); if (!w.maximized) w.toggleMax(); } }, '-', { label: '閉じる(C)', hint: 'Alt+F4', onClick: () => w.close() }], e.clientX - r.left, e.clientY - r.top - 110); });
      return b;
    }));
  }
  showDesktop() { const open = this.wm.windows.filter(w => !w.minimized && !w.dialog); if (open.length) open.forEach(w => w.minimize()); else this.wm.windows.forEach(w => w.restore()); }
  closePopups() { if (this.startMenu) { this.startMenu.remove(); this.startMenu = null; this.startBtn.classList.remove('open'); document.removeEventListener('pointerdown', this._startOut, true); } }
  toggleStart() {
    if (this.startMenu) return this.closePopups();
    closeMenus();
    const item = (ic, label, fn, sub) => h('button', { class: 'sm-item', type: 'button', onClick: () => { this.closePopups(); fn(); } }, this.icon(ic, sub ? 32 : 24), h('span', null, sub ? [h('b', null, label), h('small', null, sub)] : label));
    const allBtn = h('button', { class: 'sm-all', type: 'button' }, h('b', null, 'すべてのプログラム(P)'), h('span', { class: 'sm-arrow' }, '▶'));
    allBtn.addEventListener('click', () => {
      const r = allBtn.getBoundingClientRect(), rr = this.root.getBoundingClientRect();
      const L = (label, ic, app, args) => ({ label, icon: ic, onClick: () => { this.closePopups(); this.launch(app, args); } });
      popupMenu(this, [
        { label: 'アクセサリ', icon: 'folder', sub: [L('メモ帳', 'editor', 'editor'), L('ペイント', 'paint', 'paint'), L('電卓', 'calc', 'calc'), L('コマンド プロンプト', 'terminal', 'terminal'), L('エクスプローラ', 'folder', 'files'), L('画像ビューア', 'image', 'viewer'), '-', { label: 'システム ツール', icon: 'folder', sub: [L('タスク マネージャ', 'taskmgr', 'taskmgr'), L('システム情報', 'info', 'about')] }] },
        { label: 'ゲーム', icon: 'folder', sub: [L('マインスイーパ', 'mines', 'mines')] },
        { label: 'Vim 8.2', icon: 'folder', sub: [L('Vim', 'terminal', 'terminal', { run: 'vim' }), L('Vim チュートリアル (メモ帳で開く)', 'text', 'editor', { path: this.desktopDir + '/はじめにお読みください.txt' })] },
        '-', L('インターネット ブラウザ', 'browser', 'browser'), L('コントロール パネル', 'settings', 'settings'),
        { label: 'スクリーン セーバーを開始', icon: 'saver', onClick: () => { this.closePopups(); setTimeout(() => this.startSaver(true), 300); } },
      ], r.right - rr.left - 6, r.top - rr.top - 190, { cls: 'sm-programs' });
    });
    this.startMenu = h('div', { class: 'start-menu' },
      h('div', { class: 'sm-head' }, h('span', { class: 'sm-avatar' }, this.icon('user', 40)), h('b', null, this.user)),
      h('div', { class: 'sm-body' },
        h('div', { class: 'sm-left' },
          item('browser', 'インターネット', () => this.launch('browser'), 'Web ブラウザ'), item('terminal', 'コマンド プロンプト', () => this.launch('terminal'), 'cmd.exe'), h('div', { class: 'sm-sep' }),
          item('editor', 'メモ帳', () => this.launch('editor')), item('paint', 'ペイント', () => this.launch('paint')), item('calc', '電卓', () => this.launch('calc')), item('mines', 'マインスイーパ', () => this.launch('mines')), item('folder', 'エクスプローラ', () => this.launch('files', { path: this.docs })),
          h('div', { class: 'sm-sep' }), allBtn),
        h('div', { class: 'sm-right' },
          item('folder', 'マイ ドキュメント', () => this.launch('files', { path: this.docs })), item('image', 'マイ ピクチャ', () => this.launch('files', { path: this.pics })), item('computer', 'マイ コンピュータ', () => this.launch('files', { path: 'computer:' })), h('div', { class: 'sm-sep' }),
          item('settings', 'コントロール パネル(C)', () => this.launch('settings')), item('taskmgr', 'タスク マネージャ', () => this.launch('taskmgr')), h('div', { class: 'sm-sep' }),
          item('help', 'ヘルプとサポート(H)', () => this.openPath(this.desktopDir + '/はじめにお読みください.txt')), item('run', 'ファイル名を指定して実行(R)...', () => this.runBox()))),
      h('div', { class: 'sm-foot' }, h('button', { class: 'sm-power', type: 'button', onClick: () => { this.closePopups(); this.logoffBox(); } }, this.icon('logout', 22), 'ログオフ(L)'), h('button', { class: 'sm-power', type: 'button', onClick: () => { this.closePopups(); this.offBox(); } }, this.icon('power', 22), '終了オプション(U)')));
    this.root.append(this.startMenu);
    this.startBtn.classList.add('open');
    this.sound('click');
    this._startOut = e => { if (!e.target.closest('.start-menu') && !e.target.closest('.start-btn') && !e.target.closest('.menu')) this.closePopups(); };
    setTimeout(() => document.addEventListener('pointerdown', this._startOut, true), 0);
  }
  async runBox() {
    const v = await inputBox(this, { title: 'ファイル名を指定して実行', label: '実行するプログラム名、または開くフォルダやドキュメント名、インターネット リソース名を入力してください。', value: this.store.get('run.last', 'cmd'), icon: 'run', width: 400 });
    if (v === null || !v.trim()) return;
    this.store.set('run.last', v.trim());
    this.runCommand(v.trim());
  }
  runCommand(s) {
    const m = /^("[^"]+"|\S+)\s*(.*)$/.exec(s), name = m[1].replace(/"/g, ''), rest = m[2].replace(/"/g, ''), key = name.toLowerCase().replace(/\.(exe|com|cpl)$/, '');
    const MAP = { cmd: ['terminal'], command: ['terminal'], notepad: ['editor', rest && { path: this.parsePath(rest) }], calc: ['calc'], mspaint: ['paint'], pbrush: ['paint'], winmine: ['mines'], explorer: ['files', rest && { path: this.parsePath(rest) }], iexplore: ['browser', rest && { url: rest }], taskmgr: ['taskmgr'], control: ['settings'], desk: ['settings', { page: 'desktop' }], winver: ['about'], vim: ['terminal', { run: 'vim ' + rest }], gvim: ['terminal', { run: 'vim ' + rest }], edit: ['terminal', { run: 'edit ' + rest }] };
    if (MAP[key]) return this.launch(MAP[key][0], MAP[key][1] || {});
    if (/^(https?:\/\/|www\.)/i.test(s) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s)) return this.launch('browser', { url: s });
    const p = this.parsePath(s);
    if (this.fs.exists(p)) return this.openPath(p);
    if (/^(shutdown|logoff)$/.test(key)) return this.offBox();
    msgBox(this, { title: name, text: `'${name}' が見つかりません。名前を正しく入力したかどうかを確認してから、やり直してください。ファイルを検索するには、[スタート] ボタンをクリックしてから、[検索] をクリックしてください。`, icon: 'error', width: 420 });
  }
  offBox() {
    if (this.root.querySelector('.xp-off')) return;
    const close = () => { el.remove(); this.desk.classList.remove('dim'); };
    const big = (ic, label, fn) => h('button', { class: 'xo-btn', type: 'button', onClick: fn }, this.icon(ic, 34), h('span', null, label));
    const el = h('div', { class: 'xp-off' }, h('div', { class: 'xo-box' }, h('div', { class: 'xo-head' }, h('b', null, 'コンピュータの電源を切る'), this.icon('gem', 30)),
      h('div', { class: 'xo-body' }, big('lock', 'スタンバイ(S)', () => { close(); setTimeout(() => this.startSaver(true), 200); }), big('power', '電源を切る(U)', () => { close(); this.power('poweroff'); }), big('restart', '再起動(R)', () => { close(); this.power('reboot'); })),
      h('div', { class: 'xo-foot' }, button('キャンセル', close))));
    this.root.append(el);
    this.desk.classList.add('dim');
    el.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    el.querySelector('.xo-foot button').focus();
  }
  async logoffBox() {
    if ((await msgBox(this, { title: 'Windows のログオフ', text: 'ログオフしますか?\n開いているウィンドウはすべて閉じられます。', icon: 'question', buttons: ['ログオフ(L)', 'キャンセル'] })) === 'ログオフ(L)') this.power('logout');
  }
  onKey(e) {
    if (e.ctrlKey && e.key === 'Escape') { e.preventDefault(); this.toggleStart(); }
    else if (e.altKey && e.key === 'F4' && this.wm.active) { e.preventDefault(); this.wm.active.close(); }
  }
  onFsChange() {
    if (!this.fs.exists('/WINDOWS/system32') && !this.crashed) this.crash('bsod', `問題が検出され、コンピュータの損傷を防ぐために停止しました。

SYSTEM32_WENT_MISSING

このエラー画面が初めて表示された場合は、落ち着いてください。
C:\\WINDOWS\\system32 が削除されたため、これ以上続行できません。

この画面はシミュレータの演出です。あなたの本物のコンピュータは無事です。

技術情報:

*** STOP: 0x0000007B (0xC0FFEE00, 0xDEADBEEF, 0x00000000, 0x00000000)

物理メモリのダンプを開始しています...
物理メモリのダンプが完了しました。

何かキーを押すか、クリックすると、仮想ディスクを初期状態に戻して再起動します。`);
  }
}
