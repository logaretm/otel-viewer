// Local ingest (--local): the CLI is the endpoint, no relay involved.
//
// Serves the same two ingest routes the worker does, on localhost, and feeds
// what it parses straight into the room. Telemetry never leaves the machine,
// nothing needs to be deployed or reachable, and there is no room to claim, so
// the token and its "already claimed" failure do not exist here.
//
// The trade is that a local room has no relay behind it, so the web dashboard
// cannot open it. Terminal and MCP work the same either way.
//
// node:http rather than Bun.serve, because Bun implements it too and the rest
// of the CLI already runs under either runtime. One server means bun and node
// are provably serving the same routes, instead of a second implementation
// that only gets exercised on whichever runtime nobody runs.

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  parseSentryEnvelope,
  processSentryEnvelope,
  parseOTLPTrace,
  parseOTLPLogs,
  parseOTLPMetrics,
  readOTLPRequest,
  extractRoomIdFromSentryAuth,
  PayloadDecodeError,
  PayloadTooLargeError,
  MAX_PAYLOAD_BYTES,
} from '../../shared/parsers';
import type { SourceEvents, TelemetrySource } from './source';
import {
  captureException,
  count,
  distribution,
  reportPayloadFailure,
  METRIC,
} from './observability';

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
  const { signal, encoding, body } = await readOTLPRequest(request);

  if (signal === 'traces') {
    const result = parseOTLPTrace(body);
    for (const trace of result.traces) {
      const spans = result.spans.filter((s) => s.trace_id === trace.trace_id);
      events.onTrace?.(trace, spans);
    }
    accepted('otlp', signal, encoding, result.traces.length);
    return json({ status: 'success', tracesReceived: result.traces.length });
  }

  if (signal === 'logs') {
    const result = parseOTLPLogs(body);
    for (const log of result.logs) events.onLog?.(log);
    accepted('otlp', signal, encoding, result.logs.length);
    return json({ status: 'success', logsReceived: result.logs.length });
  }

  if (signal === 'metrics') {
    const result = parseOTLPMetrics(body);
    for (const metric of result.metrics) events.onMetric?.(metric);
    accepted('otlp', signal, encoding, result.metrics.length);
    return json({ status: 'success', metricsReceived: result.metrics.length });
  }

  // An exporter aimed at the wrong endpoint lands here, and the SDK almost
  // always swallows the response, so this counter is the only trace of it.
  count(METRIC.INGEST_REJECTED, { protocol: 'otlp', reason: 'unknown_signal' });
  return json({ error: 'Invalid OTLP payload' }, 400);
}

// Volume and shape only: how many records, of which signal, in which encoding.
// Nothing about what they contain.
function accepted(
  protocol: string,
  signal: string,
  encoding: string,
  records: number,
) {
  count(METRIC.INGEST_RECEIVED, { protocol, signal, encoding });
  distribution(METRIC.INGEST_RECORDS, records, { protocol, signal });
}

async function ingestSentry(
  request: Request,
  events: SourceEvents,
): Promise<Response> {
  const raw = await request.text();
  if (!raw) return json({ error: 'Empty envelope body' }, 400);

  // Both of these can throw, and only one of them can be the sender's fault:
  // parseSentryEnvelope raises PayloadDecodeError for a body it cannot read,
  // while processSentryEnvelope swallows per-item conversion failures itself,
  // so anything escaping it is our bug. The handler's catch tells them apart.
  const result = processSentryEnvelope(parseSentryEnvelope(raw));
  for (const trace of result.traces) {
    const spans = result.spans.filter((s) => s.trace_id === trace.trace_id);
    events.onTrace?.(trace, spans);
  }
  for (const log of result.logs) events.onLog?.(log);
  for (const metric of result.metrics) events.onMetric?.(metric);
  accepted('sentry', 'traces', 'json', result.traces.length);
  if (result.logs.length > 0) {
    accepted('sentry', 'logs', 'json', result.logs.length);
  }
  if (result.metrics.length > 0) {
    accepted('sentry', 'metrics', 'json', result.metrics.length);
  }

  return json({ id: crypto.randomUUID().replace(/-/g, '') });
}

// The suffixes worth telling apart. Anything else is bucketed, so a stray
// process posting junk paths cannot mint a metric series per path.
const KNOWN_SUFFIXES = new Set(['/v1/traces', '/v1/logs', '/v1/metrics']);

const OTLP_ROUTE = /^\/r\/([a-zA-Z0-9_-]+)$/;
const SENTRY_ROUTE = /^\/api\/\d+\/envelope\/?$/;

