// Static mock telemetry for --demo mode (and for iterating on the UI).

import type {
  TraceEntry,
  Span,
  Log,
  Metric,
  MetricType,
  TraceSource,
} from './types';

let seq = 0;

interface SpanSpec {
  id: string; // local handle used for parent references
  parent: string | null;
  name: string;
  kind: number; // OTLP: 1=Internal 2=Server 3=Client 4=Producer 5=Consumer
  start: number;
  duration: number;
  service: string; // used only to derive the trace's service_name from the root
  status?: number; // 2 = error
  attributes?: Record<string, unknown>;
}

function buildTrace(source: TraceSource, specs: SpanSpec[]): TraceEntry {
  const traceId = `trace${(++seq).toString().padStart(2, '0')}`;
  const idMap = new Map<string, string>();
  for (const s of specs) idMap.set(s.id, `${traceId}-${s.id}`);

  const spans: Span[] = specs.map((s) => ({
    span_id: idMap.get(s.id)!,
    trace_id: traceId,
    parent_span_id: s.parent ? idMap.get(s.parent)! : null,
    name: s.name,
    kind: s.kind,
    start_time: s.start,
    end_time: s.start + s.duration,
    duration: s.duration,
    status_code: s.status ?? 0,
    status_message: s.status === 2 ? 'connection reset by peer' : null,
    attributes: s.attributes ?? {},
    events: [],
    links: [],
  }));

  const root = specs[0]!;
  return {
    trace: {
      trace_id: traceId,
      service_name: root.service,
      operation_name: root.name,
      start_time: spans[0]!.start_time,
      end_time: spans[0]!.end_time,
      duration: spans[0]!.duration,
      status_code: spans[0]!.status_code,
      status_message: spans[0]!.status_message,
      source,
    },
    spans,
  };
}

export const MOCK_TRACES: TraceEntry[] = [
  // Failed checkout — an error trace with a deep client call chain
  buildTrace('SENTRY', [
    {
      id: 'root',
      parent: null,
      name: 'POST /checkout',
      kind: 2,
      start: 0,
      duration: 318,
      service: 'api-gateway',
      status: 2,
      attributes: {
        'http.method': 'POST',
        'http.route': '/checkout',
        'http.status_code': 500,
      },
    },
    {
      id: 'validate',
      parent: 'root',
      name: 'validate.cart',
      kind: 1,
      start: 2,
      duration: 8,
      service: 'api-gateway',
      attributes: { 'cart.items': 3 },
    },
    {
      id: 'user',
      parent: 'root',
      name: 'GET user-service',
      kind: 3,
      start: 12,
      duration: 46,
      service: 'api-gateway',
    },
    {
      id: 'userdb',
      parent: 'user',
      name: 'db.query users',
      kind: 3,
      start: 20,
      duration: 30,
      service: 'user-service',
      attributes: {
        'db.system': 'postgresql',
        'db.statement': 'SELECT * FROM users WHERE id = $1',
      },
    },
    {
      id: 'pay',
      parent: 'root',
      name: 'POST payment-service',
      kind: 3,
      start: 62,
      duration: 240,
      service: 'api-gateway',
      status: 2,
    },
    {
      id: 'stripe',
      parent: 'pay',
      name: 'stripe.charge',
      kind: 3,
      start: 70,
      duration: 224,
      service: 'payment-service',
      status: 2,
      // Intentionally attribute-heavy so the span detail panel overflows and
      // demonstrates scrolling (PageUp/PageDown or mouse wheel).
      attributes: {
        'peer.service': 'stripe',
        error: true,
        'http.method': 'POST',
        'http.url': 'https://api.stripe.com/v1/charges',
        'http.status_code': 402,
        'http.request_content_length': 512,
        'http.response_content_length': 1180,
        'net.peer.name': 'api.stripe.com',
        'net.peer.port': 443,
        'net.transport': 'ip_tcp',
        'stripe.request_id': 'req_9d8f7a6b5c4d3e2f',
        'stripe.charge_id': 'ch_3Pqf2k2eZvKYlo2C1a2b3c4d',
        'stripe.customer_id': 'cus_QabcDEFghiJKLm',
        'stripe.amount': 4999,
        'stripe.currency': 'usd',
        'stripe.payment_method': 'pm_1Pqf2k2eZvKYlo2C',
        'stripe.idempotency_key': 'ik_checkout_4821_7f3a',
        'retry.count': 3,
        'error.type': 'card_declined',
        'error.code': 'insufficient_funds',
        'error.message': 'Your card has insufficient funds.',
        'exception.type': 'stripe.error.CardError',
        'exception.message': 'connection reset by peer after 224ms',
      },
    },
    {
      id: 'idem',
      parent: 'root',
      name: 'cache.set idempotency',
      kind: 3,
      start: 306,
      duration: 6,
      service: 'payment-service',
    },
  ]),

  // Healthy user fetch
  buildTrace('OTLP', [
    {
      id: 'root',
      parent: null,
      name: 'GET /api/users',
      kind: 2,
      start: 0,
      duration: 41,
      service: 'api-gateway',
      attributes: {
        'http.method': 'GET',
        'http.route': '/api/users',
        'http.status_code': 200,
      },
    },
    {
      id: 'auth',
      parent: 'root',
      name: 'auth.verify',
      kind: 1,
      start: 1,
      duration: 5,
      service: 'api-gateway',
    },
    {
      id: 'user',
      parent: 'root',
      name: 'GET user-service',
      kind: 3,
      start: 7,
      duration: 30,
      service: 'api-gateway',
    },
    {
      id: 'userdb',
      parent: 'user',
      name: 'db.query users',
      kind: 3,
      start: 12,
      duration: 18,
      service: 'user-service',
      attributes: { 'db.system': 'postgresql' },
    },
  ]),

  // Background job consumer
  buildTrace('OTLP', [
    {
      id: 'root',
      parent: null,
      name: 'process.order.queue',
      kind: 5,
      start: 0,
      duration: 156,
      service: 'worker',
      attributes: { 'messaging.system': 'sqs' },
    },
    {
      id: 'db',
      parent: 'root',
      name: 'db.query orders',
      kind: 3,
      start: 4,
      duration: 40,
      service: 'worker',
      attributes: { 'db.system': 'postgresql' },
    },
    {
      id: 'render',
      parent: 'root',
      name: 'render.invoice',
      kind: 1,
      start: 48,
      duration: 60,
      service: 'worker',
    },
    {
      id: 'email',
      parent: 'root',
      name: 'POST email-service',
      kind: 3,
      start: 110,
      duration: 42,
      service: 'worker',
    },
  ]),
];

