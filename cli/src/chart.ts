// Terminal charting primitives. No dependency and no OpenTUI renderable does
// this, so both renderers below produce plain rows of text that a component
// prints like any other line.
//
// Two renderers, one texture. A braille cell carries 2x4 dots, so an 8-row
// panel plots at 32 rows of vertical resolution and every column can be
// addressed at half-cell precision. A time series draws as a line through those
// dots; histogram buckets draw as filled rectangles of them. Bars could use the
// eighth-block ramp instead, which would double their vertical resolution, but
// then the two charts would not look like they came from the same program, and
// a bar's height is read against the axis rather than to within an eighth of a
// row.
//
// Both take the panel's full width and lay out their own y-axis column, since
// how wide the labels are is only known once the scale is. When the panel is
// too narrow to carry both, the scale is what gives.

// Braille cells are U+2800 plus a bitmask over the 8 dots, whose bit order is
// historical rather than raster order: the first three rows fill column-major
// (bits 0-2, 3-5) and the fourth row was appended later (bits 6-7). Indexed
// [row][col] so callers can think in pixels.
const DOT_BITS = [
  [0x01, 0x08],
  [0x02, 0x10],
  [0x04, 0x20],
  [0x40, 0x80],
] as const;

const CELL_W = 2;
const CELL_H = 4;
const BRAILLE_BASE = 0x2800;

export class BrailleCanvas {
  private readonly cells: Uint8Array;

  constructor(
    readonly cols: number,
    readonly rows: number,
  ) {
    this.cells = new Uint8Array(cols * rows);
  }

  get width(): number {
    return this.cols * CELL_W;
  }

  get height(): number {
    return this.rows * CELL_H;
  }

  // Pixel coordinates, origin top-left. Out of bounds is dropped rather than
  // clamped, so a clipped line loses the offscreen part instead of smearing it
  // along the edge.
  set(x: number, y: number): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    const index = ((py / CELL_H) | 0) * this.cols + ((px / CELL_W) | 0);
    this.cells[index]! |= DOT_BITS[py % CELL_H]![px % CELL_W]!;
  }

  // Bresenham between consecutive samples, so a steep climb reads as one line
  // rather than a column of unconnected dots.
  line(x0: number, y0: number, x1: number, y1: number): void {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const ex = Math.round(x1);
    const ey = Math.round(y1);
    const dx = Math.abs(ex - x);
    const dy = -Math.abs(ey - y);
    const sx = x < ex ? 1 : -1;
    const sy = y < ey ? 1 : -1;
    let err = dx + dy;

    for (;;) {
      this.set(x, y);
      if (x === ex && y === ey) return;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  // Fills a pixel rectangle. Bars are drawn with this rather than with block
  // characters so both charts share one texture, and so a bar can be an odd
  // number of dots wide.
  fillRect(x: number, y: number, w: number, h: number): void {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) this.set(x + dx, y + dy);
    }
  }

  toRows(): string[] {
    const out: string[] = [];
    for (let row = 0; row < this.rows; row++) {
      let line = '';
      for (let col = 0; col < this.cols; col++) {
        line += String.fromCharCode(
          BRAILLE_BASE + this.cells[row * this.cols + col]!,
        );
      }
      out.push(line);
    }
    return out;
  }
}

// Below this there is no room for a plot worth drawing.
const MIN_COLS = 8;
const MIN_ROWS = 2;

export interface Axis {
  // One label per plot row, right-aligned into a common width. Rows with no
  // tick are blank, so a caller prints this alongside the plot row for row and
  // can tell a tick row from a plain one by whether its label is empty.
  y: string[];
  // The row under the plot, plotWidth wide.
  x: string;
  // Width of the y column, so the caller can indent the axis rule to match.
  yWidth: number;
  // False when the panel was too narrow to carry a scale and the plot took the
  // whole width instead. The caller draws no gutter column in that case.
  gutter: boolean;
}

export interface Chart {
  plot: string[];
  plotWidth: number;
  axis: Axis;
  min: number;
  max: number;
}

export interface Point {
  t: number;
  v: number;
}

export interface Bar {
  label: string;
  value: number;
}

