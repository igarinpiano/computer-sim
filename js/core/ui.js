// Shared widgets: popup menus, menu bars, message / input boxes and the file open-save dialog.

import { h, clamp } from './util.js';
import { icon, iconFor } from './icons.js';
import { dirname, basename, join } from './vfs.js';

let openMenus = [];
export function closeMenus() { for (const m of openMenus) m.remove(); openMenus = []; document.removeEventListener('pointerdown', onDocDown, true); document.removeEventListener('keydown', onDocKey, true); }
function onDocDown(e) { if (!e.target.closest('.menu') && !e.target.closest('.menubar')) closeMenus(); }
function onDocKey(e) { if (e.key === 'Escape') closeMenus(); }

// items: array of '-' | { label, icon, onClick, disabled, checked, sub: [...], hint }
export function popupMenu(os, items, x, y, { parent = null, cls = '' } = {}) {
  if (!parent) closeMenus();
  const root = os.root, rr = root.getBoundingClientRect();
  const el = h('div', { class: 'menu ' + cls, role: 'menu' });
  let sub = null;
  const closeSub = () => { if (sub) { openMenus = openMenus.filter(m => m !== sub.el && !sub.el.contains(m)); sub.el.remove(); sub = null; } };
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { el.append(h('div', { class: 'menu-sep' })); continue; }
    const row = h('div', { class: 'menu-item' + (it.disabled ? ' disabled' : '') + (it.sub ? ' has-sub' : ''), role: 'menuitem' },
      h('span', { class: 'menu-ico' }, it.checked ? '✔' : it.icon ? icon(it.icon, os.theme, 16) : ''),
      h('span', { class: 'menu-label' }, it.label), it.hint ? h('span', { class: 'menu-hint' }, it.hint) : null, it.sub ? h('span', { class: 'menu-arrow' }, '▸') : null);
    row.addEventListener('pointerenter', () => {
      closeSub();
      if (it.sub && !it.disabled) { const r = row.getBoundingClientRect(); sub = popupMenu(os, typeof it.sub === 'function' ? it.sub() : it.sub, r.right - rr.left - 3, r.top - rr.top - 3, { parent: el, cls }); }
    });
    row.addEventListener('click', e => { e.stopPropagation(); if (it.disabled || it.sub) return; closeMenus(); if (it.onClick) it.onClick(); });
    el.append(row);
  }
  root.append(el);
  const w = el.offsetWidth, ht = el.offsetHeight;
  if (parent && x + w > rr.width) x = Math.max(0, parent.offsetLeft - w + 3);
  el.style.left = clamp(x, 0, Math.max(0, rr.width - w)) + 'px';
  el.style.top = clamp(y, 0, Math.max(0, rr.height - ht)) + 'px';
  openMenus.push(el);
  if (!parent) setTimeout(() => { document.addEventListener('pointerdown', onDocDown, true); document.addEventListener('keydown', onDocKey, true); }, 0);
  return { el, close: closeMenus };
}

// defs: [{ label, items: [...] | () => [...] }]
export function menuBar(os, defs) {
  const bar = h('div', { class: 'menubar' });
  let open = null;
  for (const d of defs) {
    const b = h('div', { class: 'menubar-item' }, d.label);
    const show = () => {
      const r = b.getBoundingClientRect(), rr = os.root.getBoundingClientRect();
      for (const x of bar.children) x.classList.remove('open');
      b.classList.add('open'); open = b;
      popupMenu(os, typeof d.items === 'function' ? d.items() : d.items, r.left - rr.left, r.bottom - rr.top);
      const watch = setInterval(() => { if (!openMenus.length) { clearInterval(watch); b.classList.remove('open'); if (open === b) open = null; } }, 120);
    };
    b.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); if (open === b) { closeMenus(); b.classList.remove('open'); open = null; } else show(); });
    b.addEventListener('pointerenter', () => { if (open && open !== b) show(); });
    bar.append(b);
  }
  return bar;
}

export const button = (label, onClick, cls = '') => h('button', { class: 'btn ' + cls, type: 'button', onClick }, label);

export function msgBox(os, { title = os.name, text, icon: ic = 'info', buttons = ['OK'], width = 380 }) {
  return new Promise(res => {
    let done = false;
    const finish = v => { if (done) return; done = true; res(v); win.close(true); };
    const btns = h('div', { class: 'dlg-btns' }, buttons.map((b, i) => button(b, () => finish(b), i === 0 ? 'default' : '')));
    const content = h('div', { class: 'dlg' }, h('div', { class: 'dlg-row' }, h('div', { class: 'dlg-icon' }, icon(ic, os.theme, 34)), h('div', { class: 'dlg-text' }, text)), btns);
    const win = os.wm.open({ title, icon: ic, content, width, height: 150, dialog: true, resizable: false, app: 'dialog' });
    win.onClose = () => { finish(buttons.at(-1)); return true; };
    fit(win);
    btns.firstChild.focus();
    content.addEventListener('keydown', e => { if (e.key === 'Escape') finish(buttons.at(-1)); });
    if (os.sound) os.sound(ic === 'error' ? 'error' : ic === 'warning' || ic === 'question' ? 'warn' : 'ding');
  });
}
// Sizes a dialog window to its content.
export function fit(win) {
  const inner = win.body.firstElementChild;
  if (!inner) return;
  const extra = win.el.offsetHeight - win.body.clientHeight;
  win.rect.h = Math.min(win.wm.area().h - 10, inner.scrollHeight + extra + 2);
  if (win.dialog) win.rect.y = Math.max(0, Math.round((win.wm.area().h - win.rect.h) / 2 - 20));
  win._apply();
}

