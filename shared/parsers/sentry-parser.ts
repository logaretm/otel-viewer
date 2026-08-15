// Sentry Envelope Parser
// Reference: https://develop.sentry.dev/sdk/envelopes/

import { PayloadDecodeError } from './errors';

export interface SentryEnvelopeHeaders {
  event_id?: string;
  sent_at?: string;
  sdk?: {
    name: string;
    version: string;
  };
  trace?: {
    trace_id: string;
    public_key?: string;
  };
}

export type SentryItemType =
  | 'event'
  | 'transaction'
  | 'span'
  | 'log'
  | 'attachment'
  | 'session'
  | 'client_report'
  | 'trace_metric';

export interface SentryItemHeaders {
  type: SentryItemType;
  length?: number;
  content_type?: string;
  filename?: string;
  // Present on span v2 (streamed span) container items. The payload then holds
  // an `items` array of standalone spans rather than a single span.
  item_count?: number;
}

export interface SentryEnvelopeItem {
  headers: SentryItemHeaders;
  payload: any;
}

export interface SentryEnvelope {
  headers: SentryEnvelopeHeaders;
  items: SentryEnvelopeItem[];
}

/**
 * Parse Sentry envelope format (newline-delimited JSON)
 * Format:
 * {envelope_headers}\n
 * {item_headers}\n
 * {item_payload}\n
 * {item_headers}\n
 * {item_payload}\n
 */
export function parseSentryEnvelope(raw: string): SentryEnvelope {
  const lines = raw.split('\n').filter((line) => line.trim());

  if (lines.length < 2) {
    throw new PayloadDecodeError('Invalid envelope: too few lines');
  }

  // First line: envelope headers
  let headers: SentryEnvelopeHeaders;
  try {
    headers = JSON.parse(lines[0]!);
  } catch {
    throw new PayloadDecodeError('Invalid envelope: failed to parse headers');
  }

  // Remaining lines: item headers + payloads in pairs
  const items: SentryEnvelopeItem[] = [];
  for (let i = 1; i < lines.length; i += 2) {
    try {
      const itemHeaders = JSON.parse(lines[i]!) as SentryItemHeaders;

      // Next line is payload (might be JSON or binary)
      let itemPayload: any = null;
      if (i + 1 < lines.length) {
        const payloadLine = lines[i + 1]!;

        // Try to parse as JSON, otherwise treat as raw data
        try {
          itemPayload = JSON.parse(payloadLine);
        } catch {
          // If not JSON, keep as raw string (for attachments, etc.)
          itemPayload = payloadLine;
        }
      }

      items.push({
        headers: itemHeaders,
        payload: itemPayload,
      });
    } catch (error) {
      console.error('[Sentry Parser] Failed to parse item:', error);
      // Continue to next item
    }
  }

  return { headers, items };
}

/**
 * Parse DSN format: protocol://public_key@host/project_id
 * Example: http://abc123@localhost:3000/api/v1/sentry
 */
export function parseSentryDSN(dsn: string) {
  try {
    const url = new URL(dsn);

    return {
      protocol: url.protocol.replace(':', ''),
      publicKey: url.username,
      host: url.host,
      projectId: url.pathname.replace(/^\//, ''),
    };
  } catch {
    throw new Error(`Invalid Sentry DSN: ${dsn}`);
  }
}
