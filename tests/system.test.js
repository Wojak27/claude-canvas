// System monitor: quota/compute parsers on real NSC output, and one live sample of this machine.
const os = require('os');
const system = require('../extension/system.js');
let failed = 0;
const ok = (c, m) => { if (!c) failed++; console.log((c ? 'PASS ' : 'FAIL ') + m); };

const NSCQUOTA = `Warning: /proj/demo-2024-1 is in state SOFT_BOTH_EXCEEDED and will be locked in 11 09:20:23

Path                      Used block     Quota  Hard limit  Used files    Quota  Hard limit
/home/x_demo                17.1 GiB  20.0 GiB    30.0 GiB      132325  1000000     1500000
/proj/demo-2024-1            4.1 TiB   3.9 TiB     4.9 TiB     6034741  6000000     9000000
`;
const q = system.parseNscquota(NSCQUOTA);
ok(q.warnings.length === 1 && /SOFT_BOTH_EXCEEDED/.test(q.warnings[0]), 'nscquota warning line kept');
ok(q.paths.length === 2 && Math.abs(q.paths[1].used / 2 ** 40 - 4.1) < 1e-9 && q.paths[1].fquota === 6000000, 'nscquota rows parsed with units');

const me = os.userInfo().username;
const PROJINFO = `You are a member of 1 active project.

Demo-2026-1
═══════════
Current core time allocation:  2000 h/month
Consumed compute resource time during the last 30 days:
  User     Name                 Hours
  ───────────────────────────────────
  ${me}  Some One  1911.27
  x_other  Some Body          233.27
  ───────────────────────────────────
  Total:                      2144.60
`;
const c = system.parseProjinfo(PROJINFO);
ok(c && c.alloc === 2000 && c.used === 2144.6 && c.mine === 1911.27 && c.project === 'Demo-2026-1', 'projinfo: allocation, total, yours, project');
ok(system.parseProjinfo('nothing useful') === null, 'projinfo without an allocation is ignored');

const s = system.createSampler(() => __dirname);
s.sample();
const snap = s.sample();
const html = system.html(Object.assign({}, snap, { quota: q, compute: c }));
ok(snap.cpu >= 0 && snap.cpu <= 100 && snap.mem.total > 0, 'live sample: cpu in [0,100], memory read');
ok(/SOFT_BOTH_EXCEEDED/.test(html) && /⚠ 4\.1\/3\.9 TiB/.test(html) && /2145\/2000 h/.test(html), 'strip shows the warning, over-quota path and compute');
ok(!/<script/i.test(system.html(Object.assign({}, snap, { host: '<script>x</script>' }))), 'host name is escaped');
process.exit(failed ? 1 : 0);
