// Apple-style machines. One class covers six generations: the classic desktop (System 7 and
// Platinum), Aqua, the flat era, the Big Sur era and Liquid Glass. They differ by configuration
// and stylesheet; the menu bar, Dock, Launchpad and Spotlight are shared.

import { h, sleep, pad2 } from '../core/util.js';
import { sound } from '../core/sound.js';
import { store } from '../core/storage.js';
import { popupMenu, closeMenus, menuBar, button } from '../core/ui.js';
import { Machine } from './machine.js';
import { macSeed, classicMacSeed } from './seeds.js';
import { Bash } from '../term/bash.js';
import { commands } from '../term/coreutils.js';
import '../term/sysutils.js';
import '../term/tui.js';
import '../term/awk.js';

export { Apple2 } from './apple2.js';

const PAL = ['#000000', '#c23621', '#25bc24', '#adad27', '#492ee1', '#d338d3', '#33bbc8', '#cbcccd', '#818383', '#fc391f', '#31e722', '#eaec23', '#5833ff', '#f935f8', '#14f0f0', '#e9ebeb'];
const NAMES = { Desktop: 'デスクトップ', Documents: '書類', Downloads: 'ダウンロード', Movies: 'ムービー', Music: 'ミュージック', Pictures: 'ピクチャ', Public: 'パブリック', Applications: 'アプリケーション', Library: 'ライブラリ', System: 'システム', Users: 'ユーザ' };
const ERAS = {
  mac7: { era: 'classic', name: 'クラシック Mac 風', tagline: 'System 7 の頃 ／ 非公式シミュレータ', wallpapers: [['dither', 'グレー'], ['blueprint', '方眼'], ['plain', '白']], about: ['クラシック Macintosh 風デスクトップ (System 7 の頃)', '内蔵メモリ: 8,192K　　最大未使用ブロック: 5,120K'] },
  mac9: { era: 'platinum', name: 'Mac OS 9 風', tagline: 'プラチナ アピアランス ／ 非公式シミュレータ', wallpapers: [['lilac', 'ライラック'], ['pond', '水面'], ['plain', 'グレー']], about: ['Mac OS 9 風デスクトップ (プラチナ アピアランス)', '内蔵メモリ: 128 MB　　仮想メモリ: 129 MB'] },
  aqua: { era: 'aqua', name: 'Mac OS X (Aqua) 風', tagline: 'バージョン 10.4 の頃 ／ 非公式シミュレータ', host: 'PowerMac', wallpapers: [['aqua', 'アクア ブルー'], ['graphite', 'グラファイト'], ['plain', '単色']], about: ['Mac OS X 風デスクトップ (Aqua)', 'バージョン 10.4.11 相当の見た目を目指した再現'], settingsName: 'システム環境設定',
    info: { product: 'Mac OS X', version: '10.4.11', build: '8S165', kernel: '8.11.0', arch: 'Power Macintosh', kernelVer: 'Darwin Kernel Version 8.11.0: Wed Oct 10 18:26:00 PDT 2007; root:xnu-792.24.17~1/RELEASE_PPC', model: 'Power Mac G5', chip: 'PowerPC G5 (という設定)' } },
  yosemite: { era: 'flat', name: 'OS X (フラット デザイン) 風', tagline: 'バージョン 10.10 の頃 ／ 非公式シミュレータ', wallpapers: [['ridge', '岩山'], ['wave', '波'], ['plain', '単色']], about: ['OS X 風デスクトップ (フラット デザイン)', 'バージョン 10.10.5 相当の見た目を目指した再現'], settingsName: 'システム環境設定',
    info: { product: 'Mac OS X', version: '10.10.5', build: '14F27', kernel: '14.5.0', arch: 'x86_64', kernelVer: 'Darwin Kernel Version 14.5.0: Wed Jul 29 02:26:53 PDT 2015; root:xnu-2782.40.9~1/RELEASE_X86_64', model: 'iMac (Retina 5K, 27-inch)', chip: 'Intel Core i5 (という設定)' } },
  bigsur: { era: 'bigsur', name: 'macOS (Big Sur 世代) 風', tagline: 'バージョン 11 の頃 ／ 非公式シミュレータ', wallpapers: [['dawn', '夜明け'], ['coast', '海岸'], ['plain', '単色']], about: ['macOS 風デスクトップ (Big Sur 世代)', 'バージョン 11.7 相当の見た目を目指した再現'], settingsName: 'システム環境設定',
    info: { product: 'macOS', version: '11.7.10', build: '20G1427', kernel: '20.6.0', arch: 'x86_64', kernelVer: 'Darwin Kernel Version 20.6.0: Thu Jul  6 22:12:47 PDT 2023; root:xnu-7195.141.49.702.12~1/RELEASE_X86_64', model: 'iMac (24-inch)', chip: 'Intel Core i7 (という設定)' } },
  tahoe: { era: 'glass', name: 'macOS (Liquid Glass) 風', tagline: 'バージョン 26 の頃 ／ 非公式シミュレータ', wallpapers: [['lagoon', 'ラグーン'], ['ember', '残り火'], ['plain', '単色']], about: ['macOS 風デスクトップ (Liquid Glass)', 'バージョン 26.0 相当の見た目を目指した再現'], settingsName: 'システム設定',
    info: { product: 'macOS', version: '26.0', build: '25A354', kernel: '25.0.0', arch: 'arm64', kernelVer: 'Darwin Kernel Version 25.0.0: Mon Aug 25 21:17:54 PDT 2025; root:xnu-12377.1.9~141/RELEASE_ARM64_T8132', model: 'iMac (24-inch)', chip: 'Apple シリコン (という設定)' } },
};

