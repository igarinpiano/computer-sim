// Linux Mint (Cinnamon) style machine: splash, login greeter, bottom panel, application
// menu, four workspaces on a rotating cube, and the bash shell.

import { h, sleep, pad2 } from '../core/util.js';
import { sound } from '../core/sound.js';
import { store } from '../core/storage.js';
import { popupMenu, closeMenus, button } from '../core/ui.js';
import { Machine } from './machine.js';
import { mintSeed } from './seeds.js';
import { Bash } from '../term/bash.js';
import { commands } from '../term/coreutils.js';
import '../term/sysutils.js';
import '../term/tui.js';
import '../term/awk.js';

const HOME = '/home/user';
const APPLIST = [
  ['browser', 'Web ブラウザ', 'browser', 'インターネット', 'Web を閲覧します'], ['terminal', '端末', 'terminal', 'システムツール', 'コマンドラインを使用します'], ['files', 'ファイル', 'folder', 'アクセサリ', 'ファイルシステムにアクセスします'],
  ['editor', 'テキストエディター', 'editor', 'アクセサリ', 'テキストファイルを編集します'], ['calc', '電卓', 'calc', 'アクセサリ', '算術計算を行います'], ['viewer', '画像ビューアー', 'image', 'グラフィックス', '画像を表示します'],
  ['paint', 'お絵かき', 'paint', 'グラフィックス', '絵を描きます'], ['mines', 'マイン', 'mines', 'ゲーム', '地雷原から地雷を取り除きます'], ['taskmgr', 'システムモニター', 'taskmgr', 'システムツール', 'プロセスとリソースを監視します'],
  ['settings', 'システム設定', 'settings', '設定', 'デスクトップと保存データを設定します'], ['about', 'システム情報', 'info', '設定', 'このシステムについて'],
];
const CFG = {
  id: 'mint', name: 'Linux Mint 風', tagline: 'Cinnamon 風デスクトップ ／ 非公式シミュレータ', user: 'user', home: HOME, ci: false, perms: true, fsVersion: 1, workspaces: 4,
  docs: HOME + '/Documents', pics: HOME + '/Pictures', desktopDir: HOME + '/Desktop', trashDir: HOME + '/.local/share/Trash/files', markIcon: 'leaf',
  wallpapers: [['leaf', 'ミント'], ['aurora', 'オーロラ'], ['night', '夜空'], ['plain', '単色']],
  termPalette: ['#2e3436', '#cc0000', '#4e9a06', '#c4a000', '#3465a4', '#75507b', '#06989a', '#d3d7cf', '#555753', '#ef2929', '#8ae234', '#fce94f', '#729fcf', '#ad7fa8', '#34e2e2', '#eeeeec'],
  L: { terminal: '端末', editor: 'テキストエディター', browser: 'Web ブラウザ', files: 'ファイル', viewer: '画像ビューアー', calc: '電卓', mines: 'マイン', paint: 'お絵かき', settings: 'システム設定', taskmgr: 'システムモニター', about: 'システム情報', computer: 'コンピューター', docs: 'ドキュメント', trash: 'ゴミ箱', emptyTrash: 'ゴミ箱を空にする' },
  seed: b => {
    mintSeed(b);
    for (const [name, c] of Object.entries(commands)) if (!c.pkg && /^[\w.+-]+$/.test(name)) b.file((c.sbin ? '/usr/sbin/' : '/usr/bin/') + name, '\x7fELF', { m: 0o755 });
    for (const name of ['bash', 'sh', 'dash', 'sudo', 'su', 'echo', 'printf', 'test', 'kill', 'pwd', 'time']) b.file('/usr/bin/' + name, '\x7fELF', { m: name === 'sudo' || name === 'su' ? 0o4755 : 0o755 });
  },
};

