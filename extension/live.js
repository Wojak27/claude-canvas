'use strict';
// Live blocks: `live/<name>.sh` prints markdown, and is re-run on a timer. Its last good output is
// kept in `live/<name>.md`, so Claude (or anything else) can read what the board is showing.
//
// Header comments in the first lines of the script configure it:
//   # every: 60s        (s, m or h; at least 5s)
//   # title: Running jobs
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const MIN_EVERY = 5;
const DEFAULT_EVERY = 60;
const TIMEOUT_MS = 30000;
const MAX_OUT = 200000;

function parseEvery(s) {
  const m = /^(\d+(?:\.\d+)?)\s*([smh]?)$/.exec(String(s || '').trim());
  if (!m) return DEFAULT_EVERY;
  return Math.max(MIN_EVERY, +m[1] * { '': 1, s: 1, m: 60, h: 3600 }[m[2]]);
}

function killTree(child) {
  try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { try { child.kill('SIGKILL'); } catch (e2) {} }
}

function header(src) {
  const h = {};
  for (const l of src.split('\n').slice(0, 15)) {
    const m = /^#\s*(every|title)\s*:\s*(.+?)\s*$/.exec(l);
    if (m) h[m[1]] = m[2];
  }
  return h;
}

// Every block in `dir/live`, sorted by name.
function list(dir) {
  const liveDir = path.join(dir, 'live');
  let names = [];
  try { names = fs.readdirSync(liveDir); } catch (e) { return []; }
  const out = [];
  for (const n of names.filter((x) => x.endsWith('.sh') && !x.startsWith('.')).sort()) {
    const name = n.slice(0, -3);
    const script = path.join(liveDir, n);
    let h = {};
    try { h = header(fs.readFileSync(script, 'utf8')); } catch (e) { continue; }
    out.push({ name, script, out: path.join(liveDir, name + '.md'), every: parseEvery(h.every), title: h.title || name });
  }
  return out;
}

// Runs due blocks. `cwd()` is where scripts run (the workspace root), `onUpdate(name)` fires when
// a run finishes. Output is written before onUpdate, errors are kept in `meta` and never
// overwrite the last good output.
function createRunner(getDir, cwd, onUpdate) {
  const meta = new Map(); // name -> { at, ms, code, err, running }
  const kids = new Set();

  function run(b) {
    const m = meta.get(b.name) || {};
    m.running = true;
    meta.set(b.name, m);
    const t0 = Date.now();
    let out = '', err = '';
    let child;
    try {
      // own process group, so a timeout also takes down whatever the script started
      child = spawn('bash', [b.script], { cwd: cwd(), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch (e) {
      Object.assign(m, { running: false, at: t0, ms: 0, code: -1, err: String(e) });
      onUpdate(b.name);
      return;
    }
    kids.add(child);
    const kill = setTimeout(() => { err += `\ntimed out after ${TIMEOUT_MS / 1000}s`; killTree(child); }, TIMEOUT_MS);
    child.stdout.on('data', (d) => { if (out.length < MAX_OUT) out += d; });
    child.stderr.on('data', (d) => { if (err.length < MAX_OUT) err += d; });
    child.on('error', (e) => { err += String(e); });
    child.on('close', (code) => {
      clearTimeout(kill);
      kids.delete(child);
      Object.assign(m, { running: false, at: Date.now(), ms: Date.now() - t0, code: code === null ? -1 : code, err: err.trim() });
      if (code === 0) {
        try {
          fs.writeFileSync(b.out + '.tmp', out.slice(0, MAX_OUT));
          fs.renameSync(b.out + '.tmp', b.out);
        } catch (e) { m.err = `could not write ${path.basename(b.out)}: ${e.message}`; }
      }
      onUpdate(b.name);
    });
  }

  // Run every block whose interval has elapsed. `force` runs them all now.
  function tick(force) {
    const dir = getDir();
    if (!dir) return;
    const now = Date.now();
    for (const b of list(dir)) {
      const m = meta.get(b.name);
      if (m && m.running) continue;
      if (force || !m || !m.at || now - m.at >= b.every * 1000) run(b);
    }
  }

  // Make one block due now (its script changed, or someone pressed re-run).
  function invalidate(name) {
    const m = meta.get(name);
    if (m) m.at = 0;
  }

  function dispose() {
    for (const k of kids) killTree(k);
    kids.clear();
  }

  return { tick, invalidate, meta, dispose };
}

module.exports = { list, createRunner, parseEvery, MIN_EVERY };
