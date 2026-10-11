// Window manager: draggable / resizable windows, focus and z-order, minimise / maximise
// with animated transitions, and workspaces (rendered as faces of a 3D cube on switch).

import { h, clamp, Emitter } from './util.js';
import { icon } from './icons.js';

let nextPid = 2100;

export class Win extends Emitter {
  constructor(wm, o) {
    super();
    this.wm = wm; this.app = o.app || 'app'; this.title = o.title || ''; this.iconName = o.icon || 'app';
    this.pid = nextPid += 3 + Math.floor(Math.random() * 20);
    this.ws = o.ws ?? wm.ws; this.minimized = false; this.maximized = false;
    this.resizable = o.resizable !== false; this.dialog = !!o.dialog;
    this.body = h('div', { class: 'win-body' });
    this.nameEl = h('span', { class: 'win-name' }, this.title);
    this.iconEl = h('span', { class: 'win-icon' }, icon(this.iconName, wm.theme, 16));
    const btn = (cls, label, fn) => h('button', { class: 'wb ' + cls, title: label, 'aria-label': label, onPointerdown: e => e.stopPropagation(), onClick: e => { e.stopPropagation(); fn(); } });
    this.bar = h('div', { class: 'win-title' }, this.iconEl, this.nameEl,
      h('div', { class: 'win-btns' },
        !this.dialog && btn('wb-min', '最小化', () => this.minimize()),
        !this.dialog && this.resizable && btn('wb-max', '最大化', () => this.toggleMax()),
        btn('wb-close', '閉じる', () => this.close())));
    this.frame = h('div', { class: 'win-frame' }, this.bar, this.body);
    this.el = h('div', { class: `win app-${this.app}${this.dialog ? ' dialog' : ''}${o.class ? ' ' + o.class : ''}`, role: 'dialog', 'aria-label': this.title }, this.frame);
    if (this.resizable) for (const d of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) this.el.append(h('div', { class: 'rz rz-' + d, onPointerdown: e => this._resize(e, d) }));
    const area = wm.area();
    const w = Math.min(o.width || 640, area.w - 8), ht = Math.min(o.height || 440, area.h - 8);
    const n = wm.windows.filter(x => x.ws === this.ws && !x.dialog).length;
    const x = o.x ?? (o.center || this.dialog ? (area.w - w) / 2 : clamp(60 + (n % 8) * 28, 0, Math.max(0, area.w - w)));
    const y = o.y ?? (o.center || this.dialog ? Math.max(0, (area.h - ht) / 2 - 20) : clamp(40 + (n % 8) * 26, 0, Math.max(0, area.h - ht)));
    this.rect = { x: Math.round(x), y: Math.round(y), w, h: ht };
    this.minW = o.minW || 220; this.minH = o.minH || 120;
    this._apply();
    this.el.addEventListener('pointerdown', () => wm.focus(this), true);
    this.bar.addEventListener('pointerdown', e => this._drag(e));
    this.bar.addEventListener('dblclick', e => { if (!e.target.closest('.wb') && this.resizable && !this.dialog) this.toggleMax(); });
    this.onClose = o.onClose || null;
    if (o.content) this.body.append(o.content);
  }
  _apply() { const r = this.rect; Object.assign(this.el.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' }); }
  setTitle(t) { this.title = t; this.nameEl.textContent = t; this.el.setAttribute('aria-label', t); this.wm.emit('change'); }
  setIcon(name) { this.iconName = name; this.iconEl.replaceChildren(icon(name, this.wm.theme, 16)); this.wm.emit('change'); }
  focus() { this.wm.focus(this); }

  _drag(e) {
    if (e.button !== 0 || e.target.closest('.wb')) return;
    const wm = this.wm, sx = e.clientX, sy = e.clientY, sc = wm.scale();
    let ox = this.rect.x, oy = this.rect.y, moved = false;
    this.bar.setPointerCapture(e.pointerId);
    const move = ev => {
      const dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      if (!moved) {
        moved = true; wm.root.classList.add('dragging');
        if (this.maximized) {   // dragging a maximised window restores it under the pointer
          const frac = (sx / sc - 0) / wm.area().w;
          this.maximized = false; this.el.classList.remove('maximized'); this.rect = { ...this.saved };
          ox = clamp(sx / sc - wm.offset().x - this.rect.w * frac, 0, wm.area().w - this.rect.w); oy = 0;
          this.emit('resize');
        }
      }
      const a = wm.area();
      this.rect.x = Math.round(clamp(ox + dx, 80 - this.rect.w, a.w - 80));
      this.rect.y = Math.round(clamp(oy + dy, 0, a.h - 30));
      this._apply();
    };
    const up = () => { this.bar.removeEventListener('pointermove', move); wm.root.classList.remove('dragging'); wm.emit('change'); };
    this.bar.addEventListener('pointermove', move);
    this.bar.addEventListener('pointerup', up, { once: true });
    this.bar.addEventListener('pointercancel', up, { once: true });
  }
  _resize(e, dir) {
    if (e.button !== 0 || this.maximized) return;
    e.stopPropagation(); e.preventDefault();
    const wm = this.wm, sx = e.clientX, sy = e.clientY, sc = wm.scale(), o = { ...this.rect }, t = e.currentTarget;
    t.setPointerCapture(e.pointerId);
    wm.root.classList.add('dragging');
    wm.focus(this);
    const move = ev => {
      const dx = (ev.clientX - sx) / sc, dy = (ev.clientY - sy) / sc, r = this.rect;
      if (dir.includes('e')) r.w = Math.max(this.minW, o.w + dx);
      if (dir.includes('s')) r.h = Math.max(this.minH, o.h + dy);
      if (dir.includes('w')) { r.w = Math.max(this.minW, o.w - dx); r.x = o.x + o.w - r.w; }
      if (dir.includes('n')) { r.h = Math.max(this.minH, o.h - dy); r.y = Math.max(0, o.y + o.h - r.h); }
      this._apply(); this.emit('resize');
    };
    const up = () => { t.removeEventListener('pointermove', move); wm.root.classList.remove('dragging'); };
    t.addEventListener('pointermove', move);
    t.addEventListener('pointerup', up, { once: true });
    t.addEventListener('pointercancel', up, { once: true });
  }

  toggleMax() {
    if (!this.resizable) return;
    this.el.classList.add('tween');
    if (this.maximized) { this.maximized = false; this.rect = { ...this.saved }; this.el.classList.remove('maximized'); this._apply(); }
    else { this.saved = { ...this.rect }; this.maximized = true; this.el.classList.add('maximized'); }
    setTimeout(() => { this.el.classList.remove('tween'); this.emit('resize'); }, 220);
    this.wm.emit('change');
  }
  minimize() {
    if (this.minimized) return;
    this.minimized = true;
    let finished = false;
    const done = () => { if (finished) return; finished = true; if (this.minimized) this.el.hidden = true; };
    const target = this.wm.taskTarget && this.wm.taskTarget(this);
    if (target && this.wm.animate) {
      const a = this.el.getBoundingClientRect();
      const dx = target.left + target.width / 2 - (a.left + a.width / 2), dy = target.top + target.height / 2 - (a.top + a.height / 2);
      this.el.animate([{ transform: 'perspective(900px) translate(0,0) scale(1) rotateX(0)', opacity: 1 }, { transform: `perspective(900px) translate(${dx}px,${dy}px) scale(.08) rotateX(${this.wm.tilt}deg)`, opacity: 0.2 }], { duration: 260, easing: 'cubic-bezier(.4,0,1,1)' }).onfinish = done;
      setTimeout(done, 320);   // background tabs may never finish the animation
    } else done();
    this.wm.focusTop();
    this.wm.emit('change');
  }
  restore() {
    if (!this.minimized) return this.focus();
    this.minimized = false; this.el.hidden = false;
    const target = this.wm.taskTarget && this.wm.taskTarget(this);
    if (target && this.wm.animate) {
      const a = this.el.getBoundingClientRect();
      const dx = target.left + target.width / 2 - (a.left + a.width / 2), dy = target.top + target.height / 2 - (a.top + a.height / 2);
      this.el.animate([{ transform: `perspective(900px) translate(${dx}px,${dy}px) scale(.08) rotateX(${this.wm.tilt}deg)`, opacity: 0.2 }, { transform: 'perspective(900px) translate(0,0) scale(1) rotateX(0)', opacity: 1 }], { duration: 240, easing: 'cubic-bezier(0,0,.2,1)' });
    }
    this.wm.focus(this);
    this.emit('resize');
  }
  async close(force) {
    if (this.closed) return;
    if (!force && this.onClose && (await this.onClose()) === false) return;
    this.closed = true;
    const wm = this.wm;
    wm.windows = wm.windows.filter(w => w !== this);
    this.emit('close');
    const rm = () => this.el.remove();
    if (wm.animate && !this.minimized) { this.el.classList.add('closing'); setTimeout(rm, 190); } else rm();
    wm.focusTop();
    wm.emit('change');
  }
}

export class WM extends Emitter {
  constructor(root, { theme = 'xp', workspaces = 1, tilt = 0 } = {}) {
    super();
    this.root = root; this.theme = theme; this.windows = []; this.z = 10; this.ws = 0; this.active = null; this.animate = true; this.tilt = tilt;
    this.cube = h('div', { class: 'ws-cube' });
    this.layers = Array.from({ length: workspaces }, (_, i) => h('div', { class: 'ws-layer', dataset: { ws: i } }));
    this.cube.append(...this.layers);
    root.append(this.cube);
    this._showLayers();
    // Clicking inside an <iframe> never reaches us; watch focus leaving the page instead.
    this._blur = () => setTimeout(() => { const a = document.activeElement; if (a && a.tagName === 'IFRAME') { const w = this.windows.find(x => x.el.contains(a)); if (w) this.focus(w); } }, 0);
    window.addEventListener('blur', this._blur);
    this.ro = new ResizeObserver(() => { for (const w of this.windows) if (w.maximized) w.emit('resize'); });
    this.ro.observe(root);
  }
  destroy() { window.removeEventListener('blur', this._blur); this.ro.disconnect(); }
  scale() { const r = this.root.getBoundingClientRect(); return r.width / this.root.offsetWidth || 1; }
  offset() { const r = this.root.getBoundingClientRect(); return { x: r.left, y: r.top }; }
  area() { return { w: this.root.clientWidth, h: this.root.clientHeight }; }

  open(o) {
    const w = new Win(this, o);
    this.windows.push(w);
    this.layers[w.ws].append(w.el);
    if (this.animate) { w.el.classList.add('opening'); setTimeout(() => w.el.classList.remove('opening'), 260); }
    this.focus(w);
    return w;
  }
  focus(w) {
    if (!w || w.closed) return;
    if (w.ws !== this.ws) this.switchWs(w.ws);
    if (w.minimized) { w.restore(); return; }
    if (this.active === w) { if (+w.el.style.zIndex !== this.z) w.el.style.zIndex = ++this.z; return; }
    if (this.active) { this.active.el.classList.remove('active'); this.active.emit('blur'); }
    this.active = w;
    w.el.style.zIndex = ++this.z;
    w.el.classList.add('active');
    w.emit('focus');
    this.emit('change');
  }
  focusTop() {
    const c = this.windows.filter(w => w.ws === this.ws && !w.minimized && !w.closed).sort((a, b) => b.el.style.zIndex - a.el.style.zIndex)[0];
    if (this.active && (this.active.closed || this.active.minimized || this.active.ws !== this.ws)) { this.active.el.classList.remove('active'); this.active.emit('blur'); this.active = null; }
    if (c) this.focus(c); else this.emit('change');
  }
  blurAll() { if (this.active) { this.active.el.classList.remove('active'); this.active.emit('blur'); this.active = null; this.emit('change'); } }
  byApp(app) { return this.windows.filter(w => w.app === app); }
  list(ws = this.ws) { return this.windows.filter(w => ws === null || w.ws === ws); }

  _showLayers() { this.layers.forEach((l, i) => { l.hidden = i !== this.ws; l.style.transform = ''; }); this.cube.style.transform = ''; this.cube.classList.remove('spinning'); }
  // Rotates the workspace cube: zoom out, turn to the target face, zoom back in.
  switchWs(n) {
    const count = this.layers.length;
    n = ((n % count) + count) % count;
    if (n === this.ws || this.spinning) return;
    const from = this.ws;
    this.ws = n;
    if (!this.animate || count < 2) { this._showLayers(); this.focusTop(); this.emit('ws', n); return; }
    this.spinning = true;
    const w = this.root.clientWidth, step = 360 / Math.max(count, 4), depth = w / 2 / Math.tan(Math.PI / Math.max(count, 4));
    let delta = n - from;
    if (Math.abs(delta) > count / 2) delta -= Math.sign(delta) * count;
    this.layers.forEach((l, i) => { l.hidden = false; l.style.transform = `rotateY(${i * step}deg) translateZ(${depth}px)`; });
    this.cube.classList.add('spinning');
    const a0 = -from * step, a1 = a0 - delta * step, pull = depth * 1.5;
    this.cube.animate([
      { transform: `translateZ(${-depth}px) rotateY(${a0}deg)` },
      { transform: `translateZ(${-depth - pull}px) rotateY(${a0 - (a1 - a0) * -0.08}deg)`, offset: 0.22 },
      { transform: `translateZ(${-depth - pull}px) rotateY(${a1 + (a1 - a0) * -0.08}deg)`, offset: 0.78 },
      { transform: `translateZ(${-depth}px) rotateY(${a1}deg)` },
    ], { duration: 780, easing: 'cubic-bezier(.45,.05,.3,1)' }).onfinish = () => { this.spinning = false; this._showLayers(); this.focusTop(); };
    this.emit('ws', n);
  }
  moveToWs(win, n) { win.ws = n; this.layers[n].append(win.el); this.focusTop(); this.emit('change'); }
}
