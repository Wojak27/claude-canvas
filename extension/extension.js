'use strict';
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const md = require('./markdown.js');
const tasks = require('./tasks.js');

const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.avif']);
const TEXT_EXT = new Set(['.md', '.markdown', '.txt', '.log', '.json', '.csv']);

const cfg = () => vscode.workspace.getConfiguration('claudeCanvas');

function canvasDir() {
  const ws = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0];
  if (!ws) return null;
  return path.join(ws.uri.fsPath, cfg().get('folder', '.claude/canvas'));
}

function tasksFile() {
  const dir = canvasDir();
  return dir ? path.join(dir, 'tasks.md') : null;
}

function ensureDirs() {
  const dir = canvasDir();
  if (!dir) return null;
  try {
    fs.mkdirSync(path.join(dir, 'feed'), { recursive: true });
    const state = path.join(dir, 'state.md');
    if (!fs.existsSync(state)) {
      fs.writeFileSync(state,
        '# Nothing on the board yet\n\nClaude writes the current state here and drops cards in `feed/`.\n');
    }
    const t = path.join(dir, 'tasks.md');
    if (!fs.existsSync(t)) fs.writeFileSync(t, '# Tasks\n');
  } catch (e) { /* read-only workspace is fine */ }
  return dir;
}

function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(ms).toLocaleString();
}

function readFeed() {
  const dir = canvasDir();
  if (!dir) return [];
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

function cardHtml(item, webview) {
  const resolve = imgResolver(webview, path.dirname(item.abs));
  const head = `<div class="chead"><span class="cname" data-open="${md.escapeHtml(item.abs)}">${md.escapeHtml(item.name)}</span>` +
    `<span class="cmeta">${ago(item.mtime)}</span>` +
    `<button class="x" data-del="${md.escapeHtml(item.abs)}" title="Remove card">×</button></div>`;

  if (item.kind === 'image') {
    let caption = '';
    const side = item.abs.replace(/\.[^.]+$/, '.caption.md');
    try { if (fs.existsSync(side)) caption = md.render(fs.readFileSync(side, 'utf8'), resolve); } catch (e) {}
    return `<div class="card img">${head}<a class="shot" data-open="${md.escapeHtml(item.abs)}">` +
      `<img src="${resolve(item.abs)}" alt="${md.escapeHtml(item.name)}"></a>` +
      (caption ? `<div class="cap">${caption}</div>` : '') + `</div>`;
  }

  let body = '';
  try {
    const raw = fs.readFileSync(item.abs, 'utf8');
    body = (item.ext === '.md' || item.ext === '.markdown')
      ? md.render(raw, resolve)
      : `<pre class="code"><code>${md.escapeHtml(raw)}</code></pre>`;
  } catch (e) { body = `<p class="err">Could not read ${md.escapeHtml(item.name)}</p>`; }
  return `<div class="card">${head}<div class="body">${body}</div></div>`;
}

function taskText(t) {
  let h = md.escapeHtml(t);
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/(^|\s)@([\w.-]+)/g, '$1<span class="chip at">@$2</span>');
  h = h.replace(/(^|\s)#([\w-]+)/g, '$1<span class="chip tag">#$2</span>');
  return h;
}

function tasksHtml() {
  const file = tasksFile();
  if (!file) return '<div class="empty">Open a folder to keep tasks.</div>';
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
        `<span class="box">${i.done ? '\u2713' : ''}</span><span class="ttext">${taskText(i.text)}</span></div>`;
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
    <span class="tsum">${open} open${doneAll ? ` \u00b7 ${doneAll} done` : ''}</span>
    <span class="pbar sbar"><span class="pfill" style="width:${pctAll}%"></span></span>
  </summary>
  <div class="tbody">
    ${body || '<div class="empty">No tasks yet.</div>'}
    <div class="addrow"><input id="newtask" type="text" placeholder="Add a task\u2026" autocomplete="off">
      <button id="cleardone" title="Remove finished tasks">Clear done</button>
      <button id="edittasks" title="Open tasks.md">Edit</button>
    </div>
  </div>
</details>`;
}

function buildHtml(webview, extUri) {
  const dir = canvasDir();
  const nonce = String(Math.random()).slice(2) + String(Date.now());
  const csp = `default-src 'none'; img-src ${webview.cspSource} https: data: vscode-resource:; ` +
    `style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};`;

  if (!dir) {
    return `<!DOCTYPE html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"></head>
      <body style="font-family:var(--vscode-font-family);padding:16px">Open a folder to use Claude Canvas.</body></html>`;
  }

  let state = '';
  try {
    const p = path.join(dir, 'state.md');
    if (fs.existsSync(p)) state = md.render(fs.readFileSync(p, 'utf8'), imgResolver(webview, dir));
  } catch (e) {}

  const items = readFeed();
  const cards = items.map((it) => cardHtml(it, webview)).join('\n');
  const tasksPane = tasksHtml();

  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<style>
:root { color-scheme: light dark; }
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
.empty { opacity:.6; padding:24px 4px; line-height:1.6; }
.err { color:var(--vscode-errorForeground); }
</style></head><body>
<div class="bar"><span class="t">CLAUDE CANVAS</span>
  <button id="folder" title="Reveal the canvas folder">Folder</button>
  <button id="clear" title="Remove every feed card">Clear</button>
  <button id="refresh" title="Re-read from disk">\u21bb</button>
</div>
${tasksPane}
${state ? `<div class="state">${state}</div>` : ''}
${cards || (state ? '' : '<div class="empty">Nothing on the board yet.<br>Claude writes <code>state.md</code> and drops cards into <code>feed/</code>.</div>')}
<script nonce="${nonce}">
const vs = acquireVsCodeApi();
const st = vs.getState() || {};
const block = document.getElementById('tasksBlock');
if (block) {
  block.open = st.tasksOpen !== false;
  block.addEventListener('toggle', () => vs.setState(Object.assign({}, vs.getState(), { tasksOpen: block.open })));
}
document.getElementById('refresh').onclick = () => vs.postMessage({ type: 'refresh' });
document.getElementById('folder').onclick = () => vs.postMessage({ type: 'folder' });
document.getElementById('clear').onclick = () => vs.postMessage({ type: 'clear' });
const cd = document.getElementById('cleardone');
if (cd) cd.onclick = () => vs.postMessage({ type: 'task', action: 'clearDone' });
const et = document.getElementById('edittasks');
if (et) et.onclick = () => vs.postMessage({ type: 'task', action: 'edit' });
const nt = document.getElementById('newtask');
if (nt) nt.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && nt.value.trim()) { vs.postMessage({ type: 'task', action: 'add', text: nt.value.trim() }); nt.value = ''; }
});
document.addEventListener('click', (e) => {
  const row = e.target.closest('[data-task]');
  if (row) { row.classList.toggle('done'); vs.postMessage({ type: 'task', action: 'toggle', idx: +row.dataset.task }); return; }
  const del = e.target.closest('[data-del]');
  if (del) { vs.postMessage({ type: 'delete', path: del.dataset.del }); return; }
  const open = e.target.closest('[data-open]');
  if (open) vs.postMessage({ type: 'open', path: open.dataset.open });
});
const y = (vs.getState() || {}).scroll || 0;
window.scrollTo(0, y);
window.addEventListener('scroll', () => vs.setState({ scroll: window.scrollY }));
</script></body></html>`;
}

