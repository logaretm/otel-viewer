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
} from '../../shared/parsers';
import {
  handleCORS,
  corsResponse,
  extractRoomIdFromSentryAuth,
  isTraceRequest,
  isLogsRequest,
  isMetricsRequest,
  roomTag,
} from './util';

export { TelemetryRoom } from './durable-object';

const handler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    console.log('[Worker] Request:', request.method, url.pathname);

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

export default Sentry.withSentry(
  (env: Env) => ({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,
    release: env.CF_VERSION_METADATA?.id,
    enableLogs: true,
    tracesSampleRate: 0.1,
    // Telemetry sent to a room belongs to whoever is being debugged, so keep
    // request bodies and user info out of our own error reports.
    sendDefaultPii: false,
    dataCollection: {
      userInfo: false,
      httpBodies: [],
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
    console.error('[Sentry] Error:', error.message);
    Sentry.logger.error('Sentry envelope failed to parse', {
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
    const body = (await request.json()) as Record<string, any>;
    console.log('[Worker] OTLP body keys:', Object.keys(body));

    // Detect if this is traces or logs based on the payload
    if (isTraceRequest(body)) {
      // OTLP Traces
      const result = parseOTLPTrace(body);

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
    } else if (isLogsRequest(body)) {
      // OTLP Logs
      const result = parseOTLPLogs(body);

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
    } else if (isMetricsRequest(body)) {
      // OTLP Metrics
      const result = parseOTLPMetrics(body);

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
      // Signal names are the usual culprit: an exporter pointed at the wrong
      // endpoint, or a protobuf body we never decoded.
      Sentry.logger.warn('OTLP payload matched no known signal', {
        room: roomTag(roomId),
        body_keys: Object.keys(body).join(','),
        content_type: request.headers.get('content-type') ?? 'none',
      });
      return new Response(JSON.stringify({ error: 'Invalid OTLP payload' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  } catch (error: any) {
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
