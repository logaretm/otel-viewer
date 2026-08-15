// Convert Sentry data formats to OTLP
// This allows Sentry SDK data to be stored and displayed in our OTLP viewer

import type { SentryEnvelope } from './sentry-parser';
import type { MetricType } from './types';
import {
  parseOTLPTrace,
  parseOTLPLogs,
  type ParsedTrace,
  type ParsedSpan,
  type ParsedLog,
  type ParsedMetric,
} from './otlp-parser';
import {
  generateTraceId,
  generateSpanId,
  generateMetricId,
  toEpochMs,
} from './helpers';

export interface SentryConversionResult {
  traces: ParsedTrace[];
  spans: ParsedSpan[];
  logs: ParsedLog[];
  metrics: ParsedMetric[];
}

/**
 * Process a Sentry envelope and convert items to OTLP format
 */
export function processSentryEnvelope(
  envelope: SentryEnvelope,
): SentryConversionResult {
  const result: SentryConversionResult = {
    traces: [],
    spans: [],
    logs: [],
    metrics: [],
  };

  for (const item of envelope.items) {
    const itemType = item.headers.type;
    console.log('[Sentry] Processing item type:', itemType);

    try {
      switch (itemType) {
        case 'transaction': {
          // Sentry transaction -> OTLP trace
          const parsed = convertSentryTransaction(item.payload);
          result.traces.push(...parsed.traces);
          result.spans.push(...parsed.spans);
          break;
        }

        case 'event': {
          // Sentry error event -> OTLP log
          const parsed = convertSentryEvent(item.payload);
          result.logs.push(...parsed.logs);
          break;
        }

        case 'log': {
          // Sentry log item -> OTLP log
          console.log('[Sentry] Log payload:', JSON.stringify(item.payload));
          const parsed = convertSentryLog(item.payload);
          result.logs.push(...parsed.logs);
          break;
        }

        case 'trace_metric': {
          // Sentry v10+ trace_metric format
          const parsed = convertSentryTraceMetrics(item.payload);
          result.metrics.push(...parsed);
          break;
        }

        case 'span': {
          // Sentry sends two shapes under `type: "span"`:
          //  - v2 streamed spans: a container `{ version: 2, items: [...] }`,
          //    tagged with content_type `application/vnd.sentry.items.span.v2+json`.
          //  - v1 standalone spans: a single SpanJSON (same shape as a span
          //    embedded in a transaction).
          const isV2 =
            (typeof item.headers.content_type === 'string' &&
              item.headers.content_type.includes('span.v2')) ||
            (item.payload &&
              item.payload.version === 2 &&
              Array.isArray(item.payload.items));

          const parsed = isV2
            ? convertStreamedSpans(item.payload)
            : convertStandaloneSpan(item.payload);
          result.traces.push(...parsed.traces);
          result.spans.push(...parsed.spans);
          break;
        }

        case 'session':
        case 'client_report':
        case 'attachment':
          // Not supported
          break;
      }
    } catch (error: any) {
      console.error(`[Sentry] Error processing ${itemType}:`, error.message);
    }
  }

  return result;
}

/**
 * Convert Sentry transaction to OTLP trace
 */
