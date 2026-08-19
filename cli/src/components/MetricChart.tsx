import { buildBarChart, buildLineChart, type Chart } from '../chart';
import {
  currentValue,
  histogramBars,
  seriesLabel,
  type MetricSeries,
} from '../metrics';
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

export function MetricChart({ series, width, height, focused }: Props) {
  const inner = width - 4; // border + padding
  const rows = Math.max(0, height - CHROME_ROWS);
  const unit = unitLabel(series.unit);
  const value = currentValue(series);
  const attrs = seriesLabel(series);

  // A histogram's chart is its latest bucket snapshot, not a line: the point
  // stream carries no single value to plot. Everything else is a time series.
  const histogram =
    series.type === 'histogram' ? series.latest.histogram : null;
  const chart: Chart | null =
    rows === 0
      ? null
      : histogram
        ? buildBarChart({
            bars: histogramBars(histogram),
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
    histogram
      ? `${histogram.count} obs`
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
      {/* Meta line, with the current reading held on the right. Composed as one
          truncated string so it never wraps into the plot's rows. */}
      <box style={{ flexDirection: 'row' }}>
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
                <text fg={UI.dim}>{chart.axis.y[i]}</text>
                {/* A labelled row gets a tick, the rest just the axis line. */}
                <text fg={UI.border}>
                  {chart.axis.y[i]?.trim() ? '┤' : '│'}
                </text>
                <text fg={CHART_LINE}>{row}</text>
              </box>
            ))}
          </box>
          <box style={{ flexDirection: 'row' }}>
            <text fg={UI.border}>
              {`${' '.repeat(chart.axis.yWidth)}└${'─'.repeat(chart.plotWidth)}`}
            </text>
          </box>
          <box style={{ flexDirection: 'row' }}>
            <text fg={UI.dim}>
              {`${' '.repeat(chart.axis.yWidth + 1)}${chart.axis.x}`}
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
          <text fg={UI.dim}>
            {series.points.length === 0 && !histogram
              ? 'No values recorded for this series yet.'
              : 'Not enough room to plot. Widen the terminal.'}
          </text>
        </box>
      )}
    </box>
  );
}
