// Standalone helpers for the worker: CORS and log redaction.
//
// Reading an OTLP request (decompression, encoding and signal detection) and
// pulling the room ID out of a Sentry auth header live in shared/parsers, so
// the CLI's local ingest server runs the exact same path.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, X-Sentry-Auth, sentry-trace, baggage',
};

/**
 * A room ID is the ingest credential: anyone holding it can write to the room.
 * Log only a short prefix, which is enough to correlate requests without
 * putting a working key into our own telemetry. Re-exported from the shared
 * module so the worker, the web app and the CLI cannot disagree about it.
 */
export { redactRoomId as roomTag } from '../../shared/observability';

export function handleCORS(): Response {
  return new Response(null, {
    status: 204,
    headers: { ...CORS_HEADERS, 'Access-Control-Max-Age': '86400' },
  });
}

export function corsResponse(response: Response): Response {
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    newHeaders.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
}
