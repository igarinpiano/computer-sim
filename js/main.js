// Entry point: the 3D machine-select screen (three families, each a timeline of machines),
// and handing control to the chosen machine.

import { h, $, fmtBytes, sleep } from './core/util.js';
import { store } from './core/storage.js';
import { sound } from './core/sound.js';
import { startBackdrop } from './landing3d.js';

const win = n => () => import('./os/win.js').then(m => m[n]);
const mac = n => () => import('./os/mac.js').then(m => m[n]);
const lin = n => () => import('./os/linux.js').then(m => m[n]);
// mini: { bg, bar: [side, size, color, startColor], win: [title, body, radius], text, fg }
const FAMILIES = [
  { id: 'win', label: 'Windows 系', systems: [
    { id: 'dos', name: 'DOS 風', year: '1981–94', kind: 'old', accent: '#f0b040', load: () => import('./os/dos.js').then(m => m.Dos), mini: { bg: '#050505', fg: '#cfcfcf', text: 'Starting DOS...\n\nC:\\>dir /w\n[DOS]  [VIM]  [DOCS]\nREADME.TXT\n\nC:\\>' },
      lead: 'C:\\> だけの世界。ウィンドウもマウスもありません。', feats: ['COMMAND.COM 風のプロンプト', 'DIR / COPY CON / EDIT / バッチ ファイル', 'Vim も入っています', 'WIN と打つと…?'] },
    { id: 'win31', name: 'Windows 3.1 風', year: '1992', kind: 'crt', accent: '#7a8cff', load: win('Win31'), mini: { bg: '#b8b8b8', win: ['#000080', '#fff', 0] },
      lead: 'タスク バーが生まれる前。すべてはプログラム マネージャから。', feats: ['プログラム マネージャとグループ', '最小化するとデスクトップにアイコン', 'MS-DOS プロンプト / ファイル マネージャ', 'メモ帳・ペイントブラシ・マインスイーパ'] },
    { id: 'win98', name: 'Windows 98 風', year: '1998', kind: 'crt', accent: '#2aa5a5', load: win('Win98'), mini: { bg: '#008080', bar: ['bottom', 9, '#c0c0c0', '#a0a0a0'], win: ['#000080', '#c0c0c0', 0] },
      lead: 'グレーの立体ボタンと、カスケードする [スタート] メニュー。', feats: ['クラシックな [スタート] メニュー', 'MS-DOS プロンプト (COMMAND.COM 風)', '[Windows の終了] ダイアログ', 'MS-DOS モードで再起動 → DOS マシンへ'] },
    { id: 'xp', name: 'Windows XP 風', year: '2001', kind: 'crt', accent: '#3a8cff', load: () => import('./os/xp.js').then(m => m.XP), mini: { bg: 'radial-gradient(ellipse 90% 60% at 30% 108%, #57b24a 0 60%, transparent 61%), radial-gradient(ellipse 90% 50% at 85% 112%, #3f9a3c 0 60%, transparent 61%), linear-gradient(#2b6fd6, #a9d5ff 78%)', bar: ['bottom', 9, 'linear-gradient(#3a80e8, #1f55c8)', 'linear-gradient(#57b24a, #2f7d2f)'], win: ['linear-gradient(#2a6be6, #1f55c8)', '#ece9d8', 5] },
      lead: '青いタスクバーと緑の [スタート]。あの頃のデスクトップ。', feats: ['コマンド プロンプト (cmd.exe 互換・バッチ・Vim)', 'エクスプローラ / メモ帳 / ペイント / 電卓', 'Web ブラウザ (あなたのブラウザのエンジンで表示)', '3D パイプのスクリーン セーバー'] },
    { id: 'win7', name: 'Windows 7 風', year: '2009', kind: 'lcd', accent: '#59b5ff', load: win('Win7'), mini: { bg: 'radial-gradient(ellipse 50% 60% at 50% 46%, rgba(255,255,255,.55), transparent 70%), linear-gradient(#1f6fd0, #58b0f0 55%, #2b86de)', bar: ['bottom', 11, 'rgba(20,40,75,.8)', 'radial-gradient(circle, #9fe0ff, #0b3f8a)'], win: ['rgba(170,205,240,.75)', '#f0f0f0', 6] },
      lead: 'ガラスのように透けるウィンドウ。Aero の時代。', feats: ['半透明の Aero グラス ウィンドウ', 'アイコンだけのタスク バー', '検索できるスタート メニュー', 'cmd.exe (whoami などが増えました)'] },
    { id: 'win8', name: 'Windows 8 風', year: '2012', kind: 'lcd', accent: '#b07cff', load: win('Win8'), mini: { bg: 'linear-gradient(120deg, #1b0f4a, #3d1f86)', tiles: ['#0a74d0', '#d9a21b', '#0f8f8f', '#c2410c', '#4d7c0f', '#b4256a'] },
      lead: 'スタート画面いっぱいのタイル。賛否両論のあの UI。', feats: ['全画面のスタート画面とタイル', 'フラットで太い枠のウィンドウ', 'ロック画面 → サインイン', 'デスクトップ タイルで従来の画面へ'] },
    { id: 'win10', name: 'Windows 10 風', year: '2015', kind: 'slim', accent: '#3aa0ff', load: win('Win10'), mini: { bg: 'radial-gradient(circle at 78% 46%, rgba(150,220,255,.9) 0, rgba(40,120,230,.45) 14%, transparent 40%), linear-gradient(90deg, #020b24, #0b3f95)', bar: ['bottom', 10, '#101010', '#101010'], win: ['#fff', '#fff', 0] },
      lead: 'スタート メニューが帰ってきた。タイルも一緒に。', feats: ['アプリ一覧 + タイルのスタート メニュー', 'タスク バーの検索ボックス', 'トースト通知', 'ロック画面 → サインイン'] },
    { id: 'win11', name: 'Windows 11 風', year: '2021', kind: 'slim', accent: '#6cb6ff', load: win('Win11'), mini: { bg: 'radial-gradient(ellipse 34% 46% at 50% 62%, #cfe9ff 0, rgba(120,180,255,.85) 30%, transparent 62%), radial-gradient(ellipse 30% 50% at 36% 66%, rgba(60,120,255,.9), transparent 60%), radial-gradient(ellipse 30% 50% at 64% 66%, rgba(40,150,255,.9), transparent 60%), linear-gradient(#dcefff, #6ea6ee)', bar: ['bottom', 11, 'rgba(243,243,243,.9)', null, true], win: ['#f3f3f3', '#fff', 8] },
      lead: '角が丸くなり、スタートは真ん中へ。', feats: ['中央揃えのタスク バー', 'ピン留めグリッドのスタート メニュー', '角丸ウィンドウと半透明パネル', 'ロック画面 → サインイン'] },
  ] },
  { id: 'apple', label: 'Apple 系', systems: [
    { id: 'apple2', name: 'Apple II 風', year: '1977', kind: 'old', accent: '#4ade80', load: mac('Apple2'), mini: { bg: '#020a02', fg: '#4ade80', text: '                WEB ][\n\n]10 PRINT "HELLO"\n]20 GOTO 10\n]RUN\nHELLO\nHELLO\n]' },
      lead: '電源を入れると BASIC。プログラムは行番号から。', feats: ['行番号つきの BASIC インタプリタ', 'PRINT / INPUT / IF / FOR / GOSUB / DATA', 'CATALOG / LOAD / SAVE で仮想ディスクへ', '数当てゲームなどのサンプル入り'] },
    { id: 'mac7', name: 'クラシック Mac 風', year: '1991', kind: 'compact', accent: '#c8c8d8', load: mac('Mac7'), mini: { bg: 'repeating-conic-gradient(#888 0 25%, #aaa 0 50%) 0 0 / 4px 4px', bar: ['top', 9, '#fff', null], win: ['repeating-linear-gradient(#fff 0 1px, #000 1px 2px)', '#fff', 0] },
      lead: '白黒のメニュー バーとゴミ箱。System 7 の頃。', feats: ['メニュー バーとデスクトップのゴミ箱', '縞模様のタイトル バー', 'ノートパッド / 計算機 / お絵かき', 'おまけのターミナルで Vim も'] },
    { id: 'mac9', name: 'Mac OS 9 風', year: '1999', kind: 'crt', accent: '#b0b6ff', load: mac('Mac9'), mini: { bg: 'linear-gradient(135deg, #5a6fb5, #8e7fc0)', bar: ['top', 9, '#dedede', null], win: ['linear-gradient(#eee, #ccc)', '#fff', 2] },
      lead: 'プラチナ アピアランス。クラシック Mac OS の完成形。', feats: ['グレーの立体的なプラチナ テーマ', 'アプリケーション メニュー', 'コントロール パネル', 'おまけのターミナルで Vim も'] },
    { id: 'aqua', name: 'Mac OS X (Aqua) 風', year: '2001', kind: 'imac', accent: '#5aa9ff', load: mac('Aqua'), mini: { bg: 'radial-gradient(ellipse 120% 60% at 20% 110%, rgba(255,255,255,.5), transparent 60%), linear-gradient(160deg, #2b6fd0, #7db9f5 60%, #3a82d8)', bar: ['top', 8, 'rgba(255,255,255,.9)', null], dock: 'rgba(255,255,255,.55)', win: ['repeating-linear-gradient(#f4f4f4 0 2px, #e6e6e6 2px 4px)', '#fff', 5], lights: true },
      lead: '水滴のようなボタンとピンストライプ。なめたくなる UI。', feats: ['ジェル状の信号機ボタンとピンストライプ', '拡大する Dock', 'bash のターミナル (Darwin / PowerPC)', 'シートのようなダイアログ'] },
    { id: 'yosemite', name: 'OS X (フラット) 風', year: '2014', kind: 'alu', accent: '#ffb347', load: mac('Yosemite'), mini: { bg: 'radial-gradient(ellipse 120% 50% at 50% 115%, #3b2a1e 0 60%, transparent 61%), linear-gradient(#5b79b8, #f0a66b 70%, #f7d19a)', bar: ['top', 8, 'rgba(255,255,255,.7)', null], dock: 'rgba(255,255,255,.4)', win: ['#ececec', '#fff', 5], lights: true },
      lead: '立体感が消え、すりガラスの半透明に。', feats: ['フラットな信号機ボタンと半透明のメニュー バー', 'Launchpad と Spotlight', 'bash 3.2 のターミナル', 'すりガラスの Dock'] },
    { id: 'bigsur', name: 'macOS (Big Sur 世代) 風', year: '2020', kind: 'alu', accent: '#ff6aa0', load: mac('BigSur'), mini: { bg: 'radial-gradient(ellipse 70% 60% at 20% 30%, rgba(255,120,90,.9), transparent 65%), radial-gradient(ellipse 70% 60% at 80% 70%, rgba(80,120,255,.9), transparent 65%), linear-gradient(135deg, #ff5f7a, #6a5cff)', bar: ['top', 8, 'rgba(255,255,255,.35)', null], dock: 'rgba(255,255,255,.35)', dockFloat: true, win: ['#f6f6f6', '#fff', 9], lights: true },
      lead: '角丸の大きなウィンドウ、浮いた Dock、コントロール センター。', feats: ['角丸スクエアのアイコンと浮いた Dock', 'コントロール センター', 'zsh のターミナル', 'Launchpad と Spotlight'] },
    { id: 'tahoe', name: 'macOS (Liquid Glass) 風', year: '2025', kind: 'slim', accent: '#7fe3ff', load: mac('Tahoe'), mini: { bg: 'radial-gradient(ellipse 60% 70% at 25% 70%, rgba(80,220,255,.85), transparent 65%), radial-gradient(ellipse 60% 60% at 80% 25%, rgba(160,120,255,.85), transparent 65%), linear-gradient(135deg, #0a2a6a, #1a66c8)', bar: ['top', 8, 'rgba(255,255,255,.12)', null], dock: 'rgba(255,255,255,.22)', dockFloat: true, win: ['rgba(255,255,255,.55)', 'rgba(255,255,255,.9)', 12], lights: true },
      lead: '光を屈折させる、液体のようなガラス。', feats: ['背景が透けて歪むガラスのパネル', '透明なメニュー バーとガラスの Dock', 'zsh のターミナル', 'Launchpad と Spotlight'] },
  ] },
  { id: 'linux', label: 'Linux 系', systems: [
    { id: 'arch', name: 'Arch Linux 風', year: 'tty1', kind: 'lcd', accent: '#35b8ff', load: lin('Arch'), mini: { bg: '#000', fg: '#d0d0d0', text: 'Arch Linux 6.10.6-arch1-1 (tty1)\n\narchlinux login: user\nPassword:\n[user@archlinux ~]$ sudo pacman -Syu\n:: Synchronizing package\n databases...' },
      lead: 'デスクトップは入っていません。ログイン プロンプトから始まります。', feats: ['tty のログインと bash だけ', 'pacman -S / -Syu / -Ss / -Q / -R', 'neofetch・cmatrix・sl も pacman で', 'Vim / nano / less / top'] },
    { id: 'hardy', name: 'Ubuntu 8.04 (GNOME 2) 風', year: '2008', kind: 'lcd', accent: '#e08a3c', load: lin('Hardy'), mini: { bg: 'radial-gradient(ellipse 80% 60% at 60% 60%, #e9a45a, transparent 70%), linear-gradient(#6b3a1c, #c9772e)', bar: ['top', 8, '#efebe7', null], bar2: ['bottom', 8, '#efebe7'], win: ['linear-gradient(#f0a868, #c9651f)', '#efebe7', 5] },
      lead: '茶色とオレンジ。上下 2 本のパネルと、回るデスクトップ キューブ。', feats: ['「アプリケーション・場所・システム」メニュー', '上下 2 本の GNOME 2 パネル', 'Compiz 風の 3D デスクトップ キューブ', 'apt が使える bash'] },
    { id: 'mint', name: 'Linux Mint 風', year: '2024', kind: 'lcd', accent: '#86be43', load: () => import('./os/mint.js').then(m => m.Mint), mini: { bg: 'radial-gradient(circle at 72% 28%, #4c8a45, #17281b 72%)', bar: ['bottom', 9, '#26282b', '#86be43'], win: ['#3b3f45', '#2e3136', 6] },
      lead: 'Cinnamon デスクトップと bash。4 面のワークスペースは 3D キューブで回転。', feats: ['端末 (bash 互換・パイプ・スクリプト・sudo・apt)', 'Vim / nano / less / top / grep / sed / awk ほか 180 以上', 'ファイル マネージャ / エディター / システムモニター', 'Ctrl+Alt+←→ でデスクトップ キューブ'] },
    { id: 'ubuntu', name: 'Ubuntu (GNOME) 風', year: '2024', kind: 'slim', accent: '#ff7a45', load: lin('Ubuntu'), mini: { bg: 'radial-gradient(ellipse 70% 60% at 75% 70%, rgba(233,84,32,.85), transparent 65%), linear-gradient(135deg, #2c001e, #77216f)', bar: ['top', 8, '#131313', null], bar2: ['left', 9, 'rgba(30,30,30,.8)'], win: ['#2c2c2c', '#fafafa', 8] },
      lead: '左に Dock、上にトップ バー。アクティビティ画面からアプリを探します。', feats: ['トップ バーと左の Dock', 'アプリ グリッド (検索つき)', '4 面のワークスペース キューブ', 'apt が使える bash'] },
    { id: 'kde', name: 'KDE Plasma 風', year: '2024', kind: 'slim', accent: '#3daee9', load: lin('Kde'), mini: { bg: 'radial-gradient(ellipse 70% 70% at 30% 70%, rgba(61,174,233,.8), transparent 65%), radial-gradient(ellipse 60% 60% at 80% 20%, rgba(180,120,255,.6), transparent 65%), linear-gradient(135deg, #0f2a4a, #1d5fa0)', bar: ['bottom', 10, 'rgba(239,240,241,.92)', '#3daee9'], win: ['#dee0e2', '#fcfcfc', 5] },
      lead: '明るい Breeze テーマと、何でも設定できるパネル。', feats: ['Breeze ライト テーマ', 'アプリケーション ランチャー (検索つき)', 'konsole / dolphin / kate コマンド', '4 面のワークスペース キューブ'] },
  ] },
];
const ALL = FAMILIES.flatMap(f => f.systems.map(s => ({ ...s, family: f.id })));

