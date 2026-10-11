// Original SVG icons (32x32 viewBox). Nothing here is traced from an existing icon set.
// Each entry is a function of the palette so the same shapes fit every desktop theme.

const P = {
  xp: { folder: '#f8d568', folderDark: '#d9a520', accent: '#2a6fe0', paper: '#ffffff', ink: '#33415c', metal: '#c9d2e0', screen: '#2f7bd6' },
  mint: { folder: '#8fc45a', folderDark: '#5f9a35', accent: '#6fae3c', paper: '#f4f6f8', ink: '#3b4252', metal: '#aab4c0', screen: '#3a8f6e' },
  win9x: { folder: '#f2d76b', folderDark: '#b8962a', accent: '#000080', paper: '#ffffff', ink: '#000000', metal: '#c0c0c0', screen: '#008080' },
  aero: { folder: '#f6dc8a', folderDark: '#d2a93c', accent: '#3c8ad9', paper: '#ffffff', ink: '#33415c', metal: '#cfd8e6', screen: '#3f8fe0' },
  win10: { folder: '#f7c64a', folderDark: '#d79a1e', accent: '#0078d4', paper: '#ffffff', ink: '#33415c', metal: '#d5dbe5', screen: '#0a74d0' },
  mac: { folder: '#6bb7f5', folderDark: '#3f8fd6', accent: '#1a7df0', paper: '#ffffff', ink: '#33415c', metal: '#d4d8de', screen: '#5a9ff0' },
  macclassic: { folder: '#c9cdea', folderDark: '#6a6fa8', accent: '#4a4a8a', paper: '#ffffff', ink: '#000000', metal: '#d6d6d6', screen: '#9aa7c7' },
  ubuntu: { folder: '#f28a4b', folderDark: '#c9541a', accent: '#e95420', paper: '#f7f7f7', ink: '#3b4252', metal: '#b9b4b0', screen: '#77216f' },
  hardy: { folder: '#e3b06a', folderDark: '#a8742c', accent: '#d9661f', paper: '#fbf8f1', ink: '#3c3220', metal: '#c8bfae', screen: '#8a5a2b' },
  kde: { folder: '#5bbcf0', folderDark: '#2d8bc9', accent: '#3daee9', paper: '#fcfcfc', ink: '#31363b', metal: '#c4c9cd', screen: '#2a80b9' },
};
const g = (id, a, b) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
let uid = 0;
const page = (p, extra = '') => `<path d="M7 3h13l6 6v20H7z" fill="${p.paper}" stroke="#8a94a6"/><path d="M20 3v6h6" fill="#dfe5ee" stroke="#8a94a6"/>${extra}`;
const lines = (c, ys) => ys.map(y => `<path d="M10 ${y}h12" stroke="${c}" stroke-width="1.4"/>`).join('');

