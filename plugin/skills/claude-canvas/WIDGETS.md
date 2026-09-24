# Widgets

A widget is a chart or table described as JSON. The board draws it, interactive and in the
current theme. You describe the data once instead of rendering a new PNG every time it changes.
If the widget points at a data file, the chart redraws itself when that file changes.

```bash
canvas widget <<'JSON'
{"type": "line", "title": "Validation mAP", "src": "results/train_log.csv",
 "x": "epoch", "y": "val_mAP", "series": "arm", "yPercent": true}
JSON
```

`canvas widget` checks the spec and fails with a clear message if something is wrong, such as a
missing column, a missing file or an unknown type. It then writes
`feed/<stamp>-<title>.widget.json`. You can also put a widget in any markdown the board renders
(a note, `state.md` or a live block's output) as a fenced `widget` block:

````markdown
```widget
{"type": "stat", "items": [{"label": "Best mAP", "value": 0.612, "percent": true}]}
```
````

A live block that prints a `widget` fence gives you a chart that refreshes on the block's
interval.

## Every widget

| Field | Meaning |
|---|---|
| `type` | `line`, `bar`, `scatter`, `heatmap`, `stat` or `table` |
| `title`, `subtitle` | Heading and a muted second line. Say what is plotted and in what units |
| `data` | The rows, inline: `[{"epoch": 1, "loss": 2.3}, …]` |
| `src` | Or a file: `.csv`, `.tsv`, `.json` (an array, or `{"rows": […]}`) or `.jsonl`. Relative paths start at the workspace root. The widget redraws when the file changes |
| `last` | Keep only the last N rows. Useful for a long log. The board keeps at most 5 000 rows |
| `height` | Plot height in px (default 220) |

Numeric-looking strings from CSV become numbers. Empty cells, `nan`, `null` and `NA` become
gaps.

Every chart has a **Table** button that shows the same data as a sortable table, so no value
is only reachable by hovering.

## `line`: a trend over time or steps

```json
{"type": "line", "src": "runs/log.csv", "x": "epoch", "y": ["train_loss", "val_loss"]}
{"type": "line", "src": "runs/all.csv", "x": "epoch", "y": "mAP", "series": "arm"}
```

- `x` is a column of numbers, ISO dates or categories.
- `y` is one column, or a list of columns (wide format).
- `series` names a column to split rows by (long format). Use either `series` or a list of `y`
  columns, not both.
- `emphasis` names one series to draw in the accent color, with the others greyed out. Use it
  when one run is the point and the rest are context.
- `yScale: "log"`, `yZero: true` (start the axis at zero), `yPercent: true` (values from 0 to 1
  shown as %), `yUnit: " ms"`, `yDecimals: 2`, `xLabel`.

Hovering shows a crosshair that snaps to the nearest x and a readout for every series at that
point. Arrow keys move it once the chart has focus. Clicking a legend entry hides or shows that
series. The other series keep their colors.

## `bar`: comparing values across categories

```json
{"type": "bar", "data": [...], "x": "arm", "y": "mAP", "series": "condition", "yPercent": true}
```

Same `x`/`y`/`series` rules as `line`. Bars start at zero. With more than 8 categories, or long
labels, the chart goes horizontal (force it with `"horizontal": true` or `false`). Values sit on
the bar ends when they fit. Hovering a bar shows its value and dims the others.

## `scatter`: two measures against each other

```json
{"type": "scatter", "data": [...], "x": "R1", "y": "mAP", "series": "arm", "label": "seed"}
```

`label` names a column shown as the tooltip heading. Hovering picks the nearest point within
24 px, so you don't have to land on the dot. At most **three** series are drawn, and any more
fold into "Other": four or more colors can't be told apart in a scatter.

## `heatmap`: a grid of magnitudes

```json
{"type": "heatmap", "data": [...], "x": "condition", "y": "arm", "value": "mAP", "values": true}
```

Cells use one blue ramp, from light (low) to dark (high). `values: true` writes each value in
its cell when it fits. `min` and `max` pin the ramp's ends, for example to compare several
heatmaps on the same scale.

## `stat`: headline numbers

```json
{"type": "stat", "items": [
  {"label": "Wrong-scene mAP", "value": 43.5, "unit": "%", "delta": 12.3, "vs": "baseline",
   "trend": [20, 28, 35, 39, 41, 43.5]},
  {"label": "No-FG mAP", "value": 3.9, "unit": "%", "delta": -5.2, "good": "down"}
]}
```

- `delta` is signed and shows an arrow. It is green when the change is good, and `good: "down"`
  says lower is better.
- `percent`, `unit` and `decimals` format the value.
- `trend` draws a small sparkline.
- If the story is one number, use a stat, not a one-bar chart.

## `table`

```json
{"type": "table", "src": "results/summary.csv", "columns": ["arm", "R1", "mAP"], "decimals": 1}
```

Click a header to sort. A filter box appears once there are more than 10 rows. At most 300 rows
are shown at once. Integer columns never get decimals.

## Choosing a type

| The data's job | Widget |
|---|---|
| One number, or a few headline numbers | `stat` |
| Change over epochs or time | `line` |
| One run matters and the rest are context | `line` with `emphasis` |
| Compare values across categories | `bar` |
| Two measures, each point one item | `scatter` (≤ 3 groups) |
| A grid (arm × condition) | `heatmap` |
| More than about 7 things that all matter, or exact values | `table` |

## What the board guarantees

These come from the dataviz method the renderer follows:

- **Colors.** The eight series colors come from a palette validated for colorblind separation on
  VS Code's light and dark backgrounds. Slots are assigned in spec order and never cycle: a 9th
  series folds into "Other".
- **One y-axis.** There is never a second y-scale. Put measures with different scales in
  separate widgets.
- **Marks.** 2 px lines, bars at most 24 px thick with rounded ends, hairline grid.
- **Legends.** Two or more series always get a legend. Line end labels are added only when they
  don't collide.
- **Text.** Labels and tooltips use text colors, never the series color. Everything from data
  files is inserted as text, never as HTML.