const landing = $('#landing'), mount = $('#machine');
const last = ALL.find(s => s.id === store.get('global:last', 'xp')) || ALL.find(s => s.id === 'xp');
let fam = FAMILIES.find(f => f.id === last.family), index = fam.systems.findIndex(s => s.id === last.id), backdrop = null, launching = false, spin = 0, spinCur = 0, spinRaf = 0;
const cur = () => fam.systems[index];

// Lays the machines out on an arc: the selected one faces the viewer, two neighbours angle in on
// each side, and the rest wait out of sight.
function place() {
  const n = fam.systems.length, limit = Math.min(2.4, n / 2 - 0.25);
  landing.querySelectorAll('.pc').forEach((el, i) => {
    const o = (((i + spinCur) % n) + n * 1.5) % n - n / 2, a = Math.abs(o);
    const ang = a <= 1 ? a * 46 : a <= 2 ? 46 + (a - 1) * 30 : 76 + (a - 2) * 40;
    el.style.visibility = a > limit ? 'hidden' : '';
    el.style.transform = `rotateY(${(Math.sign(o) * ang).toFixed(2)}deg) translateZ(${(470 + 70 * Math.max(0, 1 - a)).toFixed(1)}px)`;
  });
}
function animateSpin() {
  cancelAnimationFrame(spinRaf);
  const tick = () => {
    const d = spin - spinCur;
    if (Math.abs(d) < 0.002) { spinCur = spin; place(); return; }
    spinCur += d * 0.14; place();
    spinRaf = requestAnimationFrame(tick);
  };
  tick();
}

