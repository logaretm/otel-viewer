// OTLP/protobuf decoding.
// Reference: https://github.com/open-telemetry/opentelemetry-proto
//
// Most OTLP SDKs speak protobuf over HTTP by default, and several (Python among
// them) ship no JSON encoder at all, so an ingest that only reads JSON turns
// away the majority of exporters. Everything here decodes into the same shapes
// the OTLP/JSON payloads produce, so parseOTLPTrace and friends stay unaware of
// which encoding arrived: bytes become hex, uint64 becomes a decimal string,
// and field names become lowerCamelCase.

import type {
  IExportTraceServiceRequest,
  IExportLogsServiceRequest,
  IExportMetricsServiceRequest,
} from './otlp-parser';
import type { IKeyValue } from './helpers';
import { ProtoReader, WIRE, toHex, toBase64 } from './protobuf-reader';

type AnyValue = IKeyValue['value'];

type ResourceSpans = IExportTraceServiceRequest['resourceSpans'][number];
type ScopeSpans = NonNullable<ResourceSpans['scopeSpans']>[number];
type Span = ScopeSpans['spans'][number];
type SpanEvent = NonNullable<Span['events']>[number];
type SpanLink = NonNullable<Span['links']>[number];
type SpanStatus = NonNullable<Span['status']>;

type ResourceLogs = IExportLogsServiceRequest['resourceLogs'][number];
type ScopeLogs = NonNullable<ResourceLogs['scopeLogs']>[number];
type LogRecord = ScopeLogs['logRecords'][number];

type ResourceMetrics = IExportMetricsServiceRequest['resourceMetrics'][number];
type ScopeMetrics = NonNullable<ResourceMetrics['scopeMetrics']>[number];
type OTLPMetric = ScopeMetrics['metrics'][number];
type NumberDataPoint = NonNullable<OTLPMetric['gauge']>['dataPoints'][number];
type HistogramDataPoint = NonNullable<
  OTLPMetric['histogram']
>['dataPoints'][number];

type Resource = NonNullable<ResourceSpans['resource']>;
type InstrumentationScope = NonNullable<ScopeSpans['scope']>;

export type OTLPSignal = 'traces' | 'logs' | 'metrics';

// --- common.proto -----------------------------------------------------------

function decodeAnyValue(reader: ProtoReader): AnyValue {
  const value: AnyValue = {};
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    switch (field) {
      case 1:
        reader.expect(wire, WIRE.LENGTH);
        value.stringValue = reader.readString();
        break;
      case 2:
        reader.expect(wire, WIRE.VARINT);
        value.boolValue = reader.readBool();
        break;
      case 3:
        reader.expect(wire, WIRE.VARINT);
        value.intValue = BigInt.asIntN(64, reader.readVarint()).toString();
        break;
      case 4:
        reader.expect(wire, WIRE.FIXED64);
        value.doubleValue = reader.readDouble();
        break;
      case 5:
        reader.expect(wire, WIRE.LENGTH);
        value.arrayValue = { values: decodeArrayValue(reader.readMessage()) };
        break;
      case 6:
        reader.expect(wire, WIRE.LENGTH);
        value.kvlistValue = {
          values: decodeKeyValueList(reader.readMessage()),
        };
        break;
      case 7:
        reader.expect(wire, WIRE.LENGTH);
        value.bytesValue = toBase64(reader.readBytes());
        break;
      default:
        reader.skip(wire);
    }
  }
  return value;
}

function decodeArrayValue(reader: ProtoReader): AnyValue[] {
  const values: AnyValue[] = [];
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    if (field === 1) {
      reader.expect(wire, WIRE.LENGTH);
      values.push(decodeAnyValue(reader.readMessage()));
    } else {
      reader.skip(wire);
    }
  }
  return values;
}

function decodeKeyValueList(reader: ProtoReader): IKeyValue[] {
  const values: IKeyValue[] = [];
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    if (field === 1) {
      reader.expect(wire, WIRE.LENGTH);
      values.push(decodeKeyValue(reader.readMessage()));
    } else {
      reader.skip(wire);
    }
  }
  return values;
}

