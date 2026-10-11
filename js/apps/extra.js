// Minesweeper, a paint program, the settings / control panel and the screensavers.

import { h, fmtBytes, download, clamp } from '../core/util.js';
import { store } from '../core/storage.js';
import { sound } from '../core/sound.js';
import { dirname, basename } from '../core/vfs.js';
import { menuBar, msgBox, fileDialog, button, fit } from '../core/ui.js';

// ---------------------------------------------------------------- minesweeper
export function mines(os) {
  const LEVELS = { 初級: [9, 9, 10], 中級: [16, 16, 40], 上級: [30, 16, 99] };
  let level = os.store.get('mines.level', '初級'), W, H, N, cells, state, flags, opened, timer = null, secs = 0;
  const board = h('div', { class: 'ms-board' });
  const count = h('div', { class: 'ms-led' }), clock = h('div', { class: 'ms-led' }), face = h('button', { class: 'ms-face', type: 'button', onClick: () => reset() });
  const led = n => String(clamp(n, -99, 999)).padStart(3, '0');
  const content = h('div', { class: 'app-col ms' },
    menuBar(os, [{ label: 'ゲーム(G)', items: () => [{ label: '新規(N)', hint: 'F2', onClick: () => reset() }, '-', ...Object.keys(LEVELS).map(l => ({ label: l, checked: l === level, onClick: () => { level = l; os.store.set('mines.level', l); reset(); } })), '-', { label: '最高記録', onClick: () => msgBox(os, { title: '最高記録', text: Object.keys(LEVELS).map(l => `${l}: ${os.store.get('mines.best.' + l, 999)} 秒`).join('\n') }) }, { label: '終了(X)', onClick: () => win.close() }] },
      { label: 'ヘルプ(H)', items: [{ label: '遊び方', onClick: () => msgBox(os, { title: os.L.mines, text: '左クリックでマスを開き、右クリックで旗を立てます。\n数字は周囲 8 マスにある地雷の数です。\n開いた数字をダブルクリックすると、旗の数が合っていれば周囲をまとめて開きます。' }) }] }]),
    h('div', { class: 'ms-frame' }, h('div', { class: 'ms-top' }, count, face, clock), board));
  const win = os.wm.open({ title: os.L.mines, icon: 'mines', app: 'mines', width: 200, height: 260, resizable: false, content });
  win.proc = { cmd: os.id === 'mint' ? 'gnome-mines' : 'winmine.exe', exe: 'winmine.exe' };
  const idx = (x, y) => y * W + x;
  const around = i => { const x = i % W, y = Math.floor(i / W), out = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if ((dx || dy) && nx >= 0 && ny >= 0 && nx < W && ny < H) out.push(idx(nx, ny)); } return out; };
  function reset() {
    [W, H, N] = LEVELS[level];
    cells = Array.from({ length: W * H }, () => ({ mine: false, open: false, flag: false, n: 0 }));
    state = 'ready'; flags = 0; opened = 0; secs = 0; clearInterval(timer); timer = null;
    board.style.gridTemplateColumns = `repeat(${W}, 18px)`;
    board.replaceChildren(...cells.map((c, i) => h('div', { class: 'ms-cell', dataset: { i } })));
    face.textContent = '🙂'; draw();
    win.rect.w = W * 18 + 30; win._apply();
    requestAnimationFrame(() => fit(win));
  }
  function plant(safe) {
    const banned = new Set([safe, ...around(safe)]);
    let left = N;
    while (left) { const i = Math.floor(Math.random() * W * H); if (cells[i].mine || banned.has(i)) continue; cells[i].mine = true; left--; }
    cells.forEach((c, i) => { c.n = around(i).filter(j => cells[j].mine).length; });
    state = 'play';
    timer = setInterval(() => { secs++; clock.textContent = led(secs); }, 1000);
  }
  function open(i) {
    const stack = [i];
    while (stack.length) {
      const j = stack.pop(), c = cells[j];
      if (c.open || c.flag) continue;
      c.open = true; opened++;
      if (c.mine) return lose(j);
      if (c.n === 0) stack.push(...around(j));
    }
    if (opened === W * H - N) win_();
  }
  function lose(hit) { state = 'over'; clearInterval(timer); cells[hit].boom = true; for (const c of cells) if (c.mine) c.open = true; face.textContent = '😵'; os.sound('boom'); }
  function win_() {
    state = 'over'; clearInterval(timer); for (const c of cells) if (c.mine) c.flag = true; flags = N; face.textContent = '😎'; os.sound('win');
    if (secs < os.store.get('mines.best.' + level, 999)) { os.store.set('mines.best.' + level, secs); os.notify(os.L.mines, `${level}の最高記録を更新しました: ${secs} 秒`); }
  }
  function draw() {
    count.textContent = led(N - flags); clock.textContent = led(secs);
    cells.forEach((c, i) => {
      const el = board.children[i];
      el.className = 'ms-cell' + (c.open ? ' open' : '') + (c.boom ? ' boom' : '') + (c.open && !c.mine && c.n ? ' n' + c.n : '');
      el.textContent = c.open ? (c.mine ? '✹' : c.n || '') : c.flag ? '⚑' : state === 'over' && c.wrong ? '✕' : '';
      if (!c.open && c.flag) el.classList.add('flag');
    });
  }
  board.addEventListener('contextmenu', e => e.preventDefault());
  board.addEventListener('pointerdown', e => { if (state !== 'over' && e.button === 0) face.textContent = '😮'; });
  board.addEventListener('pointerup', e => {
    const el = e.target.closest('.ms-cell');
    if (state === 'over') return;
    face.textContent = '🙂';
    if (!el) return;
    const i = +el.dataset.i, c = cells[i];
    if (e.button === 2) { if (!c.open) { c.flag = !c.flag; flags += c.flag ? 1 : -1; } }
    else if (e.button === 0 && !c.flag) { if (state === 'ready') plant(i); open(i); }
    draw();
  });
  board.addEventListener('dblclick', e => {
    const el = e.target.closest('.ms-cell');
    if (!el || state !== 'play') return;
    const i = +el.dataset.i, c = cells[i];
    if (c.open && c.n && around(i).filter(j => cells[j].flag).length === c.n) { for (const j of around(i)) if (state === 'play') open(j); draw(); }
  });
  content.addEventListener('keydown', e => { if (e.key === 'F2') reset(); });
  win.on('close', () => clearInterval(timer));
  reset();
  return win;
}