function convertSentryTransaction(transaction: any): {
  traces: ParsedTrace[];
  spans: ParsedSpan[];
} {
  const traceId = transaction.contexts?.trace?.trace_id || generateTraceId();
  const spanId = transaction.contexts?.trace?.span_id || generateSpanId();

  const serviceName = resolveServiceName(transaction);
  const startTime = toEpochMs(transaction.start_timestamp) ?? Date.now();
  const endTime = toEpochMs(transaction.timestamp) ?? Date.now();

  // Convert transaction to OTLP root span
  const rootSpan = {
    traceId: traceId,
    spanId: spanId,
    name:
      transaction.transaction ||
      transaction.spans?.[0]?.description ||
      'unknown',
    kind: mapSentrySpanKind(transaction.contexts?.trace?.op),
    startTimeUnixNano: String(startTime * 1_000_000),
    endTimeUnixNano: String(endTime * 1_000_000),
    attributes: convertAttributes({
      'sentry.transaction': transaction.transaction,
      'sentry.op': transaction.contexts?.trace?.op,
      'sentry.status': transaction.contexts?.trace?.status,
      ...transaction.tags,
    }),
    status: {
      code: mapSentryStatus(transaction.contexts?.trace?.status),
      message: transaction.contexts?.trace?.status,
    },
  };

  // Convert child spans
  const childSpans = (transaction.spans || []).map((sentrySpan: any) => {
    const spanStartTime = toEpochMs(sentrySpan.start_timestamp) ?? startTime;
    const spanEndTime = toEpochMs(sentrySpan.timestamp) ?? endTime;

    return {
      traceId: traceId,
      spanId: sentrySpan.span_id || generateSpanId(),
      parentSpanId: sentrySpan.parent_span_id || spanId,
      name: sentrySpan.description || sentrySpan.op || 'span',
      kind: mapSentrySpanKind(sentrySpan.op),
      startTimeUnixNano: String(spanStartTime * 1_000_000),
      endTimeUnixNano: String(spanEndTime * 1_000_000),
      attributes: convertAttributes({
        'sentry.op': sentrySpan.op,
        'sentry.status': sentrySpan.status,
        ...sentrySpan.tags,
        ...sentrySpan.data,
      }),
      status: {
        code: mapSentryStatus(sentrySpan.status),
        message: sentrySpan.status,
      },
    };
  });

  // Build OTLP trace structure
  const otlpTrace = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: serviceName } },
          ],
        },
        scopeSpans: [
          {
            spans: [rootSpan, ...childSpans],
          },
        ],
      },
    ],
  };

  // Process via OTLP parser, marking as SENTRY source
  return parseOTLPTrace(otlpTrace, 'SENTRY');
}

/**
 * Convert a Sentry span v2 streamed-span container to OTLP traces/spans.
 *
 * Payload shape: `{ version: 2, ingest_settings?, items: StreamedSpan[] }`.
 * Each streamed span is OTLP-aligned: `name` (not `description`),
 * `start_timestamp` + `end_timestamp` (not `timestamp`), `status: "ok" | "error"`,
 * and a typed `attributes` map (`{ value, type }`) instead of a flat `data` object.
 * Spans stream one flush at a time, so a trace is assembled incrementally by the
 * client/CLI as more spans for the same trace_id arrive.
 */
function convertStreamedSpans(payload: any): {
  traces: ParsedTrace[];
  spans: ParsedSpan[];
} {
  const items: any[] = Array.isArray(payload?.items) ? payload.items : [];
  if (items.length === 0) return { traces: [], spans: [] };

  const serviceName = String(
    readTypedAttr(items[0]?.attributes, 'service.name') ??
      readTypedAttr(items[0]?.attributes, 'sentry.sdk.name') ??
      'sentry-app',
  );

  const otlpSpans = items.map((span) => streamedSpanToOtlp(span));

  const otlpTrace = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: serviceName } },
          ],
        },
        scopeSpans: [{ spans: otlpSpans }],
      },
    ],
  };

  return parseOTLPTrace(otlpTrace, 'SENTRY');
}

/**
 * Convert a single Sentry v2 streamed span to an OTLP span.
 */