function box(cls, w, hgt, d, front) {
  return h('div', { class: 'box ' + cls, style: { '--w': w + 'px', '--h': hgt + 'px', '--d': d + 'px' } }, h('i', { class: 'f' }, front || null), h('i', { class: 'b' }), h('i', { class: 'l' }), h('i', { class: 'r' }), h('i', { class: 't' }), h('i', { class: 'u' }));
}
function miniScreen(m) {
  const el = h('div', { class: 'mini', style: { background: m.bg } });
  if (m.text) { el.append(h('pre', { style: { color: m.fg, textShadow: `0 0 4px ${m.fg}` } }, m.text, h('u', null, '_'))); return el; }
  if (m.tiles) { el.append(h('div', { class: 'mini-tiles' }, m.tiles.map((c, i) => h('i', { style: { background: c, gridColumn: i % 4 === 0 ? 'span 2' : '' } })))); return el; }
  const bar = (b, cls) => { if (!b) return; const [side, size, color, start, center] = b, vert = side === 'left'; el.append(h('div', { class: `mini-bar ${side} ${cls || ''}`, style: { background: color, [vert ? 'width' : 'height']: size + '%' } }, start ? h('i', { style: { background: start } }) : null, center ? h('em') : null)); };
  if (m.win) el.append(h('div', { class: 'mini-win' + (m.lights ? ' lights' : ''), style: { background: m.win[1], borderRadius: m.win[2] + 'px' } }, h('b', { style: { background: m.win[0] } }), h('span')));
  bar(m.bar); bar(m.bar2);
  if (m.dock) el.append(h('div', { class: 'mini-dock' + (m.dockFloat ? ' float' : ''), style: { background: m.dock } }, h('i'), h('i'), h('i'), h('i'), h('i')));
  return el;
}
function computer(sys) {
  const screen = h('div', { class: 'scr' }, miniScreen(sys.mini), h('div', { class: 'scr-glass' }));
  const K = sys.kind;
  let body;
  if (K === 'lcd') body = [box('lcd-panel', 330, 210, 14, h('div', { class: 'bezel' }, screen)), box('lcd-neck', 34, 60, 12), box('lcd-foot', 150, 8, 90)];
  else if (K === 'slim') body = [box('slim-panel', 350, 206, 8, h('div', { class: 'bezel' }, screen)), box('slim-neck', 22, 70, 8), box('slim-foot', 130, 5, 80)];
  else if (K === 'alu') body = [box('alu-panel', 344, 262, 14, h('div', { class: 'bezel' }, screen, h('div', { class: 'chin' }))), box('alu-neck', 70, 46, 10), box('alu-foot', 120, 5, 90)];
  else if (K === 'imac') body = [box('imac-panel', 330, 268, 44, h('div', { class: 'bezel' }, screen, h('div', { class: 'chin' }))), box('alu-neck', 90, 40, 12), box('alu-foot', 150, 5, 110)];
  else if (K === 'compact') body = [box('compact', 232, 290, 240, h('div', { class: 'bezel' }, screen, h('div', { class: 'slot' }))), box('kbd', 230, 14, 80)];
  else body = [box(`crt-front ${K}`, 300, 240, 46, h('div', { class: 'bezel' }, screen, h('div', { class: 'crt-led' }))), box(`crt-back ${K}`, 236, 190, 150), box(`crt-foot ${K}`, 170, 16, 150), K === 'old' ? box('kbd', 280, 14, 90) : null];
  return h('div', { class: `pc pc-${K}`, dataset: { id: sys.id } }, h('div', { class: 'pc-bob' }, body), h('div', { class: 'pc-shadow' }));
}

