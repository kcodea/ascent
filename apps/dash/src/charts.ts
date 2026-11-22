// Inline SVG charts as strings (no chart library). `labels` are the x-axis labels, already formatted (one per bucket). Every chart is drawn for its container's measured width, so text
// is never stretched; the page redraws on resize. Hover targets are full-height columns carrying `data-i` (the day
// index); the page's tooltip reads it.
import { esc, niceScale } from './format';

const PAD = { top: 10, right: 12, bottom: 24, left: 34 };

function frame(width: number, height: number, max: number, labels: string[]) {
  const iw = Math.max(10, width - PAD.left - PAD.right);
  const ih = height - PAD.top - PAD.bottom;
  const scale = niceScale(max);
  const y = (v: number) => PAD.top + ih - (v / scale.max) * ih;
  let grid = '';
  for (let v = 0; v <= scale.max; v += scale.step) {
    grid += `<line class="gridline" x1="${PAD.left}" x2="${PAD.left + iw}" y1="${y(v)}" y2="${y(v)}"/>`;
    grid += `<text x="${PAD.left - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  const col = iw / Math.max(1, labels.length);
  const every = Math.max(1, Math.ceil(46 / col)); // a "22 Nov" or "14:00" label needs ~40px
  let xl = '';
  labels.forEach((d, i) => {
    if ((labels.length - 1 - i) % every !== 0) return;
    xl += `<text x="${PAD.left + col * i + col / 2}" y="${height - 6}" text-anchor="middle">${esc(d)}</text>`;
  });
  return { iw, ih, y, col, grid, xl };
}

function hits(n: number, col: number, height: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += `<rect class="hit" data-i="${i}" x="${PAD.left + col * i}" y="0" width="${col}" height="${height - PAD.bottom}"/>`;
  return s;
}

/** A rect with only its top corners rounded (data ends rounded, baseline square). */
function topRounded(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

/** Stacked daily bars. `values[i][s]` = series s on day i; `slots[s]` = the colour slot of series s. */
export function stackedBars(days: string[], values: number[][], slots: number[], width: number, height = 220): string {
  const totals = values.map((v) => v.reduce((a, b) => a + b, 0));
  const f = frame(width, height, Math.max(...totals, 1), days);
  const bw = Math.max(2, Math.min(28, f.col - 3));
  let bars = '';
  values.forEach((v, i) => {
    const x = PAD.left + f.col * i + (f.col - bw) / 2;
    let acc = 0;
    const top = v.reduce((last, n, s) => (n > 0 ? s : last), -1);
    v.forEach((n, s) => {
      if (n <= 0) return;
      const y0 = f.y(acc + n);
      const h = f.y(acc) - y0;
      acc += n;
      const cls = `f${slots[s]}`;
      bars += s === top
        ? `<path class="${cls}" d="${topRounded(x, y0, bw, h, 3)}"/>`
        : `<rect class="${cls}" x="${x}" y="${y0}" width="${bw}" height="${h}"/>`;
      // 2px surface gap between stacked segments
      if (acc > n) bars += `<line class="seg-gap" x1="${x}" x2="${x + bw}" y1="${f.y(acc - n)}" y2="${f.y(acc - n)}"/>`;
    });
  });
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Games finished, stacked by mode">${f.grid}${bars}${f.xl}${hits(days.length, f.col, height)}</svg>`;
}

/** Lines on one shared axis. `series[k].values[i]`; `dashed` draws a secondary series. */
export function lines(
  days: string[],
  series: Array<{ values: number[]; slot: number; dashed?: boolean; label: string }>,
  width: number,
  height = 200,
): string {
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const f = frame(width, height, max, days);
  const x = (i: number) => PAD.left + f.col * i + f.col / 2;
  let paths = '';
  for (const s of series) {
    const d = s.values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${f.y(v).toFixed(1)}`).join('');
    paths += `<path class="line l${s.slot}${s.dashed ? ' dash' : ''}" d="${d}"/>`;
    const last = s.values.length - 1;
    if (last >= 0) paths += `<circle class="dot f${s.slot}" cx="${x(last)}" cy="${f.y(s.values[last]!)}" r="4"/>`;
  }
  return `<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${esc(series.map((s) => s.label).join(' and '))}">${f.grid}${paths}${f.xl}${hits(days.length, f.col, height)}</svg>`;
}

/** A tile sparkline (no axes; the tile's big number is the read). */
export function sparkline(values: number[], width = 240, height = 36): string {
  if (values.length === 0) return '';
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? (width - 6) / (values.length - 1) : 0;
  const pts = values.map((v, i) => [3 + step * i, height - 3 - (v / max) * (height - 8)] as const);
  const d = pts.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`).join('');
  const area = `${d}L${pts[pts.length - 1]![0].toFixed(1)},${height}L${pts[0]![0].toFixed(1)},${height}Z`;
  const [lx, ly] = pts[pts.length - 1]!;
  return `<svg viewBox="0 0 ${width} ${height}" aria-hidden="true"><path class="spark-area" d="${area}"/><path class="spark" d="${d}"/><circle class="spark-dot" cx="${lx}" cy="${ly}" r="3"/></svg>`;
}

/** A small inline bar for a 0..1 share inside a table cell. */
export function miniBar(x: number | null, max: number, width = 64): string {
  const w = x == null || !(max > 0) ? 0 : Math.max(1, Math.round((x / max) * width));
  return `<svg class="minibar" width="${width}" height="6" aria-hidden="true"><rect class="bg" width="${width}" height="6" rx="3"/><rect class="fg" width="${w}" height="6" rx="3"/></svg>`;
}