// ---------------------------------------------------------------- paint
export function paint(os, args = {}) {
  const fs = os.fs, COLORS = ['#000000', '#808080', '#800000', '#808000', '#008000', '#008080', '#000080', '#800080', '#808040', '#004040', '#0080ff', '#004080', '#8000ff', '#804000', '#ffffff', '#c0c0c0', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ffff80', '#00ff80', '#80ffff', '#8080ff', '#ff0080', '#ff8040'];
  const canvas = h('canvas', { class: 'pt-canvas', width: 520, height: 340 }), g = canvas.getContext('2d', { willReadFrequently: true });
  let tool = 'pencil', color = '#000000', size = 2, path = null, dirty = false, snap = null, start = null;
  const undo = [];
  const clear = () => { g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height); dirty = false; };
  const TOOLS = [['pencil', '鉛筆', '✎'], ['brush', 'ブラシ', '🖌'], ['eraser', '消しゴム', '▱'], ['fill', '塗りつぶし', '◈'], ['line', '直線', '╱'], ['rect', '四角形', '▭'], ['ellipse', '楕円', '◯']];
  const toolBox = h('div', { class: 'pt-tools' }, TOOLS.map(([id, label, glyph]) => h('button', { class: 'tbtn' + (id === tool ? ' on' : ''), type: 'button', title: label, dataset: { tool: id }, onClick: e => { tool = id; for (const b of toolBox.querySelectorAll('[data-tool]')) b.classList.toggle('on', b === e.currentTarget); } }, glyph)),
    h('input', { type: 'range', min: '1', max: '24', value: '2', title: '太さ', class: 'pt-size', onInput: e => { size = +e.target.value; } }));
  const curColor = h('div', { class: 'pt-cur', style: { background: color } });
  const palette = h('div', { class: 'pt-palette' }, curColor, h('div', { class: 'pt-colors' }, COLORS.map(c => h('button', { class: 'pt-color', type: 'button', style: { background: c }, title: c, onClick: () => { color = c; curColor.style.background = c; } }))));
  const title = () => win.setTitle(`${path ? basename(path) : '無題'} - ${os.L.paint}`);
  const load = p => { const img = new Image(); img.onload = () => { canvas.width = Math.min(1200, img.naturalWidth || 520); canvas.height = Math.min(900, img.naturalHeight || 340); clear(); g.drawImage(img, 0, 0); path = p; title(); }; img.onerror = () => msgBox(os, { title: os.L.paint, text: 'このファイルは画像として読み込めません。', icon: 'error' }); const d = fs.read(p); img.src = /^data:/.test(d) ? d : 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(d); };
  const save = async as => {
    let p = path;
    if (as || !p || !/\.png$/i.test(p)) { p = await fileDialog(os, { mode: 'save', dir: path ? dirname(path) : os.pics, name: '無題.png' }); if (!p) return false; if (!/\.png$/i.test(p)) p += '.png'; }
    try { fs.write(p, canvas.toDataURL('image/png')); } catch { await msgBox(os, { title: os.L.paint, text: '保存できませんでした。', icon: 'error' }); return false; }
    if (fs.full) await msgBox(os, { title: os.L.paint, text: 'ブラウザの保存領域がいっぱいです。この画像は再読み込みすると失われます。不要なファイルを削除してください。', icon: 'warning' });
    path = p; dirty = false; title(); return true;
  };
  const content = h('div', { class: 'app-col pt' },
    menuBar(os, [
      { label: 'ファイル(F)', items: [{ label: '新規(N)', onClick: () => { clear(); path = null; title(); } }, { label: '開く(O)...', onClick: async () => { const p = await fileDialog(os, { dir: os.pics }); if (p) load(p); } }, { label: '上書き保存(S)', onClick: () => save(false) }, { label: '名前を付けて保存(A)...', onClick: () => save(true) }, '-', { label: '実際の PC にダウンロード', onClick: () => { const a = h('a', { href: canvas.toDataURL('image/png'), download: (path ? basename(path) : 'untitled.png') }); a.click(); } }, '-', { label: '終了(X)', onClick: () => win.close() }] },
      { label: '編集(E)', items: [{ label: '元に戻す(U)', hint: 'Ctrl+Z', onClick: () => back() }, { label: 'すべて消去', onClick: () => { push(); clear(); dirty = true; } }] },
    ]),
    h('div', { class: 'pt-body' }, toolBox, h('div', { class: 'pt-stage' }, canvas)), palette);
  const win = os.wm.open({ title: '', icon: 'paint', app: 'paint', width: 660, height: 500, minW: 320, minH: 260, content });
  win.proc = { cmd: os.id === 'mint' ? 'drawing' : 'mspaint.exe', exe: 'mspaint.exe' };
  const push = () => { undo.push(g.getImageData(0, 0, canvas.width, canvas.height)); if (undo.length > 15) undo.shift(); };
  const back = () => { const u = undo.pop(); if (u) g.putImageData(u, 0, 0); };
  const pos = e => { const r = canvas.getBoundingClientRect(); return { x: Math.floor((e.clientX - r.left) * (canvas.width / r.width)), y: Math.floor((e.clientY - r.top) * (canvas.height / r.height)) }; };
  function flood(x, y) {
    const img = g.getImageData(0, 0, canvas.width, canvas.height), d = img.data, w = canvas.width, hh = canvas.height;
    const at = (px, py) => (py * w + px) * 4, s = at(x, y), tr = d[s], tg = d[s + 1], tb = d[s + 2];
    const c = parseInt(color.slice(1), 16), r = c >> 16, gg = (c >> 8) & 255, b = c & 255;
    if (tr === r && tg === gg && tb === b) return;
    const stack = [[x, y]];
    while (stack.length) {
      const [px, py] = stack.pop();
      if (px < 0 || py < 0 || px >= w || py >= hh) continue;
      const i = at(px, py);
      if (d[i] !== tr || d[i + 1] !== tg || d[i + 2] !== tb) continue;
      d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
      stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
    }
    g.putImageData(img, 0, 0);
  }
  canvas.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId); push(); dirty = true;
    const p = pos(e); start = p;
    if (tool === 'fill') { flood(p.x, p.y); start = null; return; }
    snap = g.getImageData(0, 0, canvas.width, canvas.height);
    g.lineCap = g.lineJoin = 'round'; g.strokeStyle = tool === 'eraser' ? '#fff' : color; g.lineWidth = tool === 'pencil' ? Math.max(1, size / 2) : tool === 'eraser' ? size * 3 : size;
    g.beginPath(); g.moveTo(p.x + 0.5, p.y + 0.5); g.lineTo(p.x + 0.5, p.y + 0.5); g.stroke();
  });
  canvas.addEventListener('pointermove', e => {
    if (!start) return;
    const p = pos(e);
    if (['pencil', 'brush', 'eraser'].includes(tool)) { g.lineTo(p.x + 0.5, p.y + 0.5); g.stroke(); return; }
    g.putImageData(snap, 0, 0); g.beginPath();
    if (tool === 'line') { g.moveTo(start.x, start.y); g.lineTo(p.x, p.y); }
    else if (tool === 'rect') g.rect(start.x + 0.5, start.y + 0.5, p.x - start.x, p.y - start.y);
    else g.ellipse((start.x + p.x) / 2, (start.y + p.y) / 2, Math.abs(p.x - start.x) / 2, Math.abs(p.y - start.y) / 2, 0, 0, Math.PI * 2);
    g.stroke();
  });
  canvas.addEventListener('pointerup', () => { start = null; });
  content.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); back(); } });
  content.tabIndex = 0;
  win.onClose = async () => { if (!dirty) return true; const a = await msgBox(os, { title: os.L.paint, text: `${path ? basename(path) : '無題'} への変更を保存しますか?`, icon: 'warning', buttons: ['はい', 'いいえ', 'キャンセル'] }); return a === 'キャンセル' ? false : a === 'いいえ' ? true : save(false); };
  clear(); title();
  if (args.path) load(args.path);
  return win;
}

