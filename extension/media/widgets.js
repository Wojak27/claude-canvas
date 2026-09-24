'use strict';
// Widgets, webview side: draws the specs the host resolved (see extension/widgets.js, WIDGETS.md).
// Plain SVG, no dependencies. Colors come from CSS classes (.s1-.s8, .sm), so they follow the
// VS Code theme; every text node is set with textContent, since labels come from data files.
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const MAX_SERIES = 8;          // categorical slots; past this the tail folds into "Other"
  const MAX_SCATTER_SERIES = 3;  // all-pairs forms only stay distinguishable up to three hues

  // ---- small DOM helpers ----------------------------------------------------------------------
  function svg(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) if (attrs[k] !== undefined && attrs[k] !== null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function html(tag, cls, text, parent) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = String(text);
    if (parent) parent.appendChild(e);
    return e;
  }

  // ---- numbers -------------------------------------------------------------------------------
  function fmt(v, o) {
    if (v === null || v === undefined || v === '' || (typeof v === 'number' && !isFinite(v))) return '—';
    if (typeof v !== 'number') return String(v);
    o = o || {};
    if (o.percent) return (v * 100).toLocaleString(undefined, { maximumFractionDigits: o.decimals ?? 1 }) + '%';
    const a = Math.abs(v);
    let s;
    if (o.decimals !== undefined) s = v.toLocaleString(undefined, { minimumFractionDigits: o.decimals, maximumFractionDigits: o.decimals });
    else if (o.compact && a >= 1e4) s = v.toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 });
    else if (a !== 0 && a < 0.01) s = v.toPrecision(2);
    else s = v.toLocaleString(undefined, { maximumFractionDigits: a >= 100 ? 0 : a >= 1 ? 2 : 3 });
    return s + (o.unit || '');
  }
  const axisFmt = (spec) => ({ percent: spec.yPercent, unit: spec.yUnit, decimals: spec.yDecimals, compact: true });

  function niceStep(span, count) {
    const raw = span / Math.max(1, count);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n >= 5 ? 10 : n >= 2 ? 5 : n >= 1 ? 2 : 1) * mag;
  }
  function linearScale(lo, hi, a, b, count, zero) {
    if (zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (lo === hi) { lo -= 1; hi += 1; }
    const step = niceStep(hi - lo, count);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    const ticks = [];
    for (let t = lo; t <= hi + step / 2; t += step) ticks.push(+t.toPrecision(12));
    const f = (v) => a + (v - lo) / (hi - lo) * (b - a);
    f.ticks = ticks; f.lo = lo; f.hi = hi;
    return f;
  }
  function logScale(lo, hi, a, b) {
    lo = Math.max(lo, 1e-12);
    const l0 = Math.floor(Math.log10(lo)), l1 = Math.ceil(Math.log10(Math.max(hi, lo * 10)));
    const f = (v) => a + (Math.log10(Math.max(v, 1e-12)) - l0) / (l1 - l0) * (b - a);
    f.ticks = []; for (let e = l0; e <= l1; e++) f.ticks.push(Math.pow(10, e));
    return f;
  }
  const isDateLike = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?/.test(v);
  const textW = (s, px) => String(s).length * (px || 11) * 0.6;

  // ---- data shaping --------------------------------------------------------------------------
  // Turns wide ("y": [a, b]) or long ("y": v, "series": col) rows into [{name, points: [{x, y, row}]}].
  function toSeries(spec) {
    const rows = spec.data || [];
    const series = [];
    if (spec.series) {
      const by = new Map();
      for (const r of rows) {
        const k = r[spec.series] === null || r[spec.series] === undefined ? '(none)' : String(r[spec.series]);
        if (!by.has(k)) by.set(k, []);
        by.get(k).push({ x: r[spec.x], y: r[spec.y], row: r });
      }
      for (const [name, points] of by) series.push({ name, points });
    } else {
      for (const col of [].concat(spec.y)) series.push({ name: col, points: rows.map((r) => ({ x: r[spec.x], y: r[col], row: r })) });
    }
    return series;
  }
  // Slots are assigned in spec order and never change with filtering, so a series keeps its color.
  function assignSlots(series, max, spec) {
    let list = series;
    if (list.length > max) {
      const keep = list.slice(0, max - 1);
      const rest = list.slice(max - 1);
      const merged = { name: `Other (${rest.length})`, other: true, points: [].concat(...rest.map((s) => s.points)) };
      list = keep.concat([merged]);
    }
    list.forEach((s, i) => {
      if (spec.emphasis !== undefined) s.cls = s.name === String(spec.emphasis) ? 's1' : 'sm';
      else s.cls = s.other ? 'sm' : 's' + (i + 1);
    });
    return list;
  }

  // ---- shared chrome -------------------------------------------------------------------------
  function frame(el, spec, state, save) {
    el.textContent = '';
    const head = html('div', 'wh', null, el);
    const titles = html('div', 'wt', null, head);
    if (spec.title) html('div', 'wtitle', spec.title, titles);
    if (spec.subtitle) html('div', 'wsub', spec.subtitle, titles);
    let toggle = null;
    if (spec.type !== 'table' && spec.type !== 'stat') {
      toggle = html('button', 'wbtn', state.table ? 'Chart' : 'Table', head);
      toggle.title = state.table ? 'Show the chart' : 'Show the data as a table';
      toggle.onclick = () => { state.table = !state.table; save(); draw(el); };
    }
    const body = html('div', 'wbody', null, el);
    const tip = html('div', 'wtip', null, el);
    tip.hidden = true;
    if (spec._note) html('div', 'wnote', spec._note, el);
    return { body, tip };
  }

  function legend(parent, series, kind, state, save, redraw) {
    if (series.length < 2) return;
    const lg = html('div', 'wlg', null, parent);
    for (const s of series) {
      const b = html('button', 'wlgi' + (state.hidden.includes(s.name) ? ' off' : ''), null, lg);
      b.title = 'Show or hide this series';
      const k = svg('svg', { width: 14, height: 10, class: 'wkey' }, b);
      if (kind === 'line') svg('line', { x1: 0, y1: 5, x2: 14, y2: 5, class: 'ln ' + s.cls }, k);
      else if (kind === 'dot') svg('circle', { cx: 7, cy: 5, r: 4, class: 'fl ' + s.cls }, k);
      else svg('rect', { x: 2, y: 1, width: 10, height: 8, rx: 2, class: 'fl ' + s.cls }, k);
      html('span', null, s.name, b);
      b.onclick = () => {
        const i = state.hidden.indexOf(s.name);
        if (i >= 0) state.hidden.splice(i, 1); else state.hidden.push(s.name);
        save(); redraw();
      };
    }
  }

  function showTip(tip, host, px, py, header, rows) {
    tip.textContent = '';
    if (header !== null && header !== undefined) html('div', 'wtiph', header, tip);
    for (const r of rows) {
      const row = html('div', 'wtipr', null, tip);
      if (r.cls) {
        const k = svg('svg', { width: 12, height: 8, class: 'wkey' }, row);
        svg('line', { x1: 0, y1: 4, x2: 12, y2: 4, class: 'ln ' + r.cls }, k);
      }
      html('strong', null, r.value, row);
      if (r.name) html('span', 'wtipn', r.name, row);
    }
    tip.hidden = false;
    // px/py are in plot coordinates; the tooltip is positioned in the widget (position: relative)
    const w = host.clientWidth, tw = tip.offsetWidth, th = tip.offsetHeight;
    const lx = px + 12 + tw > w ? px - tw - 12 : px + 12;
    tip.style.left = host.offsetLeft + Math.max(0, Math.min(w - tw, lx)) + 'px';
    tip.style.top = host.offsetTop + Math.max(0, py - th - 8) + 'px';
  }

  // Data table: the view that makes every value reachable without hovering.
  function table(parent, cols, rows, state, save, opts) {
    opts = opts || {};
    const wrap = html('div', 'wtbl', null, parent);
    let filter = state.filter || '';
    if (rows.length > 10) {
      const inp = html('input', 'wfilter', null, wrap);
      inp.placeholder = `Filter ${rows.length} rows…`;
      inp.value = filter;
      inp.oninput = () => { state.filter = inp.value; save(); fill(); };
    }
    const scroller = html('div', 'wscroll', null, wrap);
    const t = html('table', null, null, scroller);
    const count = html('div', 'wnote', null, wrap);
    const numeric = {};
    const whole = {};   // integer columns (epoch, count) never get decimals
    for (const c of cols) {
      numeric[c] = rows.some((r) => typeof r[c] === 'number') && rows.every((r) => r[c] === null || typeof r[c] === 'number');
      whole[c] = numeric[c] && rows.every((r) => r[c] === null || Number.isInteger(r[c]));
    }
    function fill() {
      t.textContent = '';
      const tr = html('tr', null, null, html('thead', null, null, t));
      for (const c of cols) {
        const th = html('th', numeric[c] ? 'num' : null, c, tr);
        if (state.sort && state.sort.col === c) th.textContent += state.sort.dir > 0 ? ' ▲' : ' ▼';
        th.tabIndex = 0;
        th.onclick = th.onkeydown = (e) => {
          if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
          state.sort = { col: c, dir: state.sort && state.sort.col === c ? -state.sort.dir : (numeric[c] ? -1 : 1) };
          save(); fill();
        };
      }
      const q = (state.filter || '').toLowerCase();
      let shown = q ? rows.filter((r) => cols.some((c) => String(r[c] ?? '').toLowerCase().includes(q))) : rows.slice();
      if (state.sort && cols.includes(state.sort.col)) {
        const { col, dir } = state.sort;
        shown.sort((a, b) => {
          const x = a[col], y = b[col];
          if (x === null || x === undefined) return 1;
          if (y === null || y === undefined) return -1;
          return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir;
        });
      }
      const total = shown.length;
      shown = shown.slice(0, opts.limit || 300);
      const tb = html('tbody', null, null, t);
      for (const r of shown) {
        const row = html('tr', null, null, tb);
        for (const c of cols) {
          const f = whole[c] ? { decimals: 0 } : opts.fmt && opts.fmt(c);
          html('td', numeric[c] ? 'num' : null, numeric[c] ? fmt(r[c], f) : (r[c] ?? '—'), row);
        }
      }
      count.textContent = total > shown.length ? `showing ${shown.length} of ${total} rows` : '';
    }
    fill();
  }

  function seriesTable(parent, spec, series, state, save) {
    const xs = [];
    const seen = new Set();
    for (const s of series) for (const p of s.points) { const k = String(p.x); if (!seen.has(k)) { seen.add(k); xs.push(p.x); } }
    const rows = xs.map((x) => {
      const r = { [spec.x || 'x']: x };
      for (const s of series) { const p = s.points.find((q) => String(q.x) === String(x)); r[s.name] = p ? p.y : null; }
      return r;
    });
    table(parent, [spec.x || 'x'].concat(series.map((s) => s.name)), rows, state, save, { fmt: () => axisFmt(spec) });
  }

  // ---- axes ----------------------------------------------------------------------------------
  function yAxis(g, y, x0, x1, spec) {
    for (const t of y.ticks) {
      const py = y(t);
      svg('line', { x1: x0, x2: x1, y1: py, y2: py, class: t === 0 ? 'wbase' : 'wgrid' }, g);
      const lab = svg('text', { x: x0 - 6, y: py + 4, class: 'wax', 'text-anchor': 'end' }, g);
      lab.textContent = fmt(t, axisFmt(spec));
    }
  }
  function yLabelWidth(y, spec) {
    return Math.max(...y.ticks.map((t) => textW(fmt(t, axisFmt(spec)), 11))) + 10;
  }

  // ---- line ----------------------------------------------------------------------------------
  function drawLine(el, spec, state, save) {
    const { body, tip } = frame(el, spec, state, save);
    const all = assignSlots(toSeries(spec), MAX_SERIES, spec);
    legend(body, all, 'line', state, save, () => draw(el));
    if (state.table) return seriesTable(body, spec, all, state, save);
    const series = all.filter((s) => !state.hidden.includes(s.name));
    const W = Math.max(240, body.clientWidth || el.clientWidth || 320), H = spec.height || 220;

    const xsRaw = [];
    const seen = new Set();
    for (const s of all) for (const p of s.points) { const k = String(p.x); if (!seen.has(k)) { seen.add(k); xsRaw.push(p.x); } }
    const kind = xsRaw.every((v) => typeof v === 'number') ? 'num' : xsRaw.every(isDateLike) ? 'time' : 'cat';
    const xv = (v) => kind === 'num' ? v : kind === 'time' ? Date.parse(v) : xsRaw.findIndex((q) => String(q) === String(v));
    const xs = xsRaw.map(xv).sort((a, b) => a - b);

    const ys = [];
    for (const s of series) for (const p of s.points) if (typeof p.y === 'number' && isFinite(p.y)) ys.push(p.y);
    if (!ys.length) { html('div', 'wnote', 'No numeric values to plot.', body); return; }
    const top = 10, bottom = H - 24;
    const y = spec.yScale === 'log' ? logScale(Math.min(...ys), Math.max(...ys), bottom, top)
      : linearScale(Math.min(...ys), Math.max(...ys), bottom, top, 4, !!spec.yZero);
    const endLabels = series.length > 1 && series.length <= 4;
    const right = endLabels ? Math.min(110, Math.max(...series.map((s) => textW(s.name, 11))) + 16) : 12;
    const left = yLabelWidth(y, spec);
    const xlo = xs[0], xhi = xs[xs.length - 1] === xlo ? xlo + 1 : xs[xs.length - 1];
    const x = (v) => left + (v - xlo) / (xhi - xlo) * (W - left - right);

    const host = html('div', 'wplot', null, body);
    const s0 = svg('svg', { width: W, height: H, class: 'wsvg', role: 'img', 'aria-label': spec.title || 'line chart' }, host);
    yAxis(s0, y, left, W - right, spec);
    // x ticks: ~5 evenly spaced existing x values
    const nt = Math.min(xs.length, Math.max(2, Math.floor((W - left - right) / 90)));
    for (let i = 0; i < nt; i++) {
      const v = xs[Math.round(i * (xs.length - 1) / Math.max(1, nt - 1))];
      const lab = svg('text', { x: x(v), y: H - 6, class: 'wax', 'text-anchor': i === 0 ? 'start' : i === nt - 1 ? 'end' : 'middle' }, s0);
      lab.textContent = kind === 'num' ? fmt(v, { compact: true }) : kind === 'time' ? new Date(v).toISOString().slice(0, 10) : String(xsRaw[v]);
    }
    if (spec.xLabel) { const t = svg('text', { x: W - right, y: H - 18, class: 'wax', 'text-anchor': 'end' }, s0); t.textContent = spec.xLabel; }

    const pts = (s) => s.points.filter((p) => typeof p.y === 'number' && isFinite(p.y)).map((p) => [xv(p.x), p.y]).sort((a, b) => a[0] - b[0]);
    const paths = [];
    // de-emphasised series first, so the emphasised one sits on top
    const order = series.slice().sort((a, b) => (a.cls === 'sm') - (b.cls === 'sm')).reverse();
    for (const s of order) {
      const p = pts(s);
      if (!p.length) continue;
      const d = p.map((q, i) => (i ? 'L' : 'M') + x(q[0]).toFixed(1) + ',' + y(q[1]).toFixed(1)).join('');
      if (series.length === 1) svg('path', { d: d + `L${x(p[p.length - 1][0]).toFixed(1)},${bottom}L${x(p[0][0]).toFixed(1)},${bottom}Z`, class: 'warea ' + s.cls }, s0);
      svg('path', { d, class: 'wline ' + s.cls }, s0);
      const last = p[p.length - 1];
      svg('circle', { cx: x(last[0]), cy: y(last[1]), r: 4, class: 'wdot ' + s.cls }, s0);
      paths.push({ s, last });
    }
    // end labels only where they don't collide; otherwise the legend and tooltip carry identity
    if (endLabels) {
      const ys2 = paths.map((p) => y(p.last[1])).sort((a, b) => a - b);
      const clear = ys2.every((v, i) => i === 0 || v - ys2[i - 1] >= 13);
      if (clear) for (const p of paths) {
        const t = svg('text', { x: x(p.last[0]) + 8, y: y(p.last[1]) + 4, class: 'wlab' }, s0);
        t.textContent = p.s.name;
      }
    }

    // crosshair: snaps to the nearest x, one readout for every visible series
    const cross = svg('line', { y1: top, y2: bottom, class: 'wcross', visibility: 'hidden' }, s0);
    const hover = svg('g', {}, s0);
    const hit = svg('rect', { x: left, y: 0, width: Math.max(1, W - left - right), height: H, class: 'whit', tabindex: 0 }, s0);
    let idx = -1;
    const at = (i) => {
      idx = Math.max(0, Math.min(xs.length - 1, i));
      const v = xs[idx], px = x(v);
      cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.setAttribute('visibility', 'visible');
      hover.textContent = '';
      const rows = [];
      for (const s of series) {
        const p = s.points.find((q) => xv(q.x) === v);
        if (!p) continue;
        if (typeof p.y === 'number') svg('circle', { cx: px, cy: y(p.y), r: 4, class: 'wdot ' + s.cls }, hover);
        rows.push({ cls: s.cls, value: fmt(p.y, axisFmt(spec)), name: s.name, y: p.y });
      }
      rows.sort((a, b) => (b.y ?? -Infinity) - (a.y ?? -Infinity));
      const head = (spec.xLabel ? spec.xLabel + ' ' : (spec.x ? spec.x + ' ' : '')) +
        (kind === 'num' ? fmt(v) : kind === 'time' ? new Date(v).toISOString().replace('T', ' ').slice(0, 16) : String(xsRaw[v]));
      showTip(tip, host, px, top + 20, head, rows);
    };
    hit.addEventListener('pointermove', (e) => {
      const r = s0.getBoundingClientRect(), px = e.clientX - r.left;
      let best = 0;
      for (let i = 1; i < xs.length; i++) if (Math.abs(x(xs[i]) - px) < Math.abs(x(xs[best]) - px)) best = i;
      at(best);
    });
    const hide = () => { cross.setAttribute('visibility', 'hidden'); hover.textContent = ''; tip.hidden = true; };
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('blur', hide);
    hit.addEventListener('focus', () => at(idx < 0 ? xs.length - 1 : idx));
    hit.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { at(idx - 1); e.preventDefault(); }
      if (e.key === 'ArrowRight') { at(idx + 1); e.preventDefault(); }
    });
  }

  // ---- bar -----------------------------------------------------------------------------------
  function barPath(x0, y0, x1, y1, horizontal) {
    // rounded 4px at the data end, square at the baseline
    const r = Math.min(4, Math.abs(horizontal ? y1 - y0 : x1 - x0) / 2, Math.abs(horizontal ? x1 - x0 : y1 - y0));
    if (horizontal) {
      const dir = x1 >= x0 ? 1 : -1;
      return `M${x0},${y0}H${x1 - dir * r}Q${x1},${y0} ${x1},${y0 + r}V${y1 - r}Q${x1},${y1} ${x1 - dir * r},${y1}H${x0}Z`;
    }
    const dir = y1 <= y0 ? 1 : -1;
    return `M${x0},${y0}V${y1 + dir * r}Q${x0},${y1} ${x0 + r},${y1}H${x1 - r}Q${x1},${y1} ${x1},${y1 + dir * r}V${y0}Z`;
  }

  function drawBar(el, spec, state, save) {
    const { body, tip } = frame(el, spec, state, save);
    const all = assignSlots(toSeries(spec), MAX_SERIES, spec);
    legend(body, all, 'bar', state, save, () => draw(el));
    if (state.table) return seriesTable(body, spec, all, state, save);
    const series = all.filter((s) => !state.hidden.includes(s.name));
    const cats = [];
    const seen = new Set();
    for (const s of all) for (const p of s.points) { const k = String(p.x); if (!seen.has(k)) { seen.add(k); cats.push(k); } }
    const vals = [];
    for (const s of series) for (const p of s.points) if (typeof p.y === 'number') vals.push(p.y);
    if (!vals.length) { html('div', 'wnote', 'No numeric values to plot.', body); return; }
    const horizontal = spec.horizontal ?? (cats.length > 8 || Math.max(...cats.map((c) => c.length)) > 10);
    const W = Math.max(240, body.clientWidth || el.clientWidth || 320);
    const n = Math.max(1, series.length);
    const host = html('div', 'wplot', null, body);
    const bars = [];

    if (horizontal) {
      const band = Math.min(24, 24 / Math.max(1, n / 2)) * n + 10;
      const H = spec.height || Math.max(80, cats.length * band + 28);
      const left = Math.min(W * 0.4, Math.max(...cats.map((c) => textW(c, 11))) + 10);
      const x = linearScale(Math.min(...vals), Math.max(...vals), left, W - 44, 4, true);
      const s0 = svg('svg', { width: W, height: H, class: 'wsvg', role: 'img', 'aria-label': spec.title || 'bar chart' }, host);
      for (const t of x.ticks) {
        svg('line', { x1: x(t), x2: x(t), y1: 4, y2: H - 22, class: t === 0 ? 'wbase' : 'wgrid' }, s0);
        const lab = svg('text', { x: x(t), y: H - 6, class: 'wax', 'text-anchor': 'middle' }, s0);
        lab.textContent = fmt(t, axisFmt(spec));
      }
      const bh = Math.min(24, (band - 10 - 2 * (n - 1)) / n);
      cats.forEach((c, ci) => {
        const y0 = 4 + ci * band + 5;
        const lab = svg('text', { x: left - 6, y: y0 + (n * (bh + 2)) / 2 + 2, class: 'wax', 'text-anchor': 'end' }, s0);
        lab.textContent = c;
        series.forEach((s, si) => {
          const p = s.points.find((q) => String(q.x) === c);
          if (!p || typeof p.y !== 'number') return;
          const yy = y0 + si * (bh + 2);
          const e = svg('path', { d: barPath(x(0), yy, x(p.y), yy + bh, true), class: 'wbar ' + s.cls, tabindex: 0 }, s0);
          bars.push({ e, c, s, p, px: x(p.y), py: yy });
          if (cats.length * n <= 16) {
            const t = svg('text', { x: x(p.y) + (p.y >= 0 ? 5 : -5), y: yy + bh / 2 + 4, class: 'wlab', 'text-anchor': p.y >= 0 ? 'start' : 'end' }, s0);
            t.textContent = fmt(p.y, axisFmt(spec));
          }
        });
      });
    } else {
      const H = spec.height || 220, top = 16, bottom = H - 24;
      const y = linearScale(Math.min(...vals), Math.max(...vals), bottom, top, 4, true);
      const left = yLabelWidth(y, spec);
      const s0 = svg('svg', { width: W, height: H, class: 'wsvg', role: 'img', 'aria-label': spec.title || 'bar chart' }, host);
      yAxis(s0, y, left, W - 8, spec);
      const bandW = (W - left - 8) / cats.length;
      const bw = Math.max(2, Math.min(24, (bandW * 0.7 - 2 * (n - 1)) / n));
      cats.forEach((c, ci) => {
        const cx = left + ci * bandW + bandW / 2, gx = cx - (n * bw + 2 * (n - 1)) / 2;
        const lab = svg('text', { x: cx, y: H - 6, class: 'wax', 'text-anchor': 'middle' }, s0);
        lab.textContent = c;
        series.forEach((s, si) => {
          const p = s.points.find((q) => String(q.x) === c);
          if (!p || typeof p.y !== 'number') return;
          const xx = gx + si * (bw + 2);
          const e = svg('path', { d: barPath(xx, y(0), xx + bw, y(p.y), false), class: 'wbar ' + s.cls, tabindex: 0 }, s0);
          bars.push({ e, c, s, p, px: xx + bw / 2, py: y(p.y) });
          const label = fmt(p.y, axisFmt(spec));
          if (cats.length * n <= 12 && textW(label, 11) <= bandW) {
            const t = svg('text', { x: xx + bw / 2, y: y(p.y) + (p.y >= 0 ? -5 : 13), class: 'wlab', 'text-anchor': 'middle' }, s0);
            t.textContent = label;
          }
        });
      });
    }
    for (const b of bars) {
      const on = () => {
        for (const o of bars) o.e.classList.toggle('dim', o !== b);
        showTip(tip, host, b.px, b.py, b.c, [{ cls: b.s.cls, value: fmt(b.p.y, axisFmt(spec)), name: series.length > 1 ? b.s.name : '' }]);
      };
      const off = () => { for (const o of bars) o.e.classList.remove('dim'); tip.hidden = true; };
      b.e.addEventListener('pointerenter', on); b.e.addEventListener('focus', on);
      b.e.addEventListener('pointerleave', off); b.e.addEventListener('blur', off);
    }
  }

  // ---- scatter -------------------------------------------------------------------------------
  function drawScatter(el, spec, state, save) {
    const { body, tip } = frame(el, spec, state, save);
    const all = assignSlots(toSeries(spec), MAX_SCATTER_SERIES + 1, spec);
    legend(body, all, 'dot', state, save, () => draw(el));
    if (state.table) {
      const cols = [spec.x].concat([].concat(spec.y), spec.series ? [spec.series] : [], spec.label ? [spec.label] : []);
      return table(body, [...new Set(cols)], spec.data || [], state, save);
    }
    const series = all.filter((s) => !state.hidden.includes(s.name));
    const pts = [];
    for (const s of series) for (const p of s.points) if (typeof p.x === 'number' && typeof p.y === 'number') pts.push({ s, p });
    if (!pts.length) { html('div', 'wnote', 'No numeric x/y pairs to plot.', body); return; }
    const W = Math.max(240, body.clientWidth || el.clientWidth || 320), H = spec.height || 240, top = 10, bottom = H - 24;
    const y = linearScale(Math.min(...pts.map((q) => q.p.y)), Math.max(...pts.map((q) => q.p.y)), bottom, top, 4, !!spec.yZero);
    const left = yLabelWidth(y, spec);
    const x = linearScale(Math.min(...pts.map((q) => q.p.x)), Math.max(...pts.map((q) => q.p.x)), left, W - 12, 5, false);
    const host = html('div', 'wplot', null, body);
    const s0 = svg('svg', { width: W, height: H, class: 'wsvg', role: 'img', 'aria-label': spec.title || 'scatter plot' }, host);
    yAxis(s0, y, left, W - 12, spec);
    for (const t of x.ticks) {
      const lab = svg('text', { x: x(t), y: H - 6, class: 'wax', 'text-anchor': 'middle' }, s0);
      lab.textContent = fmt(t, { compact: true });
    }
    if (spec.xLabel) { const t = svg('text', { x: W - 12, y: H - 18, class: 'wax', 'text-anchor': 'end' }, s0); t.textContent = spec.xLabel; }
    for (const q of pts) { q.cx = x(q.p.x); q.cy = y(q.p.y); svg('circle', { cx: q.cx, cy: q.cy, r: 4, class: 'wdot ' + q.s.cls }, s0); }
    const ring = svg('circle', { r: 7, class: 'wring', visibility: 'hidden' }, s0);
    // nearest point within 24px, so nobody has to land on a 4px dot
    s0.addEventListener('pointermove', (e) => {
      const r = s0.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
      let best = null, bd = 24 * 24;
      for (const q of pts) { const d = (q.cx - mx) ** 2 + (q.cy - my) ** 2; if (d < bd) { bd = d; best = q; } }
      if (!best) { ring.setAttribute('visibility', 'hidden'); tip.hidden = true; return; }
      ring.setAttribute('cx', best.cx); ring.setAttribute('cy', best.cy); ring.setAttribute('visibility', 'visible');
      const rows = [
        { value: fmt(best.p.y, axisFmt(spec)), name: [].concat(spec.y).length === 1 ? String(spec.yLabel || spec.y) : best.s.name },
        { value: fmt(best.p.x), name: String(spec.xLabel || spec.x) },
      ];
      if (spec.series) rows.push({ cls: best.s.cls, value: best.s.name, name: '' });
      showTip(tip, host, best.cx, best.cy, spec.label ? best.p.row[spec.label] : null, rows);
    });
    s0.addEventListener('pointerleave', () => { ring.setAttribute('visibility', 'hidden'); tip.hidden = true; });
  }

  // ---- heatmap -------------------------------------------------------------------------------
  const SEQ = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
  function drawHeatmap(el, spec, state, save) {
    const { body, tip } = frame(el, spec, state, save);
    const rows = spec.data || [];
    if (state.table) return table(body, [spec.x, spec.y, spec.value], rows, state, save);
    const xs = [...new Set(rows.map((r) => String(r[spec.x])))];
    const ys = [...new Set(rows.map((r) => String(r[spec.y])))];
    const vals = rows.map((r) => r[spec.value]).filter((v) => typeof v === 'number');
    if (!vals.length) { html('div', 'wnote', 'No numeric values to plot.', body); return; }
    const lo = spec.min ?? Math.min(...vals), hi = spec.max ?? Math.max(...vals);
    const step = (v) => SEQ[Math.max(0, Math.min(SEQ.length - 1, Math.floor((v - lo) / ((hi - lo) || 1) * SEQ.length)))];
    const W = Math.max(240, body.clientWidth || el.clientWidth || 320);
    const left = Math.min(W * 0.35, Math.max(...ys.map((c) => textW(c, 11))) + 10);
    const cw = Math.max(8, (W - left - 4) / xs.length), ch = Math.min(28, Math.max(14, cw * 0.6));
    const H = ys.length * ch + 26;
    const host = html('div', 'wplot', null, body);
    const s0 = svg('svg', { width: W, height: H, class: 'wsvg', role: 'img', 'aria-label': spec.title || 'heatmap' }, host);
    ys.forEach((yv, yi) => { const t = svg('text', { x: left - 6, y: yi * ch + ch / 2 + 4, class: 'wax', 'text-anchor': 'end' }, s0); t.textContent = yv; });
    const every = Math.ceil(xs.length / Math.max(1, Math.floor((W - left) / 60)));
    xs.forEach((xv, xi) => { if (xi % every) return; const t = svg('text', { x: left + xi * cw + cw / 2, y: H - 8, class: 'wax', 'text-anchor': 'middle' }, s0); t.textContent = xv; });
    const cells = [];
    for (const r of rows) {
      const v = r[spec.value];
      if (typeof v !== 'number') continue;
      const xi = xs.indexOf(String(r[spec.x])), yi = ys.indexOf(String(r[spec.y]));
      const fill = step(v);
      const e = svg('rect', { x: left + xi * cw + 1, y: yi * ch + 1, width: cw - 2, height: ch - 2, rx: 2, fill, class: 'wcell', tabindex: 0 }, s0);
      cells.push({ e, r, v });
      const label = fmt(v, axisFmt(spec));
      if (spec.values && textW(label, 10) + 6 <= cw - 2) {
        const dark = SEQ.indexOf(fill) >= 3;
        const t = svg('text', { x: left + xi * cw + cw / 2, y: yi * ch + ch / 2 + 4, class: 'wcellt' + (dark ? ' inv' : ''), 'text-anchor': 'middle' }, s0);
        t.textContent = label;
      }
    }
    for (const c of cells) {
      const on = () => {
        c.e.classList.add('on');
        showTip(tip, host, +c.e.getAttribute('x'), +c.e.getAttribute('y'), `${c.r[spec.y]} · ${c.r[spec.x]}`, [{ value: fmt(c.v, axisFmt(spec)), name: String(spec.value) }]);
      };
      const off = () => { c.e.classList.remove('on'); tip.hidden = true; };
      c.e.addEventListener('pointerenter', on); c.e.addEventListener('focus', on);
      c.e.addEventListener('pointerleave', off); c.e.addEventListener('blur', off);
    }
    const lg = html('div', 'wramp', null, body);
    html('span', null, fmt(lo, axisFmt(spec)), lg);
    for (const c of SEQ) { const sw = html('span', 'wsw', null, lg); sw.style.background = c; }
    html('span', null, fmt(hi, axisFmt(spec)), lg);
  }

  // ---- stat tiles ----------------------------------------------------------------------------
  function drawStat(el, spec, state, save) {
    const { body } = frame(el, spec, state, save);
    const row = html('div', 'wstats', null, body);
    for (const it of spec.items) {
      const t = html('div', 'wstat', null, row);
      html('div', 'wsl', it.label, t);
      html('div', 'wsv', fmt(it.value, { percent: it.percent, unit: it.unit, decimals: it.decimals, compact: true }), t);
      if (typeof it.delta === 'number') {
        const up = it.delta > 0, good = it.good === 'down' ? !up : up;
        const d = html('div', 'wsd ' + (it.delta === 0 ? '' : good ? 'good' : 'bad'), null, t);
        const sign = it.delta > 0 ? '▲ +' : it.delta < 0 ? '▼ −' : '';
        html('span', null, sign + fmt(Math.abs(it.delta), { percent: it.deltaPercent ?? it.percent, unit: it.unit, decimals: it.decimals }), d);
        if (it.vs) html('span', 'wsvs', ' vs ' + it.vs, d);
      }
      if (Array.isArray(it.trend) && it.trend.length > 1) {
        const w = 120, h = 28, tr = it.trend.filter((v) => typeof v === 'number');
        const lo = Math.min(...tr), hi = Math.max(...tr) === lo ? lo + 1 : Math.max(...tr);
        const sx = (i) => 2 + i / (tr.length - 1) * (w - 6), sy = (v) => h - 3 - (v - lo) / (hi - lo) * (h - 6);
        const sp = svg('svg', { width: w, height: h, class: 'wspark' }, t);
        svg('path', { d: tr.map((v, i) => (i ? 'L' : 'M') + sx(i).toFixed(1) + ',' + sy(v).toFixed(1)).join(''), class: 'wline sm' }, sp);
        svg('circle', { cx: sx(tr.length - 1), cy: sy(tr[tr.length - 1]), r: 3, class: 'wdot s1' }, sp);
      }
    }
  }

  function drawTable(el, spec, state, save) {
    const { body } = frame(el, spec, state, save);
    const rows = spec.data || [];
    const cols = spec.columns || [...new Set([].concat(...rows.slice(0, 50).map((r) => Object.keys(r))))];
    table(body, cols, rows, state, save, { limit: spec.limit || 300, fmt: () => ({ decimals: spec.decimals }) });
  }

  // ---- mount ---------------------------------------------------------------------------------
  const DRAW = { line: drawLine, bar: drawBar, scatter: drawScatter, heatmap: drawHeatmap, stat: drawStat, table: drawTable };
  let store = { get: () => ({}), set: () => {} };

  function draw(el) {
    let spec;
    try { spec = JSON.parse(el.dataset.spec); } catch (e) { el.textContent = 'Widget spec is not valid JSON.'; return; }
    const key = el.dataset.key;
    const state = Object.assign({ hidden: [], table: false }, store.get(key));
    const save = () => store.set(key, state);
    try { (DRAW[spec.type] || drawTable)(el, spec, state, save); }
    catch (e) { el.textContent = ''; html('div', 'wdg-err', `Could not draw this widget: ${e.message}`, el); }
  }

  // Draw every widget under `root`. Keys are section + title + position, so a widget's hidden
  // series, sort and table toggle survive the board re-rendering around it.
  function mount(root, s) {
    if (s) store = s;
    const els = (root || document).querySelectorAll('.wdg');
    const count = {};
    els.forEach((el) => {
      let t = 'w';
      try { const sp = JSON.parse(el.dataset.spec); t = sp.title || sp.type; } catch (e) {}
      // scoped per board section (a card, the state block, one live block), which re-render apart
      const scopeEl = el.closest('[data-scope]');
      const k = `${scopeEl ? scopeEl.dataset.scope : ''}|${t}`;
      count[k] = (count[k] || 0) + 1;
      el.dataset.key = `${k}#${count[k]}`;
      draw(el);
      if (!el._ro && window.ResizeObserver) {
        let w = el.clientWidth;
        el._ro = new ResizeObserver(() => { if (Math.abs(el.clientWidth - w) > 8) { w = el.clientWidth; draw(el); } });
        el._ro.observe(el);
      }
    });
  }

  window.CanvasWidgets = { mount };
})();
