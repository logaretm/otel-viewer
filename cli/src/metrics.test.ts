import { describe, expect, test } from 'bun:test';
import {
  currentValue,
  groupSeries,
  histogramBars,
  seriesStats,
} from './metrics';
import type { Metric, MetricType, TraceSource } from './types';

const T0 = 1_700_000_000_000;
let seq = 0;

function metric(over: Partial<Metric> = {}): Metric {
  return {
    metric_id: `m${seq++}`,
    name: 'requests',
    description: null,
    unit: null,
    type: 'gauge' as MetricType,
    service_name: 'api',
    timestamp: T0,
    value: 1,
    histogram: null,
    set_values: null,
    attributes: {},
    source: 'OTLP' as TraceSource,
    ...over,
  };
}

const values = (points: { v: number }[]) => points.map((p) => p.v);

describe('groupSeries', () => {
  test('points of one series are collected in time order', () => {
    const series = groupSeries([
      metric({ timestamp: T0 + 2000, value: 3 }),
      metric({ timestamp: T0, value: 1 }),
      metric({ timestamp: T0 + 1000, value: 2 }),
    ]);
    expect(series).toHaveLength(1);
    expect(values(series[0]!.points)).toEqual([1, 2, 3]);
  });

  test('attributes split a name into separate series', () => {
    const series = groupSeries([
      metric({ attributes: { route: '/a' }, value: 1 }),
      metric({ attributes: { route: '/b' }, value: 90 }),
    ]);
    expect(series).toHaveLength(2);
  });

  test('attribute key order does not change identity', () => {
    const series = groupSeries([
      metric({ attributes: { a: '1', b: '2' } }),
      metric({ attributes: { b: '2', a: '1' } }),
    ]);
    expect(series).toHaveLength(1);
  });

  // Two services reporting the same instrument under the same name, with no
  // attributes to tell them apart, used to interleave into one line that
  // zigzagged between unrelated numbers.
  test('service name splits a name into separate series', () => {
    const series = groupSeries([
      metric({ service_name: 'api', value: 100, timestamp: T0 }),
      metric({ service_name: 'worker', value: 900, timestamp: T0 + 1000 }),
      metric({ service_name: 'api', value: 110, timestamp: T0 + 2000 }),
      metric({ service_name: 'worker', value: 890, timestamp: T0 + 3000 }),
    ]);
    expect(series).toHaveLength(2);
    expect(values(series[0]!.points)).toEqual([100, 110]);
    expect(values(series[1]!.points)).toEqual([900, 890]);
  });

  test('source splits a name into separate series', () => {
    const series = groupSeries([
      metric({ source: 'OTLP' }),
      metric({ source: 'SENTRY' }),
    ]);
    expect(series).toHaveLength(2);
  });

  test('ordering runs name-first, so the origin cannot regroup the list', () => {
    const series = groupSeries([
      metric({ name: 'zeta', service_name: 'aaa' }),
      metric({ name: 'alpha', service_name: 'zzz' }),
    ]);
    expect(series.map((s) => s.name)).toEqual(['alpha', 'zeta']);
  });

  describe('distinguisher', () => {
    test('is empty when the name is already unique', () => {
      const series = groupSeries([metric({ attributes: { route: '/a' } })]);
      expect(series[0]!.distinguisher).toBe('');
    });

    test('names only the attribute values that differ', () => {
      const series = groupSeries([
        metric({ attributes: { route: '/a', env: 'prod' } }),
        metric({ attributes: { route: '/b', env: 'prod' } }),
      ]);
      expect(series.map((s) => s.distinguisher)).toEqual(['/a', '/b']);
    });

    test('falls back to the service when that is what split them', () => {
      const series = groupSeries([
        metric({ service_name: 'api' }),
        metric({ service_name: 'worker' }),
      ]);
      expect(series.map((s) => s.distinguisher)).toEqual(['api', 'worker']);
    });
  });

  describe('non-finite values', () => {
    test('are dropped without taking the rest of the series with them', () => {
      const series = groupSeries([
        metric({ timestamp: T0, value: 1 }),
        metric({ timestamp: T0 + 1000, value: NaN }),
        metric({ timestamp: T0 + 2000, value: Infinity }),
        metric({ timestamp: T0 + 3000, value: 3 }),
      ]);
      expect(values(series[0]!.points)).toEqual([1, 3]);
    });

    test('a bucketless histogram with a non-finite sum contributes nothing', () => {
      const series = groupSeries([
        metric({
          type: 'histogram',
          value: null,
          histogram: {
            buckets: [],
            sum: Infinity,
            count: 1,
            min: 0,
            max: 0,
          },
        }),
      ]);
      expect(series[0]!.points).toHaveLength(0);
    });
  });

  describe('histograms', () => {
    const bucketed = metric({
      type: 'histogram',
      value: null,
      histogram: {
        buckets: [
          { bound: 10, count: 4 },
          { bound: Infinity, count: 1 },
        ],
        sum: 100,
        count: 5,
        min: 1,
        max: 40,
      },
    });

    // A Sentry distribution: no explicit bounds, one observation per point.
    const distribution = (v: number, i: number) =>
      metric({
        type: 'histogram',
        value: null,
        timestamp: T0 + i * 1000,
        histogram: { buckets: [], sum: v, count: 1, min: v, max: v },
      });

    test('a bucketed one charts its snapshot, not a point stream', () => {
      const [series] = groupSeries([bucketed]);
      expect(series!.buckets).toHaveLength(2);
      expect(series!.points).toHaveLength(0);
    });

    test('a bucketless one charts over time instead', () => {
      const series = groupSeries([distribution(120, 0), distribution(140, 1)]);
      expect(series[0]!.buckets).toBeNull();
      expect(values(series[0]!.points)).toEqual([120, 140]);
    });
  });
});

