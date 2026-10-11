// System, network, package-management and novelty commands for the bash shell.

import { strftime, tzName, evalArith, pad2, pick, strWidth } from '../core/util.js';
import { errMsg, basename, join } from '../core/vfs.js';
import { def, getopt, commands, UsageError, lines, inputs, human } from './coreutils.js';

const INFO = { name: 'Linux Mint', version: '21.3', codename: 'Virginia', kernel: '5.15.0-91-generic', de: 'Cinnamon 6.0.4', base: 'jammy' };
const info = ctx => ({ ...INFO, ...(ctx.os.info || {}) });
const boot = ctx => ctx.os.bootTime || ctx.sh.started;
const mem = () => { const total = ((typeof navigator !== 'undefined' && navigator.deviceMemory) || 8) * 1024 * 1024; const used = Math.round(total * 0.31 + (Date.now() % 60000) * 3); return { total, used, free: Math.round(total * 0.22), cache: Math.round(total * 0.44) }; };
const ncpu = () => (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4;
const upStr = ms => { const m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24); return d ? `${d} day${d > 1 ? 's' : ''}, ${h % 24}:${pad2(m % 60)}` : h ? `${h}:${pad2(m % 60)}` : `${m} min`; };

// ---------------------------------------------------------------- identity & time
def('date', ctx => {
  const a = ctx.args;
  let d = new Date(), fmt = '%a %b %e %I:%M:%S %p %Z %Y', utc = false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '-u' || a[i] === '--utc') utc = true;
    else if (a[i] === '-d' || a[i] === '--date') { const s = a[++i] || ''; d = /^@\d+$/.test(s) ? new Date(+s.slice(1) * 1000) : s === 'yesterday' ? new Date(Date.now() - 864e5) : s === 'tomorrow' ? new Date(Date.now() + 864e5) : new Date(s); if (Number.isNaN(+d)) { ctx.err(`date: invalid date ‘${s}’\n`); return 1; } }
    else if (a[i].startsWith('--date=')) d = new Date(a[i].slice(7));
    else if (a[i] === '-I' || a[i] === '--iso-8601') fmt = '%F';
    else if (a[i] === '-R') fmt = '%a, %d %b %Y %T %z';
    else if (a[i][0] === '+') fmt = a[i].slice(1);
    else if (a[i] === '-s') { ctx.err('date: cannot set date: Operation not permitted\n'); return 1; }
    else throw new UsageError(`invalid date ‘${a[i]}’`);
  }
  if (utc) { d = new Date(d.getTime() + d.getTimezoneOffset() * 60000); fmt = fmt.replace(/%Z/g, 'UTC').replace(/%z/g, '+0000'); }
  ctx.out(strftime(fmt, d) + '\n');
}, { usage: 'date [OPTION]... [+FORMAT]', desc: 'Display the current time in the given FORMAT.\n  -u  UTC   -d STRING  display time described by STRING   -I  ISO 8601   +%Y-%m-%d %H:%M:%S ...' });