function decodeKeyValue(reader: ProtoReader): IKeyValue {
  let key = '';
  let value: AnyValue = {};
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    switch (field) {
      case 1:
        reader.expect(wire, WIRE.LENGTH);
        key = reader.readString();
        break;
      case 2:
        reader.expect(wire, WIRE.LENGTH);
        value = decodeAnyValue(reader.readMessage());
        break;
      default:
        reader.skip(wire);
    }
  }
  return { key, value };
}

function decodeResource(reader: ProtoReader): Resource {
  const attributes: IKeyValue[] = [];
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    if (field === 1) {
      reader.expect(wire, WIRE.LENGTH);
      attributes.push(decodeKeyValue(reader.readMessage()));
    } else {
      reader.skip(wire);
    }
  }
  return { attributes };
}

function decodeScope(reader: ProtoReader): InstrumentationScope {
  const scope: InstrumentationScope = { attributes: [] };
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    switch (field) {
      case 1:
        reader.expect(wire, WIRE.LENGTH);
        scope.name = reader.readString();
        break;
      case 2:
        reader.expect(wire, WIRE.LENGTH);
        scope.version = reader.readString();
        break;
      case 3:
        reader.expect(wire, WIRE.LENGTH);
        scope.attributes!.push(decodeKeyValue(reader.readMessage()));
        break;
      default:
        reader.skip(wire);
    }
  }
  return scope;
}

// --- trace.proto ------------------------------------------------------------

export function decodeTraceRequest(
  bytes: Uint8Array,
): IExportTraceServiceRequest {
  const reader = new ProtoReader(bytes);
  const resourceSpans: ResourceSpans[] = [];
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    if (field === 1) {
      reader.expect(wire, WIRE.LENGTH);
      resourceSpans.push(decodeResourceSpans(reader.readMessage()));
    } else {
      reader.skip(wire);
    }
  }
  return { resourceSpans };
}

function decodeResourceSpans(reader: ProtoReader): ResourceSpans {
  const out: ResourceSpans = { scopeSpans: [] };
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    switch (field) {
      case 1:
        reader.expect(wire, WIRE.LENGTH);
        out.resource = decodeResource(reader.readMessage());
        break;
      case 2:
        reader.expect(wire, WIRE.LENGTH);
        out.scopeSpans!.push(decodeScopeSpans(reader.readMessage()));
        break;
      case 3:
        reader.expect(wire, WIRE.LENGTH);
        out.schemaUrl = reader.readString();
        break;
      default:
        reader.skip(wire);
    }
  }
  return out;
}

function decodeScopeSpans(reader: ProtoReader): ScopeSpans {
  const out: ScopeSpans = { spans: [] };
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    switch (field) {
      case 1:
        reader.expect(wire, WIRE.LENGTH);
        out.scope = decodeScope(reader.readMessage());
        break;
      case 2:
        reader.expect(wire, WIRE.LENGTH);
        out.spans.push(decodeSpan(reader.readMessage()));
        break;
      case 3:
        reader.expect(wire, WIRE.LENGTH);
        out.schemaUrl = reader.readString();
        break;
      default:
        reader.skip(wire);
    }
  }
  return out;
}

function decodeSpan(reader: ProtoReader): Span {
  const span: Span = {
    traceId: '',
    spanId: '',
    name: '',
    kind: 0,
    startTimeUnixNano: '0',
    endTimeUnixNano: '0',
    attributes: [],
    events: [],
    links: [],
  };
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    switch (field) {
      case 1:
        reader.expect(wire, WIRE.LENGTH);
        span.traceId = toHex(reader.readBytes());
        break;
      case 2:
        reader.expect(wire, WIRE.LENGTH);
        span.spanId = toHex(reader.readBytes());
        break;
      case 3:
        reader.expect(wire, WIRE.LENGTH);
        span.traceState = reader.readString();
        break;
      case 4:
        reader.expect(wire, WIRE.LENGTH);
        span.parentSpanId = toHex(reader.readBytes());
        break;
      case 5:
        reader.expect(wire, WIRE.LENGTH);
        span.name = reader.readString();
        break;
      case 6:
        reader.expect(wire, WIRE.VARINT);
        span.kind = reader.readVarintAsNumber();
        break;
      case 7:
        reader.expect(wire, WIRE.FIXED64);
        span.startTimeUnixNano = reader.readFixed64().toString();
        break;
      case 8:
        reader.expect(wire, WIRE.FIXED64);
        span.endTimeUnixNano = reader.readFixed64().toString();
        break;
      case 9:
        reader.expect(wire, WIRE.LENGTH);
        span.attributes!.push(decodeKeyValue(reader.readMessage()));
        break;
      case 11:
        reader.expect(wire, WIRE.LENGTH);
        span.events!.push(decodeSpanEvent(reader.readMessage()));
        break;
      case 13:
        reader.expect(wire, WIRE.LENGTH);
        span.links!.push(decodeSpanLink(reader.readMessage()));
        break;
      case 15:
        reader.expect(wire, WIRE.LENGTH);
        span.status = decodeStatus(reader.readMessage());
        break;
      default:
        reader.skip(wire);
    }
  }
  return span;
}

