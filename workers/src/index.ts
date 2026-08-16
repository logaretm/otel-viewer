// Main Cloudflare Worker entry point

import * as Sentry from '@sentry/cloudflare';
import type { Env } from './types';
import {
  parseSentryEnvelope,
  processSentryEnvelope,
  parseOTLPTrace,
  parseOTLPLogs,
  parseOTLPMetrics,
  generateEventId,
  extractRoomIdFromSentryAuth,
  readOTLPRequest,
  OTLPDecodeError,
  PayloadDecodeError,
  PayloadTooLargeError,
} from '../../shared/parsers';
import { handleCORS, corsResponse, roomTag } from './util';
import { METRIC, redactUrl } from '../../shared/observability';

export { TelemetryRoom } from './durable-object';

// Suffixes an exporter realistically appends, kept apart from everything else.
const OTLP_SIGNAL_PATHS = new Set(['/v1/traces', '/v1/logs', '/v1/metrics']);

const handler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    console.log('[Worker] Request:', request.method, url.pathname);
    nameRequestSpan(request, url);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return handleCORS();
    }

    // Sentry envelope endpoint: /api/{projectId}/envelope/
    if (
      url.pathname.match(/^\/api\/\d+\/envelope\/?$/) &&
      request.method === 'POST'
    ) {
      console.log('[Worker] Sentry envelope endpoint matched');
      const roomId = extractRoomIdFromSentryAuth(request);
      console.log('[Worker] Extracted roomId:', roomId);
      if (!roomId) {
        // A misconfigured DSN looks exactly like this: the SDK is sending, but
        // nothing can be routed to a room, so nothing ever shows up.
        Sentry.metrics.count(METRIC.INGEST_REJECTED, 1, {
          attributes: {
            surface: 'worker',
            protocol: 'sentry',
            reason: 'no_room_id',
          },
        });
        Sentry.logger.warn('Sentry ingest rejected: no room ID in request', {
          has_auth_header: request.headers.has('x-sentry-auth'),
          user_agent: request.headers.get('user-agent') ?? 'unknown',
        });
        return corsResponse(
          new Response('Missing room ID in X-Sentry-Auth', { status: 400 }),
        );
      }
      return corsResponse(await handleSentryIngest(request, env, roomId));
    }

    // OTLP / WebSocket endpoint: /r/{roomId}
    const roomMatch = url.pathname.match(/^\/r\/([a-zA-Z0-9_-]+)$/);
    if (roomMatch) {
      const roomId = roomMatch[1];

      if (request.headers.get('Upgrade') === 'websocket') {
        return handleWebSocket(request, env, roomId);
      }

      if (request.method === 'POST') {
        return corsResponse(await handleOTLPIngest(request, env, roomId));
      }
    }

    // A POST that matched no ingest route is an exporter aimed at the wrong
    // path, most often `/r/{id}/v1/traces` because OTEL_EXPORTER_OTLP_ENDPOINT
    // appends the signal. Falling through to the asset handler answered 405 and
    // recorded nothing, so the most common setup mistake was invisible on both
    // ends: the SDK swallows the response and we never heard about it.
    if (request.method === 'POST') {
      const path = url.pathname.match(/^\/r\/[a-zA-Z0-9_-]+(\/.*)$/)?.[1];
      // Ingest is public and unauthenticated, so this attribute is
      // attacker-controlled: anything posting /r/{id}/<random> would mint a
      // metric series per path and file a log per request. Only the suffixes
      // worth diagnosing are kept.
      const suffix = path && OTLP_SIGNAL_PATHS.has(path) ? path : 'other';
      Sentry.metrics.count(METRIC.INGEST_UNROUTED, 1, {
        attributes: { surface: 'worker', suffix },
      });
      Sentry.logger.warn('Ingest request matched no route', {
        suffix,
        content_type: request.headers.get('content-type') ?? 'none',
        user_agent: request.headers.get('user-agent') ?? 'unknown',
      });
      return corsResponse(
        new Response(
          JSON.stringify({
            error: path
              ? `No ingest route for ${path}. Post OTLP to /r/{roomId} itself; OTEL_EXPORTER_OTLP_ENDPOINT appends the signal path, so use OTEL_EXPORTER_OTLP_TRACES_ENDPOINT or the exporter's url option.`
              : 'No ingest route',
          }),
          { status: 404, headers: { 'Content-Type': 'application/json' } },
        ),
      );
    }

    // Static assets
    if (env.ASSETS) {
      // Try to serve the exact file first
      const response = await env.ASSETS.fetch(request);

      // If not found and it's a navigation request (not a file), serve index.html for SPA
      if (response.status === 404 && !url.pathname.includes('.')) {
        const indexRequest = new Request(
          new URL('/index.html', request.url),
          request,
        );
        return env.ASSETS.fetch(indexRequest);
      }

      return response;
    }

    return new Response('Not Found', { status: 404 });
  },
};

