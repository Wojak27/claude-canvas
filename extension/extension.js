'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const md = require('./markdown.js');
const tasks = require('./tasks.js');
const live = require('./live.js');
const widgets = require('./widgets.js');

const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif']);
const TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.log', '.json', '.csv']);
const SHARED = 'shared';
const FOLLOW = 'follow';

const cfg = () => vscode.workspace.getConfiguration('claudeCanvas');

function workspaceRoot() {
  const ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  return ws ? ws.uri.fsPath : null;
}

// The canvas folder. The top level is the Shared board; each Claude Code conversation writes to
// its own board under sessions/<session id>/, with the same layout.
function canvasDir() {
  const root = workspaceRoot();
  return root ? path.join(root, cfg().get('folder', '.claude/canvas')) : null;
}

const boardDir = (id) => {
  const top = canvasDir();
  if (!top) return null;
  return id === SHARED ? top : path.join(top, 'sessions', id);
};

// Live blocks run scripts from the workspace, so only in a trusted one, and only when enabled.
const liveAllowed = () => vscode.workspace.isTrusted && cfg().get('liveBlocks', true);
let runner = null;

function ensureDirs() {
  const dir = canvasDir();
  if (!dir) return null;
  try {
    // no placeholder state.md: writing one would make the Shared board look like the latest activity
    fs.mkdirSync(path.join(dir, 'feed'), { recursive: true });
    const t = path.join(dir, 'tasks.md');
    if (!fs.existsSync(t)) fs.writeFileSync(t, '# Tasks\n');
    // Board state is local and per machine, and cards symlink absolute paths: keep it out of git.
    const gi = path.join(dir, '.gitignore');
    if (!fs.existsSync(gi)) fs.writeFileSync(gi, '# Claude Canvas board state: local, per machine\n*\n');
    // So the CLI runs live blocks from the same place the extension does.
    const ws = path.join(dir, '.workspace');
    const root = workspaceRoot();
    let cur = '';
    try { cur = fs.readFileSync(ws, 'utf8').trim(); } catch (e) {}
    if (root && cur !== root) fs.writeFileSync(ws, root + '\n');
  } catch (e) { /* read-only workspace is fine */ }
  return dir;
}

// ---- conversations -----------------------------------------------------------------------------

function mtime(p) { try { return fs.statSync(p).mtimeMs; } catch (e) { return 0; } }

// When anything on a board last changed: adding or removing a card touches feed/.
function activity(dir) {
  return Math.max(mtime(path.join(dir, 'feed')), mtime(path.join(dir, 'state.md')),
    mtime(path.join(dir, 'tasks.md')), mtime(path.join(dir, 'live')), mtime(path.join(dir, 'meta.json')));
}

function readMeta(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')) || {}; } catch (e) { return {}; }
}

function conversations() {
  const top = canvasDir();
  if (!top) return [];
  const out = [{ id: SHARED, title: 'Shared', active: activity(top) }];
  let ids = [];
  try { ids = fs.readdirSync(path.join(top, 'sessions')); } catch (e) {}
  for (const id of ids) {
    const dir = path.join(top, 'sessions', id);
    try { if (!fs.statSync(dir).isDirectory()) continue; } catch (e) { continue; }
    const meta = readMeta(dir);
    out.push({ id, title: meta.title || `Conversation ${id.slice(0, 8)}`, started: meta.started, active: activity(dir) });
  }
  return out;
}

let lastActive = null;
function latestId() {
  const all = conversations();
  if (lastActive && all.some((c) => c.id === lastActive)) return lastActive;
  let best = all[0];
  for (const c of all) if (c.active > best.active) best = c;
  lastActive = best ? best.id : SHARED;
  return lastActive;
}

// Which conversation a board shows: its pinned one if that still exists, else the latest.
function shownId(b) {
  if (b.view.mode !== FOLLOW && b.view.id && fs.existsSync(boardDir(b.view.id) || '')) return b.view.id;
  return latestId();
}

// ---- rendering ---------------------------------------------------------------------------------

function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(ms).toLocaleString();
}

function readFeed(dir) {
  const feedDir = path.join(dir, 'feed');
  let names = [];
  try { names = fs.readdirSync(feedDir); } catch (e) { return []; }
  const items = [];
  for (const name of names) {
    if (name.startsWith('.')) continue;
    const abs = path.join(feedDir, name);
    let st;
    try { st = fs.statSync(abs); } catch (e) { continue; }
    if (!st.isFile()) continue;
    const ext = path.extname(name).toLowerCase();
    if (!IMG_EXT.has(ext) && !TEXT_EXT.has(ext)) continue;
    if (/\.caption\.md$/i.test(name)) continue;   // belongs to its image card
    items.push({ abs, name, ext, mtime: st.mtimeMs, kind: IMG_EXT.has(ext) ? 'image' : 'text' });
  }
  items.sort((a, b) => (a.mtime === b.mtime ? a.name.localeCompare(b.name) : a.mtime - b.mtime));
  if (cfg().get('newestFirst', true)) items.reverse();
  return items.slice(0, cfg().get('maxCards', 60));
}

function imgResolver(webview, baseDir) {
  return (src) => {
    if (/^(https?:|data:)/.test(src)) return src;
    const abs = path.isAbsolute(src) ? src : path.resolve(baseDir, src);
    let v = 0;
    try { v = Math.round(fs.statSync(abs).mtimeMs); } catch (e) { /* missing file */ }
    return `${webview.asWebviewUri(vscode.Uri.file(abs))}?v=${v}`;
  };
}

// Markdown with widgets resolved; every `src` data file a widget reads is recorded on the board,
// so the board re-renders when one changes.
function renderMd(text, b, baseDir) {
  return md.render(text, imgResolver(b.webview, baseDir), {
    widget: (body) => widgets.resolve(body, workspaceRoot(), (f) => b.srcs.set(f, mtime(f))),
  });
}

