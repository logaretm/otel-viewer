// MCP server (`teley mcp`). Exposes the room to a coding agent as tools, so it
// can instrument an app, run it, and read the traces back without a terminal.
//
// Speaks the 2026-07-28 spec via @modelcontextprotocol/server v2: no session
// handshake, every tool call self-contained. The room behind the tools is held
// in memory for the life of the process: the relay keeps no history, so a
// restart starts empty and the agent re-runs the app.
//
// stdout belongs to JSON-RPC. Diagnostics go to stderr, never console.log.

import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod';
import { createRoom, type Room } from './room';
import type { TelemetrySource } from './source';
import { buildSpanTree } from './span-tree';
import {
  formatCompact,
  formatDuration,
  formatLogTime,
  severityLabel,
  spanKindLabel,
  stringifyValue,
  unitLabel,
} from './format';
import type { Endpoints, Session } from './session';
import {
  currentValue,
  groupSeries,
  seriesStats,
  type MetricSeries,
} from './metrics';
import type { Log, TraceEntry } from './types';
import {
  captureException,
  count,
  distribution,
  flush,
  span,
  METRIC,
} from './observability';

// Trace ids are 32 hex chars. Agents pass them back to get_trace, which accepts
// any unambiguous prefix, so lists print a short form to keep results cheap.
const SHORT_ID = 12;

const SEVERITY_FLOOR: Record<string, number> = {
  trace: 1,
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
  fatal: 21,
};

function shortId(id: string): string {
  return id.slice(0, SHORT_ID);
}

function errorCount(entry: TraceEntry): number {
  return entry.spans.filter((span) => span.status_code === 2).length;
}

// One line per trace: enough to decide which one to open, nothing more.
function traceLine(entry: TraceEntry): string {
  const { trace } = entry;
  const errors = errorCount(entry);
  const status = trace.status_code === 2 ? `error(${errors})` : 'ok';
  return [
    shortId(trace.trace_id),
    trace.service_name,
    trace.operation_name,
    formatDuration(trace.duration),
    status,
    `${entry.spans.length} spans`,
    formatLogTime(trace.start_time),
  ].join('  ');
}

// An empty result means very different things to an agent ("the app sent
// nothing" vs "your filter excluded everything"), so the caller names it.
function traceList(entries: TraceEntry[], empty: string): string {
  if (entries.length === 0) return empty;
  return entries.map(traceLine).join('\n');
}

const NOTHING_CAPTURED =
  'No traces captured yet. Point the app at the DSN from get_dsn, run it, then call wait_for_traces.';

function logLine(log: Log): string {
  const severity = severityLabel(log.severity_number, log.severity_text);
  const correlation = log.trace_id ? `  trace=${shortId(log.trace_id)}` : '';
  return `${formatLogTime(log.timestamp)}  ${severity}  ${log.service_name}  ${log.body}${correlation}`;
}

function logList(logs: Log[], empty: string): string {
  if (logs.length === 0) return empty;
  return logs.map(logLine).join('\n');
}

// The span tree as indented text: depth carries the hierarchy, the leading
// offset carries the timing, so an agent can read a waterfall without pixels.
function waterfall(entry: TraceEntry, includeAttributes: boolean): string {
  const { trace } = entry;
  const nodes = buildSpanTree(entry.spans, trace);

  const header = [
    `trace ${trace.trace_id}`,
    `service ${trace.service_name}`,
    `operation ${trace.operation_name}`,
    `duration ${formatDuration(trace.duration)}`,
    `status ${trace.status_code === 2 ? 'error' : 'ok'}`,
    `spans ${entry.spans.length}`,
    `source ${trace.source}`,
    `started ${new Date(trace.start_time).toISOString()}`,
  ].join('\n');

  const rows = nodes.map(({ span, depth }) => {
    // Sub-millisecond offsets read as noise here ("+0µs" for the root span),
    // so anything under a millisecond collapses to +0ms.
    const delta = span.start_time - trace.start_time;
    const offset = delta < 1 ? '+0ms' : `+${formatDuration(delta)}`;
    const name = `${'  '.repeat(depth)}${span.name}`;
    const parts = [
      offset.padStart(9),
      name.padEnd(48),
      formatDuration(span.duration).padStart(8),
      spanKindLabel(span.kind).toLowerCase(),
    ];
    let row = parts.join('  ');
    if (span.status_code === 2) {
      row += `  ERROR${span.status_message ? `: ${span.status_message}` : ''}`;
    }
    if (includeAttributes) {
      const attributes = Object.entries(span.attributes ?? {});
      for (const [key, value] of attributes) {
        row += `\n${' '.repeat(11)}${'  '.repeat(depth)}${key}=${stringifyValue(value)}`;
      }
    }
    return row;
  });

  return `${header}\n\n${rows.join('\n')}`;
}