function decodeSpanEvent(reader: ProtoReader): SpanEvent {
  const event: SpanEvent = {
    timeUnixNano: '0',
    name: '',
    attributes: [],
  };
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    switch (field) {
      case 1:
        reader.expect(wire, WIRE.FIXED64);
        event.timeUnixNano = reader.readFixed64().toString();
        break;
      case 2:
        reader.expect(wire, WIRE.LENGTH);
        event.name = reader.readString();
        break;
      case 3:
        reader.expect(wire, WIRE.LENGTH);
        event.attributes!.push(decodeKeyValue(reader.readMessage()));
        break;
      default:
        reader.skip(wire);
    }
  }
  return event;
}

function decodeSpanLink(reader: ProtoReader): SpanLink {
  const link: SpanLink = { traceId: '', spanId: '', attributes: [] };
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    switch (field) {
      case 1:
        reader.expect(wire, WIRE.LENGTH);
        link.traceId = toHex(reader.readBytes());
        break;
      case 2:
        reader.expect(wire, WIRE.LENGTH);
        link.spanId = toHex(reader.readBytes());
        break;
      case 3:
        reader.expect(wire, WIRE.LENGTH);
        link.traceState = reader.readString();
        break;
      case 4:
        reader.expect(wire, WIRE.LENGTH);
        link.attributes!.push(decodeKeyValue(reader.readMessage()));
        break;
      default:
        reader.skip(wire);
    }
  }
  return link;
}

function decodeStatus(reader: ProtoReader): SpanStatus {
  const status: SpanStatus = {};
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    switch (field) {
      case 2:
        reader.expect(wire, WIRE.LENGTH);
        status.message = reader.readString();
        break;
      case 3:
        reader.expect(wire, WIRE.VARINT);
        status.code = reader.readVarintAsNumber();
        break;
      default:
        reader.skip(wire);
    }
  }
  return status;
}

// --- logs.proto -------------------------------------------------------------

export function decodeLogsRequest(
  bytes: Uint8Array,
): IExportLogsServiceRequest {
  const reader = new ProtoReader(bytes);
  const resourceLogs: ResourceLogs[] = [];
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    if (field === 1) {
      reader.expect(wire, WIRE.LENGTH);
      resourceLogs.push(decodeResourceLogs(reader.readMessage()));
    } else {
      reader.skip(wire);
    }
  }
  return { resourceLogs };
}

function decodeResourceLogs(reader: ProtoReader): ResourceLogs {
  const out: ResourceLogs = { scopeLogs: [] };
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    switch (field) {
      case 1:
        reader.expect(wire, WIRE.LENGTH);
        out.resource = decodeResource(reader.readMessage());
        break;
      case 2:
        reader.expect(wire, WIRE.LENGTH);
        out.scopeLogs!.push(decodeScopeLogs(reader.readMessage()));
        break;
      case 3:
        reader.expect(wire, WIRE.LENGTH);
        out.schemaUrl = reader.readString();
        break;
      default:
        reader.skip(wire);
    }
  }
  return out;
}

function decodeScopeLogs(reader: ProtoReader): ScopeLogs {
  const out: ScopeLogs = { logRecords: [] };
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    switch (field) {
      case 1:
        reader.expect(wire, WIRE.LENGTH);
        out.scope = decodeScope(reader.readMessage());
        break;
      case 2:
        reader.expect(wire, WIRE.LENGTH);
        out.logRecords.push(decodeLogRecord(reader.readMessage()));
        break;
      case 3:
        reader.expect(wire, WIRE.LENGTH);
        out.schemaUrl = reader.readString();
        break;
      default:
        reader.skip(wire);
    }
  }
  return out;
}

