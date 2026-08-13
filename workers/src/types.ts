// Cloudflare Worker environment bindings

export interface Env {
  TELEMETRY_ROOM: DurableObjectNamespace;
  ASSETS?: Fetcher; // Optional - only available in production with assets binding

  // Sentry reads these off the env binding directly. Leaving SENTRY_DSN unset
  // disables the SDK, which is what happens in local `wrangler dev`.
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  CF_VERSION_METADATA?: { id: string; tag?: string };
}

export interface Session {
  id: string;
  ws: WebSocket;
}
