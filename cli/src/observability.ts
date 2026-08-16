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

import * as Sentry from '@sentry/node';
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
    // The SDK defaults serverName to os.hostname(), which on a laptop is
    // usually its owner's name. Nothing here is per-machine.
    serverName: 'cli',
    // Neither SDK names the runtime correctly on its own: the bun build calls
    // everything bun, and this one calls everything node, because bun answers
    // process.versions.node with the version it emulates. Asking which one is
    // actually here is the only way to get it right, and it is the difference
    // between a crash that reproduces and one that does not. It goes here
    // rather than in setContext because the client stamps this option over
    // whatever the scope carries.
    runtime: {
      name: process.versions.bun ? 'bun' : 'node',
      version: process.versions.bun ?? process.versions.node,
    },
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

    // Named rather than subtracted. The default set is forty-odd integrations
    // for frameworks, databases and AI providers a terminal viewer will never
    // load, and several of the ones that do apply are actively wrong here, so
    // the list below is everything that ships and the block under it is why the
    // notable absences are absent.
    defaultIntegrations: false,
    integrations: [
      // What makes a reported crash readable.
      Sentry.eventFiltersIntegration(), // drops the noise Sentry knows about
      Sentry.linkedErrorsIntegration(), // `cause` chains, which the parsers throw
      Sentry.contextLinesIntegration(), // source lines around each frame
      Sentry.functionToStringIntegration(),
      // Which release is crashing, and what it resolved its dependencies to.
      Sentry.processSessionIntegration(),
      Sentry.modulesIntegration(),
      // The clipboard shells out (pbcopy and friends), and a spawn that fails
      // on a machine without it is otherwise invisible.
      Sentry.childProcessIntegration(),
    ],
    //
    // Deliberately absent:
    //
    // Console      breadcrumbs would collect whatever the CLI prints, and in
    //              --json mode what it prints is the user's telemetry.
    // Http         names spans after the request path, which under --local is
    //              `POST /r/{roomId}`: the CLI wants spans for its own tools,
    //              not transactions for an ingest server it never queries. The
    //              outgoing half it also covers has nothing to instrument,
    //              since the relay is a WebSocket and Sentry's own transport is
    //              excluded anyway.
    // RequestData  attaches request data to events, and the requests here are
    //              the user's payloads.
    // LocalVariablesAsync
    //              puts locals in the stack trace, and the locals in the
    //              ingest path hold the decoded payload.
    // Context      brings os and runtime, which are wanted, along with boot
    //              time, CPU model, memory size, locale and timezone, which
    //              fingerprint the machine. Runtime is the option above, and
    //              os and arch are set on the scope after init.
    // OnUncaughtException, OnUnhandledRejection
    //              initObservability registers its own handlers, which also
    //              flush and give the terminal back. Both sets would fire.

    beforeSend(event) {
      scrubEvent(event);
      return event;
    },
  });

  // The coarse half of what the Context integration would have sent.
  Sentry.setContext('os', { name: process.platform });
  Sentry.setContext('device', { arch: process.arch });

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

// Whoever owns the terminal registers how to give it back. Without this the
// TUI's alt-screen and hidden cursor survive the exit, and the user needs
// `reset` to get a usable shell again.
let restoreTerminal: (() => void) | null = null;

export function onFatal(teardown: () => void) {
  restoreTerminal = teardown;
}

async function fatal(error: unknown, kind: string) {
  Sentry.captureException(error, { tags: { fatal: kind } });
  await Sentry.flush(2000).catch(() => {});

  // Restore the terminal before writing, or the message lands on a screen the
  // user is about to lose.
  try {
    restoreTerminal?.();
  } catch {
    // A failing teardown must not swallow the crash it was meant to survive.
  }

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