/**
 * The SDK names the request span after the raw path, and the room ID is a path
 * segment: an ingest credential in every span it sends. Rather than scrub spans
 * on the way out, the name is set here, where the request arrives, to the route
 * that produced it. Templated names are what a span name should be anyway,
 * since raw paths make one group per room.
 */
function nameRequestSpan(request: Request, url: URL): void {
  const span = Sentry.getActiveSpan();
  if (!span) return;

  const route = templateRoute(url.pathname);

  Sentry.updateSpanName(span, `${request.method} ${route}`);
  // The SDK already ran url.full through the dataCollection filter when it
  // opened the span, so the query string is gone. Rebuild from origin and path
  // rather than the raw request URL, which would put every other query param
  // back on the span that urlQueryParams: false just removed.
  span.setAttributes({
    'url.full': `${url.origin}${route}`,
    'url.path': route,
  });
}

/**
 * A path reduced to the route that produced it. Anything trailing a room ID is
 * bucketed the same way the unrouted counter buckets it: this path is public
 * and unauthenticated, so keeping the tail verbatim would let anyone mint a
 * transaction name per request.
 */
function templateRoute(pathname: string): string {
  const room = pathname.match(/^\/r\/[a-zA-Z0-9_-]+(\/.*)?$/);
  if (room) {
    const suffix = room[1];
    if (!suffix) return '/r/:roomId';
    return `/r/:roomId${OTLP_SIGNAL_PATHS.has(suffix) ? suffix : '/*'}`;
  }
  if (/^\/api\/\d+\/envelope\/?$/.test(pathname)) {
    return '/api/:projectId/envelope';
  }

  // Everything else is the SPA or its assets, whose filenames are content
  // hashed. Keep the first segment so the shape stays legible and bucket the
  // rest, or each deploy mints a fresh set of span names.
  const [, first, ...rest] = pathname.split('/');
  if (!first) return '/';
  return rest.length > 0 ? `/${first}/*` : `/${first}`;
}

// Volume and shape only: how many records, of which signal, in which encoding.
function accepted(
  protocol: string,
  signal: string,
  encoding: string,
  records: number,
) {
  Sentry.metrics.count(METRIC.INGEST_RECEIVED, 1, {
    attributes: { surface: 'worker', protocol, signal, encoding },
  });
  Sentry.metrics.distribution(METRIC.INGEST_RECORDS, records, {
    attributes: { surface: 'worker', protocol, signal },
  });
}