// Ticks including both ends, so the top and bottom of the plot are always
// labelled and the reader never has to infer the range.
function tickRows(rows: number): number[] {
  if (rows <= 1) return [0];
  const count = Math.max(2, Math.min(5, Math.ceil(rows / 2)));
  const at = new Set<number>();
  for (let i = 0; i < count; i++) {
    at.add(Math.round((i * (rows - 1)) / (count - 1)));
  }
  return [...at];
}

function buildYAxis(
  rows: number,
  min: number,
  max: number,
  formatValue: (v: number) => string,
): { y: string[]; yWidth: number } {
  const ticks = new Set(tickRows(rows));
  const labels = Array.from({ length: rows }, (_, row) => {
    if (!ticks.has(row)) return '';
    // Row 0 is the top of the plot, so it carries the maximum.
    const fraction = rows === 1 ? 0 : row / (rows - 1);
    return formatValue(max - (max - min) * fraction);
  });
  const yWidth = labels.reduce((w, label) => Math.max(w, label.length), 0);
  return { y: labels.map((label) => label.padStart(yWidth)), yWidth };
}

// Fits the y scale into the panel, giving up the scale rather than the plot
// when there is not room for both: a plot with no labels still shows shape,
// which beats refusing to draw and telling the reader to resize the terminal.
// Returns null only when even a bare plot will not fit.
function fitAxis(
  width: number,
  rows: number,
  min: number,
  max: number,
  formatValue: (v: number) => string,
): { y: string[]; yWidth: number; gutter: boolean; cols: number } | null {
  const scale = buildYAxis(rows, min, max, formatValue);
  const cols = width - scale.yWidth - 1; // -1 for the gutter
  if (cols >= MIN_COLS) return { ...scale, gutter: true, cols };
  if (width >= MIN_COLS) {
    return {
      y: Array.from({ length: rows }, () => ''),
      yWidth: 0,
      gutter: false,
      cols: width,
    };
  }
  return null;
}

// Writes labels into a fixed-width row at fractional positions. A label is
// dropped rather than overlapped when it will not clear the one before it,
// which keeps a narrow panel readable instead of running the ticks together.
//
// 'edges' tucks the first and last labels inside the plot, which is what a time
// axis wants: its outer ticks are the ends of the range. 'center' puts every
// label over its own position, which is what a bucket axis wants, since each
// one names the bar underneath it rather than a point on a continuum.
function placeLabels(
  entries: { at: number; text: string }[],
  width: number,
  align: 'edges' | 'center',
): string {
  const row: string[] = Array.from({ length: width }, () => ' ');
  let usedThrough = -1;

  for (const [i, entry] of entries.entries()) {
    const { text } = entry;
    if (!text || text.length > width) continue;
    const anchor = entry.at * (width - 1);
    const raw =
      align === 'edges' && i === 0
        ? anchor
        : align === 'edges' && i === entries.length - 1
          ? anchor - (text.length - 1)
          : anchor - (text.length - 1) / 2;
    const start = Math.max(0, Math.min(width - text.length, Math.round(raw)));
    if (i > 0 && start <= usedThrough + 1) continue;
    for (let c = 0; c < text.length; c++) row[start + c] = text[c]!;
    usedThrough = start + text.length - 1;
  }

  return row.join('');
}

/**
 * A time series as a braille line. Points may be in any order and are plotted
 * against real time, so a gap in emission reads as a gap rather than being
 * closed up by even spacing.
 *
 * `width` is the whole panel: the y labels and the axis gutter come out of it.
 */