interface LogSpec {
  ago: number; // seconds before "now" the log was emitted
  severity: number; // OTLP severity number
  service: string;
  body: string;
  trace_id?: string;
  span_id?: string;
  attributes?: Record<string, unknown>;
}

const LOG_SPECS: LogSpec[] = [
  {
    ago: 42,
    severity: 9,
    service: 'api-gateway',
    body: 'GET /api/users 200 41ms',
    attributes: { 'http.method': 'GET', 'http.status_code': 200 },
  },
  {
    ago: 38,
    severity: 5,
    service: 'user-service',
    body: 'cache hit for user:4821',
    attributes: { 'cache.key': 'user:4821' },
  },
  {
    ago: 30,
    severity: 13,
    service: 'payment-service',
    body: 'stripe latency above threshold (224ms)',
    attributes: { 'peer.service': 'stripe', threshold_ms: 200 },
  },
  {
    ago: 24,
    severity: 9,
    service: 'worker',
    body: 'processed order queue batch of 12',
    attributes: { 'messaging.system': 'sqs', batch: 12 },
  },
  {
    ago: 18,
    severity: 17,
    service: 'payment-service',
    // Long, wrapping body plus many attributes so the log detail panel overflows
    // and demonstrates scrolling (PageUp/PageDown or mouse wheel).
    body:
      'stripe.charge failed: connection reset by peer after 224ms. ' +
      'CardError: Your card has insufficient funds (code: insufficient_funds). ' +
      'Traceback (most recent call last):\n' +
      '  File "payment_service/gateway.py", line 142, in charge\n' +
      '    response = stripe.Charge.create(amount=amount, currency=currency, source=token)\n' +
      '  File "stripe/api_resources/charge.py", line 58, in create\n' +
      '    return cls._static_request("post", url, params=params)\n' +
      '  File "stripe/api_requestor.py", line 216, in request\n' +
      '    raise error.CardError(msg, code, http_status=resp.status)\n' +
      'stripe.error.CardError: Your card has insufficient funds.',
    trace_id: 'trace01',
    span_id: 'trace01-stripe',
    attributes: {
      'peer.service': 'stripe',
      'http.method': 'POST',
      'http.url': 'https://api.stripe.com/v1/charges',
      'http.status_code': 402,
      'stripe.request_id': 'req_9d8f7a6b5c4d3e2f',
      'stripe.charge_id': 'ch_3Pqf2k2eZvKYlo2C1a2b3c4d',
      'stripe.customer_id': 'cus_QabcDEFghiJKLm',
      'error.type': 'card_declined',
      'error.code': 'insufficient_funds',
      'retry.count': 3,
      error: true,
    },
  },
  {
    ago: 12,
    severity: 17,
    service: 'api-gateway',
    body: 'POST /checkout 500 318ms',
    trace_id: 'trace01',
    span_id: 'trace01-root',
    attributes: { 'http.method': 'POST', 'http.status_code': 500 },
  },
  {
    ago: 6,
    severity: 13,
    service: 'user-service',
    body: 'slow query: SELECT * FROM users WHERE id = $1 (30ms)',
    attributes: { 'db.system': 'postgresql' },
  },
  {
    ago: 2,
    severity: 9,
    service: 'worker',
    body: 'invoice rendered and emailed',
    attributes: { 'messaging.system': 'sqs' },
  },
];