describe('histogramBars', () => {
  test('labels bounds, and the overflow bucket as infinity', () => {
    const out = histogramBars({
      buckets: [
        { bound: 10, count: 4 },
        { bound: Infinity, count: 1 },
      ],
      sum: 0,
      count: 5,
      min: 0,
      max: 0,
    });
    expect(out.map((b) => b.label)).toEqual(['10', '+∞']);
  });

  test('an unreadable count is treated as an empty bucket', () => {
    const out = histogramBars({
      buckets: [{ bound: 10, count: NaN }],
      sum: 0,
      count: 0,
      min: 0,
      max: 0,
    });
    expect(out[0]!.value).toBe(0);
  });
});

describe('seriesStats', () => {
  test('summarises the points, not the latest snapshot', () => {
    const [series] = groupSeries([
      metric({ timestamp: T0, value: 4 }),
      metric({ timestamp: T0 + 1000, value: 10 }),
      metric({ timestamp: T0 + 2000, value: 1 }),
    ]);
    expect(seriesStats(series!)).toEqual({
      last: 1,
      min: 1,
      max: 10,
      avg: 5,
      count: 3,
    });
  });

  test('an empty series reports no last value rather than a zero', () => {
    const [series] = groupSeries([metric({ value: NaN })]);
    expect(seriesStats(series!).last).toBeNull();
  });
});

describe('currentValue', () => {
  test('a gauge reports its newest point', () => {
    const [series] = groupSeries([
      metric({ timestamp: T0, value: 1 }),
      metric({ timestamp: T0 + 1000, value: 7 }),
    ]);
    expect(currentValue(series!)).toBe(7);
  });

  // The observation count is not in the metric's unit; the mean is.
  test('a bucketed histogram reports the mean of its snapshot', () => {
    const [series] = groupSeries([
      metric({
        type: 'histogram',
        value: null,
        histogram: {
          buckets: [{ bound: Infinity, count: 4 }],
          sum: 400,
          count: 4,
          min: 0,
          max: 0,
        },
      }),
    ]);
    expect(currentValue(series!)).toBe(100);
  });

  test('an unobserved histogram reports nothing rather than zero', () => {
    const [series] = groupSeries([
      metric({
        type: 'histogram',
        value: null,
        histogram: {
          buckets: [{ bound: Infinity, count: 0 }],
          sum: 0,
          count: 0,
          min: 0,
          max: 0,
        },
      }),
    ]);
    expect(currentValue(series!)).toBeNull();
  });

  test('a set falls back to its cardinality', () => {
    const [series] = groupSeries([
      metric({ type: 'set', value: null, set_values: ['a', 'b', 'c'] }),
    ]);
    expect(currentValue(series!)).toBe(3);
  });
});
