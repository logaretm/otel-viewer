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

// The Sentry SDK types its wrappers against Cloudflare's ambient Env, which is
// empty unless `wrangler types` generates it. Declaring our bindings into that
// namespace keeps this file the single source of truth without committing a
// half-megabyte of generated types.
declare global {
  namespace Cloudflare {
    interface Env extends TeleyEnv {}
  }
}

type TeleyEnv = Env;

export interface Session {
  id: string;
  ws: WebSocket;
}
