import type { MetricSeries } from '../metrics';
import { currentValue } from '../metrics';
import { UI, BOLD, metricTypeColor } from '../theme';
import { formatCompact, truncate, unitLabel } from '../format';

interface Props {
  series: MetricSeries[];
  selected: number;
  width: number;
  height: number; // rows available for this panel (incl. border)
  focused: boolean;
}

// Single-letter type badge: Counter, Gauge, Histogram, Set. The four types
// happen to start with four different letters.
function typeBadge(type: string): string {
  return type[0]!.toUpperCase();
}

export function MetricList({
  series,
  selected,
  width,
  height,
  focused,
}: Props) {
  const inner = width - 4; // borders + padding
  const visible = Math.max(1, height - 2);
  const start =
    selected < visible
      ? 0
      : Math.min(selected - visible + 1, Math.max(0, series.length - visible));
  const shown = series.slice(start, start + visible);

  const title =
    series.length > visible
      ? ` Metrics (${selected + 1}/${series.length}) `
      : ` Metrics (${series.length}) `;

  return (
    <box
      style={{
        flexDirection: 'column',
        width,
        border: true,
        borderColor: focused ? UI.borderActive : UI.border,
        backgroundColor: UI.bg,
        paddingLeft: 1,
        paddingRight: 1,
      }}
      title={title}
    >
      {shown.map((s, i) => {
        const idx = start + i;
        const isSel = idx === selected;
        const value = currentValue(s);
        const unit = unitLabel(s.unit);
        const reading =
          value === null
            ? '-'
            : `${formatCompact(value)}${unit ? ` ${unit}` : ''}`;
        // Two series of one metric differ only by attributes, so the part that
        // separates them is reserved first and the name yields to it.
        const room = Math.max(4, inner - reading.length - 5);
        const tag = truncate(s.distinguisher, Math.floor(room / 2));
        const name = truncate(s.name, room - (tag ? tag.length + 1 : 0));

        return (
          <box
            key={s.key}
            style={{
              flexDirection: 'row',
              backgroundColor: isSel ? UI.panel : undefined,
            }}
          >
            <text fg={isSel ? UI.accent : UI.dim}>{isSel ? '▸ ' : '  '}</text>
            <text fg={metricTypeColor(s.type)} attributes={BOLD}>
              {`${typeBadge(s.type)} `}
            </text>
            <text
              fg={isSel ? UI.textStrong : UI.text}
              attributes={isSel ? BOLD : 0}
            >
              {name}
            </text>
            {tag ? <text fg={UI.dim}>{` ${tag}`}</text> : null}
            <box style={{ flexGrow: 1 }} />
            <text fg={UI.dim}>{reading}</text>
          </box>
        );
      })}
    </box>
  );
}
