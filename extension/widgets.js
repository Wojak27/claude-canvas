'use strict';
// Widgets, host side: parse a widget spec (JSON), load its `src` data file, and hand the webview a
// self-contained spec to draw. Drawing happens in media/widgets.js. The format is in WIDGETS.md.
const fs = require('fs');
const path = require('path');

const TYPES = new Set(['line', 'bar', 'scatter', 'heatmap', 'stat', 'table']);
const MAX_ROWS = 5000;

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Minimal RFC 4180: quoted fields, doubled quotes, commas/newlines inside quotes.
function parseDelimited(text, sep) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1).map((r) => {
    const o = {};
    head.forEach((h, j) => { o[h] = r[j] === undefined ? null : r[j]; });
    return o;
  });
}

// Numbers stay numbers; numeric-looking strings (from CSV) become numbers; blanks become null.
function coerce(rows) {
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      const v = r[k];
      if (typeof v !== 'string') continue;
      const t = v.trim();
      if (t === '' || /^(nan|null|none|na)$/i.test(t)) r[k] = null;
      else if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) r[k] = +t;
    }
  }
  return rows;
}

function loadSrc(file) {
  const text = fs.readFileSync(file, 'utf8');
  const ext = path.extname(file).toLowerCase();
  if (ext === '.csv') return parseDelimited(text, ',');
  if (ext === '.tsv') return parseDelimited(text, '\t');
  if (ext === '.jsonl' || ext === '.ndjson') {
    return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  }
  if (ext === '.json') {
    const j = JSON.parse(text);
    if (Array.isArray(j)) return j;
    if (j && Array.isArray(j.rows)) return j.rows;
    if (j && Array.isArray(j.data)) return j.data;
    throw new Error('a .json src must be an array of rows, or {"rows": [...]}');
  }
  throw new Error(`src must be .csv, .tsv, .json or .jsonl (got ${ext || 'no extension'})`);
}

// Checks what the renderer relies on, so a bad spec fails loudly on the card rather than drawing
// an empty frame. Returns a list of problems (empty = fine).
function validate(spec) {
  const errs = [];
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return ['a widget is a JSON object'];
  if (!TYPES.has(spec.type)) errs.push(`"type" must be one of ${[...TYPES].join(', ')}`);
  if (spec.type === 'stat') {
    if (!Array.isArray(spec.items) || !spec.items.length) errs.push('a stat widget needs "items": [{"label", "value"}]');
    return errs;
  }
  if (!Array.isArray(spec.data) && typeof spec.src !== 'string') errs.push('needs "data" (array of rows) or "src" (a data file)');
  if (['line', 'bar', 'scatter'].includes(spec.type)) {
    if (!spec.x) errs.push(`a ${spec.type} widget needs "x" (a column name)`);
    if (!spec.y) errs.push(`a ${spec.type} widget needs "y" (a column name, or a list of them)`);
    if (spec.series && Array.isArray(spec.y)) errs.push('use either "series" (long format) or a list of "y" columns (wide format), not both');
  }
  if (spec.type === 'heatmap' && !(spec.x && spec.y && spec.value)) errs.push('a heatmap needs "x", "y" and "value" columns');
  return errs;
}

// Resolve a spec into the attribute the webview draws from. `root` is the workspace root (for
// relative `src`), `onSrc(file)` records a data file so the board re-renders when it changes.
function resolve(text, root, onSrc) {
  let spec;
  try { spec = JSON.parse(text); } catch (e) { return errorBox(`widget JSON does not parse: ${e.message}`); }
  const errs = validate(spec);
  if (errs.length) return errorBox(errs.join('; '), spec && spec.title);
  let note = '';
  if (typeof spec.src === 'string') {
    const file = path.isAbsolute(spec.src) ? spec.src : path.resolve(root || '.', spec.src);
    if (onSrc) onSrc(file);
    try { spec.data = loadSrc(file); } catch (e) {
      return errorBox(`could not read ${spec.src}: ${e.message}`, spec.title);
    }
  }
  if (Array.isArray(spec.data)) {
    let rows = spec.data;
    if (Number.isInteger(spec.last) && spec.last > 0) rows = rows.slice(-spec.last);
    if (rows.length > MAX_ROWS) { note = `showing the last ${MAX_ROWS} of ${rows.length} rows`; rows = rows.slice(-MAX_ROWS); }
    spec.data = coerce(rows.map((r) => Object.assign({}, r)));
  }
  if (note) spec._note = note;
  return `<div class="wdg" data-spec="${escapeAttr(JSON.stringify(spec))}"></div>`;
}

function errorBox(msg, title) {
  return `<div class="wdg-err"><strong>${escapeAttr(title || 'Widget')}</strong><br>${escapeAttr(msg)}</div>`;
}

module.exports = { resolve, validate, loadSrc, parseDelimited, TYPES };
