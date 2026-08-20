// Reuse the canonical domain + relay message types from the shared parsers.
// Do NOT redefine Trace/Span/etc. here — keep one source of truth.

export type {
  Trace,
  Span,
  Log,
  Metric,
  MetricType,
  HistogramData,
  TraceSource,
  WebSocketMessage,
} from '../../shared/parsers/types';

import type { Trace, Span } from '../../shared/parsers/types';

// CLI-specific composite: a trace plus its accumulated spans (the render unit).
export interface TraceEntry {
  trace: Trace;
  spans: Span[];
}

/** @deprecated use TraceEntry */
export type MockTrace = TraceEntry;
