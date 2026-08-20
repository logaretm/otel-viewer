// Where a room's telemetry comes from.
//
// The relay client is one source: a WebSocket to a room on the deployed relay.
// Anything that can push traces, logs, and metrics at the same callbacks
// qualifies, which is what lets a room be served from somewhere other than the
// relay without the stores, the MCP tools, or the TUI knowing the difference.

import { createRelay, type RelayStatus } from './relay';
import type { Log, Metric, Span, Trace } from './types';

// 'connecting' | 'connected' | 'disconnected' | 'rejected'. A source with no
// connection to lose (a local server) reports 'connected' once it is listening.
export type SourceStatus = RelayStatus;

export interface SourceEvents {
  onStatus?: (status: SourceStatus) => void;
  // Terminal failure: the source can never deliver, so callers stop waiting.
  onFail?: (reason: string) => void;
  onTrace?: (trace: Trace, spans: Span[]) => void;
  onLog?: (log: Log) => void;
  onMetric?: (metric: Metric) => void;
  onViewerCount?: (count: number) => void;
  onClear?: () => void;
}

export interface SourceHandle {
  close: () => void;
}

export type TelemetrySource = (events: SourceEvents) => SourceHandle;

// The deployed relay: one WebSocket to the room, reconnecting on its own.
export function relaySource(wsUrl: string): TelemetrySource {
  return (events) =>
    createRelay(wsUrl, {
      onStatus: events.onStatus,
      onReject: events.onFail,
      onTrace: events.onTrace,
      onLog: events.onLog,
      onMetric: events.onMetric,
      onViewerCount: events.onViewerCount,
      onClear: events.onClear,
    });
}
