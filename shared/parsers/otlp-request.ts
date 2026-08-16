// Reading an OTLP request off the wire: decompression, encoding detection, and
// signal detection, before the per-signal parsers take over.
//
// Web-standard only (Request, ReadableStream, DecompressionStream), so the Cloudflare
// worker and the CLI's local ingest server share one path rather than growing
// two that drift.

import type {
  IExportTraceServiceRequest,
  IExportLogsServiceRequest,
  IExportMetricsServiceRequest,
} from './otlp-parser';
import {
  decodeTraceRequest,
  decodeLogsRequest,
  decodeMetricsRequest,
  detectOTLPSignal,
  type OTLPSignal,
} from './otlp-protobuf';
import { ProtoError } from './protobuf-reader';
import { PayloadDecodeError, PayloadTooLargeError } from './errors';

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
export class OTLPDecodeError extends PayloadDecodeError {
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

  let bytes: Uint8Array;
  try {
    bytes = await decompress(raw);
  } catch (error) {
    // Everything this can throw is about the bytes themselves: a corrupt
    // stream, or one that expands past the ceiling. The second already carries
    // the answer it wants, and relabelling it here is what used to turn an
    // oversize body into a 400.
    if (error instanceof PayloadTooLargeError) throw error;
    throw new OTLPDecodeError(decodeMessage(error), { cause: error });
  }

  try {
    return isJSON(request, bytes) ? readJSON(bytes) : readProtobuf(bytes);
  } catch (error) {
    // Only a malformed payload is the sender's fault. A bug of ours has to stay
    // a 500 with an exception attached, or answering 400 to everything hides it
    // the same way answering 500 to bad input used to hide theirs.
    if (error instanceof ProtoError || error instanceof SyntaxError) {
      throw new OTLPDecodeError(decodeMessage(error), { cause: error });
    }
    throw error;
  }
}

/**
 * A Sentry SDK carries the room ID as the DSN's public key, in the auth header
 * or the query string depending on transport.
 */
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

function decodeMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'undecodable OTLP body';
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
 * Ingest is unauthenticated and gzip amplifies past 1000:1, so a few hundred
 * kilobytes of crafted input would otherwise expand until the isolate hits its
 * memory limit. Real OTLP batches are a few megabytes at the very most, and the
 * ceiling has to be enforced while the stream is read: buffering first and
 * measuring afterwards commits the memory we are trying not to spend.
 *
 * Exported because a server that buffers a body before handing it here wants
 * the same number: reading in more than could ever survive decompression is
 * memory spent to reach a refusal that was already certain.
 */
export const MAX_PAYLOAD_BYTES = 16 * 1024 * 1024;

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

  // Fed through a stream rather than a Blob so this compiles against the
  // worker, Bun, and DOM type sets alike: BlobPart is not global in all three.
  const source = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });

  const reader = source
    .pipeThrough(new DecompressionStream(format))
    .getReader();

  const chunks: Uint8Array[] = [];
  let size = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    size += value.byteLength;
    if (size > MAX_PAYLOAD_BYTES) {
      await reader.cancel();
      throw new PayloadTooLargeError(
        `decompressed body exceeds ${MAX_PAYLOAD_BYTES} bytes`,
      );
    }
    chunks.push(value);
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
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
