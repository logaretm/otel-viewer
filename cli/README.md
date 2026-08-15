<p align="center">
  <img src="https://teley.dev/logo.svg" alt="Teley" width="96" height="96">
</p>

<h1 align="center">teley-cli</h1>

<p align="center">
  A live trace and log viewer for <a href="https://teley.dev">Teley</a>, in your terminal. Point any OpenTelemetry or Sentry SDK at the DSN it prints and watch spans arrive as a waterfall.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/teley-cli"><img src="https://img.shields.io/npm/v/teley-cli?style=flat-square&label=teley-cli&color=22c55e" alt="teley-cli on npm"></a>
  <a href="https://teley.dev"><img src="https://img.shields.io/badge/web%20app-teley.dev-6366f1?style=flat-square" alt="Web app"></a>
  <img src="https://img.shields.io/badge/license-Apache--2.0-64748b?style=flat-square" alt="Apache 2.0">
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/logaretm/teley/main/docs/screenshots/teley-cli-waterfall.png" alt="teley-cli showing a live trace waterfall" width="100%">
</p>

<p align="center">
  <a href="#-run">Run</a> •
  <a href="#-send-your-data">Send data</a> •
  <a href="#-what-you-get">Features</a> •
  <a href="#%EF%B8%8F-keys">Keys</a> •
  <a href="#-how-it-connects">How it connects</a>
</p>

---

`teley-cli` generates a room DSN, connects to the Teley relay over WebSocket, and renders traces and logs as they stream in. No account, no config file, no data at rest beyond the room you are watching.

It is the same room model as the [web dashboard](https://teley.dev), so you can watch a room in your terminal, in the browser, or both at once.

Built with [OpenTUI](https://opentui.com) (React bindings), so it runs on **Bun**.

## ⚡ Run

```bash
bunx teley-cli                         # live room against the deployed relay
bunx teley-cli --demo                  # sample data, no network
bunx teley-cli --new                   # start a fresh room (new DSN)
bunx teley-cli --host localhost:8787   # point at a local worker
```

The DSN and OTLP endpoint are printed in the header. Point your SDK at either one, run your app, and spans appear.

> Requires [Bun](https://bun.sh). OpenTUI uses `bun:ffi` for its native renderer and loads tree-sitter assets Node cannot resolve, so run it with `bunx`, not `npx`.

## 📡 Send your data

Both protocols land in the same room. Swap in the session ID from the header.

| Purpose     | Endpoint                        |
| ----------- | ------------------------------- |
| Sentry DSN  | `https://<room-id>@teley.dev/0` |
| OTLP ingest | `https://teley.dev/r/<room-id>` |

```javascript
Sentry.init({ dsn: 'https://<room-id>@teley.dev/0', tracesSampleRate: 1.0 });
// or
new OTLPTraceExporter({ url: 'https://teley.dev/r/<room-id>' });
```

Traces, logs, and metrics all go to that one OTLP endpoint, in JSON or protobuf, gzipped or not. See the [main README](https://github.com/logaretm/teley#-send-your-data) for full SDK snippets.

## ✨ What you get

- **Live waterfall.** Time-proportional span bars with the real hierarchy, span-kind badges, and errors in red.
- **Span details.** Kind, duration, status, span id, and every attribute for the selected span.
- **Logs view.** The full log stream with severity colors, correlated with the traces in the same room.
- **Both protocols.** OTLP and Sentry envelopes render in one timeline, each tagged with its source.
- **Sessions that persist.** Your room is reused across runs, so a restart does not invalidate the DSN you configured.

<p align="center">
  <img src="https://raw.githubusercontent.com/logaretm/teley/main/docs/screenshots/teley-cli-span-details.png" alt="Span attributes panel next to the waterfall" width="100%">
  <br><em>Focus the waterfall with <code>tab</code>, then walk spans with <code>↑</code>/<code>↓</code>. The panel follows the selection.</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/logaretm/teley/main/docs/screenshots/teley-cli-logs.png" alt="Log stream with an entry selected" width="100%">
  <br><em><code>←</code>/<code>→</code> switches between traces and logs. Selecting an entry shows its body and attributes.</em>
</p>

## ⌨️ Keys

| Key                      | Action                                        |
| ------------------------ | --------------------------------------------- |
| `←` / `→`                | Switch between the Traces and Logs views      |
| `↑` / `↓` (or `j` / `k`) | Navigate the focused panel                    |
| `tab`                    | Cycle focus: list → detail → connection links |
| `↵` / `y`                | Copy the focused DSN or OTLP endpoint         |
| `c`                      | Clear the local view                          |
| `q`                      | Quit                                          |

With the trace list focused, `↑`/`↓` moves between traces. With the waterfall focused, it moves between spans and the attribute panel follows along.

## 🔌 How it connects

The CLI is just another relay client, the same path the web app takes. It reuses the shared domain types (`shared/parsers/types.ts`) and the shared `buildSpanTree` (`shared/parsers/span-tree.ts`).

- **Credentials:** `roomId` (nanoid 12) and `receiveToken` (nanoid 24), persisted to `~/.teley/session.json` and reused across runs. `--new` rolls a fresh pair.
- **Host resolution:** `--host` > `$TELEY_HOST` > `teley.dev`. Non-local hosts use `wss://` and `https://`; localhost uses plain `ws://` and `http://`.

## 🛠️ Local development

From this directory:

```bash
bun install
bun run dev              # bun run src/index.tsx
bun run dev --demo
bun run typecheck
bun run build            # bundle to dist/ (what gets published)
```

The published package is a single Bun-bundled `dist/index.js` with deps kept external. The cross-package imports from `shared/` are inlined at build time.

With the CLI running and a worker up, inject a sample trace:

```bash
bun run scripts/send-test-trace.ts --host localhost:8787
```
