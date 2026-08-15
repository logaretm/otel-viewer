// Local ingest (--local): the CLI is the endpoint, no relay involved.
//
// Serves the same two ingest routes the worker does, on localhost, and feeds
// what it parses straight into the room. Telemetry never leaves the machine,
// nothing needs to be deployed or reachable, and there is no room to claim, so
// the token and its "already claimed" failure do not exist here.
//
// The trade is that a local room has no relay behind it, so the web dashboard
// cannot open it. Terminal and MCP work the same either way.

import {
  parseSentryEnvelope,
  processSentryEnvelope,
  parseOTLPTrace,
  parseOTLPLogs,
  parseOTLPMetrics,
  readOTLPRequest,
  extractRoomIdFromSentryAuth,
  OTLPDecodeError,
} from '../../shared/parsers';
import type { SourceEvents, TelemetrySource } from './source';

// Browser SDKs post from another origin (a dev server on :3000), so ingest has
// to answer preflights the same way the worker does.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, X-Sentry-Auth, sentry-trace, baggage',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

async function ingestOTLP(
  request: Request,
  events: SourceEvents,
): Promise<Response> {
  const { signal, body } = await readOTLPRequest(request);

  if (signal === 'traces') {
    const result = parseOTLPTrace(body);
    for (const trace of result.traces) {
      const spans = result.spans.filter((s) => s.trace_id === trace.trace_id);
      events.onTrace?.(trace, spans);
    }
    return json({ status: 'success', tracesReceived: result.traces.length });
  }

  if (signal === 'logs') {
    const result = parseOTLPLogs(body);
    for (const log of result.logs) events.onLog?.(log);
    return json({ status: 'success', logsReceived: result.logs.length });
  }

  if (signal === 'metrics') {
    // Parsed for the count, then dropped: the CLI renders no metrics yet.
    const result = parseOTLPMetrics(body);
    return json({ status: 'success', metricsReceived: result.metrics.length });
  }

  return json({ error: 'Invalid OTLP payload' }, 400);
}

async function ingestSentry(
  request: Request,
  events: SourceEvents,
): Promise<Response> {
  const raw = await request.text();
  if (!raw) return json({ error: 'Empty envelope body' }, 400);

  const result = processSentryEnvelope(parseSentryEnvelope(raw));
  for (const trace of result.traces) {
    const spans = result.spans.filter((s) => s.trace_id === trace.trace_id);
    events.onTrace?.(trace, spans);
  }
  for (const log of result.logs) events.onLog?.(log);

  return json({ id: crypto.randomUUID().replace(/-/g, '') });
}

const OTLP_ROUTE = /^\/r\/([a-zA-Z0-9_-]+)$/;
const SENTRY_ROUTE = /^\/api\/\d+\/envelope\/?$/;

export interface LocalIngest {
  // The port actually bound, which differs from the requested one when 0 was
  // passed to let the OS choose.
  port: number;
  source: TelemetrySource;
}

// Binds immediately, so a port collision surfaces at startup as a clear message
// rather than from inside whichever mode later asks for the room. Ingest is
// unauthenticated, the same as the relay's, but the socket is bound to loopback
// so only this machine can reach it.
export function createLocalIngest(
  port: number,
  hostname = '127.0.0.1',
): LocalIngest {
  // Assigned when a mode subscribes; requests that arrive first are parsed and
  // dropped, which only happens in the instant between bind and subscribe.
  let events: SourceEvents = {};

  const server = Bun.serve({
    port,
    hostname,
    async fetch(request) {
      const url = new URL(request.url);

      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: { ...CORS_HEADERS, 'Access-Control-Max-Age': '86400' },
        });
      }

      try {
        if (request.method === 'POST' && OTLP_ROUTE.test(url.pathname)) {
          return await ingestOTLP(request, events);
        }

        if (
          request.method === 'POST' &&
          SENTRY_ROUTE.test(url.pathname) &&
          extractRoomIdFromSentryAuth(request)
        ) {
          return await ingestSentry(request, events);
        }
      } catch (error) {
        // A payload we cannot decode is the sender's mistake, and answering
        // 500 would have the exporter retry the same bytes forever.
        if (error instanceof OTLPDecodeError || error instanceof SyntaxError) {
          return json({ error: error.message }, 400);
        }
        throw error;
      }

      return json({ error: 'Not found' }, 404);
    },
  });

  const source: TelemetrySource = (subscriber) => {
    events = subscriber;
    // Nothing to connect to, so the room is live as soon as the socket binds.
    subscriber.onStatus?.('connected');
    return { close: () => void server.stop(true) };
  };

  return { port: server.port ?? port, source };
}
