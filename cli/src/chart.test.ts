import { describe, expect, test } from 'bun:test';
import { BrailleCanvas, buildBarChart, buildLineChart } from './chart';
import type { Bar, Chart, Point } from './chart';

const fmt = (v: number) => String(Math.round(v));
const time = () => '00:00:00';

const T0 = 1_700_000_000_000;
const at = (v: number, i: number): Point => ({ t: T0 + i * 1000, v });
const series = (values: number[]): Point[] => values.map(at);

const line = (points: Point[], width = 40, rows = 6) =>
  buildLineChart({ points, width, rows, formatValue: fmt, formatTime: time });

const bars = (values: number[], width = 40, rows = 6) =>
  buildBarChart({
    bars: values.map((value, i) => ({ label: `b${i}`, value })),
    width,
    rows,
    formatValue: fmt,
  });

// The layout contract both renderers owe their caller: the component prints
// these rows next to each other, so a row that is off by one column puts the
// panel border in the wrong place.
function expectRectangular(chart: Chart | null, rows: number): Chart {
  expect(chart).not.toBeNull();
  const c = chart!;
  expect(c.plot).toHaveLength(rows);
  // Braille and box-drawing glyphs are all BMP, so a UTF-16 length is the
  // column count here.
  for (const row of c.plot) expect(row).toHaveLength(c.plotWidth);
  expect(c.axis.y).toHaveLength(rows);
  for (const label of c.axis.y) expect(label).toHaveLength(c.axis.yWidth);
  expect(c.axis.x).toHaveLength(c.plotWidth);
  return c;
}

describe('BrailleCanvas', () => {
  test('a filled cell is the all-dots glyph, an empty one the blank', () => {
    const canvas = new BrailleCanvas(1, 1);
    expect(canvas.toRows()).toEqual(['⠀']);
    canvas.fillRect(0, 0, 2, 4);
    expect(canvas.toRows()).toEqual(['⣿']);
  });

  test('dots map to the corners they are drawn at', () => {
    const canvas = new BrailleCanvas(1, 1);
    canvas.set(0, 0); // top-left
    canvas.set(1, 3); // bottom-right
    expect(canvas.toRows()[0]).toBe(String.fromCharCode(0x2800 + 0x01 + 0x80));
  });

  test('out of bounds is dropped, not wrapped onto the next row', () => {
    const canvas = new BrailleCanvas(2, 1);
    canvas.set(-1, 0);
    canvas.set(0, 99);
    canvas.set(99, 0);
    expect(canvas.toRows()).toEqual(['⠀⠀']);
  });

  // Every comparison against NaN is false, so a range-only guard waves it
  // through and the dot-bit lookup throws on an undefined row.
  test('non-finite coordinates are refused rather than indexed', () => {
    const canvas = new BrailleCanvas(2, 2);
    expect(() => canvas.set(NaN, 0)).not.toThrow();
    expect(() => canvas.set(0, NaN)).not.toThrow();
    expect(() => canvas.set(Infinity, -Infinity)).not.toThrow();
    expect(canvas.toRows().join('')).toBe('⠀⠀⠀⠀');
  });

  // Bresenham cannot converge on a NaN endpoint: the exit test never fires and
  // neither advance branch is taken, so the loop spins forever. If this ever
  // regresses the whole suite hangs, which is the intended alarm.
  test('a non-finite endpoint does not hang the line walk', () => {
    const canvas = new BrailleCanvas(4, 4);
    canvas.line(0, 0, NaN, 3);
    canvas.line(NaN, NaN, 1, 1);
    expect(canvas.toRows().join('')).not.toContain('⣿');
  });
});

