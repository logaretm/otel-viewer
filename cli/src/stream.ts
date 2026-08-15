// Non-interactive NDJSON output (--json). No TUI: every relay event becomes one
// JSON object on a line of stdout, so the CLI can be piped into jq, grepped, or
// run in CI. Built on the same relay client the TUI uses.

import { createRelay, TraceStore } from './relay';
import { MOCK_TRACES, buildMockLogs } from './mock-data';
import type { Endpoints, Session } from './session';
import type { Log, Span, Trace } from './types';

// A trace can appear on several lines as its spans stream in: `trace` is the
// running summary over every span seen so far, `spans` are only the ones that
// arrived in this update, so consumers can concatenate without deduping.
type StreamEventBody =
  | {
      type: 'session';
      version: string;
      room_id: string;
      host: string;
      dsn: string;
      otlp: string;
    }
  | { type: 'trace'; trace: Trace; spans: Span[] }
  | { type: 'log'; log: Log };

export type StreamEvent = StreamEventBody & { time: string };

export function formatEvent(body: StreamEventBody, time: string): string {
  const event: StreamEvent = { ...body, time };
  return JSON.stringify(event) + '\n';
}

function emit(body: StreamEventBody) {
  process.stdout.write(formatEvent(body, new Date().toISOString()));
}

interface StreamOptions {
  endpoints: Endpoints;
  session: Session;
  version: string;
  demo: boolean;
}

export function runStream({
  endpoints,
  session,
  version,
  demo,
}: StreamOptions) {
  emit({
    type: 'session',
    version,
    room_id: session.roomId,
    host: endpoints.host,
    dsn: endpoints.dsn,
    otlp: endpoints.otlp,
  });

  // --demo --json: dump the sample data and exit, so the event shape can be
  // inspected without wiring up an SDK.
  if (demo) {
    for (const { trace, spans } of MOCK_TRACES)
      emit({ type: 'trace', trace, spans });
    for (const log of buildMockLogs()) emit({ type: 'log', log });
    process.exit(0);
  }

  const traces = new TraceStore();

  // Connection state (status, viewer count) is TUI chrome and stays out of the
  // stream: stdout carries the session line and telemetry, nothing else.
  const relay = createRelay(endpoints.wsUrl, {
    onReject: (message) => {
      // Terminal: the relay will never accept us, so fail rather than idle.
      // Diagnostics go to stderr; stdout stays a clean telemetry stream.
      process.stderr.write(message + '\n');
      shutdown(1);
    },
    onTrace: (trace, spans) =>
      emit({ type: 'trace', trace: traces.upsert(trace, spans), spans }),
    onLog: (log) => emit({ type: 'log', log }),
    // A clear resets the merge state (so later spans do not fold into a dropped
    // trace) but emits nothing: what already went to stdout cannot be unsent.
    onClear: () => traces.clear(),
  });

  let exiting = false;
  function shutdown(code: number) {
    if (exiting) return;
    exiting = true;
    relay.close();
    process.exit(code);
  }

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));
}
