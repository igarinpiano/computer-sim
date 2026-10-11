// Entry point: the 3D machine-select screen, and handing control to the chosen machine.

import { h, $, fmtBytes, sleep } from './core/util.js';
import { store } from './core/storage.js';
import { sound } from './core/sound.js';
import { iconSvg } from './core/icons.js';
import { startBackdrop } from './landing3d.js';

const SYSTEMS = [
  { id: 'xp', name: 'Windows XP 風', year: '2001', kind: 'crt', accent: '#3a8cff', load: () => import('./os/xp.js').then(m => m.XP),
    lead: '青いタスクバーと緑の [スタート]。あの頃のデスクトップ。',
    feats: ['コマンド プロンプト (cmd.exe 互換・バッチ ファイル・Vim)', 'エクスプローラ / メモ帳 / ペイント / 電卓 / マインスイーパ', 'Web ブラウザ (あなたのブラウザのエンジンで表示)', '3D パイプのスクリーン セーバー'] },
  { id: 'mint', name: 'Linux Mint 風', year: '2024', kind: 'lcd', accent: '#86be43', load: () => import('./os/mint.js').then(m => m.Mint),
    lead: 'Cinnamon デスクトップと bash。4 面のワークスペースは 3D キューブで回転。',
    feats: ['端末 (bash 互換・パイプ・スクリプト・sudo・apt)', 'Vim / nano / less / top / grep / sed / find ほか 150 以上のコマンド', 'ファイル マネージャ / テキストエディター / システムモニター', 'Ctrl+Alt+←→ でデスクトップ キューブ'] },
  { id: 'dos', name: 'DOS 風', year: '1994', kind: 'old', accent: '#f0b040', load: () => import('./os/dos.js').then(m => m.Dos),
    lead: 'C:\\> だけの世界。ウィンドウもマウスもありません。',
    feats: ['COMMAND.COM 風のプロンプト', 'DIR / COPY CON / EDIT / バッチ ファイル', 'Vim も入っています', 'WIN と打つと…?'] },
];

const landing = $('#landing'), mount = $('#machine');
let index = Math.max(0, SYSTEMS.findIndex(s => s.id === store.get('global:last', 'xp'))), backdrop = null, launching = false, spin = 0, spinCur = 0, spinRaf = 0;

