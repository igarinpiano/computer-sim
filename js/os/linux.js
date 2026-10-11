// More Linux machines built on the Mint one: a bare Arch-style tty, an Ubuntu 8.04 style
// GNOME 2 desktop, a current Ubuntu style GNOME desktop and a KDE Plasma style desktop.

import { h, sleep, pad2 } from '../core/util.js';
import { sound } from '../core/sound.js';
import { store } from '../core/storage.js';
import { VFS } from '../core/vfs.js';
import { popupMenu, closeMenus, button } from '../core/ui.js';
import { Terminal } from '../term/terminal.js';
import { Bash } from '../term/bash.js';
import { Mint, binStubs } from './mint.js';
import { linuxSeed } from './seeds.js';

const HOME = '/home/user';
const TANGO = ['#2e3436', '#cc0000', '#4e9a06', '#c4a000', '#3465a4', '#75507b', '#06989a', '#d3d7cf', '#555753', '#ef2929', '#8ae234', '#fce94f', '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec'];
const DAYS = '日月火水木金土';
const SUN = ['           .  |  .           ', '        \\    ___    /        ', '          .-"   "-.          ', '   --    /         \\    --   ', '        |           |        ', '  ======================== ', '     ==================    ', '        ============       ', '           ======            '];
const GEAR = ['        ___    ___        ', '    _  |   |__|   |  _    ', '  _| |_|          |_| |_  ', ' |        .----.        | ', ' |_      /      \\      _| ', '   |    |   <>   |    |   ', '  _|     \\      /     |_  ', ' |        `----´        | ', ' |_   _            _   _| ', '   |_| |___    ___| |_|   ', '           |__|           '];
const PEAK = ['            /\\            ', '           /  \\           ', '          / /\\ \\          ', '         / /  \\ \\         ', '        / / /\\ \\ \\        ', '       / / /  \\ \\ \\       ', '      / / /    \\ \\ \\      ', '     / /_/      \\_\\ \\     ', '    /_____________\\_\\    '];
const procs = (dm, sess, shell, extra = []) => [[1, 'root', '/sbin/init splash', 0, 0.3], [2, 'root', '[kthreadd]', 0, 0], [312, 'root', '/lib/systemd/systemd-journald', 0, 0.4], [455, 'root', '/lib/systemd/systemd-udevd', 0, 0.1], [812, 'root', '/usr/sbin/NetworkManager --no-daemon', 0, 0.2],
  [901, 'root', dm, 0, 0.1], [1320, 'user', '/lib/systemd/systemd --user', 0, 0.1], [1344, 'user', sess, 0, 0.4], [1502, 'user', '/usr/bin/pipewire', 0.1, 0.2], [1588, 'user', shell, 2.1, 3.8], ...extra];

// cfg shared by the three desktops; d describes the distribution for the seed
function desk(cfg, d) {
  return { kind: 'linux', bigIcons: true, tabs: true, user: 'user', home: HOME, ci: false, perms: true, fsVersion: 1, workspaces: 4, termPalette: TANGO,
    docs: HOME + '/Documents', pics: HOME + '/Pictures', desktopDir: HOME + '/Desktop', trashDir: HOME + '/.local/share/Trash/files',
    seed: (b, fs) => { linuxSeed(b, fs, { host: cfg.host, kernel: cfg.info.kernel, label: cfg.name, version: cfg.info.version, codename: cfg.info.codename.toLowerCase(), ...d }); binStubs(b, 'debian'); }, ...cfg };
}

