// WebSocket relay client + trace store + React hook.
// Mirrors the browser SharedWorker (app/workers/relay-worker.ts): one WebSocket
// to the room, heartbeat ping/pong, auto-reconnect with exponential backoff.

import { useEffect, useRef, useState } from 'react';
import type {
  Trace,
  Span,
  Log,
  Metric,
  TraceEntry,
  WebSocketMessage,
} from './types';
import type { TelemetrySource } from './source';
import { count, logger, METRIC } from './observability';
import { summarizeTrace } from '../../shared/parsers/trace-summary';

// 'rejected' is terminal: the relay refused the handshake (room already claimed
// or token mismatch) and we stop retrying.
export type RelayStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'rejected';

const HEARTBEAT_MS = 30_000;
// Exponential backoff for reconnects: base doubles each attempt up to a cap,
// with jitter to avoid a thundering herd against a recovering relay.
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const MAX_TRACES = 200;
const MAX_LOGS = 500;
// Points, not series: a chart wants history, and one busy series is worth more
// rows than one trace is. Matches the web app's own metric cap.
const MAX_METRICS = 1000;

// Bun reports a non-101 handshake response (e.g. the relay's 401/400) as a
// close with code 1002, distinct from an established socket dropping (1006).
const HANDSHAKE_REJECTED_CODE = 1002;

interface RelayEvents {
  onStatus?: (status: RelayStatus) => void;
  onReject?: (reason: string) => void;
  onTrace?: (trace: Trace, spans: Span[]) => void;
  onLog?: (log: Log) => void;
  onMetric?: (metric: Metric) => void;
  onViewerCount?: (count: number) => void;
  onClear?: () => void;
}

export function createRelay(wsUrl: string, events: RelayEvents) {
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let reconnectAttempts = 0;
  // Whether the current attempt's socket reached OPEN; reset at the start of
  // each connect(). Lets onclose tell a handshake rejection (never opened this
  // attempt) apart from an established connection dropping.
  let opened = false;
  // True while a ping is outstanding. If the next heartbeat tick fires before a
  // pong clears it, the socket is half-open (dead) and we force a reconnect.
  let awaitingPong = false;

  const stopHeartbeat = () => {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer) return;
    const backoff = Math.min(
      RECONNECT_BASE_MS * 2 ** reconnectAttempts,
      RECONNECT_MAX_MS,
    );
    // Full jitter: a random point in [0, backoff].
    const delay = Math.random() * backoff;
    // Bucketed: the interesting question is "did this settle or is it looping",
    // and an unbounded attempt number would make one series per retry.
    count(METRIC.RELAY_RECONNECT, {
      attempt: reconnectAttempts < 3 ? String(reconnectAttempts) : 'many',
    });
    reconnectAttempts++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  function connect() {
    // Reset per-attempt so a rejection on a later reconnect (never opened this
    // attempt) is still recognized, even after an earlier connection succeeded.
    opened = false;
    events.onStatus?.('connecting');
    try {
      ws = new WebSocket(wsUrl);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      opened = true;
      reconnectAttempts = 0;
      awaitingPong = false;
      count(METRIC.RELAY_CONNECTED);
      events.onStatus?.('connected');
      heartbeat = setInterval(() => {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        if (awaitingPong) {
          // No pong since the last ping: the socket is half-open. Close it so
          // onclose runs and schedules a reconnect.
          ws.close();
          return;
        }
        awaitingPong = true;
        ws.send('ping');
      }, HEARTBEAT_MS);
    };

    ws.onmessage = (e) => {
      const raw = typeof e.data === 'string' ? e.data : String(e.data);
      if (raw === 'pong') {
        awaitingPong = false;
        return;
      }

      let msg: WebSocketMessage;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'trace_update':
          events.onTrace?.(msg.data.trace, msg.data.spans);
          break;
        case 'log_update':
          events.onLog?.(msg.data.log);
          break;
        case 'metric_update':
          events.onMetric?.(msg.data.metric);
          break;
        case 'viewer_count':
          events.onViewerCount?.(msg.count);
          break;
        case 'clear_data':
        case 'cleared_data':
          events.onClear?.();
          break;
      }
    };

    ws.onclose = (e) => {
      stopHeartbeat();
      awaitingPong = false;
      if (closed) return;

      // Close codes are the client's half of the reconnect-gap picture: the
      // room only sees the socket disappear.
      count(METRIC.RELAY_CLOSED, { code: e.code, opened });

      // A close before the socket ever opened, with the non-101 handshake code,
      // means the relay refused us: the room is already claimed by another
      // token, or the token mismatches. Retrying can never succeed, so stop and
      // surface it instead of reconnecting forever.
      if (!opened && e.code === HANDSHAKE_REJECTED_CODE) {
        // Terminal, and invisible from the relay's side: the DO sees a socket
        // that never opened, the client knows it was refused.
        count(METRIC.RELAY_REJECTED);
        logger.warn('Relay refused the handshake', { code: e.code });
        events.onStatus?.('rejected');
        events.onReject?.(
          'Relay rejected the connection: room already claimed or token mismatch.',
        );
        return;
      }

      events.onStatus?.('disconnected');
      scheduleReconnect();
    };

    // onerror is followed by onclose, which handles reconnect.
    ws.onerror = () => {};
  }

  connect();

  return {
    close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stopHeartbeat();
      ws?.close();
    },
  };
}