function streamedSpanToOtlp(span: any) {
  const startTime = toEpochMs(span.start_timestamp) ?? Date.now();
  const endTime = toEpochMs(span.end_timestamp) ?? startTime;

  const op = readTypedAttr(span.attributes, 'sentry.op');

  return {
    traceId: span.trace_id,
    spanId: span.span_id,
    parentSpanId: span.parent_span_id || undefined,
    name: span.name || (typeof op === 'string' ? op : 'span'),
    kind: mapSentrySpanKind(typeof op === 'string' ? op : undefined),
    startTimeUnixNano: String(startTime * 1_000_000),
    endTimeUnixNano: String(endTime * 1_000_000),
    attributes: convertTypedAttributes(span.attributes),
    status: {
      code: mapSentryStatus(span.status),
      message: span.status,
    },
    links: Array.isArray(span.links)
      ? span.links.map((link: any) => ({
          traceId: link.trace_id,
          spanId: link.span_id,
          attributes: convertTypedAttributes(link.attributes),
        }))
      : undefined,
  };
}

/**
 * Convert a Sentry v1 standalone span (single SpanJSON) to an OTLP trace/span.
 * Same payload shape as a span embedded in a transaction: `description`, `op`,
 * `data`, `start_timestamp`, `timestamp`.
 */
function convertStandaloneSpan(span: any): {
  traces: ParsedTrace[];
  spans: ParsedSpan[];
} {
  if (!span || (!span.span_id && !span.trace_id))
    return { traces: [], spans: [] };

  const startTime = toEpochMs(span.start_timestamp) ?? Date.now();
  const endTime = toEpochMs(span.timestamp) ?? startTime;
  const serviceName = resolveServiceName(span);

  const otlpSpan = {
    traceId: span.trace_id,
    spanId: span.span_id,
    parentSpanId: span.parent_span_id || undefined,
    name: span.description || span.op || 'span',
    kind: mapSentrySpanKind(span.op),
    startTimeUnixNano: String(startTime * 1_000_000),
    endTimeUnixNano: String(endTime * 1_000_000),
    attributes: convertAttributes({
      'sentry.op': span.op,
      'sentry.status': span.status,
      ...span.tags,
      ...span.data,
    }),
    status: {
      code: mapSentryStatus(span.status),
      message: span.status,
    },
  };

  const otlpTrace = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: serviceName } },
          ],
        },
        scopeSpans: [{ spans: [otlpSpan] }],
      },
    ],
  };

  return parseOTLPTrace(otlpTrace, 'SENTRY');
}

/**
 * Convert Sentry error event to OTLP log
 */
function convertSentryEvent(event: any): { logs: ParsedLog[] } {
  const timestamp = toEpochMs(event.timestamp) ?? Date.now();
  const serviceName = resolveServiceName(event);

  // Determine severity from Sentry level
  const severityMap: Record<string, number> = {
    fatal: 21,
    error: 17,
    warning: 13,
    info: 9,
    debug: 5,
  };
  const severityNumber = severityMap[event.level] || 9; // Default to INFO

  // Build log message from exception or message
  let body = event.message || '';
  if (event.exception?.values?.length > 0) {
    const ex = event.exception.values[0];
    body = `${ex.type}: ${ex.value}`;

    // Add stacktrace if available
    if (ex.stacktrace?.frames?.length > 0) {
      body += '\n\nStack trace:\n';
      ex.stacktrace.frames.forEach((frame: any) => {
        body += `  at ${frame.function} (${frame.filename}:${frame.lineno})\n`;
      });
    }
  }

  // Create OTLP log record
  const logRecord = {
    timeUnixNano: String(timestamp * 1_000_000),
    severityNumber: severityNumber,
    severityText: event.level?.toUpperCase(),
    body: {
      stringValue: body,
    },
    attributes: convertAttributes({
      'sentry.event_id': event.event_id,
      'sentry.platform': event.platform,
      'sentry.environment': event.environment,
      'sentry.release': event.release,
      ...event.tags,
      ...event.user,
    }),
    traceId: event.contexts?.trace?.trace_id,
    spanId: event.contexts?.trace?.span_id,
  };

  const otlpLogs = {
    resourceLogs: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: serviceName } },
          ],
        },
        scopeLogs: [
          {
            logRecords: [logRecord],
          },
        ],
      },
    ],
  };

  // Process via OTLP parser
  return parseOTLPLogs(otlpLogs);
}

