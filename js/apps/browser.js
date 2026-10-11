// Web browser. Pages are rendered by the visitor's own browser inside a sandboxed <iframe>;
// sites that refuse to be embedded can be opened in a real tab with one click.

import { h, esc } from '../core/util.js';
import { icon } from '../core/icons.js';
import { basename, extname } from '../core/vfs.js';
import { popupMenu, menuBar, button } from '../core/ui.js';
import { imageSrc } from './basic.js';

const HOME = 'about:home';
const SEARCH = { google: ['Google', 'https://www.google.com/search?igu=1&q='], wikipedia: ['Wikipedia', 'https://ja.wikipedia.org/w/index.php?search='], bing: ['Bing', 'https://www.bing.com/search?q='] };
const TILES = [
  ['Wikipedia', 'https://ja.wikipedia.org/', 'フリー百科事典', '#636466'],
  ['Google', 'https://www.google.com/webhp?igu=1', '検索', '#4285f4'],
  ['2001年のWeb', 'https://web.archive.org/web/2001/http://www.yahoo.co.jp/', 'Wayback Machine で当時のサイトへ', '#ab2e33'],
  ['OpenStreetMap', 'https://www.openstreetmap.org/export/embed.html?bbox=139.60,35.60,139.90,35.75&layer=mapnik', '自由な世界地図', '#7ebc6f'],
  ['Wikibooks', 'https://ja.wikibooks.org/', 'オープンな教科書', '#3a7bd5'],
  ['example.com', 'https://example.com/', '動作確認用のページ', '#888'],
];

function homePage(os) {
  const xp = os.kind === 'win' && !os.tabs;
  const light = 'body{font:14px system-ui,"Hiragino Sans","Yu Gothic UI",sans-serif;background:#f6f7f9;color:#1d1d1f;margin:0}header{padding:44px 24px 10px;text-align:center;font-size:30px;font-weight:300;letter-spacing:.04em}main{padding:10px 24px 30px;max-width:760px;margin:auto}.tile{background:#fff;border-radius:10px;box-shadow:0 1px 3px rgba(0,0,0,.12)}.tile:hover{background:#eef3ff}a{color:#06c}input[type=text]{border:1px solid #c8ccd4;border-radius:8px;padding:9px 12px;background:#fff;color:#111}button{font:inherit;padding:8px 16px;border-radius:8px;border:0;background:#0a6cff;color:#fff}select{font:inherit;border-radius:8px;padding:7px;background:#fff;color:#111;border:1px solid #c8ccd4}';
  const css = !xp && !os.dark ? light : xp
    ? 'body{font:13px Tahoma,"MS UI Gothic",sans-serif;background:#fff;color:#000;margin:0}header{background:linear-gradient(#2a5fd7,#6d9cf1);color:#fff;padding:18px 24px;font:italic bold 26px "Trebuchet MS",sans-serif}main{padding:18px 24px}.tile{border:1px solid #aac;border-radius:3px;background:#f3f6fd}.tile:hover{background:#dfe9ff}a{color:#00c}input[type=text]{border:1px solid #7f9db9;padding:4px}button{font:inherit;padding:3px 14px}'
    : 'body{font:14px "Noto Sans JP",Ubuntu,system-ui,sans-serif;background:#2b2a33;color:#fbfbfe;margin:0}header{padding:44px 24px 10px;text-align:center;font-size:30px;font-weight:300;letter-spacing:.04em}main{padding:10px 24px 30px;max-width:760px;margin:auto}.tile{background:#42414d;border-radius:8px}.tile:hover{background:#52525e}a{color:#8fd4ff}input[type=text]{border:1px solid #5b5b66;border-radius:6px;padding:9px 12px;background:#42414d;color:#fff}button{font:inherit;padding:8px 16px;border-radius:6px;border:0;background:#6fae3c;color:#fff}select{font:inherit;border-radius:6px;padding:7px;background:#42414d;color:#fff;border:1px solid #5b5b66}';
  return `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}${css}
form{display:flex;gap:8px;margin:8px 0 22px}form input{flex:1;font:inherit;min-width:0}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}
.tile{display:block;padding:12px 14px;text-decoration:none;color:inherit;cursor:pointer}.tile b{display:flex;align-items:center;gap:8px;font-size:15px}.tile i{display:inline-block;width:12px;height:12px;border-radius:3px}.tile span{display:block;opacity:.75;font-size:12px;margin-top:4px}
.note{margin-top:22px;font-size:12px;line-height:1.7;opacity:.85}h2{font-size:14px;margin:0 0 8px}</style>
<header>${xp ? 'スタート ページ' : 'ようこそ'}</header><main>
<form onsubmit="go((e.value.trim()?(s.value+encodeURIComponent(e.value)):''));return false"><input type="text" id="e" placeholder="Web を検索、または URL を入力" autofocus><select id="s">${Object.values(SEARCH).map(([n, u]) => `<option value="${esc(u)}">${n}</option>`).join('')}</select><button>検索</button></form>
<h2>埋め込み表示に対応しているサイト</h2><div class="grid">${TILES.map(([n, u, d, c]) => `<a class="tile" onclick="go('${u}')"><b><i style="background:${c}"></i>${n}</b><span>${d}</span></a>`).join('')}</div>
<div class="note">このブラウザは、あなたが今使っている本物のブラウザの表示エンジンでページを描画します。<br>多くのサイト (SNS、動画サイト、ニュースサイトなど) は安全上の理由から他のページへの埋め込みを禁止しているため、真っ白になったりエラーになることがあります。その場合はツールバーの「実ブラウザで開く」を押すと、本物の新しいタブで開けます。<br>仮想ディスク内の HTML ファイルは <code>${os.kind === 'win' ? 'C:\\\\...\\\\index.html' : 'file://' + os.docs + '/index.html'}</code> のように入力すると表示できます。</div></main>
<script>const e=document.getElementById('e'),s=document.getElementById('s');function go(u){if(u)parent.postMessage({osim:'nav',url:u},'*')}
e.addEventListener('keydown',ev=>{if(ev.key==='Enter'&&/^(https?:\\/\\/|www\\.|[\\w-]+(\\.[\\w-]+)+(\\/|$))/.test(e.value.trim())){ev.preventDefault();go(e.value.trim())}})</script>`;
}