def('cal ncal', ctx => {
  const now = new Date(), n = ctx.args.filter(a => !a.startsWith('-')).map(Number);
  const month = (y, m) => {
    const title = new Date(y, m, 1).toLocaleString('en-US', { month: 'long' }) + ' ' + y;
    const out = [' '.repeat(Math.max(0, Math.floor((20 - title.length) / 2))) + title, 'Su Mo Tu We Th Fr Sa'];
    let line = '   '.repeat(new Date(y, m, 1).getDay());
    const days = new Date(y, m + 1, 0).getDate();
    for (let d = 1; d <= days; d++) {
      const s = String(d).padStart(2);
      line += (y === now.getFullYear() && m === now.getMonth() && d === now.getDate() && ctx.tty ? `\x1b[7m${s}\x1b[0m` : s) + ' ';
      if (new Date(y, m, d).getDay() === 6 || d === days) { out.push(line.replace(/ $/, '')); line = ''; }
    }
    while (out.length < 8) out.push('');
    return out;
  };
  const vis = s => s.replace(/\x1b\[\d*m/g, '').length;
  const row = ms => { const cols = ms.map(([y, m]) => month(y, m)); for (let r = 0; r < 8; r++) ctx.out(cols.map(c => c[r] + ' '.repeat(Math.max(0, 20 - vis(c[r])))).join('  ').replace(/\s+$/, '') + '\n'); };
  if (n.length === 1 && n[0] > 12 || ctx.args.includes('-y')) {
    const y = n[0] || now.getFullYear();
    ctx.out(' '.repeat(29) + y + '\n');
    for (let q = 0; q < 4; q++) row([0, 1, 2].map(k => [y, q * 3 + k]));
  } else if (ctx.args.includes('-3')) { const y = now.getFullYear(), m = now.getMonth(); row([-1, 0, 1].map(k => { const d = new Date(y, m + k, 1); return [d.getFullYear(), d.getMonth()]; })); }
  else row([[n[1] ?? now.getFullYear(), n.length ? n[0] - 1 : now.getMonth()]]);
}, { usage: 'cal [-3y] [[month] year]', desc: 'Display a calendar.' });

def('whoami', ctx => ctx.out(ctx.user + '\n'), { usage: 'whoami', desc: 'Print the user name associated with the current effective user ID.' });
def('logname', ctx => ctx.out(ctx.sh.users[0]?.user || ctx.user + '\n'), { usage: 'logname', desc: "Print the user's login name." });
def('id', ctx => {
  const u = ctx.args.find(a => !a.startsWith('-')) || ctx.user;
  if (u !== 'root' && !ctx.fs.isDir('/home/' + u)) { ctx.err(`id: ‘${u}’: no such user\n`); return 1; }
  const uid = u === 'root' ? 0 : 1000;
  if (ctx.args.includes('-u')) return void ctx.out((ctx.args.includes('-n') ? u : uid) + '\n');
  if (ctx.args.includes('-g')) return void ctx.out((ctx.args.includes('-n') ? u : uid) + '\n');
  ctx.out(uid ? `uid=1000(${u}) gid=1000(${u}) groups=1000(${u}),4(adm),24(cdrom),27(sudo),30(dip),46(plugdev),115(lpadmin),136(sambashare)\n` : 'uid=0(root) gid=0(root) groups=0(root)\n');
}, { usage: 'id [OPTION]... [USER]', desc: 'Print user and group information for the specified USER.' });
def('groups', ctx => ctx.out(ctx.user === 'root' ? 'root\n' : `${ctx.user} adm cdrom sudo dip plugdev lpadmin sambashare\n`), { usage: 'groups [USER]', desc: 'Print group memberships.' });
def('hostname', ctx => {
  if (ctx.args[0] === '-I' || ctx.args[0] === '-i') return void ctx.out(ctx.args[0] === '-I' ? '192.168.1.42 \n' : '127.0.1.1\n');
  if (ctx.args.length && !ctx.args[0].startsWith('-')) { if (ctx.user !== 'root') { ctx.err('hostname: you must be root to change the host name\n'); return 1; } ctx.sh.host = ctx.args[0]; ctx.sh.set('HOSTNAME', ctx.args[0]); try { ctx.fs.write('/etc/hostname', ctx.args[0] + '\n'); } catch { /* ignore */ } return 0; }
  ctx.out(ctx.sh.host + '\n');
}, { usage: 'hostname [-iI] [name]', desc: 'Show or set the system host name.' });
def('uname', ctx => {
  const f = ctx.args.join('').replace(/-/g, ''), i = info(ctx);
  const parts = { s: 'Linux', n: ctx.sh.host, r: i.kernel, v: '#101-Ubuntu SMP Tue Nov 14 13:30:08 UTC 2023', m: 'x86_64', p: 'x86_64', i: 'x86_64', o: 'GNU/Linux' };
  const want = !f ? 's' : f.includes('a') || ctx.args.includes('--all') ? 'snrvmpio' : f;
  ctx.out([...'snrvmpio'].filter(k => want.includes(k)).map(k => parts[k]).join(' ') + '\n');
}, { usage: 'uname [OPTION]...', desc: 'Print certain system information.\n  -a all  -s kernel name  -n node name  -r kernel release  -m machine' });
def('arch', ctx => ctx.out('x86_64\n'), { usage: 'arch', desc: 'Print machine hardware name.' });
def('nproc', ctx => ctx.out(ncpu() + '\n'), { usage: 'nproc', desc: 'Print the number of processing units available.' });
def('tty', ctx => ctx.out('/dev/pts/0\n'), { usage: 'tty', desc: 'Print the file name of the terminal connected to standard input.' });
def('uptime', ctx => {
  const up = Date.now() - boot(ctx);
  if (ctx.args.includes('-p')) return void ctx.out(`up ${Math.floor(up / 60000)} minutes\n`);
  if (ctx.args.includes('-s')) return void ctx.out(strftime('%F %T', new Date(boot(ctx))) + '\n');
  ctx.out(` ${strftime('%T')} up ${upStr(up)},  1 user,  load average: ${(0.2 + Math.random() * 0.4).toFixed(2)}, ${(0.3 + Math.random() * 0.2).toFixed(2)}, 0.${Math.floor(20 + Math.random() * 20)}\n`);
}, { usage: 'uptime [options]', desc: 'Tell how long the system has been running.' });
def('w who', ctx => {
  const t = strftime(ctx.name === 'w' ? '%H:%M' : '%F %H:%M', new Date(boot(ctx)));
  if (ctx.name === 'who') return void ctx.out(`${ctx.sh.users[0]?.user || ctx.user}     tty7         ${t} (:0)\n`);
  ctx.out(` ${strftime('%T')} up ${upStr(Date.now() - boot(ctx))},  1 user,  load average: 0.31, 0.42, 0.35\nUSER     TTY      FROM             LOGIN@   IDLE   JCPU   PCPU WHAT\n${(ctx.sh.users[0]?.user || ctx.user).padEnd(8)} tty7     :0               ${t}    ${upStr(Date.now() - boot(ctx)).padEnd(6)} 12.40s  0.31s cinnamon-session --session cinnamon\n`);
}, { usage: 'w [user]', desc: 'Show who is logged on and what they are doing.' });

def('env printenv', async ctx => {
  if (ctx.name === 'printenv' && ctx.args.length) { let st = 0; for (const k of ctx.args) { if (k in ctx.env) ctx.out(ctx.env[k] + '\n'); else st = 1; } return st; }
  const a = [...ctx.args], set = [];
  while (a.length && (/^[A-Za-z_]\w*=/.test(a[0]) || a[0] === '-i' || a[0] === '-')) { const x = a.shift(); if (x.includes('=')) set.push(x); }
  if (!a.length) { for (const [k, v] of Object.entries(ctx.env)) ctx.out(`${k}=${v}\n`); for (const s of set) ctx.out(s + '\n'); return 0; }
  return ctx.exec(set.map(s => s.replace(/=(.*)$/s, (m, v) => `='${v.replace(/'/g, "'\\''")}'`)).join(' ') + ' ' + a.map(x => `'${x.replace(/'/g, "'\\''")}'`).join(' '));
}, { usage: 'env [NAME=VALUE]... [COMMAND [ARG]...]', desc: 'Set each NAME to VALUE in the environment and run COMMAND.' });

const binPath = (ctx, n) => (commands[n].sbin ? '/usr/sbin/' : commands[n].games ? '/usr/games/' : '/usr/bin/') + n;
def('which', ctx => {
  let st = 0;
  for (const n of ctx.args.filter(a => !a.startsWith('-'))) {
    if (ctx.sh.hasCmd(n)) ctx.out(binPath(ctx, n) + '\n');
    else if (['bash', 'sh', 'sudo', 'su', 'echo', 'printf', 'test', 'kill', 'pwd', 'time'].includes(n)) ctx.out(`/usr/bin/${n}\n`);
    else { const p = ctx.env.PATH.split(':').map(d => join(d, n)).find(p => { const x = ctx.fs.stat(ctx.path(p)); return x && x.t === 'f' && x.m & 0o111; }); if (p) ctx.out(p + '\n'); else st = 1; }
  }
  return st;
}, { usage: 'which [-a] filename ...', desc: 'Locate a command.' });
def('whereis', ctx => { for (const n of ctx.args.filter(a => !a.startsWith('-'))) ctx.out(`${n}:${ctx.sh.hasCmd(n) ? ` ${binPath(ctx, n)} /usr/share/man/man1/${n}.1.gz` : ''}\n`); }, { usage: 'whereis [options] name...', desc: 'Locate the binary, source, and manual page files for a command.' });

function manPage(name) {
  const c = commands[name];
  if (!c || !c.usage) return null;
  const [first, ...more] = (c.desc || '').split('\n');
  const head = `${name.toUpperCase()}(1)`, mid = 'User Commands';
  const ind = s => s.split('\n').map(l => (l ? '       ' + l : '')).join('\n');
  return `${head}${' '.repeat(Math.max(1, Math.floor((78 - head.length * 2 - mid.length) / 2)))}${mid}${' '.repeat(Math.max(1, Math.ceil((78 - head.length * 2 - mid.length) / 2)))}${head}\n\n` +
    `\x1b[1mNAME\x1b[0m\n       ${name} - ${first.replace(/\.$/, '').replace(/^./, x => x.toLowerCase())}\n\n\x1b[1mSYNOPSIS\x1b[0m\n${ind(c.usage)}\n\n\x1b[1mDESCRIPTION\x1b[0m\n${ind(first + (more.length ? '\n\n' + more.join('\n') : ''))}\n\n` +
    `\x1b[1mNOTES\x1b[0m\n       This is the condensed manual shipped with the browser sandbox.\n\n\x1b[1mSEE ALSO\x1b[0m\n       help(1), bash(1)\n\nGNU coreutils 8.32${' '.repeat(22)}September 2023${' '.repeat(Math.max(1, 78 - 53 - head.length))}${head}\n`;
}
def('man', async ctx => {
  const names = ctx.args.filter(a => !/^(-|\d$)/.test(a));
  if (ctx.args[0] === '-k') return ctx.run(['apropos', ...ctx.args.slice(1)]);
  if (!names.length) { ctx.err("What manual page do you want?\nFor example, try 'man man'.\n"); return 1; }
  let st = 0;
  for (const n of names) {
    const page = ctx.sh.hasCmd(n) ? manPage(n) : null;
    if (!page) { ctx.err(`No manual entry for ${n}\n`); st = 16; continue; }
    if (ctx.tty && commands.less) await commands.less.fn({ ...withoutStdin(ctx), args: ['-R'], pagerText: page, pagerTitle: ` Manual page ${n}(1)` });
    else ctx.out(page.replace(/\x1b\[\d*m/g, ''));
  }
  return st;
}, { usage: 'man [SECTION] PAGE...', desc: 'An interface to the system reference manuals.' });
// Copies a ctx without touching the lazy stdin getter.
function withoutStdin(ctx) { const o = {}; for (const k of Object.keys(ctx)) if (k !== 'stdin') Object.defineProperty(o, k, Object.getOwnPropertyDescriptor(ctx, k)); return o; }
def('whatis apropos', ctx => {
  const q = ctx.args.filter(a => !a.startsWith('-'));
  if (!q.length) { ctx.err(`${ctx.name} what?\n`); return 1; }
  let st = 16;
  for (const k of Object.keys(commands).sort()) {
    const c = commands[k];
    if (!c.usage || !ctx.sh.hasCmd(k)) continue;
    if (ctx.name === 'whatis' ? q.includes(k) : q.some(x => k.includes(x) || (c.desc || '').toLowerCase().includes(x.toLowerCase()))) { ctx.out(`${(k + ' (1)').padEnd(20)} - ${c.desc.split('\n')[0].replace(/\.$/, '')}\n`); st = 0; }
  }
  if (st) ctx.err(`${q[0]}: nothing appropriate.\n`);
  return st;
}, { usage: 'whatis NAME... | apropos KEYWORD...', desc: 'Search the manual page names and descriptions.' });

def('clear reset', ctx => { ctx.term.clear(); }, { usage: 'clear', desc: 'Clear the terminal screen.' });

// ---------------------------------------------------------------- processes & hardware
const BASE_PROCS = [
  [1, 'root', '/sbin/init splash', 0.0, 0.1], [2, 'root', '[kthreadd]', 0, 0], [14, 'root', '[rcu_sched]', 0, 0], [412, 'root', '/lib/systemd/systemd-journald', 0, 0.3],
  [455, 'root', '/lib/systemd/systemd-udevd', 0, 0.1], [812, 'root', '/usr/sbin/NetworkManager --no-daemon', 0, 0.2], [840, 'root', '/usr/sbin/cupsd -l', 0, 0.1],
  [901, 'root', '/usr/sbin/lightdm', 0, 0.1], [955, 'root', '/usr/lib/xorg/Xorg -core :0 -seat seat0 -auth /var/run/lightdm/root/:0 -nolisten tcp vt7', 1.2, 1.4],
  [1320, 'user', '/lib/systemd/systemd --user', 0, 0.1], [1344, 'user', 'cinnamon-session --session cinnamon', 0, 0.4], [1502, 'user', '/usr/bin/pulseaudio --daemonize=no', 0.1, 0.2],
  [1588, 'user', 'cinnamon --replace', 2.1, 3.8], [1640, 'user', 'nemo-desktop', 0.1, 0.9], [1702, 'user', '/usr/libexec/gvfsd', 0, 0.1],
];
export function procList(ctx) {
  const base = BASE_PROCS.map(([pid, user, cmd, cpu, m]) => ({ pid, user, cmd, cpu, mem: m, tty: '?' }));
  const apps = ctx.os.procs ? ctx.os.procs() : [];
  return [...base, ...apps.map(p => ({ tty: '?', cpu: 0.3, mem: 1.2, ...p })), { pid: ctx.sh.pid, user: ctx.sh.users[0]?.user || ctx.user, cmd: 'bash', cpu: 0, mem: 0.1, tty: 'pts/0' }];
}
def('ps', ctx => {
  const f = ctx.args.join(' '), all = /a|e|A/.test(f.replace(/-/g, '')), procs = procList(ctx);
  const self = { pid: ctx.sh.pid + 40 + Math.floor(Math.random() * 20), user: ctx.user, cmd: 'ps ' + f, cpu: 0, mem: 0, tty: 'pts/0' };
  const list = all ? [...procs, self] : [...procs.filter(p => p.tty === 'pts/0'), self];
  const m = mem().total, st = strftime('%H:%M', new Date(boot(ctx)));
  if (/u/.test(f) && !/-e?f/.test(f)) {
    ctx.out('USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND\n');
    for (const p of list) ctx.out(`${p.user.padEnd(8)} ${String(p.pid).padStart(7)} ${p.cpu.toFixed(1).padStart(4)} ${p.mem.toFixed(1).padStart(4)} ${String(Math.round(p.mem * m / 30 + 9000)).padStart(6)} ${String(Math.round(p.mem * m / 100)).padStart(5)} ${p.tty.padEnd(8)} ${p.cmd[0] === '[' ? 'I<  ' : p.tty === '?' ? 'Ssl ' : p === self ? 'R+  ' : 'Ss  '} ${st}   0:0${Math.floor(p.cpu)} ${p.cmd}`.slice(0, ctx.tty ? ctx.cols : 999) + '\n');
  } else if (/f/.test(f)) {
    ctx.out('UID          PID    PPID  C STIME TTY          TIME CMD\n');
    for (const p of list) ctx.out(`${p.user.padEnd(8)} ${String(p.pid).padStart(7)} ${String(p.pid < 3 ? 0 : p.tty === 'pts/0' ? (p === self ? ctx.sh.pid : ctx.sh.pid - 7) : p.user === 'root' ? 1 : 1320).padStart(7)}  0 ${st} ${p.tty.padEnd(8)} 00:00:0${Math.floor(p.cpu)} ${p.cmd}\n`);
  } else {
    ctx.out('    PID TTY          TIME CMD\n');
    for (const p of list) ctx.out(`${String(p.pid).padStart(7)} ${p.tty.padEnd(8)} 00:00:0${Math.floor(p.cpu)} ${p.cmd.split(' ')[0].replace(/^.*\//, '')}\n`);
  }
}, { usage: 'ps [options]', desc: 'Report a snapshot of the current processes.\n  aux  every process, user-oriented   -ef  every process, full format' });
def('pgrep pidof', ctx => { const q = ctx.args.find(a => !a.startsWith('-')); const hits = procList(ctx).filter(p => q && basename(p.cmd.split(' ')[0]).includes(q)); ctx.out(hits.map(p => p.pid).join(ctx.name === 'pidof' ? ' ' : '\n') + (hits.length ? '\n' : '')); return hits.length ? 0 : 1; }, { usage: 'pgrep PATTERN', desc: 'Look up processes based on name.' });
def('pkill killall', ctx => {
  const q = ctx.args.find(a => !a.startsWith('-'));
  const hits = procList(ctx).filter(p => q && basename(p.cmd.split(' ')[0]).includes(q));
  if (!hits.length) { if (ctx.name === 'killall') ctx.err(`${q}: no process found\n`); return 1; }
  for (const p of hits) { if (p.kill) p.kill(); else if (ctx.user !== 'root') ctx.err(`${ctx.name}: killing pid ${p.pid} failed: Operation not permitted\n`); }
}, { usage: 'pkill PATTERN | killall NAME', desc: 'Signal processes based on name.' });

def('free', ctx => {
  const m = mem(), h = ctx.args.some(a => /h/.test(a)), mb = ctx.args.includes('-m');
  const f = kb => (h ? human(kb * 1024).replace(/([KMG])$/, '$1i') : mb ? String(Math.round(kb / 1024)) : String(kb)).padStart(11);
  ctx.out(`               total        used        free      shared  buff/cache   available\nMem:    ${f(m.total)} ${f(m.used)} ${f(m.free)} ${f(184320)} ${f(m.cache)} ${f(m.total - m.used - 300000)}\nSwap:   ${f(2097148)} ${f(0)} ${f(2097148)}\n`);
}, { usage: 'free [options]', desc: 'Display amount of free and used memory in the system.\n  -h  human readable   -m  mebibytes' });
def('df', ctx => {
  const h = ctx.args.some(a => /^-\w*h/.test(a)), used = 9412300 + Math.round(ctx.fs.du(ctx.fs.root) / 1024);
  const rows = [['udev', 3982144, 0, '/dev'], ['tmpfs', 803216, 1692, '/run'], ['/dev/sda2', 51290592, used, '/'], ['tmpfs', 4016068, 0, '/dev/shm'], ['tmpfs', 5120, 4, '/run/lock'], ['/dev/sda1', 523248, 6220, '/boot/efi'], ['tmpfs', 803212, 112, '/run/user/1000']];
  const f = kb => (h ? human(kb * 1024) : String(kb));
  ctx.out(h ? 'Filesystem      Size  Used Avail Use% Mounted on\n' : 'Filesystem     1K-blocks    Used Available Use% Mounted on\n');
  for (const [fsn, size, u, mnt] of rows) ctx.out(`${fsn.padEnd(14)} ${f(size).padStart(h ? 5 : 9)} ${f(u).padStart(h ? 5 : 7)} ${f(size - u).padStart(h ? 5 : 9)} ${String(Math.ceil((u / size) * 100)).padStart(3)}% ${mnt}\n`);
}, { usage: 'df [OPTION]... [FILE]...', desc: 'Show information about the file system on which each FILE resides.\n  -h  print sizes in powers of 1024' });
def('lsblk', ctx => ctx.out('NAME   MAJ:MIN RM  SIZE RO TYPE MOUNTPOINTS\nsda      8:0    0   50G  0 disk \n├─sda1   8:1    0  512M  0 part /boot/efi\n└─sda2   8:2    0 49.5G  0 part /\nsr0     11:0    1 1024M  0 rom  \n'), { usage: 'lsblk [options] [device...]', desc: 'List information about block devices.' });
def('mount', ctx => { if (ctx.args.length) { ctx.err(ctx.user === 'root' ? `mount: ${ctx.args.at(-1)}: can't find in /etc/fstab.\n` : 'mount: only root can do that\n'); return 1; } ctx.out('sysfs on /sys type sysfs (rw,nosuid,nodev,noexec,relatime)\nproc on /proc type proc (rw,nosuid,nodev,noexec,relatime)\nudev on /dev type devtmpfs (rw,nosuid,relatime,size=3982144k,mode=755)\n/dev/sda2 on / type ext4 (rw,relatime,errors=remount-ro)\n/dev/sda1 on /boot/efi type vfat (rw,relatime,fmask=0077,dmask=0077)\ntmpfs on /run/user/1000 type tmpfs (rw,nosuid,nodev,relatime,mode=700,uid=1000,gid=1000)\n'); }, { usage: 'mount [options] [device] [dir]', desc: 'Mount a filesystem.' });
def('lscpu', ctx => ctx.out(`Architecture:                    x86_64\nCPU op-mode(s):                  32-bit, 64-bit\nAddress sizes:                   39 bits physical, 48 bits virtual\nByte Order:                      Little Endian\nCPU(s):                          ${ncpu()}\nOn-line CPU(s) list:             0-${ncpu() - 1}\nVendor ID:                       GenuineBrowser\nModel name:                      JavaScript Virtual CPU @ 3.00GHz\nThread(s) per core:              2\nCore(s) per socket:              ${Math.max(1, ncpu() / 2)}\nSocket(s):                       1\nCPU max MHz:                     3000.0000\nVirtualization:                  VT-x\nL1d cache:                       192 KiB\nL2 cache:                        5 MiB\nL3 cache:                        12 MiB\n`), { usage: 'lscpu', desc: 'Display information about the CPU architecture.' });
def('lsusb', ctx => ctx.out('Bus 002 Device 001: ID 1d6b:0003 Linux Foundation 3.0 root hub\nBus 001 Device 003: ID 046d:c077 Generic USB Optical Mouse\nBus 001 Device 002: ID 04f2:0833 Generic USB Keyboard\nBus 001 Device 001: ID 1d6b:0002 Linux Foundation 2.0 root hub\n'), { usage: 'lsusb', desc: 'List USB devices.' });
def('lspci', ctx => ctx.out('00:00.0 Host bridge: Browser Virtual Host Bridge\n00:02.0 VGA compatible controller: WebGL Virtual Graphics Adapter\n00:14.0 USB controller: Virtual xHCI Host Controller\n00:17.0 SATA controller: Virtual AHCI Controller\n00:1f.3 Audio device: Web Audio Virtual Sound Card\n02:00.0 Ethernet controller: Fetch API Gigabit Network Connection\n'), { usage: 'lspci', desc: 'List all PCI devices.' });
def('lsb_release', ctx => {
  const i = info(ctx), f = ctx.args.join('');
  const rows = [['i', 'Distributor ID', 'Linuxmint'], ['d', 'Description', `${i.name} ${i.version}`], ['r', 'Release', i.version], ['c', 'Codename', i.codename.toLowerCase()]];
  if (!f) return void ctx.out('No LSB modules are available.\n');
  if (f.includes('a')) ctx.out('No LSB modules are available.\n');
  for (const [k, label, v] of rows) if (f.includes('a') || f.includes(k)) ctx.out(f.includes('s') ? v + '\n' : `${label}:\t${v}\n`);
}, { usage: 'lsb_release [options]', desc: 'Print distribution-specific information.\n  -a  all   -d description   -r release   -c codename   -s short' });
def('hostnamectl', ctx => { const i = info(ctx); ctx.out(` Static hostname: ${ctx.sh.host}\n       Icon name: computer-vm\n         Chassis: vm\n      Machine ID: 3f6c2a1e9b7d4c0f8a5e1d2b3c4f5a6b\n         Boot ID: 9a8b7c6d5e4f40312a1b0c9d8e7f6a5b\n  Virtualization: browser\nOperating System: ${i.name} ${i.version}\n          Kernel: Linux ${i.kernel}\n    Architecture: x86-64\n`); }, { usage: 'hostnamectl', desc: 'Query or change the system hostname.' });
def('dmesg', ctx => {
  if (ctx.user !== 'root') { ctx.err('dmesg: read kernel buffer failed: Operation not permitted\n'); return 1; }
  ctx.out(ctx.fs.read('/var/log/dmesg'));
}, { usage: 'dmesg', desc: 'Print or control the kernel ring buffer.' });
def('systemctl service', async ctx => {
  const a = ctx.args.filter(x => !x.startsWith('-')), verb = ctx.name === 'service' ? a[1] : a[0], unit = ctx.name === 'service' ? a[0] : a[1];
  if (['poweroff', 'halt', 'reboot'].includes(verb)) return ctx.run([verb === 'halt' ? 'poweroff' : verb]);
  if (!verb || verb === 'list-units') { ctx.out('  UNIT                     LOAD   ACTIVE SUB     DESCRIPTION\n  cron.service             loaded active running Regular background program processing daemon\n  cups.service             loaded active running CUPS Scheduler\n  lightdm.service          loaded active running Light Display Manager\n  NetworkManager.service   loaded active running Network Manager\n  systemd-journald.service loaded active running Journal Service\n\nLOAD   = Reflects whether the unit definition was properly loaded.\n5 loaded units listed.\n'); return 0; }
  if (!unit) { ctx.err('Too few arguments.\n'); return 1; }
  const known = ['cron', 'cups', 'lightdm', 'NetworkManager', 'ssh', 'systemd-journald'].includes(unit.replace(/\.service$/, ''));
  if (!known) { ctx.err(`Unit ${unit.replace(/\.service$/, '')}.service could not be found.\n`); return 4; }
  if (verb === 'status') { ctx.out(`\x1b[1;32m●\x1b[0m ${unit}.service\n     Loaded: loaded (/lib/systemd/system/${unit}.service; enabled; vendor preset: enabled)\n     Active: \x1b[1;32mactive (running)\x1b[0m since ${strftime('%a %F %T', new Date(boot(ctx)))} ${tzName()}; ${upStr(Date.now() - boot(ctx))} ago\n   Main PID: 840 (${unit})\n      Tasks: 1 (limit: 9401)\n     Memory: 2.4M\n     CGroup: /system.slice/${unit}.service\n`); return 0; }
  if (ctx.user !== 'root') { ctx.err(`Failed to ${verb} ${unit}.service: Access denied\nSee system logs and 'systemctl status ${unit}.service' for details.\n`); return 1; }
  await ctx.sleep(400);
}, { usage: 'systemctl [OPTIONS...] COMMAND [UNIT...]', desc: 'Query or send control commands to the system manager.', sbin: false });

for (const name of ['reboot', 'poweroff', 'halt', 'shutdown']) {
  def(name, async ctx => {
    if (ctx.args.includes('-c')) { ctx.out('Shutdown cancelled.\n'); return 0; }
    if (!ctx.os.power) { ctx.err(`${name}: Failed to connect to bus: No such file or directory\n`); return 1; }
    const kind = name === 'reboot' || ctx.args.includes('-r') ? 'reboot' : 'poweroff';
    if (name === 'shutdown' && !ctx.args.some(a => a === 'now' || a === '+0' || a === '0')) { ctx.out(`Shutdown scheduled for ${strftime('%a %F %T', new Date(Date.now() + 60000))} ${tzName()}, use 'shutdown -c' to cancel.\n`); return 0; }
    await ctx.sleep(300);
    ctx.os.power(kind);
    await ctx.sleep(60000);
  }, { usage: `${name} [OPTIONS...]`, desc: name === 'reboot' ? 'Reboot the system.' : 'Power off the system.', sbin: true });
}
def('passwd', async ctx => {
  ctx.out(`Changing password for ${ctx.user}.\n`);
  if (ctx.user !== 'root') await ctx.readLine({ prompt: 'Current password: ', mask: true });
  const a = await ctx.readLine({ prompt: 'New password: ', mask: true }), b = await ctx.readLine({ prompt: 'Retype new password: ', mask: true });
  if (a !== b) { ctx.err('Sorry, passwords do not match.\npasswd: Authentication token manipulation error\npasswd: password unchanged\n'); return 10; }
  if (!a || a.length < 4) { ctx.err('You must choose a longer password.\npasswd: password unchanged\n'); return 10; }
  ctx.out('passwd: password updated successfully\n');
}, { usage: 'passwd [options] [LOGIN]', desc: 'Change user password.' });

// ---------------------------------------------------------------- network
async function resolve(host) {
  if (host === 'localhost') return '127.0.0.1';
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return host;
  try {
    const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(host)}&type=A`, { signal: AbortSignal.timeout(4000) });
    const j = await r.json();
    return (j.Answer || []).filter(a => a.type === 1).map(a => a.data)[0] || null;
  } catch { return undefined; }   // undefined: no network at all
}
def('ping', async ctx => {
  const { o, rest } = getopt(ctx, 'c:i:W:w:q46nv', {});
  if (!rest.length) { ctx.err('ping: usage error: Destination address required\n'); return 2; }
  const host = rest[0], ip = await resolve(host);
  if (!ip) { ctx.err(`ping: ${host}: ${ip === null ? 'Name or service not known' : 'Temporary failure in name resolution'}\n`); return 2; }
  const local = ip.startsWith('127.') || ip.startsWith('192.168.');
  ctx.out(`PING ${host} (${ip}) 56(84) bytes of data.\n`);
  const times = [], n = o.c ? +o.c : Infinity, t0 = Date.now();
  let sent = 0;
  const stats = () => {
    const loss = sent ? Math.round(((sent - times.length) / sent) * 100) : 0;
    ctx.out(`\n--- ${host} ping statistics ---\n${sent} packets transmitted, ${times.length} received, ${loss}% packet loss, time ${Date.now() - t0}ms\n`);
    if (times.length) { const avg = times.reduce((a, b) => a + b, 0) / times.length; ctx.out(`rtt min/avg/max/mdev = ${Math.min(...times).toFixed(3)}/${avg.toFixed(3)}/${Math.max(...times).toFixed(3)}/${Math.sqrt(times.reduce((s, t) => s + (t - avg) ** 2, 0) / times.length).toFixed(3)} ms\n`); }
  };
  try {
    for (let seq = 1; seq <= n; seq++) {
      sent++;
      let ms;
      if (local) ms = 0.02 + Math.random() * 0.05;
      else {
        const t = performance.now();
        try { await fetch(`https://${host}/favicon.ico?_=${Date.now()}`, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(3000) }); ms = performance.now() - t; } catch { ms = null; }
        if (ms !== null) ms = Math.max(1, ms / (seq === 1 ? 6 : 3));   // one HTTPS round trip is several network round trips
      }
      ctx.sh.check();
      if (ms !== null) { times.push(ms); if (!o.q) ctx.out(`64 bytes from ${host === ip ? ip : `${host} (${ip})`}: icmp_seq=${seq} ttl=${local ? 64 : 117} time=${ms < 1 ? ms.toFixed(3) : ms.toFixed(1)} ms\n`); }
      if (seq < n) await ctx.sleep((+o.i || 1) * 1000);
    }
  } catch (e) { stats(); throw e; }
  stats();
  return times.length ? 0 : 1;
}, { usage: 'ping [-c count] [-i interval] destination', desc: 'Send ICMP ECHO_REQUEST to network hosts (measured with HTTPS round trips in this sandbox).' });

