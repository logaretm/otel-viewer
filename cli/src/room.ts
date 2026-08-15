// Headless room view: the relay client without a UI.
//
// The relay keeps no history (TelemetryRoom only broadcasts live), so whatever
// is not held here is gone. This owns the connection and the bounded stores,
// tracks when each trace was last touched, and can wait for a run to settle.
// Used by the MCP server; the TUI has its own React-flavored equivalent.
//
// Memory only, deliberately: nothing is written to disk. A restart therefore
// starts from an empty room, which is the trade for the CLI leaving nothing
// behind but the room credentials.

import { createRelay, TraceStore, LogStore, type RelayStatus } from './relay';
import type { Log, TraceEntry } from './types';

export interface WaitOptions {
  // Resolve once nothing new has arrived for this long.
  idleMs: number;
  // Give up waiting after this long, settled or not.
  timeoutMs: number;
  // Keep waiting until at least this many traces have arrived.
  minTraces: number;
}

export interface WaitResult {
  traces: TraceEntry[];
  logs: Log[];
  // Why the wait ended, so a caller can tell "nothing came" from "still busy".
  settled: boolean;
  timedOut: boolean;
}

const POLL_MS = 100;

export interface Room {
  status: () => RelayStatus;
  error: () => string | null;
  traces: () => TraceEntry[];
  logs: () => Log[];
  trace: (idOrPrefix: string) => TraceEntry | null;
  waitForActivity: (options: WaitOptions) => Promise<WaitResult>;
  clear: () => void;
  close: () => void;
}

export function createRoom(wsUrl: string): Room {
  const traceStore = new TraceStore();
  const logStore = new LogStore();
  // Last time each trace was touched, so a wait can report the traces a run
  // produced (including ones that existed already and grew more spans).
  const touchedAt = new Map<string, number>();
  const logSeenAt = new Map<string, number>();

  let status: RelayStatus = 'connecting';
  let error: string | null = null;
  let lastActivityAt = Date.now();

  const relay = createRelay(wsUrl, {
    onStatus: (next) => {
      status = next;
    },
    onReject: (message) => {
      error = message;
    },
    onTrace: (trace, spans) => {
      traceStore.upsert(trace, spans);
      touchedAt.set(trace.trace_id, Date.now());
      lastActivityAt = Date.now();
    },
    onLog: (log) => {
      logStore.upsert(log);
      logSeenAt.set(log.log_id, Date.now());
      lastActivityAt = Date.now();
    },
    onClear: () => {
      traceStore.clear();
      logStore.clear();
      touchedAt.clear();
      logSeenAt.clear();
    },
  });

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  return {
    status: () => status,
    error: () => error,
    traces: () => traceStore.list(),
    logs: () => logStore.list(),

    // Full id, or any unambiguous prefix: agents pass around shortened ids.
    trace(idOrPrefix) {
      const matches = traceStore
        .list()
        .filter((entry) => entry.trace.trace_id.startsWith(idOrPrefix));
      return matches.length === 1 ? matches[0]! : null;
    },

    async waitForActivity({ idleMs, timeoutMs, minTraces }) {
      const startedAt = Date.now();
      // Only count what arrives from here on, so the result describes this run
      // rather than everything the room has ever seen.
      const since = startedAt;

      for (;;) {
        const traces = traceStore
          .list()
          .filter(
            (entry) => (touchedAt.get(entry.trace.trace_id) ?? 0) >= since,
          );
        const idleFor = Date.now() - lastActivityAt;
        const settled = traces.length >= minTraces && idleFor >= idleMs;
        const timedOut = Date.now() - startedAt >= timeoutMs;

        if (settled || timedOut) {
          return {
            traces,
            logs: logStore
              .list()
              .filter((log) => (logSeenAt.get(log.log_id) ?? 0) >= since),
            settled,
            timedOut: timedOut && !settled,
          };
        }

        await sleep(POLL_MS);
      }
    },

    clear() {
      traceStore.clear();
      logStore.clear();
      touchedAt.clear();
      logSeenAt.clear();
    },

    close: () => relay.close(),
  };
}
