// Grouping raw metric points into the series a chart is drawn from.
//
// A Metric off the wire is one data point. What a reader wants is the series it
// belongs to, which is the name, the attribute set, *and* where it came from:
// `http.server.duration` split by route is several independent lines, and so is
// `process.runtime.memory.heap` reported by two services under the same name
// with no attributes at all. Folding any of those together produces a zigzag
// between unrelated numbers that describes nothing.

import type { Bar, Point } from './chart';
import { formatCompact } from './format';
import type { HistogramData, Metric, MetricType, TraceSource } from './types';

export interface MetricSeries {
  key: string;
  name: string;
  type: MetricType;
  unit: string | null;
  description: string | null;
  service_name: string;
  source: TraceSource;
  attributes: Record<string, unknown>;
  // Just enough of the attributes to tell this series from its siblings under
  // the same name, or empty when the name is already unique. Values only: the
  // keys are the same across the siblings by construction, so printing them
  // would spend a narrow list's columns saying nothing.
  distinguisher: string;
  // Ascending by time, so a chart can walk them in order.
  points: Point[];
  // The latest snapshot's buckets, or null when there is no bucketed shape to
  // draw. OTLP histograms carry explicit bounds; a Sentry distribution does
  // not, and arrives as one observation per point instead, so it is a series
  // over time rather than a distribution over buckets.
  buckets: Bar[] | null;
  // Newest point, which is what carries the current histogram or set contents.
  latest: Metric;
}

export interface SeriesStats {
  last: number | null;
  min: number;
  max: number;
  avg: number;
  count: number;
}

// Attributes are the other half of a series identity, so the key has to be
// stable under key order, which JSON.stringify is not on its own.
function attributeKey(attributes: Record<string, unknown>): string {
  const keys = Object.keys(attributes).sort();
  if (keys.length === 0) return '';
  return keys.map((k) => `${k}=${stableValue(attributes[k])}`).join(',');
}

// Attribute values are whatever the SDK put in them. Only primitives have a
// String() worth printing, so everything else goes through JSON.
function stableValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

// Everything that makes two points part of the same line. The origin trails the
// attributes so that sorting on this still runs name-first: prefixing the
// service would group the list by service and break the ordering the docblock
// below promises.
function seriesKey(metric: Metric): string {
  return [
    metric.name,
    attributeKey(metric.attributes),
    metric.service_name,
    metric.source,
  ].join(' ');
}

/**
 * Groups points into series, ordered by name then by attributes. Alphabetical
 * rather than newest-first on purpose: series are long-lived, and a list that
 * reorders itself as points arrive would move the selection out from under
 * whoever is holding the arrow key.
 */
export function groupSeries(metrics: Metric[]): MetricSeries[] {
  const byKey = new Map<string, Metric[]>();

  for (const metric of metrics) {
    const key = seriesKey(metric);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(metric);
    else byKey.set(key, [metric]);
  }

  const series: MetricSeries[] = [];
  for (const [key, points] of byKey) {
    const ordered = [...points].sort((a, b) => a.timestamp - b.timestamp);
    const latest = ordered[ordered.length - 1]!;
    series.push({
      key,
      name: latest.name,
      type: latest.type,
      unit: latest.unit,
      description: latest.description,
      service_name: latest.service_name,
      source: latest.source,
      attributes: latest.attributes,
      distinguisher: '',
      points: ordered.map(pointOf).filter((p): p is Point => p !== null),
      buckets:
        latest.histogram && latest.histogram.buckets.length > 0
          ? histogramBars(latest.histogram)
          : null,
      latest,
    });
  }

  return addDistinguishers(series).sort((a, b) => a.key.localeCompare(b.key));
}