function decodeLogRecord(reader: ProtoReader): LogRecord {
  const record: LogRecord = { timeUnixNano: '0', attributes: [] };
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    switch (field) {
      case 1:
        reader.expect(wire, WIRE.FIXED64);
        record.timeUnixNano = reader.readFixed64().toString();
        break;
      case 2:
        reader.expect(wire, WIRE.VARINT);
        record.severityNumber = reader.readVarintAsNumber();
        break;
      case 3:
        reader.expect(wire, WIRE.LENGTH);
        record.severityText = reader.readString();
        break;
      case 5:
        reader.expect(wire, WIRE.LENGTH);
        record.body = decodeAnyValue(reader.readMessage());
        break;
      case 6:
        reader.expect(wire, WIRE.LENGTH);
        record.attributes!.push(decodeKeyValue(reader.readMessage()));
        break;
      case 9:
        reader.expect(wire, WIRE.LENGTH);
        record.traceId = toHex(reader.readBytes());
        break;
      case 10:
        reader.expect(wire, WIRE.LENGTH);
        record.spanId = toHex(reader.readBytes());
        break;
      case 11:
        reader.expect(wire, WIRE.FIXED64);
        record.observedTimeUnixNano = reader.readFixed64().toString();
        break;
      default:
        reader.skip(wire);
    }
  }
  // A record that only carries observed_time still has a usable timestamp, and
  // falling back to it beats charting the log at the epoch.
  if (record.timeUnixNano === '0' && record.observedTimeUnixNano) {
    record.timeUnixNano = record.observedTimeUnixNano;
  }
  return record;
}

// --- metrics.proto ----------------------------------------------------------

export function decodeMetricsRequest(
  bytes: Uint8Array,
): IExportMetricsServiceRequest {
  const reader = new ProtoReader(bytes);
  const resourceMetrics: ResourceMetrics[] = [];
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    if (field === 1) {
      reader.expect(wire, WIRE.LENGTH);
      resourceMetrics.push(decodeResourceMetrics(reader.readMessage()));
    } else {
      reader.skip(wire);
    }
  }
  return { resourceMetrics };
}

function decodeResourceMetrics(reader: ProtoReader): ResourceMetrics {
  const out: ResourceMetrics = { scopeMetrics: [] };
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    switch (field) {
      case 1:
        reader.expect(wire, WIRE.LENGTH);
        out.resource = decodeResource(reader.readMessage());
        break;
      case 2:
        reader.expect(wire, WIRE.LENGTH);
        out.scopeMetrics!.push(decodeScopeMetrics(reader.readMessage()));
        break;
      case 3:
        reader.expect(wire, WIRE.LENGTH);
        out.schemaUrl = reader.readString();
        break;
      default:
        reader.skip(wire);
    }
  }
  return out;
}

function decodeScopeMetrics(reader: ProtoReader): ScopeMetrics {
  const out: ScopeMetrics = { metrics: [] };
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    switch (field) {
      case 1:
        reader.expect(wire, WIRE.LENGTH);
        out.scope = decodeScope(reader.readMessage());
        break;
      case 2:
        reader.expect(wire, WIRE.LENGTH);
        out.metrics.push(decodeMetric(reader.readMessage()));
        break;
      case 3:
        reader.expect(wire, WIRE.LENGTH);
        out.schemaUrl = reader.readString();
        break;
      default:
        reader.skip(wire);
    }
  }
  return out;
}

function decodeMetric(reader: ProtoReader): OTLPMetric {
  const metric: OTLPMetric = { name: '' };
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    switch (field) {
      case 1:
        reader.expect(wire, WIRE.LENGTH);
        metric.name = reader.readString();
        break;
      case 2:
        reader.expect(wire, WIRE.LENGTH);
        metric.description = reader.readString();
        break;
      case 3:
        reader.expect(wire, WIRE.LENGTH);
        metric.unit = reader.readString();
        break;
      case 5:
        reader.expect(wire, WIRE.LENGTH);
        metric.gauge = {
          dataPoints: decodeNumberDataPoints(reader.readMessage()),
        };
        break;
      case 7: {
        reader.expect(wire, WIRE.LENGTH);
        metric.sum = decodeSum(reader.readMessage());
        break;
      }
      case 9:
        reader.expect(wire, WIRE.LENGTH);
        metric.histogram = decodeHistogram(reader.readMessage());
        break;
      default:
        // Exponential histograms and summaries have no representation in the
        // dashboard yet, so they are dropped rather than half-rendered.
        reader.skip(wire);
    }
  }
  return metric;
}