function build() {
  const ring = h('div', { class: 'ring' });
  const stage = h('div', { class: 'stage' }, ring);
  landing.replaceChildren(
    h('canvas', { id: 'bg3d', 'aria-hidden': 'true' }),
    h('header', { class: 'l-head' }, h('h1', null, 'Computer', h('b', null, ' Sim')), h('p', null, 'ブラウザの中で起動する、歴代の OS たち。系統と世代を選んで電源を入れてください。'),
      h('nav', { class: 'fams', role: 'tablist' }, FAMILIES.map(f => h('button', { class: 'fam', type: 'button', role: 'tab', dataset: { id: f.id }, onClick: () => setFamily(f) }, f.label, h('small', null, String(f.systems.length)))))),
    h('button', { class: 'l-arrow prev', type: 'button', 'aria-label': '前の世代', onClick: () => select(index - 1) }, '‹'),
    stage,
    h('button', { class: 'l-arrow next', type: 'button', 'aria-label': '次の世代', onClick: () => select(index + 1) }, '›'),
    h('section', { class: 'info' }),
    h('footer', { class: 'l-foot' },
      h('button', { class: 'l-link', type: 'button', id: 'snd', onClick: e => { sound.enabled = !sound.enabled; e.currentTarget.textContent = sound.enabled ? '🔊 効果音: オン' : '🔇 効果音: オフ'; if (sound.enabled) { sound.unlock(); sound.fx('ding'); } } }, sound.enabled ? '🔊 効果音: オン' : '🔇 効果音: オフ'),
      h('button', { class: 'l-link danger', type: 'button', onClick: () => confirmClear(null) }, '🗑 すべての保存データを消去'),
      h('span', { class: 'l-note' }, '非公式のファンメイド シミュレータです。各 OS の権利者とは関係がなく、ロゴ・壁紙・アイコン・効果音はすべて自作です。データはこのブラウザの localStorage にのみ保存されます。')));
  startBackdrop($('#bg3d')).then(b => { backdrop = b; if (b) { landing.classList.add('has3d'); b.tint(cur().accent); } });
  landing.addEventListener('pointermove', e => { const x = e.clientX / innerWidth - 0.5, y = e.clientY / innerHeight - 0.5; stage.style.setProperty('--tx', (-x * 10).toFixed(2) + 'deg'); stage.style.setProperty('--ty', (y * 6).toFixed(2) + 'deg'); });
  let dragX = null;
  stage.addEventListener('pointerdown', e => { dragX = e.clientX; });
  window.addEventListener('pointerup', e => { if (dragX !== null && Math.abs(e.clientX - dragX) > 60) select(index + (e.clientX < dragX ? 1 : -1)); dragX = null; });
  setFamily(fam, index);
}
function setFamily(f, i = Math.min(index, f.systems.length - 1)) {
  if (launching) return;
  fam = f;
  for (const b of landing.querySelectorAll('.fam')) { b.classList.toggle('cur', b.dataset.id === f.id); b.setAttribute('aria-selected', b.dataset.id === f.id); }
  $('.ring').replaceChildren(...f.systems.map((s, k) => { const el = computer(s); el.addEventListener('click', () => (k === index ? launch() : select(k))); return el; }));
  select(i, true);
}
function select(i, first) {
  if (launching) return;
  const n = fam.systems.length, next = ((i % n) + n) % n;
  if (first) spin = spinCur = -next;
  else { let d = next - index; if (d > n / 2) d -= n; else if (d < -n / 2) d += n; spin -= d; }
  index = next;
  const sys = cur();
  if (first || matchMedia('(prefers-reduced-motion: reduce)').matches) { spinCur = spin; place(); } else animateSpin();
  for (const el of landing.querySelectorAll('.pc')) el.classList.toggle('front', el.dataset.id === sys.id);
  landing.style.setProperty('--accent', sys.accent);
  if (backdrop) backdrop.tint(sys.accent);
  renderInfo();
  if (!first) sound.fx('click');
}
function renderInfo() {
  const sys = cur(), used = store.usage(sys.id);
  $('.info').replaceChildren(
    h('div', { class: 'info-main' }, h('div', { class: 'info-year' }, sys.year), h('h2', null, sys.name), h('p', { class: 'info-lead' }, sys.lead), h('ul', null, sys.feats.map(f => h('li', null, f)))),
    h('div', { class: 'info-side' },
      h('button', { class: 'power-btn', type: 'button', onClick: launch }, h('span', { class: 'power-ico' }), '起動する'),
      h('div', { class: 'info-store' }, used ? `保存データ: ${fmtBytes(used)}` : '保存データ: なし (初回起動)', used ? h('button', { class: 'l-link danger', type: 'button', onClick: () => confirmClear(sys) }, '消去') : null),
      h('div', { class: 'info-keys' }, '← → 世代 ／ ↑ ↓ 系統 ／ Enter 起動')),
    h('div', { class: 'dots' }, fam.systems.map((s, i) => h('button', { class: 'dot' + (i === index ? ' cur' : ''), type: 'button', title: `${s.name} (${s.year})`, 'aria-label': s.name, onClick: () => select(i) }))));
}
function confirmClear(sys) {
  const close = () => el.remove();
  const el = h('div', { class: 'l-modal', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'l-modal-box' },
    h('h3', null, sys ? `${sys.name} のデータを消去` : 'すべての保存データを消去'),
    h('p', null, sys ? `${sys.name} マシンのファイルと設定 (${fmtBytes(store.usage(sys.id))}) をこのブラウザから削除し、初期状態に戻します。` : `すべてのマシンのファイルと設定 (${fmtBytes(store.usage())}) をこのブラウザから削除します。`, h('br'), 'この操作は元に戻せません。'),
    h('div', { class: 'l-modal-btns' }, h('button', { type: 'button', class: 'l-btn', onClick: close }, 'キャンセル'), h('button', { type: 'button', class: 'l-btn danger', onClick: () => { store.clear(sys ? sys.id : undefined); close(); renderInfo(); $('#snd').textContent = sound.enabled ? '🔊 効果音: オン' : '🔇 効果音: オフ'; } }, '消去する'))));
  el.addEventListener('pointerdown', e => { if (e.target === el) close(); });
  landing.append(el);
  el.querySelector('.l-btn').focus();
}