// Fills in `distinguisher` for series that share a name, using only the things
// that actually differ between them: attribute values first, then the service
// and source when those are what split the series. Anything every sibling
// agrees on separates nothing and is left out.
function addDistinguishers(series: MetricSeries[]): MetricSeries[] {
  const byName = new Map<string, MetricSeries[]>();
  for (const s of series) {
    const siblings = byName.get(s.name);
    if (siblings) siblings.push(s);
    else byName.set(s.name, [s]);
  }

  for (const siblings of byName.values()) {
    if (siblings.length < 2) continue;
    const keys = [
      ...new Set(siblings.flatMap((s) => Object.keys(s.attributes))),
    ].sort();
    const varying = keys.filter((key) => {
      const seen = new Set(siblings.map((s) => stableValue(s.attributes[key])));
      return seen.size > 1;
    });
    const services = new Set(siblings.map((s) => s.service_name));
    const sources = new Set(siblings.map((s) => s.source));

    for (const s of siblings) {
      s.distinguisher = [
        ...varying.map((key) => stableValue(s.attributes[key])),
        services.size > 1 ? s.service_name : '',
        sources.size > 1 ? s.source : '',
      ]
        .filter(Boolean)
        .join(' ');
    }
  }

  return series;
}

// The attribute set as one line, for telling sibling series of the same metric
// apart in a list. Empty when the series has no attributes.
export function seriesLabel(series: MetricSeries): string {
  const keys = Object.keys(series.attributes).sort();
  if (keys.length === 0) return '';
  return keys.map((k) => `${k}=${stableValue(series.attributes[k])}`).join(' ');
}

// A point's plottable value. Usually `value`, but a bucketless histogram (a
// Sentry distribution) carries its observation in the snapshot instead, where
// sum over count is that single measurement.
//
// This is the screen for non-finite values, and it has to be here rather than
// left to the chart: nothing between the wire and here rejects them. OTLP's
// `asDouble ?? Number(asInt ?? 0)` only skips null, so a NaN gauge (the
// `hits / total` bug with no hits) or an Infinity arrives intact, and a chart
// cannot plot a point that has no position.
function pointOf(metric: Metric): Point | null {
  const value = plottable(metric);
  if (value === null || !Number.isFinite(value)) return null;
  return { t: metric.timestamp, v: value };
}

function plottable(metric: Metric): number | null {
  if (metric.value !== null) return metric.value;
  const histogram = metric.histogram;
  if (histogram && histogram.buckets.length === 0 && histogram.count > 0) {
    return histogram.sum / histogram.count;
  }
  return null;
}

export function seriesStats(series: MetricSeries): SeriesStats {
  const values = series.points.map((p) => p.v);
  if (values.length === 0) {
    return { last: null, min: 0, max: 0, avg: 0, count: 0 };
  }
  const sum = values.reduce((total, v) => total + v, 0);
  return {
    last: values[values.length - 1]!,
    min: Math.min(...values),
    max: Math.max(...values),
    avg: sum / values.length,
    count: values.length,
  };
}

/**
 * Histogram buckets as chart bars. OTLP counts are per-bucket and each bound is
 * that bucket's upper edge, with a final unbounded overflow bucket, so the
 * labels are upper bounds and the last one is the overflow.
 */
export function histogramBars(histogram: HistogramData): Bar[] {
  return histogram.buckets.map((bucket) => ({
    label: Number.isFinite(bucket.bound) ? formatCompact(bucket.bound) : '+∞',
    // Counts come from `Number(bucketCounts[i] ?? 0)`, which yields NaN for a
    // non-numeric count. A bucket with no readable count has a height of none,
    // which is what an unobserved bucket looks like anyway.
    value: Number.isFinite(bucket.count) ? bucket.count : 0,
  }));
}

// What to show as the series' current reading. A bucketed histogram has no
// single value, so it reports the mean of its latest snapshot: that is the one
// number in the metric's own unit, where the observation count is not (a `ms`
// histogram counting 360 observations has not observed 360ms of anything).
export function currentValue(series: MetricSeries): number | null {
  if (series.buckets) {
    const histogram = series.latest.histogram!;
    const mean = histogram.count === 0 ? null : histogram.sum / histogram.count;
    return mean !== null && Number.isFinite(mean) ? mean : null;
  }
  if (series.type === 'set' && series.latest.value === null) {
    return series.latest.set_values?.length ?? null;
  }
  // Already screened for finiteness on the way into `points`.
  return series.points.at(-1)?.v ?? null;
}
