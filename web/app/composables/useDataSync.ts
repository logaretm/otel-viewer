// Composable for syncing incoming telemetry data to IndexedDB
// This should be called once at the app level to ensure data is always captured

import * as Sentry from '@sentry/browser';
import type {
  Trace,
  Span,
  Log,
  Metric,
  WebSocketMessage,
} from '../../../shared/parsers/types';
import { summarizeTrace } from '../../../shared/parsers/trace-summary';
import {
  upsertTrace,
  upsertSpans,
  upsertLog,
  upsertMetric,
  getTrace,
  getSpansByTraceId,
} from '../database/operations';

// Event bus for notifying components of new data
const traceListeners = new Set<(trace: Trace, spans: Span[]) => void>();
const logListeners = new Set<(log: Log) => void>();
const metricListeners = new Set<(metric: Metric) => void>();
const viewerCountListeners = new Set<(count: number) => void>();

// Per-type sets of known service names (accumulated as data arrives)
const traceServiceNames = new Set<string>();
const logServiceNames = new Set<string>();
const metricServiceNames = new Set<string>();
const serviceNamesListeners = new Set<() => void>();

function notifyListeners() {
  for (const listener of serviceNamesListeners) {
    listener();
  }
}

function addTraceServiceName(name: string) {
  if (name && !traceServiceNames.has(name)) {
    traceServiceNames.add(name);
    notifyListeners();
  }
}

function addLogServiceName(name: string) {
  if (name && !logServiceNames.has(name)) {
    logServiceNames.add(name);
    notifyListeners();
  }
}

function addMetricServiceName(name: string) {
  if (name && !metricServiceNames.has(name)) {
    metricServiceNames.add(name);
    notifyListeners();
  }
}

export function clearServiceNames(type?: 'traces' | 'logs' | 'metrics') {
  if (!type || type === 'traces') traceServiceNames.clear();
  if (!type || type === 'logs') logServiceNames.clear();
  if (!type || type === 'metrics') metricServiceNames.clear();
  notifyListeners();
}

export function addServiceNames(
  names: string[],
  type: 'traces' | 'logs' | 'metrics',
) {
  let changed = false;
  const set =
    type === 'traces'
      ? traceServiceNames
      : type === 'logs'
        ? logServiceNames
        : metricServiceNames;
  for (const name of names) {
    if (name && !set.has(name)) {
      set.add(name);
      changed = true;
    }
  }
  if (changed) {
    notifyListeners();
  }
}

export function getServiceNames(
  type?: 'traces' | 'logs' | 'metrics',
): Set<string> {
  if (type === 'traces') return traceServiceNames;
  if (type === 'logs') return logServiceNames;
  if (type === 'metrics') return metricServiceNames;
  return new Set([
    ...traceServiceNames,
    ...logServiceNames,
    ...metricServiceNames,
  ]);
}

export function onServiceNamesChange(callback: () => void): () => void {
  serviceNamesListeners.add(callback);
  return () => serviceNamesListeners.delete(callback);
}

export function useDataSync() {
  const { onData } = useRelay();

  const initialize = () => {
    // Register for all incoming data from relay
    onData(handleMessage);
  };

  const handleMessage = async (message: WebSocketMessage) => {
    console.log('[DataSync] handleMessage:', message.type, message);

    try {
      await routeMessage(message);
    } catch (err) {
      // Every IndexedDB write happens under here and nothing awaits this
      // handler, so a rejection is invisible: the telemetry arrived, was never
      // stored, and the dashboard looks the same as if it was never sent.
      console.error('[DataSync] Failed to persist update:', err);
      Sentry.logger.error('Dropped an inbound telemetry update', {
        message_type: message.type,
        error: err instanceof Error ? err.message : String(err),
      });
      Sentry.captureException(err, { tags: { area: 'data-sync' } });
    }
  };

  const routeMessage = async (message: WebSocketMessage) => {
    switch (message.type) {
      case 'trace_update':
        if (message.data) {
          await handleTraceUpdate(message.data.trace, message.data.spans);
        }
        break;

      case 'log_update':
        if (message.data) {
          await handleLogUpdate(message.data.log);
        }
        break;

      case 'metric_update':
        if (message.data) {
          await handleMetricUpdate(message.data.metric);
        }
        break;

      case 'viewer_count':
        for (const listener of viewerCountListeners) {
          try {
            listener(message.count);
          } catch (err) {
            console.error('[DataSync] Error in viewer count listener:', err);
          }
        }
        break;

      case 'clear_data':
        console.log('[DataSync] Clear data received');
        break;

      default:
        console.log('[DataSync] Unknown message type:', message.type);
    }
  };

  const handleTraceUpdate = async (trace: Trace, spans: Span[]) => {
    console.log('[DataSync] Received trace:', trace.trace_id);

    // Track service name
    addTraceServiceName(trace.service_name);

    // Preserve user-set custom name across incoming updates
    const existing = await getTrace(trace.trace_id);
    if (existing?.custom_name && !trace.custom_name) {
      trace.custom_name = existing.custom_name;
    }

    // Save spans first, then recompute trace summary from everything seen so
    // far. Streamed (Sentry v2) spans arrive across many messages, so the trace
    // record must be derived from all accumulated spans, not just this batch.
    await upsertSpans(spans);
    const allSpans = await getSpansByTraceId(trace.trace_id);
    const summary = summarizeTrace(trace, allSpans);
    await upsertTrace(summary);

    // Notify listeners
    for (const listener of traceListeners) {
      try {
        listener(summary, spans);
      } catch (err) {
        console.error('[DataSync] Error in trace listener:', err);
      }
    }
  };

  const handleMetricUpdate = async (metric: Metric) => {
    console.log('[DataSync] Received metric:', metric.metric_id);

    addMetricServiceName(metric.service_name);

    await upsertMetric(metric);

    for (const listener of metricListeners) {
      try {
        listener(metric);
      } catch (err) {
        console.error('[DataSync] Error in metric listener:', err);
      }
    }
  };

  const handleLogUpdate = async (log: Log) => {
    console.log('[DataSync] Received log:', log.log_id);

    // Track service name
    addLogServiceName(log.service_name);

    // Save to IndexedDB
    await upsertLog(log);

    // Notify listeners
    for (const listener of logListeners) {
      try {
        listener(log);
      } catch (err) {
        console.error('[DataSync] Error in log listener:', err);
      }
    }
  };

  return {
    initialize,
  };
}

// Subscribe to trace updates (for real-time UI updates)
export function onTraceUpdate(
  callback: (trace: Trace, spans: Span[]) => void,
): () => void {
  traceListeners.add(callback);
  return () => traceListeners.delete(callback);
}

// Subscribe to log updates (for real-time UI updates)
export function onLogUpdate(callback: (log: Log) => void): () => void {
  logListeners.add(callback);
  return () => logListeners.delete(callback);
}

// Subscribe to metric updates (for real-time UI updates)
export function onMetricUpdate(callback: (metric: Metric) => void): () => void {
  metricListeners.add(callback);
  return () => metricListeners.delete(callback);
}

// Subscribe to viewer count updates
export function onViewerCount(callback: (count: number) => void): () => void {
  viewerCountListeners.add(callback);
  return () => viewerCountListeners.delete(callback);
}