class Desk extends Mint {
  run(app, args) { this.closePopups(); this.launch(app, args); }
  greeterClock() { const d = new Date(); return `${d.getMonth() + 1}月${d.getDate()}日(${DAYS[d.getDay()]}) ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
  trayButtons(size = 16) {
    this.snd = h('button', { class: 'p-tray', type: 'button', onClick: () => { sound.enabled = !sound.enabled; this.refreshTray(); if (sound.enabled) this.sound('ding'); } });
    this._traySize = size;
    return [h('button', { class: 'p-tray', type: 'button', title: 'ネットワーク: 有線接続', onClick: () => this.notify('ネットワーク', navigator.onLine ? '接続済み: 有線接続 (あなたのブラウザの回線を使用しています)' : 'オフラインです') }, this.icon('network', size)), this.snd];
  }
  refreshTray() { this.snd.replaceChildren(this.icon(sound.enabled ? 'sound' : 'mute', this._traySize || 16)); this.snd.title = sound.enabled ? '音量: 100%' : 'ミュート'; }
  taskMenu(w, e, dy = 0) {
    e.preventDefault(); e.stopPropagation();
    const r = this.root.getBoundingClientRect();
    popupMenu(this, [{ label: '別のワークスペースへ移動', sub: this.wm.layers.map((_, i) => ({ label: `ワークスペース ${i + 1}`, checked: i === w.ws, onClick: () => this.wm.moveToWs(w, i) })) }, '-', { label: w.minimized ? '元に戻す' : '最小化', onClick: () => (w.minimized ? w.restore() : w.minimize()) }, { label: w.maximized ? '元のサイズに戻す' : '最大化', disabled: !w.resizable, onClick: () => { w.restore(); w.toggleMax(); } }, '-', { label: '閉じる', onClick: () => w.close() }], e.clientX - r.left, e.clientY - r.top + dy);
  }
  toggleTask(w) { if (this.wm.active === w && !w.minimized) w.minimize(); else { if (w.ws !== this.wm.ws) this.wm.switchWs(w.ws); w.restore(); } }
  // menu anchored under (or above) a panel button
  dropMenu(btn, items, above = false) {
    const r = this.root.getBoundingClientRect(), b = btn.getBoundingClientRect();
    const m = popupMenu(this, items, b.left - r.left, above ? 0 : b.bottom - r.top);
    if (above) m.el.style.top = Math.max(0, b.top - r.top - m.el.offsetHeight) + 'px';
    return m;
  }
  sessionItems() {
    return [{ label: '画面のロック', icon: 'lock', onClick: () => setTimeout(() => this.startSaver(true), 300) }, { label: 'ログアウト...', icon: 'logout', onClick: () => this.power('logout') }, '-',
      { label: '再起動...', icon: 'restart', onClick: () => this.power('reboot') }, { label: '電源オフ...', icon: 'power', onClick: () => this.offBox() }];
  }
}

// ================================================================= Ubuntu 8.04 style (GNOME 2)
const HARDY = desk({
  id: 'hardy', rootClass: 'gnome2', name: 'Ubuntu 8.04 風', tagline: 'GNOME 2 デスクトップ ／ 非公式シミュレータ', host: 'ubuntu-desktop', markIcon: 'ring', iconTheme: 'hardy', termClass: 'term-hardy', termLight: true, dark: false,
  about: 'Ubuntu 8.04 LTS 風デスクトップ (GNOME 2.22 風)', wallpapers: [['ember', '焚き火色'], ['dune', '砂丘'], ['plain', '単色']],
  flavor: { env: { XDG_CURRENT_DESKTOP: 'GNOME', DESKTOP_SESSION: 'gnome', COLORTERM: 'gnome-terminal', TERM: 'xterm' } },
  info: { name: 'Ubuntu', version: '8.04.4 LTS', codename: 'Hardy', id: 'Ubuntu', base: 'hardy', kernel: '2.6.24-32-generic', kernelVer: '#1 SMP Mon Dec 3 15:32:13 UTC 2012', de: 'GNOME 2.22.3', wm: 'Metacity', gtk: 'Human [GTK2]', icons: 'Human [GTK2]', terminal: 'gnome-terminal', pkgBase: 1164, color: '1;33', art: SUN,
    procs: procs('/usr/sbin/gdm', 'x-session-manager', 'gnome-panel', [[1640, 'user', 'nautilus --no-default-window --sm-client-id default3', 0.1, 0.9], [1655, 'user', '/usr/bin/metacity --sm-client-id=default1', 0.3, 0.5]]) },
  L: { terminal: '端末', editor: 'テキストエディタ', browser: 'Web ブラウザ', files: 'ファイル・ブラウザ', viewer: '画像ビューア', calc: '電卓', mines: 'マイン', paint: 'お絵かき', settings: '外観の設定', taskmgr: 'システム・モニタ', about: 'Ubuntu について', computer: 'コンピュータ', docs: 'ドキュメント', trash: 'ゴミ箱', emptyTrash: 'ゴミ箱を空にする' },
}, { id: 'Ubuntu', pretty: 'Ubuntu 8.04.4 LTS', osRelease: 'NAME="Ubuntu"\nVERSION="8.04.4 LTS (Hardy)"\nID=ubuntu\nID_LIKE=debian\nPRETTY_NAME="Ubuntu 8.04.4 LTS"\nVERSION_ID="8.04"\n',
  sources: '# deb cdrom:[Ubuntu 8.04.4 LTS - Release i386]/ hardy main restricted\ndeb http://old-releases.ubuntu.com/ubuntu/ hardy main restricted universe multiverse\ndeb http://old-releases.ubuntu.com/ubuntu/ hardy-updates main restricted universe multiverse\ndeb http://old-releases.ubuntu.com/ubuntu/ hardy-security main restricted universe multiverse\n',
  termHint: '(アプリケーション → アクセサリ → 端末、または Ctrl+Alt+T)', menuHint: '  ・画面上のパネルの「アプリケーション」「場所」「システム」からアプリを起動できます。\n  ・Ctrl+Alt+←/→ でワークスペースが立方体のように回転します。\n' });

export class Hardy extends Desk {
  constructor(mount, onExit) { super(mount, onExit, HARDY); }
  async start({ fast = false } = {}) {
    if (!fast) {
      const el = h('div', { class: 'g2-boot' }, this.icon('ring', 96), h('div', { class: 'g2-bar' }, h('i')), h('div', { class: 'mb-foot' }, '非公式の再現シミュレータです ／ クリックでスキップ'));
      this.root.replaceChildren(el);
      await Promise.race([sleep(3000), new Promise(r => el.addEventListener('pointerdown', r, { once: true }))]);
      el.classList.add('fade'); await sleep(350);
    }
    await this.greeter();
  }
  async shutdownScreen() { const el = h('div', { class: 'g2-boot bye' }, this.icon('ring', 96), h('div', { class: 'g2-bar back' }, h('i'))); this.root.append(el); await sleep(1700); }
  menus() {
    const A = (app, icon, args) => ({ label: this.L[app], icon, onClick: () => this.launch(app, args) });
    return {
      apps: [{ label: 'アクセサリ', icon: 'app', sub: [A('calc', 'calc'), A('editor', 'editor'), A('terminal', 'terminal')] }, { label: 'インターネット', icon: 'network', sub: [A('browser', 'browser')] }, { label: 'グラフィックス', icon: 'image', sub: [A('viewer', 'image'), A('paint', 'paint')] }, { label: 'ゲーム', icon: 'mines', sub: [A('mines', 'mines')] },
        { label: 'システムツール', icon: 'taskmgr', sub: [A('taskmgr', 'taskmgr')] }, '-', { label: '追加と削除...', icon: 'app', onClick: () => this.launch('terminal', { run: 'apt list --installed' }) }],
      places: [{ label: 'ホーム・フォルダ', icon: 'home', onClick: () => this.launch('files', { path: this.home }) }, { label: 'デスクトップ', icon: 'desktop', onClick: () => this.launch('files', { path: this.desktopDir }) }, { label: 'ドキュメント', icon: 'folder', onClick: () => this.launch('files', { path: this.docs }) }, { label: 'ピクチャ', icon: 'folder', onClick: () => this.launch('files', { path: this.pics }) }, '-',
        { label: 'コンピュータ', icon: 'computer', onClick: () => this.launch('files', { path: 'computer:' }) }, { label: 'ファイルシステム', icon: 'drive', onClick: () => this.launch('files', { path: '/' }) }, '-', { label: 'ゴミ箱', icon: 'trash', onClick: () => this.launch('files', { path: this.trashDir }) }],
      system: [{ label: '設定', icon: 'settings', sub: [A('settings', 'settings'), { label: 'スクリーンセーバー', icon: 'saver', onClick: () => this.launch('settings', { page: 'saver' }) }, { label: '保存データ', icon: 'drive', onClick: () => this.launch('settings', { page: 'storage' }) }] }, { label: 'システム管理', icon: 'taskmgr', sub: [A('taskmgr', 'taskmgr')] }, '-',
        { label: 'ヘルプとサポート', icon: 'help', onClick: () => this.openPath(this.desktopDir + '/はじめに.txt') }, { label: 'GNOME について', icon: 'info', onClick: () => this.notify('GNOME 2 風デスクトップ', '2 本のパネルと 3 つのメニュー。2008 年ごろの定番でした。') }, A('about', 'ring'), '-', ...this.sessionItems().slice(0, 2), { label: '終了...', icon: 'power', onClick: () => this.offBox() }],
    };
  }
  buildPanel() {
    const M = this.menus();
    const mb = (label, key, mark) => { const b = h('button', { class: 'g2-menu', type: 'button', onPointerdown: e => { e.stopPropagation(); this.closePopups(); this.dropMenu(b, M[key]); } }, mark ? this.icon('ring', 18) : null, h('span', null, label)); return b; };
    const L = (ic, label, fn) => h('button', { class: 'p-launch', type: 'button', title: label, onClick: fn }, this.icon(ic, 20));
    this.clock = h('button', { class: 'p-clock', type: 'button', onPointerdown: e => { e.stopPropagation(); this.toggleCal(); } });
    this.top = h('div', { class: 'g2-panel top' }, mb('アプリケーション', 'apps', true), mb('場所', 'places'), mb('システム', 'system'), h('div', { class: 'p-sep' }), L('browser', 'Web ブラウザ', () => this.launch('browser')), L('terminal', '端末', () => this.launch('terminal')), L('help', 'ヘルプ', () => this.openPath(this.desktopDir + '/はじめに.txt')),
      h('div', { class: 'p-right' }, ...this.trayButtons(18), this.clock, h('button', { class: 'p-tray g2-quit', type: 'button', title: '終了', onClick: () => this.offBox() }, this.icon('power', 18))));
    this.tasks = h('div', { class: 'tasks' });
    this.wsBox = h('div', { class: 'p-ws', title: 'ワークスペース切り替え器 (Ctrl+Alt+←/→)' });
    this.trashBtn = h('button', { class: 'p-launch', type: 'button', title: 'ゴミ箱', onClick: () => this.launch('files', { path: this.trashDir }) });
    this.panel = h('div', { class: 'g2-panel bottom' }, h('button', { class: 'p-launch', type: 'button', title: 'デスクトップを表示', onClick: () => { const ws = this.wm.windows.filter(w => !w.dialog && w.ws === this.wm.ws); const all = ws.every(w => w.minimized); for (const w of ws) (all ? w.restore() : w.minimized || w.minimize()); } }, this.icon('desktop', 18)), h('div', { class: 'p-sep' }), this.tasks, h('div', { class: 'p-right' }, this.wsBox, this.trashBtn));
    this.root.prepend(this.top); this.root.append(this.panel);
    for (const p of [this.top, this.panel]) p.addEventListener('contextmenu', e => e.preventDefault());
    this.wm.on('change', () => this.renderTasks());
    this.wm.on('ws', () => { this.renderTasks(); this.renderWs(); });
    this.wm.taskTarget = w => this.tasks.querySelector(`[data-pid="${w.pid}"]`)?.getBoundingClientRect();
    this.onFsChange = () => this.trashBtn.replaceChildren(this.icon(this.trashCount() ? 'trash-full' : 'trash', 18));
    this.onFsChange(); this.refreshTray(); this.tick(); this.renderTasks(); this.renderWs();
  }
  tick() { const d = new Date(); this.clock.textContent = `${d.getMonth() + 1}月${d.getDate()}日 (${DAYS[d.getDay()]}) ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
  renderTasks() {
    const wins = this.wm.windows.filter(w => !w.dialog && w.ws === this.wm.ws);
    this.tasks.replaceChildren(...wins.map(w => {
      const b = h('button', { class: 'task' + (this.wm.active === w && !w.minimized ? ' active' : ''), type: 'button', dataset: { pid: w.pid }, title: w.title }, this.icon(w.iconName, 16), h('span', null, w.minimized ? `[${w.title}]` : w.title));
      b.addEventListener('click', () => this.toggleTask(w));
      b.addEventListener('contextmenu', e => this.taskMenu(w, e, -130));
      return b;
    }));
  }
  onKey(e) { if (e.altKey && e.key === 'F1') { e.preventDefault(); this.closePopups(); this.dropMenu(this.top.firstChild, this.menus().apps); } else super.onKey(e); }
}

// ================================================================= current Ubuntu style (GNOME)
const UBUNTU = desk({
  id: 'ubuntu', rootClass: 'gshell ui-modern', name: 'Ubuntu 風', tagline: 'GNOME デスクトップ ／ 非公式シミュレータ', host: 'ubuntu-pc', markIcon: 'ring', iconTheme: 'ubuntu', termClass: 'term-ubuntu', dark: false,
  about: 'Ubuntu 24.04 LTS 風デスクトップ (GNOME 46 風)', wallpapers: [['dusk', '夕暮れ'], ['crown', '王冠'], ['plain', '単色']],
  flavor: { env: { XDG_CURRENT_DESKTOP: 'ubuntu:GNOME', XDG_SESSION_TYPE: 'wayland', DESKTOP_SESSION: 'ubuntu', WAYLAND_DISPLAY: 'wayland-0' } },
  info: { name: 'Ubuntu', version: '24.04.1 LTS', codename: 'Noble', id: 'Ubuntu', base: 'noble', kernel: '6.8.0-45-generic', kernelVer: '#45-Ubuntu SMP PREEMPT_DYNAMIC Fri Aug 30 12:02:04 UTC 2024', de: 'GNOME 46.0', wm: 'Mutter', gtk: 'Yaru [GTK2/3]', icons: 'Yaru [GTK2/3]', terminal: 'gnome-terminal', pkgBase: 1846, color: '1;31', art: SUN,
    procs: procs('/usr/sbin/gdm3', '/usr/libexec/gnome-session-binary --session=ubuntu', '/usr/bin/gnome-shell', [[1640, 'user', '/usr/libexec/gvfsd', 0, 0.1], [1702, 'user', '/usr/libexec/xdg-desktop-portal', 0, 0.2]]) },
  L: { terminal: '端末', editor: 'テキストエディター', browser: 'Web ブラウザ', files: 'ファイル', viewer: '画像ビューアー', calc: '電卓', mines: 'マイン', paint: 'お絵かき', settings: '設定', taskmgr: 'システムモニター', about: 'このシステムについて', computer: 'コンピューター', docs: 'ドキュメント', trash: 'ゴミ箱', emptyTrash: 'ゴミ箱を空にする' },
}, { id: 'Ubuntu', pretty: 'Ubuntu 24.04.1 LTS', osRelease: 'PRETTY_NAME="Ubuntu 24.04.1 LTS"\nNAME="Ubuntu"\nVERSION_ID="24.04"\nVERSION="24.04.1 LTS (Noble)"\nVERSION_CODENAME=noble\nID=ubuntu\nID_LIKE=debian\nUBUNTU_CODENAME=noble\n',
  sources: '# Ubuntu sources have moved to /etc/apt/sources.list.d/ubuntu.sources\ndeb http://archive.ubuntu.com/ubuntu noble main restricted universe multiverse\ndeb http://archive.ubuntu.com/ubuntu noble-updates main restricted universe multiverse\ndeb http://security.ubuntu.com/ubuntu noble-security main restricted universe multiverse\n',
  termHint: '(左の Dock の端末アイコン、または Ctrl+Alt+T)', menuHint: '  ・左の Dock からアプリを起動できます。いちばん下のボタンでアプリ一覧が開きます。\n  ・左上の「アクティビティ」でワークスペースを切り替えられます。\n' });

export class Ubuntu extends Desk {
  constructor(mount, onExit) { super(mount, onExit, UBUNTU); }
  async start({ fast = false } = {}) {
    if (!fast) {
      const el = h('div', { class: 'gs-boot' }, h('div', { class: 'mx-gear' }), h('div', { class: 'gs-brand' }, this.icon('ring', 30), h('b', null, 'ubuntu 風')), h('div', { class: 'mb-foot' }, '非公式の再現シミュレータです ／ クリックでスキップ'));
      this.root.replaceChildren(el);
      await Promise.race([sleep(2800), new Promise(r => el.addEventListener('pointerdown', r, { once: true }))]);
      el.classList.add('fade'); await sleep(350);
    }
    await this.greeter();
  }
  async shutdownScreen() { const el = h('div', { class: 'gs-boot bye' }, h('div', { class: 'mx-gear' }), h('div', { class: 'gs-brand' }, this.icon('ring', 30), h('b', null, 'ubuntu 風'))); this.root.append(el); await sleep(1700); }
  pinned() { return [['files', 'folder'], ['browser', 'browser'], ['terminal', 'terminal'], ['editor', 'editor'], ['settings', 'settings']]; }
  buildPanel() {
    this.actBtn = h('button', { class: 'gs-act', type: 'button', title: 'アクティビティ', onPointerdown: e => { e.stopPropagation(); this.overview(); } });
    this.clock = h('button', { class: 'gs-clock', type: 'button', onPointerdown: e => { e.stopPropagation(); this.toggleCal(); } });
    this.sys = h('button', { class: 'gs-sys', type: 'button', title: 'システムメニュー', onPointerdown: e => { e.stopPropagation(); this.quick(); } });
    this.top = h('div', { class: 'gs-top' }, this.actBtn, this.clock, this.sys);
    this.dockApps = h('div', { class: 'gs-apps' });
    this.dock = h('div', { class: 'gs-dock' }, this.dockApps, h('div', { class: 'gs-grow' }),
      h('button', { class: 'gs-item', type: 'button', dataset: { label: 'ゴミ箱' }, onClick: () => this.launch('files', { path: this.trashDir }) }, this.icon('trash', 34)),
      h('button', { class: 'gs-item gs-grid', type: 'button', dataset: { label: 'アプリを表示する' }, onPointerdown: e => { e.stopPropagation(); this.overview(true); } }, this.icon('grid', 28)));
    this.dock.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); });
    this.top.addEventListener('contextmenu', e => e.preventDefault());
    this.root.prepend(this.top); this.desk.append(this.dock);
    this.wm.on('change', () => this.renderTasks());
    this.wm.on('ws', () => { this.renderTasks(); this.renderWs(); });
    this.wm.taskTarget = w => (this.dockApps.querySelector(`[data-pid~="${w.pid}"]`) || this.dock).getBoundingClientRect();
    this.tick(); this.renderTasks(); this.renderWs();
  }
  refreshTray() { this.sys.replaceChildren(this.icon('network', 16), this.icon(sound.enabled ? 'sound' : 'mute', 16), this.icon('power', 16)); }
  tick() { const d = new Date(); this.clock.textContent = `${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
  renderWs() { this.refreshTray(); this.actBtn.replaceChildren(...this.wm.layers.map((_, i) => h('i', { class: i === this.wm.ws ? 'cur' : '' }))); }
  renderTasks() {
    const wins = this.wm.windows.filter(w => !w.dialog), pinned = this.pinned(), seen = new Set(pinned.map(p => p[0]));
    const item = (app, ic, ws) => {
      const b = h('button', { class: 'gs-item' + (ws.length ? ' run' : '') + (ws.includes(this.wm.active) && !this.wm.active.minimized ? ' active' : ''), type: 'button', dataset: { label: this.L[app] || app, pid: ws.map(w => w.pid).join(' ') } }, this.icon(ic, 34), ws.length ? h('span', { class: 'gs-dots' }, ws.slice(0, 4).map(() => h('i'))) : null);
      b.addEventListener('click', () => { if (!ws.length) return this.launch(app); const cur = ws.indexOf(this.wm.active); if (ws.length > 1 && cur >= 0 && !this.wm.active.minimized) { const n = ws[(cur + 1) % ws.length]; if (n.ws !== this.wm.ws) this.wm.switchWs(n.ws); n.restore(); } else this.toggleTask(ws[Math.max(cur, 0)]); });
      b.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); const r = this.root.getBoundingClientRect(); popupMenu(this, [{ label: '新しいウィンドウ', onClick: () => this.launch(app) }, ...(ws.length ? ['-', ...ws.map(w => ({ label: w.title, onClick: () => { if (w.ws !== this.wm.ws) this.wm.switchWs(w.ws); w.restore(); } })), '-', { label: ws.length > 1 ? `${ws.length} 個のウィンドウを終了` : '終了', onClick: () => ws.forEach(w => w.close()) }] : [])], b.getBoundingClientRect().right - r.left + 6, e.clientY - r.top - 20); });
      return b;
    };
    const extra = [...new Set(wins.map(w => w.app).filter(a => !seen.has(a)))];
    this.dockApps.replaceChildren(...pinned.map(([app, ic]) => item(app, ic, wins.filter(w => w.app === app))), ...(extra.length ? [h('div', { class: 'gs-sep' })] : []), ...extra.map(app => { const ws = wins.filter(w => w.app === app); return item(app, ws[0].iconName, ws); }));
  }
  closePopups() { if (this.overEl) { this.overEl.remove(); this.overEl = null; } if (this.quickEl) { this.quickEl.remove(); this.quickEl = null; } this.actBtn?.classList.remove('open'); super.closePopups(); }
  // Activities overview: workspace strip, search and the application grid
  overview(appsOnly = false) {
    if (this.overEl) return this.closePopups();
    this.closePopups(); closeMenus();
    const list = h('div', { class: 'gs-list' }), search = h('input', { class: 'gs-search', type: 'text', placeholder: '検索ワードを入力', spellcheck: 'false' });
    const draw = () => { const q = search.value.trim().toLowerCase(), apps = this.appList().filter(a => !q || (a[0] + a[1] + a[4]).toLowerCase().includes(q)); list.replaceChildren(...apps.map(a => h('button', { class: 'gs-app', type: 'button', onClick: () => this.run(a[0]) }, this.icon(a[2], 64), h('span', null, a[1]))), ...(apps.length ? [] : [h('div', { class: 'mm-none' }, '見つかりませんでした')])); };
    const wss = h('div', { class: 'gs-wss' }, this.wm.layers.map((_, i) => { const n = this.wm.windows.filter(w => !w.dialog && w.ws === i); return h('button', { class: 'gs-ws' + (i === this.wm.ws ? ' cur' : ''), type: 'button', title: `ワークスペース ${i + 1}`, onClick: () => { this.closePopups(); this.wm.switchWs(i); } }, h('b', null, String(i + 1)), h('span', null, n.length ? n.map(w => w.title).slice(0, 3).join('、') : '空き')); }));
    this.overEl = h('div', { class: 'gs-over' + (appsOnly ? ' apps' : '') }, search, wss, list);
    this.overEl.addEventListener('pointerdown', e => { if (e.target === this.overEl || e.target === list) this.closePopups(); });
    this.desk.append(this.overEl); this.actBtn.classList.add('open');
    search.addEventListener('input', draw);
    search.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') list.querySelector('.gs-app')?.click(); else if (e.key === 'Escape') this.closePopups(); });
    draw(); setTimeout(() => search.focus(), 30);
    this._watchOutside('.gs-over, .gs-act, .gs-dock');
  }
  quick() {
    if (this.quickEl) return this.closePopups();
    this.closePopups(); closeMenus();
    const tile = (ic, label, on, fn) => h('button', { class: 'gq-tile' + (on ? ' on' : ''), type: 'button', onClick: fn }, this.icon(ic, 18), h('span', null, label));
    const rnd = (ic, label, fn) => h('button', { class: 'gq-round', type: 'button', title: label, onClick: () => { this.closePopups(); fn(); } }, this.icon(ic, 18));
    const draw = () => this.quickEl.replaceChildren(
      h('div', { class: 'gq-row' }, h('span', { class: 'gq-user' }, this.icon('user', 22), `${this.user}@${this.host}`), h('span', { class: 'gq-grow' }), rnd('settings', '設定', () => this.launch('settings')), rnd('lock', '画面ロック', () => setTimeout(() => this.startSaver(true), 300)), rnd('power', '電源オフ / ログアウト', () => this.offBox())),
      h('div', { class: 'gq-tiles' }, tile('network', navigator.onLine ? '有線接続' : 'オフライン', navigator.onLine, () => this.notify('ネットワーク', navigator.onLine ? '接続済み (あなたのブラウザの回線を使用しています)' : 'オフラインです')), tile(sound.enabled ? 'sound' : 'mute', 'サウンド', sound.enabled, () => { sound.enabled = !sound.enabled; this.refreshTray(); if (sound.enabled) this.sound('ding'); draw(); }),
        tile('saver', 'スクリーンセーバー', this.settings.saver !== 'none', () => { this.closePopups(); this.launch('settings', { page: 'saver' }); }), tile('logout', 'ログアウト', false, () => { this.closePopups(); this.power('logout'); })));
    this.quickEl = h('div', { class: 'gq' });
    draw(); this.root.append(this.quickEl);
    this._watchOutside('.gq, .gs-sys');
  }
  onKey(e) { if (e.altKey && e.key === 'F1') { e.preventDefault(); this.overview(); } else super.onKey(e); }
}

// ================================================================= KDE Plasma style
const KDE = desk({
  id: 'kde', rootClass: 'plasma ui-modern', name: 'KDE Plasma 風', tagline: 'Plasma デスクトップ ／ 非公式シミュレータ', host: 'plasma-pc', markIcon: 'cog', iconTheme: 'kde', termClass: 'term-kde', dark: false,
  about: 'KDE Plasma 6 風デスクトップ (Breeze 風)', wallpapers: [['flow', '流れ'], ['prism', 'プリズム'], ['plain', '単色']],
  flavor: { env: { XDG_CURRENT_DESKTOP: 'KDE', XDG_SESSION_TYPE: 'wayland', DESKTOP_SESSION: 'plasma', KDE_FULL_SESSION: 'true', WAYLAND_DISPLAY: 'wayland-0' } },
  info: { name: 'KDE neon', version: '6.2', codename: 'Noble', id: 'Neon', base: 'noble', kernel: '6.8.0-47-generic', kernelVer: '#47-Ubuntu SMP PREEMPT_DYNAMIC Fri Sep 27 21:40:26 UTC 2024', de: 'KDE Plasma 6.2.0', wm: 'KWin (Wayland)', gtk: 'Breeze [GTK2/3]', icons: 'breeze [GTK2/3]', terminal: 'konsole', pkgBase: 2012, color: '1;36', art: GEAR,
    procs: procs('/usr/bin/sddm', '/usr/bin/startplasma-wayland', '/usr/bin/plasmashell --no-respawn', [[1601, 'user', '/usr/bin/kwin_wayland --wayland-fd 5', 1.4, 2.2], [1640, 'user', '/usr/bin/kded6', 0, 0.4], [1702, 'user', '/usr/lib/x86_64-linux-gnu/libexec/baloo_file', 0, 0.3]]) },
  L: { terminal: 'Konsole', editor: 'Kate', browser: 'Web ブラウザ', files: 'Dolphin', viewer: 'Gwenview', calc: 'KCalc', mines: 'KMines', paint: 'KolourPaint', settings: 'KDE システム設定', taskmgr: 'システムモニター', about: 'このシステムについて', computer: 'コンピューター', docs: 'ドキュメント', trash: 'ごみ箱', emptyTrash: 'ごみ箱を空にする', openTerm: 'ここで Konsole を開く' },
}, { id: 'Neon', pretty: 'KDE neon 6.2', osRelease: 'PRETTY_NAME="KDE neon 6.2"\nNAME="KDE neon"\nVERSION_ID="24.04"\nVERSION="6.2"\nVERSION_CODENAME=noble\nID=neon\nID_LIKE="ubuntu debian"\nUBUNTU_CODENAME=noble\n',
  sources: 'deb http://archive.ubuntu.com/ubuntu noble main restricted universe multiverse\ndeb http://archive.ubuntu.com/ubuntu noble-updates main restricted universe multiverse\ndeb http://security.ubuntu.com/ubuntu noble-security main restricted universe multiverse\n',
  termHint: '(パネルの Konsole アイコン、または Ctrl+Alt+T)', menuHint: '  ・左下のアプリケーションランチャーからアプリを起動できます。\n  ・dolphin / kate / konsole などのコマンドでもアプリが開きます。\n' });

export class Kde extends Desk {
  constructor(mount, onExit) { super(mount, onExit, KDE); }
  async start({ fast = false } = {}) {
    if (!fast) {
      const el = h('div', { class: 'kd-boot' }, this.icon('cog', 110), h('div', { class: 'mx-gear' }), h('div', { class: 'mb-foot' }, '非公式の再現シミュレータです ／ クリックでスキップ'));
      this.root.replaceChildren(el);
      await Promise.race([sleep(2800), new Promise(r => el.addEventListener('pointerdown', r, { once: true }))]);
      el.classList.add('fade'); await sleep(350);
    }
    await this.greeter();
  }
  async shutdownScreen() { const el = h('div', { class: 'kd-boot bye' }, this.icon('cog', 110), h('div', { class: 'mx-gear' })); this.root.append(el); await sleep(1700); }
  pinned() { return [['files', 'folder'], ['browser', 'browser'], ['terminal', 'terminal']]; }
  buildPanel() {
    this.menuBtn = h('button', { class: 'kd-start', type: 'button', title: 'アプリケーションランチャー', onPointerdown: e => { e.stopPropagation(); this.toggleMenu(); } }, this.icon('cog', 28));
    this.tasks = h('div', { class: 'kd-tasks' });
    this.wsBox = h('div', { class: 'kd-pager', title: '仮想デスクトップ (Ctrl+Alt+←/→)' });
    this.clock = h('button', { class: 'kd-clock', type: 'button', onPointerdown: e => { e.stopPropagation(); this.toggleCal(); } });
    this.panel = h('div', { class: 'kd-panel' }, this.menuBtn, this.tasks, h('div', { class: 'kd-grow' }), this.wsBox, h('div', { class: 'kd-tray' }, ...this.trayButtons(18)), this.clock,
      h('button', { class: 'kd-peek', type: 'button', title: 'デスクトップを一時的に表示', onClick: () => { const ws = this.wm.windows.filter(w => !w.dialog && w.ws === this.wm.ws); const all = ws.every(w => w.minimized); for (const w of ws) (all ? w.restore() : w.minimized || w.minimize()); } }));
    this.panel.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); });
    this.desk.append(this.panel);
    this.wm.on('change', () => this.renderTasks());
    this.wm.on('ws', () => { this.renderTasks(); this.renderWs(); });
    this.wm.taskTarget = w => (this.tasks.querySelector(`[data-pid~="${w.pid}"]`) || this.tasks).getBoundingClientRect();
    this.refreshTray(); this.tick(); this.renderTasks(); this.renderWs();
  }
  tick() { const d = new Date(); this.clock.replaceChildren(h('b', null, `${pad2(d.getHours())}:${pad2(d.getMinutes())}`), h('span', null, `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`)); }
  renderWs() { this.wsBox.replaceChildren(...this.wm.layers.map((_, i) => h('button', { class: 'kd-ws' + (i === this.wm.ws ? ' cur' : ''), type: 'button', title: `デスクトップ ${i + 1}`, onClick: () => this.wm.switchWs(i) }))); }
  renderTasks() {
    const wins = this.wm.windows.filter(w => !w.dialog && w.ws === this.wm.ws), pinned = this.pinned(), seen = new Set(pinned.map(p => p[0]));
    const item = (app, ic, ws) => {
      const b = h('button', { class: 'kd-task' + (ws.length ? ' run' : '') + (ws.includes(this.wm.active) && !this.wm.active.minimized ? ' active' : ''), type: 'button', title: ws.length ? ws.map(w => w.title).join('\n') : this.L[app] || app, dataset: { pid: ws.map(w => w.pid).join(' ') } }, this.icon(ic, 30), ws.length > 1 ? h('em', null, String(ws.length)) : null);
      b.addEventListener('click', () => { if (!ws.length) return this.launch(app); const cur = ws.indexOf(this.wm.active); if (ws.length > 1 && cur >= 0 && !this.wm.active.minimized) ws[(cur + 1) % ws.length].restore(); else this.toggleTask(ws[Math.max(cur, 0)]); });
      b.addEventListener('contextmenu', e => { if (ws.length) this.taskMenu(ws[Math.max(ws.indexOf(this.wm.active), 0)], e, -170); else { e.preventDefault(); e.stopPropagation(); } });
      return b;
    };
    const extra = [...new Set(wins.map(w => w.app).filter(a => !seen.has(a)))];
    this.tasks.replaceChildren(...pinned.map(([app, ic]) => item(app, ic, wins.filter(w => w.app === app))), ...extra.map(app => { const ws = wins.filter(w => w.app === app); return item(app, ws[0].iconName, ws); }));
  }
  // application launcher (search on top, categories on the left, session buttons below)
  toggleMenu() {
    if (this.menuEl) return this.closePopups();
    this.closePopups(); closeMenus();
    const cats = [['お気に入り', 'star'], ['すべてのアプリケーション', 'grid'], ['インターネット', 'network'], ['グラフィックス', 'image'], ['ゲーム', 'mines'], ['システムツール', 'taskmgr'], ['アクセサリ', 'app'], ['設定', 'settings']], FAV = ['browser', 'files', 'terminal', 'editor', 'settings'];
    let cat = cats[0][0];
    const list = h('div', { class: 'kk-apps' }), catEl = h('div', { class: 'kk-cats' }), search = h('input', { class: 'kk-search', type: 'text', placeholder: '検索...', spellcheck: 'false' });
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      catEl.replaceChildren(...cats.map(([c, ic]) => { const b = h('button', { class: 'kk-cat' + (c === cat && !q ? ' cur' : ''), type: 'button' }, this.icon(ic, 22), h('span', null, c)); b.addEventListener('pointerenter', () => { if (cat !== c) { cat = c; search.value = ''; draw(); } }); return b; }));
      const all = this.appList(), apps = q ? all.filter(a => (a[0] + a[1] + a[4]).toLowerCase().includes(q)) : cat === cats[0][0] ? FAV.map(f => all.find(a => a[0] === f)) : cat === cats[1][0] ? all : all.filter(a => a[3] === cat);
      list.replaceChildren(...apps.map(a => h('button', { class: 'kk-app', type: 'button', onClick: () => this.run(a[0]) }, this.icon(a[2], 32), h('span', null, h('b', null, a[1]), h('small', null, a[4])))), ...(apps.length ? [] : [h('div', { class: 'mm-none' }, '一致するものがありません')]));
    };
    const pw = (ic, label, fn) => h('button', { class: 'kk-pw', type: 'button', title: label, onClick: () => { this.closePopups(); fn(); } }, this.icon(ic, 20), h('span', null, label));
    this.menuEl = h('div', { class: 'kk' }, h('div', { class: 'kk-head' }, h('span', { class: 'kk-user' }, this.icon('user', 30)), h('b', null, this.user), search), h('div', { class: 'kk-cols' }, catEl, list),
      h('div', { class: 'kk-foot' }, pw('saver', 'スリープ', () => setTimeout(() => this.startSaver(true), 300)), pw('restart', '再起動', () => this.power('reboot')), pw('power', 'シャットダウン', () => this.offBox()), pw('logout', 'ログアウト', () => this.power('logout'))));
    this.desk.append(this.menuEl); this.menuBtn.classList.add('open');
    search.addEventListener('input', draw);
    search.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') list.querySelector('.kk-app')?.click(); else if (e.key === 'Escape') this.closePopups(); });
    draw(); setTimeout(() => search.focus(), 30);
    this._watchOutside('.kk, .kd-start');
  }
}

// ================================================================= Arch style (text console only)
const ARCH_INFO = { family: 'arch', name: 'Arch Linux', version: '', codename: 'n/a', id: 'Arch', de: '', kernel: '6.10.6-arch1-1', kernelVer: '#1 SMP PREEMPT_DYNAMIC Mon, 19 Aug 2024 17:02:39 +0000', terminal: '/dev/tty1', pkgBase: 142, color: '1;36', art: PEAK,
  procs: [[1, 'root', '/sbin/init', 0, 0.3], [2, 'root', '[kthreadd]', 0, 0], [212, 'root', '/usr/lib/systemd/systemd-journald', 0, 0.3], [240, 'root', '/usr/lib/systemd/systemd-udevd', 0, 0.1], [301, 'systemd+', '/usr/lib/systemd/systemd-networkd', 0, 0.1], [310, 'dbus', '/usr/bin/dbus-broker-launch --scope system', 0, 0.1], [322, 'root', '/usr/lib/systemd/systemd-logind', 0, 0.1], [330, 'root', 'login -- user', 0, 0.1]] };
const UNITS = ['Create Volatile Files and Directories', 'Load Kernel Modules', 'Remount Root and Kernel File Systems', 'Coldplug All udev Devices', 'Apply Kernel Variables', 'Local File Systems', 'Network Time Synchronization', 'D-Bus System Message Bus', 'User Login Management', 'Network Configuration', 'Network Name Resolution', 'Getty on tty1', 'Login Prompts', 'Multi-User System'];

export class Arch {
  constructor(mount, onExit) {
    this.id = 'arch'; this.kind = 'linux'; this.onExit = onExit; this.bootTime = Date.now(); this.info = ARCH_INFO; this.host = 'archlinux';
    this.fs = new VFS({ storeKey: 'arch:fs', ci: false, perms: true, user: 'user', version: 1,
      seed: (b, fs) => { linuxSeed(b, fs, { family: 'arch', host: this.host, kernel: ARCH_INFO.kernel, label: 'Arch Linux 風', id: 'Arch', version: 'rolling', codename: 'n/a', pretty: 'Arch Linux', osRelease: 'NAME="Arch Linux"\nPRETTY_NAME="Arch Linux"\nID=arch\nBUILD_ID=rolling\nANSI_COLOR="38;2;23;147;209"\nHOME_URL="https://archlinux.org/"\nLOGO=archlinux-logo\n' }); binStubs(b, 'arch'); } });
    const ram = (navigator.deviceMemory || 8) * 1048576;
    Object.assign(this.fs.dyn, { null: () => '', random: () => Array.from({ length: 64 }, () => String.fromCharCode(33 + Math.floor(Math.random() * 90))).join(''),
      cpuinfo: () => Array.from({ length: navigator.hardwareConcurrency || 4 }, (_, i) => `processor\t: ${i}\nvendor_id\t: GenuineBrowser\nmodel name\t: JavaScript Virtual CPU @ 3.00GHz\ncpu MHz\t\t: 3000.000\n`).join('\n') + '\n',
      meminfo: () => `MemTotal:       ${String(ram).padStart(8)} kB\nMemFree:        ${String(Math.round(ram * 0.82)).padStart(8)} kB\nMemAvailable:   ${String(Math.round(ram * 0.9)).padStart(8)} kB\nSwapTotal:             0 kB\nSwapFree:              0 kB\n`,
      uptime: () => `${((Date.now() - this.bootTime) / 1000).toFixed(2)} ${((Date.now() - this.bootTime) / 1000 * 3.9).toFixed(2)}\n`, loadavg: () => '0.02 0.05 0.01 1/112 412\n' });
    this.root = h('div', { class: 'machine os-dos os-arch' });
    mount.append(this.root);
    this._unload = e => { if (this.running) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', this._unload);
  }
  async start({ fast = false } = {}) {
    const host = h('div', { class: 'dos-screen tint-white' });
    const bar = h('div', { class: 'dos-bar' }, h('span', null, 'Arch Linux 風コンソール ／ 非公式シミュレータ'),
      h('span', { class: 'dos-bar-btns' }, h('button', { type: 'button', onClick: () => { if (!confirm('この OS の保存データを消去して初期状態に戻しますか?')) return; this.running = false; clearTimeout(this.fs._saveT); this.fs.storeKey = null; store.clear('arch'); window.removeEventListener('beforeunload', this._unload); this.onExit('reboot'); } }, '初期化'), h('button', { type: 'button', onClick: () => this.power('poweroff') }, '電源を切る')));
    this.root.append(bar, host);
    const term = this.term = new Terminal(host, { class: 'term-dos term-tty', palette: ['#000000', '#aa0000', '#00aa00', '#aa5500', '#0000aa', '#aa00aa', '#00aaaa', '#aaaaaa', '#555555', '#ff5555', '#55ff55', '#ffff55', '#5555ff', '#ff55ff', '#55ffff', '#ffffff'] });
    term.onBell = () => sound.fx('beep');
    host.addEventListener('pointerdown', () => { sound.unlock(); setTimeout(() => term.focus(), 0); });
    term.focus();
    this.running = true;
    let skip = fast;
    const pop = term.pushHandler(() => { skip = true; sound.unlock(); return true; });
    const wait = ms => (skip ? Promise.resolve() : sleep(ms));
    term.cursorOn = false;
    term.write(':: running early hook [udev]\nStarting systemd-udevd version 256.5-1-arch\n:: running hook [udev]\n:: Triggering uevents...\n:: performing fsck on \'/dev/sda2\'\n/dev/sda2: clean, 41872/3276800 files, 512040/13107200 blocks\n:: mounting \'/dev/sda2\' on real root\n:: running cleanup hook [udev]\n\nWelcome to \x1b[1;36mArch Linux\x1b[0m 風コンソール!\n\n');
    for (const u of UNITS) { await wait(70 + Math.random() * 90); term.write(`[\x1b[1;32m  OK  \x1b[0m] ${/System|Prompts|Systems$/.test(u) ? 'Reached target' : 'Started'} \x1b[1m${u}\x1b[0m.\n`); }
    await wait(500);
    pop(); term.cursorOn = true;
    while (!this.off) {
      term.write(`\nArch Linux ${ARCH_INFO.kernel} (tty1)\n\n`);
      if (!this.hinted) { this.hinted = true; term.write('\x1b[2m(ユーザー名は user か root、パスワードは何でも通ります)\x1b[0m\n'); }
      const name = await term.readLine({ prompt: `${this.host} login: ` });
      if (typeof name !== 'string' || !name.trim()) continue;
      const pw = await term.readLine({ prompt: 'Password: ', mask: true });
      if (typeof pw !== 'string') continue;
      const user = name.trim();
      if (user !== 'user' && user !== 'root') { await sleep(900); term.write('Login incorrect\n'); continue; }
      this.fs.user = user;
      const home = user === 'root' ? '/root' : HOME;
      term.write(`Last login: ${new Date(this.bootTime - 86400000).toString().slice(0, 24)} on tty1\n`);
      const sh = new Bash({ term, fs: this.fs, os: this, user, host: this.host, home, flavor: { family: 'arch', pkgFile: '/var/lib/pacman/installed', ps1: '[\\u@\\h \\W]\\$ ', env: { DISPLAY: null, XDG_CURRENT_DESKTOP: null, DESKTOP_SESSION: null, COLORTERM: null, XDG_SESSION_TYPE: 'tty', TERM: 'linux', PATH: '/usr/local/sbin:/usr/local/bin:/usr/bin' } } });
      if (user === 'user' && !store.get('arch:welcomed')) { store.set('arch:welcomed', true); sh.autorun = 'cat README.txt'; }
      await sh.run();
      this.fs.user = 'user';
      if (!this.off) term.clear?.();
    }
  }
  procs() { return []; }
  notify(title, body = '') { if (this.term && !this.off) this.term.write(`\n\x1b[1;33m*** ${title}\x1b[0m ${body}\n`); }
  panic() {
    setTimeout(() => {
      this.running = false; this.off = true;
      const t = ((Date.now() - this.bootTime) / 1000).toFixed(6);
      const el = h('div', { class: 'crash panic' }, h('pre', null, `[ ${t}] Kernel panic - not syncing: Attempted to kill init! exitcode=0x00007f00\n[ ${t}] CPU: 0 PID: 1 Comm: systemd Not tainted ${ARCH_INFO.kernel} #1\n[ ${t}] Hardware name: Browser Virtual Machine 1.0\n[ ${t}] ---[ end Kernel panic - not syncing: Attempted to kill init! exitcode=0x00007f00 ]---\n\nrm -rf / を本当に実行してしまいましたね。(これはシミュレータなので、本物の PC は無事です)\n\n何かキーを押すか、クリックすると、仮想ディスクを初期状態に戻して再起動します。`));
      this.root.append(el); sound.fx('error');
      const go = () => { window.removeEventListener('keydown', go, true); clearTimeout(this.fs._saveT); this.fs.storeKey = null; store.clear('arch'); window.removeEventListener('beforeunload', this._unload); this.onExit('reboot'); };
      setTimeout(() => { window.addEventListener('keydown', go, true); el.addEventListener('pointerdown', go); }, 1500);
    }, 600);
  }
  async power(kind) {
    if (this.off) return;
    this.off = true; this.running = false;
    this.fs.save();
    const t = this.term;
    t.write('\n'); for (const u of ['Stopped target Multi-User System', 'Stopped User Login Management', 'Unmounted /home', 'Reached target System Shutdown', kind === 'reboot' ? 'Reached target System Reboot' : 'Reached target System Power Off']) { t.write(`[\x1b[1;32m  OK  \x1b[0m] ${u}.\n`); await sleep(110); }
    await sleep(350);
    this.root.classList.add('crt-off');
    await sleep(650);
    window.removeEventListener('beforeunload', this._unload);
    this.onExit(kind);
  }
}