function cardHtml(item, b, opts = {}) {
  const resolve = imgResolver(b.webview, path.dirname(item.abs));
  const esc = md.escapeHtml;
  const head = `<div class="chead"><span class="cname" data-open="${esc(item.abs)}">${esc(item.name)}</span>` +
    `<span class="cmeta">${ago(item.mtime)}</span>` +
    (opts.expanded ? '' : `<button class="x" data-expand="${esc(item.abs)}" title="Open in a tab">⤢</button>`) +
    `<button class="x" data-del="${esc(item.abs)}" title="Remove card">×</button></div>`;
  const scope = ` data-scope="${esc(item.name)}"`;

  if (item.kind === 'image') {
    let caption = '';
    const side = item.abs.replace(/\.[^.]+$/, '.caption.md');
    try { if (fs.existsSync(side)) caption = renderMd(fs.readFileSync(side, 'utf8'), b, path.dirname(item.abs)); } catch (e) {}
    return `<div class="card img"${scope}>${head}<a class="shot" data-open="${esc(item.abs)}">` +
      `<img src="${resolve(item.abs)}" alt="${esc(item.name)}"></a>` +
      (caption ? `<div class="cap">${caption}</div>` : '') + `</div>`;
  }

  let body = '';
  try {
    const raw = fs.readFileSync(item.abs, 'utf8');
    if (/\.widget\.json$/i.test(item.name)) {
      body = widgets.resolve(raw, workspaceRoot(), (f) => b.srcs.set(f, mtime(f)));
    } else if (item.ext === '.md' || item.ext === '.markdown') {
      body = renderMd(raw, b, path.dirname(item.abs));
    } else {
      body = `<pre class="code"><code>${esc(raw)}</code></pre>`;
    }
  } catch (e) { body = `<p class="err">Could not read ${esc(item.name)}</p>`; }
  return `<div class="card"${scope}>${head}<div class="body">${body}</div></div>`;
}

function taskText(t) {
  let h = md.escapeHtml(t);
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/(^|\s)@([\w.-]+)/g, '$1<span class="chip at">@$2</span>');
  h = h.replace(/(^|\s)#([\w-]+)/g, '$1<span class="chip tag">#$2</span>');
  return h;
}

function tasksHtml(file) {
  const items = tasks.parse(tasks.read(file));
  const secs = tasks.sections(items);
  const all = items.filter((i) => i.type === 'task');
  const doneAll = all.filter((i) => i.done).length;

  const body = secs.map((sec, si) => {
    const ts = sec.items.filter((i) => i.type === 'task');
    const done = ts.filter((i) => i.done).length;
    const pct = ts.length ? Math.round((done / ts.length) * 100) : 0;
    const rows = sec.items.map((i) => {
      if (i.type !== 'task') return `<div class="tnote">${taskText(i.text)}</div>`;
      return `<div class="trow ${i.done ? 'done' : ''}" data-task="${i.idx}" style="margin-left:${i.indent * 14}px">` +
        `<span class="box">${i.done ? '✓' : ''}</span><span class="ttext">${taskText(i.text)}</span></div>`;
    }).join('');
    const head = sec.title
      ? `<div class="shead"><span class="stitle">${md.escapeHtml(sec.title)}</span>` +
        (ts.length ? `<span class="scount">${done}/${ts.length}</span>` +
          `<span class="pbar sbar"><span class="pfill" style="width:${pct}%"></span></span>` : '') +
        `</div>`
      : '';
    return `<section class="sec ${si === 0 ? 'current' : ''}">${head}${rows || '<div class="tnote">no tasks yet</div>'}</section>`;
  }).join('');

  const open = all.length - doneAll;
  const pctAll = all.length ? Math.round((doneAll / all.length) * 100) : 0;
  return `<details class="tasks" id="tasksBlock">
  <summary>
    <span class="tw">Tasks</span>
    <span class="tsum">${open} open${doneAll ? ` · ${doneAll} done` : ''}</span>
    <span class="pbar sbar"><span class="pfill" style="width:${pctAll}%"></span></span>
  </summary>
  <div class="tbody">
    ${body || '<div class="empty">No tasks yet.</div>'}
    <div class="addrow"><input id="newtask" type="text" placeholder="Add a task…" autocomplete="off">
      <button id="cleardone" title="Remove finished tasks">Clear done</button>
      <button id="edittasks" title="Open tasks.md">Edit</button>
    </div>
  </div>
</details>`;
}

function every(s) {
  return s % 3600 === 0 ? `${s / 3600}h` : s % 60 === 0 ? `${s / 60}m` : `${s}s`;
}

function liveHtml(b) {
  const dir = boardDir(shownId(b));
  if (!dir) return '';
  return live.list(dir).map((blk) => {
    let m = (runner && runner.meta.get(blk.script)) || {};
    // not run by this window yet: show what the last run (CLI or another window) recorded
    if (!m.at) {
      try {
        const st = JSON.parse(fs.readFileSync(blk.status, 'utf8'));
        m = Object.assign({}, m, { at: Date.parse(st.at), code: st.exit, err: st.stderr });
      } catch (e) {}
    }
    let status;
    if (!vscode.workspace.isTrusted) status = 'paused · workspace not trusted';
    else if (!cfg().get('liveBlocks', true)) status = 'paused · claudeCanvas.liveBlocks is off';
    else if (m.running && !m.at) status = 'running…';
    else if (m.at) status = `${new Date(m.at).toLocaleTimeString()} · every ${every(blk.every)}${m.running ? ' · running…' : ''}`;
    else status = `every ${every(blk.every)}`;
    let body = '';
    try { if (fs.existsSync(blk.out)) body = renderMd(fs.readFileSync(blk.out, 'utf8'), b, dir); } catch (e) {}
    const err = m.at && m.code !== 0
      ? `<pre class="code err"><code>exit ${m.code}${m.err ? '\n' + md.escapeHtml(m.err) : ''}</code></pre>` : '';
    return `<div class="state live" data-scope="live:${md.escapeHtml(blk.name)}"><div class="lhead">` +
      `<span class="ltitle" data-open="${md.escapeHtml(blk.script)}" title="Open ${md.escapeHtml(path.basename(blk.script))}">` +
      `${md.escapeHtml(blk.title)}</span><span class="cmeta">${md.escapeHtml(status)}</span>` +
      `<button class="x" data-rerun="${md.escapeHtml(blk.name)}" title="Run now">↻</button></div>` +
      `${body || (err ? '' : '<p class="lwait">waiting for the first run…</p>')}${err}</div>`;
  }).join('\n');
}