function decodeNumberDataPoints(reader: ProtoReader): NumberDataPoint[] {
  const dataPoints: NumberDataPoint[] = [];
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    if (field === 1) {
      reader.expect(wire, WIRE.LENGTH);
      dataPoints.push(decodeNumberDataPoint(reader.readMessage()));
    } else {
      reader.skip(wire);
    }
  }
  return dataPoints;
}

function decodeSum(reader: ProtoReader): NonNullable<OTLPMetric['sum']> {
  const sum: NonNullable<OTLPMetric['sum']> = { dataPoints: [] };
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    switch (field) {
      case 1:
        reader.expect(wire, WIRE.LENGTH);
        sum.dataPoints.push(decodeNumberDataPoint(reader.readMessage()));
        break;
      case 2:
        reader.expect(wire, WIRE.VARINT);
        sum.aggregationTemporality = reader.readVarintAsNumber();
        break;
      case 3:
        reader.expect(wire, WIRE.VARINT);
        sum.isMonotonic = reader.readBool();
        break;
      default:
        reader.skip(wire);
    }
  }
  return sum;
}

function decodeHistogram(
  reader: ProtoReader,
): NonNullable<OTLPMetric['histogram']> {
  const histogram: NonNullable<OTLPMetric['histogram']> = { dataPoints: [] };
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    switch (field) {
      case 1:
        reader.expect(wire, WIRE.LENGTH);
        histogram.dataPoints.push(
          decodeHistogramDataPoint(reader.readMessage()),
        );
        break;
      case 2:
        reader.expect(wire, WIRE.VARINT);
        histogram.aggregationTemporality = reader.readVarintAsNumber();
        break;
      default:
        reader.skip(wire);
    }
  }
  return histogram;
}

function decodeNumberDataPoint(reader: ProtoReader): NumberDataPoint {
  const point: NumberDataPoint = { timeUnixNano: '0', attributes: [] };
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    switch (field) {
      case 2:
        reader.expect(wire, WIRE.FIXED64);
        point.startTimeUnixNano = reader.readFixed64().toString();
        break;
      case 3:
        reader.expect(wire, WIRE.FIXED64);
        point.timeUnixNano = reader.readFixed64().toString();
        break;
      case 4:
        reader.expect(wire, WIRE.FIXED64);
        point.asDouble = reader.readDouble();
        break;
      case 6:
        reader.expect(wire, WIRE.FIXED64);
        point.asInt = reader.readSFixed64().toString();
        break;
      case 7:
        reader.expect(wire, WIRE.LENGTH);
        point.attributes!.push(decodeKeyValue(reader.readMessage()));
        break;
      default:
        reader.skip(wire);
    }
  }
  return point;
}

function decodeHistogramDataPoint(reader: ProtoReader): HistogramDataPoint {
  const point: HistogramDataPoint = {
    timeUnixNano: '0',
    count: '0',
    bucketCounts: [],
    explicitBounds: [],
    attributes: [],
  };
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    switch (field) {
      case 2:
        reader.expect(wire, WIRE.FIXED64);
        point.startTimeUnixNano = reader.readFixed64().toString();
        break;
      case 3:
        reader.expect(wire, WIRE.FIXED64);
        point.timeUnixNano = reader.readFixed64().toString();
        break;
      case 4:
        reader.expect(wire, WIRE.FIXED64);
        point.count = reader.readFixed64().toString();
        break;
      case 5:
        reader.expect(wire, WIRE.FIXED64);
        point.sum = reader.readDouble();
        break;
      case 6:
        point.bucketCounts.push(
          ...reader
            .readPacked(wire, WIRE.FIXED64, (r) => r.readFixed64())
            .map((count) => count.toString()),
        );
        break;
      case 7:
        point.explicitBounds.push(
          ...reader.readPacked(wire, WIRE.FIXED64, (r) => r.readDouble()),
        );
        break;
      case 9:
        reader.expect(wire, WIRE.LENGTH);
        point.attributes!.push(decodeKeyValue(reader.readMessage()));
        break;
      case 11:
        reader.expect(wire, WIRE.FIXED64);
        point.min = reader.readDouble();
        break;
      case 12:
        reader.expect(wire, WIRE.FIXED64);
        point.max = reader.readDouble();
        break;
      default:
        reader.skip(wire);
    }
  }
  return point;
}

