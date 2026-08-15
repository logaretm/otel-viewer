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
  <a href="#-json-output">JSON output</a> •
  <a href="#-local-mode">Local mode</a> •
  <a href="#-coding-agents-mcp">MCP</a> •
  <a href="#-what-the-cli-reports-about-itself">Self-reporting</a> •
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
bunx teley-cli --json                  # no TUI, newline-delimited JSON on stdout
bunx teley-cli mcp                     # serve the room to a coding agent over MCP
bunx teley-cli --local                 # receive telemetry here, no relay involved
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
- **Pipeable.** `--json` drops the TUI and streams the room as newline-delimited JSON, for `jq`, a file, or CI.
- **Readable by agents.** `teley mcp` hands the same room to a coding agent as MCP tools, so it can run your app and read the span tree back.
- **Offline if you want.** `--local` makes the CLI the ingest endpoint, so telemetry never leaves your machine.

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

## 🧾 JSON output

`--json` skips the TUI entirely and streams the room to stdout as newline-delimited JSON, one object per line. Same room, same relay, no terminal rendering, so it pipes and greps.

```bash
bunx teley-cli --json | jq 'select(.type == "trace" and .trace.status_code == 2)'
bunx teley-cli --json > run.ndjson         # keep a run for later
bunx teley-cli --json --demo               # sample data, to see the shape
```

The first line is the session, so a script can read the DSN it should point an SDK at. Every line after it is telemetry:

```jsonc
{ "type": "session", "version": "0.1.7", "room_id": "…", "host": "teley.dev", "dsn": "…", "otlp": "…", "time": "…" }
{ "type": "trace", "trace": { … }, "spans": [ … ], "time": "…" }
{ "type": "log", "log": { … }, "time": "…" }
```

`trace` and `log` carry the same shapes the web app uses (`shared/parsers/types.ts`). A trace appears on a new line every time more of it arrives: `trace` is the running summary over every span seen so far, while `spans` holds only the spans from that update, so lines never repeat a span.

Nothing else is written to stdout. Connection state stays out of the stream, and a fatal error (a room already claimed by another token) goes to stderr with exit code 1. `ctrl-c` exits 0.

## 🔒 Local mode

`--local` makes this process the ingest endpoint. Your app posts OTLP or Sentry envelopes straight to it on localhost, and no relay is involved at all.

```bash
bunx teley-cli --local               # ingest on 127.0.0.1:8788
bunx teley-cli --local --port 4318   # the conventional OTLP/HTTP port
bunx teley-cli --local --port 0      # let the OS pick, printed in the header
bunx teley-cli mcp --local           # same, serving an agent
```

The DSN and OTLP endpoint in the header point at that port, so pointing an SDK at it is the same gesture as always:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:8788/r/<room-id> npm start
```

Your app's telemetry never leaves the machine, there is nothing to deploy or reach, and there is no room to claim, so the "room already claimed" failure cannot happen. (The CLI still reports its own crashes; see [below](#-what-the-cli-reports-about-itself).) Ingest runs the same decoding the worker does (JSON or protobuf, gzip or not, Sentry envelopes), so what you see matches what the relay would have shown.

The trade: a local room has no relay behind it, so the web dashboard cannot open it, and no second device or browser tab can watch along. `--local` composes with everything else here, so the TUI, `--json`, and `mcp` all work the same way.

## 🤖 Coding agents (MCP)

`teley mcp` serves the room over [MCP](https://modelcontextprotocol.io) on stdio, so an agent can instrument your app, run it, and read the traces back without a terminal. It speaks the 2026-07-28 spec (stateless: no session handshake, every tool call self-contained).

```bash
claude mcp add teley -- bunx teley-cli mcp
```

```jsonc
// or by hand, in .mcp.json
{
  "mcpServers": {
    "teley": { "command": "bunx", "args": ["teley-cli", "mcp"] },
  },
}
```

| Tool              | What it does                                                                     |
| ----------------- | -------------------------------------------------------------------------------- |
| `get_dsn`         | The room's DSN and OTLP endpoint, to point an SDK at                             |
| `wait_for_traces` | Blocks until the room goes quiet, returns what arrived (`idle_ms`, `timeout_ms`) |
| `list_traces`     | Captured traces, newest first (`limit`, `errors_only`, `service`)                |
| `get_trace`       | One trace as an indented span tree (`include_attributes` for the metadata)       |
| `list_logs`       | Captured logs (`min_severity`, `trace_id`)                                       |
| `clear_captured`  | Drops what the server is holding, so the next run starts clean                   |

The loop is: `get_dsn` → point the SDK at it → run the app → `wait_for_traces` → `get_trace` on whatever looks wrong. Results come back as text sized for a model to read, not raw payloads:

```
     +0ms  POST /checkout                    213.0ms  server  ERROR
  +10.0ms    GET inventory-service            59.0ms  client
  +80.0ms    db.query orders                 120.0ms  client  ERROR
```

It watches the same room as the TUI and the web app, so you can follow along while the agent works.

The room lives in the server's memory and is never written to disk, so `teley mcp` leaves nothing behind either. It listens from the moment your MCP client starts it, and starts empty if that client restarts it: the relay keeps no history, so anything sent while no client was connected is gone.

## 📮 What the CLI reports about itself

`teley-cli` reports its own faults to Teley's Sentry project, the way any installed program does. That is the CLI's health, and it is a different thing from the telemetry you point at it.

**Never sent, in any mode:** your spans, logs, metrics, attribute values or payload bodies, and no room ID, receive token or DSN. Error text from anything that touched a payload is reduced to the error's class name, because a parse error can quote the payload it choked on. Under `--local` your telemetry still never leaves the machine.

**Sent:** crashes and stack traces from the CLI's own code, and counters about its operation, which mode it ran in, how many payloads it accepted or rejected and why, relay close codes, and how long each MCP tool took and how it ended.

Point it elsewhere with `TELEY_CLI_SENTRY_DSN`, and a source build with no DSN compiled in reports nothing at all.

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
