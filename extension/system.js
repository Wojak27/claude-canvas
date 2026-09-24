'use strict';
// System monitor: CPU, memory, the workspace's disk and GPUs (via nvidia-smi, when present) of the
// machine the extension runs on (the remote, over Remote-SSH), plus storage quotas and the compute
// allocation where the site has a tool for them (NSC: nscquota, projinfo). Sampled every few
// seconds while a board is visible (quotas every 5 minutes); shown as a strip above Tasks.
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const HISTORY = 60;
const QUOTA_EVERY_MS = 5 * 60 * 1000;

const UNITS = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12, KIB: 2 ** 10, MIB: 2 ** 20, GIB: 2 ** 30, TIB: 2 ** 40, PIB: 2 ** 50 };
const bytes = (n, u) => +n * (UNITS[String(u).toUpperCase()] || 1);

// nscquota: optional "Warning: ..." lines, then
//   Path  Used block  Quota  Hard limit  Used files  Quota  Hard limit
//   /home/x   17.1 GiB  20.0 GiB  30.0 GiB   132325  1000000  1500000
function parseNscquota(out) {
  const warnings = [], paths = [];
  for (const line of out.split('\n')) {
    const w = line.match(/^\s*Warning:\s*(.+)$/i);
    if (w) { warnings.push(w[1].trim()); continue; }
    const m = line.trim().match(/^(\/\S*)\s+([\d.]+)\s*(\w+)\s+([\d.]+)\s*(\w+)\s+([\d.]+)\s*(\w+)\s+(\d+)\s+(\d+)\s+(\d+)/);
    if (m) {
      paths.push({ path: m[1], used: bytes(m[2], m[3]), quota: bytes(m[4], m[5]), hard: bytes(m[6], m[7]),
        files: +m[8], fquota: +m[9], fhard: +m[10] });
    }
  }
  return { warnings, paths };
}

// projinfo: "Current core time allocation:  2000 h/month" and "Total:  2144.60" (last 30 days)
function parseProjinfo(out) {
  const alloc = out.match(/allocation:\s*([\d.]+)\s*h/i);
  const total = out.match(/^\s*Total:\s*([\d.]+)/m);
  if (!alloc || !total) return null;
  const me = os.userInfo().username;
  const row = out.split('\n').map((l) => l.trim().split(/\s+/)).find((f) => f[0] === me);
  const title = out.split('\n').map((l) => l.trim()).find((l, i, a) => /^[\u2550=]{3,}$/.test(a[i + 1] || ''));
  return { alloc: +alloc[1], used: +total[1], mine: row ? +row[row.length - 1] : null, project: title || '' };
}

function run(cmd, args, timeout) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 1 << 20 }, (err, out) => resolve(err && !out ? null : String(out || '')));
  });
}

function readCpu() {
  // aggregate jiffies from /proc/stat; os.cpus() elsewhere
  try {
    const f = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
    const idle = f[3] + (f[4] || 0);
    return { idle, total: f.reduce((a, b) => a + b, 0) };
  } catch (e) {
    let idle = 0, total = 0;
    for (const c of os.cpus()) { const t = c.times; idle += t.idle; total += t.user + t.nice + t.sys + t.idle + t.irq; }
    return { idle, total };
  }
}

function readMem() {
  // MemAvailable is what can be used without swapping; freemem() undercounts (page cache)
  try {
    const m = fs.readFileSync('/proc/meminfo', 'utf8');
    const kb = (k) => +((m.match(new RegExp('^' + k + ':\\s+(\\d+)', 'm')) || [])[1] || 0) * 1024;
    const total = kb('MemTotal'), avail = kb('MemAvailable');
    if (total) return { used: total - avail, total };
  } catch (e) {}
  return { used: os.totalmem() - os.freemem(), total: os.totalmem() };
}

function readDisk(dir) {
  try {
    const s = fs.statfsSync(dir);
    return { used: (s.blocks - s.bfree) * s.bsize, total: s.blocks * s.bsize };
  } catch (e) { return null; }
}

function createSampler(getDir) {
  let prev = readCpu();
  let gpus = [], gpuBusy = false, gpuMissing = false;
  const hist = { cpu: [], gpu: {} };
  let last = null;
  let quota = null, compute = null, quotaAt = 0, quotaBusy = false;

  async function pollQuota() {
    if (quotaBusy || Date.now() - quotaAt < QUOTA_EVERY_MS) return;
    quotaBusy = true; quotaAt = Date.now();
    try {
      const q = await run('nscquota', [], 30000);
      quota = q ? parseNscquota(q) : null;
      const p = await run('projinfo', [], 30000);
      compute = p ? parseProjinfo(p) : null;
    } finally { quotaBusy = false; }
  }

  function pollGpus() {
    if (gpuBusy || gpuMissing) return;
    gpuBusy = true;
    execFile('nvidia-smi', ['--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu',
      '--format=csv,noheader,nounits'], { timeout: 4000 }, (err, out) => {
      gpuBusy = false;
      if (err) { if (err.code === 'ENOENT') gpuMissing = true; gpus = []; return; }
      gpus = out.trim().split('\n').filter(Boolean).map((l) => {
        const [index, name, util, used, total, temp] = l.split(',').map((x) => x.trim());
        return { index, name, util: +util, used: +used * 2 ** 20, total: +total * 2 ** 20, temp: +temp };
      });
      for (const g of gpus) {
        const h = (hist.gpu[g.index] = hist.gpu[g.index] || []);
        h.push(g.util); if (h.length > HISTORY) h.shift();
      }
    });
  }

  function sample() {
    const cur = readCpu();
    const dt = cur.total - prev.total;
    const cpu = dt > 0 ? 100 * (1 - (cur.idle - prev.idle) / dt) : 0;
    prev = cur;
    hist.cpu.push(cpu); if (hist.cpu.length > HISTORY) hist.cpu.shift();
    pollGpus();   // async; this sample carries the previous GPU reading
    pollQuota();  // every 5 minutes; same
    last = {
      host: os.hostname().split('.')[0], cores: os.cpus().length, cpu, load: os.loadavg()[0],
      mem: readMem(), disk: getDir() ? readDisk(getDir()) : null, gpus: gpus.slice(), hist, quota, compute,
    };
    return last;
  }

  return { sample, last: () => last };
}