function wire(webview, extUri, ctx) {
  webview.options = {
    enableScripts: true,
    localResourceRoots: [extUri, vscode.Uri.file('/')],
  };
  webview.html = buildHtml(webview, extUri);
  return webview.onDidReceiveMessage(async (m) => {
    if (m.type === 'refresh') webview.html = buildHtml(webview, extUri);
    else if (m.type === 'open') {
      const uri = vscode.Uri.file(m.path);
      if (IMG_EXT.has(path.extname(m.path).toLowerCase())) {
        await vscode.commands.executeCommand('vscode.open', uri, { preview: true, viewColumn: vscode.ViewColumn.Active });
      } else {
        await vscode.window.showTextDocument(uri, { preview: true });
      }
    } else if (m.type === 'folder') {
      const dir = ensureDirs();
      if (dir) await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(dir));
    } else if (m.type === 'delete') {
      try { fs.unlinkSync(m.path); } catch (e) {}
      try { fs.unlinkSync(m.path.replace(/\.[^.]+$/, '.caption.md')); } catch (e) {}
      webview.html = buildHtml(webview, extUri);
    } else if (m.type === 'clear') {
      await vscode.commands.executeCommand('claudeCanvas.clearFeed');
    } else if (m.type === 'task') {
      const file = tasksFile();
      if (!file) return;
      if (m.action === 'toggle') tasks.toggle(file, m.idx);
      else if (m.action === 'add' && m.text) tasks.add(file, m.text);
      else if (m.action === 'clearDone') tasks.clearDone(file);
      else if (m.action === 'edit') { await vscode.window.showTextDocument(vscode.Uri.file(file)); return; }
      webview.html = buildHtml(webview, extUri);
    }
  }, null, ctx.subscriptions);
}

