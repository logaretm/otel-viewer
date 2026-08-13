// Standalone helpers for the worker: CORS, request-shape guards, auth parsing.

import type {
  IExportTraceServiceRequest,
  IExportLogsServiceRequest,
  IExportMetricsServiceRequest,
} from '../../shared/parsers';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, X-Sentry-Auth, sentry-trace, baggage',
};

/**
 * A room ID is the ingest credential: anyone holding it can write to the room.
 * Log only a short prefix, which is enough to correlate requests without
 * putting a working key into our own telemetry.
 */
export function roomTag(roomId: string): string {
  return `${roomId.slice(0, 4)}...`;
}

export function handleCORS(): Response {
  return new Response(null, {
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

export function extractRoomIdFromSentryAuth(request: Request): string | null {
  // Check X-Sentry-Auth header first
  const auth = request.headers.get('x-sentry-auth') || '';
  const headerMatch = auth.match(/sentry_key=([a-zA-Z0-9_-]+)/);
  if (headerMatch) {
    return headerMatch[1];
  }

  // Fall back to query string (sentry_key parameter)
  const url = new URL(request.url);
  const queryKey = url.searchParams.get('sentry_key');
  if (queryKey) {
    return queryKey;
  }

  return null;
}

export function isTraceRequest(
  body: Record<string, any>,
): body is IExportTraceServiceRequest {
  return Array.isArray(body.resourceSpans);
}

export function isLogsRequest(
  body: Record<string, any>,
): body is IExportLogsServiceRequest {
  return Array.isArray(body.resourceLogs);
}

export function isMetricsRequest(
  body: Record<string, any>,
): body is IExportMetricsServiceRequest {
  return Array.isArray(body.resourceMetrics);
}
