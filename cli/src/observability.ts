// The CLI reporting on itself.
//
// Two different things share the word "telemetry" here, and the split is the
// whole design. What your app sends to a room is your data: under --local it
// never leaves the machine, and under the relay it goes to your room and
// nowhere else. Neither ever appears in the events this file sends. What does
// travel is the CLI's own health, the way any installed program reports its own
// crashes, because a published binary nobody can debug is a binary that stays
// broken.
//
// So: errors and stacks from our code, counts of what happened, how long tools
// took. Never a payload, never an attribute value, never a room credential.

import * as Sentry from '@sentry/bun';
import {
  METRIC,
  redactUrl,
  failureReason,
  type Surface,
} from '../../shared/observability';

const SURFACE: Surface = 'cli';

// Injected at build time (see package.json). Empty in a source checkout, which
// leaves every call here inert rather than erroring.
declare const TELEY_CLI_SENTRY_DSN: string | undefined;

function dsn(): string {
  if (process.env.TELEY_CLI_SENTRY_DSN) return process.env.TELEY_CLI_SENTRY_DSN;
  return typeof TELEY_CLI_SENTRY_DSN === 'string' ? TELEY_CLI_SENTRY_DSN : '';
}

export type Mode = 'tui' | 'json' | 'mcp';
export type Transport = 'relay' | 'local';

let enabled = false;

export interface ObservabilityOptions {
  mode: Mode;
  transport: Transport;
  version: string;
}

export function initObservability({
  mode,
  transport,
  version,
}: ObservabilityOptions) {
  const address = dsn();
  if (!address) return;

  Sentry.init({
    dsn: address,
    environment: process.env.TELEY_ENV ?? 'production',
    release: `teley-cli@${version}`,
    // A session produces tens of spans (one per MCP tool call), not the
    // millions a server sees, so sampling them away would only leave gaps.
    tracesSampleRate: 1,

    // v11 collects broadly unless told otherwise, and in this app the things it
    // would collect by default are the user's: request bodies are the OTLP and
    // Sentry payloads themselves, query strings carry the receive token
    // (`?token=`) and the room ID (`?sentry_key=`), and the Sentry auth header
    // carries the room ID too. Every category is named here rather than left to
    // a default that a future SDK version may widen again.
    dataCollection: {
      userInfo: false,
      cookies: false,
      urlQueryParams: false,
      httpHeaders: {
        request: { deny: ['x-sentry-auth', 'authorization', 'cookie'] },
        response: false,
      },
      httpBodies: [],
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      graphQL: { document: false, variables: false },
    },

    // Console breadcrumbs would collect whatever the CLI prints, and in --json
    // mode what it prints is the user's telemetry.
    integrations: (defaults) =>
      defaults.filter((integration) => integration.name !== 'Console'),

    beforeSend(event) {
      scrubEvent(event);
      return event;
    },
  });

  Sentry.setTags({ mode, transport });
  Sentry.setContext('runtime', {
    bun: process.versions.bun ?? 'unknown',
    platform: process.platform,
    arch: process.arch,
  });

  enabled = true;

  count(METRIC.SESSION_STARTED, { mode, transport, version });

  // A CLI that dies without a word is the case this exists for. Report, flush,
  // then let the process go: swallowing the crash would be worse than the crash.
  process.on('uncaughtException', (error) => {
    void fatal(error, 'uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    void fatal(reason, 'unhandledRejection');
  });
}

async function fatal(error: unknown, kind: string) {
  Sentry.captureException(error, { tags: { fatal: kind } });
  await Sentry.flush(2000).catch(() => {});
  process.stderr.write(
    `teley: ${kind}: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
}

/**
 * URLs reach events through messages, stack frames and request data, and every
 * URL this CLI holds carries a room ID or a receive token.
 */
function scrubEvent(event: Sentry.ErrorEvent) {
  if (event.request?.url) event.request.url = redactUrl(event.request.url);
  if (event.message) event.message = redactUrl(event.message);

  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = redactUrl(exception.value);
    for (const frame of exception.stacktrace?.frames ?? []) {
      if (frame.filename) frame.filename = redactUrl(frame.filename);
    }
  }
}

export function count(
  name: string,
  attributes: Record<string, string | number | boolean> = {},
) {
  if (!enabled) return;
  Sentry.metrics.count(name, 1, {
    attributes: { surface: SURFACE, ...attributes },
  });
}

export function distribution(
  name: string,
  value: number,
  attributes: Record<string, string | number | boolean> = {},
  unit?: 'millisecond',
) {
  if (!enabled) return;
  Sentry.metrics.distribution(name, value, {
    unit,
    attributes: { surface: SURFACE, ...attributes },
  });
}

/**
 * Reports a failure that came from handling a payload. The error's text may
 * quote the payload itself (a JSON parse error names the token it choked on),
 * so only its shape travels: a reason the caller chose, and the error's class.
 */
export function reportPayloadFailure(
  metric: string,
  reason: string,
  error: unknown,
  attributes: Record<string, string | number | boolean> = {},
) {
  if (!enabled) return;
  count(metric, { reason, ...attributes });
  Sentry.logger.warn('Payload rejected', {
    surface: SURFACE,
    reason,
    error_type: failureReason(error),
    ...attributes,
  });
}

export const logger = {
  info(message: string, attributes?: Record<string, unknown>) {
    if (!enabled) return;
    Sentry.logger.info(message, { surface: SURFACE, ...attributes });
  },
  warn(message: string, attributes?: Record<string, unknown>) {
    if (!enabled) return;
    Sentry.logger.warn(message, { surface: SURFACE, ...attributes });
  },
  error(message: string, attributes?: Record<string, unknown>) {
    if (!enabled) return;
    Sentry.logger.error(message, { surface: SURFACE, ...attributes });
  },
};

export function captureException(
  error: unknown,
  tags: Record<string, string> = {},
) {
  if (!enabled) return;
  Sentry.captureException(error, { tags });
}

/** Wraps work in a span. Returns the callback's value untouched when disabled. */
export function span<T>(
  name: string,
  attributes: Record<string, string | number | boolean>,
  run: (
    setAttribute: (key: string, value: string | number | boolean) => void,
  ) => Promise<T>,
): Promise<T> {
  if (!enabled) return run(() => {});
  return Sentry.startSpan({ name, op: 'teley.tool', attributes }, (active) =>
    run((key, value) => active?.setAttribute(key, value)),
  );
}

export async function flush(timeout = 2000) {
  if (!enabled) return;
  await Sentry.flush(timeout).catch(() => {});
}

export { METRIC };