describe('buildLineChart', () => {
  test('returns rectangular rows with a full-width axis', () => {
    const chart = expectRectangular(line(series([1, 5, 3, 9, 4])), 6);
    expect(chart.min).toBe(1);
    expect(chart.max).toBe(9);
  });

  test('the top row carries the maximum and the bottom the minimum', () => {
    const chart = expectRectangular(line(series([2, 40])), 6);
    expect(chart.axis.y[0]!.trim()).toBe('40');
    expect(chart.axis.y.at(-1)!.trim()).toBe('2');
  });

  test('one point plots without a range to scale into', () => {
    expectRectangular(line(series([7])), 6);
  });

  test('a flat series is padded so the line is not drawn on an edge', () => {
    const chart = expectRectangular(line(series([5, 5, 5])), 6);
    expect(chart.min).toBeLessThan(5);
    expect(chart.max).toBeGreaterThan(5);
    // Nothing on the top or bottom row: the line sits in the middle.
    expect(chart.plot[0]).toBe('⠀'.repeat(chart.plotWidth));
    expect(chart.plot.at(-1)).toBe('⠀'.repeat(chart.plotWidth));
  });

  test('points out of order are plotted against time, not arrival', () => {
    const ordered = line(series([1, 9]));
    const shuffled = line([at(9, 1), at(1, 0)]);
    expect(shuffled!.plot).toEqual(ordered!.plot);
  });

  test('gives up only when even a bare plot will not fit', () => {
    expect(line(series([1, 2]), 40, 1)).toBeNull(); // below MIN_ROWS
    expect(line(series([1, 2]), 4, 6)).toBeNull(); // below MIN_COLS
    expect(line([], 40, 6)).toBeNull();
  });

  // The scale is what gives when the panel is narrow, not the plot.
  test('drops the y axis rather than refusing to draw', () => {
    const chart = expectRectangular(line(series([1000, 2000]), 12, 4), 4);
    expect(chart.axis.gutter).toBe(false);
    expect(chart.axis.yWidth).toBe(0);
    expect(chart.plotWidth).toBe(12);
  });

  test('keeps the y axis when there is room for both', () => {
    const chart = expectRectangular(line(series([1000, 2000]), 40, 4), 4);
    expect(chart.axis.gutter).toBe(true);
    expect(chart.axis.yWidth).toBeGreaterThan(0);
    expect(chart.plotWidth).toBe(40 - chart.axis.yWidth - 1);
  });

  describe('non-finite input', () => {
    test('a NaN sample does not throw', () => {
      expect(() => line([at(NaN, 0), at(5, 1), at(9, 2)])).not.toThrow();
      expect(() => line(series([NaN, NaN]))).not.toThrow();
    });

    // The reachable one: a lone Infinity leaves min/max finite for its
    // neighbours, so only its own position is NaN, which is exactly the mixed
    // endpoint pair that used to spin forever.
    test('a lone Infinity among finite samples does not hang', () => {
      expect(() => line([at(1, 0), at(Infinity, 1), at(3, 2)])).not.toThrow();
    });

    test('a range that overflows still plots, with finite labels', () => {
      const chart = expectRectangular(
        buildLineChart({
          points: [at(-1.7e308, 0), at(1.7e308, 1), at(5, 2)],
          width: 44,
          rows: 5,
          formatValue: (v) => v.toExponential(1),
          formatTime: time,
        }),
        5,
      );
      for (const label of chart.axis.y) {
        expect(label).not.toContain('NaN');
        expect(label).not.toContain('Infinity');
      }
      // Something was actually drawn.
      expect(chart.plot.join('')).not.toBe('⠀'.repeat(chart.plotWidth * 5));
    });
  });
});

describe('buildBarChart', () => {
  test('returns rectangular rows with a full-width axis', () => {
    const chart = expectRectangular(bars([1, 4, 9, 2]), 6);
    expect(chart.min).toBe(0);
    expect(chart.max).toBe(9);
  });

  test('a bucket with one sample stays visible beside a tall neighbour', () => {
    const chart = bars([1, 500])!;
    // The bottom row has to carry both bars, not just the tall one.
    expect(chart.plot.at(-1)).not.toBe('⠀'.repeat(chart.plotWidth));
    expect(chart.plot.at(-1)!.startsWith('⠀')).toBe(false);
  });

  test('an empty bucket draws nothing', () => {
    const chart = bars([0, 0, 9])!;
    // The left third is untouched.
    const left = chart.plot.map((row) => row.slice(0, 4)).join('');
    expect(left).toBe('⠀'.repeat(left.length));
  });

  test('more buckets than columns are merged, not truncated', () => {
    const many = Array.from({ length: 200 }, (_, i) => i + 1);
    const chart = expectRectangular(bars(many, 40, 6), 6);
    // Merging sums counts, so the tallest merged group exceeds any single bar.
    expect(chart.max).toBeGreaterThan(200);
  });

  test('gives up on an empty or all-zero histogram', () => {
    expect(bars([])).toBeNull();
    expect(bars([0, 0, 0])).toBeNull();
  });

  test('a non-finite count does not throw', () => {
    expect(() => bars([NaN, 4])).not.toThrow();
    expect(() => bars([Infinity, 4])).not.toThrow();
  });

  test('labels never run past the plot width', () => {
    const wide: Bar[] = Array.from({ length: 9 }, (_, i) => ({
      label: 'x'.repeat(12),
      value: i + 1,
    }));
    const chart = buildBarChart({
      bars: wide,
      width: 40,
      rows: 5,
      formatValue: fmt,
    })!;
    expect(chart.axis.x).toHaveLength(chart.plotWidth);
  });
});