export function browser(os, args = {}) {
  const xp = os.kind === 'win' && !os.tabs, fs = os.fs;
  const tabs = [];
  let cur = null;
  const addr = h('input', { class: 'input br-addr', type: 'text', spellcheck: 'false', 'aria-label': 'アドレス' });
  const view = h('div', { class: 'br-view' });
  const status = h('div', { class: 'statusbar' });
  const tabStrip = h('div', { class: 'br-tabs' });
  const notice = h('div', { class: 'br-notice', hidden: true });
  const tb = (ic, label, fn) => h('button', { class: 'tbtn', type: 'button', title: label, onClick: fn }, icon(ic, os.theme, xp ? 24 : 18), xp && ['back', 'forward', 'stop', 'refresh', 'home'].includes(ic) ? h('span', null, label) : null);
  const backB = tb('back', '戻る', () => step(-1)), fwdB = tb('forward', '進む', () => step(1));
  const ext = h('button', { class: 'tbtn br-ext', type: 'button', title: '本物のブラウザの新しいタブで開く', onClick: () => openExternal() }, icon('browser', os.theme, 16), h('span', null, '実ブラウザで開く'));
  const toolbar = h('div', { class: 'toolbar br-tools' }, backB, fwdB, tb('stop', '中止', () => { if (cur) { cur.frame.src = 'about:blank'; status.textContent = '中止しました'; } }), tb('refresh', '更新', () => cur && load(cur, cur.hist[cur.i], false)), tb('home', 'ホーム', () => go(HOME)),
    xp ? null : h('div', { class: 'br-addrwrap' }, addr), xp ? null : tb('star', 'ブックマーク', e => bookmarksMenu(e)), ext);
  const addrRow = xp ? h('div', { class: 'fm-addrbar' }, h('label', null, 'アドレス(D)'), addr, button('移動', () => go(addr.value)), ) : null;
  const menu = xp ? menuBar(os, [
    { label: 'ファイル(F)', items: [{ label: '新しいウィンドウ(N)', onClick: () => os.launch('browser') }, { label: '実ブラウザで開く', onClick: () => openExternal() }, '-', { label: '閉じる(C)', onClick: () => win.close() }] },
    { label: '表示(V)', items: [{ label: '最新の情報に更新(R)', onClick: () => cur && load(cur, cur.hist[cur.i], false) }, { label: 'ホーム ページ(H)', onClick: () => go(HOME) }] },
    { label: 'お気に入り(A)', items: () => bookmarkItems() },
    { label: 'ヘルプ(H)', items: [{ label: 'バージョン情報(A)', onClick: () => os.launch('about') }] },
  ]) : null;
  const content = h('div', { class: 'app-col br' }, xp ? [menu, toolbar, addrRow] : [tabStrip, toolbar], notice, view, status);
  const win = os.wm.open({ title: os.L.browser, icon: 'browser', app: 'browser', width: 860, height: 560, minW: 380, minH: 240, content });
  win.proc = { cmd: os.kind === 'win' ? 'iexplore.exe' : os.kind === 'mac' ? 'Browser' : 'firefox', exe: 'iexplore.exe' };

  const bookmarks = () => os.store.get('browser.bookmarks', TILES.slice(0, 4).map(([n, u]) => ({ title: n, url: u })));
  const bookmarkItems = () => [
    { label: 'このページをお気に入りに追加', icon: 'star', disabled: !cur || cur.hist[cur.i] === HOME, onClick: () => { const b = bookmarks(); b.push({ title: cur.title, url: cur.hist[cur.i] }); os.store.set('browser.bookmarks', b); } }, '-',
    ...bookmarks().map((b, i) => ({ label: b.title.slice(0, 40), icon: 'html', onClick: () => go(b.url), sub: undefined, hint: '' })),
    bookmarks().length ? '-' : null, { label: 'お気に入りを初期状態に戻す', onClick: () => os.store.del('browser.bookmarks') },
  ];
  const bookmarksMenu = e => { const r = e.currentTarget.getBoundingClientRect(), rr = os.root.getBoundingClientRect(); popupMenu(os, bookmarkItems(), r.left - rr.left, r.bottom - rr.top); };

  function normalize(input) {
    let u = String(input || '').trim();
    if (!u || u === HOME) return HOME;
    if (/^about:/i.test(u)) return u;
    if (/^file:\/\//i.test(u)) return 'file://' + decodeURIComponent(u.slice(7));
    if (/^([A-Za-z]:[\\/]|[\\/~])/.test(u) && !/^\/\//.test(u)) return 'file://' + os.parsePath(u);
    if (/^https?:\/\//i.test(u)) return u;
    if (/^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?(\/.*)?$/i.test(u) && !/\s/.test(u)) return 'https://' + u;
    return SEARCH[os.store.get('browser.search', 'google')][1] + encodeURIComponent(u);
  }
  function titleOf(url) {
    if (url === HOME) return xp ? 'スタート ページ' : '新しいタブ';
    if (url.startsWith('file://')) return basename(url);
    try { const x = new URL(url); return x.searchParams.get('q') || x.searchParams.get('search') ? `${x.searchParams.get('q') || x.searchParams.get('search')} - 検索` : x.hostname.replace(/^www\./, ''); } catch { return url; }
  }
  function load(tab, url, push = true) {
    if (push) { tab.hist.splice(tab.i + 1); tab.hist.push(url); tab.i = tab.hist.length - 1; }
    tab.title = titleOf(url);
    const f = tab.frame;
    f.removeAttribute('srcdoc'); f.removeAttribute('src');
    notice.hidden = true;
    status.textContent = url === HOME ? '' : `${url} を開いています...`;
    if (url === HOME) { f.setAttribute('sandbox', 'allow-scripts allow-forms'); f.srcdoc = homePage(os); }
    else if (url === 'about:blank') f.src = 'about:blank';
    else if (url.startsWith('file://')) {
      const p = url.slice(7), n = fs.stat(p);
      f.setAttribute('sandbox', 'allow-scripts allow-forms');
      let doc;
      if (!n) doc = errorPage(xp, 'ファイルが見つかりません', os.pathLabel(p));
      else if (n.t === 'd') { let names = []; try { names = fs.readdir(p); } catch { /* unreadable */ } doc = `<!doctype html><meta charset="utf-8"><body style="font:14px sans-serif;padding:16px"><h3>${esc(os.pathLabel(p))} のインデックス</h3><ul>${names.map(x => `<li><a href="#" onclick="parent.postMessage({osim:'nav',url:'file://${esc((p === '/' ? '' : p) + '/' + x).replace(/'/g, "\\'")}'},'*');return false">${esc(x)}${fs.isDir((p === '/' ? '' : p) + '/' + x) ? '/' : ''}</a></li>`).join('')}</ul>`; }
      else {
        let text = '';
        try { text = fs.read(p); } catch { doc = errorPage(xp, 'アクセスが拒否されました', os.pathLabel(p)); }
        const img = imageSrc(text);
        if (doc) { /* error */ } else if (img) doc = `<!doctype html><body style="margin:0;display:grid;place-items:center;min-height:100vh;background:#222"><img src="${img}" style="max-width:100%">`;
        else if (['html', 'htm'].includes(extname(p)) || /^\s*<!doctype html|^\s*<html/i.test(text)) doc = text;
        else doc = `<!doctype html><meta charset="utf-8"><pre style="font:13px ui-monospace,Menlo,Consolas,monospace;padding:12px;white-space:pre-wrap;word-break:break-all">${esc(text)}</pre>`;
      }
      f.srcdoc = doc;
    } else {
      f.setAttribute('sandbox', 'allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads');
      f.src = url;
      notice.hidden = false;
      notice.replaceChildren(h('span', null, '表示されない場合、このサイトは埋め込みを許可していません。'), h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, '本物のブラウザで開く ↗'), h('button', { class: 'br-x', type: 'button', onClick: () => { notice.hidden = true; } }, '×'));
    }
    sync();
  }
  const errorPage = (isXp, msg, detail) => `<!doctype html><meta charset="utf-8"><body style="font:14px sans-serif;padding:28px;${isXp ? '' : 'background:#2b2a33;color:#eee'}"><h2 style="font-weight:normal">ページを表示できません</h2><p>${esc(msg)}</p><p style="opacity:.7">${esc(detail)}</p>`;
  function sync() {
    if (!cur || cur.i < 0) return;
    const url = cur.hist[cur.i];
    addr.value = url === HOME ? '' : url.startsWith('file://') ? (xp ? os.pathLabel(url.slice(7)) : url) : url;
    backB.disabled = cur.i === 0; fwdB.disabled = cur.i >= cur.hist.length - 1;
    ext.disabled = !/^https?:/.test(url);
    win.setTitle(`${cur.title} - ${os.L.browser}`);
    tabStrip.replaceChildren(...tabs.map(t => h('div', { class: 'br-tab' + (t === cur ? ' cur' : ''), onClick: () => select(t), title: t.hist[t.i] }, icon('html', os.theme, 14), h('span', null, t.title),
      h('button', { class: 'br-x', type: 'button', onClick: e => { e.stopPropagation(); closeTab(t); } }, '×'))), h('button', { class: 'br-new', type: 'button', title: '新しいタブ', onClick: () => newTab(HOME) }, '+'));
  }
  function newTab(url) {
    const frame = h('iframe', { class: 'br-frame', referrerpolicy: 'no-referrer', allow: 'fullscreen', title: 'ページ' });
    const tab = { frame, hist: [], i: -1, title: '' };
    frame.addEventListener('load', () => { if (tab === cur) status.textContent = xp ? 'ページが表示されました' : ''; });
    tabs.push(tab); view.append(frame);
    select(tab);
    load(tab, normalize(url));
    return tab;
  }
  function select(tab) { cur = tab; for (const t of tabs) t.frame.hidden = t !== tab; sync(); }
  function closeTab(tab) { const i = tabs.indexOf(tab); tabs.splice(i, 1); tab.frame.remove(); if (!tabs.length) return win.close(); if (cur === tab) select(tabs[Math.max(0, i - 1)]); else sync(); }
  function go(input) { const url = normalize(input); if (!cur) newTab(url); else load(cur, url); }
  function step(d) { if (!cur || cur.i + d < 0 || cur.i + d >= cur.hist.length) return; cur.i += d; load(cur, cur.hist[cur.i], false); }
  function openExternal() { const url = cur && cur.hist[cur.i]; if (url && /^https?:/.test(url)) window.open(url, '_blank', 'noopener,noreferrer'); }

  addr.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') go(addr.value); });
  addr.addEventListener('focus', () => addr.select());
  const onMsg = e => { const t = tabs.find(x => x.frame.contentWindow === e.source); if (t && e.data && e.data.osim === 'nav' && typeof e.data.url === 'string') { if (t !== cur) select(t); load(t, normalize(e.data.url)); } };
  window.addEventListener('message', onMsg);
  win.on('close', () => window.removeEventListener('message', onMsg));
  newTab(args.url || (args.path ? 'file://' + args.path : HOME));
  return win;
}