function pickerHtml(b) {
  const esc = md.escapeHtml;
  const shown = shownId(b);
  const all = conversations();
  const sessions = all.filter((c) => c.id !== SHARED).sort((x, y) => y.active - x.active)
    .slice(0, cfg().get('maxConversations', 20));
  if (shown !== SHARED && !sessions.some((c) => c.id === shown)) {
    const c = all.find((x) => x.id === shown);
    if (c) sessions.push(c);
  }
  const shownTitle = (all.find((c) => c.id === shown) || { title: 'Shared' }).title;
  const opt = (value, label, sel) => `<option value="${esc(value)}"${sel ? ' selected' : ''}>${esc(label)}</option>`;
  return `<select id="conv" title="Which conversation this board shows">` +
    opt(FOLLOW, `Follow latest · ${shownTitle}`, b.view.mode === FOLLOW) +
    opt(SHARED, 'Shared', b.view.mode !== FOLLOW && shown === SHARED) +
    sessions.map((c) => opt(c.id, `${c.title} · ${ago(c.active)}`, b.view.mode !== FOLLOW && shown === c.id)).join('') +
    `</select>`;
}

function page(b, content) {
  const nonce = String(Math.random()).slice(2) + String(Date.now());
  const csp = `default-src 'none'; img-src ${b.webview.cspSource} https: data: vscode-resource:; ` +
    `style-src 'unsafe-inline' ${b.webview.cspSource}; script-src 'nonce-${nonce}' ${b.webview.cspSource}; font-src ${b.webview.cspSource};`;
  const widgetJs = b.webview.asWebviewUri(vscode.Uri.joinPath(b.extUri, 'media', 'widgets.js'));
  const saved = JSON.stringify({ view: b.view, card: b.card || null }).replace(/</g, '\\u003c');
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>:root { color-scheme: light dark; }
body { margin:0; padding:0 12px 24px; overflow-x:hidden; font-family:var(--vscode-font-family); font-size:var(--vscode-font-size);
  color:var(--vscode-foreground); background:var(--vscode-sideBar-background,var(--vscode-editor-background)); }
.bar { position:sticky; top:0; z-index:5; display:flex; gap:6px; align-items:center; padding:8px 0;
  background:inherit; border-bottom:1px solid var(--vscode-panel-border,rgba(128,128,128,.25)); }
.bar .t { font-weight:600; letter-spacing:.02em; opacity:.85; margin-right:auto; font-size:.9em; }
details.tasks { margin:10px 0 4px; border:1px solid var(--vscode-panel-border,rgba(128,128,128,.25));
  border-radius:8px; background:var(--vscode-editorWidget-background,rgba(128,128,128,.05)); }
details.tasks > summary { list-style:none; cursor:pointer; display:flex; align-items:center; gap:9px;
  padding:7px 10px; user-select:none; border-radius:8px; }
details.tasks > summary::-webkit-details-marker { display:none; }
details.tasks > summary::before { content:'\u25b8'; font-size:.8em; opacity:.6; transition:transform .12s; }
details.tasks[open] > summary::before { transform:rotate(90deg); }
details.tasks[open] > summary { border-bottom:1px solid var(--vscode-panel-border,rgba(128,128,128,.2));
  border-radius:8px 8px 0 0; }
summary .tw { font-weight:600; letter-spacing:.03em; text-transform:uppercase; font-size:.82em; opacity:.8; }
summary .tsum { font-size:.85em; opacity:.6; margin-left:auto; font-variant-numeric:tabular-nums; flex:none; }
summary .sbar { flex:0 1 52px; min-width:20px; }
.tbody { padding:4px 10px 10px; }
.sec { margin:8px 0 12px; }
.sec:not(.current) { opacity:.72; }
.shead { display:flex; align-items:center; gap:8px; min-width:0; margin:0 0 6px; padding-bottom:4px;
  border-bottom:1px solid var(--vscode-panel-border,rgba(128,128,128,.2)); }
.stitle { font-weight:600; font-size:.95em; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.scount { font-size:.82em; opacity:.6; font-variant-numeric:tabular-nums; margin-left:auto; }
.sbar { flex:0 0 52px; height:5px; }
.trow { display:flex; gap:9px; align-items:baseline; padding:3px 4px; border-radius:5px; cursor:pointer;
  line-height:1.45; min-width:0; }
.ttext { min-width:0; overflow-wrap:anywhere; }
.trow:hover { background:var(--vscode-list-hoverBackground,rgba(128,128,128,.12)); }
.trow.done .ttext { opacity:.5; text-decoration:line-through; }
.trow .box { flex:none; width:1em; height:1em; line-height:1em; text-align:center; font-size:.85em;
  border:1px solid var(--vscode-panel-border,rgba(128,128,128,.55)); border-radius:3px; }
.trow.done .box { background:var(--vscode-testing-iconPassed,#3fb950); color:#fff; border-color:transparent; }
.tnote { font-size:.88em; opacity:.55; padding:2px 4px 2px 28px; }
.chip { border-radius:4px; padding:0 4px; font-size:.88em; }
.chip.at { background:rgba(74,163,255,.18); color:var(--vscode-textLink-foreground,#4aa3ff); }
.chip.tag { background:rgba(128,128,128,.2); opacity:.9; }
.addrow { margin:10px 0 2px; display:flex; flex-wrap:wrap; gap:5px; }
#newtask { flex:1; min-width:0; box-sizing:border-box; font:inherit; padding:5px 8px; border-radius:6px;
  color:var(--vscode-input-foreground); background:var(--vscode-input-background);
  border:1px solid var(--vscode-input-border,var(--vscode-panel-border,rgba(128,128,128,.35))); }
#newtask:focus { outline:1px solid var(--vscode-focusBorder); }
button { font:inherit; color:var(--vscode-button-secondaryForeground,var(--vscode-foreground));
  background:var(--vscode-button-secondaryBackground,transparent); border:1px solid var(--vscode-panel-border,rgba(128,128,128,.3));
  border-radius:5px; padding:2px 8px; cursor:pointer; }
button:hover { background:var(--vscode-toolbar-hoverBackground,rgba(128,128,128,.18)); }
.state { border-left:3px solid var(--vscode-textLink-foreground,#4aa3ff); padding:4px 0 4px 12px; margin:14px 0 18px; }
.card { border:1px solid var(--vscode-panel-border,rgba(128,128,128,.25)); border-radius:8px; margin:10px 0;
  background:var(--vscode-editorWidget-background,rgba(128,128,128,.05)); overflow:hidden; }
.chead { display:flex; align-items:center; gap:8px; padding:5px 8px; font-size:.85em;
  border-bottom:1px solid var(--vscode-panel-border,rgba(128,128,128,.18)); }
.cname { font-family:var(--vscode-editor-font-family); opacity:.9; cursor:pointer; min-width:0;
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cname:hover { text-decoration:underline; }
.cmeta { margin-left:auto; opacity:.55; }
.x { padding:0 6px; line-height:1.4; opacity:.5; } .x:hover { opacity:1; }
.body { padding:2px 12px 10px; overflow-wrap:anywhere; }
.shot { display:block; cursor:zoom-in; background:repeating-conic-gradient(rgba(128,128,128,.10) 0% 25%, transparent 0% 50%) 50%/16px 16px; }
.shot img { display:block; width:100%; height:auto; }
.cap { padding:6px 12px 10px; font-size:.92em; opacity:.85; }
h1,h2,h3,h4 { margin:.7em 0 .35em; line-height:1.25; }
h1 { font-size:1.25em; } h2 { font-size:1.12em; } h3 { font-size:1em; }
p { margin:.45em 0; line-height:1.5; }
ul,ol { margin:.35em 0; padding-left:1.25em; }
li.task { list-style:none; margin-left:-1.1em; display:flex; gap:7px; align-items:baseline; }
li.task .box { display:inline-block; width:1em; height:1em; line-height:1em; text-align:center; font-size:.85em;
  border:1px solid var(--vscode-panel-border,rgba(128,128,128,.5)); border-radius:3px; flex:none; }
li.task.done { opacity:.6; } li.task.done .box { background:var(--vscode-testing-iconPassed,#3fb950); color:#fff; border-color:transparent; }
code { font-family:var(--vscode-editor-font-family); font-size:.92em;
  background:var(--vscode-textCodeBlock-background,rgba(128,128,128,.15)); padding:.1em .3em; border-radius:3px; }
pre.code { background:var(--vscode-textCodeBlock-background,rgba(128,128,128,.12)); padding:8px 10px;
  border-radius:6px; overflow:auto; } pre.code code { background:none; padding:0; }
table { border-collapse:collapse; margin:.5em 0; font-size:.93em; width:100%; table-layout:fixed;
  overflow-wrap:anywhere; }
th,td { border:1px solid var(--vscode-panel-border,rgba(128,128,128,.3)); padding:3px 7px; text-align:left; }
th { background:rgba(128,128,128,.12); }
blockquote { margin:.5em 0; padding-left:10px; border-left:3px solid rgba(128,128,128,.4); opacity:.9; }
hr { border:none; border-top:1px solid var(--vscode-panel-border,rgba(128,128,128,.3)); margin:1em 0; }
a.lnk { color:var(--vscode-textLink-foreground); }
img.inline-img { max-width:100%; border-radius:4px; }
.progress { margin:.5em 0; }
.prow { display:flex; align-items:center; gap:8px; margin:3px 0; font-size:.92em; min-width:0; }
.plabel { flex:0 1 34%; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pbar { flex:1 1 auto; min-width:32px; height:7px; border-radius:4px; background:rgba(128,128,128,.25); overflow:hidden; }
.pfill { display:block; height:100%; background:var(--vscode-progressBar-background,#4aa3ff); }
.ppct { flex:none; width:3.2em; text-align:right; opacity:.8; font-variant-numeric:tabular-nums; }
.pnote { flex:0 1 auto; min-width:0; opacity:.55; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.state.live { margin-top:-6px; }
.lhead { display:flex; align-items:center; gap:8px; font-size:.85em; margin-bottom:2px; min-width:0; }
.ltitle { font-weight:600; letter-spacing:.03em; text-transform:uppercase; opacity:.8; cursor:pointer;
  min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ltitle:hover { text-decoration:underline; }
.lwait { opacity:.55; font-size:.9em; }
.empty { opacity:.6; padding:24px 4px; line-height:1.6; }
.err { color:var(--vscode-errorForeground); }
/* conversation picker */
.bar select#conv { flex:1 1 auto; min-width:0; max-width:100%; font:inherit; font-size:.9em; padding:2px 4px; border-radius:5px;
  color:var(--vscode-dropdown-foreground,var(--vscode-foreground)); background:var(--vscode-dropdown-background,transparent);
  border:1px solid var(--vscode-dropdown-border,var(--vscode-panel-border,rgba(128,128,128,.3))); }
.expanded { padding-top:10px; } .expanded .card { margin-top:0; }
/* widgets: palette from the dataviz reference, validated against VS Code light and dark surfaces */
.wdg { position:relative; margin:.4em 0 .6em; --wsurf:var(--vscode-editorWidget-background,var(--vscode-editor-background));
  --s1:#2a78d6; --s2:#eb6834; --s3:#1baf7a; --s4:#eda100; --s5:#e87ba4; --s6:#008300; --s7:#4a3aa7; --s8:#e34948;
  --smute:#b8b7b0; --wgood:#006300; --wbad:#d03b3b; --wgrid:rgba(128,128,128,.18); --wbase:rgba(128,128,128,.45); }
body.vscode-dark .wdg, body.vscode-high-contrast:not(.vscode-high-contrast-light) .wdg {
  --s1:#3987e5; --s2:#d95926; --s3:#199e70; --s4:#c98500; --s5:#d55181; --s6:#008300; --s7:#9085e9; --s8:#e66767;
  --smute:#5a5955; --wgood:#0ca30c; --wbad:#e66767; }
.wdg .s1 { --c:var(--s1); } .wdg .s2 { --c:var(--s2); } .wdg .s3 { --c:var(--s3); } .wdg .s4 { --c:var(--s4); }
.wdg .s5 { --c:var(--s5); } .wdg .s6 { --c:var(--s6); } .wdg .s7 { --c:var(--s7); } .wdg .s8 { --c:var(--s8); }
.wdg .sm { --c:var(--smute); }
.wh { display:flex; align-items:flex-start; gap:8px; margin-bottom:4px; }
.wt { min-width:0; margin-right:auto; }
.wtitle { font-weight:600; } .wsub { font-size:.85em; opacity:.65; }
.wbtn { font-size:.8em; padding:1px 7px; flex:none; }
.wsvg { display:block; overflow:visible; }
.wplot { position:relative; }
.wgrid { stroke:var(--wgrid); stroke-width:1; } .wbase { stroke:var(--wbase); stroke-width:1; }
.wax { fill:var(--vscode-descriptionForeground,currentColor); font-size:11px; font-variant-numeric:tabular-nums; opacity:.85; }
.wlab { fill:var(--vscode-foreground); font-size:11px; }
.wline { fill:none; stroke:var(--c); stroke-width:2; stroke-linejoin:round; stroke-linecap:round; }
.warea { fill:var(--c); opacity:.1; stroke:none; }
.wdot { fill:var(--c); stroke:var(--wsurf); stroke-width:2; }
.wring { fill:none; stroke:var(--vscode-foreground); stroke-width:1.5; opacity:.7; pointer-events:none; }
.wbar { fill:var(--c); outline:none; transition:opacity .1s; } .wbar.dim { opacity:.35; }
.wbar:focus-visible, .wcell:focus-visible, .whit:focus-visible { outline:1px solid var(--vscode-focusBorder); }
.wcell { outline:none; } .wcell.on { stroke:var(--vscode-foreground); stroke-width:1.5; }
.wcellt { font-size:10px; fill:#0b0b0b; pointer-events:none; } .wcellt.inv { fill:#fff; }
.wcross { stroke:var(--vscode-foreground); stroke-width:1; opacity:.35; pointer-events:none; }
.whit { fill:transparent; outline:none; cursor:crosshair; }
.wkey { flex:none; overflow:visible; } .wkey .ln { stroke:var(--c); stroke-width:2; stroke-linecap:round; } .wkey .fl { fill:var(--c); }
.wlg { display:flex; flex-wrap:wrap; gap:4px 12px; margin:2px 0 6px; font-size:.85em; }
.wlgi { display:inline-flex; align-items:center; gap:5px; border:none; background:none; padding:1px 2px; cursor:pointer; }
.wlgi:hover { background:var(--vscode-toolbar-hoverBackground,rgba(128,128,128,.18)); }
.wlgi.off { opacity:.4; } .wlgi.off span { text-decoration:line-through; }
.wtip { position:absolute; z-index:4; pointer-events:none; min-width:90px; max-width:260px; padding:6px 8px; border-radius:6px;
  font-size:.85em; background:var(--vscode-editorHoverWidget-background,var(--vscode-editorWidget-background));
  color:var(--vscode-editorHoverWidget-foreground,var(--vscode-foreground));
  border:1px solid var(--vscode-editorHoverWidget-border,rgba(128,128,128,.35)); box-shadow:0 2px 8px rgba(0,0,0,.18); }
.wtiph { opacity:.7; margin-bottom:3px; } .wtipr { display:flex; align-items:center; gap:6px; line-height:1.5; white-space:nowrap; }
.wtipr strong { font-variant-numeric:tabular-nums; } .wtipn { opacity:.7; overflow:hidden; text-overflow:ellipsis; }
.wnote { font-size:.8em; opacity:.6; margin-top:3px; }
.wtbl .wscroll { max-height:340px; overflow:auto; }
.wtbl table { table-layout:auto; } .wtbl th { cursor:pointer; user-select:none; white-space:nowrap; position:sticky; top:0; }
.wtbl th, .wtbl td { padding:2px 7px; } .wtbl .num { text-align:right; font-variant-numeric:tabular-nums; }
.wfilter { width:100%; box-sizing:border-box; font:inherit; font-size:.9em; margin:2px 0 5px; padding:3px 7px; border-radius:5px;
  color:var(--vscode-input-foreground); background:var(--vscode-input-background);
  border:1px solid var(--vscode-input-border,var(--vscode-panel-border,rgba(128,128,128,.35))); }
.wramp { display:flex; align-items:center; gap:2px; font-size:.8em; opacity:.8; margin-top:4px; }
.wramp span:first-child { margin-right:4px; } .wramp span:last-child { margin-left:4px; }
.wsw { width:16px; height:8px; border-radius:2px; }
.wstats { display:flex; flex-wrap:wrap; gap:10px; }
.wstat { flex:1 1 120px; min-width:0; padding:8px 10px; border-radius:6px; border:1px solid var(--vscode-panel-border,rgba(128,128,128,.25)); }
.wsl { font-size:.85em; opacity:.7; } .wsv { font-size:1.6em; font-weight:600; line-height:1.2; margin:2px 0; }
.wsd { font-size:.85em; } .wsd.good { color:var(--wgood); } .wsd.bad { color:var(--wbad); } .wsvs { opacity:.6; color:var(--vscode-foreground); }
.wspark { display:block; margin-top:4px; overflow:visible; }
.wdg-err { border-left:3px solid var(--vscode-errorForeground); padding:4px 8px; font-size:.9em; }
.wdg-err strong { color:var(--vscode-errorForeground); }</style></head><body>
${content}
<script nonce="${nonce}" src="${widgetJs}"></script>
<script nonce="${nonce}">
const vs = acquireVsCodeApi();
// merge, never replace: several things keep state here (scroll, tasks toggle, widgets, drafts)
const put = (k, v) => vs.setState(Object.assign({}, vs.getState() || {}, { [k]: v }));
const st = vs.getState() || {};
put('board', ${saved});          // what a restored tab reopens with
const block = document.getElementById('tasksBlock');
if (block) {
  block.open = st.tasksOpen !== false;
  block.addEventListener('toggle', () => put('tasksOpen', block.open));
}
const on = (id, f) => { const e = document.getElementById(id); if (e) e.onclick = f; };
on('refresh', () => vs.postMessage({ type: 'refresh' }));
on('clear', () => vs.postMessage({ type: 'clear' }));
on('tab', () => vs.postMessage({ type: 'tab' }));
on('cleardone', () => vs.postMessage({ type: 'task', action: 'clearDone' }));
on('edittasks', () => vs.postMessage({ type: 'task', action: 'edit' }));
const conv = document.getElementById('conv');
if (conv) conv.onchange = () => vs.postMessage({ type: 'view', value: conv.value });
// a half-typed task survives any re-render of the board
const nt = document.getElementById('newtask');
if (nt) {
  if (st.draft) nt.value = st.draft;
  if (st.draftFocus) { nt.focus(); const c = Math.min(st.draftCaret ?? nt.value.length, nt.value.length); nt.setSelectionRange(c, c); }
  const keep = () => vs.setState(Object.assign({}, vs.getState() || {}, { draft: nt.value, draftFocus: document.activeElement === nt, draftCaret: nt.selectionStart }));
  nt.addEventListener('input', keep); nt.addEventListener('focus', keep); nt.addEventListener('blur', keep);
  nt.addEventListener('keyup', keep);
  nt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && nt.value.trim()) {
      vs.postMessage({ type: 'task', action: 'add', text: nt.value.trim() });
      nt.value = ''; keep();
    }
  });
}
document.addEventListener('click', (e) => {
  const row = e.target.closest('[data-task]');
  if (row) { row.classList.toggle('done'); vs.postMessage({ type: 'task', action: 'toggle', idx: +row.dataset.task }); return; }
  const rr = e.target.closest('[data-rerun]');
  if (rr) { vs.postMessage({ type: 'rerun', name: rr.dataset.rerun }); return; }
  const ex = e.target.closest('[data-expand]');
  if (ex) { vs.postMessage({ type: 'expand', path: ex.dataset.expand }); return; }
  const del = e.target.closest('[data-del]');
  if (del) { vs.postMessage({ type: 'delete', path: del.dataset.del }); return; }
  const open = e.target.closest('[data-open]');
  if (open) vs.postMessage({ type: 'open', path: open.dataset.open });
});
const store = {
  get: (k) => ((vs.getState() || {}).widgets || {})[k] || {},
  set: (k, v) => { const w = Object.assign({}, (vs.getState() || {}).widgets || {}); w[k] = v; put('widgets', w); },
};
if (window.CanvasWidgets) CanvasWidgets.mount(document, store);
// live blocks are swapped in place, so a refresh never clobbers a half-typed task
window.addEventListener('message', (e) => {
  const lv = document.getElementById('live');
  if (e.data && e.data.type === 'live' && lv) {
    lv.innerHTML = e.data.html;
    if (window.CanvasWidgets) CanvasWidgets.mount(lv, store);
  }
});
window.scrollTo(0, st.scroll || 0);
window.addEventListener('scroll', () => put('scroll', window.scrollY));
</script></body></html>`;
}

function buildHtml(b) {
  b.srcs = new Map();
  if (!canvasDir()) return page(b, '<div class="empty">Open a folder to use Claude Canvas.</div>');

  // a single card, opened in its own tab
  if (b.card) {
    let st = null;
    try { st = fs.statSync(b.card); } catch (e) {}
    if (!st) return page(b, `<div class="empty">This card was removed.<br><code>${md.escapeHtml(b.card)}</code></div>`);
    const ext = path.extname(b.card).toLowerCase();
    const item = { abs: b.card, name: path.basename(b.card), ext, mtime: st.mtimeMs, kind: IMG_EXT.has(ext) ? 'image' : 'text' };
    return page(b, `<div class="expanded">${cardHtml(item, b, { expanded: true })}</div>`);
  }

  const id = shownId(b);
  const dir = boardDir(id);
  let state = '';
  try {
    const p = path.join(dir, 'state.md');
    if (fs.existsSync(p)) state = renderMd(fs.readFileSync(p, 'utf8'), b, dir);
  } catch (e) {}
  const cards = readFeed(dir).map((it) => cardHtml(it, b)).join('\n');
  const liveBlocks = liveHtml(b);
  const bar = `<div class="bar">${pickerHtml(b)}
  ${b.kind === 'view' ? '<button id="tab" title="Open this conversation in an editor tab">⧉</button>' : ''}
  <button id="clear" title="Remove every card from this board">Clear</button>
  <button id="refresh" title="Re-read from disk">↻</button>
</div>`;
  const empty = !state && !cards && !liveBlocks
    ? '<div class="empty">Nothing on this board yet.<br>Claude writes <code>state.md</code> and drops cards into <code>feed/</code>.</div>' : '';
  return page(b, `${bar}
${tasksHtml(path.join(dir, 'tasks.md'))}
${state ? `<div class="state" data-scope="state">${state}</div>` : ''}
<div id="live">${liveBlocks}</div>
${cards}${empty}`);
}

// ---- activation --------------------------------------------------------------------------------

function activate(ctx) {
  ensureDirs();
  const boards = new Set();
  let timer = null;
  let sidebar = null;

  const render = (b) => {
    b.webview.html = buildHtml(b);
    if (b.kind !== 'view' && b.host) {
      const title = b.card ? path.basename(b.card)
        : (conversations().find((c) => c.id === shownId(b)) || { title: 'Shared' }).title;
      b.host.title = `Canvas · ${title}`;
    }
  };
  const visible = (b) => b.host.visible !== false;

  const reveal = () => {
    if (sidebar) { try { sidebar.host.show(true); return; } catch (e) {} }
    vscode.commands.executeCommand('claudeCanvas.board.focus');
  };

  // `.open` sentinel: anything that can write a file can bring the board up. It may hold a session
  // id, which a following board switches to.
  const consumeSentinel = () => {
    const dir = canvasDir();
    if (!dir) return false;
    const flag = path.join(dir, '.open');
    if (!fs.existsSync(flag)) return false;
    let id = '';
    try { id = fs.readFileSync(flag, 'utf8').trim(); } catch (e) {}
    try { fs.unlinkSync(flag); } catch (e) {}
    if (id && /^[\w-]+$/.test(id) && fs.existsSync(boardDir(id) || '')) lastActive = id;
    reveal();
    return true;
  };

  const badge = () => {
    if (!sidebar) return;
    const open = tasks.openCount(tasks.parse(tasks.read(path.join(boardDir(shownId(sidebar)), 'tasks.md'))));
    try { sidebar.host.badge = open ? { value: open, tooltip: `${open} open task${open === 1 ? '' : 's'}` } : undefined; } catch (e) {}
  };
  const refresh = () => {
    for (const b of boards) if (visible(b)) render(b);
    badge();
  };
  let newCardIn = null;
  const schedule = (id, isNewCard) => {
    if (isNewCard) newCardIn = id;
    clearTimeout(timer);
    timer = setTimeout(() => {
      const opened = consumeSentinel();
      refresh();
      if (!opened && newCardIn && sidebar && shownId(sidebar) === newCardIn &&
        cfg().get('autoReveal', 'always') === 'always') reveal();
      newCardIn = null;
    }, 150);
  };

  const pushLive = (script) => {
    for (const b of boards) {
      if (b.card || !visible(b)) continue;
      const dir = boardDir(shownId(b));
      if (script && !script.startsWith(dir + path.sep)) continue;
      b.webview.postMessage({ type: 'live', html: liveHtml(b) });
    }
  };
  // Live blocks run for the boards someone can see, and only those.
  const shownDirs = () => [...boards].filter((b) => !b.card && visible(b)).map((b) => boardDir(shownId(b))).filter(Boolean);
  runner = live.createRunner(shownDirs, workspaceRoot, pushLive);
  const tickLive = (force) => { if (liveAllowed()) runner.tick(force); };
  // Every 5 s: run due live blocks, and re-render any board whose widget data files changed.
  const ticker = setInterval(() => {
    tickLive(false);
    for (const b of boards) {
      if (!visible(b) || !b.srcs) continue;
      for (const [f, t] of b.srcs) if (mtime(f) !== t) { render(b); break; }
    }
  }, live.MIN_EVERY * 1000);
  ctx.subscriptions.push({ dispose: () => { clearInterval(ticker); runner.dispose(); } });
  ctx.subscriptions.push(vscode.workspace.onDidGrantWorkspaceTrust(() => { refresh(); tickLive(true); }));

  const openTab = (view, card) => {
    const panel = vscode.window.createWebviewPanel('claudeCanvas.panel', 'Claude Canvas',
      vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
    adopt(panel, 'tab', view, card);
  };

  // Hook up a sidebar view or an editor tab. Each board keeps its own conversation choice.
  function adopt(host, kind, view, card) {
    const b = { host, kind, webview: host.webview, view, card: card || null, extUri: ctx.extensionUri, srcs: new Map() };
    host.webview.options = { enableScripts: true, localResourceRoots: [ctx.extensionUri, vscode.Uri.file('/')] };
    if (kind !== 'view') host.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'canvas.svg');
    boards.add(b);
    if (kind === 'view') sidebar = b;
    host.webview.onDidReceiveMessage((m) => onMessage(b, m), null, ctx.subscriptions);
    const vis = kind === 'view' ? host.onDidChangeVisibility : host.onDidChangeViewState;
    vis(() => { if (visible(b)) { render(b); tickLive(false); } }, null, ctx.subscriptions);
    host.onDidDispose(() => { boards.delete(b); if (sidebar === b) sidebar = null; }, null, ctx.subscriptions);
    render(b);
    badge();
    setTimeout(() => tickLive(false), 0);
    return b;
  }

  async function onMessage(b, m) {
    const dir = () => boardDir(shownId(b));
    if (m.type === 'refresh') render(b);
    else if (m.type === 'view') {
      b.view = m.value === FOLLOW ? { mode: FOLLOW } : { mode: 'pinned', id: String(m.value) };
      if (b.kind === 'view') ctx.workspaceState.update('claudeCanvas.view', b.view);
      render(b); badge(); tickLive(false);
    } else if (m.type === 'tab') {
      openTab({ mode: 'pinned', id: shownId(b) });
    } else if (m.type === 'expand') {
      if (m.path) openTab({ mode: FOLLOW }, m.path);
    } else if (m.type === 'open') {
      const uri = vscode.Uri.file(m.path);
      if (IMG_EXT.has(path.extname(m.path).toLowerCase())) {
        await vscode.commands.executeCommand('vscode.open', uri, { preview: true, viewColumn: vscode.ViewColumn.Active });
      } else {
        await vscode.window.showTextDocument(uri, { preview: true });
      }
    } else if (m.type === 'delete') {
      try { fs.unlinkSync(m.path); } catch (e) {}
      try { fs.unlinkSync(m.path.replace(/\.[^.]+$/, '.caption.md')); } catch (e) {}
      refresh();
    } else if (m.type === 'rerun') {
      if (runner && liveAllowed()) { runner.invalidate(path.join(dir(), 'live', m.name + '.sh')); tickLive(false); }
    } else if (m.type === 'clear') {
      await clearFeed(dir());
    } else if (m.type === 'task') {
      const file = path.join(dir(), 'tasks.md');
      if (m.action === 'toggle') tasks.toggle(file, m.idx);
      else if (m.action === 'add' && m.text) tasks.add(file, m.text);
      else if (m.action === 'clearDone') tasks.clearDone(file);
      else if (m.action === 'edit') { await vscode.window.showTextDocument(vscode.Uri.file(file)); return; }
      refresh();
    }
  }

  async function clearFeed(dir) {
    if (!dir) return;
    const pick = await vscode.window.showWarningMessage('Remove every card from this Claude Canvas board?',
      { modal: true }, 'Clear feed');
    if (pick !== 'Clear feed') return;
    const feedDir = path.join(dir, 'feed');
    try {
      for (const n of fs.readdirSync(feedDir)) { try { fs.unlinkSync(path.join(feedDir, n)); } catch (e) {} }
    } catch (e) {}
    refresh();
  }

  ctx.subscriptions.push(vscode.window.registerWebviewViewProvider('claudeCanvas.board', {
    resolveWebviewView(view) {
      adopt(view, 'view', ctx.workspaceState.get('claudeCanvas.view') || { mode: FOLLOW });
    },
  }, { webviewOptions: { retainContextWhenHidden: true } }));

  // Tabs come back after a window reload, showing what they showed before.
  ctx.subscriptions.push(vscode.window.registerWebviewPanelSerializer('claudeCanvas.panel', {
    async deserializeWebviewPanel(panel, state) {
      const saved = (state && state.board) || {};
      adopt(panel, 'tab', saved.view || { mode: FOLLOW }, saved.card || null);
    },
  }));

  ctx.subscriptions.push(vscode.commands.registerCommand('claudeCanvas.focus', () => reveal()));
  ctx.subscriptions.push(vscode.commands.registerCommand('claudeCanvas.openPanel', () => {
    openTab(sidebar ? { mode: 'pinned', id: shownId(sidebar) } : { mode: FOLLOW });
  }));
  ctx.subscriptions.push(vscode.commands.registerCommand('claudeCanvas.openTasks', async () => {
    ensureDirs();
    const d = boardDir(sidebar ? shownId(sidebar) : latestId());
    if (d) await vscode.window.showTextDocument(vscode.Uri.file(path.join(d, 'tasks.md')));
  }));
  ctx.subscriptions.push(vscode.commands.registerCommand('claudeCanvas.newSession', async () => {
    ensureDirs();
    const d = boardDir(sidebar ? shownId(sidebar) : latestId());
    if (!d) return;
    const title = await vscode.window.showInputBox({
      prompt: 'Title for the new task session',
      value: new Date().toISOString().slice(0, 10) + ' — ',
    });
    if (!title) return;
    tasks.newSession(path.join(d, 'tasks.md'), title.trim());
    refresh();
  }));
  ctx.subscriptions.push(vscode.commands.registerCommand('claudeCanvas.revealFolder', async () => {
    const d = ensureDirs();
    if (d) await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(d));
  }));
  ctx.subscriptions.push(vscode.commands.registerCommand('claudeCanvas.clearFeed', async () => {
    await clearFeed(boardDir(sidebar ? shownId(sidebar) : latestId()));
  }));

  // One watcher over the whole canvas folder. Paths are relative to it: `feed/x.png` is the
  // Shared board, `sessions/<id>/feed/x.png` a conversation's.
  const onFs = (relRaw) => {
    const rel = String(relRaw || '').split(path.sep).join('/');
    if (!rel || rel === '.open') { schedule(null, false); return; }
    if (rel.startsWith('.')) return;   // bookkeeping (.pids/, .workspace, .gitignore), not board content
    let id = SHARED, rest = rel;
    if (rel.startsWith('sessions/')) {
      const parts = rel.split('/');
      if (parts.length < 3) return;          // the session dir itself; its files follow
      id = parts[1]; rest = parts.slice(2).join('/');
    }
    if (rest.startsWith('live') && !rest.endsWith('.sh')) return;   // runner output, pushed in place
    lastActive = id;
    if (rest.startsWith('live')) {
      runner.invalidate(path.join(boardDir(id), rest));
      schedule(id, false);
      setTimeout(() => tickLive(false), 200);
      return;
    }
    schedule(id, rest.startsWith('feed'));
  };
  const dir = canvasDir();
  if (dir) {
    try {
      const w = fs.watch(dir, { recursive: true }, (_ev, name) => onFs(name));
      ctx.subscriptions.push({ dispose: () => w.close() });
    } catch (e) {
      const fsw = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(dir), '**/*'));
      const rel = (u) => path.relative(dir, u.fsPath);
      fsw.onDidChange((u) => onFs(rel(u)));
      fsw.onDidCreate((u) => onFs(rel(u)));
      fsw.onDidDelete((u) => onFs(rel(u)));
      ctx.subscriptions.push(fsw);
    }
  }

  setTimeout(consumeSentinel, 400);

  ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('claudeCanvas')) { refresh(); tickLive(false); }
  }));
}

function deactivate() {}
module.exports = { activate, deactivate };