// Built lazily so timestamps are relative to launch, not module load.
export function buildMockLogs(): Log[] {
  const now = Date.now();
  return LOG_SPECS.map((s, i) => ({
    log_id: `log${(i + 1).toString().padStart(2, '0')}`,
    timestamp: now - s.ago * 1000,
    trace_id: s.trace_id ?? null,
    span_id: s.span_id ?? null,
    severity_number: s.severity,
    severity_text: null,
    body: s.body,
    service_name: s.service,
    attributes: s.attributes ?? {},
  }));
}

// Metric series for --demo. Values are deterministic functions of the sample
// index rather than random, so the demo renders the same chart every run and a
// screenshot of it stays reproducible.

const SAMPLES = 60;
const SAMPLE_MS = 5_000;

interface MetricSpec {
  name: string;
  type: MetricType;
  unit: string | null;
  description: string | null;
  service: string;
  source?: TraceSource;
  attributes?: Record<string, unknown>;
  // Sampled once per point. Omitted for histograms, which carry buckets.
  value?: (i: number) => number;
  histogram?: { bounds: number[]; counts: number[] };
}

const METRIC_SPECS: MetricSpec[] = [
  {
    name: 'http.server.request.duration',
    type: 'histogram',
    unit: 'ms',
    description: 'Duration of inbound HTTP requests',
    service: 'checkout-api',
    histogram: {
      bounds: [5, 10, 25, 50, 100, 250, 500, 1000],
      counts: [3, 14, 61, 128, 96, 41, 12, 4, 1],
    },
  },
  {
    name: 'http.server.active_requests',
    type: 'gauge',
    unit: '{request}',
    description: 'Requests currently in flight',
    service: 'checkout-api',
    value: (i) => 18 + Math.sin(i / 5) * 11 + Math.sin(i / 1.7) * 3,
  },
  {
    name: 'checkout.orders.completed',
    type: 'counter',
    unit: '{order}',
    description: 'Orders that reached the confirmation page',
    service: 'checkout-api',
    value: (i) => 1240 + i * 7 + Math.floor(Math.sin(i / 4) * 5),
  },
  {
    name: 'db.client.connections.usage',
    type: 'gauge',
    unit: '{connection}',
    description: 'Connections checked out of the pool',
    service: 'checkout-api',
    attributes: { 'db.pool.name': 'primary', 'db.system': 'postgresql' },
    value: (i) => 9 + Math.sin(i / 7) * 4,
  },
  {
    name: 'db.client.connections.usage',
    type: 'gauge',
    unit: '{connection}',
    description: 'Connections checked out of the pool',
    service: 'checkout-api',
    attributes: { 'db.pool.name': 'replica', 'db.system': 'postgresql' },
    value: (i) => 22 + Math.sin(i / 3.2) * 9,
  },
  {
    name: 'process.runtime.memory.heap',
    type: 'gauge',
    unit: 'By',
    description: 'Resident heap size',
    service: 'worker',
    // Sawtooth: climbs, then drops on collection.
    value: (i) => 48_000_000 + (i % 14) * 3_100_000,
  },
  {
    name: 'payments.declined',
    type: 'counter',
    unit: '{payment}',
    description: null,
    service: 'payments',
    source: 'SENTRY',
    value: (i) => 6 + Math.floor(i / 9),
  },
];

// Built lazily so timestamps are relative to launch, not module load.
export function buildMockMetrics(): Metric[] {
  const now = Date.now();
  const metrics: Metric[] = [];

  for (const [specIndex, spec] of METRIC_SPECS.entries()) {
    // A histogram is a cumulative snapshot, so the demo emits a handful rather
    // than one per sample: only the newest is ever charted.
    const points = spec.histogram ? 8 : SAMPLES;

    for (let i = 0; i < points; i++) {
      const age =
        (points - 1 - i) * (spec.histogram ? SAMPLE_MS * 8 : SAMPLE_MS);
      const timestamp = now - age;
      let histogram: Metric['histogram'] = null;

      if (spec.histogram) {
        // Counts accumulate as the snapshot ages forward.
        const scale = (i + 1) / points;
        const buckets = spec.histogram.counts.map((count, b) => ({
          bound: spec.histogram!.bounds[b] ?? Infinity,
          count: Math.round(count * scale),
        }));
        const count = buckets.reduce((sum, b) => sum + b.count, 0);
        histogram = {
          buckets,
          sum: count * 96,
          count,
          min: 2.4,
          max: 1840,
        };
      }

      metrics.push({
        metric_id: `metric${specIndex}-${i}`,
        name: spec.name,
        description: spec.description,
        unit: spec.unit,
        type: spec.type,
        service_name: spec.service,
        timestamp,
        value: spec.value ? Number(spec.value(i).toFixed(2)) : null,
        histogram,
        set_values: null,
        attributes: spec.attributes ?? {},
        source: spec.source ?? 'OTLP',
      });
    }
  }

  return metrics;
}