// --- signal detection -------------------------------------------------------

/**
 * OTLP's three export requests are indistinguishable down to the leaf: each one
 * puts its repeated resource list at field 1, the scope list at field 2, and the
 * records at field 2 again. OTLP/JSON gets to key off `resourceSpans` versus
 * `resourceLogs`; protobuf has no names on the wire, and Teley accepts all three
 * signals on the same `/r/{roomId}` path, so the record itself is the only thing
 * left to read.
 *
 * The markers below are each unique to one message. A Span is the only record
 * with a fixed64 at field 7 or 8 (start/end time), a varint at 6 (kind) or 12
 * (dropped_events_count), or bytes at 4 (parent_span_id). A LogRecord is the
 * only one with a fixed64 at 1 or 11 (time, observed_time), a varint at 2
 * (severity_number) or 7 (dropped_attributes_count), or a fixed32 at 8 (flags).
 * A Metric names itself with a string at 1 and carries one data field at 5, 7 or
 * 9 through 11.
 *
 * Every branch asks for a marker it owns, and none of them is a fallback. Proto3
 * omits every field left at its zero value, so a record can arrive carrying none
 * of these: a LogRecord holding only a body and attributes is legal and looks
 * like nothing in particular. Treating "not a span and not a log" as a metric
 * would read that body as a gauge and store the result, so an unreadable record
 * returns null and ingest answers 400 instead.
 */
export function detectOTLPSignal(bytes: Uint8Array): OTLPSignal | null {
  const record = findFirstRecord(new ProtoReader(bytes));
  if (!record) return null;

  const tags = new Set<number>();
  while (!record.done) {
    const { field, wire } = record.readTag();
    tags.add(field * 8 + wire);
    record.skip(wire);
  }

  const has = (field: number, wire: number) => tags.has(field * 8 + wire);

  if (
    has(7, WIRE.FIXED64) ||
    has(8, WIRE.FIXED64) ||
    has(6, WIRE.VARINT) ||
    has(12, WIRE.VARINT) ||
    has(4, WIRE.LENGTH)
  ) {
    return 'traces';
  }

  if (
    has(1, WIRE.FIXED64) ||
    has(11, WIRE.FIXED64) ||
    has(2, WIRE.VARINT) ||
    has(7, WIRE.VARINT) ||
    has(8, WIRE.FIXED32)
  ) {
    return 'logs';
  }

  // Exponential histograms and summaries (10, 11) count as metric markers even
  // though nothing downstream renders them yet. They decode to zero data points
  // and get dropped on a 200, which is where an unsupported metric type belongs:
  // calling it unreadable instead would answer 400 and leave the exporter
  // retrying a batch that will never parse any differently.
  if (
    has(1, WIRE.LENGTH) &&
    (has(5, WIRE.LENGTH) ||
      has(7, WIRE.LENGTH) ||
      has(9, WIRE.LENGTH) ||
      has(10, WIRE.LENGTH) ||
      has(11, WIRE.LENGTH))
  ) {
    return 'metrics';
  }

  return null;
}

/**
 * Descends resource list -> scope list -> record list and returns a reader over
 * the first record found, or null when the batch carries no records at all.
 */
function findFirstRecord(reader: ProtoReader): ProtoReader | null {
  while (!reader.done) {
    const { field, wire } = reader.readTag();
    if (field !== 1 || wire !== WIRE.LENGTH) {
      reader.skip(wire);
      continue;
    }
    const resource = reader.readMessage();
    while (!resource.done) {
      const scopeTag = resource.readTag();
      if (scopeTag.field !== 2 || scopeTag.wire !== WIRE.LENGTH) {
        resource.skip(scopeTag.wire);
        continue;
      }
      const scope = resource.readMessage();
      while (!scope.done) {
        const recordTag = scope.readTag();
        if (recordTag.field !== 2 || recordTag.wire !== WIRE.LENGTH) {
          scope.skip(recordTag.wire);
          continue;
        }
        return scope.readMessage();
      }
    }
  }
  return null;
}