// The routes themselves, in the same Request/Response terms the worker and the
// parsers already speak. The node:http plumbing below is only what converts
// into and out of this.
async function handle(
  request: Request,
  events: SourceEvents,
): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
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
    const protocol = url.pathname.startsWith('/api/') ? 'sentry' : 'otlp';

    // Refused on size, not on content, so it gets the status that says so.
    // Checked first because it is a PayloadDecodeError too.
    if (error instanceof PayloadTooLargeError) {
      reportPayloadFailure(METRIC.INGEST_REJECTED, 'too_large', error, {
        protocol,
      });
      return json({ error: error.message }, 413);
    }

    // A payload we cannot decode is the sender's mistake, and answering
    // 500 would have the exporter retry the same bytes forever. The
    // parsers raise PayloadDecodeError for exactly that case, so anything
    // else reaching here is ours.
    if (error instanceof PayloadDecodeError || error instanceof SyntaxError) {
      // The message can quote the payload, so only its shape is reported.
      reportPayloadFailure(METRIC.INGEST_REJECTED, 'undecodable', error, {
        protocol,
      });
      return json({ error: error.message }, 400);
    }

    // Not the sender's fault: a bug of ours, reached with a payload that
    // decoded fine. Nothing else reports this, and nothing else answers it
    // either: node:http leaves a request whose handler rejected hanging
    // until the exporter times out, so the 500 is produced here rather than
    // rethrown for the runtime to turn into one.
    captureException(error, { area: 'ingest' });
    return json({ error: 'Internal error' }, 500);
  }

  // Almost always an exporter appending a signal path, because
  // OTEL_EXPORTER_OTLP_ENDPOINT is defined to do that. The SDK swallows
  // this response, so without the counter it fails silently on both ends.
  const suffix = url.pathname.match(/^\/r\/[a-zA-Z0-9_-]+(\/.*)$/)?.[1];
  count(METRIC.INGEST_UNROUTED, {
    method: request.method,
    suffix: suffix && KNOWN_SUFFIXES.has(suffix) ? suffix : 'other',
  });
  return json(
    {
      error: suffix
        ? `No ingest route for ${suffix}. Post OTLP to /r/{roomId} itself; OTEL_EXPORTER_OTLP_ENDPOINT appends the signal path, so use OTEL_EXPORTER_OTLP_TRACES_ENDPOINT or the exporter's url option.`
        : 'Not found',
    },
    404,
  );
}

// What Bun.serve enforced by default and node:http does not. The number is the
// parsers' own ceiling rather than one of ours: anything above it cannot
// survive decompression either, so reading it in only buys a refusal that was
// already certain.

// Buffered rather than streamed, because every parser downstream opens with
// request.arrayBuffer() anyway, and handing Request a stream needs `duplex`,
// which is the one part of this that is not portable across the two runtimes.
//
// A body that runs past the ceiling without having declared it takes the
// connection down and resolves null, because a status is no longer deliverable
// by then: abandoning the request stream mid-body leaves bun unable to put one
// on the wire (it answers an empty 200), and a false success is worse for the
// exporter than a dropped connection. Anything that sends Content-Length, which
// is every real exporter, is turned away with a 413 before reaching here.
async function readBody(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<Uint8Array | null> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_PAYLOAD_BYTES) {
      res.destroy();
      return null;
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

function toRequest(req: IncomingMessage, body: Uint8Array): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    // A repeated header arrives as an array. Nothing the routes read is ever
    // sent twice, and joining is what Headers itself would do with them.
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }

  const method = req.method ?? 'GET';
  // The authority is never meaningful on a loopback socket. It is here because
  // Request demands an absolute URL and the routes parse one back out of it.
  const url = new URL(
    req.url ?? '/',
    `http://${req.headers.host ?? 'localhost'}`,
  );

  return new Request(url.href, {
    method,
    headers,
    // Handing either of these a body is a TypeError, and neither carries one.
    body: method === 'GET' || method === 'HEAD' ? undefined : body,
  });
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  const body = Buffer.from(await response.arrayBuffer());
  if (res.writableEnded) return;
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(body);
}

// An exporter that gave up on a slow response, which is its timeout rather than
// a fault of ours, so it is answered with nothing and reported as nothing.
const DISCONNECT_CODES = new Set(['ECONNRESET', 'ECONNABORTED', 'EPIPE']);

function isDisconnect(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    DISCONNECT_CODES.has(String(error.code))
  );
}

async function respond(
  req: IncomingMessage,
  res: ServerResponse,
  events: SourceEvents,
): Promise<void> {
  try {
    // Checked against the declared size first, since that is the last point at
    // which both runtimes can still answer with a status rather than a reset.
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_PAYLOAD_BYTES) {
      await send(res, json({ error: 'Payload too large' }, 413));
      return;
    }

    const body = await readBody(req, res);
    // Over the ceiling undeclared, so the connection is already gone.
    if (!body) return;

    await send(res, await handle(toRequest(req, body), events));
  } catch (error) {
    if (isDisconnect(error)) {
      res.destroy();
      return;
    }

    // handle() answers its own failures, so reaching here means the request
    // never became one: a body we could not read, or headers we could not turn
    // into a Request.
    captureException(error, { area: 'ingest' });
    await send(res, json({ error: 'Internal error' }, 500)).catch(() =>
      res.destroy(),
    );
  }
}

export interface LocalIngest {
  // The port actually bound, which differs from the requested one when 0 was
  // passed to let the OS choose.
  port: number;
  source: TelemetrySource;
}

// Binds before returning, so a port collision surfaces at startup as a clear
// message rather than from inside whichever mode later asks for the room.
// Ingest is unauthenticated, the same as the relay's, but the socket is bound
// to loopback so only this machine can reach it.
export async function createLocalIngest(
  port: number,
  hostname = '127.0.0.1',
): Promise<LocalIngest> {
  // Assigned when a mode subscribes; requests that arrive first are parsed and
  // dropped, which only happens in the instant between bind and subscribe.
  let events: SourceEvents = {};

  const server = createServer((req, res) => {
    // respond() owns every failure, including its own, so nothing escapes into
    // an unhandled rejection that would take the process down mid-session.
    void respond(req, res, events);
  });

  // A taken port arrives on the 'error' event rather than as a throw, so it has
  // to become a rejection for the caller that turns it into the "pass --port"
  // message.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, hostname, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const source: TelemetrySource = (subscriber) => {
    events = subscriber;
    // Nothing to connect to, so the room is live as soon as the socket binds.
    subscriber.onStatus?.('connected');
    return {
      close: () => {
        // close() alone only stops new connections, and an exporter holding a
        // keep-alive socket would keep the process up after the TUI is gone.
        server.closeAllConnections();
        server.close();
      },
    };
  };

  const address = server.address();

  return {
    port: typeof address === 'object' && address ? address.port : port,
    source,
  };
}