export default Sentry.withSentry(
  (env: Env) => ({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,
    release: env.CF_VERSION_METADATA?.id,
    tracesSampleRate: 0.1,

    // Telemetry sent to a room belongs to whoever is being debugged. v11
    // removed sendDefaultPii and collects broadly unless told otherwise, and
    // the categories it would take here are all the user's: request bodies are
    // the OTLP and Sentry payloads, query strings carry the receive token
    // (`?token=`) and the room ID (`?sentry_key=`), and the Sentry auth header
    // carries the room ID as well. Every category is named rather than left to
    // a default a later version may widen again.
    dataCollection: {
      userInfo: false,
      cookies: false,
      urlQueryParams: false,
      httpHeaders: {
        request: { deny: ['x-sentry-auth', 'authorization', 'cookie'] },
        response: false,
      },
      httpBodies: [],
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      graphQL: { document: false, variables: false },
    },

    // The room ID sits in the path of every ingest and socket URL, and URLs
    // reach events through request data, messages and stack frames. Nothing
    // redacted them before: a captured error on /r/{roomId}?token=... carried
    // both halves of a room's credentials into our own project.
    beforeSend(event) {
      if (event.request?.url) event.request.url = redactUrl(event.request.url);
      if (event.message) event.message = redactUrl(event.message);
      for (const exception of event.exception?.values ?? []) {
        if (exception.value) exception.value = redactUrl(exception.value);
      }
      return event;
    },

    // Console breadcrumbs are the wrong shape to scrub: this file logs bare
    // room IDs, and a bare nanoid matches no URL pattern. The logs exist for
    // `wrangler tail`, not for Sentry, so the integration goes instead.
    integrations: (defaults) =>
      defaults.filter((integration) => integration.name !== 'Console'),

    // Whatever breadcrumbs remain (fetch, http) carry URLs.
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.message) {
        breadcrumb.message = redactUrl(breadcrumb.message);
      }
      if (typeof breadcrumb.data?.url === 'string') {
        breadcrumb.data.url = redactUrl(breadcrumb.data.url);
      }
      return breadcrumb;
    },
  }),
  handler,
);