export function inputBox(os, { title, label, value = '', ok = 'OK', cancel = 'キャンセル', icon: ic = 'run', width = 380 }) {
  return new Promise(res => {
    let done = false;
    const finish = v => { if (done) return; done = true; res(v); win.close(true); };
    const input = h('input', { class: 'input', type: 'text', value, spellcheck: 'false' });
    const content = h('div', { class: 'dlg' }, h('div', { class: 'dlg-row' }, h('div', { class: 'dlg-icon' }, icon(ic, os.theme, 34)), h('div', { class: 'dlg-text' }, label, h('div', { style: { marginTop: '8px' } }, input))),
      h('div', { class: 'dlg-btns' }, button(ok, () => finish(input.value), 'default'), button(cancel, () => finish(null))));
    const win = os.wm.open({ title, icon: ic, content, width, height: 160, dialog: true, resizable: false, app: 'dialog' });
    win.onClose = () => { finish(null); return true; };
    fit(win);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') finish(input.value); else if (e.key === 'Escape') finish(null); e.stopPropagation(); });
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

// mode: 'open' | 'save'. Resolves to a VFS path or null.
export function fileDialog(os, { mode = 'open', dir, name = '', title } = {}) {
  return new Promise(res => {
    const fs = os.fs;
    let cwd = dir && fs.isDir(dir) ? dir : os.docs || os.home, done = false, selected = null;
    const finish = v => { if (done) return; done = true; res(v); win.close(true); };
    const pathEl = h('input', { class: 'input fd-path', type: 'text', spellcheck: 'false' });
    const list = h('div', { class: 'fd-list', tabindex: '0' });
    const nameEl = h('input', { class: 'input', type: 'text', value: name, spellcheck: 'false' });
    const render = () => {
      pathEl.value = os.pathLabel(cwd);
      list.replaceChildren();
      let names = [];
      try { names = fs.readdir(cwd); } catch { /* unreadable */ }
      const node = fs.stat(cwd);
      const ents = names.filter(n => !n.startsWith('.')).map(n => [n, node.c[n]]).sort((a, b) => (b[1].t === 'd') - (a[1].t === 'd') || a[0].localeCompare(b[0], 'ja'));
      for (const [n, e] of ents) {
        const row = h('div', { class: 'fd-item' }, icon(iconFor(n, e), os.theme, 16), h('span', null, os.displayName ? os.displayName(n) : n));
        row.addEventListener('click', () => { for (const x of list.children) x.classList.remove('sel'); row.classList.add('sel'); selected = n; if (e.t !== 'd') nameEl.value = n; });
        row.addEventListener('dblclick', () => { if (e.t === 'd') { cwd = join(cwd, n); selected = null; render(); } else accept(); });
        list.append(row);
      }
    };
    const accept = async () => {
      let v = nameEl.value.trim();
      if (!v) { if (selected && fs.isDir(join(cwd, selected))) { cwd = join(cwd, selected); selected = null; render(); } return; }
      const p = /^([A-Za-z]:|[\\/~])/.test(v) ? os.parsePath(v) : join(cwd, v);
      if (fs.isDir(p)) { cwd = p; nameEl.value = ''; render(); return; }
      if (mode === 'open' && !fs.exists(p)) { await msgBox(os, { title: title || '開く', text: `${v}\nファイルが見つかりません。ファイル名を確認して、再実行してください。`, icon: 'warning' }); return; }
      if (mode === 'save' && fs.exists(p) && (await msgBox(os, { title: title || '名前を付けて保存', text: `${basename(p)} は既に存在します。\n上書きしますか?`, icon: 'warning', buttons: ['はい', 'いいえ'] })) !== 'はい') return;
      finish(p);
    };
    const up = button('上へ', () => { cwd = dirname(cwd); render(); });
    const content = h('div', { class: 'dlg fd' },
      h('div', { class: 'fd-top' }, h('label', null, mode === 'save' ? '保存する場所:' : 'ファイルの場所:'), pathEl, up),
      list,
      h('div', { class: 'fd-bottom' }, h('label', null, 'ファイル名:'), nameEl, button(mode === 'save' ? '保存' : '開く', accept, 'default'), button('キャンセル', () => finish(null))));
    pathEl.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { const p = os.parsePath(pathEl.value); if (fs.isDir(p)) { cwd = p; render(); } } });
    nameEl.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') accept(); else if (e.key === 'Escape') finish(null); });
    const win = os.wm.open({ title: title || (mode === 'save' ? '名前を付けて保存' : '開く'), icon: 'folder', content, width: 520, height: 380, dialog: true, resizable: false, app: 'dialog' });
    win.onClose = () => { finish(null); return true; };
    render();
    setTimeout(() => nameEl.focus(), 30);
  });
}
