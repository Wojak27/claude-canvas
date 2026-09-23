'use strict';
// Tiny dependency-free markdown -> HTML. Enough for a status board:
// headings, lists, task lists, tables, quotes, rules, fenced code,
// a `progress` fenced block, images, links and inline formatting.

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function inline(src, resolveImg) {
  let out = escapeHtml(src);
  const code = [];
  out = out.replace(/`([^`]+)`/g, (_, c) => `\u0000C${code.push(c) - 1}\u0000`);
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g,
    (_, alt, src2) => `<img class="inline-img" alt="${alt}" src="${resolveImg(src2)}">`);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g,
    (_, t, href) => `<a href="${href}" class="lnk">${t}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  out = out.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  out = out.replace(/\u0000C(\d+)\u0000/g, (_, i) => `<code>${code[+i]}</code>`);
  return out;
}

function progressBlock(body) {
  const rows = body.split('\n').map((l) => l.trim()).filter(Boolean).map((line) => {
    const m = line.match(/^(.*?):\s*(\d+(?:\.\d+)?)\s*%?\s*(?:\|\s*(.*))?$/);
    if (!m) return `<div class="prow"><span class="plabel">${escapeHtml(line)}</span></div>`;
    const pct = Math.max(0, Math.min(100, parseFloat(m[2])));
    const note = m[3] ? `<span class="pnote">${escapeHtml(m[3])}</span>` : '';
    return `<div class="prow"><span class="plabel">${escapeHtml(m[1])}</span>` +
      `<span class="pbar"><span class="pfill" style="width:${pct}%"></span></span>` +
      `<span class="ppct">${pct % 1 ? pct : pct | 0}%</span>${note}</div>`;
  });
  return `<div class="progress">${rows.join('')}</div>`;
}

function render(md, resolveImg) {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const listStack = [];

  const closeLists = (depth = 0) => {
    while (listStack.length > depth) out.push(`</${listStack.pop()}>`);
  };

  while (i < lines.length) {
    const line = lines[i];

    const fence = line.match(/^\s*```+\s*(\w*)\s*$/);
    if (fence) {
      closeLists();
      const lang = fence[1];
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```+\s*$/.test(lines[i])) buf.push(lines[i++]);
      i++;
      const body = buf.join('\n');
      out.push(lang === 'progress' ? progressBlock(body)
        : `<pre class="code"><code>${escapeHtml(body)}</code></pre>`);
      continue;
    }

    if (/^\s*$/.test(line)) { closeLists(); i++; continue; }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { closeLists(); out.push('<hr>'); i++; continue; }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeLists();
      out.push(`<h${h[1].length}>${inline(h[2], resolveImg)}</h${h[1].length}>`);
      i++; continue;
    }

    if (/^\s*>\s?/.test(line)) {
      closeLists();
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${render(buf.join('\n'), resolveImg)}</blockquote>`);
      continue;
    }

    // table
    if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      closeLists();
      const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const body = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) body.push(cells(lines[i++]));
      out.push('<table><thead><tr>' + head.map((c) => `<th>${inline(c, resolveImg)}</th>`).join('') +
        '</tr></thead><tbody>' +
        body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c, resolveImg)}</td>`).join('') + '</tr>').join('') +
        '</tbody></table>');
      continue;
    }

    const li = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (li) {
      const depth = Math.floor(li[1].replace(/\t/g, '  ').length / 2) + 1;
      const tag = /\d/.test(li[2]) ? 'ol' : 'ul';
      while (listStack.length > depth) out.push(`</${listStack.pop()}>`);
      while (listStack.length < depth) { out.push(`<${tag}>`); listStack.push(tag); }
      let text = li[3];
      const task = text.match(/^\[([ xX])\]\s+(.*)$/);
      if (task) {
        const done = task[1].toLowerCase() === 'x';
        out.push(`<li class="task ${done ? 'done' : ''}"><span class="box">${done ? '✓' : ''}</span>` +
          `<span>${inline(task[2], resolveImg)}</span></li>`);
      } else {
        out.push(`<li>${inline(text, resolveImg)}</li>`);
      }
      i++; continue;
    }

    closeLists();
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(\s*(#{1,6}\s|>|```|---)|(\s*([-*+]|\d+[.)])\s))/.test(lines[i])) {
      buf.push(lines[i++]);
    }
    if (buf.length) out.push(`<p>${inline(buf.join('\n'), resolveImg)}</p>`);
    else i++;
  }
  closeLists();
  return out.join('\n');
}

module.exports = { render, escapeHtml };