function config(id) {
  const E = ERAS[id], classic = E.era === 'classic' || E.era === 'platinum', zsh = E.era === 'bigsur' || E.era === 'glass', H = classic ? '' : '/Users/user';
  return {
    id, kind: 'mac', classic, zsh, hideRoot: classic ? ['dev', 'etc', 'usr', 'var', 'tmp'] : ['bin', 'sbin', 'usr', 'private', 'dev', 'cores', 'opt', 'etc', 'var', 'tmp', 'Volumes'], iconTheme: classic ? 'macclassic' : 'mac', rootClass: `era-${E.era} ${classic ? 'mac-classic' : 'mac-osx ui-modern'}`, soundTheme: 'mac', user: 'user', host: E.host || 'Mac', ci: true, perms: !classic, fsVersion: 1, tabs: true, bigIcons: !classic || E.era === 'platinum',
    termClass: 'term-mac', termLight: true, termPalette: PAL, markIcon: 'pear', ...E,
    home: H || '/', docs: H + '/Documents', pics: H + '/' + (classic ? 'Documents/Pictures' : 'Pictures'), desktopDir: H + (classic ? '/Desktop Folder' : '/Desktop'), trashDir: classic ? '/Trash' : H + '/.Trash',
    info: { family: 'mac', ...(E.info || { product: 'Mac OS', version: E.era === 'classic' ? '7.5.5' : '9.2.2', build: '-', kernel: '0', arch: 'Power Macintosh' }) },
    seed: b => {
      if (classic) classicMacSeed(b); else macSeed(b, E.era === 'flat' ? 'yosemite' : E.era === 'glass' ? 'tahoe' : E.era);
      for (const [name, c] of Object.entries(commands)) if (!c.pkg && !c.only?.includes('debian') && !c.only?.includes('arch') && !c.not?.includes('mac') && /^[\w.+-]+$/.test(name)) b.file('/usr/bin/' + name, '\x7fELF', { m: 0o755 });
    },
    L: { terminal: classic ? 'ターミナル (おまけ)' : 'ターミナル', editor: classic ? 'シンプルテキスト' : 'テキストエディット', browser: 'ブラウザ', files: 'Finder', viewer: classic ? 'ピクチャビューア' : 'プレビュー', calc: '計算機', mines: 'マインスイーパ', paint: 'お絵かき', settings: classic ? 'コントロールパネル' : E.settingsName, taskmgr: classic ? 'アプリケーション一覧' : 'アクティビティモニタ', about: classic ? 'このコンピュータについて' : 'この Mac について', computer: 'コンピュータ', docs: classic ? 'Documents' : '書類', trash: 'ゴミ箱', emptyTrash: 'ゴミ箱を空にする', rootName: 'Macintosh HD', openTerm: 'ターミナルで開く' },
  };
}