// ---------------------------------------------------------------- settings / control panel
export function settings(os, args = {}) {
  const xp = os.id !== 'mint';
  const pane = h('div', { class: 'set-pane' });
  const nav = h('div', { class: 'set-nav' });
  const s = os.settings;
  const row = (label, ctl) => h('div', { class: 'set-row' }, h('label', null, label), ctl);
  const select = (opts, val, fn) => { const el = h('select', { class: 'input', onChange: e => fn(e.target.value) }, opts.map(([v, t]) => h('option', { value: v, selected: v === val }, t))); return el; };
  const pages = {
    desktop: ['デスクトップ', 'desktop', () => [
      h('h3', null, '背景'),
      h('div', { class: 'set-wp' }, os.wallpapers.map(([id, label]) => h('button', { class: 'set-wp-item' + (s.wallpaper === id ? ' on' : ''), type: 'button', onClick: () => { os.set('wallpaper', id); show('desktop'); } }, h('div', { class: `wp-thumb wp-${os.id} wp-${id}` }), h('span', null, label)))),
      h('h3', null, '表示'),
      row('ウィンドウのアニメーション', h('input', { type: 'checkbox', checked: s.animate, onChange: e => os.set('animate', e.target.checked) })),
      os.id === 'mint' ? row('ワークスペース切り替え', h('span', null, 'Ctrl + Alt + ← / →、またはパネル右側の番号')) : null,
    ]],
    saver: ['スクリーン セーバー', 'saver', () => [
      h('h3', null, 'スクリーン セーバー'),
      row('種類', select([['pipes', '3D パイプ'], ['stars', '宇宙飛行 (スターフィールド)'], ['mystify', 'ライン アート'], ['none', '(なし)']], s.saver, v => os.set('saver', v))),
      row('待ち時間', select([['1', '1 分'], ['3', '3 分'], ['5', '5 分'], ['10', '10 分'], ['30', '30 分']], String(s.saverWait), v => os.set('saverWait', +v))),
      h('div', { class: 'dlg-btns left' }, button('プレビュー', () => setTimeout(() => os.startSaver(true), 250))),
    ]],
    sound: ['サウンド', 'sound', () => [
      h('h3', null, 'サウンド'),
      row('効果音を鳴らす', h('input', { type: 'checkbox', checked: sound.enabled, onChange: e => { sound.enabled = e.target.checked; if (e.target.checked) os.sound('ding'); os.refreshTray?.(); } })),
      h('div', { class: 'dlg-btns left' }, button('起動音をテスト', () => os.sound('startup')), button('通知音', () => os.sound('ding')), button('エラー音', () => os.sound('error'))),
      h('p', { class: 'set-note' }, '効果音はすべて Web Audio で合成したオリジナルの音です。'),
    ]],
    storage: ['ストレージ', 'drive', () => {
      const mine = store.usage(os.id), all = store.usage(), quota = 5 * 1024 * 1024;
      return [
        h('h3', null, 'ブラウザの保存領域 (localStorage)'),
        h('p', null, `この PC のファイルや設定は、お使いのブラウザの localStorage に保存されています。サーバーには何も送信されません。`),
        h('div', { class: 'set-meter' }, h('div', { style: { width: Math.min(100, (all / quota) * 100) + '%' } }, h('i', { style: { width: Math.min(100, (mine / Math.max(1, all)) * 100) + '%' } }))),
        h('p', null, `${os.name}: ${fmtBytes(mine)}　／　全 OS 合計: ${fmtBytes(all)}　(上限の目安 約 5 MB)`),
        store.persistent ? null : h('p', { class: 'set-warn' }, 'このブラウザでは localStorage が使えないため、変更はページを閉じると失われます。'),
        h('div', { class: 'dlg-btns left' },
          button(`${os.name} を初期状態に戻す`, async () => { if ((await msgBox(os, { title: 'データの初期化', text: `${os.name} のファイルと設定をすべて消去し、初期状態に戻します。\nこの操作は元に戻せません。続行しますか?`, icon: 'warning', buttons: ['はい', 'いいえ'] })) === 'はい') os.factoryReset(false); }),
          button('すべての OS のデータを消去', async () => { if ((await msgBox(os, { title: 'データの消去', text: 'すべての OS のファイルと設定を消去して、最初の画面に戻ります。\nこの操作は元に戻せません。続行しますか?', icon: 'warning', buttons: ['はい', 'いいえ'] })) === 'はい') os.factoryReset(true); })),
        h('div', { class: 'dlg-btns left' }, button('ディスク全体をバックアップ (JSON)', () => download(`${os.id}-disk.json`, JSON.stringify(store.get(`${os.id}:fs`)), 'application/json'))),
      ];
    }],
    system: ['システム', 'computer', () => [h('h3', null, 'システム'), ...os.aboutLines().map(l => h('p', null, l)), h('div', { class: 'dlg-btns left' }, button('バージョン情報', () => os.launch('about')), button(os.L.taskmgr, () => os.launch('taskmgr')))]],
  };
  function show(id) {
    for (const b of nav.children) b.classList.toggle('on', b.dataset.id === id);
    pane.replaceChildren(...pages[id][2]().flat().filter(Boolean));
  }
  for (const [id, [label, ic]] of Object.entries(pages)) nav.append(h('button', { class: 'set-nav-item', type: 'button', dataset: { id }, onClick: () => show(id) }, os.icon(ic, 22), h('span', null, label)));
  const win = os.wm.open({ title: os.L.settings, icon: 'settings', app: 'settings', width: 620, height: 420, minW: 420, content: h('div', { class: 'set' + (xp ? ' set-xp' : '') }, nav, pane) });
  win.proc = { cmd: xp ? 'rundll32.exe shell32.dll,Control_RunDLL' : 'cinnamon-settings', exe: 'rundll32.exe' };
  show(args.page && pages[args.page] ? args.page : 'desktop');
  return win;
}

