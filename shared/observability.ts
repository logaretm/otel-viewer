// How Teley watches itself.
//
// This is about the app's own health, never about the telemetry it carries.
// A room's traces and logs belong to whoever is being debugged: they are the
// payload, and they never appear in our own events, in any surface, including
// the CLI's --local mode where they never leave the machine at all.
//
// Three surfaces report here (the worker, the web app, the CLI), so the names
// and the redaction live in one place: a metric that means different things
// depending on who emitted it is worse than no metric.

/**
 * Metric names. Keep the `teley.` prefix and the surface as an attribute rather
 * than baking it into the name, so one query can compare the same event across
 * the relay and a local CLI.
 */
export const METRIC = {
  /** A payload was accepted. Attributes: surface, protocol, signal, encoding. */
  INGEST_RECEIVED: 'teley.ingest.received',
  /** Records carried by an accepted payload. Attributes: surface, signal. */
  INGEST_RECORDS: 'teley.ingest.records',
  /** A payload was refused. Attributes: surface, protocol, reason. */
  INGEST_REJECTED: 'teley.ingest.rejected',
  /** A request matched no route. Attributes: surface. */
  INGEST_UNROUTED: 'teley.ingest.unrouted',

  /** A relay socket opened. Attributes: surface. */
  RELAY_CONNECTED: 'teley.relay.connected',
  /** A relay socket closed. Attributes: surface, code. */
  RELAY_CLOSED: 'teley.relay.closed',
  /** A reconnect was attempted. Attributes: surface, attempt. */
  RELAY_RECONNECT: 'teley.relay.reconnect',
  /** The relay refused the handshake. Attributes: surface. */
  RELAY_REJECTED: 'teley.relay.rejected',
  /** Viewers on a room, sampled when it changes. Attributes: surface. */
  ROOM_VIEWERS: 'teley.room.viewers',

  /** A session began. Attributes: surface, mode, transport, version. */
  SESSION_STARTED: 'teley.session.started',

  /** An MCP tool ran. Attributes: tool, outcome. */
  MCP_TOOL_CALL: 'teley.mcp.tool_call',
  /** How long an MCP tool took, in milliseconds. Attributes: tool. */
  MCP_TOOL_DURATION: 'teley.mcp.tool_duration',
  /** Traces handed back by wait_for_traces. Attributes: timed_out. */
  MCP_WAIT_TRACES: 'teley.mcp.wait_traces',
} as const;

/** Which part of Teley emitted a signal. */
export type Surface = 'worker' | 'web' | 'cli';

/**
 * A room ID is an ingest credential: anyone holding it can write to the room.
 * Keep only enough to correlate events with each other.
 */
export function redactRoomId(roomId: string): string {
  return `${roomId.slice(0, 4)}...`;
}

/**
 * Room credentials travel in URLs: the receive token as `?token=`, the room ID
 * as a path segment on `/r/:id` and `/live/:id`, and both inside a DSN. Sentry
 * collects URLs from breadcrumbs, spans, requests and messages, so every URL
 * leaving any surface passes through here first.
 */
export function redactUrl(value: string): string {
  let out = value.replace(
    /([?&](?:token|receiveToken|sentry_key)=)[^&#]*/gi,
    '$1[redacted]',
  );
  out = out.replace(
    /(\/(?:r|live|shared)\/)([^/?#]+)/gi,
    (_, prefix: string, id: string) => `${prefix}${redactRoomId(id)}`,
  );
  // A Sentry DSN carries the room ID as its public key: scheme://KEY@host/0
  out = out.replace(
    /(\bhttps?:\/\/)([^:@/\s]+)@/gi,
    (_, scheme: string, key: string) => `${scheme}${redactRoomId(key)}@`,
  );

  return out;
}

/**
 * Anything derived from a payload is the user's data, so an error message that
 * quoted it (a JSON parse error naming the offending token, say) must not
 * travel. Callers that touched a payload report the failure's shape, never its
 * text: a reason code they chose, plus the error's class name.
 */
export function failureReason(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown';
}
