'use strict';
// tasks.md is the single source of truth: plain markdown, `## ` sections per
// session, `- [ ] ` / `- [x] ` lines. Both Claude and the panel edit it in place.
const fs = require('fs');

const TASK_RE = /^(\s*)([-*])\s+\[([ xX])\]\s+(.*)$/;
const HEAD_RE = /^(#{1,6})\s+(.*)$/;

function read(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch (e) { return ''; }
}

function parse(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const items = [];
  let idx = 0;
  lines.forEach((l, line) => {
    const h = l.match(HEAD_RE);
    if (h) { items.push({ type: 'heading', level: h[1].length, text: h[2], line }); return; }
    const t = l.match(TASK_RE);
    if (t) {
      items.push({
        type: 'task', line, idx: idx++,
        indent: Math.min(3, Math.floor(t[1].replace(/\t/g, '  ').length / 2)),
        done: t[3].toLowerCase() === 'x', text: t[4],
      });
      return;
    }
    if (l.trim()) items.push({ type: 'text', text: l.trim(), line });
  });
  return items;
}

// A single shallowest heading is the document title ("# Tasks"), not a section.
function sectionLevel(items) {
  const levels = items.filter((i) => i.type === 'heading').map((i) => i.level);
  if (!levels.length) return 2;
  const lvl = Math.min(...levels);
  if (lvl === 1 && levels.filter((l) => l === 1).length === 1) {
    const deeper = levels.filter((l) => l > 1);
    return deeper.length ? Math.min(...deeper) : 2;
  }
  return lvl;
}

// Sections: everything under a heading of the section level, in file order.
function sections(items) {
  const top = sectionLevel(items);
  const secs = [];
  let cur = { title: null, level: top, items: [] };
  for (const it of items) {
    if (it.type === 'heading') {
      if (it.level < top) continue;            // document title, not a section
      if (it.level > top) { cur.items.push({ type: 'text', text: it.text, line: it.line }); continue; }
      if (cur.items.length || cur.title) secs.push(cur);
      cur = { title: it.text, level: it.level, items: [] };
    } else {
      cur.items.push(it);
    }
  }
  if (cur.items.length || cur.title) secs.push(cur);
  return secs.filter((s) => s.title !== null || s.items.length);
}

function openCount(items) {
  return items.filter((i) => i.type === 'task' && !i.done).length;
}

function write(file, lines) {
  fs.writeFileSync(file, lines.join('\n'));
}

function toggle(file, idx, force) {
  const text = read(file);
  const lines = text.split('\n');
  const t = parse(text).find((i) => i.type === 'task' && i.idx === idx);
  if (!t) return false;
  const want = force === undefined ? !t.done : !!force;
  lines[t.line] = lines[t.line].replace(/\[[ xX]\]/, want ? '[x]' : '[ ]');
  write(file, lines);
  return true;
}

function add(file, text, sectionTitle) {
  const raw = read(file);
  const lines = raw ? raw.split('\n') : [];
  const items = parse(raw);
  const heads = items.filter((i) => i.type === 'heading');
  const top = sectionLevel(items);

  let target = heads.find((h) => (sectionTitle ? h.text === sectionTitle : h.level === top));
  if (!target) {
    const title = sectionTitle || new Date().toISOString().slice(0, 10);
    const head = `${'#'.repeat(top)} ${title}`;
    const at = heads.findIndex((h) => h.level >= top);
    const insertAt = at === -1 ? lines.length : heads[at].line;
    lines.splice(insertAt, 0, head, '');
    write(file, lines);
    return add(file, text, title);
  }

  // end of that section = line before the next same-or-shallower heading
  let end = lines.length;
  for (const h of heads) {
    if (h.line > target.line && h.level <= target.level) { end = h.line; break; }
  }
  while (end > target.line + 1 && !lines[end - 1].trim()) end--;
  lines.splice(end, 0, `- [ ] ${text}`);
  write(file, lines);
  return true;
}

function clearDone(file) {
  const raw = read(file);
  const lines = raw.split('\n');
  const keep = lines.filter((l) => {
    const t = l.match(TASK_RE);
    return !(t && t[3].toLowerCase() === 'x');
  });
  write(file, keep);
  return lines.length - keep.length;
}

function newSession(file, title) {
  const raw = read(file);
  const lines = raw ? raw.split('\n') : ['# Tasks', ''];
  const items = parse(raw);
  const heads = items.filter((i) => i.type === 'heading');
  const level = sectionLevel(items);
  const first = heads.find((h) => h.level >= level);
  const insertAt = first ? first.line : lines.length;
  lines.splice(insertAt, 0, `${'#'.repeat(level)} ${title}`, '');
  write(file, lines);
  return true;
}

module.exports = { read, parse, sections, sectionLevel, openCount, toggle, add, clearDone, newSession, TASK_RE };