async function launch() {
  if (launching) return;
  launching = true;
  sound.unlock(); sound.fx('click');
  const sys = cur();
  const pc = landing.querySelector('.pc.front'), scr = pc.querySelector('.scr').getBoundingClientRect(), stage = $('.stage'), sr = stage.getBoundingClientRect();
  pc.classList.add('on');
  await sleep(380);
  stage.style.transformOrigin = `${scr.left + scr.width / 2 - sr.left}px ${scr.top + scr.height / 2 - sr.top}px`;
  landing.classList.add('zoom');
  if (backdrop) backdrop.warp(true);
  const cls = sys.load();
  await sleep(1050);
  boot(sys, await cls, false);
}

async function boot(sys, Cls, fast) {
  store.set('global:last', sys.id);
  if (backdrop) { backdrop.stop(); backdrop = null; }
  window.removeEventListener('keydown', keys);
  landing.hidden = true; landing.replaceChildren();
  mount.hidden = false; mount.replaceChildren();
  history.replaceState(null, '', '#' + sys.id);
  const machine = new Cls(mount, kind => {
    // Leaving a machine always goes through a reload so every timer and listener is gone.
    const target = kind === 'reboot' ? sys.id : kind === 'xp' ? 'xp' : /^switch:/.test(kind) ? kind.slice(7) : '';
    history.replaceState(null, '', location.pathname + location.search + (target ? '#' + target : ''));
    if (target) sessionStorage.setItem('osim:fast', target === sys.id ? '1' : ''); else sessionStorage.removeItem('osim:fast');
    location.reload();
  });
  window.osim = machine;   // handy from the browser console
  try { await machine.start({ fast }); }
  catch (e) { console.error(e); mount.replaceChildren(h('div', { class: 'fatal' }, h('h2', null, '起動に失敗しました'), h('pre', null, String(e && e.stack || e)), h('button', { type: 'button', onClick: () => { history.replaceState(null, '', location.pathname); location.reload(); } }, 'OS 選択画面に戻る'))); }
}

function keys(e) {
  if (launching || e.target.closest('.l-modal')) { if (e.key === 'Escape') landing.querySelector('.l-modal')?.remove(); return; }
  const fi = FAMILIES.indexOf(fam);
  if (e.key === 'ArrowLeft') select(index - 1); else if (e.key === 'ArrowRight') select(index + 1);
  else if (e.key === 'ArrowUp') { e.preventDefault(); setFamily(FAMILIES[(fi - 1 + FAMILIES.length) % FAMILIES.length]); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); setFamily(FAMILIES[(fi + 1) % FAMILIES.length]); }
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); launch(); }
  else if (/^[1-9]$/.test(e.key) && fam.systems[+e.key - 1]) select(+e.key - 1);
}

const direct = ALL.find(s => '#' + s.id === location.hash);
if (direct) {
  const fast = sessionStorage.getItem('osim:fast') === '1';
  sessionStorage.removeItem('osim:fast');
  direct.load().then(C => boot(direct, C, fast), e => { console.error(e); history.replaceState(null, '', location.pathname); location.reload(); });
} else {
  build();
  window.addEventListener('keydown', keys);
}