export function buildLineChart(options: {
  points: Point[];
  width: number;
  rows: number;
  formatValue: (v: number) => string;
  formatTime: (t: number) => string;
}): Chart | null {
  const { width, rows, formatValue, formatTime } = options;
  if (rows < MIN_ROWS) return null;

  const points = [...options.points].sort((a, b) => a.t - b.t);
  if (points.length === 0) return null;

  const values = points.map((p) => p.v);
  let min = Math.min(...values);
  let max = Math.max(...values);
  // A flat series has no range to scale into. Pad it so the line lands in the
  // middle of the plot rather than on an edge, where it reads as clipped.
  if (max - min < Number.EPSILON) {
    const pad = Math.abs(max) > 0 ? Math.abs(max) * 0.5 : 1;
    min -= pad;
    max += pad;
  }

  const axis = fitAxis(width, rows, min, max, formatValue);
  if (!axis) return null;
  const { y, yWidth, gutter, cols } = axis;

  const canvas = new BrailleCanvas(cols, rows);
  const tMin = points[0]!.t;
  const tMax = points[points.length - 1]!.t;
  const span = tMax - tMin;

  const px = (p: Point, i: number) =>
    span > 0
      ? ((p.t - tMin) / span) * (canvas.width - 1)
      : points.length === 1
        ? 0
        : (i / (points.length - 1)) * (canvas.width - 1);
  const py = (p: Point) =>
    (1 - (p.v - min) / (max - min)) * (canvas.height - 1);

  if (points.length === 1) {
    canvas.set(0, py(points[0]!));
  } else {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1]!;
      const b = points[i]!;
      canvas.line(px(a, i - 1), py(a), px(b, i), py(b));
    }
  }

  // Two labels on a narrow panel, up to four when there is room for them.
  const count = Math.max(2, Math.min(4, Math.floor(cols / 13)));
  const x = placeLabels(
    Array.from({ length: count }, (_, i) => {
      const at = i / (count - 1);
      return { at, text: formatTime(tMin + span * at) };
    }),
    cols,
    'edges',
  );

  return {
    plot: canvas.toRows(),
    plotWidth: cols,
    axis: { y, x, yWidth, gutter },
    min,
    max,
  };
}

/**
 * Histogram buckets as bars, filled into the same braille grid the line uses.
 * Bars are laid out in dots rather than cells, so twice as many buckets fit
 * before any have to be merged; buckets that still cannot each hold a column
 * are merged with their neighbours (counts summed, the group keeping the first
 * bound's label), so a narrow panel shows a coarser histogram rather than a
 * truncated one.
 */
export function buildBarChart(options: {
  bars: Bar[];
  width: number;
  rows: number;
  formatValue: (v: number) => string;
}): Chart | null {
  const { width, rows, formatValue } = options;
  if (rows < MIN_ROWS || options.bars.length === 0) return null;

  // Merging raises the tallest bar, which can widen the y labels, which narrows
  // the plot again. Merging only ever reduces the bar count, so re-running the
  // measurement settles immediately; the bound is a backstop, not a schedule.
  let bars = options.bars;
  let max = 0;
  let axis: ReturnType<typeof fitAxis> = null;

  for (let pass = 0; pass < 3; pass++) {
    max = Math.max(...bars.map((bar) => bar.value));
    axis = fitAxis(width, rows, 0, max, formatValue);
    if (!axis) return null;
    if (bars.length <= axis.cols) break;
    bars = mergeBars(bars, axis.cols);
  }

  // Every bucket is empty: there is no scale to draw, and an empty plot says so
  // more honestly than a row of full-height bars would.
  if (max <= 0 || !axis) return null;

  const { y, yWidth, gutter, cols } = axis;
  const canvas = new BrailleCanvas(cols, rows);

  // Bars are laid out in dots rather than cells, so a bar can be an odd number
  // of dots wide and twice as many buckets fit before any have to be merged.
  const slot = Math.max(2, Math.floor(canvas.width / bars.length));
  const fill = slot > 2 ? slot - 1 : slot;

  for (const [i, bar] of bars.entries()) {
    if (bar.value <= 0) continue;
    // Floored at one dot, so a bucket with a single sample stays visible next
    // to a tall neighbour instead of rounding away to nothing.
    const height = Math.max(1, Math.round((bar.value / max) * canvas.height));
    canvas.fillRect(i * slot, canvas.height - height, fill, height);
  }

  // Centred on the bar itself, not on its left edge, so a label sits over the
  // column it names. Dot positions halve into cell positions.
  const x = placeLabels(
    bars.map((bar, i) => ({
      at: (i * slot + (fill - 1) / 2) / 2 / Math.max(1, cols - 1),
      text: bar.label,
    })),
    cols,
    'center',
  );

  return {
    plot: canvas.toRows(),
    plotWidth: cols,
    axis: { y, x, yWidth, gutter },
    min: 0,
    max,
  };
}

function mergeBars(bars: Bar[], groups: number): Bar[] {
  const size = Math.ceil(bars.length / groups);
  const merged: Bar[] = [];
  for (let i = 0; i < bars.length; i += size) {
    const group = bars.slice(i, i + size);
    merged.push({
      label: group[0]!.label,
      value: group.reduce((sum, bar) => sum + bar.value, 0),
    });
  }
  return merged;
}