async function handleSentryIngest(
  request: Request,
  env: Env,
  roomId: string,
): Promise<Response> {
  console.log('[Worker] handleSentryIngest called, roomId:', roomId);

  try {
    const rawBody = await request.text();
    console.log('[Worker] Sentry envelope body length:', rawBody.length);

    if (!rawBody) {
      Sentry.logger.warn('Sentry ingest rejected: empty envelope body', {
        room: roomTag(roomId),
        content_encoding: request.headers.get('content-encoding') ?? 'none',
      });
      return new Response(JSON.stringify({ error: 'Empty envelope body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Parse Sentry envelope
    const envelope = parseSentryEnvelope(rawBody);
    console.log('[Worker] Parsed envelope, items:', envelope.items.length);

    // Convert Sentry data to OTLP format
    const result = processSentryEnvelope(envelope);

    const sdk = envelope.headers.sdk?.name ?? 'unknown';
    const itemTypes = envelope.items.map((item) => item.headers.type).join(',');
    const yielded =
      result.traces.length + result.logs.length + result.metrics.length;

    if (yielded === 0) {
      // The envelope parsed but converted to nothing. This is the shape every
      // silent SDK incompatibility takes, so it is worth a warning rather than
      // a success response nobody looks at.
      Sentry.logger.warn('Sentry envelope yielded no telemetry', {
        room: roomTag(roomId),
        sdk,
        sdk_version: envelope.headers.sdk?.version ?? 'unknown',
        item_types: itemTypes,
        item_count: envelope.items.length,
      });
    } else {
      // This branch is reached when any signal is non-empty, so counting it all
      // as `traces` mislabels a logs-only envelope and records zero records.
      if (result.traces.length > 0) {
        accepted('sentry', 'traces', 'json', result.traces.length);
      }
      if (result.logs.length > 0) {
        accepted('sentry', 'logs', 'json', result.logs.length);
      }
      if (result.metrics.length > 0) {
        accepted('sentry', 'metrics', 'json', result.metrics.length);
      }
      Sentry.logger.debug('Sentry envelope ingested', {
        room: roomTag(roomId),
        sdk,
        item_types: itemTypes,
        traces: result.traces.length,
        spans: result.spans.length,
        logs: result.logs.length,
        metrics: result.metrics.length,
      });
    }
    console.log(
      '[Worker] Processed envelope, traces:',
      result.traces.length,
      'spans:',
      result.spans.length,
      'logs:',
      result.logs.length,
    );

    // Broadcast each trace update
    for (const trace of result.traces) {
      const traceSpans = result.spans.filter(
        (s) => s.trace_id === trace.trace_id,
      );
      await broadcastToRoom(env, roomId, {
        type: 'trace_update',
        data: { trace, spans: traceSpans },
      });
    }

    // Broadcast each log update
    for (const log of result.logs) {
      await broadcastToRoom(env, roomId, {
        type: 'log_update',
        data: { log },
      });
    }

    // Broadcast each metric update
    for (const metric of result.metrics) {
      await broadcastToRoom(env, roomId, {
        type: 'metric_update',
        data: { metric },
      });
    }

    const eventId = envelope.headers.event_id || generateEventId();

    return new Response(JSON.stringify({ id: eventId, status: 'success' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    // A body we cannot read is the sender's mistake: a rejection, a 400, and
    // nothing to page anyone about. Anything else broke in our conversion code
    // on an envelope that parsed, so it stays an exception and a 500.
    if (error instanceof PayloadDecodeError) {
      Sentry.metrics.count(METRIC.INGEST_REJECTED, 1, {
        attributes: {
          surface: 'worker',
          protocol: 'sentry',
          reason: 'undecodable',
        },
      });
      Sentry.logger.warn('Sentry envelope rejected: undecodable', {
        room: roomTag(roomId),
        error_type: error.name,
      });
      return new Response(JSON.stringify({ error: 'Invalid envelope' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    console.error('[Sentry] Error:', error.message);
    Sentry.logger.error('Sentry envelope conversion failed', {
      room: roomTag(roomId),
      error: error.message,
    });
    Sentry.captureException(error, { tags: { ingest: 'sentry' } });
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function handleOTLPIngest(
  request: Request,
  env: Env,
  roomId: string,
): Promise<Response> {
  console.log('[Worker] handleOTLPIngest called, roomId:', roomId);

  try {
    const { encoding, signal, body } = await readOTLPRequest(request);
    console.log('[Worker] OTLP payload:', encoding, signal ?? 'unrecognized');

    if (signal === 'traces') {
      const result = parseOTLPTrace(body);
      accepted('otlp', 'traces', encoding, result.traces.length);

      for (const trace of result.traces) {
        const traceSpans = result.spans.filter(
          (s) => s.trace_id === trace.trace_id,
        );
        await broadcastToRoom(env, roomId, {
          type: 'trace_update',
          data: { trace, spans: traceSpans },
        });
      }

      return new Response(
        JSON.stringify({
          status: 'success',
          tracesReceived: result.traces.length,
        }),
        {
          headers: { 'Content-Type': 'application/json' },
        },
      );
    } else if (signal === 'logs') {
      const result = parseOTLPLogs(body);
      accepted('otlp', 'logs', encoding, result.logs.length);

      for (const log of result.logs) {
        await broadcastToRoom(env, roomId, {
          type: 'log_update',
          data: { log },
        });
      }

      return new Response(
        JSON.stringify({ status: 'success', logsReceived: result.logs.length }),
        {
          headers: { 'Content-Type': 'application/json' },
        },
      );
    } else if (signal === 'metrics') {
      const result = parseOTLPMetrics(body);
      accepted('otlp', 'metrics', encoding, result.metrics.length);

      for (const metric of result.metrics) {
        await broadcastToRoom(env, roomId, {
          type: 'metric_update',
          data: { metric },
        });
      }

      return new Response(
        JSON.stringify({
          status: 'success',
          metricsReceived: result.metrics.length,
        }),
        {
          headers: { 'Content-Type': 'application/json' },
        },
      );
    } else {
      // An exporter pointed at the wrong endpoint is the usual culprit. An
      // empty batch lands here too, so this stays a 400: retrying it would only
      // replay the same payload.
      Sentry.metrics.count(METRIC.INGEST_REJECTED, 1, {
        attributes: {
          surface: 'worker',
          protocol: 'otlp',
          reason: 'unknown_signal',
        },
      });
      Sentry.logger.warn('OTLP payload matched no known signal', {
        room: roomTag(roomId),
        encoding,
        content_type: request.headers.get('content-type') ?? 'none',
      });
      return new Response(JSON.stringify({ error: 'Invalid OTLP payload' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error: any) {
    // Refused on size rather than on content, so it gets the status that says
    // so. Not an OTLPDecodeError, and it has to be answered here rather than
    // fall through: the sender needs to learn its batch is too big, not read a
    // 500 and retry the same bytes forever.
    if (error instanceof PayloadTooLargeError) {
      console.error('[OTLP] Oversize body:', error.message);
      Sentry.metrics.count(METRIC.INGEST_REJECTED, 1, {
        attributes: {
          surface: 'worker',
          protocol: 'otlp',
          reason: 'too_large',
        },
      });
      Sentry.logger.warn('OTLP ingest rejected: oversize body', {
        room: roomTag(roomId),
        content_length: request.headers.get('content-length') ?? 'none',
        content_encoding: request.headers.get('content-encoding') ?? 'none',
      });
      return new Response(JSON.stringify({ error: error.message }), {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // A body we cannot decode is the sender's problem, and answering 500 makes
    // it ours: the exporter retries the same bytes on a backoff and each round
    // trip files another error report. 400 stops the loop at the source.
    if (error instanceof OTLPDecodeError) {
      console.error('[OTLP] Undecodable body:', error.message);
      Sentry.metrics.count(METRIC.INGEST_REJECTED, 1, {
        attributes: {
          surface: 'worker',
          protocol: 'otlp',
          reason: 'undecodable',
        },
      });
      Sentry.logger.warn('OTLP ingest rejected: undecodable body', {
        room: roomTag(roomId),
        error: error.message,
        content_type: request.headers.get('content-type') ?? 'none',
        user_agent: request.headers.get('user-agent') ?? 'unknown',
      });
      return new Response(
        JSON.stringify({ error: `Malformed OTLP payload: ${error.message}` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    console.error('[OTLP] Error:', error.message);
    Sentry.logger.error('OTLP ingest failed', {
      room: roomTag(roomId),
      error: error.message,
    });
    Sentry.captureException(error, { tags: { ingest: 'otlp' } });
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function handleWebSocket(
  request: Request,
  env: Env,
  roomId: string,
): Promise<Response> {
  console.log('[Worker] handleWebSocket called, roomId:', roomId);
  const doId = env.TELEMETRY_ROOM.idFromName(roomId);
  const room = env.TELEMETRY_ROOM.get(doId);
  return room.fetch(request);
}

async function broadcastToRoom(
  env: Env,
  roomId: string,
  data: any,
): Promise<void> {
  console.log(
    '[Worker] broadcastToRoom called, roomId:',
    roomId,
    'type:',
    data.type,
  );

  const doId = env.TELEMETRY_ROOM.idFromName(roomId);
  const room = env.TELEMETRY_ROOM.get(doId);

  console.log('[Worker] Sending to Durable Object...');
  const response = await room.fetch(
    new Request('http://internal/broadcast', {
      method: 'POST',
      body: JSON.stringify(data),
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  console.log('[Worker] Durable Object response:', response.status);

  if (!response.ok) {
    // Ingest already returned 200 to the SDK by this point, so a failure here
    // is invisible to the sender: data was accepted and then dropped.
    Sentry.logger.error('Broadcast to room failed', {
      room: roomTag(roomId),
      message_type: data.type,
      status: response.status,
    });
  }
}
