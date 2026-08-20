import { buildBarChart, buildLineChart, type Chart } from '../chart';
import { currentValue, seriesLabel, type MetricSeries } from '../metrics';
import { UI, BOLD, CHART_LINE, metricTypeColor } from '../theme';
import { formatCompact, formatLogTime, truncate, unitLabel } from '../format';

interface Props {
  series: MetricSeries;
  width: number;
  height: number; // rows available for this panel (incl. border)
  focused: boolean;
}

// Border (2) + meta line (1) + spacer (1) + axis rule (1) + x labels (1).
const CHROME_ROWS = 6;

// Why there is no chart. The builders drop the scale before they give up, so
// reaching the size case means the panel is genuinely too small, and the other
// two are about the data rather than the terminal.
function emptyReason(series: MetricSeries, rows: number): string {
  if (series.buckets) {
    return series.buckets.every((bucket) => bucket.value <= 0)
      ? 'No observations recorded in any bucket yet.'
      : 'Not enough room to plot. Widen the terminal.';
  }
  if (series.points.length === 0) {
    return 'No values recorded for this series yet.';
  }
  return rows === 0
    ? 'Not enough room to plot. Make the terminal taller.'
    : 'Not enough room to plot. Widen the terminal.';
}

export function MetricChart({ series, width, height, focused }: Props) {
  const inner = width - 4; // border + padding
  const rows = Math.max(0, height - CHROME_ROWS);
  const unit = unitLabel(series.unit);
  const value = currentValue(series);
  const attrs = seriesLabel(series);

  // A bucketed histogram charts its latest snapshot, since the shape being read
  // is the distribution. A bucketless one (a Sentry distribution) is a stream of
  // individual observations, so it charts over time like anything else.
  const chart: Chart | null =
    rows === 0
      ? null
      : series.buckets
        ? buildBarChart({
            bars: series.buckets,
            width: inner,
            rows,
            formatValue: formatCompact,
          })
        : buildLineChart({
            points: series.points,
            width: inner,
            rows,
            formatValue: formatCompact,
            formatTime: (t) => formatLogTime(t).slice(0, 8), // HH:MM:SS
          });

  const reading =
    value === null ? '-' : `${formatCompact(value)}${unit ? ` ${unit}` : ''}`;

  // Everything after the type, which is drawn separately in its own color.
  const meta = [
    series.service_name,
    series.buckets
      ? `${series.latest.histogram?.count ?? 0} obs`
      : `${series.points.length} point${series.points.length === 1 ? '' : 's'}`,
    attrs,
  ]
    .filter(Boolean)
    .map((part) => `  ·  ${part}`)
    .join('');

  return (
    <box
      style={{
        flexDirection: 'column',
        flexGrow: 1,
        border: true,
        borderColor: focused ? UI.borderActive : UI.border,
        backgroundColor: UI.bg,
        paddingLeft: 1,
        paddingRight: 1,
      }}
      title={` ${truncate(series.name, Math.max(4, inner - 2))} `}
    >
      {/* Meta line, with the current reading held on the right. Pinned to one
          row: the plot's height is computed from CHROME_ROWS, so a meta line
          that wrapped would push the last plot row out of the panel. */}
      <box
        style={{
          flexDirection: 'row',
          height: 1,
          flexShrink: 0,
          overflow: 'hidden',
        }}
      >
        <text fg={metricTypeColor(series.type)} attributes={BOLD}>
          {truncate(series.type, inner)}
        </text>
        <text fg={UI.dim}>
          {truncate(
            meta,
            Math.max(0, inner - series.type.length - reading.length - 1),
          )}
        </text>
        <box style={{ flexGrow: 1 }} />
        <text fg={UI.textStrong} attributes={BOLD}>
          {reading}
        </text>
      </box>

      {chart ? (
        <>
          <box style={{ marginTop: 1, flexDirection: 'column' }}>
            {chart.plot.map((row, i) => (
              <box key={i} style={{ flexDirection: 'row' }}>
                {/* No gutter when the panel was too narrow to carry a scale:
                    the plot took those columns instead. */}
                {chart.axis.gutter ? (
                  <>
                    <text fg={UI.dim}>{chart.axis.y[i]}</text>
                    {/* A labelled row gets a tick, the rest the axis line. */}
                    <text fg={UI.border}>
                      {chart.axis.y[i]?.trim() ? '┤' : '│'}
                    </text>
                  </>
                ) : null}
                <text fg={CHART_LINE}>{row}</text>
              </box>
            ))}
          </box>
          <box style={{ flexDirection: 'row' }}>
            <text fg={UI.border}>
              {chart.axis.gutter
                ? `${' '.repeat(chart.axis.yWidth)}└${'─'.repeat(chart.plotWidth)}`
                : '─'.repeat(chart.plotWidth)}
            </text>
          </box>
          <box style={{ flexDirection: 'row' }}>
            <text fg={UI.dim}>
              {`${' '.repeat(chart.axis.gutter ? chart.axis.yWidth + 1 : 0)}${chart.axis.x}`}
            </text>
          </box>
        </>
      ) : (
        <box
          style={{
            flexGrow: 1,
            justifyContent: 'center',
            alignItems: 'center',
          }}
        >
          <text fg={UI.dim}>{emptyReason(series, rows)}</text>
        </box>
      )}
    </box>
  );
}