// ---------------------------------------------------------------- screensavers
export async function screensaver(root, kind, onStop) {
  const canvas = h('canvas', { class: 'saver' });
  const wrap = h('div', { class: 'saver-wrap' }, canvas);
  root.append(wrap);
  let raf = 0, alive = true, cleanup = () => {};
  const size = () => { canvas.width = wrap.clientWidth; canvas.height = wrap.clientHeight; };
  size();
  const stop = () => { if (!alive) return; alive = false; cancelAnimationFrame(raf); cleanup(); wrap.remove(); for (const [ev, fn] of listeners) window.removeEventListener(ev, fn, true); if (onStop) onStop(); };
  const armed = Date.now() + 500;
  let moved = 0;
  const listeners = [['keydown', e => { e.preventDefault(); stop(); }], ['pointerdown', () => { if (Date.now() > armed) stop(); }], ['pointermove', () => { if (Date.now() > armed && ++moved > 6) stop(); }]];
  for (const [ev, fn] of listeners) window.addEventListener(ev, fn, true);

  if (kind === 'pipes') {
    let THREE = null;
    try { THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'); } catch { kind = 'stars'; }
    if (THREE && alive) {
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setPixelRatio(Math.min(2, devicePixelRatio));
      const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(50, canvas.width / canvas.height, 0.1, 200);
      cam.position.set(14, 12, 26); cam.lookAt(0, 0, 0);
      scene.add(new THREE.AmbientLight(0xffffff, 0.45));
      const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(8, 14, 10); scene.add(sun);
      const G = 11, CELL = 2, used = new Set(), group = new THREE.Group();
      scene.add(group);
      const key = p => p.join(','), ball = new THREE.SphereGeometry(0.62, 20, 14), tube = new THREE.CylinderGeometry(0.42, 0.42, CELL, 16);
      const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
      let pipes = [], total = 0;
      const toWorld = p => new THREE.Vector3((p[0] - G / 2) * CELL, (p[1] - G / 2) * CELL, (p[2] - G / 2) * CELL);
      const spawn = () => {
        for (let t = 0; t < 40; t++) {
          const p = [0, 1, 2].map(() => Math.floor(Math.random() * G));
          if (used.has(key(p))) continue;
          const mat = new THREE.MeshPhongMaterial({ color: new THREE.Color().setHSL(Math.random(), 0.75, 0.52), shininess: 90, specular: 0x777777 });
          const m = new THREE.Mesh(ball, mat); m.position.copy(toWorld(p)); group.add(m); used.add(key(p));
          pipes.push({ p, dir: DIRS[Math.floor(Math.random() * 6)], mat }); return;
        }
      };
      const resetAll = () => { group.clear(); used.clear(); pipes = []; total = 0; spawn(); };
      const grow = pipe => {
        let options = DIRS.filter(d => { const q = pipe.p.map((v, i) => v + d[i]); return q.every(v => v >= 0 && v < G) && !used.has(key(q)); });
        if (!options.length) return false;
        const straight = options.find(d => d === pipe.dir);
        const d = straight && Math.random() < 0.6 ? straight : options[Math.floor(Math.random() * options.length)];
        const q = pipe.p.map((v, i) => v + d[i]);
        const seg = new THREE.Mesh(tube, pipe.mat);
        seg.position.copy(toWorld(pipe.p).add(toWorld(q)).multiplyScalar(0.5));
        if (d[0]) seg.rotation.z = Math.PI / 2; else if (d[2]) seg.rotation.x = Math.PI / 2;
        group.add(seg);
        if (d !== pipe.dir) { const j = new THREE.Mesh(ball, pipe.mat); j.position.copy(toWorld(pipe.p)); j.scale.setScalar(0.82); group.add(j); }
        pipe.p = q; pipe.dir = d; used.add(key(q)); total++;
        return true;
      };
      resetAll();
      let last = 0, fade = 0;
      const loop = t => {
        if (!alive) return;
        raf = requestAnimationFrame(loop);
        if (canvas.width !== wrap.clientWidth || canvas.height !== wrap.clientHeight) { renderer.setSize(wrap.clientWidth, wrap.clientHeight, false); cam.aspect = wrap.clientWidth / wrap.clientHeight; cam.updateProjectionMatrix(); }
        if (t - last > 45) {
          last = t;
          if (fade) { if (--fade === 0) resetAll(); }
          else { pipes = pipes.filter(grow); if (!pipes.length || (pipes.length < 3 && Math.random() < 0.05)) spawn(); if (total > 620 || (!pipes.length && used.size > G * G)) fade = 40; }
        }
        group.rotation.y = t / 9000;
        renderer.render(scene, cam);
      };
      renderer.setSize(wrap.clientWidth, wrap.clientHeight, false);
      raf = requestAnimationFrame(loop);
      cleanup = () => { renderer.dispose(); ball.dispose(); tube.dispose(); };
      return stop;
    }
  }
  if (!alive) return stop;
  const g = canvas.getContext('2d');
  if (kind === 'mystify') {
    const mk = hue => ({ hue, pts: Array.from({ length: 4 }, () => ({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, vx: (Math.random() - 0.5) * 9, vy: (Math.random() - 0.5) * 9 })), trail: [] });
    const shapes = [mk(200), mk(320)];
    const loop = () => {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      if (canvas.width !== wrap.clientWidth) size();
      g.fillStyle = '#000'; g.fillRect(0, 0, canvas.width, canvas.height);
      for (const s of shapes) {
        for (const p of s.pts) { p.x += p.vx; p.y += p.vy; if (p.x < 0 || p.x > canvas.width) p.vx *= -1; if (p.y < 0 || p.y > canvas.height) p.vy *= -1; }
        s.trail.push(s.pts.map(p => [p.x, p.y])); if (s.trail.length > 9) s.trail.shift();
        s.hue = (s.hue + 0.3) % 360;
        s.trail.forEach((poly, i) => { g.strokeStyle = `hsla(${s.hue},90%,60%,${(i + 1) / s.trail.length})`; g.lineWidth = 1.5; g.beginPath(); poly.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke(); });
      }
    };
    raf = requestAnimationFrame(loop);
  } else {
    const stars = Array.from({ length: 420 }, () => ({ x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: Math.random() }));
    const loop = () => {
      if (!alive) return;
      raf = requestAnimationFrame(loop);
      if (canvas.width !== wrap.clientWidth) size();
      const w = canvas.width, hh = canvas.height;
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, w, hh);
      for (const s of stars) {
        const pz = s.z; s.z -= 0.006;
        if (s.z <= 0.02) { s.x = (Math.random() - 0.5) * 2; s.y = (Math.random() - 0.5) * 2; s.z = 1; continue; }
        const x = w / 2 + (s.x / s.z) * w * 0.5, y = hh / 2 + (s.y / s.z) * w * 0.5, px = w / 2 + (s.x / pz) * w * 0.5, py = hh / 2 + (s.y / pz) * w * 0.5;
        g.strokeStyle = `rgba(255,255,255,${1 - s.z})`; g.lineWidth = (1 - s.z) * 2.4; g.beginPath(); g.moveTo(px, py); g.lineTo(x, y); g.stroke();
      }
    };
    raf = requestAnimationFrame(loop);
  }
  return stop;
}
