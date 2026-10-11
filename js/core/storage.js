// localStorage wrapper. Every key is namespaced "osim:<os>:<name>" so one OS can be wiped
// without touching the others. Falls back to memory when storage is unavailable.

const P = 'osim:';
const mem = new Map();
let ls = null;
try { ls = globalThis.localStorage; ls.setItem(P + 't', '1'); ls.removeItem(P + 't'); } catch { ls = null; }

const raw = {
  get: k => (ls ? ls.getItem(k) : mem.has(k) ? mem.get(k) : null),
  set: (k, v) => { if (ls) ls.setItem(k, v); else mem.set(k, v); },
  del: k => { if (ls) ls.removeItem(k); else mem.delete(k); },
  keys: () => (ls ? Object.keys(ls) : [...mem.keys()]),
};

export const store = {
  persistent: !!ls,
  get(k, d) { try { const v = raw.get(P + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  // Returns false when the browser refuses the write (quota exceeded).
  set(k, v) { try { raw.set(P + k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { raw.del(P + k); },
  keys(prefix = '') { return raw.keys().filter(k => k.startsWith(P + prefix)).map(k => k.slice(P.length)); },
  clear(osId) { for (const k of this.keys(osId ? osId + ':' : '')) raw.del(P + k); },
  usage(osId) {
    let n = 0;
    for (const k of this.keys(osId ? osId + ':' : '')) n += (k.length + P.length + (raw.get(P + k) || '').length) * 2;
    return n;
  },
  scoped(osId) {
    return {
      get: (k, d) => store.get(`${osId}:${k}`, d),
      set: (k, v) => store.set(`${osId}:${k}`, v),
      del: k => store.del(`${osId}:${k}`),
    };
  },
};