// Holds at most `max` items in a Map keyed by id. On every insert the oldest
// item (by orderOf) is evicted once over the cap, so a long-running session
// stays bounded in memory instead of accumulating entries indefinitely.
abstract class BoundedStore<T> {
  protected items = new Map<string, T>();

  protected abstract readonly max: number;
  protected abstract idOf(item: T): string;
  protected abstract orderOf(item: T): number;

  // Hook for subclasses to drop side data (e.g. spans) tied to an evicted id.
  protected onEvict(_id: string): void {}

  protected store(item: T) {
    this.items.set(this.idOf(item), item);
    while (this.items.size > this.max) {
      let oldestId: string | null = null;
      let oldestOrder = Infinity;
      for (const it of this.items.values()) {
        const order = this.orderOf(it);
        if (order < oldestOrder) {
          oldestOrder = order;
          oldestId = this.idOf(it);
        }
      }
      if (oldestId === null) break;
      this.items.delete(oldestId);
      this.onEvict(oldestId);
    }
  }

  clear() {
    this.items.clear();
  }

  // Items newest-first by orderOf.
  protected sorted(): T[] {
    return [...this.items.values()].sort(
      (a, b) => this.orderOf(b) - this.orderOf(a),
    );
  }
}

// Accumulates traces and their spans, deduped by id. Spans for a trace may
// arrive across several messages, so merge additively.
export class TraceStore extends BoundedStore<Trace> {
  protected readonly max = MAX_TRACES;
  private spans = new Map<string, Map<string, Span>>();

  protected idOf(trace: Trace) {
    return trace.trace_id;
  }
  protected orderOf(trace: Trace) {
    return trace.start_time;
  }
  protected onEvict(id: string) {
    this.spans.delete(id);
  }

  // Returns the merged trace, so callers that render a single update (the
  // NDJSON stream) can emit the running summary rather than the partial one.
  upsert(trace: Trace, spans: Span[]): Trace {
    let bucket = this.spans.get(trace.trace_id);
    if (!bucket) {
      bucket = new Map();
      this.spans.set(trace.trace_id, bucket);
    }
    for (const span of spans) bucket.set(span.span_id, span);

    const existing = this.items.get(trace.trace_id);
    // Later messages win, but preserve a custom_name if a later update drops it.
    // Recompute timing/operation/status from all accumulated spans so streamed
    // (Sentry v2) spans arriving across messages build a stable trace summary.
    const merged = { ...existing, ...trace };
    const summary = summarizeTrace(merged, [...bucket.values()]);
    this.store(summary);
    return summary;
  }

  clear() {
    super.clear();
    this.spans.clear();
  }

  list(): TraceEntry[] {
    return this.sorted().map((trace) => ({
      trace,
      spans: [...(this.spans.get(trace.trace_id)?.values() ?? [])],
    }));
  }
}

// Accumulates logs, deduped by id, newest first, capped at MAX_LOGS.
export class LogStore extends BoundedStore<Log> {
  protected readonly max = MAX_LOGS;

  protected idOf(log: Log) {
    return log.log_id;
  }
  protected orderOf(log: Log) {
    return log.timestamp;
  }

  upsert(log: Log) {
    this.store(log);
  }

  list(): Log[] {
    return this.sorted();
  }
}

// Accumulates metric points, deduped by id, newest first. Points are grouped
// into series at render time (see metrics.ts) rather than here, so the store
// stays the same shape as the other two.
export class MetricStore extends BoundedStore<Metric> {
  protected readonly max = MAX_METRICS;

  protected idOf(metric: Metric) {
    return metric.metric_id;
  }
  protected orderOf(metric: Metric) {
    return metric.timestamp;
  }

  upsert(metric: Metric) {
    this.store(metric);
  }

  list(): Metric[] {
    return this.sorted();
  }
}

export interface LiveData {
  status: RelayStatus;
  error: string | null;
  viewers: number;
  traces: TraceEntry[];
  logs: Log[];
  metrics: Metric[];
  clear: () => void;
}

// `source` must be stable across renders (built once at startup): it is the
// effect's only dependency, so a new one on every render would reconnect.
export function useLiveData(source: TelemetrySource): LiveData {
  const [status, setStatus] = useState<RelayStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [viewers, setViewers] = useState(0);
  const [, bump] = useState(0);
  const traceStore = useRef<TraceStore>(new TraceStore());
  const logStore = useRef<LogStore>(new LogStore());
  const metricStore = useRef<MetricStore>(new MetricStore());

  useEffect(() => {
    setError(null);
    const rerender = () => bump((n) => n + 1);
    const handle = source({
      onStatus: setStatus,
      onFail: setError,
      onViewerCount: setViewers,
      onTrace: (trace, spans) => {
        traceStore.current.upsert(trace, spans);
        rerender();
      },
      onLog: (log) => {
        logStore.current.upsert(log);
        rerender();
      },
      onMetric: (metric) => {
        metricStore.current.upsert(metric);
        rerender();
      },
      onClear: () => {
        traceStore.current.clear();
        logStore.current.clear();
        metricStore.current.clear();
        rerender();
      },
    });
    return () => handle.close();
  }, [source]);

  return {
    status,
    error,
    viewers,
    traces: traceStore.current.list(),
    logs: logStore.current.list(),
    metrics: metricStore.current.list(),
    clear: () => {
      traceStore.current.clear();
      logStore.current.clear();
      metricStore.current.clear();
      bump((n) => n + 1);
    },
  };
}