/**
 * Convert Sentry log item to OTLP log
 */
function convertSentryLog(logItem: any): { logs: ParsedLog[] } {
  // Sentry log items can contain multiple log records in an "items" array
  const items = logItem.items || [logItem];
  const logs: ParsedLog[] = [];

  for (const log of items) {
    const timestamp = toEpochMs(log.timestamp) ?? Date.now();

    // Map Sentry log level to OTLP severity
    const severityMap: Record<string, number> = {
      trace: 1,
      debug: 5,
      info: 9,
      warn: 13,
      warning: 13,
      error: 17,
      fatal: 21,
    };
    const level = log.level || log.severity || 'info';
    const severityNumber = severityMap[level.toLowerCase()] || 9;

    const logRecord = {
      timeUnixNano: String(timestamp * 1_000_000),
      severityNumber: severityNumber,
      severityText: level.toUpperCase(),
      body: {
        stringValue: log.message || log.body || '',
      },
      attributes: convertAttributes({
        ...log.attributes,
        ...log.data,
      }),
      traceId: log.trace_id,
      spanId: log.span_id,
    };

    const otlpLogs = {
      resourceLogs: [
        {
          resource: {
            attributes: [
              {
                key: 'service.name',
                value: { stringValue: log.service || 'sentry-app' },
              },
            ],
          },
          scopeLogs: [
            {
              logRecords: [logRecord],
            },
          ],
        },
      ],
    };

    const parsed = parseOTLPLogs(otlpLogs);
    logs.push(...parsed.logs);
  }

  return { logs };
}

/**
 * Pick a service name for a Sentry event.
 *
 * `sdk.name` is the SDK identifier, not the app, so leaning on it alone
 * collapses every Go service into a single "sentry.go" entry. Prefer an
 * explicit `service.name` tag, then the host the SDK reported.
 */
function resolveServiceName(event: any): string {
  return (
    event.tags?.['service.name'] ||
    event.data?.['service.name'] ||
    event.server_name ||
    event.sdk?.name ||
    'sentry-app'
  );
}

/**
 * Map a Sentry span status to an OTLP status code.
 *
 * Sentry omits the status entirely when it was never set (the Go SDK tags it
 * `omitempty`, so manually created spans arrive without one). That absence is
 * UNSET, not an error, and collapsing it to ERROR paints every span red.
 */
function mapSentryStatus(status?: string): number {
  if (!status || status === 'unknown') return 0; // UNSET
  return status === 'ok' ? 1 : 2; // OK : ERROR
}

/**
 * Map Sentry operation to OTLP span kind.
 *
 * Values are the OTLP wire numbering (1=Internal, 2=Server, 3=Client), matching
 * what the OTLP parser stores, so both sources render the same way.
 */
function mapSentrySpanKind(op?: string): number {
  if (!op) return 1; // INTERNAL

  if (op.startsWith('http.server')) return 2; // SERVER
  if (op.startsWith('http.client')) return 3; // CLIENT
  if (op.includes('request') || op.includes('fetch')) return 3; // CLIENT
  if (op.includes('db') || op.includes('query')) return 3; // CLIENT

  return 1; // INTERNAL
}

/**
 * Convert Sentry tags/data to OTLP attributes format
 */