export class Mint extends Machine {
  constructor(mount, onExit) {
    super(mount, CFG, onExit);
    const ram = ((navigator.deviceMemory || 8) * 1048576);
    Object.assign(this.fs.dyn, {
      null: () => '', random: () => Array.from({ length: 64 }, () => String.fromCharCode(33 + Math.floor(Math.random() * 90))).join(''),
      cpuinfo: () => Array.from({ length: navigator.hardwareConcurrency || 4 }, (_, i) => `processor\t: ${i}\nvendor_id\t: GenuineBrowser\nmodel name\t: JavaScript Virtual CPU @ 3.00GHz\ncpu MHz\t\t: 3000.000\ncache size\t: 12288 KB\ncpu cores\t: ${navigator.hardwareConcurrency || 4}\nflags\t\t: fpu vme de pse tsc msr pae mce cx8 apic sep mtrr pge mca cmov pat sse sse2 ht syscall nx lm\nbogomips\t: 6000.00\n`).join('\n') + '\n',
      meminfo: () => `MemTotal:       ${String(ram).padStart(8)} kB\nMemFree:        ${String(Math.round(ram * 0.22)).padStart(8)} kB\nMemAvailable:   ${String(Math.round(ram * 0.65)).padStart(8)} kB\nBuffers:        ${String(Math.round(ram * 0.04)).padStart(8)} kB\nCached:         ${String(Math.round(ram * 0.4)).padStart(8)} kB\nSwapTotal:       2097148 kB\nSwapFree:        2097148 kB\n`,
      uptime: () => `${((Date.now() - this.bootTime) / 1000).toFixed(2)} ${((Date.now() - this.bootTime) / 1000 * 3.9).toFixed(2)}\n`,
      loadavg: () => `0.31 0.42 0.35 1/${420 + Math.floor(Math.random() * 20)} ${3000 + Math.floor(Math.random() * 900)}\n`,
    });
    this.info = { name: 'Linux Mint', version: '21.3', codename: 'Virginia', kernel: '5.15.0-91-generic', de: 'Cinnamon 6.0.4' };
  }
  pathLabel(p) { return p; }
  parsePath(s) { s = s.trim().replace(/^file:\/\//, ''); return this.fs.abs(s.replace(/^~(?=\/|$)/, this.home), this.home); }
  displayName(n) { return n.replace(/\.desktop$/, ''); }
  aboutLines() { return ['Linux Mint 21.3 "Virginia" 風デスクトップ (Cinnamon 6.0 風)', 'カーネル: Linux 5.15.0-91-generic x86_64 (という設定の JavaScript)', `プロセッサ: JavaScript Virtual CPU × ${navigator.hardwareConcurrency || 4}　　ユーザー: ${this.user}@mint-pc`, `仮想ディスクの使用量: ${this.usage()} (ブラウザの localStorage)`]; }
  shell(term, args) {
    const sh = new Bash({ term, fs: this.fs, os: this, user: this.user, host: 'mint-pc', home: this.home });
    if (args.cwd && this.fs.isDir(args.cwd)) { sh.cwd = args.cwd; sh.set('PWD', args.cwd); }
    if (args.run) sh.autorun = args.run;
    return sh;
  }
  panic() {
    setTimeout(() => this.crash('panic', `[ ${((Date.now() - this.bootTime) / 1000).toFixed(6)}] systemd[1]: Failed to execute /bin/sh, giving up: No such file or directory
[ ${((Date.now() - this.bootTime) / 1000 + 0.004).toFixed(6)}] Kernel panic - not syncing: Attempted to kill init! exitcode=0x00007f00
[ ${((Date.now() - this.bootTime) / 1000 + 0.004).toFixed(6)}] CPU: 0 PID: 1 Comm: systemd Not tainted 5.15.0-91-generic #101-Ubuntu
[ ${((Date.now() - this.bootTime) / 1000 + 0.005).toFixed(6)}] Hardware name: Browser Virtual Machine 1.0
[ ${((Date.now() - this.bootTime) / 1000 + 0.005).toFixed(6)}] Call Trace:
[ ${((Date.now() - this.bootTime) / 1000 + 0.005).toFixed(6)}]  <TASK>
[ ${((Date.now() - this.bootTime) / 1000 + 0.006).toFixed(6)}]  dump_stack_lvl+0x4a/0x63
[ ${((Date.now() - this.bootTime) / 1000 + 0.006).toFixed(6)}]  panic+0x10c/0x2f3
[ ${((Date.now() - this.bootTime) / 1000 + 0.006).toFixed(6)}]  do_exit.cold+0x15/0xa0
[ ${((Date.now() - this.bootTime) / 1000 + 0.007).toFixed(6)}]  </TASK>
[ ${((Date.now() - this.bootTime) / 1000 + 0.007).toFixed(6)}] ---[ end Kernel panic - not syncing: Attempted to kill init! exitcode=0x00007f00 ]---

rm -rf / を本当に実行してしまいましたね。(これはシミュレータなので、本物の PC は無事です)

何かキーを押すか、クリックすると、仮想ディスクを初期状態に戻して再起動します。`), 600);
  }
  systemIcons() {
    return [
      { label: 'コンピューター', icon: 'computer', open: () => this.launch('files', { path: 'computer:' }), props: () => this.launch('about') },
      { label: 'ホーム', icon: 'home', open: () => this.launch('files', { path: this.home }) },
      { label: 'ゴミ箱', icon: () => (this.trashCount() ? 'trash-full' : 'trash'), trash: true, open: () => this.launch('files', { path: this.trashDir }) },
    ];
  }
  places() {
    const P = (label, ic, path) => ({ label, icon: ic, path });
    return [{ title: 'マイ コンピューター', items: [P('ホーム', 'home', this.home), P('デスクトップ', 'desktop', this.desktopDir), P('Documents', 'folder', this.docs), P('Music', 'folder', HOME + '/Music'), P('Pictures', 'folder', this.pics), P('Videos', 'folder', HOME + '/Videos'), P('Downloads', 'folder', HOME + '/Downloads'), P('ゴミ箱', 'trash', this.trashDir)] },
      { title: 'デバイス', items: [P('ファイルシステム', 'drive', '/')] }];
  }

  // ---- boot / login
  async start({ fast = false } = {}) {
    if (!fast) {
      const el = h('div', { class: 'mint-boot' }, this.icon('leaf', 120), h('div', { class: 'mb-dots' }, h('i'), h('i'), h('i'), h('i'), h('i')), h('div', { class: 'mb-foot' }, '非公式の再現シミュレータです ／ クリックでスキップ'));
      this.root.replaceChildren(el);
      await Promise.race([sleep(3000), new Promise(r => el.addEventListener('pointerdown', r, { once: true }))]);
      el.classList.add('fade'); await sleep(350);
    }
    await this.greeter();
  }
  greeter() {
    return new Promise(resolve => {
      const pw = h('input', { class: 'ml-pass', type: 'password', placeholder: 'パスワード (何でも OK・空欄でも可)', autocomplete: 'off' });
      const clock = h('div', { class: 'ml-clock' });
      const upd = () => { const d = new Date(); clock.replaceChildren(h('b', null, `${pad2(d.getHours())}:${pad2(d.getMinutes())}`), h('span', null, `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${'日月火水木金土'[d.getDay()]}曜日`)); };
      upd(); const t = setInterval(upd, 10000);
      const login = async () => {
        clearInterval(t); sound.unlock();
        el.classList.add('fade'); await sleep(350);
        this.buildDesktop();
        this.root.classList.add('fade-in'); setTimeout(() => this.root.classList.remove('fade-in'), 600);
        this.sound('startup');
        if (!this.store.get('welcomed')) { this.store.set('welcomed', true); setTimeout(() => this.notify('ようこそ', 'デスクトップの「はじめに.txt」に使い方があります。ファイルはこのブラウザの localStorage に保存されます。', 12000), 1600); }
        if (!store.persistent) setTimeout(() => this.notify('保存できません', 'このブラウザでは localStorage が無効のため、変更は保存されません。'), 3000);
        resolve();
      };
      const el = h('div', { class: `mint-login wp-mint wp-${this.settings.wallpaper}` }, clock,
        h('div', { class: 'ml-card' }, h('div', { class: 'ml-avatar' }, this.icon('user', 72)), h('div', { class: 'ml-name' }, this.user), pw, h('div', { class: 'ml-row' }, button('ログイン', login, 'default'))),
        h('div', { class: 'ml-bar' }, h('span', null, 'mint-pc'), h('button', { class: 'ml-off', type: 'button', title: 'シャットダウン', onClick: () => { clearInterval(t); this.onExit('poweroff'); } }, this.icon('power', 20))));
      this.root.replaceChildren(el);
      pw.addEventListener('keydown', e => { if (e.key === 'Enter') login(); });
      setTimeout(() => pw.focus(), 100);
    });
  }
  logoutScreen() { return this.greeter(); }
  async shutdownScreen() {
    const el = h('div', { class: 'mint-boot bye' }, this.icon('leaf', 120), h('div', { class: 'mb-dots' }, h('i'), h('i'), h('i'), h('i'), h('i')));
    this.root.append(el);
    await sleep(1700);
  }

  // ---- panel
  buildPanel() {
    this.menuBtn = h('button', { class: 'p-menu', type: 'button', onPointerdown: e => { e.stopPropagation(); this.toggleMenu(); } }, this.icon('leaf', 22), h('span', null, 'メニュー'));
    const L = (app, ic, label) => h('button', { class: 'p-launch', type: 'button', title: label, onClick: () => this.launch(app) }, this.icon(ic, 22));
    this.tasks = h('div', { class: 'tasks' });
    this.wsBox = h('div', { class: 'p-ws', title: 'ワークスペース (Ctrl+Alt+←/→)' });
    this.clock = h('button', { class: 'p-clock', type: 'button', onPointerdown: e => { e.stopPropagation(); this.toggleCal(); } });
    this.snd = h('button', { class: 'p-tray', type: 'button', onClick: () => { sound.enabled = !sound.enabled; this.refreshTray(); if (sound.enabled) this.sound('ding'); } });
    this.panel = h('div', { class: 'panel' }, this.menuBtn, h('div', { class: 'p-sep' }), L('files', 'folder', 'ファイル'), L('browser', 'browser', 'Web ブラウザ'), L('terminal', 'terminal', '端末'), h('div', { class: 'p-sep' }), this.tasks,
      h('div', { class: 'p-right' }, this.wsBox, this.snd, h('button', { class: 'p-tray', type: 'button', title: 'ネットワーク: 有線接続 1', onClick: () => this.notify('ネットワーク', navigator.onLine ? '接続済み: 有線接続 1 (あなたのブラウザの回線を使用しています)' : 'オフラインです') }, this.icon('network', 18)), this.clock));
    this.root.append(this.panel);
    this.panel.addEventListener('contextmenu', e => { e.preventDefault(); const r = this.root.getBoundingClientRect(); popupMenu(this, [{ label: 'システムモニター', icon: 'taskmgr', onClick: () => this.launch('taskmgr') }, { label: 'システム設定', icon: 'settings', onClick: () => this.launch('settings') }], e.clientX - r.left, e.clientY - r.top - 70); });
    this.wm.on('change', () => this.renderTasks());
    this.wm.on('ws', () => { this.renderTasks(); this.renderWs(); });
    this.wm.taskTarget = w => this.tasks.querySelector(`[data-pid="${w.pid}"]`)?.getBoundingClientRect();
    this.refreshTray(); this.tick(); this.renderTasks(); this.renderWs();
  }
  refreshTray() { this.snd.replaceChildren(this.icon(sound.enabled ? 'sound' : 'mute', 18)); this.snd.title = sound.enabled ? '音量: 100%' : 'ミュート'; }
  tick() { const d = new Date(); this.clock.textContent = `${d.getMonth() + 1}月${d.getDate()}日(${'日月火水木金土'[d.getDay()]}) ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
  renderWs() { this.wsBox.replaceChildren(...this.wm.layers.map((_, i) => h('button', { class: 'p-ws-item' + (i === this.wm.ws ? ' cur' : ''), type: 'button', title: `ワークスペース ${i + 1}`, onClick: () => this.wm.switchWs(i) }, String(i + 1)))); }
  renderTasks() {
    const wins = this.wm.windows.filter(w => !w.dialog && w.ws === this.wm.ws);
    this.tasks.replaceChildren(...wins.map(w => {
      const b = h('button', { class: 'task' + (this.wm.active === w && !w.minimized ? ' active' : ''), type: 'button', dataset: { pid: w.pid }, title: w.title }, this.icon(w.iconName, 20), h('span', null, w.title));
      b.addEventListener('click', () => { if (this.wm.active === w && !w.minimized) w.minimize(); else w.restore(); });
      b.addEventListener('contextmenu', e => {
        e.preventDefault(); e.stopPropagation();
        const r = this.root.getBoundingClientRect();
        popupMenu(this, [{ label: '別のワークスペースへ移動', sub: this.wm.layers.map((_, i) => ({ label: `ワークスペース ${i + 1}`, checked: i === w.ws, onClick: () => this.wm.moveToWs(w, i) })) }, '-', { label: w.minimized ? '元に戻す' : '最小化', onClick: () => (w.minimized ? w.restore() : w.minimize()) }, { label: w.maximized ? '元のサイズに戻す' : '最大化', disabled: !w.resizable, onClick: () => { w.restore(); w.toggleMax(); } }, '-', { label: '閉じる', onClick: () => w.close() }], e.clientX - r.left, e.clientY - r.top - 130);
      });
      return b;
    }));
  }
  closePopups() {
    for (const k of ['menuEl', 'calEl']) if (this[k]) { this[k].remove(); this[k] = null; }
    this.menuBtn?.classList.remove('open');
    document.removeEventListener('pointerdown', this._popOut, true);
  }
  _watchOutside(sel) { this._popOut = e => { if (!e.target.closest(sel) && !e.target.closest('.menu')) this.closePopups(); }; setTimeout(() => document.addEventListener('pointerdown', this._popOut, true), 0); }
  toggleCal() {
    if (this.calEl) return this.closePopups();
    this.closePopups(); closeMenus();
    const now = new Date(), y = now.getFullYear(), m = now.getMonth(), first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
    const cells = [...'日月火水木金土'].map(d => h('b', null, d));
    for (let i = 0; i < first; i++) cells.push(h('span'));
    for (let d = 1; d <= days; d++) cells.push(h('span', { class: d === now.getDate() ? 'today' : '' }, String(d)));
    this.calEl = h('div', { class: 'mint-cal' }, h('div', { class: 'mc-day' }, `${'日月火水木金土'[now.getDay()]}曜日`), h('div', { class: 'mc-date' }, `${y}年${m + 1}月${now.getDate()}日`), h('div', { class: 'mc-grid' }, cells));
    this.root.append(this.calEl);
    this._watchOutside('.mint-cal, .p-clock');
  }
  toggleMenu() {
    if (this.menuEl) return this.closePopups();
    this.closePopups(); closeMenus();
    const cats = ['すべてのアプリケーション', 'アクセサリ', 'インターネット', 'グラフィックス', 'ゲーム', 'システムツール', '設定'];
    let cat = cats[0], q = '';
    const list = h('div', { class: 'mm-apps' }), catEl = h('div', { class: 'mm-cats' }), search = h('input', { class: 'mm-search', type: 'text', placeholder: '検索するにはここに入力...', spellcheck: 'false' }), desc = h('div', { class: 'mm-desc' });
    const run = (app, args) => { this.closePopups(); this.launch(app, args); };
    const draw = () => {
      catEl.replaceChildren(...cats.map(c => { const b = h('button', { class: 'mm-cat' + (c === cat && !q ? ' cur' : ''), type: 'button' }, c); b.addEventListener('pointerenter', () => { if (cat !== c) { cat = c; q = ''; search.value = ''; draw(); } }); return b; }));
      const apps = APPLIST.filter(a => (q ? (a[1] + a[0] + a[4]).toLowerCase().includes(q.toLowerCase()) : cat === cats[0] || a[3] === cat));
      list.replaceChildren(...apps.map(a => { const b = h('button', { class: 'mm-app', type: 'button', onClick: () => run(a[0]) }, this.icon(a[2], 26), h('span', null, a[1])); b.addEventListener('pointerenter', () => { desc.replaceChildren(h('b', null, a[1]), h('span', null, a[4])); }); return b; }), apps.length ? null : h('div', { class: 'mm-none' }, '見つかりませんでした'));
    };
    const fav = (ic, label, fn) => h('button', { class: 'mm-fav', type: 'button', title: label, onClick: fn }, this.icon(ic, 30));
    this.menuEl = h('div', { class: 'mint-menu' },
      h('div', { class: 'mm-side' }, fav('browser', 'Web ブラウザ', () => run('browser')), fav('folder', 'ファイル', () => run('files')), fav('terminal', '端末', () => run('terminal')), fav('editor', 'テキストエディター', () => run('editor')), fav('settings', 'システム設定', () => run('settings')), h('div', { class: 'mm-grow' }),
        fav('saver', 'スクリーンセーバー', () => { this.closePopups(); setTimeout(() => this.startSaver(true), 300); }), fav('logout', 'ログアウト', () => { this.closePopups(); this.power('logout'); }), fav('power', '終了', () => { this.closePopups(); this.offBox(); })),
      h('div', { class: 'mm-main' }, h('div', { class: 'mm-top' }, search), h('div', { class: 'mm-cols' }, catEl, list), desc));
    this.root.append(this.menuEl);
    this.menuBtn.classList.add('open');
    search.addEventListener('input', () => { q = search.value.trim(); draw(); });
    search.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { const first = list.querySelector('.mm-app'); if (first) first.click(); } else if (e.key === 'Escape') this.closePopups(); });
    draw();
    setTimeout(() => search.focus(), 30);
    this._watchOutside('.mint-menu, .p-menu');
  }
  offBox() {
    if (this.root.querySelector('.mint-off')) return;
    const close = () => el.remove();
    const el = h('div', { class: 'mint-off' }, h('div', { class: 'mo-box' }, h('div', { class: 'mo-title' }, 'セッション'), h('p', null, 'このシステムを今すぐシャットダウンしますか?'),
      h('div', { class: 'mo-btns' }, button('サスペンド', () => { close(); setTimeout(() => this.startSaver(true), 200); }), button('再起動', () => { close(); this.power('reboot'); }), button('キャンセル', close), button('シャットダウン', () => { close(); this.power('poweroff'); }, 'danger'))));
    this.root.append(el);
    el.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
    el.querySelector('.danger').focus();
  }
  onKey(e) {
    if (e.ctrlKey && e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); e.stopPropagation(); this.wm.switchWs(this.wm.ws + (e.key === 'ArrowRight' ? 1 : -1)); }
    else if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 't') { e.preventDefault(); e.stopPropagation(); this.launch('terminal'); }
    else if (e.altKey && e.key === 'F4' && this.wm.active) { e.preventDefault(); this.wm.active.close(); }
    else if (e.altKey && e.key === 'F1') { e.preventDefault(); this.toggleMenu(); }
  }
}
