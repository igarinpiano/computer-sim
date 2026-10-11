// Text-mode DOS style machine: a POST screen followed by a full-screen command prompt.

import { h, sleep } from '../core/util.js';
import { store } from '../core/storage.js';
import { sound } from '../core/sound.js';
import { VFS } from '../core/vfs.js';
import { Terminal } from '../term/terminal.js';
import { Cmd } from '../term/cmd.js';
import { dosSeed } from './seeds.js';
import '../term/tui.js';

export class Dos {
  constructor(mount, onExit) {
    this.id = 'dos'; this.onExit = onExit; this.bootTime = Date.now();
    this.fs = new VFS({ storeKey: 'dos:fs', ci: true, perms: false, user: 'root', seed: dosSeed, version: 1 });
    this.root = h('div', { class: 'machine os-dos' });
    mount.append(this.root);
    this._unload = e => { if (this.running) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', this._unload);
  }
  async start({ fast = false } = {}) {
    const tint = store.get('dos:tint', 'white');
    const host = h('div', { class: 'dos-screen tint-' + tint });
    const bar = h('div', { class: 'dos-bar' }, h('span', null, 'DOS 風マシン ／ 非公式シミュレータ'),
      h('span', { class: 'dos-bar-btns' },
        h('button', { type: 'button', onClick: () => { const order = ['white', 'green', 'amber'], n = order[(order.indexOf(host.className.replace(/.*tint-/, '')) + 1) % 3]; host.className = 'dos-screen tint-' + n; store.set('dos:tint', n); term.focus(); } }, '画面の色'),
        h('button', { type: 'button', onClick: () => this.power('poweroff') }, '電源を切る')));
    this.root.append(bar, host, h('div', { class: 'dos-scan' }));
    const term = this.term = new Terminal(host, { class: 'term-dos', palette: ['#000000', '#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500', '#aaaaaa', '#555555', '#5555ff', '#55ff55', '#55ffff', '#ff5555', '#ff55ff', '#ffff55', '#ffffff'] });
    term.onBell = () => sound.fx('beep');
    host.addEventListener('pointerdown', () => { sound.unlock(); setTimeout(() => term.focus(), 0); });
    term.focus();
    this.running = true;
    let skip = fast;
    const pop = term.pushHandler(() => { skip = true; sound.unlock(); return true; });
    const wait = ms => (skip ? Promise.resolve() : sleep(ms));
    term.cursorOn = false;
    term.write('WebBIOS v1.02  (C) 2026 Computer Sim Project\n\nMain Processor : JavaScript Virtual 486DX2-66\nMemory Testing : ');
    for (let k = 0; k <= 8192; k += 512) { term.write(`\rMemory Testing : ${String(k).padStart(5)}K OK`); await wait(45); }
    term.write('\n\nDetecting IDE Primary Master ... LOCALSTORAGE-HD 100MB\nDetecting IDE Primary Slave  ... None\n');
    await wait(500);
    sound.fx('beep');
    term.write('\nStarting DOS...\n\n');
    await wait(700);
    term.write('HIMEM is testing extended memory...'); await wait(500); term.write('done.\n\nC:\\>C:\\DOS\\SMARTDRV.EXE /X\n');
    await wait(300);
    term.write('\nREADME.TXT に使い方があります (TYPE README.TXT)。EXIT で電源を切ります。\n');
    pop(); term.cursorOn = true;
    const sh = new Cmd({ term, fs: this.fs, os: this, dos: true, home: '/', host: 'DOS-PC', user: 'USER' });
    await sh.run();
    this.power('poweroff');
  }
  notify() { }
  async power(kind) {
    if (this.off) return;
    this.off = true; this.running = false;
    this.fs.save();
    this.root.classList.add('crt-off');
    await sleep(650);
    window.removeEventListener('beforeunload', this._unload);
    this.onExit(kind);
  }
}