class Mac extends Machine {
  constructor(mount, onExit, id) {
    super(mount, config(id), onExit);
    Object.assign(this.fs.dyn, { null: () => '', random: () => Array.from({ length: 64 }, () => String.fromCharCode(33 + Math.floor(Math.random() * 90))).join('') });
  }
  pathLabel(p) { return this.classic ? 'Macintosh HD' + (p === '/' ? '' : p.replace(/\//g, ':')) : p; }
  parsePath(s) {
    s = s.trim();
    if (this.classic) return this.fs.abs('/' + s.replace(/^Macintosh HD:?/, '').replace(/:/g, '/'), '/');
    return this.fs.abs(s.replace(/^file:\/\//, '').replace(/^~(?=\/|$)/, this.home), this.home);
  }
  displayName(n) { return this.classic ? n : NAMES[n] || n.replace(/\.app$/, ''); }
  aboutLines() { return [...this.about, ...(this.classic ? [] : [`${this.info.model}　　${this.info.chip}`]), `仮想ディスクの使用量: ${this.usage()} (ブラウザの localStorage)`]; }
  shell(term, args) {
    const d = new Date(), env = { SHELL: this.zsh ? '/bin/zsh' : '/bin/bash', TERM_PROGRAM: 'Apple_Terminal', LANG: 'ja_JP.UTF-8', PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin', DISPLAY: null, XDG_CURRENT_DESKTOP: null, XDG_SESSION_TYPE: null, DESKTOP_SESSION: null, COLORTERM: null };
    const sh = new Bash({ term, fs: this.fs, os: this, user: this.user, host: this.host, home: this.home, flavor: { family: 'mac', homeBase: this.classic ? '' : '/Users', pkgFile: '/var/db/none', env, ...(this.zsh ? { shell: 'zsh', rc: '.zshrc', hist: '.zsh_history', ps1: '\\u@\\h \\W % ' } : { rc: '.bash_profile', ps1: '\\h:\\W \\u\\$ ' }) } });
    if (args.cwd && this.fs.isDir(args.cwd)) { sh.cwd = args.cwd; sh.set('PWD', args.cwd); }
    if (args.run) sh.autorun = args.run;
    term.write(`Last login: ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${String(d.getDate()).padStart(2)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} on ttys000\n`);
    return sh;
  }
  panic() { setTimeout(() => this.crash('panic', `panic(cpu 0 caller 0xffffff8000a1b2c3): "launchd died\\nState at last exception:\\n\\n"@/BuildRoot/Library/Caches/xnu/bsd/kern/kern_exit.c:361\nBacktrace (CPU 0), Frame : Return Address\n0xffffff80e1a3b930 : 0xffffff8000b4a2d0\n0xffffff80e1a3b980 : 0xffffff8000c8f1a5\n\nBSD process name corresponding to current thread: launchd\n\nrm -rf / を本当に実行してしまいましたね。(これはシミュレータなので、本物の Mac は無事です)\n\n何かキーを押すか、クリックすると、仮想ディスクを初期状態に戻して再起動します。`), 600); }
  apps() {
    const L = this.L, A = (app, icon, args) => ({ app, label: L[app], icon, run: () => this.launch(app, args) });
    return [A('files', 'finder', { path: this.classic ? '/' : this.home }), A('browser', 'browser'), A('terminal', 'terminal'), A('editor', 'editor'), A('calc', 'calc'), A('viewer', 'image'), A('paint', 'paint'), A('mines', 'mines'), A('taskmgr', 'taskmgr'), A('settings', 'settings')];
  }
  systemIcons() {
    const hd = { label: 'Macintosh HD', icon: 'drive', open: () => this.launch('files', { path: '/' }), props: () => this.launch('about') };
    const trash = { label: 'ゴミ箱', icon: () => (this.trashCount() ? 'trash-full' : 'trash'), trash: true, open: () => this.launch('files', { path: this.trashDir }) };
    return this.classic ? [hd, trash] : this.era === 'aqua' || this.era === 'flat' ? [hd] : [];
  }
  places() {
    const P = (label, icon, path) => ({ label, icon, path });
    if (this.classic) return [{ title: 'ディスク', items: [P('Macintosh HD', 'drive', '/'), P('Documents', 'folder', '/Documents'), P('Applications', 'folder', '/Applications'), P('System Folder', 'folder', '/System Folder'), P('ゴミ箱', 'trash', this.trashDir)] }];
    return [{ title: 'よく使う項目', items: [P('アプリケーション', 'folder', '/Applications'), P('デスクトップ', 'desktop', this.desktopDir), P('書類', 'folder', this.docs), P('ダウンロード', 'folder', this.home + '/Downloads'), P('ピクチャ', 'folder', this.pics), P(this.user, 'home', this.home)] },
      { title: 'デバイス', items: [P('Macintosh HD', 'drive', '/'), P('ゴミ箱', 'trash', this.trashDir)] }];
  }

  // ---- boot / login
  async start({ fast = false } = {}) {
    if (!fast) {
      const el = this.classic
        ? h('div', { class: 'mc-boot' }, h('div', { class: 'mc-hello' }, this.icon('computer', 64), h('div', null, this.era === 'classic' ? 'ようこそ' : 'Mac OS 風 を起動中…'), h('div', { class: 'mc-bar' }, h('i'))), h('small', null, '非公式の再現シミュレータです ／ クリックでスキップ'))
        : h('div', { class: 'mx-boot' }, h('div', { class: 'mx-mark' }, this.icon('pear', 110)), this.era === 'aqua' ? h('div', { class: 'mx-gear' }) : h('div', { class: 'mx-bar' }, h('i')), h('small', null, '非公式の再現シミュレータです ／ クリックでスキップ'));
      this.root.replaceChildren(el);
      await Promise.race([sleep(3000), new Promise(r => el.addEventListener('pointerdown', r, { once: true }))]);
      el.classList.add('fade'); await sleep(340);
    }
    await this.login();
  }
  enter() {
    sound.unlock();
    this.buildDesktop();
    this.root.classList.add('fade-in'); setTimeout(() => this.root.classList.remove('fade-in'), 600);
    this.sound('startup');
    if (!this.store.get('welcomed')) { this.store.set('welcomed', true); setTimeout(() => this.notify('ようこそ', `${this.classic ? 'Macintosh HD の Documents にある「Read Me」' : 'デスクトップの「はじめに.txt」'}に使い方があります。ファイルはこのブラウザの localStorage に保存されます。`, 12000), 1600); }
    if (!store.persistent) setTimeout(() => this.notify('保存できません', 'このブラウザでは localStorage が無効のため、変更は保存されません。'), 3000);
  }
  login() {
    if (this.classic) { this.enter(); return Promise.resolve(); }
    return new Promise(resolve => {
      const go = async () => { el.classList.add('fade'); await sleep(340); this.enter(); resolve(); };
      const pw = h('input', { class: 'mx-pass', type: 'password', placeholder: 'パスワードを入力 (何でも可)', autocomplete: 'off' });
      const el = h('div', { class: `mx-login wp-${this.id} wp-${this.settings.wallpaper}` }, h('div', { class: 'mx-card' }, this.era === 'aqua' ? h('div', { class: 'mx-title' }, this.icon('pear', 40), h('b', null, 'Mac OS X 風')) : null, h('div', { class: 'mx-avatar' }, this.icon('user', 96)), h('div', { class: 'mx-user' }, this.user), pw, this.era === 'aqua' ? h('div', { class: 'mx-row' }, button('ログイン', go, 'default')) : h('small', null, 'Return キーでログイン')),
        h('div', { class: 'mx-foot' }, h('button', { type: 'button', onClick: () => this.onExit('poweroff') }, this.icon('power', 22), 'システム終了'), h('button', { type: 'button', onClick: () => this.onExit('reboot') }, this.icon('restart', 22), '再起動')));
      this.root.replaceChildren(el);
      pw.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
      setTimeout(() => pw.focus(), 100);
    });
  }
  logoutScreen() { return this.login(); }
  async shutdownScreen() { this.root.append(h('div', { class: (this.classic ? 'mc-boot' : 'mx-boot') + ' bye' }, this.classic ? h('div', { class: 'mc-hello' }, this.icon('computer', 64), h('div', null, 'システムを終了しています…')) : h('div', { class: 'mx-gear' }))); await sleep(1600); }

  // ---- menu bar and Dock
  buildPanel() {
    this.mleft = h('div', { class: 'mb-left' });
    this.clock = h('button', { class: 'mb-item mb-clock', type: 'button' });
    this.snd = h('button', { class: 'mb-item', type: 'button', onClick: () => { sound.enabled = !sound.enabled; this.refreshTray(); if (sound.enabled) this.sound('ding'); } });
    const st = (ic, title, fn) => h('button', { class: 'mb-item', type: 'button', title, onPointerdown: e => e.stopPropagation(), onClick: fn }, this.icon(ic, 16));
    const modern = this.era === 'bigsur' || this.era === 'glass';
    this.mbar = h('div', { class: 'mbar' }, this.mleft, h('div', { class: 'mb-right' },
      this.classic ? null : st('wifi', 'Wi-Fi: 接続済み', () => this.notify('Wi-Fi', navigator.onLine ? '接続済み (あなたのブラウザの回線を使用しています)' : 'オフラインです')), this.snd,
      modern ? st('toggles', 'コントロールセンター', e => this.controlCenter(e)) : null, this.classic ? null : st('search', 'Spotlight', () => this.spotlight()), this.clock,
      this.classic ? h('button', { class: 'mb-item mb-app', type: 'button', onPointerdown: e => { e.stopPropagation(); this.appMenu(e); } }, this.icon('finder', 16)) : null));
    this.root.prepend(this.mbar);
    if (!this.classic) {
      this.dock = h('div', { class: 'dock' });
      this.dockZone = h('div', { class: 'dock-zone' }, this.dock);
      this.desk.append(this.dockZone);
      this.dock.addEventListener('pointermove', e => { for (const el of this.dock.querySelectorAll('.dock-item')) { const r = el.getBoundingClientRect(), d = Math.abs(e.clientX - (r.left + r.width / 2)); el.style.setProperty('--s', (1 + 0.55 * Math.max(0, 1 - d / 130)).toFixed(3)); } });
      this.dock.addEventListener('pointerleave', () => { for (const el of this.dock.querySelectorAll('.dock-item')) el.style.setProperty('--s', 1); });
    }
    this.wm.on('change', () => { this.renderMenus(); this.renderDock(); });
    this.wm.taskTarget = w => (this.dock?.querySelector(`[data-pid="${w.pid}"]`) || this.dock?.querySelector(`[data-app="${w.app}"]`) || this.clock).getBoundingClientRect();
    this.refreshTray(); this.tick(); this.renderMenus(); this.renderDock();
  }
  refreshTray() { this.snd.replaceChildren(this.icon(sound.enabled ? 'sound' : 'mute', 16)); this.snd.title = sound.enabled ? '音量' : '消音中'; }
  tick() { const d = new Date(); this.clock.textContent = this.classic ? `${d.getHours()}:${pad2(d.getMinutes())}` : `${d.getMonth() + 1}月${d.getDate()}日(${'日月火水木金土'[d.getDay()]}) ${d.getHours()}:${pad2(d.getMinutes())}`; }
  renderMenus() {
    const act = this.wm.active, L = this.L, appName = act && !act.dialog ? L[act.app] || act.title : 'Finder';
    const run = (app, args) => () => this.launch(app, args), exec = c => () => document.execCommand(c);
    const windows = () => { const ws = this.wm.windows.filter(w => !w.dialog); return ws.length ? ws.map(w => ({ label: w.title, checked: w === this.wm.active, onClick: () => w.restore() })) : [{ label: '(開いているウインドウはありません)', disabled: true }]; };
    const edit = { label: '編集', items: [{ label: '取り消す', hint: '⌘Z', onClick: exec('undo') }, '-', { label: 'カット', hint: '⌘X', onClick: exec('cut') }, { label: 'コピー', hint: '⌘C', onClick: exec('copy') }, { label: 'すべてを選択', hint: '⌘A', onClick: exec('selectAll') }] };
    const mark = { label: h('span', { class: 'mb-mark' }, this.icon('pear', 16)), items: this.classic
      ? [{ label: L.about + '...', onClick: run('about') }, '-', ...this.apps().filter(a => a.app !== 'files').map(a => ({ label: a.label, icon: a.icon, onClick: a.run }))]
      : [{ label: L.about, onClick: run('about') }, '-', { label: L.settings + '...', onClick: run('settings') }, { label: 'Dock', sub: [{ label: '拡大', checked: true, disabled: true }] }, '-', { label: '強制終了...', hint: '⌥⌘⎋', onClick: run('taskmgr') }, '-', { label: 'スリープ', onClick: () => setTimeout(() => this.startSaver(true), 250) }, { label: '再起動...', onClick: () => this.offBox('reboot') }, { label: 'システム終了...', onClick: () => this.offBox('poweroff') }, '-', { label: `${this.user} をログアウト...`, hint: '⇧⌘Q', onClick: () => this.power('logout') }] };
    const defs = this.classic ? [mark,
      { label: 'ファイル', items: [{ label: '新規フォルダ', onClick: () => { try { this.fs.mkdir(this.desktopDir + '/名称未設定フォルダ'); } catch { /* exists */ } } }, { label: '開く', onClick: run('files', { path: '/' }) }, '-', { label: '閉じる', disabled: !act, onClick: () => act && act.close() }] }, edit,
      { label: '表示', items: [{ label: 'アイコン', checked: true, disabled: true }, { label: 'デスクトップの背景...', onClick: run('settings', { page: 'desktop' }) }] },
      { label: '特別', items: [{ label: 'ゴミ箱を空に...', disabled: !this.trashCount(), onClick: () => this.emptyTrash() }, '-', { label: 'スクリーンセーバー', onClick: () => setTimeout(() => this.startSaver(true), 250) }, { label: '再起動', onClick: () => this.offBox('reboot') }, { label: 'システム終了', onClick: () => this.offBox('poweroff') }] },
      { label: 'ヘルプ', items: [{ label: 'Read Me を開く', onClick: () => this.openPath('/Documents/Read Me') }] }]
      : [mark,
        { label: h('b', null, appName), items: [{ label: `${appName} について`, onClick: run('about') }, '-', ...(appName === 'Finder' ? [{ label: 'ゴミ箱を空にする...', disabled: !this.trashCount(), onClick: () => this.emptyTrash() }] : [{ label: `${appName} を隠す`, hint: '⌘H', onClick: () => act && act.minimize() }, { label: `${appName} を終了`, hint: '⌘Q', onClick: () => { for (const w of this.wm.byApp(act.app)) w.close(); } }])] },
        { label: 'ファイル', items: [{ label: '新規 Finder ウインドウ', hint: '⌘N', onClick: run('files', { path: this.home }) }, { label: '新規ターミナル', onClick: run('terminal') }, '-', { label: 'ウインドウを閉じる', hint: '⌘W', disabled: !act, onClick: () => act && act.close() }] }, edit,
        { label: '表示', items: [{ label: 'デスクトップの背景を変更...', onClick: run('settings', { page: 'desktop' }) }, { label: 'フルスクリーンにする', disabled: !act || !act.resizable, onClick: () => act && act.toggleMax() }] },
        { label: 'ウインドウ', items: () => [{ label: 'しまう', hint: '⌘M', disabled: !act, onClick: () => act && act.minimize() }, { label: '拡大／縮小', disabled: !act || !act.resizable, onClick: () => act && act.toggleMax() }, '-', ...windows()] },
        { label: 'ヘルプ', items: [{ label: 'はじめに.txt を開く', onClick: () => this.openPath(this.desktopDir + '/はじめに.txt') }] }];
    this.mleft.replaceChildren(menuBar(this, defs));
  }
  appMenu(e) {
    const r = e.currentTarget.getBoundingClientRect(), rr = this.root.getBoundingClientRect(), ws = this.wm.windows.filter(w => !w.dialog);
    popupMenu(this, [{ label: 'Finder', icon: 'finder', checked: !this.wm.active, onClick: () => this.wm.blurAll() }, ...(ws.length ? ['-'] : []), ...ws.map(w => ({ label: w.title, icon: w.iconName, onClick: () => w.restore() }))], r.right - rr.left - 200, r.bottom - rr.top);
  }
  renderDock() {
    if (!this.dock) return;
    const apps = this.apps().filter(a => !['taskmgr', 'mines', 'viewer'].includes(a.app)), modern = this.era !== 'aqua';
    const item = (o, cls = '') => {
      const el = h('button', { class: 'dock-item ' + cls, type: 'button', dataset: { ...(o.app ? { app: o.app } : {}), ...(o.pid ? { pid: o.pid } : {}), label: o.label }, style: { '--s': 1 } }, h('span', { class: 'dock-ico' }, this.icon(o.icon, 44)), o.running ? h('i', { class: 'dock-dot' }) : null);
      el.addEventListener('click', () => { el.classList.add('bounce'); setTimeout(() => el.classList.remove('bounce'), 700); o.run(); });
      return el;
    };
    const kids = [];
    for (const a of apps) {
      const ws = this.wm.byApp(a.app).sort((x, y) => y.el.style.zIndex - x.el.style.zIndex);
      kids.push(item({ ...a, running: ws.length > 0 || a.app === 'files', run: () => (ws.length ? ws[0].restore() : a.run()) }));
      if (a.app === 'files' && modern) kids.push(item({ label: 'Launchpad', icon: 'launch', run: () => this.launchpad() }));
    }
    for (const a of this.apps().filter(x => ['taskmgr', 'mines', 'viewer'].includes(x.app))) { const ws = this.wm.byApp(a.app); if (ws.length) kids.push(item({ ...a, running: true, run: () => ws[0].restore() })); }
    kids.push(h('span', { class: 'dock-sep' }));
    for (const w of this.wm.windows.filter(x => x.minimized && !x.dialog)) kids.push(item({ label: w.title, icon: w.iconName, pid: w.pid, run: () => w.restore() }, 'mini'));
    kids.push(item({ label: 'ゴミ箱', icon: this.trashCount() ? 'trash-full' : 'trash', run: () => this.launch('files', { path: this.trashDir }) }));
    this.dock.replaceChildren(...kids);
  }
  closePopups() { for (const k of ['overlay']) if (this[k]) { this[k].remove(); this[k] = null; } }
  showOverlay(el, cls) {
    this.closePopups(); closeMenus();
    this.overlay = h('div', { class: 'mx-overlay ' + cls }, el);
    this.overlay.addEventListener('pointerdown', e => { if (e.target === this.overlay) this.closePopups(); });
    this.overlay.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); this.closePopups(); } });
    this.root.append(this.overlay);
  }
  launchpad() {
    const grid = h('div', { class: 'lp-grid' }), apps = this.apps();
    const render = q => grid.replaceChildren(...apps.filter(a => !q || a.label.toLowerCase().includes(q) || a.app.includes(q)).map(a => h('button', { class: 'lp-app', type: 'button', onClick: () => { this.closePopups(); a.run(); } }, this.icon(a.icon, 72), h('span', null, a.label))));
    const s = h('input', { class: 'lp-search', type: 'text', placeholder: '検索', spellcheck: 'false' });
    s.addEventListener('input', () => render(s.value.trim().toLowerCase()));
    s.addEventListener('keydown', e => { if (e.key === 'Enter') grid.querySelector('button')?.click(); });
    render('');
    this.showOverlay(h('div', { class: 'lp' }, s, grid), 'lp-wrap');
    setTimeout(() => s.focus(), 60);
  }
  spotlight() {
    const list = h('div', { class: 'sp-list' }), s = h('input', { class: 'sp-input', type: 'text', placeholder: 'Spotlight 検索', spellcheck: 'false' });
    const render = () => {
      const q = s.value.trim().toLowerCase(), out = [];
      if (q) {
        for (const a of this.apps()) if (a.label.toLowerCase().includes(q) || a.app.includes(q)) out.push({ label: a.label, sub: 'アプリケーション', icon: a.icon, run: a.run });
        for (const dir of [this.desktopDir, this.docs, this.pics]) { try { for (const n of this.fs.readdir(dir)) if (n.toLowerCase().includes(q)) out.push({ label: n, sub: this.pathLabel(dir), icon: 'text', run: () => this.openPath(dir + '/' + n) }); } catch { /* folder removed */ } }
      }
      list.replaceChildren(...out.slice(0, 8).map(o => h('button', { class: 'sp-item', type: 'button', onClick: () => { this.closePopups(); o.run(); } }, this.icon(o.icon, 28), h('span', null, h('b', null, o.label), h('small', null, o.sub)))));
    };
    s.addEventListener('input', render);
    s.addEventListener('keydown', e => { if (e.key === 'Enter') list.querySelector('button')?.click(); });
    this.showOverlay(h('div', { class: 'sp' }, h('div', { class: 'sp-top' }, this.icon('search', 22), s), list), 'sp-wrap');
    setTimeout(() => s.focus(), 60);
  }
  controlCenter() {
    const T = (label, on, fn) => { const b = h('button', { class: 'cc-tile' + (on ? ' on' : ''), type: 'button' }, label); b.addEventListener('click', () => { fn(); this.closePopups(); }); return b; };
    this.showOverlay(h('div', { class: 'cc' }, h('div', { class: 'cc-grid' }, T('Wi-Fi', navigator.onLine, () => { }), T('サウンド', sound.enabled, () => { sound.enabled = !sound.enabled; this.refreshTray(); }), T('アニメーション', this.settings.animate, () => this.set('animate', !this.settings.animate)), T('スクリーンセーバー', false, () => setTimeout(() => this.startSaver(true), 250))),
      h('div', { class: 'cc-row' }, button('デスクトップの背景...', () => { this.closePopups(); this.launch('settings', { page: 'desktop' }); }), button('ストレージ...', () => { this.closePopups(); this.launch('settings', { page: 'storage' }); }))), 'cc-wrap');
  }
  offBox(kind) {
    const close = () => this.closePopups();
    const text = kind === 'reboot' ? 'コンピュータを今すぐ再起動してもよろしいですか?' : 'コンピュータを今すぐシステム終了してもよろしいですか?';
    this.showOverlay(h('div', { class: 'mac-off' }, h('div', { class: 'mo-ico' }, this.icon(kind === 'reboot' ? 'restart' : 'power', 54)), h('div', { class: 'mo-text' }, h('b', null, text), h('p', null, '開いているウインドウはすべて閉じられます。')),
      h('div', { class: 'mo-btns' }, kind === 'reboot' ? null : button('再起動', () => { close(); this.power('reboot'); }), button('スリープ', () => { close(); setTimeout(() => this.startSaver(true), 250); }), button('キャンセル', close), button(kind === 'reboot' ? '再起動' : 'システム終了', () => { close(); this.power(kind); }, 'default'))), 'off-wrap');
    this.overlay.querySelector('.default').focus();
  }
  onKey(e) {
    if (e.key === 'F4' && !this.classic) { e.preventDefault(); this.launchpad(); }
    else if (e.ctrlKey && e.key === ' ' && !this.classic) { e.preventDefault(); this.spotlight(); }
    else if (e.altKey && e.key === 'F4' && this.wm.active) { e.preventDefault(); this.wm.active.close(); }
  }
}

const era = id => class extends Mac { constructor(mount, onExit) { super(mount, onExit, id); } };
export const Mac7 = era('mac7'), Mac9 = era('mac9'), Aqua = era('aqua'), Yosemite = era('yosemite'), BigSur = era('bigsur'), Tahoe = era('tahoe');
