// Barrel export for shared parsers

// Types
export * from './types';

// Helpers
export {
  hexToString,
  nanoToMs,
  parseAttributes,
  getAttributeValue,
  generateTraceId,
  generateSpanId,
  generateEventId,
  generateLogId,
  generateMetricId,
  type IKeyValue,
} from './helpers';

// Sentry parser
export {
  parseSentryEnvelope,
  parseSentryDSN,
  type SentryEnvelope,
  type SentryEnvelopeHeaders,
  type SentryEnvelopeItem,
  type SentryItemHeaders,
  type SentryItemType,
} from './sentry-parser';

// Trace summary helper
export { summarizeTrace } from './trace-summary';

// OTLP parser
export {
  parseOTLPTrace,
  parseOTLPLogs,
  parseOTLPMetrics,
  type IExportTraceServiceRequest,
  type IExportLogsServiceRequest,
  type IExportMetricsServiceRequest,
  type ParsedTrace,
  type ParsedSpan,
  type ParsedLog,
  type ParsedMetric,
  type ParsedTraceResult,
  type ParsedLogsResult,
  type ParsedMetricsResult,
} from './otlp-parser';

// OTLP protobuf decoding
export { ProtoError } from './protobuf-reader';
export {
  decodeTraceRequest,
  decodeLogsRequest,
  decodeMetricsRequest,
  detectOTLPSignal,
  type OTLPSignal,
} from './otlp-protobuf';

// Whose fault a decode failure is
export { PayloadDecodeError, PayloadTooLargeError } from './errors';

// Reading an OTLP request off the wire (shared by the worker and the CLI's
// local ingest server)
export {
  readOTLPRequest,
  extractRoomIdFromSentryAuth,
  OTLPDecodeError,
  MAX_PAYLOAD_BYTES,
  isTraceRequest,
  isLogsRequest,
  isMetricsRequest,
  type OTLPRequest,
  type OTLPEncoding,
} from './otlp-request';

// Sentry to OTLP converter
export {
  processSentryEnvelope,
  type SentryConversionResult,
} from './sentry-to-otlp';
