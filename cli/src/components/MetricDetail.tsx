import { useEffect } from 'react';
import type { RefObject } from 'react';
import type { ScrollBoxRenderable } from '@opentui/core';
import { seriesStats, type MetricSeries } from '../metrics';
import { UI, BOLD, metricTypeColor } from '../theme';
import { formatCompact, stringifyValue, truncate, unitLabel } from '../format';
import { useScrollOverflow } from './use-scroll-overflow';

interface Props {
  series: MetricSeries;
  width: number;
  height: number; // rows available for this panel (incl. border)
  focused: boolean;
  scrollRef: RefObject<ScrollBoxRenderable | null>;
  onScrollable: (scrollable: boolean) => void;
}

// The scrollbox below grows to fill the panel, and Yoga will shrink whatever
// sits above it to make that fit. Every fixed row opts out, so the attribute
// list is the only thing that gives.
const FIXED_ROW = { height: 1, flexShrink: 0 } as const;

function Label({ text }: { text: string }) {
  return (
    <box style={{ ...FIXED_ROW, marginTop: 1 }}>
      <text fg={UI.dim} attributes={BOLD}>
        {text}
      </text>
    </box>
  );
}

function Row({ name, value }: { name: string; value: string }) {
  return (
    <box style={{ ...FIXED_ROW, flexDirection: 'row' }}>
      <text fg={UI.dim}>{name}</text>
      <box style={{ flexGrow: 1 }} />
      <text fg={UI.text}>{value}</text>
    </box>
  );
}

export function MetricDetail({
  series,
  width,
  height,
  focused,
  scrollRef,
  onScrollable,
}: Props) {
  const inner = width - 4; // border + padding
  const stats = seriesStats(series);
  // Only a bucketed snapshot has a summary worth reporting on its own. A
  // bucketless one describes a single observation, so the series' own stats
  // over every observation say more.
  const histogram = series.buckets ? series.latest.histogram : null;
  const unit = unitLabel(series.unit);
  const suffix = unit ? ` ${unit}` : '';
  const attrs = Object.entries(series.attributes ?? {});

  // Snap back to the top when a different series is selected, so a scroll
  // position left over from the previous one doesn't hide its first rows.
  useEffect(() => {
    scrollRef.current?.scrollTo(0);
  }, [series.key, scrollRef]);

  useScrollOverflow(scrollRef, onScrollable);

  return (
    <box
      style={{
        flexDirection: 'column',
        width,
        height,
        border: true,
        borderColor: focused ? UI.borderActive : UI.border,
        backgroundColor: UI.bg,
        paddingLeft: 1,
        paddingRight: 1,
      }}
      title={` ${truncate(series.name, Math.max(4, inner - 2))} `}
    >
      <box style={{ ...FIXED_ROW, flexDirection: 'row' }}>
        <text fg={metricTypeColor(series.type)} attributes={BOLD}>
          {series.type}
        </text>
        <text fg={UI.dim}>{'  ·  '}</text>
        <text fg={UI.text}>{truncate(series.service_name, inner - 12)}</text>
        <box style={{ flexGrow: 1 }} />
        <text fg={UI.dim}>{series.source}</text>
      </box>

      {series.description ? (
        <box style={FIXED_ROW}>
          <text fg={UI.dim}>{truncate(series.description, inner)}</text>
        </box>
      ) : null}

      {/* Stats. A histogram's own summary is the authoritative one, so it is
          reported from the snapshot rather than recomputed from the points. */}
      <Label text="stats" />
      {histogram ? (
        <>
          <Row name="count" value={formatCompact(histogram.count)} />
          <Row name="sum" value={`${formatCompact(histogram.sum)}${suffix}`} />
          <Row name="min" value={`${formatCompact(histogram.min)}${suffix}`} />
          <Row name="max" value={`${formatCompact(histogram.max)}${suffix}`} />
          <Row
            name="mean"
            value={
              histogram.count > 0
                ? `${formatCompact(histogram.sum / histogram.count)}${suffix}`
                : '-'
            }
          />
        </>
      ) : (
        <>
          <Row
            name="last"
            value={
              stats.last === null
                ? '-'
                : `${formatCompact(stats.last)}${suffix}`
            }
          />
          <Row name="min" value={`${formatCompact(stats.min)}${suffix}`} />
          <Row name="max" value={`${formatCompact(stats.max)}${suffix}`} />
          <Row name="avg" value={`${formatCompact(stats.avg)}${suffix}`} />
          <Row name="points" value={String(stats.count)} />
        </>
      )}
      {series.unit ? <Row name="unit" value={series.unit} /> : null}

      {series.type === 'set' && series.latest.set_values?.length ? (
        <>
          <Label text="values" />
          <box style={FIXED_ROW}>
            <text fg={UI.text}>
              {truncate(series.latest.set_values.join(', '), inner)}
            </text>
          </box>
        </>
      ) : null}

      {/* Attributes: label stays pinned, the rows below scroll. The scrollbox
          stays mounted even when empty so its overflow measurement survives
          series switches without flashing. */}
      <Label text="attributes" />
      <scrollbox
        ref={scrollRef}
        focused={focused}
        style={{ flexGrow: 1, backgroundColor: UI.bg }}
        scrollbarOptions={{ visible: false }}
        contentOptions={{ flexDirection: 'column' }}
      >
        {attrs.length === 0 ? (
          <text fg={UI.dim}>none</text>
        ) : (
          attrs.map(([key, value]) => {
            const k = `${key}: `;
            return (
              <box key={key} style={{ flexDirection: 'row' }}>
                <text fg={UI.dim}>{k}</text>
                <text fg={UI.text}>
                  {truncate(
                    stringifyValue(value),
                    Math.max(4, inner - k.length - 1),
                  )}
                </text>
              </box>
            );
          })
        )}
      </scrollbox>
    </box>
  );
}