function activate(ctx) {
  ensureDirs();
  const boards = new Set();
  let timer = null;

  const reveal = () => {
    let shown = false;
    for (const b of boards) {
      try { if (typeof b.show === 'function') { b.show(true); shown = true; } } catch (e) {}
      try { if (typeof b.reveal === 'function') { b.reveal(undefined, false); shown = true; } } catch (e) {}
    }
    if (!shown) vscode.commands.executeCommand('claudeCanvas.board.focus');
  };

  // `.open` sentinel: anything that can write a file can bring the board up.
  const consumeSentinel = () => {
    const dir = canvasDir();
    if (!dir) return false;
    const flag = path.join(dir, '.open');
    if (!fs.existsSync(flag)) return false;
    try { fs.unlinkSync(flag); } catch (e) {}
    reveal();
    return true;
  };

  const refresh = () => {
    const tf = tasksFile();
    const open = tf ? tasks.openCount(tasks.parse(tasks.read(tf))) : 0;
    for (const b of boards) {
      if (b.visible !== false) b.webview.html = buildHtml(b.webview, ctx.extensionUri);
      try {
        if (b.badge !== undefined || b.viewType === 'claudeCanvas.board') {
          b.badge = open ? { value: open, tooltip: `${open} open task${open === 1 ? '' : 's'}` } : undefined;
        }
      } catch (e) { /* badge unsupported */ }
    }
  };
  const schedule = (isNewCard) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const opened = consumeSentinel();
      refresh();
      if (!opened && isNewCard && cfg().get('autoReveal', 'always') === 'always') reveal();
    }, 150);
  };

  const provider = {
    resolveWebviewView(view) {
      view.webview.options = { enableScripts: true, localResourceRoots: [ctx.extensionUri, vscode.Uri.file('/')] };
      boards.add(view);
      wire(view.webview, ctx.extensionUri, ctx);
      view.onDidChangeVisibility(() => { if (view.visible) view.webview.html = buildHtml(view.webview, ctx.extensionUri); });
      view.onDidDispose(() => boards.delete(view));
      setTimeout(refresh, 0);
    },
  };
  ctx.subscriptions.push(vscode.window.registerWebviewViewProvider('claudeCanvas.board', provider,
    { webviewOptions: { retainContextWhenHidden: true } }));

  ctx.subscriptions.push(vscode.commands.registerCommand('claudeCanvas.focus', () => reveal()));

  ctx.subscriptions.push(vscode.commands.registerCommand('claudeCanvas.openPanel', () => {
    const panel = vscode.window.createWebviewPanel('claudeCanvas.panel', 'Claude Canvas',
      vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
    panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, 'media', 'canvas.svg');
    boards.add(panel);
    wire(panel.webview, ctx.extensionUri, ctx);
    panel.onDidDispose(() => boards.delete(panel));
  }));

  ctx.subscriptions.push(vscode.commands.registerCommand('claudeCanvas.openTasks', async () => {
    ensureDirs();
    const file = tasksFile();
    if (file) await vscode.window.showTextDocument(vscode.Uri.file(file));
  }));

  ctx.subscriptions.push(vscode.commands.registerCommand('claudeCanvas.newSession', async () => {
    ensureDirs();
    const file = tasksFile();
    if (!file) return;
    const title = await vscode.window.showInputBox({
      prompt: 'Title for the new task session',
      value: new Date().toISOString().slice(0, 10) + ' \u2014 ',
    });
    if (!title) return;
    tasks.newSession(file, title.trim());
    refresh();
  }));

  ctx.subscriptions.push(vscode.commands.registerCommand('claudeCanvas.revealFolder', async () => {
    const dir = ensureDirs();
    if (dir) await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(dir));
  }));

  ctx.subscriptions.push(vscode.commands.registerCommand('claudeCanvas.clearFeed', async () => {
    const dir = canvasDir();
    if (!dir) return;
    const pick = await vscode.window.showWarningMessage('Remove every card from the Claude Canvas feed?',
      { modal: true }, 'Clear feed');
    if (pick !== 'Clear feed') return;
    const feedDir = path.join(dir, 'feed');
    try {
      for (const n of fs.readdirSync(feedDir)) { try { fs.unlinkSync(path.join(feedDir, n)); } catch (e) {} }
    } catch (e) {}
    refresh();
  }));

  const dir = canvasDir();
  if (dir) {
    try {
      const w = fs.watch(dir, { recursive: true }, (_ev, name) => {
        schedule(!!name && String(name).startsWith('feed'));
      });
      ctx.subscriptions.push({ dispose: () => w.close() });
    } catch (e) {
      const fsw = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(dir), '**/*'));
      fsw.onDidChange(() => schedule(false));
      fsw.onDidCreate(() => schedule(true));
      fsw.onDidDelete(() => schedule(false));
      ctx.subscriptions.push(fsw);
    }
  }

  setTimeout(consumeSentinel, 400);

  ctx.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('claudeCanvas')) refresh();
  }));
}

function deactivate() {}
module.exports = { activate, deactivate };