async function http(ctx, url, opts = {}) {
  if (!/^[a-z]+:\/\//i.test(url)) url = 'http://' + url;
  const u = new URL(url);
  if (u.protocol === 'http:' && typeof location !== 'undefined' && location.protocol === 'https:' && u.hostname !== 'localhost') u.protocol = 'https:';
  return fetch(u, { ...opts, signal: AbortSignal.timeout(15000) });
}
const netFail = (ctx, url, e) => { let host = url; try { host = new URL(/^[a-z]+:\/\//i.test(url) ? url : 'http://' + url).hostname; } catch { /* keep */ } return e.name === 'TimeoutError' ? `(28) Connection timed out after 15001 milliseconds` : `(7) Failed to connect to ${host}: blocked by the browser (the host is unreachable or does not allow cross-origin requests)`; };
def('curl', async ctx => {
  const { o, rest } = getopt(ctx, 'sSLIiko:OfvX:H:d:A:u:m:w:', { silent: 's', location: 'L', head: 'I', include: 'i', output: 'o', 'remote-name': 'O', fail: 'f', request: 'X', header: 'H', data: 'd', version: 'V', verbose: 'v' });
  if (o.V) { ctx.out('curl 7.81.0 (x86_64-pc-linux-gnu) libcurl/7.81.0 fetch-api/1.0\nRelease-Date: 2022-01-05\nProtocols: http https\nFeatures: HTTP2 HTTPS-proxy SSL\n'); return 0; }
  if (!rest.length) { ctx.err("curl: try 'curl --help' or 'curl --manual' for more information\n"); return 2; }
  let st = 0;
  for (const url of rest) {
    try {
      const headers = {};
      for (const hd of [].concat(o.H || [])) { const i = hd.indexOf(':'); if (i > 0) headers[hd.slice(0, i).trim()] = hd.slice(i + 1).trim(); }
      const r = await http(ctx, url, { method: o.X || (o.I ? 'HEAD' : o.d ? 'POST' : 'GET'), body: o.d, headers });
      ctx.sh.check();
      if (o.f && !r.ok) { ctx.err(`curl: (22) The requested URL returned error: ${r.status}\n`); st = 22; continue; }
      const head = `HTTP/2 ${r.status} ${r.statusText}\n${[...r.headers].map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n`;
      if (o.I) { ctx.out(head); continue; }
      const text = await r.text();
      const file = o.o || (o.O ? basename(new URL(r.url).pathname) || 'index.html' : null);
      if (file && file !== '-') {
        ctx.fs.write(ctx.path(file), text);
        if (!o.s) ctx.err(`  % Total    % Received % Xferd  Average Speed   Time    Time     Time  Current\n                                 Dload  Upload   Total   Spent    Left  Speed\n100 ${String(text.length).padStart(5)}  100 ${String(text.length).padStart(5)}    0     0  ${String(Math.round(text.length * 3)).padStart(5)}      0 --:--:-- --:--:-- --:--:-- ${Math.round(text.length * 3)}\n`);
      } else ctx.out((o.i ? head : '') + text);
    } catch (e) {
      if (e.constructor.name === 'Interrupt') throw e;
      if (e instanceof TypeError && /URL/.test(e.message)) { ctx.err(`curl: (3) URL using bad/illegal format or missing URL\n`); st = 3; continue; }
      if (e.code) { ctx.err(`curl: (23) Failure writing output to destination: ${errMsg(e)}\n`); st = 23; continue; }
      ctx.err(`curl: ${netFail(ctx, url, e)}\n`); st = 7;
    }
  }
  return st;
}, { usage: 'curl [options...] <url>', desc: 'Transfer a URL (uses the browser fetch API, so only CORS-enabled hosts answer).\n  -o FILE  -O  -I  -i  -s  -L  -X METHOD  -H HEADER  -d DATA  -f', ownHelp: false });

def('wget', async ctx => {
  const { o, rest } = getopt(ctx, 'qO:cP:', { quiet: 'q', 'output-document': 'O', version: 'V' });
  if (o.V) { ctx.out('GNU Wget 1.21.2 built on linux-gnu.\n'); return 0; }
  if (!rest.length) { ctx.err("wget: missing URL\nUsage: wget [OPTION]... [URL]...\n\nTry `wget --help' for more options.\n"); return 1; }
  let st = 0;
  for (const url of rest) {
    const full = /^[a-z]+:\/\//i.test(url) ? url : 'http://' + url;
    let u;
    try { u = new URL(full); } catch { ctx.err(`${url}: Invalid host name.\n`); st = 1; continue; }
    const say = s => { if (!o.q) ctx.err(s); };
    say(`--${strftime('%F %T')}--  ${full}\nResolving ${u.hostname} (${u.hostname})... `);
    const ip = await resolve(u.hostname);
    if (!ip) { say(`failed: ${ip === null ? 'Name or service not known' : 'Temporary failure in name resolution'}.\nwget: unable to resolve host address ‘${u.hostname}’\n`); st = 4; continue; }
    say(`${ip}\nConnecting to ${u.hostname} (${u.hostname})|${ip}|:${u.protocol === 'https:' ? 443 : 80}... `);
    try {
      const r = await http(ctx, full);
      ctx.sh.check();
      say(`connected.\nHTTP request sent, awaiting response... ${r.status} ${r.statusText || 'OK'}\n`);
      if (!r.ok) { say(`${strftime('%F %T')} ERROR ${r.status}: ${r.statusText || 'Error'}.\n\n`); st = 8; continue; }
      const text = await r.text(), size = new Blob([text]).size;
      let name = o.O || basename(u.pathname) || 'index.html';
      if (!o.O) { let k = 1; const base = name; while (ctx.fs.exists(ctx.path(name))) name = `${base}.${k++}`; }
      say(`Length: ${size} (${human(size)}) [${(r.headers.get('content-type') || 'text/html').split(';')[0]}]\nSaving to: ‘${name}’\n\n`);
      if (name === '-') ctx.out(text); else ctx.fs.write(ctx.path((o.P ? o.P + '/' : '') + name), text);
      const w = Math.max(10, Math.min(40, ctx.cols - 50));
      for (let p = 0; p <= 100; p += 25) { say(`\r${name.slice(0, 18).padEnd(18)} ${String(p).padStart(3)}%[${('='.repeat(Math.floor((w * p) / 100)) + (p < 100 ? '>' : '')).padEnd(w)}] ${human(Math.round((size * p) / 100)).padStart(7)}  --.-KB/s`); await ctx.sleep(70); }
      say(`    in 0.3s\n\n${strftime('%F %T')} (${human(size * 3)}B/s) - ‘${name}’ saved [${size}/${size}]\n\n`);
    } catch (e) {
      if (e.constructor.name === 'Interrupt') throw e;
      say(`failed: ${e.code ? errMsg(e) : 'Connection refused (blocked by the browser: the host does not allow cross-origin requests)'}.\n`); st = 4;
    }
  }
  return st;
}, { usage: 'wget [OPTION]... [URL]...', desc: 'The non-interactive network downloader (uses the browser fetch API).\n  -O FILE  -q  -P PREFIX' });

def('dig nslookup host', async ctx => {
  const name = ctx.args.find(a => !/^[-+@]/.test(a));
  if (!name) { ctx.err(`Usage: ${ctx.name} name\n`); return 1; }
  const ip = await resolve(name);
  if (ctx.name === 'host') { if (ip) ctx.out(`${name} has address ${ip}\n`); else ctx.out(ip === null ? `Host ${name} not found: 3(NXDOMAIN)\n` : ';; connection timed out; no servers could be reached\n'); return ip ? 0 : 1; }
  if (ctx.name === 'nslookup') { ctx.out(`Server:\t\t127.0.0.53\nAddress:\t127.0.0.53#53\n\n${ip ? `Non-authoritative answer:\nName:\t${name}\nAddress: ${ip}\n` : `** server can't find ${name}: NXDOMAIN\n`}\n`); return ip ? 0 : 1; }
  if (ctx.args.includes('+short')) { if (ip) ctx.out(ip + '\n'); return 0; }
  ctx.out(`\n; <<>> DiG 9.18.18-0ubuntu0.22.04.1-Ubuntu <<>> ${name}\n;; global options: +cmd\n;; Got answer:\n;; ->>HEADER<<- opcode: QUERY, status: ${ip ? 'NOERROR' : 'NXDOMAIN'}, id: ${Math.floor(Math.random() * 65535)}\n;; flags: qr rd ra; QUERY: 1, ANSWER: ${ip ? 1 : 0}, AUTHORITY: 0, ADDITIONAL: 1\n\n;; QUESTION SECTION:\n;${name}.\t\t\tIN\tA\n\n${ip ? `;; ANSWER SECTION:\n${name}.\t\t${200 + Math.floor(Math.random() * 100)}\tIN\tA\t${ip}\n\n` : ''};; Query time: ${8 + Math.floor(Math.random() * 30)} msec\n;; SERVER: 127.0.0.53#53(127.0.0.53) (UDP)\n;; WHEN: ${strftime('%a %b %d %T')} ${tzName()} ${strftime('%Y')}\n;; MSG SIZE  rcvd: ${40 + name.length * 2}\n\n`);
}, { usage: 'dig [name] | nslookup name | host name', desc: 'DNS lookup utilities (answers come from DNS-over-HTTPS).' });

const IFACES = () => `1: lo: <LOOPBACK,UP,LOWER_UP> mtu 65536 qdisc noqueue state UNKNOWN group default qlen 1000\n    link/loopback 00:00:00:00:00:00 brd 00:00:00:00:00:00\n    inet 127.0.0.1/8 scope host lo\n       valid_lft forever preferred_lft forever\n    inet6 ::1/128 scope host \n       valid_lft forever preferred_lft forever\n2: enp0s3: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc fq_codel state UP group default qlen 1000\n    link/ether 08:00:27:4e:66:a1 brd ff:ff:ff:ff:ff:ff\n    inet 192.168.1.42/24 brd 192.168.1.255 scope global dynamic noprefixroute enp0s3\n       valid_lft 86012sec preferred_lft 86012sec\n    inet6 fe80::a00:27ff:fe4e:66a1/64 scope link noprefixroute \n       valid_lft forever preferred_lft forever\n`;
def('ip', ctx => {
  const a = ctx.args.filter(x => !x.startsWith('-'))[0] || '';
  if (/^a(d|dd|ddr|ddress)?$/.test(a)) ctx.out(IFACES());
  else if (/^r(o|oute)?$/.test(a)) ctx.out('default via 192.168.1.1 dev enp0s3 proto dhcp metric 100 \n169.254.0.0/16 dev enp0s3 scope link metric 1000 \n192.168.1.0/24 dev enp0s3 proto kernel scope link src 192.168.1.42 metric 100 \n');
  else if (/^l(i|ink)?$/.test(a)) ctx.out(IFACES().split('\n').filter(l => /^\d|link\//.test(l)).join('\n') + '\n');
  else if (/^n(e|eigh)?$/.test(a)) ctx.out('192.168.1.1 dev enp0s3 lladdr 52:54:00:12:35:02 REACHABLE\n');
  else { ctx.err('Usage: ip [ OPTIONS ] OBJECT { COMMAND | help }\nwhere  OBJECT := { address | link | neigh | route }\n'); return 255; }
}, { usage: 'ip [ OPTIONS ] OBJECT { COMMAND | help }', desc: 'Show / manipulate routing, network devices, interfaces and tunnels.', sbin: true });
def('ifconfig', ctx => ctx.out('enp0s3: flags=4163<UP,BROADCAST,RUNNING,MULTICAST>  mtu 1500\n        inet 192.168.1.42  netmask 255.255.255.0  broadcast 192.168.1.255\n        inet6 fe80::a00:27ff:fe4e:66a1  prefixlen 64  scopeid 0x20<link>\n        ether 08:00:27:4e:66:a1  txqueuelen 1000  (Ethernet)\n        RX packets 48213  bytes 52117340 (52.1 MB)\n        TX packets 21077  bytes 2390118 (2.3 MB)\n\nlo: flags=73<UP,LOOPBACK,RUNNING>  mtu 65536\n        inet 127.0.0.1  netmask 255.0.0.0\n        inet6 ::1  prefixlen 128  scopeid 0x10<host>\n        loop  txqueuelen 1000  (Local Loopback)\n\n'), { usage: 'ifconfig [interface]', desc: 'Configure a network interface.', sbin: true });
def('ssh scp sftp telnet nc', async ctx => {
  const target = ctx.args.find(a => !a.startsWith('-'));
  if (!target) { ctx.err(ctx.name === 'ssh' ? 'usage: ssh [-46AaCfGgKkMNnqsTtVvXxYy] [-p port] [user@]hostname [command]\n' : `usage: ${ctx.name} host\n`); return 255; }
  const host = target.split('@').pop().split(':')[0];
  await ctx.sleep(900);
  const ip = await resolve(host);
  if (!ip) { ctx.err(`${ctx.name}: Could not resolve hostname ${host}: Name or service not known\n`); return 255; }
  await ctx.sleep(1200);
  ctx.err(`${ctx.name}: connect to host ${host} port ${ctx.name === 'telnet' ? 23 : 22}: Connection refused\n`);
  return 255;
}, { usage: 'ssh [user@]hostname [command]', desc: 'OpenSSH remote login client (outbound TCP is not available from a browser tab).' });

// ---------------------------------------------------------------- apt / dpkg
const PKGS = {
  sl: ['5.02-1', 12.7, 60.4, 'Correct you if you type `sl\' by mistake'], cowsay: ['3.03+dfsg2-8', 18.6, 93.2, 'configurable talking cow'],
  cmatrix: ['2.0-3', 17.2, 51.2, 'simulates the display from "The Matrix"'], neofetch: ['7.1.0-3', 85.5, 367, 'Shows Linux System Information with Distribution Logo'],
  htop: ['3.0.5-7build2', 128, 342, 'interactive processes viewer'], figlet: ['2.2.5-3', 133, 752, 'Make large character ASCII banners out of ordinary text'],
  'fortune-mod': ['1:1.99.1-7.1', 28.4, 105, 'provides fortune cookies on demand'], lolcat: ['100.0.1-3', 12.1, 46.1, 'colorful `cat`'], tree: ['2.0.2-1', 47.9, 116, 'displays an indented directory tree, in color'],
};
const BASEPKG = { vim: '2:8.2.3995-1ubuntu2.15', nano: '6.2-1', bash: '5.1-6ubuntu1', coreutils: '8.32-4.1ubuntu1', curl: '7.81.0-1ubuntu1.15', wget: '1.21.2-2ubuntu1', git: '1:2.34.1-1ubuntu1.10', python3: '3.10.6-1~22.04', firefox: '121.0+linuxmint1+virginia', sudo: '1.9.9-1ubuntu2.4', grep: '3.7-1build1', sed: '4.8-1ubuntu2', less: '590-1ubuntu0.22.04.1', gcc: '4:11.2.0-1ubuntu1' };
const ALIASPKG = { fortune: 'fortune-mod' };
def('apt apt-get apt-cache', async ctx => {
  const a = ctx.args.filter(x => !/^-/.test(x)), verb = a[0], names = a.slice(1), sh = ctx.sh;
  const lock = () => { if (ctx.user === 'root') return false; ctx.err(`E: Could not open lock file /var/lib/dpkg/lock-frontend - open (13: Permission denied)\nE: Unable to acquire the dpkg frontend lock (/var/lib/dpkg/lock-frontend), are you root?\n`); return true; };
  const reading = async () => { for (const s of ['Reading package lists...', 'Building dependency tree...', 'Reading state information...']) { ctx.out(s); await ctx.sleep(180 + Math.random() * 200); ctx.out(' Done\n'); } };
  const installed = sh.pkgs();
  if (ctx.name === 'apt' && !ctx.tty) ctx.err('\nWARNING: apt does not have a stable CLI interface. Use with caution in scripts.\n\n');
  switch (verb) {
    case 'update': {
      if (lock()) return 100;
      const repos = [`http://packages.linuxmint.com virginia InRelease`, `http://archive.ubuntu.com/ubuntu jammy InRelease`, `http://archive.ubuntu.com/ubuntu jammy-updates InRelease`, `http://archive.ubuntu.com/ubuntu jammy-backports InRelease`, `http://security.ubuntu.com/ubuntu jammy-security InRelease`];
      for (let i = 0; i < repos.length; i++) { await ctx.sleep(120 + Math.random() * 260); ctx.out(`${i === 0 ? 'Ign' : 'Hit'}:${i + 1} ${repos[i]}\n`); }
      await reading();
      ctx.out('All packages are up to date.\n');
      return 0;
    }
    case 'upgrade': case 'full-upgrade': case 'dist-upgrade': if (lock()) return 100; await reading(); ctx.out('Calculating upgrade... Done\n0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n'); return 0;
    case 'install': {
      if (lock()) return 100;
      if (!names.length) { ctx.out('0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n'); return 0; }
      await reading();
      const todo = [];
      for (let n of names) {
        if (ALIASPKG[n]) { ctx.out(`Note, selecting '${ALIASPKG[n]}' instead of '${n}'\n`); n = ALIASPKG[n]; }
        if (BASEPKG[n] || installed.has(n)) ctx.out(`${n} is already the newest version (${BASEPKG[n] || PKGS[n][0]}).\n`);
        else if (PKGS[n]) todo.push(n);
        else { ctx.err(`E: Unable to locate package ${n}\n`); return 100; }
      }
      if (!todo.length) { ctx.out('0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n'); return 0; }
      const dl = todo.reduce((s, n) => s + PKGS[n][1], 0), disk = todo.reduce((s, n) => s + PKGS[n][2], 0);
      ctx.out(`The following NEW packages will be installed:\n  ${todo.join(' ')}\n0 upgraded, ${todo.length} newly installed, 0 to remove and 0 not upgraded.\nNeed to get ${dl.toFixed(1)} kB of archives.\nAfter this operation, ${disk >= 1000 ? (disk / 1000).toFixed(2) + ' MB' : disk.toFixed(1) + ' kB'} of additional disk space will be used.\n`);
      for (let i = 0; i < todo.length; i++) { await ctx.sleep(250 + Math.random() * 300); ctx.out(`Get:${i + 1} http://archive.ubuntu.com/ubuntu jammy/universe amd64 ${todo[i]} amd64 ${PKGS[todo[i]][0]} [${PKGS[todo[i]][1]} kB]\n`); }
      ctx.out(`Fetched ${dl.toFixed(1)} kB in 0s (${(dl * 2.7).toFixed(0)} kB/s)\n`);
      for (const n of todo) {
        const v = PKGS[n][0];
        ctx.out(`Selecting previously unselected package ${n}.\n`);
        for (const pc of [5, 20, 45, 70, 100]) { ctx.out(`\r(Reading database ... ${pc}%`); await ctx.sleep(60); }
        ctx.out(`\r(Reading database ... 512${Math.floor(Math.random() * 900 + 100)} files and directories currently installed.)\nPreparing to unpack .../${n}_${v.replace(/^\d+:/, '').replace(/:/g, '%3a')}_amd64.deb ...\n`);
        await ctx.sleep(200); ctx.out(`Unpacking ${n} (${v}) ...\n`);
        await ctx.sleep(300); ctx.out(`Setting up ${n} (${v}) ...\n`);
        ctx.fs.write('/var/lib/dpkg/status', `Package: ${n}\nStatus: install ok installed\nVersion: ${v}\nDescription: ${PKGS[n][3]}\n\n`, { append: true });
        for (const [name, c] of Object.entries(commands)) if (c.pkg === n && /^[\w.+-]+$/.test(name)) { try { ctx.fs.mkdir('/usr/games', { p: true }); ctx.fs.write((c.games ? '/usr/games/' : '/usr/bin/') + name, '\x7fELF', { mode: 0o755 }); } catch { /* read-only tree */ } }
      }
      await ctx.sleep(250); ctx.out('Processing triggers for man-db (2.10.2-1) ...\n');
      return 0;
    }
    case 'remove': case 'purge': case 'autoremove': {
      if (lock()) return 100;
      await reading();
      const gone = names.map(n => ALIASPKG[n] || n).filter(n => installed.has(n));
      for (const n of names) if (!installed.has(ALIASPKG[n] || n)) { if (BASEPKG[n]) { ctx.err(`E: Removing essential system package '${n}' is not allowed in this sandbox.\n`); return 100; } if (!PKGS[ALIASPKG[n] || n]) { ctx.err(`E: Unable to locate package ${n}\n`); return 100; } ctx.out(`Package '${n}' is not installed, so not removed\n`); }
      if (!gone.length) { ctx.out('0 upgraded, 0 newly installed, 0 to remove and 0 not upgraded.\n'); return 0; }
      ctx.out(`The following packages will be REMOVED:\n  ${gone.join(' ')}\n0 upgraded, 0 newly installed, ${gone.length} to remove and 0 not upgraded.\nAfter this operation, ${gone.reduce((s, n) => s + PKGS[n][2], 0).toFixed(1)} kB disk space will be freed.\n`);
      let s = ctx.fs.read('/var/lib/dpkg/status');
      for (const n of gone) { await ctx.sleep(300); ctx.out(`Removing ${n} (${PKGS[n][0]}) ...\n`); for (const [name, c] of Object.entries(commands)) if (c.pkg === n) { try { ctx.fs.unlink((c.games ? '/usr/games/' : '/usr/bin/') + name); } catch { /* not there */ } } s = s.replace(new RegExp(`Package: ${n.replace(/[+.]/g, '\\$&')}\\n(?:.+\\n)*\\n`), ''); }
      ctx.fs.write('/var/lib/dpkg/status', s);
      ctx.out('Processing triggers for man-db (2.10.2-1) ...\n');
      return 0;
    }
    case 'search': { const q = (names[0] || '').toLowerCase(); ctx.out('Sorting... Done\nFull Text Search... Done\n'); for (const [n, p] of Object.entries(PKGS)) if (n.includes(q) || p[3].toLowerCase().includes(q)) ctx.out(`\x1b[32m${n}\x1b[0m/jammy ${p[0]} amd64${installed.has(n) ? ' [installed]' : ''}\n  ${p[3]}\n\n`); return 0; }
    case 'show': case 'policy': { const n = ALIASPKG[names[0]] || names[0], p = PKGS[n]; if (!p && !BASEPKG[n]) { ctx.err(`E: No packages found\n`); return 100; } ctx.out(`Package: ${n}\nVersion: ${p ? p[0] : BASEPKG[n]}\nPriority: optional\nSection: universe/games\nOrigin: Ubuntu\nMaintainer: Ubuntu Developers <ubuntu-devel-discuss@lists.ubuntu.com>\nInstalled-Size: ${p ? p[2] : 1024} kB\nDownload-Size: ${p ? p[1] : 512} kB\nAPT-Sources: http://archive.ubuntu.com/ubuntu jammy/universe amd64 Packages\nDescription: ${p ? p[3] : n}\n\n`); return 0; }
    case 'list': { ctx.out('Listing... Done\n'); for (const n of [...Object.keys(BASEPKG), ...Object.keys(PKGS)].sort()) { const inst = BASEPKG[n] || installed.has(n); if (ctx.args.includes('--installed') && !inst) continue; ctx.out(`\x1b[32m${n}\x1b[0m/jammy${inst ? ',now' : ''} ${BASEPKG[n] || PKGS[n][0]} amd64${inst ? ' [installed]' : ''}\n`); } return 0; }
    case 'moo': ctx.out('                 (__) \n                 (oo) \n           /------\\/ \n          / |    ||   \n         *  /\\---/\\ \n            ~~   ~~   \n..."Have you mooed today?"...\n'); return 0;
    default:
      ctx.out(`apt 2.4.11 (amd64)\nUsage: apt [options] command\n\napt is a commandline package manager and provides commands for\nsearching and managing as well as querying information about packages.\n\nMost used commands:\n  list - list packages based on package names\n  search - search in package descriptions\n  show - show package details\n  install - install packages\n  remove - remove packages\n  update - update list of available packages\n  upgrade - upgrade the system by installing/upgrading packages\n\n                                        This APT has Super Cow Powers.\n`);
      return verb ? 100 : 0;
  }
}, { usage: 'apt [options] command', desc: 'Command-line package manager.\n  update | upgrade | install PKG | remove PKG | search TERM | show PKG | list [--installed]', ownHelp: true });
def('dpkg', ctx => {
  const installed = ctx.sh.pkgs();
  if (ctx.args[0] === '-l' || ctx.args[0] === '--list') {
    ctx.out('Desired=Unknown/Install/Remove/Purge/Hold\n| Status=Not/Inst/Conf-files/Unpacked/halF-conf/Half-inst/trig-aWait/Trig-pend\n|/ Err?=(none)/Reinst-required (Status,Err: uppercase=bad)\n||/ Name           Version                      Architecture Description\n+++-==============-============================-============-=================================\n');
    for (const n of [...Object.keys(BASEPKG), ...installed].sort()) ctx.out(`ii  ${n.padEnd(14)} ${(BASEPKG[n] || PKGS[n]?.[0] || '1.0').padEnd(28)} amd64        ${PKGS[n]?.[3] || n}\n`);
    return 0;
  }
  if (ctx.args[0] === '-s') { const n = ctx.args[1]; if (BASEPKG[n] || installed.has(n)) { ctx.out(`Package: ${n}\nStatus: install ok installed\nVersion: ${BASEPKG[n] || PKGS[n][0]}\n`); return 0; } ctx.err(`dpkg-query: package '${n}' is not installed and no information is available\n`); return 1; }
  ctx.err('dpkg: error: need an action option\n\nType dpkg --help for help about installing and deinstalling packages [*];\n'); return 2;
}, { usage: 'dpkg [option...] action', desc: 'Package manager for Debian.\n  -l  list packages   -s PKG  report status of PKG' });

// ---------------------------------------------------------------- desktop integration
const gui = (names, app, usage, desc, argMap = a => a) => def(names, ctx => {
  if (!ctx.os.launch) { ctx.err(`${ctx.name}: cannot open display: \n`); return 1; }
  const args = ctx.args.filter(a => !a.startsWith('-'));
  ctx.os.launch(app, argMap(args, ctx));
}, { usage, desc });
const pathArg = (a, ctx) => (a[0] ? { path: ctx.path(a[0]) } : { path: ctx.cwd });
gui('firefox x-www-browser sensible-browser', 'browser', 'firefox [URL]', 'Open the web browser.', a => ({ url: a[0] }));
gui('nemo nautilus thunar', 'files', 'nemo [DIRECTORY]', 'Open the file manager.', pathArg);
gui('xed gedit pluma', 'editor', 'xed [FILE]', 'Open the graphical text editor.', (a, ctx) => (a[0] ? { path: ctx.path(a[0]) } : {}));
gui('gnome-terminal x-terminal-emulator', 'terminal', 'gnome-terminal', 'Open a new terminal window.', (a, ctx) => ({ cwd: ctx.cwd }));
gui('gnome-calculator', 'calc', 'gnome-calculator', 'Open the calculator.');
gui('xviewer eog', 'viewer', 'xviewer [FILE]', 'Open the image viewer.', (a, ctx) => (a[0] ? { path: ctx.path(a[0]) } : {}));
gui('gnome-system-monitor', 'taskmgr', 'gnome-system-monitor', 'Open the system monitor.');
gui('cinnamon-settings', 'settings', 'cinnamon-settings', 'Open the system settings.');
def('xdg-open open', ctx => {
  const t = ctx.args.find(a => !a.startsWith('-'));
  if (!t) { ctx.err('xdg-open: missing argument\n'); return 1; }
  if (!ctx.os.launch) { ctx.err('xdg-open: no method available for opening\n'); return 3; }
  if (/^(https?|ftp):\/\//.test(t) || /^www\./.test(t)) return void ctx.os.launch('browser', { url: t });
  const p = ctx.path(t);
  if (!ctx.fs.exists(p)) { ctx.err(`xdg-open: file '${t}' does not exist\n`); return 2; }
  ctx.os.openPath ? ctx.os.openPath(p) : ctx.os.launch('files', { path: p });
}, { usage: 'xdg-open { file | URL }', desc: "Open a file or URL in the user's preferred application." });
def('notify-send', ctx => { const a = ctx.args.filter(x => !x.startsWith('-')); if (ctx.os.notify) ctx.os.notify(a[0] || '', a[1] || ''); }, { usage: 'notify-send SUMMARY [BODY]', desc: 'Send a desktop notification.' });

// ---------------------------------------------------------------- wrappers
def('timeout', async ctx => {
  const a = ctx.args.filter((x, i) => !(x.startsWith('-') && i === 0));
  const secs = parseFloat(a[0]);
  if (Number.isNaN(secs) || a.length < 2) throw new UsageError('missing operand');
  let timedOut = false;
  const t = setTimeout(() => { timedOut = true; ctx.sh.interrupt(); }, secs * 1000);
  try { return await ctx.run(a.slice(1)); }
  catch (e) { if (timedOut) { ctx.sh.abort = false; return 124; } throw e; }
  finally { clearTimeout(t); }
}, { usage: 'timeout DURATION COMMAND [ARG]...', desc: 'Start COMMAND, and kill it if still running after DURATION.' });
def('nohup nice ionice stdbuf', ctx => { const a = ctx.args.filter((x, i, arr) => !(x.startsWith('-') && arr.slice(0, i).every(y => y.startsWith('-')))); return a.length ? ctx.run(a) : 0; }, { usage: 'nohup COMMAND [ARG]...', desc: 'Run COMMAND, ignoring hangup signals.' });
def('watch', async ctx => {
  const { o, rest } = getopt(ctx, 'n:dt', { interval: 'n' }, { stop: true });
  if (!rest.length) throw new UsageError('missing command');
  const n = parseFloat(o.n || 2);
  for (;;) {
    ctx.term.clear();
    if (!o.t) ctx.out(`Every ${n.toFixed(1)}s: ${rest.join(' ')}${' '.repeat(Math.max(1, ctx.cols - 40 - rest.join(' ').length - ctx.sh.host.length))}${ctx.sh.host}: ${strftime('%a %b %e %T %Y')}\n\n`);
    await ctx.exec(rest.join(' '));
    await ctx.sleep(n * 1000);
  }
}, { usage: 'watch [-n secs] command', desc: 'Execute a program periodically, showing output fullscreen.' });

// ---------------------------------------------------------------- toys
const LEAF = ['        ▄▄▄▄▄▄▄▄▄▄▄▄▄▄        ', '     ▄██████████████████▄     ', '   ▄█████▀▀        ▀▀█████▄   ', '  █████▀   ▄██████▄   ▀█████  ', ' █████    ████▀▀████    █████ ', ' █████    ████  ████    █████ ', ' █████    ████  ████    █████ ', ' █████    ████  ████    █████ ', '  █████▄   ▀▀    ▀▀   ▄█████  ', '   ▀█████▄▄        ▄▄█████▀   ', '     ▀██████████████████▀     ', '        ▀▀▀▀▀▀▀▀▀▀▀▀▀▀        '];
def('neofetch screenfetch', ctx => {
  const i = info(ctx), m = mem(), g = '\x1b[1;32m', r = '\x1b[0m';
  let gpu = 'Virtual WebGL Adapter', res = '1920x1080';
  try { res = `${screen.width}x${screen.height}`; const c = document.createElement('canvas').getContext('webgl'); const e = c.getExtension('WEBGL_debug_renderer_info'); if (e) gpu = c.getParameter(e.UNMASKED_RENDERER_WEBGL).replace(/^ANGLE \(|\)$/g, '').slice(0, 44); } catch { /* headless */ }
  const title = `${g}${ctx.user}${r}@${g}${ctx.sh.host}${r}`;
  const rows = [title, '-'.repeat(ctx.user.length + ctx.sh.host.length + 1),
    ['OS', `${i.name} ${i.version} x86_64`], ['Host', 'Browser Virtual Machine 1.0'], ['Kernel', i.kernel], ['Uptime', upStr(Date.now() - boot(ctx)).replace(/^(\d+) min$/, '$1 mins')],
    ['Packages', `${2187 + ctx.sh.pkgs().size} (dpkg)`], ['Shell', 'bash 5.1.16'], ['Resolution', res], ['DE', i.de], ['WM', 'Mutter (Muffin)'], ['WM Theme', 'Mint-Y-Dark-Aqua (Mint-Y)'],
    ['Theme', 'Mint-Y-Dark-Aqua [GTK2/3]'], ['Icons', 'Mint-Y-Sand [GTK2/3]'], ['Terminal', 'gnome-terminal'], ['CPU', `JavaScript Virtual CPU (${ncpu()}) @ 3.000GHz`], ['GPU', gpu],
    ['Memory', `${Math.round(m.used / 1024)}MiB / ${Math.round(m.total / 1024)}MiB`], '',
    [0, 1, 2, 3, 4, 5, 6, 7].map(c => `\x1b[4${c}m   `).join('') + r, [0, 1, 2, 3, 4, 5, 6, 7].map(c => `\x1b[10${c}m   `).join('') + r,
  ].map(x => (Array.isArray(x) ? `${g}${x[0]}${r}: ${x[1]}` : x));
  for (let k = 0; k < Math.max(LEAF.length, rows.length); k++) ctx.out(`${g}${LEAF[k] || ' '.repeat(30)}${r}  ${rows[k] ?? ''}\n`);
}, { usage: 'neofetch', desc: 'A fast, highly customizable system info script.', pkg: 'neofetch' });
def('inxi', ctx => { const i = info(ctx), m = mem(); ctx.out(`\x1b[1;34mCPU:\x1b[0m ${ncpu()}-core JavaScript Virtual (-MT MCP-) \x1b[1;34mspeed:\x1b[0m 3000 MHz \x1b[1;34mKernel:\x1b[0m ${i.kernel} x86_64 \x1b[1;34mUp:\x1b[0m ${upStr(Date.now() - boot(ctx))}\n\x1b[1;34mMem:\x1b[0m ${(m.used / 1024).toFixed(1)}/${(m.total / 1024).toFixed(1)} MiB \x1b[1;34mStorage:\x1b[0m 50 GiB (18.4% used) \x1b[1;34mProcs:\x1b[0m ${procList(ctx).length + 180} \x1b[1;34mShell:\x1b[0m Bash \x1b[1;34minxi:\x1b[0m 3.3.13\n`); }, { usage: 'inxi [options]', desc: 'Command line system information script.' });

const FORTUNES = ['You will finish that side project. Eventually.', 'A journey of a thousand commits begins with a single `git init`.', 'It works on my machine. — Ancient proverb', 'There is no place like ~.', 'The best time to write tests was before the bug. The second best time is now.', 'To exit vim, first you must become one with vim. Or type :q!', 'rm -rf is forever. Backups are for a moment.', 'Weeks of coding can save you hours of planning.', '転ばぬ先の git commit。', '急がば sudo。', 'Have you tried turning it off and on again?', 'All your localStorage are belong to us.', 'Real programmers count from 0.', 'Segmentation fault (core dumped)? Not in this sandbox.', '今日のラッキーコマンド: cowsay'];
def('fortune', ctx => ctx.out(pick(FORTUNES) + '\n'), { usage: 'fortune', desc: 'Print a random, hopefully interesting, adage.', pkg: 'fortune-mod', games: true });
function bubble(text, width = 40) {
  const words = text.split(/\s+/), ls = [];
  let cur = '';
  for (const w of words) { if (strWidth(cur + ' ' + w) > width && cur) { ls.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w; }
  ls.push(cur);
  const w = Math.max(...ls.map(strWidth));
  const pad = l => l + ' '.repeat(w - strWidth(l));
  const out = [' ' + '_'.repeat(w + 2)];
  ls.forEach((l, i) => { const [a, b] = ls.length === 1 ? '<>' : i === 0 ? '/\\' : i === ls.length - 1 ? '\\/' : '||'; out.push(`${a} ${pad(l)} ${b}`); });
  out.push(' ' + '-'.repeat(w + 2));
  return out.join('\n');
}
def('cowsay cowthink', async ctx => {
  const { o, rest } = getopt(ctx, 'e:T:W:bdgpstwyf:n', {});
  const text = rest.length ? rest.join(' ') : (await ctx.readAll()).trim();
  const eyes = o.e || (o.d ? 'xx' : o.b ? '==' : o.g ? '$$' : o.p ? '@@' : o.s ? '**' : o.t ? '--' : o.w ? 'OO' : o.y ? '..' : 'oo'), tongue = o.T || (o.d || o.s ? 'U ' : '  '), t = ctx.name === 'cowthink' ? 'o' : '\\';
  ctx.out(`${bubble(text, +(o.W || 40))}\n        ${t}   ^__^\n         ${t}  (${eyes})\\_______\n            (__)\\       )\\/\\\n             ${tongue.padEnd(2)} ||----w |\n                ||     ||\n`);
}, { usage: 'cowsay [-bdgpstwy] [-e eyes] [-T tongue] [-W wrapcolumn] [message]', desc: 'Configurable speaking cow.', pkg: 'cowsay', games: true });
def('lolcat', async ctx => {
  const { list } = await inputs(ctx, ctx.args.filter(a => !a.startsWith('-')));
  let row = Math.random() * 20;
  for (const l of lines(list.map(f => f.text).join('').replace(/\x1b\[[0-9;]*m/g, ''))) {
    let col = 0, s = '';
    for (const ch of l) { const f = 0.12 * (col++ + row * 2.5), c = k => Math.round(Math.sin(f + k) * 127 + 128); s += `\x1b[38;2;${c(0)};${c(2.094)};${c(4.188)}m${ch}`; }
    ctx.out(s + '\x1b[0m\n'); row++;
  }
}, { usage: 'lolcat [FILE]...', desc: 'Rainbow coloring for text.', pkg: 'lolcat', games: true });
// 5x5 block font, one row per 5 bits.
const FONT = { A: 'ehvhh', B: 'uhuhu', C: 'fgggf', D: 'uhhhu', E: 'vgugv', F: 'vgugg', G: 'fgjhf', H: 'hhvhh', I: 'e444e', J: '7222c', K: 'hisih', L: 'ggggv', M: 'hrlhh', N: 'hpljh', O: 'ehhhe', P: 'uhugg', Q: 'ehlif', R: 'uhuih', S: 'fge1u', T: 'v4444', U: 'hhhhe', V: 'hhha4', W: 'hhlrh', X: 'ha4ah', Y: 'ha444', Z: 'v248v', 0: 'ejlpe', 1: '4c44e', 2: 'u1egv', 3: 'u1e1u', 4: 'hhv11', 5: 'vgu1u', 6: 'fguhe', 7: 'v1248', 8: 'ehehe', 9: 'ehf1u', ' ': '00000', '!': '44404', '?': 'e1604', '.': '00004', '-': '00e00', ':': '04040', '+': '04e40', '_': '0000v', '/': '12488', '=': '0v0v0', '#': 'avava', '*': '0la l'.replace(' ', 'a') };
def('figlet banner toilet', async ctx => {
  const text = (ctx.args.filter(a => !a.startsWith('-')).join(' ') || (await ctx.readAll()).trim()).toUpperCase();
  for (let r = 0; r < 5; r++) {
    let line = '';
    for (const ch of text) { const g = FONT[ch] || FONT['?']; const bits = parseInt(g[r], 32); for (let b = 4; b >= 0; b--) line += bits & (1 << b) ? '#' : ' '; line += ' '; }
    ctx.out(line.replace(/\s+$/, '') + '\n');
  }
}, { usage: 'figlet [message]', desc: 'Display large characters made up of ordinary screen characters.', pkg: 'figlet' });

// ---------------------------------------------------------------- tiny dev tools
def('git', ctx => {
  const [verb, ...rest] = ctx.args;
  const root = () => { let p = ctx.cwd; for (;;) { if (ctx.fs.isDir(join(p, '.git'))) return p; if (p === '/') return null; p = p.slice(0, p.lastIndexOf('/')) || '/'; } };
  if (!verb || verb === '--help') { ctx.out('usage: git [--version] [--help] <command> [<args>]\n\nstart a working area\n   init      Create an empty Git repository\n\nexamine the history and state\n   status    Show the working tree status\n\nThis sandbox ships a miniature git: init, status, config and --version only.\n'); return verb ? 0 : 1; }
  if (verb === '--version' || verb === 'version') return void ctx.out('git version 2.34.1\n');
  if (verb === 'init') {
    const dir = ctx.path(rest.find(a => !a.startsWith('-')) || '.');
    const again = ctx.fs.isDir(join(dir, '.git'));
    ctx.fs.mkdir(join(dir, '.git/refs/heads'), { p: true }); ctx.fs.mkdir(join(dir, '.git/objects'), { p: true });
    ctx.fs.write(join(dir, '.git/HEAD'), 'ref: refs/heads/master\n'); ctx.fs.write(join(dir, '.git/config'), '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n');
    if (!again && !ctx.args.includes('-q')) ctx.out("hint: Using 'master' as the name for the initial branch. This default branch name\nhint: is subject to change.\n");
    ctx.out(`${again ? 'Reinitialized existing' : 'Initialized empty'} Git repository in ${dir === '/' ? '' : dir}/.git/\n`);
    return 0;
  }
  if (verb === 'config') { if (rest.includes('--list') || rest.includes('-l')) ctx.out(`user.name=${ctx.user}\ncore.editor=vim\n`); return 0; }
  const r = root();
  if (!r) { ctx.err('fatal: not a git repository (or any of the parent directories): .git\n'); return 128; }
  if (verb === 'status') {
    const files = ctx.fs.readdir(r).filter(n => n !== '.git');
    ctx.out(`On branch master\n\nNo commits yet\n\n${files.length ? `Untracked files:\n  (use "git add <file>..." to include in what will be committed)\n${files.map(f => `\t\x1b[31m${f}${ctx.fs.isDir(join(r, f)) ? '/' : ''}\x1b[0m\n`).join('')}\nnothing added to commit but untracked files present (use "git add" to track)\n` : 'nothing to commit (create/copy files and use "git add" to track)\n'}`);
    return 0;
  }
  if (verb === 'branch') return 0;
  if (verb === 'log') { ctx.err("fatal: your current branch 'master' does not have any commits yet\n"); return 128; }
  ctx.err(`git: '${verb}' is not available in this sandbox's miniature git. See 'git --help'.\n`);
  return 1;
}, { usage: 'git <command> [<args>]', desc: 'The stupid content tracker (miniature build: init, status, config).', ownHelp: true });

def('python3 python', async ctx => {
  const vars = {};
  const str = s => { const m = /^\s*(['"])((?:\\.|(?!\1).)*)\1\s*$/s.exec(s); return m ? m[2].replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\(.)/g, '$1') : null; };
  const splitArgs = s => { const out = []; let d = 0, q = null, cur = ''; for (const ch of s) { if (q) { cur += ch; if (ch === q) q = null; continue; } if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; } if ('([{'.includes(ch)) d++; if (')]}'.includes(ch)) d--; if (ch === ',' && !d) { out.push(cur); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur); return out; };
  const value = s => {
    s = s.trim();
    const lit = str(s); if (lit !== null) return lit;
    if (s === 'True') return true; if (s === 'False') return false; if (s === 'None') return null;
    if (/^[A-Za-z_]\w*$/.test(s)) { if (!(s in vars)) throw new Error(`NameError: name '${s}' is not defined`); return vars[s]; }
    let m;
    if ((m = /^len\((.*)\)$/s.exec(s))) return String(value(m[1])).length;
    if ((m = /^str\((.*)\)$/s.exec(s))) return fmt(value(m[1]));
    if ((m = /^(int|float|abs|round)\((.*)\)$/s.exec(s))) { const v = Number(value(m[2])); return m[1] === 'int' ? Math.trunc(v) : m[1] === 'abs' ? Math.abs(v) : m[1] === 'round' ? Math.round(v) : v; }
    const parts = splitTop(s, '+');
    if (parts.length > 1 && parts.some(p => str(p) !== null || typeof vars[p.trim()] === 'string')) return parts.map(p => { const v = value(p); if (typeof v !== 'string') throw new Error('TypeError: can only concatenate str (not "int") to str'); return v; }).join('');
    if ((m = /^(.+?)\s*\*\s*(\d+)$/s.exec(s)) && str(m[1]) !== null) return str(m[1]).repeat(+m[2]);
    try { return evalArith(s.replace(/\/\//g, '\x01').replace(/\band\b/g, '&&').replace(/\bor\b/g, '||').replace(/\bnot\b/g, '!').replace(/\x01/g, '/'), { int: false, get: n => { if (!(n in vars)) throw new Error(`NameError: name '${n}' is not defined`); return vars[n]; } }); }
    catch (e) { throw new Error(/NameError/.test(e.message) ? e.message : /division/.test(e.message) ? 'ZeroDivisionError: division by zero' : 'SyntaxError: invalid syntax (this sandbox ships a tiny Python subset)'); }
  };
  const splitTop = (s, sep) => { const out = []; let d = 0, q = null, cur = ''; for (const ch of s) { if (q) { cur += ch; if (ch === q) q = null; continue; } if (ch === '"' || ch === "'") q = ch; if ('([{'.includes(ch)) d++; if (')]}'.includes(ch)) d--; if (ch === sep && !d) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
  const fmt = v => (v === true ? 'True' : v === false ? 'False' : v === null ? 'None' : typeof v === 'number' && !Number.isInteger(v) ? String(parseFloat(v.toPrecision(15))) : String(v));
  const run = (line, repl) => {
    line = line.replace(/(^|\s)#.*$/, '').trim();
    if (!line) return false;
    if (/^(exit|quit)\(\)$/.test(line)) return true;
    try {
      let m;
      if (/^import\s+\w+|^from\s+\w+\s+import/.test(line)) { if (!/^(import\s+(os|sys|math|time|random)|from\s+(os|sys|math|time|random))/.test(line)) throw new Error(`ModuleNotFoundError: No module named '${line.split(/\s+/)[1]}'`); }
      else if ((m = /^print\((.*)\)$/s.exec(line))) ctx.out(splitArgs(m[1]).map(a => fmt(value(a))).join(' ') + '\n');
      else if ((m = /^([A-Za-z_]\w*)\s*([-+*\/]?)=(?!=)\s*(.+)$/s.exec(line))) vars[m[1]] = m[2] ? value(`${m[1]} ${m[2]} (${m[3]})`) : value(m[3]);
      else { const v = value(line); if (repl && v !== null) ctx.out((typeof v === 'string' ? `'${v}'` : fmt(v)) + '\n'); }
    } catch (e) { ctx.err(`Traceback (most recent call last):\n  File "<stdin>", line 1, in <module>\n${e.message}\n`); if (!repl) return 'err'; }
    return false;
  };
  const a = ctx.args;
  if (a[0] === '--version' || a[0] === '-V') return void ctx.out('Python 3.10.12\n');
  if (a[0] === '-c') { for (const l of (a[1] || '').split(/[;\n]/)) if (run(l, false) === 'err') return 1; return 0; }
  if (a[0] || ctx.hasStdin) {
    let src;
    try { src = a[0] ? ctx.fs.read(ctx.path(a[0])) : ctx.stdin; } catch (e) { ctx.err(`python3: can't open file '${ctx.path(a[0])}': [Errno 2] ${errMsg(e)}\n`); return 2; }
    for (const l of lines(src)) { if (/^\s+\S/.test(l) || /:\s*$/.test(l.replace(/#.*$/, ''))) { ctx.err(`  File "${a[0] || '<stdin>'}"\n    ${l.trim()}\nSyntaxError: blocks (def/if/for/while) are outside this sandbox's tiny Python subset\n`); return 1; } const r = run(l, false); if (r === 'err') return 1; if (r) break; }
    return 0;
  }
  ctx.out(`Python 3.10.12 (main, Nov 20 2023, 15:14:05) [GCC 11.4.0] on linux\nType "help", "copyright", "credits" or "license" for more information.\n(browser sandbox: a tiny subset — print(), variables, arithmetic, strings)\n`);
  for (;;) { const l = await ctx.readLine({ prompt: '>>> ' }); if (l === null) { ctx.out('\n'); break; } if (run(l, true) === true) break; }
}, { usage: 'python3 [-c cmd | file]', desc: 'A tiny Python subset: print(), variables, arithmetic and strings.', ownHelp: true });
export { INFO, upStr, mem, ncpu, PKGS, resolve };