function convertAttributes(data: Record<string, any>) {
  return Object.entries(data)
    .filter(([_, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ({
      key,
      value: {
        stringValue:
          typeof value === 'object' ? JSON.stringify(value) : String(value),
      },
    }));
}

/**
 * Read a value out of a Sentry v2 typed-attribute map (`{ key: { value, type } }`),
 * tolerating a plain value if the attribute isn't wrapped.
 */
function readTypedAttr(
  attrs: Record<string, any> | undefined,
  key: string,
): any {
  const entry = attrs?.[key];
  if (entry == null) return undefined;
  return typeof entry === 'object' && 'value' in entry ? entry.value : entry;
}

/**
 * Convert a Sentry v2 typed-attribute map to OTLP KeyValue attributes,
 * preserving the declared type (string/boolean/integer/double).
 */
function convertTypedAttributes(attrs: Record<string, any> | undefined) {
  if (!attrs || typeof attrs !== 'object') return [];

  const out: Array<{ key: string; value: Record<string, any> }> = [];
  for (const [key, entry] of Object.entries(attrs)) {
    if (entry == null) continue;

    const isWrapped = typeof entry === 'object' && 'value' in entry;
    const raw = isWrapped ? (entry as any).value : entry;
    const type = isWrapped ? (entry as any).type : undefined;
    if (raw === undefined || raw === null) continue;

    let value: Record<string, any>;
    switch (type) {
      case 'boolean':
        value = { boolValue: Boolean(raw) };
        break;
      case 'integer':
        value = { intValue: Number(raw) };
        break;
      case 'double':
        value = { doubleValue: Number(raw) };
        break;
      case 'string':
        value = { stringValue: String(raw) };
        break;
      default:
        if (typeof raw === 'boolean') value = { boolValue: raw };
        else if (typeof raw === 'number')
          value = Number.isInteger(raw)
            ? { intValue: raw }
            : { doubleValue: raw };
        else
          value = {
            stringValue:
              typeof raw === 'object' ? JSON.stringify(raw) : String(raw),
          };
    }

    out.push({ key, value });
  }
  return out;
}

/**
 * Convert Sentry v10+ trace_metric items to metrics
 * Format: { items: [{ timestamp, trace_id, span_id, name, type, unit, value, attributes }] }
 */
function convertSentryTraceMetrics(payload: any): ParsedMetric[] {
  if (!payload || typeof payload !== 'object') return [];

  const items = payload.items || [payload];
  const metrics: ParsedMetric[] = [];

  for (const item of items) {
    try {
      const timestamp = toEpochMs(item.timestamp) ?? Date.now();

      const typeMap: Record<string, MetricType> = {
        counter: 'counter',
        gauge: 'gauge',
        distribution: 'histogram',
      };
      const metricType = typeMap[item.type] || 'gauge';

      // Unwrap Sentry v10 attribute format: { value: "...", type: "string" } -> plain values
      const rawAttrs = item.attributes || {};
      const attributes: Record<string, any> = {};
      for (const [key, val] of Object.entries(rawAttrs)) {
        attributes[key] =
          val && typeof val === 'object' && 'value' in val
            ? (val as any).value
            : val;
      }
      if (item.trace_id) attributes['trace_id'] = item.trace_id;
      if (item.span_id) attributes['span_id'] = item.span_id;

      const serviceName = String(
        attributes['service.name'] ||
          attributes['sentry.sdk.name'] ||
          'sentry-app',
      );

      if (metricType === 'histogram') {
        const value = Number(item.value) || 0;
        metrics.push({
          metric_id: generateMetricId(timestamp),
          name: item.name,
          description: null,
          unit: item.unit || null,
          type: 'histogram',
          service_name: serviceName,
          timestamp,
          value: null,
          histogram: {
            buckets: [],
            sum: value,
            count: 1,
            min: value,
            max: value,
          },
          set_values: null,
          attributes,
          source: 'SENTRY',
        });
      } else {
        metrics.push({
          metric_id: generateMetricId(timestamp),
          name: item.name,
          description: null,
          unit: item.unit || null,
          type: metricType,
          service_name: serviceName,
          timestamp,
          value: Number(item.value) || 0,
          histogram: null,
          set_values: null,
          attributes,
          source: 'SENTRY',
        });
      }
    } catch (error: any) {
      console.error('[Sentry] Error parsing trace_metric:', error.message);
    }
  }

  return metrics;
}
