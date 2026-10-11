// In-memory POSIX-ish filesystem persisted to localStorage.
// Node shape: { t: 'd'|'f'|'l', c: {name: node} | d: 'content or link target', m: mode, o: owner, mt: mtime, dyn?: name }

import { Emitter } from './util.js';
import { store } from './storage.js';

export class FsError extends Error {
  constructor(code, path) { super(code); this.code = code; this.path = path; }
}
const MSG = {
  ENOENT: 'No such file or directory', EEXIST: 'File exists', ENOTDIR: 'Not a directory', EISDIR: 'Is a directory',
  EACCES: 'Permission denied', ENOTEMPTY: 'Directory not empty', EINVAL: 'Invalid argument',
  ELOOP: 'Too many levels of symbolic links', EPERM: 'Operation not permitted', ENOSPC: 'No space left on device',
};
export const errMsg = e => MSG[e.code] || e.message;

export const dirname = p => { const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); };
export const basename = p => p.slice(p.lastIndexOf('/') + 1);
export const extname = p => { const b = basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : ''; };
export const join = (a, b) => (a === '/' ? '/' + b : a + '/' + b);

export class VFS extends Emitter {
  constructor({ storeKey, ci = false, perms = true, user = 'user', seed, version = 1 }) {
    super();
    Object.assign(this, { storeKey, ci, perms, user, seed, version });
    this.dyn = {};
    this.full = false;
    this.load();
  }

  load() {
    const data = this.storeKey ? store.get(this.storeKey) : null;
    if (data && data.v === this.version && data.root) this.root = data.root;
    else this.reset();
  }

  reset() {
    this.root = { t: 'd', c: {}, m: 0o755, o: 'root', mt: Date.now() };
    const u = this.user, p = this.perms;
    this.user = 'root'; this.perms = false; this._quiet = true;
    const b = {
      dir: (path, o = {}) => { this.mkdir(path, { p: true }); Object.assign(this._get(path), o); },
      file: (path, d = '', o = {}) => { this.mkdir(dirname(path), { p: true }); this.write(path, d); Object.assign(this._get(path, false), o); },
      link: (path, target) => { this.mkdir(dirname(path), { p: true }); this.symlink(target, path); },
    };
    if (this.seed) this.seed(b, this);
    this.user = u; this.perms = p; this._quiet = false;
    this.save();
  }

  save() {
    if (!this.storeKey) return;
    const ok = store.set(this.storeKey, { v: this.version, root: this.root });
    if (!ok && !this.full) this.emit('quota');
    this.full = !ok;
  }

  _dirty(path) {
    if (this._quiet) return;
    clearTimeout(this._saveT); this._saveT = setTimeout(() => this.save(), 250);
    clearTimeout(this._evT); this._evT = setTimeout(() => this.emit('change', path), 30);
  }