function text(body: string) {
  return { content: [{ type: 'text' as const, text: body }] };
}

// How a tool call ended. 'ok' is not the only success: an agent asking for
// traces and correctly getting none is a different story from one that timed
// out or hit a disconnected room, and telling them apart is the point.
type Outcome = 'ok' | 'empty' | 'timeout' | 'not_found' | 'disconnected';

/**
 * Records what a tool call did: a span for the one call, a counter for the
 * shape of all of them, and a duration. Tool names and outcomes are ours;
 * nothing from the room's telemetry goes with them.
 */
async function measure<T>(
  tool: string,
  run: (setOutcome: (outcome: Outcome) => void) => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  let outcome: Outcome = 'ok';

  try {
    const result = await span(
      `mcp.tool/${tool}`,
      { tool },
      async (setAttribute) => {
        const value = await run((next) => {
          outcome = next;
          setAttribute('outcome', next);
        });
        setAttribute('outcome', outcome);
        return value;
      },
    );
    count(METRIC.MCP_TOOL_CALL, { tool, outcome });
    return result;
  } catch (error) {
    count(METRIC.MCP_TOOL_CALL, { tool, outcome: 'error' });
    captureException(error, { area: 'mcp-tool', tool });
    throw error;
  } finally {
    distribution(
      METRIC.MCP_TOOL_DURATION,
      Date.now() - startedAt,
      { tool },
      'millisecond',
    );
  }
}

// A rejected handshake means another client holds the room; every tool would
// otherwise just report an empty room, which reads like "the app sent nothing".
function relayProblem(room: Room): string | null {
  const error = room.error();
  if (error) return `Not connected to the room. ${error}`;
  return null;
}

// One line per metric series: what it is, where it came from, and its current
// reading. A model picking a series to look at needs no more than this.
function seriesLine(series: MetricSeries): string {
  const stats = seriesStats(series);
  const value = currentValue(series);
  const unit = unitLabel(series.unit);
  const reading =
    value === null ? '-' : `${formatCompact(value)}${unit ? ` ${unit}` : ''}`;
  const spread =
    series.type === 'histogram'
      ? `${series.latest.histogram?.count ?? 0} obs`
      : `min ${formatCompact(stats.min)} max ${formatCompact(stats.max)} avg ${formatCompact(stats.avg)} over ${stats.count} points`;

  return [
    series.name,
    series.type,
    series.service_name,
    reading,
    spread,
    series.distinguisher || '',
  ]
    .filter(Boolean)
    .join('  ');
}

function seriesList(series: MetricSeries[], empty: string): string {
  if (series.length === 0) return empty;
  return series.map(seriesLine).join('\n');
}

