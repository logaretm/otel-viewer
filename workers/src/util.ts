// Standalone helpers for the worker: CORS, request-shape guards, auth parsing.

import type {
  IExportTraceServiceRequest,
  IExportLogsServiceRequest,
  IExportMetricsServiceRequest,
  OTLPSignal,
} from '../../shared/parsers';
import {
  decodeTraceRequest,
  decodeLogsRequest,
  decodeMetricsRequest,
  detectOTLPSignal,
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

export type OTLPEncoding = 'json' | 'protobuf';

export type OTLPRequest =
  | {
      encoding: OTLPEncoding;
      signal: 'traces';
      body: IExportTraceServiceRequest;
    }
  | { encoding: OTLPEncoding; signal: 'logs'; body: IExportLogsServiceRequest }
  | {
      encoding: OTLPEncoding;
      signal: 'metrics';
      body: IExportMetricsServiceRequest;
    }
  | { encoding: OTLPEncoding; signal: null; body: null };

/**
 * Thrown when a body cannot be decoded at all. Kept distinct from the errors we
 * raise ourselves so ingest can answer a bad payload with a 400 instead of a
 * 500: an exporter that retries a 500 will resend the same undecodable bytes
 * forever, and every attempt costs us another error report.
 */
export class OTLPDecodeError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'OTLPDecodeError';
  }
}

/**
 * Reads an OTLP request in whichever encoding it arrived in and reports which
 * signal it carries. A null signal means the payload decoded but held no records
 * we recognise, which is a client mistake rather than a server fault.
 */
export async function readOTLPRequest(request: Request): Promise<OTLPRequest> {
  const raw = new Uint8Array(await request.arrayBuffer());

  try {
    const bytes = await decompress(raw);
    return isJSON(request, bytes) ? readJSON(bytes) : readProtobuf(bytes);
  } catch (error) {
    throw new OTLPDecodeError(
      error instanceof Error ? error.message : 'undecodable OTLP body',
      { cause: error },
    );
  }
}

/**
 * Content-Type decides, but only when it says something we recognise: exporters
 * do send protobuf under a bare `application/octet-stream`, and getting this
 * wrong used to mean a 500. The body itself is the tiebreaker, since a JSON
 * payload can only start with `{`.
 */
function isJSON(request: Request, bytes: Uint8Array): boolean {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.includes('protobuf')) return false;
  if (contentType.includes('json')) return true;

  let i = 0;
  while (i < bytes.length && bytes[i] <= 0x20) i++;
  return bytes[i] === 0x7b; // '{'
}

function readJSON(bytes: Uint8Array): OTLPRequest {
  const body = JSON.parse(new TextDecoder().decode(bytes)) as Record<
    string,
    any
  >;

  if (isTraceRequest(body)) return { encoding: 'json', signal: 'traces', body };
  if (isLogsRequest(body)) return { encoding: 'json', signal: 'logs', body };
  if (isMetricsRequest(body)) {
    return { encoding: 'json', signal: 'metrics', body };
  }
  return { encoding: 'json', signal: null, body: null };
}

function readProtobuf(bytes: Uint8Array): OTLPRequest {
  const signal: OTLPSignal | null = detectOTLPSignal(bytes);

  switch (signal) {
    case 'traces':
      return {
        encoding: 'protobuf',
        signal,
        body: decodeTraceRequest(bytes),
      };
    case 'logs':
      return { encoding: 'protobuf', signal, body: decodeLogsRequest(bytes) };
    case 'metrics':
      return {
        encoding: 'protobuf',
        signal,
        body: decodeMetricsRequest(bytes),
      };
    default:
      return { encoding: 'protobuf', signal: null, body: null };
  }
}

/**
 * Sniffs the compression rather than trusting Content-Encoding, because the
 * header survives whatever the edge did to the body: a runtime that already
 * decompressed the request leaves the header in place, and an exporter that
 * compressed without announcing it leaves the header off. The magic bytes are
 * the only thing that describes the bytes we actually hold, and neither prefix
 * can begin a valid OTLP payload.
 */
async function decompress(bytes: Uint8Array): Promise<Uint8Array> {
  const format = compressionFormat(bytes);
  if (!format) return bytes;

  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function compressionFormat(bytes: Uint8Array): 'gzip' | 'deflate' | null {
  if (bytes.length < 2) return null;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return 'gzip';
  // zlib: low nibble 8 marks deflate, and the two-byte header is a multiple of
  // 31. Protobuf would need field 15 as a varint to collide, and OTLP has none.
  if ((bytes[0] & 0x0f) === 0x08 && ((bytes[0] << 8) | bytes[1]) % 31 === 0) {
    return 'deflate';
  }
  return null;
}
