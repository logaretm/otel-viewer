import { useEffect, useMemo, useRef, useState } from 'react';
import {
  useKeyboard,
  useRenderer,
  useTerminalDimensions,
} from '@opentui/react';
import type { ScrollBoxRenderable } from '@opentui/core';
import { Header } from './Header';
import { TraceList } from './TraceList';
import { Waterfall } from './Waterfall';
import { SpanDetail } from './SpanDetail';
import { LogList } from './LogList';
import { LogDetail } from './LogDetail';
import { MetricList } from './MetricList';
import { MetricChart } from './MetricChart';
import { MetricDetail } from './MetricDetail';
import { EmptyState } from './EmptyState';
import { StatusBar } from './StatusBar';
import { UI } from '../theme';
import { buildSpanTree } from '../span-tree';
import { nativeCopy } from '../clipboard';
import { groupSeries } from '../metrics';
import type { TraceEntry, Log, Metric } from '../types';
import type { RelayStatus } from '../relay';
import type { Endpoints } from '../session';

interface Props {
  endpoints: Endpoints;
  status: RelayStatus;
  error?: string | null;
  viewers: number;
  traces: TraceEntry[];
  logs: Log[];
  metrics: Metric[];
  onClear: () => void;
  onQuit: () => void;
}

export type View = 'traces' | 'logs' | 'metrics';
type Focus = 'list' | 'detail' | 'links';

// Left/right walk this order, wrapping at both ends.
const VIEWS: View[] = ['traces', 'logs', 'metrics'];

const COPIED_MS = 1600;
// Header occupies 5 rows (border + 3 content lines); StatusBar occupies 1.
const HEADER_H = 5;
const STATUS_H = 1;
// Rows moved per PageUp/PageDown press in a focused detail panel.
const SCROLL_STEP = 4;