  abs(p, cwd = '/') {
    if (!p.startsWith('/')) p = cwd + '/' + p;
    const out = [];
    for (const s of p.split('/')) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s); }
    return '/' + out.join('/');
  }

  _can(node, bit) {
    if (!this.perms || this.user === 'root') return true;
    return ((node.o === this.user ? node.m >> 6 : node.m) & bit) !== 0;
  }

  _child(dir, name) {
    if (Object.hasOwn(dir.c, name)) return [name, dir.c[name]];
    if (this.ci) { const l = name.toLowerCase(); for (const k of Object.keys(dir.c)) if (k.toLowerCase() === l) return [k, dir.c[k]]; }
    return null;
  }

  // Walks a normalized absolute path. Returns { node, path } where path is the real (link-free, true-case) path.
  _walk(path, follow = true, depth = 0) {
    if (depth > 20) throw new FsError('ELOOP', path);
    let node = this.root, cur = '';
    const parts = path.split('/').filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      if (node.t !== 'd') throw new FsError('ENOTDIR', path);
      if (!this._can(node, 1)) throw new FsError('EACCES', path);
      const ch = this._child(node, parts[i]);
      if (!ch) throw new FsError('ENOENT', path);
      if (ch[1].t === 'l' && (follow || i < parts.length - 1)) {
        const target = this.abs(ch[1].d, cur || '/');
        const rest = parts.slice(i + 1).join('/');
        return this._walk(rest ? target + '/' + rest : target, follow, depth + 1);
      }
      node = ch[1]; cur += '/' + ch[0];
    }
    return { node, path: cur || '/' };
  }
  _get(path, follow = true) { return this._walk(path, follow).node; }

  // Parent directory node + final name for create/remove operations.
  _parent(path, need = 3) {
    if (path === '/') throw new FsError('EINVAL', path);
    const dir = this._get(dirname(path));
    if (dir.t !== 'd') throw new FsError('ENOTDIR', path);
    if (need && !this._can(dir, need)) throw new FsError('EACCES', path);
    const name = basename(path);
    if (name === '__proto__') throw new FsError('EINVAL', path);
    return { dir, name, hit: this._child(dir, name) };
  }

  stat(path, follow = true) { try { return this._get(path, follow); } catch { return null; } }
  lstat(path) { return this.stat(path, false); }
  exists(path) { return !!this.stat(path); }
  isDir(path) { const n = this.stat(path); return !!n && n.t === 'd'; }
  isFile(path) { const n = this.stat(path); return !!n && n.t === 'f'; }
  realpath(path) { return this._walk(path).path; }

  readdir(path) {
    const n = this._get(path);
    if (n.t !== 'd') throw new FsError('ENOTDIR', path);
    if (!this._can(n, 4)) throw new FsError('EACCES', path);
    return Object.keys(n.c).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  read(path) {
    const n = this._get(path);
    if (n.t === 'd') throw new FsError('EISDIR', path);
    if (!this._can(n, 4)) throw new FsError('EACCES', path);
    if (n.dyn) return this.dyn[n.dyn] ? this.dyn[n.dyn]() : '';
    return n.d;
  }

  write(path, data, { append = false, mode = 0o644 } = {}) {
    const { dir, name, hit } = this._parent(path, 1);
    let n = hit && hit[1];
    if (n && n.t === 'l') { const w = this._walk(path); return this.write(w.path, data, { append, mode }); }
    if (n) {
      if (n.t === 'd') throw new FsError('EISDIR', path);
      if (!this._can(n, 2)) throw new FsError('EACCES', path);
      if (n.dyn) return;
      n.d = append ? n.d + data : data; n.mt = Date.now();
    } else {
      if (!this._can(dir, 2)) throw new FsError('EACCES', path);
      dir.c[name] = { t: 'f', d: data, m: mode, o: this.user, mt: Date.now() };
      dir.mt = Date.now();
    }
    this._dirty(path);
  }

  mkdir(path, { p = false, mode = 0o755 } = {}) {
    if (p) {
      let cur = '';
      for (const part of path.split('/').filter(Boolean)) {
        cur += '/' + part;
        const n = this.stat(cur);
        if (!n) this.mkdir(cur, { mode });
        else if (n.t !== 'd') throw new FsError('ENOTDIR', cur);
      }
      return;
    }
    const { dir, name, hit } = this._parent(path);
    if (hit) throw new FsError('EEXIST', path);
    dir.c[name] = { t: 'd', c: {}, m: mode, o: this.user, mt: Date.now() };
    dir.mt = Date.now();
    this._dirty(path);
  }

  symlink(target, path) {
    const { dir, name, hit } = this._parent(path);
    if (hit) throw new FsError('EEXIST', path);
    dir.c[name] = { t: 'l', d: target, m: 0o777, o: this.user, mt: Date.now() };
    this._dirty(path);
  }

  rmdir(path) {
    const { dir, hit } = this._parent(path);
    if (!hit) throw new FsError('ENOENT', path);
    if (hit[1].t !== 'd') throw new FsError('ENOTDIR', path);
    if (Object.keys(hit[1].c).length) throw new FsError('ENOTEMPTY', path);
    delete dir.c[hit[0]]; dir.mt = Date.now();
    this._dirty(path);
  }

  unlink(path) {
    const { dir, hit } = this._parent(path);
    if (!hit) throw new FsError('ENOENT', path);
    if (hit[1].t === 'd') throw new FsError('EISDIR', path);
    delete dir.c[hit[0]]; dir.mt = Date.now();
    this._dirty(path);
  }

  rm(path, { r = false } = {}) {
    const { dir, hit } = this._parent(path);
    if (!hit) throw new FsError('ENOENT', path);
    if (hit[1].t === 'd' && !r) throw new FsError('EISDIR', path);
    delete dir.c[hit[0]]; dir.mt = Date.now();
    this._dirty(path);
  }

  rename(src, dst) {
    if (dst === src) return;
    if ((dst + '/').startsWith(src + '/')) throw new FsError('EINVAL', dst);
    const a = this._parent(src);
    if (!a.hit) throw new FsError('ENOENT', src);
    const b = this._parent(dst);
    if (b.hit) {
      if (b.hit[1].t === 'd' && a.hit[1].t !== 'd') throw new FsError('EISDIR', dst);
      if (b.hit[1].t === 'd' && Object.keys(b.hit[1].c).length) throw new FsError('ENOTEMPTY', dst);
      // Case-only rename on a case-insensitive volume hits the same entry.
      if (b.hit[1] !== a.hit[1]) delete b.dir.c[b.hit[0]];
    }
    delete a.dir.c[a.hit[0]];
    b.dir.c[b.name] = a.hit[1];
    a.dir.mt = b.dir.mt = Date.now();
    this._dirty(dst);
  }

  copy(src, dst, { r = false, preserve = false } = {}) {
    const n = this._get(src, false);
    if (n.t === 'd' && !r) throw new FsError('EISDIR', src);
    if ((dst + '/').startsWith(src + '/')) throw new FsError('EINVAL', dst);
    const { dir, name, hit } = this._parent(dst);
    if (hit && hit[1].t === 'd' && n.t !== 'd') throw new FsError('EISDIR', dst);
    const clone = x => {
      if (x.t === 'd' && !this._can(x, 4)) throw new FsError('EACCES', src);
      if (x.t !== 'd' && x.t !== 'l' && !this._can(x, 4)) throw new FsError('EACCES', src);
      const y = { t: x.t, m: x.m, o: preserve ? x.o : this.user, mt: preserve ? x.mt : Date.now() };
      if (x.dyn) y.dyn = x.dyn;
      if (x.t === 'd') { y.c = {}; for (const k of Object.keys(x.c)) y.c[k] = clone(x.c[k]); } else y.d = x.d;
      return y;
    };
    const c = clone(n);
    if (hit && hit[1].t === 'd' && c.t === 'd') Object.assign(hit[1].c, c.c);
    else { if (hit) delete dir.c[hit[0]]; dir.c[name] = c; }
    this._dirty(dst);
  }

  chmod(path, mode) {
    const n = this._get(path);
    if (this.perms && this.user !== 'root' && n.o !== this.user) throw new FsError('EPERM', path);
    n.m = mode; this._dirty(path);
  }
  chown(path, owner) {
    const n = this._get(path);
    if (this.perms && this.user !== 'root') throw new FsError('EPERM', path);
    n.o = owner; this._dirty(path);
  }
  touch(path, mt = Date.now()) {
    const n = this.stat(path);
    if (!n) return this.write(path, '');
    if (!this._can(n, 2)) throw new FsError('EACCES', path);
    n.mt = mt; this._dirty(path);
  }

  size(node) { return node.t === 'd' ? 4096 : node.dyn ? 0 : new Blob([node.d]).size; }
  du(node) {
    if (node.t !== 'd') return this.size(node);
    let n = 4096;
    for (const k of Object.keys(node.c)) n += this.du(node.c[k]);
    return n;
  }
  // Depth-first visit: cb(path, node). Unreadable directories are skipped.
  walk(path, cb, follow = false) {
    const n = this.stat(path, follow);
    if (!n) return;
    cb(path, n);
    if (n.t === 'd' && this._can(n, 4)) for (const k of Object.keys(n.c).sort()) this.walk(join(path, k), cb);
  }
}