// ---- rendering (host side; every value is a number we computed, names are escaped) ----------

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const gib = (b) => (b / 2 ** 30 >= 100 ? (b / 2 ** 30).toFixed(0) : (b / 2 ** 30).toFixed(1));
const size = (b) => (b >= 2 ** 40 ? (b / 2 ** 40).toFixed(1) + ' TiB' : gib(b) + ' GiB');
// "4.1/3.9 TiB": one unit, the larger one's
const pair = (a, b) => {
  const [div, u] = Math.max(a, b) >= 2 ** 40 ? [2 ** 40, 'TiB'] : [2 ** 30, 'GiB'];
  const f = (v) => (v / div >= 100 ? (v / div).toFixed(0) : (v / div).toFixed(1));
  return `${f(a)}/${f(b)} ${u}`;
};
const kpair = (a, b) => (Math.max(a, b) >= 1e6 ? `${(a / 1e6).toFixed(2)}/${(b / 1e6).toFixed(2)}M` : `${kfmt(a)}/${kfmt(b)}`);
// meter severity: accent under 70 %, warning to 90 %, critical above; the value is always printed
const level = (pct) => (pct >= 90 ? 'crit' : pct >= 70 ? 'warn' : 'ok');
const kfmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : String(n));

function spark(values) {
  if (!values || values.length < 2) return '';
  const w = 64, h = 16;
  const x = (i) => (i / (HISTORY - 1)) * w, y = (v) => h - 1 - (Math.max(0, Math.min(100, v)) / 100) * (h - 2);
  const off = HISTORY - values.length;
  const d = values.map((v, i) => (i ? 'L' : 'M') + x(i + off).toFixed(1) + ',' + y(v).toFixed(1)).join('');
  const lx = x(values.length - 1 + off), ly = y(values[values.length - 1]);
  return `<svg class="sysspark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><path d="${d}"/>` +
    `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2"/></svg>`;
}

function row(label, pct, text, history, title) {
  const p = Math.max(0, Math.min(100, pct));
  return `<div class="sysrow" title="${esc(title || '')}"><span class="syl">${esc(label)}</span>` +
    `<span class="sysbar ${level(p)}"><span style="width:${p.toFixed(1)}%"></span></span>` +
    `<span class="syv">${esc(text)}</span>${history ? spark(history) : '<span class="sysspark"></span>'}</div>`;
}

function html(s) {
  if (!s) return '<div class="sys" id="sys"><div class="syshead"><span>System</span><span class="cmeta">sampling…</span></div></div>';
  const rows = [
    row('CPU', s.cpu, `${s.cpu.toFixed(0)}% · load ${s.load.toFixed(1)}/${s.cores}`, s.hist.cpu, 'All cores on this machine, not only yours'),
    row('Memory', 100 * s.mem.used / s.mem.total, pair(s.mem.used, s.mem.total), null, 'Used = total − available'),
  ];
  if (s.disk) rows.push(row('Disk', 100 * s.disk.used / s.disk.total, `${size(s.disk.total - s.disk.used)} free`, null, 'The filesystem holding the workspace'));
  for (const g of s.gpus) {
    rows.push(row(`GPU ${g.index}`, g.util, `${g.util}% · ${pair(g.used, g.total)} · ${g.temp}°C`,
      s.hist.gpu[g.index], g.name));
  }
  // storage quotas: the bar is the fuller of blocks and files against the soft quota
  const q = [];
  if (s.quota) {
    for (const w of s.quota.warnings) q.push(`<div class="syswarn" title="from nscquota">⚠ ${esc(w)}</div>`);
    for (const p of s.quota.paths) {
      const bp = 100 * p.used / p.quota, fp = 100 * p.files / p.fquota;
      const over = p.used > p.quota || p.files > p.fquota;
      const short = p.path.startsWith('/home/') ? '~' : '/' + p.path.split('/')[1];   // full path in the tooltip
      q.push(row(short, Math.max(bp, fp),
        `${over ? '⚠ ' : ''}${pair(p.used, p.quota)} · ${kpair(p.files, p.fquota)} files`,
        null, `${p.path}${over ? ' — over its quota' : ''}; hard limits ${size(p.hard)} and ${kfmt(p.fhard)} files`));
    }
  }
  if (s.compute) {
    const c = s.compute;
    q.push(row('Compute', 100 * c.used / c.alloc,
      `${c.used > c.alloc ? '⚠ ' : ''}${c.used.toFixed(0)}/${c.alloc.toFixed(0)} h${c.mine !== null ? ` · you ${c.mine.toFixed(0)}` : ''}`,
      null, `Core hours used by ${c.project || 'the project'} in the last 30 days, against the monthly allocation`));
  }
  const quotaHtml = q.length ? `<div class="syssub">Quota · compute over the last 30 days</div>${q.join('')}` : '';
  return `<div class="sys" id="sys"><div class="syshead"><span>System · ${esc(s.host)}</span>` +
    `<button class="x" data-sysoff title="Hide (setting claudeCanvas.systemMonitor)">×</button></div>` +
    `<div class="sysgrid">${rows.join('')}${quotaHtml}</div></div>`;
}

module.exports = { createSampler, html, parseNscquota, parseProjinfo };