// Lays the machines out on an arc: the selected one faces the viewer, its neighbours angle in
// from the sides, and anything further round travels behind them.
function place() {
  const n = SYSTEMS.length, step = 360 / n;
  landing.querySelectorAll('.pc').forEach((el, i) => {
    let t = (((i + spinCur) * step) % 360 + 540) % 360 - 180;
    const a = Math.abs(t), shown = a <= step ? a * (50 / step) : 50 + (a - step) * (130 / (180 - step));
    el.style.transform = `rotateY(${(Math.sign(t) * shown).toFixed(2)}deg) translateZ(${(470 + 70 * Math.max(0, 1 - a / 60)).toFixed(1)}px)`;
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
function miniScreen(id) {
  if (id === 'xp') return h('div', { class: 'mini mini-xp' }, h('div', { class: 'mini-win' }, h('b'), h('span')), h('div', { class: 'mini-bar' }, h('i')));
  if (id === 'mint') return h('div', { class: 'mini mini-mint' }, h('div', { class: 'mini-leaf', html: iconSvg('leaf', 'mint', 54) }), h('div', { class: 'mini-win' }, h('b'), h('span')), h('div', { class: 'mini-bar' }, h('i')));
  return h('div', { class: 'mini mini-dos' }, h('pre', null, 'Starting DOS...\n\nC:\\>dir /w\n[DOS]  [VIM]  [DOCS]\nREADME.TXT\n\nC:\\>', h('u', null, '_')));
}
function computer(sys) {
  const screen = h('div', { class: 'scr' }, miniScreen(sys.id), h('div', { class: 'scr-glass' }));
  let body;
  if (sys.kind === 'lcd') body = [box('lcd-panel', 330, 210, 14, h('div', { class: 'bezel' }, screen)), box('lcd-neck', 34, 60, 12), box('lcd-foot', 150, 8, 90)];
  else body = [box(`crt-front ${sys.kind}`, 300, 240, 46, h('div', { class: 'bezel' }, screen, h('div', { class: 'crt-led' }))), box(`crt-back ${sys.kind}`, 236, 190, 150), box(`crt-foot ${sys.kind}`, 170, 16, 150), sys.kind === 'old' ? box('kbd', 280, 14, 90) : null];
  return h('div', { class: `pc pc-${sys.kind}`, dataset: { id: sys.id } }, h('div', { class: 'pc-bob' }, body), h('div', { class: 'pc-shadow' }));
}

function build() {
  const ring = h('div', { class: 'ring' }, SYSTEMS.map((s, i) => { const el = computer(s); el.addEventListener('click', () => (i === index ? launch() : select(i))); return el; }));
  const stage = h('div', { class: 'stage' }, ring);
  const info = h('section', { class: 'info' });
  landing.replaceChildren(
    h('canvas', { id: 'bg3d', 'aria-hidden': 'true' }),
    h('header', { class: 'l-head' }, h('h1', null, 'Computer', h('b', null, ' Sim')), h('p', null, 'ブラウザの中で起動する、なつかしい OS たち。マシンを選んで電源を入れてください。')),
    h('button', { class: 'l-arrow prev', type: 'button', 'aria-label': '前のマシン', onClick: () => select(index - 1) }, '‹'),
    stage,
    h('button', { class: 'l-arrow next', type: 'button', 'aria-label': '次のマシン', onClick: () => select(index + 1) }, '›'),
    info,
    h('footer', { class: 'l-foot' },
      h('button', { class: 'l-link', type: 'button', id: 'snd', onClick: e => { sound.enabled = !sound.enabled; e.currentTarget.textContent = sound.enabled ? '🔊 効果音: オン' : '🔇 効果音: オフ'; if (sound.enabled) { sound.unlock(); sound.fx('ding'); } } }, sound.enabled ? '🔊 効果音: オン' : '🔇 効果音: オフ'),
      h('button', { class: 'l-link danger', type: 'button', onClick: () => confirmClear(null) }, '🗑 すべての保存データを消去'),
      h('span', { class: 'l-note' }, '非公式のファンメイド シミュレータです。各 OS の権利者とは関係がなく、ロゴ・壁紙・アイコン・効果音はすべて自作です。データはこのブラウザの localStorage にのみ保存されます。')));
  startBackdrop($('#bg3d')).then(b => { backdrop = b; if (b) { landing.classList.add('has3d'); b.tint(SYSTEMS[index].accent); } });
  // pointer parallax
  landing.addEventListener('pointermove', e => { const x = e.clientX / innerWidth - 0.5, y = e.clientY / innerHeight - 0.5; stage.style.setProperty('--tx', (-x * 10).toFixed(2) + 'deg'); stage.style.setProperty('--ty', (y * 6).toFixed(2) + 'deg'); });
  let dragX = null;
  stage.addEventListener('pointerdown', e => { dragX = e.clientX; });
  window.addEventListener('pointerup', e => { if (dragX !== null && Math.abs(e.clientX - dragX) > 60) select(index + (e.clientX < dragX ? 1 : -1)); dragX = null; });
  select(index, true);
}

function select(i, first) {
  if (launching) return;
  const n = SYSTEMS.length, next = ((i % n) + n) % n;
  if (first) spin = spinCur = -next;
  else { let d = next - index; if (d > n / 2) d -= n; else if (d < -n / 2) d += n; spin -= d; }
  index = next;
  const sys = SYSTEMS[index];
  if (first || matchMedia('(prefers-reduced-motion: reduce)').matches) { spinCur = spin; place(); } else animateSpin();
  for (const el of landing.querySelectorAll('.pc')) el.classList.toggle('front', el.dataset.id === sys.id);
  landing.style.setProperty('--accent', sys.accent);
  if (backdrop) backdrop.tint(sys.accent);
  renderInfo();
  if (!first) sound.fx('click');
}
function renderInfo() {
  const sys = SYSTEMS[index], used = store.usage(sys.id);
  $('.info').replaceChildren(
    h('div', { class: 'info-main' }, h('div', { class: 'info-year' }, sys.year), h('h2', null, sys.name), h('p', { class: 'info-lead' }, sys.lead), h('ul', null, sys.feats.map(f => h('li', null, f)))),
    h('div', { class: 'info-side' },
      h('button', { class: 'power-btn', type: 'button', onClick: launch }, h('span', { class: 'power-ico' }), '起動する'),
      h('div', { class: 'info-store' }, used ? `保存データ: ${fmtBytes(used)}` : '保存データ: なし (初回起動)', used ? h('button', { class: 'l-link danger', type: 'button', onClick: () => confirmClear(sys) }, '消去') : null),
      h('div', { class: 'info-keys' }, '← → で選択 ／ Enter で起動')),
    h('div', { class: 'dots' }, SYSTEMS.map((s, i) => h('button', { class: 'dot' + (i === index ? ' cur' : ''), type: 'button', 'aria-label': s.name, onClick: () => select(i) }))));
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
  const sys = SYSTEMS[index];
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
    const target = kind === 'reboot' ? sys.id : kind === 'xp' ? 'xp' : '';
    history.replaceState(null, '', location.pathname + location.search + (target ? '#' + target : ''));
    if (target) sessionStorage.setItem('osim:fast', kind === 'xp' ? '' : '1'); else sessionStorage.removeItem('osim:fast');
    location.reload();
  });
  window.osim = machine;   // handy from the browser console
  try { await machine.start({ fast }); }
  catch (e) { console.error(e); mount.replaceChildren(h('div', { class: 'fatal' }, h('h2', null, '起動に失敗しました'), h('pre', null, String(e && e.stack || e)), h('button', { type: 'button', onClick: () => { history.replaceState(null, '', location.pathname); location.reload(); } }, 'OS 選択画面に戻る'))); }
}

function keys(e) {
  if (launching || e.target.closest('.l-modal')) { if (e.key === 'Escape') landing.querySelector('.l-modal')?.remove(); return; }
  if (e.key === 'ArrowLeft') select(index - 1); else if (e.key === 'ArrowRight') select(index + 1);
  else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); launch(); }
  else if (/^[1-9]$/.test(e.key) && SYSTEMS[+e.key - 1]) select(+e.key - 1);
}

const direct = SYSTEMS.find(s => '#' + s.id === location.hash);
if (direct) {
  const fast = sessionStorage.getItem('osim:fast') === '1';
  sessionStorage.removeItem('osim:fast');
  direct.load().then(C => boot(direct, C, fast));
} else {
  build();
  window.addEventListener('keydown', keys);
}