export function Dashboard({
  endpoints,
  status,
  error,
  viewers,
  traces,
  logs,
  metrics,
  onClear,
  onQuit,
}: Props) {
  const { width, height } = useTerminalDimensions();
  const renderer = useRenderer();
  const [view, setView] = useState<View>('traces');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSpanId, setSelectedSpanId] = useState<string | null>(null);
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null);
  const [selectedSeriesKey, setSelectedSeriesKey] = useState<string | null>(
    null,
  );
  const [focus, setFocus] = useState<Focus>('list');
  const [selectedLink, setSelectedLink] = useState(0); // 0 = DSN, 1 = OTLP
  const [copiedLink, setCopiedLink] = useState<number | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Points at whichever detail panel (span or log) is currently mounted, so the
  // keyboard handler can scroll it without each panel owning key input.
  const detailScrollRef = useRef<ScrollBoxRenderable | null>(null);
  // The mounted detail panel reports whether its content overflows, so we only
  // advertise (and act on) scrolling when there's something hidden.
  const [detailScrollable, setDetailScrollable] = useState(false);

  // Keep the selection stable across live updates; default to the newest item.
  const selectedIndex = Math.max(
    0,
    traces.findIndex((t) => t.trace.trace_id === selectedId),
  );
  const current = traces[selectedIndex];

  // Spans in waterfall display order, for selecting/inspecting within the trace.
  const spanNodes = current ? buildSpanTree(current.spans, current.trace) : [];
  const selectedSpanIndex = Math.max(
    0,
    spanNodes.findIndex((n) => n.span.span_id === selectedSpanId),
  );
  const currentSpan = spanNodes[selectedSpanIndex]?.span;

  const selectedLogIndex = Math.max(
    0,
    logs.findIndex((l) => l.log_id === selectedLogId),
  );
  const currentLog = logs[selectedLogIndex];

  // Points arrive one at a time and are grouped into series only for display.
  // Memoized on the raw points, so walking the list with the keyboard doesn't
  // regroup a thousand of them on every press.
  const series = useMemo(() => groupSeries(metrics), [metrics]);
  const selectedSeriesIndex = Math.max(
    0,
    series.findIndex((s) => s.key === selectedSeriesKey),
  );
  const currentSeries = series[selectedSeriesIndex];

  useEffect(() => {
    if (traces.length === 0) return;
    const stillThere = traces.some((t) => t.trace.trace_id === selectedId);
    if (!stillThere) setSelectedId(traces[0]!.trace.trace_id);
  }, [traces, selectedId]);

  useEffect(() => {
    if (logs.length === 0) return;
    const stillThere = logs.some((l) => l.log_id === selectedLogId);
    if (!stillThere) setSelectedLogId(logs[0]!.log_id);
  }, [logs, selectedLogId]);

  // A series disappears when its last point ages out of the store, so fall back
  // to the first rather than leaving the chart pointed at nothing.
  useEffect(() => {
    if (series.length === 0) return;
    const stillThere = series.some((s) => s.key === selectedSeriesKey);
    if (!stillThere) setSelectedSeriesKey(series[0]!.key);
  }, [series, selectedSeriesKey]);

  // When the selected span leaves the current trace (trace switched, spans
  // arrived), snap back to the root span so the detail panel stays valid.
  useEffect(() => {
    if (spanNodes.length === 0) return;
    const stillThere = spanNodes.some((n) => n.span.span_id === selectedSpanId);
    if (!stillThere) setSelectedSpanId(spanNodes[0]!.span.span_id);
  }, [spanNodes, selectedSpanId]);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const copyLink = (idx: number) => {
    const text = idx === 0 ? endpoints.dsn : endpoints.otlp;
    try {
      renderer.copyToClipboardOSC52(text); // works over SSH / modern terminals
    } catch {
      // ignore
    }
    nativeCopy(text); // covers terminals without OSC52 (e.g. Terminal.app)
    setCopiedLink(idx);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopiedLink(null), COPIED_MS);
  };

  useKeyboard((key) => {
    if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
      onQuit();
      return;
    }
    if (key.name === 'tab') {
      setFocus((f) =>
        f === 'list' ? 'detail' : f === 'detail' ? 'links' : 'list',
      );
      return;
    }
    if (key.name === 'left' || key.name === 'right') {
      const step = key.name === 'right' ? 1 : VIEWS.length - 1;
      setView((v) => VIEWS[(VIEWS.indexOf(v) + step) % VIEWS.length]!);
      setFocus((f) => (f === 'links' ? f : 'list'));
      return;
    }

    // Scroll the focused detail panel; up/down stay bound to item navigation.
    if (
      focus === 'detail' &&
      detailScrollable &&
      (key.name === 'pageup' || key.name === 'pagedown')
    ) {
      detailScrollRef.current?.scrollBy({
        x: 0,
        y: key.name === 'pagedown' ? SCROLL_STEP : -SCROLL_STEP,
      });
      return;
    }

    if (focus === 'links') {
      if (key.name === 'up' || key.name === 'k') setSelectedLink(0);
      if (key.name === 'down' || key.name === 'j') setSelectedLink(1);
      if (key.name === 'return' || key.name === 'enter' || key.name === 'y') {
        copyLink(selectedLink);
      }
      return;
    }

    if (key.name === 'c') {
      onClear();
      return;
    }

    const up = key.name === 'up' || key.name === 'k';
    const down = key.name === 'down' || key.name === 'j';

    if (view === 'logs') {
      if (logs.length === 0) return;
      if (up) setSelectedLogId(logs[Math.max(0, selectedLogIndex - 1)]!.log_id);
      if (down)
        setSelectedLogId(
          logs[Math.min(logs.length - 1, selectedLogIndex + 1)]!.log_id,
        );
      return;
    }

    // Unlike the waterfall, a chart has nothing to walk within a series, so
    // up/down keep moving between series whichever panel holds focus and the
    // chart and stats follow along.
    if (view === 'metrics') {
      if (series.length === 0) return;
      if (up)
        setSelectedSeriesKey(series[Math.max(0, selectedSeriesIndex - 1)]!.key);
      if (down)
        setSelectedSeriesKey(
          series[Math.min(series.length - 1, selectedSeriesIndex + 1)]!.key,
        );
      return;
    }

    if (traces.length === 0) return;

    // With the waterfall focused, up/down walk the spans of the current trace;
    // otherwise they move between traces in the list.
    if (focus === 'detail') {
      if (spanNodes.length === 0) return;
      if (up)
        setSelectedSpanId(
          spanNodes[Math.max(0, selectedSpanIndex - 1)]!.span.span_id,
        );
      if (down)
        setSelectedSpanId(
          spanNodes[Math.min(spanNodes.length - 1, selectedSpanIndex + 1)]!.span
            .span_id,
        );
      return;
    }

    if (up)
      setSelectedId(traces[Math.max(0, selectedIndex - 1)]!.trace.trace_id);
    if (down)
      setSelectedId(
        traces[Math.min(traces.length - 1, selectedIndex + 1)]!.trace.trace_id,
      );
  });

  const bodyHeight = Math.max(1, height - HEADER_H - STATUS_H);
  const traceListWidth = Math.max(24, Math.min(38, Math.floor(width * 0.3)));
  const logListWidth = Math.max(
    40,
    Math.min(width - 30, Math.floor(width * 0.58)),
  );

  // The span attribute panel only appears while the waterfall is focused; the
  // trace list collapses to give the waterfall + panel the full width.
  const showSpanDetail =
    view === 'traces' && focus === 'detail' && !!currentSpan;
  const spanDetailWidth = Math.max(30, Math.min(46, Math.floor(width * 0.34)));
  const waterfallWidth = showSpanDetail
    ? width - spanDetailWidth
    : width - traceListWidth;

  // Same trade as the waterfall: the series list steps aside while the detail
  // panel is up, since a chart reads better wide than a name column does.
  const showMetricDetail =
    view === 'metrics' && focus === 'detail' && !!currentSeries;
  // Wider than the trace list: metric names are dotted paths, and the
  // attributes that separate sibling series share the same row.
  const seriesListWidth = Math.max(28, Math.min(48, Math.floor(width * 0.36)));
  const metricDetailWidth = Math.max(
    30,
    Math.min(46, Math.floor(width * 0.34)),
  );
  const chartWidth = showMetricDetail
    ? width - metricDetailWidth
    : width - seriesListWidth;

  let body;
  if (view === 'logs') {
    body =
      logs.length === 0 || !currentLog ? (
        <EmptyState status={status} error={error} what="logs" />
      ) : (
        <>
          <LogList
            logs={logs}
            selected={selectedLogIndex}
            width={logListWidth}
            height={bodyHeight}
            focused={focus === 'list'}
          />
          <LogDetail
            log={currentLog}
            width={width - logListWidth}
            height={bodyHeight}
            focused={focus === 'detail'}
            scrollRef={detailScrollRef}
            onScrollable={setDetailScrollable}
          />
        </>
      );
  } else if (view === 'metrics') {
    body =
      series.length === 0 || !currentSeries ? (
        <EmptyState status={status} error={error} what="metrics" />
      ) : (
        <>
          {showMetricDetail ? null : (
            <MetricList
              series={series}
              selected={selectedSeriesIndex}
              width={seriesListWidth}
              height={bodyHeight}
              focused={focus === 'list'}
            />
          )}
          <MetricChart
            series={currentSeries}
            width={chartWidth}
            height={bodyHeight}
            focused={focus === 'detail'}
          />
          {showMetricDetail ? (
            <MetricDetail
              series={currentSeries}
              width={metricDetailWidth}
              height={bodyHeight}
              focused={focus === 'detail'}
              scrollRef={detailScrollRef}
              onScrollable={setDetailScrollable}
            />
          ) : null}
        </>
      );
  } else {
    body =
      traces.length === 0 || !current ? (
        <EmptyState status={status} error={error} what="traces" />
      ) : (
        <>
          {showSpanDetail ? null : (
            <TraceList
              traces={traces}
              selected={selectedIndex}
              width={traceListWidth}
              focused={focus === 'list'}
            />
          )}
          <Waterfall
            trace={current}
            width={waterfallWidth}
            height={bodyHeight}
            focused={focus === 'detail'}
            selectedSpanId={selectedSpanId}
          />
          {showSpanDetail && currentSpan ? (
            <SpanDetail
              span={currentSpan}
              width={spanDetailWidth}
              height={bodyHeight}
              focused={focus === 'detail'}
              scrollRef={detailScrollRef}
              onScrollable={setDetailScrollable}
            />
          ) : null}
        </>
      );
  }

  return (
    <box
      style={{ flexDirection: 'column', width, height, backgroundColor: UI.bg }}
    >
      <Header
        dsn={endpoints.dsn}
        otlp={endpoints.otlp}
        viewers={viewers}
        status={status}
        focused={focus === 'links'}
        selectedLink={selectedLink}
        copiedLink={copiedLink}
        view={view}
        traceCount={traces.length}
        logCount={logs.length}
        metricCount={series.length}
      />

      <box style={{ flexDirection: 'row', flexGrow: 1 }}>{body}</box>

      <StatusBar
        focus={focus}
        canScroll={focus === 'detail' && detailScrollable}
      />
    </box>
  );
}