const ICONS = {
  folder: p => { const i = 'f' + uid++; return `<defs>${g(i, p.folder, p.folderDark)}</defs><path d="M3 8a2 2 0 0 1 2-2h7l3 3h12a2 2 0 0 1 2 2v2H3z" fill="${p.folderDark}"/><path d="M3 12h26v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="url(#${i})" stroke="${p.folderDark}"/>`; },
  file: p => page(p),
  text: p => page(p, lines('#7b8798', [13, 16.5, 20, 23.5])),
  script: p => page(p, `<path d="M11 15l3 3-3 3M16 22h6" stroke="${p.accent}" stroke-width="1.8" fill="none" stroke-linecap="round"/>`),
  html: p => page(p, `<circle cx="16.5" cy="19" r="5.5" fill="none" stroke="${p.accent}" stroke-width="1.4"/><path d="M11 19h11M16.5 13.5c-3 3-3 8 0 11M16.5 13.5c3 3 3 8 0 11" stroke="${p.accent}" stroke-width="1.1" fill="none"/>`),
  image: p => `<rect x="4" y="6" width="24" height="20" rx="2" fill="${p.paper}" stroke="#8a94a6"/><rect x="6.5" y="8.5" width="19" height="15" fill="#8fc7f2"/><circle cx="21" cy="12.5" r="2.2" fill="#ffe37a"/><path d="M6.5 23.5l6-7 4 4.5 3-3 6 5.5z" fill="#4c9a52"/>`,
  music: p => page(p, `<path d="M14 23V14l8-2v9" stroke="${p.accent}" stroke-width="1.6" fill="none"/><circle cx="12.3" cy="23" r="2" fill="${p.accent}"/><circle cx="20.3" cy="21" r="2" fill="${p.accent}"/>`),
  app: p => `<rect x="4" y="6" width="24" height="20" rx="2" fill="${p.paper}" stroke="#6d7890"/><rect x="4" y="6" width="24" height="5" rx="2" fill="${p.accent}"/><rect x="8" y="14" width="16" height="2" fill="#b7c0cf"/><rect x="8" y="18" width="11" height="2" fill="#b7c0cf"/>`,
  computer: p => { const i = 'c' + uid++; return `<defs>${g(i, '#6fb1f5', p.screen)}</defs><rect x="4" y="5" width="24" height="17" rx="2" fill="${p.metal}" stroke="#6d7890"/><rect x="6.5" y="7.5" width="19" height="12" fill="url(#${i})"/><path d="M12 26h8l-1-4h-6z" fill="#9aa5b6"/><rect x="9" y="26" width="14" height="2" rx="1" fill="#6d7890"/>`; },
  drive: p => `<rect x="4" y="11" width="24" height="12" rx="2" fill="${p.metal}" stroke="#6d7890"/><rect x="7" y="17" width="12" height="2" fill="#7f8aa0"/><circle cx="24" cy="18" r="1.5" fill="#57d163"/>`,
  trash: p => `<path d="M9 10h14l-1.5 17h-11z" fill="${p.metal}" stroke="#6d7890"/><rect x="7" y="7" width="18" height="3" rx="1" fill="#8d98ab" stroke="#6d7890"/><rect x="13" y="5" width="6" height="2" fill="#6d7890"/><path d="M13 13v11M16 13v11M19 13v11" stroke="#7f8aa0"/>`,
  'trash-full': p => `<path d="M10 6l5 2-2 3zM18 4l5 3-4 3z" fill="${p.paper}" stroke="#8a94a6"/><path d="M9 10h14l-1.5 17h-11z" fill="${p.metal}" stroke="#6d7890"/><rect x="7" y="9" width="18" height="2.5" rx="1" fill="#8d98ab" stroke="#6d7890"/><path d="M13 14v10M16 14v10M19 14v10" stroke="#7f8aa0"/>`,
  terminal: () => `<rect x="3" y="5" width="26" height="22" rx="3" fill="#20242c" stroke="#59627a"/><path d="M8 12l4 3.5-4 3.5" stroke="#7ee787" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M14.5 20h8" stroke="#e6edf3" stroke-width="2" stroke-linecap="round"/>`,
  browser: p => { const i = 'b' + uid++; return `<defs><radialGradient id="${i}" cx=".35" cy=".3"><stop offset="0" stop-color="#9fd8ff"/><stop offset="1" stop-color="${p.accent}"/></radialGradient></defs><circle cx="16" cy="16" r="12" fill="url(#${i})" stroke="#2a4f8f"/><path d="M4 16h24M16 4c-5 4-5 20 0 24M16 4c5 4 5 20 0 24M6.5 9.5c5 2.5 14 2.5 19 0M6.5 22.5c5-2.5 14-2.5 19 0" stroke="#fff" stroke-opacity=".75" fill="none"/>`; },
  editor: p => `<rect x="6" y="5" width="20" height="24" rx="1.5" fill="${p.paper}" stroke="#7a8496"/><rect x="6" y="5" width="20" height="4" fill="#7cb8f0"/><path d="M10 3v4M14 3v4M18 3v4M22 3v4" stroke="#56627a" stroke-width="1.6" stroke-linecap="round"/>${lines('#8a94a6', [14, 18, 22])}`,
  calc: p => `<rect x="7" y="3" width="18" height="26" rx="2" fill="${p.metal}" stroke="#6d7890"/><rect x="10" y="6" width="12" height="5" fill="#cfeacb" stroke="#6d7890"/>${[0, 1, 2].map(r => [0, 1, 2].map(c => `<rect x="${10 + c * 4.5}" y="${14 + r * 4.5}" width="3" height="3" rx=".6" fill="${c === 2 ? p.accent : '#4b5568'}"/>`).join('')).join('')}`,
  mines: () => `<path d="M16 4v6M16 24v6M3 17h6M23 17h6M7 8l4 4M21 22l4 4M25 8l-4 4M11 22l-4 4" stroke="#8892a6" stroke-width="2.2" stroke-linecap="round"/><circle cx="16" cy="17" r="9" fill="#3b4252" stroke="#8892a6" stroke-width="1.2"/><circle cx="12.5" cy="13.5" r="2.4" fill="#fff" fill-opacity=".85"/>`,
  paint: () => `<path d="M16 4C8 4 3 9.5 3 16s5 11 11 11c2 0 3-1 3-2.5S16 22 17.5 21 22 21 25 20s4-4 4-6c0-6-5-10-13-10z" fill="#e9d3a7" stroke="#9a7b42"/><circle cx="10" cy="13" r="2.2" fill="#e5484d"/><circle cx="16" cy="9.5" r="2.2" fill="#f5c542"/><circle cx="22.5" cy="12.5" r="2.2" fill="#3b82f6"/><circle cx="9.5" cy="19.5" r="2.2" fill="#30a46c"/>`,
  settings: p => `<path d="M14 3h4l.8 3.4 2.4 1 3-1.8 2.8 2.8-1.8 3 1 2.4L29.6 14v4l-3.4.8-1 2.4 1.8 3-2.8 2.8-3-1.8-2.4 1L18 29.6h-4l-.8-3.4-2.4-1-3 1.8-2.8-2.8 1.8-3-1-2.4L2.4 18v-4l3.4-.8 1-2.4-1.8-3 2.8-2.8 3 1.8 2.4-1z" fill="${p.metal}" stroke="#5c6781"/><circle cx="16" cy="16" r="4.5" fill="#fff" stroke="#5c6781"/>`,
  taskmgr: () => `<rect x="3" y="5" width="26" height="22" rx="2" fill="#10151c" stroke="#59627a"/><path d="M5 20h4l2-7 3 11 3-14 3 10h7" stroke="#4ade80" stroke-width="1.6" fill="none" stroke-linejoin="round"/>`,
  info: () => `<circle cx="16" cy="16" r="13" fill="#3b82f6" stroke="#1e4fbf"/><rect x="14.3" y="13.5" width="3.4" height="10" rx="1" fill="#fff"/><circle cx="16" cy="9.5" r="2.1" fill="#fff"/>`,
  question: () => `<circle cx="16" cy="16" r="13" fill="#3b82f6" stroke="#1e4fbf"/><path d="M12 12.5a4 4 0 1 1 6 3.4c-1.4.9-2 1.6-2 3.1" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round"/><circle cx="16" cy="23.5" r="1.7" fill="#fff"/>`,
  warning: () => `<path d="M16 3l14 25H2z" fill="#f7c948" stroke="#a87b00" stroke-linejoin="round"/><rect x="14.5" y="11" width="3" height="9" rx="1" fill="#3a2f00"/><circle cx="16" cy="23.5" r="1.7" fill="#3a2f00"/>`,
  error: () => `<circle cx="16" cy="16" r="13" fill="#e5484d" stroke="#a11d22"/><path d="M11 11l10 10M21 11l-10 10" stroke="#fff" stroke-width="3" stroke-linecap="round"/>`,
  user: p => `<rect x="3" y="3" width="26" height="26" rx="4" fill="${p.accent}"/><circle cx="16" cy="13" r="5" fill="#fff"/><path d="M6.5 28c1-6 5-8.5 9.5-8.5s8.500 2.500 9.500 8.500z" fill="#fff"/>`,
  home: p => `<path d="M16 4L3 15h4v12h7v-8h4v8h7V15h4z" fill="${p.folder}" stroke="${p.folderDark}" stroke-linejoin="round"/>`,
  desktop: p => `<rect x="4" y="6" width="24" height="16" rx="2" fill="${p.screen}" stroke="#56627a"/><rect x="13" y="22" width="6" height="3" fill="#9aa5b6"/><rect x="9" y="25" width="14" height="2" rx="1" fill="#6d7890"/>`,
  network: p => `<rect x="12" y="4" width="8" height="7" rx="1" fill="${p.accent}"/><rect x="3" y="21" width="8" height="7" rx="1" fill="${p.accent}"/><rect x="21" y="21" width="8" height="7" rx="1" fill="${p.accent}"/><path d="M16 11v5M7 21v-5h18v5" stroke="#6d7890" stroke-width="1.6" fill="none"/>`,
  power: () => `<circle cx="16" cy="16" r="13" fill="#e5484d" stroke="#a11d22"/><path d="M16 8v8" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><path d="M11 11.5a7 7 0 1 0 10 0" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
  logout: () => `<circle cx="16" cy="16" r="13" fill="#f0a73a" stroke="#a86a10"/><path d="M12 10h-2v12h2M14 16h9M19.500 12l4 4-4 4" stroke="#fff" stroke-width="2.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  restart: () => `<circle cx="16" cy="16" r="13" fill="#30a46c" stroke="#1c6e45"/><path d="M22 12a7 7 0 1 0 1 6" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M23 7v5.500h-5.500" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  lock: () => `<rect x="7" y="14" width="18" height="13" rx="2" fill="#f0a73a" stroke="#a86a10"/><path d="M11 14v-3a5 5 0 0 1 10 0v3" stroke="#8a94a6" stroke-width="2.4" fill="none"/>`,
  search: () => `<circle cx="13.500" cy="13.500" r="7.500" fill="#dff0ff" stroke="#56627a" stroke-width="2.200"/><path d="M19 19l8 8" stroke="#56627a" stroke-width="3.400" stroke-linecap="round"/>`,
  run: p => `<rect x="3" y="8" width="26" height="16" rx="2" fill="${p.paper}" stroke="#6d7890"/><path d="M8 14l4 2-4 2z" fill="${p.accent}"/><path d="M15 19h9" stroke="#56627a" stroke-width="1.800"/>`,
  help: () => `<circle cx="16" cy="16" r="13" fill="#7c5cff" stroke="#4a34b8"/><path d="M12 12.500a4 4 0 1 1 6 3.400c-1.400.900-2 1.600-2 3.100" stroke="#fff" stroke-width="2.600" fill="none" stroke-linecap="round"/><circle cx="16" cy="23.500" r="1.700" fill="#fff"/>`,
  back: () => `<circle cx="16" cy="16" r="13" fill="#3fa34d" stroke="#226c2e"/><path d="M18.500 9.500l-7 6.500 7 6.500" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  forward: () => `<circle cx="16" cy="16" r="13" fill="#3fa34d" stroke="#226c2e"/><path d="M13.500 9.500l7 6.500-7 6.500" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  up: p => `<path d="M3 9a2 2 0 0 1 2-2h7l3 3h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="${p.folder}" stroke="${p.folderDark}"/><path d="M16 23v-9M11.500 17.500L16 13l4.500 4.500" stroke="#2c7a36" stroke-width="2.600" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  refresh: () => `<path d="M24 11a9 9 0 1 0 2 8" stroke="#2f8f46" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M26 5v7h-7" stroke="#2f8f46" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  stop: () => `<circle cx="16" cy="16" r="12" fill="#e5484d" stroke="#a11d22"/><path d="M11.500 11.500l9 9M20.500 11.500l-9 9" stroke="#fff" stroke-width="2.800" stroke-linecap="round"/>`,
  star: () => `<path d="M16 3l4 8.500 9 1.200-6.600 6.300 1.700 9L16 23.600 7.900 28l1.700-9L3 12.700l9-1.200z" fill="#f7c948" stroke="#a87b00" stroke-linejoin="round"/>`,
  sound: () => `<path d="M5 12h5l7-6v20l-7-6H5z" fill="#56627a"/><path d="M21 11a7 7 0 0 1 0 10M24.500 8a11 11 0 0 1 0 16" stroke="#56627a" stroke-width="2" fill="none" stroke-linecap="round"/>`,
  mute: () => `<path d="M5 12h5l7-6v20l-7-6H5z" fill="#56627a"/><path d="M21 12l7 8M28 12l-7 8" stroke="#e5484d" stroke-width="2.400" stroke-linecap="round"/>`,
  saver: () => `<rect x="3" y="5" width="26" height="19" rx="2" fill="#0b1020" stroke="#59627a"/><path d="M8 19V11h6v5h6v-6h5" stroke="#4ade80" stroke-width="2.600" fill="none" stroke-linejoin="round"/><circle cx="14" cy="11" r="1.900" fill="#f7c948"/><circle cx="20" cy="16" r="1.900" fill="#f472b6"/><rect x="11" y="26" width="10" height="2" rx="1" fill="#6d7890"/>`,
  leaf: () => `<path d="M6 26C5 13 12 5 27 5c0 14-7 21-17 21-1.400 0-2.800-.200-4 0z" fill="#86be43" stroke="#4d7f22" stroke-linejoin="round"/><path d="M6.500 26C11 19 16 14 23 9.500M13 19.500v-6M17.500 15.500h5.500" stroke="#fff" stroke-width="1.800" fill="none" stroke-linecap="round"/>`,
  gem: () => `<path d="M16 3l11 13-11 13L5 16z" fill="#fff" fill-opacity=".95"/><path d="M16 3l11 13H5z" fill="#fff"/><path d="M16 9l5 7-5 7-5-7z" fill="#2f7d32" fill-opacity=".55"/>`,
  pear: () => `<path d="M16 6c3 0 4.500 2.500 4.500 5 0 1.800 1.200 3 2.600 4.800C25 18.300 26 20.500 26 23c0 4-4.400 6-10 6s-10-2-10-6c0-2.500 1-4.700 2.900-7.200C10.300 14 11.500 12.800 11.500 11c0-2.500 1.500-5 4.500-5z" fill="currentColor"/><path d="M16 6.500c0-2 1-3.500 3-4" stroke="currentColor" stroke-width="1.800" fill="none" stroke-linecap="round"/>`,
  ring: () => `<circle cx="16" cy="16" r="13" fill="#e95420"/><path d="M9 18a7 7 0 0 1 14 0z" fill="#fff"/><rect x="7" y="20" width="18" height="2" rx="1" fill="#fff"/><rect x="11" y="24" width="10" height="2" rx="1" fill="#fff" opacity=".8"/><g stroke="#fff" stroke-width="1.600" stroke-linecap="round"><path d="M16 5.500v2.500M8.500 9l1.700 1.700M23.500 9l-1.700 1.700"/></g>`,
  cog: () => `<path d="M14 3h4l.8 3.400 2.400 1 3-1.800 2.800 2.800-1.800 3 1 2.400L29.600 14v4l-3.400.8-1 2.400 1.800 3-2.800 2.800-3-1.800-2.400 1L18 29.600h-4l-.8-3.400-2.400-1-3 1.800-2.800-2.800 1.800-3-1-2.400L2.400 18v-4l3.400-.8 1-2.400-1.800-3 2.800-2.800 3 1.800 2.400-1z" fill="#3daee9"/><path d="M13 11l8 5-8 5z" fill="#fff"/>`,
  grid: () => `${[0, 1, 2].map(r => [0, 1, 2].map(c => `<rect x="${5 + c * 8}" y="${5 + r * 8}" width="6" height="6" rx="1.500" fill="currentColor"/>`).join('')).join('')}`,
  finder: p => `<rect x="3" y="3" width="26" height="26" rx="6" fill="${p.accent}"/><path d="M8 13a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2z" fill="#fff"/>`,
  launch: () => `<rect x="3" y="3" width="26" height="26" rx="6" fill="#8a8f98"/>${[0, 1, 2].map(r => [0, 1, 2].map(c => `<rect x="${7.500 + c * 6.500}" y="${7.500 + r * 6.500}" width="4.500" height="4.500" rx="1.200" fill="${['#ff5f57', '#febc2e', '#28c840', '#4aa3ff', '#b48cff', '#ff8fc7', '#5fd0c5', '#f5f5f5', '#ffa64d'][r * 3 + c]}"/>`).join('')).join('')}`,
  wifi: () => `<path d="M4 13a17 17 0 0 1 24 0M8 17.500a11.500 11.500 0 0 1 16 0M12 22a6 6 0 0 1 8 0" stroke="currentColor" stroke-width="2.600" fill="none" stroke-linecap="round"/><circle cx="16" cy="26" r="2" fill="currentColor"/>`,
  battery: () => `<rect x="3" y="10" width="23" height="12" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><rect x="6" y="13" width="14" height="6" rx="1" fill="currentColor"/><rect x="27" y="13.500" width="2.500" height="5" rx="1" fill="currentColor"/>`,
  toggles: () => `<rect x="4" y="7" width="24" height="7" rx="3.500" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="21.500" cy="10.500" r="2.200" fill="currentColor"/><rect x="4" y="18" width="24" height="7" rx="3.500" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="10.500" cy="21.500" r="2.200" fill="currentColor"/>`,
  dos: () => `<rect x="3" y="5" width="26" height="22" rx="2" fill="#000" stroke="#8a94a6"/><text x="6" y="19" font-family="monospace" font-size="9" font-weight="700" fill="#d0d0d0">C:\\&gt;_</text>`,
  disk: () => `<rect x="4" y="4" width="24" height="24" rx="2" fill="#3b4a6b" stroke="#232d44"/><rect x="9" y="4" width="14" height="9" fill="#cfd6e3"/><rect x="18" y="5.500" width="3" height="6" fill="#3b4a6b"/><rect x="8" y="17" width="16" height="11" fill="#f4f6f8"/>`,
  new: p => page(p, `<path d="M16.500 13v9M12 17.500h9" stroke="#30a46c" stroke-width="2.400" stroke-linecap="round"/>`),
  clock: () => `<circle cx="16" cy="16" r="12" fill="#fff" stroke="#56627a" stroke-width="2"/><path d="M16 9v7.500l5 3" stroke="#33415c" stroke-width="2.200" fill="none" stroke-linecap="round"/>`,
};

export function iconSvg(name, theme = 'xp', size = 32) {
  const f = ICONS[name] || ICONS.file;
  return `<svg class="ico" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true">${f(P[theme] || P.xp)}</svg>`;
}
export function icon(name, theme, size) {
  const t = document.createElement('template');
  t.innerHTML = iconSvg(name, theme, size);
  return t.content.firstChild;
}
export const iconNames = () => Object.keys(ICONS);

const EXT_ICON = { txt: 'text', md: 'text', log: 'text', ini: 'text', cfg: 'text', conf: 'text', json: 'text', csv: 'text', c: 'text', h: 'text', py: 'script', js: 'script', sh: 'script', bat: 'script', cmd: 'script', vim: 'script', html: 'html', htm: 'html', url: 'browser', svg: 'image', png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', bmp: 'image', mp3: 'music', wav: 'music', ogg: 'music', exe: 'app', lnk: 'app', desktop: 'app' };
export function iconFor(name, node) {
  if (node && node.t === 'd') return 'folder';
  const m = /\.([^.]+)$/.exec(name);
  return (m && EXT_ICON[m[1].toLowerCase()]) || 'file';
}
