// Extension behaviour against a mocked VS Code API: picker, tabs, expand, live runs, widget data
// polling, follow mode. Run through tests/run.sh, which builds the fixture workspace.
const fs = require('fs'), path = require('path');
// `require('vscode')` resolves to the mock (kept out of node_modules, which .gitignore drops)
const Module = require('module');
const resolve0 = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  return req === 'vscode' ? path.join(__dirname, 'vscode-mock.js') : resolve0.call(this, req, ...rest);
};
const vscode = require('vscode');
const ext = require(path.join(__dirname, '..', 'extension', 'extension.js'));
const ws = process.env.WS, top = ws + '/.claude/canvas';
const ctx = { subscriptions: [], extensionUri: vscode.Uri.file(path.join(__dirname, '..', 'extension')), workspaceState: { get: () => undefined, update: () => {} } };
ext.activate(ctx);
const view = vscode._host('view');
vscode._reg.views['claudeCanvas.board'].resolveWebviewView(view);
const sel = () => (view.webview.html.match(/<option value="([^"]+)" selected>([^<]*)/) || []).slice(1).join(' => ');
let failed = 0;
const ok = (c, m) => { if (!c) failed++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
(async () => {
  console.log('picker:', sel());
  await view.onMsg({ type: 'view', value: 'bbb222' });
  ok(/x\.png/.test(view.webview.html) && sel().startsWith('bbb222'), 'picker pins bbb222 (its image card shows)');
  await view.onMsg({ type: 'tab' });
  const tab = vscode._panels[0];
  ok(tab && /Canvas · Conversation bbb222/.test(tab.title), 'tab button opens a tab on the same conversation: ' + (tab && tab.title));
  await view.onMsg({ type: 'view', value: 'aaa111' });
  ok(/Conversation bbb222/.test(tab.title) && !/Conversation bbb222/.test(sel()), 'sidebar and tab keep separate choices');
  const card = fs.readdirSync(top + '/sessions/aaa111/feed').find((n) => n.endsWith('.widget.json'));
  await view.onMsg({ type: 'expand', path: top + '/sessions/aaa111/feed/' + card });
  ok(vscode._panels.length === 2 && vscode._panels[1].title.includes(card), 'expand opens the card in its own tab');
  // live: the extension runs the visible board's blocks and writes status files
  await new Promise((r) => setTimeout(r, 1500));
  const st = JSON.parse(fs.readFileSync(top + '/sessions/aaa111/live/okblk.status.json', 'utf8'));
  ok(st.exit === 0 && Date.now() - Date.parse(st.at) < 5000, 'extension ran okblk and wrote status.json');
  ok(view.messages.some((m) => m.type === 'live' && /cwd=ws/.test(m.html)), 'live output pushed in place');
  ok(view.messages.some((m) => m.type === 'live' && /exit 4/.test(m.html)), 'failing block shows its exit code');
  // src polling: append to the CSV, the board re-renders within one tick
  const before = view.webview.html;
  fs.appendFileSync(ws + '/results/train_log.csv', '41,paired,0.7777,0.4\n');
  await new Promise((r) => setTimeout(r, 6000));
  ok(view.webview.html !== before && view.webview.html.includes('0.7777'), 'widget re-rendered after its CSV changed');
  // removing tasks and sessions from the panel
  const tf = top + '/sessions/bbb222/tasks.md';
  fs.writeFileSync(tf, '# Tasks\n\n## keep\n- [ ] one\n- [x] two\n\n## drop\n- [ ] three\n');
  await view.onMsg({ type: 'view', value: 'bbb222' });
  await view.onMsg({ type: 'task', action: 'remove', idx: 1, text: 'something else' });
  ok(fs.readFileSync(tf, 'utf8').includes('- [x] two'), 'remove refuses when the row changed underneath');
  await view.onMsg({ type: 'task', action: 'remove', idx: 1, text: 'two' });
  ok(!fs.readFileSync(tf, 'utf8').includes('two') && fs.readFileSync(tf, 'utf8').includes('one'), 'task \u00d7 removes exactly that row');
  const dropLine = fs.readFileSync(tf, 'utf8').split('\n').indexOf('## drop');
  vscode.window.showWarningMessage = async () => undefined;           // user cancels
  await view.onMsg({ type: 'task', action: 'removeSection', line: dropLine, title: 'drop', n: 1 });
  ok(fs.readFileSync(tf, 'utf8').includes('## drop'), 'cancelled section removal keeps it');
  vscode.window.showWarningMessage = async () => 'Remove';            // user confirms
  await view.onMsg({ type: 'task', action: 'removeSection', line: dropLine, title: 'drop', n: 1 });
  const left = fs.readFileSync(tf, 'utf8');
  ok(!left.includes('drop') && !left.includes('three') && left.includes('## keep') && left.includes('one'), 'section \u00d7 removes that session only');
  ok(/data-trm=/.test(view.webview.html) && /data-srm=/.test(view.webview.html), 'rows and session headers carry remove buttons');

  // a new conversation becomes the followed one
  await view.onMsg({ type: 'view', value: 'follow' });
  fs.mkdirSync(top + '/sessions/ccc333/feed', { recursive: true });
  fs.writeFileSync(top + '/sessions/ccc333/feed/n.md', 'hi from C');
  await new Promise((r) => setTimeout(r, 800));
  ok(/hi from C/.test(view.webview.html), 'follow mode switches to the conversation that just wrote: ' + sel());
  for (const d of ctx.subscriptions) try { d.dispose(); } catch (e) {}
  process.exit(failed ? 1 : 0);
})();