export function buildMcpServer(
  room: Room,
  endpoints: Endpoints,
  session: Session,
  version: string,
): McpServer {
  const server = new McpServer({ name: 'teley', version });

  server.registerTool(
    'get_dsn',
    {
      title: 'Get ingest endpoints',
      description:
        'Returns the Sentry DSN and OTLP endpoint for the room this server is watching. Point the app under test at one of them (Sentry.init, an OTLP exporter url, or OTEL_EXPORTER_OTLP_TRACES_ENDPOINT), then run the app and call wait_for_traces.',
      annotations: { readOnlyHint: true },
    },
    async () =>
      measure('get_dsn', async () =>
        text(
          [
            `room_id: ${session.roomId}`,
            `sentry_dsn: ${endpoints.dsn}`,
            `otlp_endpoint: ${endpoints.otlp}`,
            `host: ${endpoints.host}`,
            '',
            'Traces, logs, and metrics all go to the OTLP endpoint (JSON or protobuf).',
            'Use it verbatim: OTEL_EXPORTER_OTLP_ENDPOINT appends /v1/traces, so prefer OTEL_EXPORTER_OTLP_TRACES_ENDPOINT or the exporter url option.',
            endpoints.local
              ? 'This room is local to this machine: telemetry never leaves it, and no relay or web app is involved.'
              : 'The same room is open in the Teley web app and the teley TUI.',
          ].join('\n'),
        ),
      ),
  );

  server.registerTool(
    'wait_for_traces',
    {
      title: 'Wait for traces',
      description:
        'Blocks until the room goes quiet, then returns the traces that arrived while waiting. Call it right after running the app or hitting an endpoint. Returns one summary line per trace; pass a trace id to get_trace for the span tree.',
      inputSchema: z.object({
        idle_ms: z
          .number()
          .int()
          .positive()
          .default(2000)
          .describe('Return once nothing new has arrived for this long.'),
        timeout_ms: z
          .number()
          .int()
          .positive()
          .default(30000)
          .describe('Give up waiting after this long, quiet or not.'),
        min_traces: z
          .number()
          .int()
          .min(0)
          .default(1)
          .describe('Keep waiting until at least this many traces arrive.'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ idle_ms, timeout_ms, min_traces }) =>
      measure('wait_for_traces', async (setOutcome) => {
        const problem = relayProblem(room);
        if (problem) {
          setOutcome('disconnected');
          return text(problem);
        }

        const result = await room.waitForActivity({
          idleMs: idle_ms,
          timeoutMs: timeout_ms,
          minTraces: min_traces,
        });

        // What a run actually yields is the health signal for this whole flow:
        // an agent that waits and gets nothing means the app under test never
        // reached us, which is the most common way the loop fails.
        distribution(METRIC.MCP_WAIT_TRACES, result.traces.length, {
          timed_out: result.timedOut,
        });

        if (result.timedOut && result.traces.length === 0) {
          setOutcome('timeout');
          return text(
            `Nothing arrived in ${timeout_ms}ms. Check that the app is running and pointed at the DSN from get_dsn, and that it flushed before exiting.`,
          );
        }

        if (result.traces.length === 0) setOutcome('empty');

        const summary = `${result.traces.length} trace(s), ${result.logs.length} log(s), ${result.metrics.length} metric point(s)${
          result.timedOut ? ' (timed out, the room was still busy)' : ''
        }`;
        // Traces are what this tool waits for, so say where the rest went
        // rather than reporting an empty result over telemetry that did arrive.
        const alsoCame = [
          result.logs.length > 0 ? 'logs (see list_logs)' : '',
          result.metrics.length > 0 ? 'metrics (see list_metrics)' : '',
        ].filter(Boolean);
        const empty =
          alsoCame.length > 0
            ? `No traces arrived, only ${alsoCame.join(' and ')}.`
            : 'Nothing arrived while waiting.';
        return text([summary, '', traceList(result.traces, empty)].join('\n'));
      }),
  );

  server.registerTool(
    'list_traces',
    {
      title: 'List traces',
      description:
        'Lists traces already captured in this room, newest first, one summary line each. Use wait_for_traces instead when the app was just run and the traces may still be in flight.',
      inputSchema: z.object({
        limit: z.number().int().positive().default(20),
        errors_only: z
          .boolean()
          .default(false)
          .describe('Only traces whose status is error.'),
        service: z
          .string()
          .optional()
          .describe('Only traces from this service name.'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ limit, errors_only, service }) =>
      measure('list_traces', async (setOutcome) => {
        const problem = relayProblem(room);
        if (problem) {
          setOutcome('disconnected');
          return text(problem);
        }

        const all = room.traces();
        const entries = all
          .filter((entry) => !errors_only || entry.trace.status_code === 2)
          .filter((entry) => !service || entry.trace.service_name === service)
          .slice(0, limit);

        if (entries.length === 0) setOutcome('empty');

        const empty =
          all.length === 0
            ? NOTHING_CAPTURED
            : `No traces match those filters (${all.length} captured).`;
        return text(traceList(entries, empty));
      }),
  );

  server.registerTool(
    'get_trace',
    {
      title: 'Get a trace',
      description:
        'Returns one trace as an indented span tree: each span with its start offset, duration, kind, and error status. Set include_attributes to see span attributes (http/db metadata, error details), which is where a root cause usually is.',
      inputSchema: z.object({
        trace_id: z
          .string()
          .min(4)
          .describe('Full trace id, or any unambiguous prefix of one.'),
        include_attributes: z.boolean().default(false),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ trace_id, include_attributes }) =>
      measure('get_trace', async (setOutcome) => {
        const problem = relayProblem(room);
        if (problem) {
          setOutcome('disconnected');
          return text(problem);
        }

        const entry = room.trace(trace_id);
        if (!entry) {
          setOutcome('not_found');
          return text(
            `No single trace matches "${trace_id}". Call list_traces to see what is captured.`,
          );
        }
        return text(waterfall(entry, include_attributes));
      }),
  );

  server.registerTool(
    'list_logs',
    {
      title: 'List logs',
      description:
        'Lists logs captured in this room, newest first. Filter by minimum severity, or by trace id to see the logs correlated with one trace.',
      inputSchema: z.object({
        limit: z.number().int().positive().default(50),
        min_severity: z
          .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
          .optional(),
        trace_id: z
          .string()
          .optional()
          .describe('Only logs correlated with this trace id or prefix.'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ limit, min_severity, trace_id }) =>
      measure('list_logs', async (setOutcome) => {
        const problem = relayProblem(room);
        if (problem) {
          setOutcome('disconnected');
          return text(problem);
        }

        const floor = min_severity ? SEVERITY_FLOOR[min_severity]! : 0;
        const all = room.logs();
        const logs = all
          .filter((log) => log.severity_number >= floor)
          .filter(
            (log) => !trace_id || (log.trace_id?.startsWith(trace_id) ?? false),
          )
          .slice(0, limit);

        if (logs.length === 0) setOutcome('empty');

        const empty =
          all.length === 0
            ? 'No logs captured yet.'
            : `No logs match those filters (${all.length} captured).`;
        return text(logList(logs, empty));
      }),
  );

  server.registerTool(
    'list_metrics',
    {
      title: 'List metrics',
      description:
        'Lists the metric series captured in this room, one line each: type, service, current reading, and the range it moved over. A metric split by attributes is several series, listed separately. Use it to check a counter moved or a duration regressed after a run.',
      inputSchema: z.object({
        limit: z.number().int().positive().default(50),
        name: z
          .string()
          .optional()
          .describe('Only series whose metric name contains this substring.'),
        service: z
          .string()
          .optional()
          .describe('Only series from this service name.'),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ limit, name, service }) =>
      measure('list_metrics', async (setOutcome) => {
        const problem = relayProblem(room);
        if (problem) {
          setOutcome('disconnected');
          return text(problem);
        }

        const all = groupSeries(room.metrics());
        const needle = name?.toLowerCase();
        const series = all
          .filter((s) => !needle || s.name.toLowerCase().includes(needle))
          .filter((s) => !service || s.service_name === service)
          .slice(0, limit);

        if (series.length === 0) setOutcome('empty');

        const empty =
          all.length === 0
            ? 'No metrics captured yet. Metrics go to the same OTLP endpoint as traces, under /v1/metrics.'
            : `No series match those filters (${all.length} captured).`;
        return text(seriesList(series, empty));
      }),
  );

  server.registerTool(
    'clear_captured',
    {
      title: 'Clear captured telemetry',
      description:
        'Drops the traces, logs, and metrics captured so far, so the next run starts from an empty room. Local to this server: it does not clear the web app or other viewers.',
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async () =>
      measure('clear_captured', async () => {
        room.clear();
        return text('Cleared the locally captured traces, logs, and metrics.');
      }),
  );

  return server;
}

export function runMcp(
  endpoints: Endpoints,
  session: Session,
  source: TelemetrySource,
  version: string,
) {
  // Record from process start, not from the first tool call, so traces sent
  // while the agent is still thinking are not lost.
  const room = createRoom(source);
  console.error(
    `teley mcp: watching room ${session.roomId} on ${endpoints.host}`,
  );

  const handle = serveStdio(() =>
    buildMcpServer(room, endpoints, session, version),
  );

  let exiting = false;
  const shutdown = async () => {
    // Re-entrant now that it awaits a flush: a second ctrl-c inside that window,
    // or SIGINT racing stdin closing, would otherwise tear the room down twice.
    if (exiting) return;
    exiting = true;
    room.close();
    await flush();
    // Exit without waiting on the teardown promise: the transport is going away
    // with the process either way.
    void handle.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
  // The client closing stdin is how a stdio server is told to go away; without
  // this the room WebSocket would keep the process alive as an orphan.
  process.stdin.on('end', () => void shutdown());
}
