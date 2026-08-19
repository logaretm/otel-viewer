<p align="center">
  <img src="https://teley.dev/logo.svg" alt="Teley" width="96" height="96">
</p>

<h1 align="center">teley-cli</h1>

<p align="center">
  A live trace, log, and metric viewer for you and your agents, in your terminal. Point any OpenTelemetry or Sentry SDK at the DSN it prints.
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
  <a href="#%EF%B8%8F-local-mode">Local mode</a> •
  <a href="#-mcp-for-coding-agents">MCP</a> •
  <a href="#-what-the-cli-reports-about-itself">Self-reporting</a>
</p>

---

`teley-cli` generates a DSN and renders traces, logs, and metrics as they stream in. No account, no config file.

Built with [OpenTUI](https://opentui.com) (React bindings), so the waterfall needs FFI: **Bun**, or Node 26.4+ with `--experimental-ffi`.

## ⚡ Run

```bash
bunx teley-cli                         # live room, waterfall in your terminal
bunx teley-cli mcp                     # serve the room to a coding agent over MCP
bunx teley-cli --demo                  # sample data, no network
bunx teley-cli --new                   # start a fresh room (new DSN)
bunx teley-cli --json                  # no TUI, newline-delimited JSON on stdout
bunx teley-cli --local                 # receive telemetry here, nothing leaves the machine
```

The DSN and OTLP endpoint are printed in the header. Point your SDK at either one, run your app, and spans appear.

> The TUI needs FFI, so either [Bun](https://bun.sh), or Node 26.4+ with `node --experimental-ffi` are needed. Everything else (`--json`, `mcp`, `--local`) runs on Node/Bun alike.

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
- **Metric charts.** Drawn in the terminal itself, out of braille: counters and gauges as lines, histogram buckets as bars. A metric split by attributes is charted as one series per attribute set, not folded into an average.
- **Both protocols.** OTLP and Sentry envelopes render in one timeline, each tagged with its source.
- **Sessions that persist.** Your room is reused across runs, so a restart does not invalidate the DSN you configured.
- **Pipeable.** `--json` drops the TUI and streams the room as newline-delimited JSON, for `jq`, a file, or CI.
- **Readable by agents.** `teley mcp` hands the same room to a coding agent as MCP tools, so it can run your app and read the span tree back.
- **Offline if you want.** `--local` makes the CLI the ingest endpoint, so telemetry never leaves your machine.

<p align="center">
  <img src="https://raw.githubusercontent.com/logaretm/teley/main/docs/screenshots/teley-cli-span-details.png" alt="Span attributes panel next to the waterfall" width="100%">
  <br><em>The span panel sits beside the waterfall: kind, duration, status, and every attribute on the selected span.</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/logaretm/teley/main/docs/screenshots/teley-cli-logs.png" alt="Log stream with an entry selected" width="100%">
  <br><em>Selecting an entry shows its body and attributes.</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/logaretm/teley/main/docs/screenshots/teley-cli-metrics.png" alt="A gauge charted as a braille line, beside the list of metric series" width="100%">
  <br><em>Counters and gauges plot as braille lines, at 2x4 dots per cell. The same metric split by attributes is one series per attribute set, labelled with just the values that differ: here <code>primary</code> and <code>replica</code>.</em>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/logaretm/teley/main/docs/screenshots/teley-cli-metrics-histogram.png" alt="A histogram's buckets as braille bars, with the stats panel open" width="100%">
  <br><em>Histogram buckets are bars in the same braille grid, labelled with their upper bounds. <code>tab</code> swaps the series list for the snapshot's own summary.</em>
</p>

## ⌨️ Keys

<p align="center">
  <img src="https://raw.githubusercontent.com/logaretm/teley/main/docs/screenshots/teley-cli-navigation.gif" alt="Walking the trace list, the waterfall, the header links, the log stream, and the metric charts with the keyboard" width="100%">
  <br><em>Walking the trace list, then <code>tab</code> into the waterfall (the list collapses, the span panel appears), <code>tab</code> again to copy an endpoint, then <code>→</code> through the logs and into the metrics, where <code>→</code> once more wraps back to the traces.</em>
</p>

| Key                      | Action                                        |
| ------------------------ | --------------------------------------------- |
| `←` / `→`                | Cycle the Traces, Logs, and Metrics views     |
| `↑` / `↓` (or `j` / `k`) | Navigate the focused panel                    |
| `tab`                    | Cycle focus: list → detail → connection links |
| `↵` / `y`                | Copy the focused DSN or OTLP endpoint         |
| `c`                      | Clear the local view                          |
| `q`                      | Quit                                          |

With the trace list focused, `↑`/`↓` moves between traces. With the waterfall focused, it moves between spans and the attribute panel follows along. In the metrics view `↑`/`↓` always moves between series, since a chart has nothing to walk inside one, and `tab` swaps the series list for a stats and attributes panel.

## 🧾 JSON output

`--json` skips the TUI entirely and streams the room to stdout as newline-delimited JSON, one object per line. Same room, no terminal rendering, so it pipes and greps.

```bash
bunx teley-cli --json | jq 'select(.type == "trace" and .trace.status_code == 2)'
bunx teley-cli --json > run.ndjson         # keep a run for later
bunx teley-cli --json --demo               # sample data, to see the shape
```

<p align="center">
  <img src="https://raw.githubusercontent.com/logaretm/teley/main/docs/screenshots/teley-cli-json.png" alt="Piping the JSON stream through jq to read the session line and filter traces" width="100%">
  <br><em>Three runs against the demo data: the session line, then every trace, then only the ones that failed.</em>
</p>

The first line is the session, so a script can read the DSN it should point an SDK at. Every line after it is telemetry:

```jsonc
{ "type": "session", "version": "0.1.7", "room_id": "…", "host": "teley.dev", "dsn": "…", "otlp": "…", "time": "…" }
{ "type": "trace", "trace": { … }, "spans": [ … ], "time": "…" }
{ "type": "log", "log": { … }, "time": "…" }
{ "type": "metric", "metric": { … }, "time": "…" }
```

`trace`, `log`, and `metric` carry the same shapes the web app uses (`shared/parsers/types.ts`). A `metric` line is one data point, so a series arrives as many lines; group them by name and attributes to reassemble it. A trace appears on a new line every time more of it arrives: `trace` is the running summary over every span seen so far, while `spans` holds only the spans from that update, so lines never repeat a span.

Nothing else is written to stdout. Connection state stays out of the stream, and a fatal error (a room already claimed by another token) goes to stderr with exit code 1. `ctrl-c` exits 0.

## 🏕️ Local mode

`--local` makes the cli process the ingest endpoint. Your app posts OTLP or Sentry envelopes straight to it on localhost, and nothing leaves the machine.

```bash
bunx teley-cli --local               # ingest on 127.0.0.1:8788
bunx teley-cli --local --port 4318   # the conventional OTLP/HTTP port
bunx teley-cli --local --port 0      # let the OS pick, printed in the header
bunx teley-cli mcp --local           # same, serving an agent
```

It accepts the same formats as teley.dev: JSON or protobuf, gzipped or not, and Sentry envelopes. The CLI still reports its own crashes; see [below](#-what-the-cli-reports-about-itself).

<p align="center">
  <img src="https://raw.githubusercontent.com/logaretm/teley/main/docs/screenshots/teley-cli-local.png" alt="The header showing localhost ingest endpoints, with a trace that never left the machine" width="100%">
  <br><em>Same view, but the endpoints in the header are on <code>localhost</code>: that trace was posted to this process and went nowhere else.</em>
</p>

## 🤖 MCP for Coding agents

`teley mcp` serves the room over [MCP](https://modelcontextprotocol.io) on stdio, so an agent can instrument your app, run it, and read the traces back without a terminal.

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
| `list_metrics`    | Captured metric series with their current reading and range (`name`, `service`)  |
| `clear_captured`  | Drops what the server is holding, so the next run starts clean                   |

The loop is: `get_dsn` → point the SDK at it → run the app → `wait_for_traces` → `get_trace` on whatever looks wrong. Results come back as text sized for a model to read, not raw payloads:

```
     +0ms  POST /checkout                    213.0ms  server  ERROR
  +10.0ms    GET inventory-service            59.0ms  client
  +80.0ms    db.query orders                 120.0ms  client  ERROR
```

<p align="center">
  <img src="https://raw.githubusercontent.com/logaretm/teley/main/docs/screenshots/teley-cli-mcp.gif" alt="An agent calling get_dsn, running the app, then wait_for_traces and get_trace over MCP" width="100%">
  <br><em>The whole loop over stdio: <code>get_dsn</code>, run the app against it, <code>wait_for_traces</code>, then <code>get_trace</code> for the span tree and the attributes on the span that failed.</em>
</p>

Call `wait_for_traces` before or while the app runs, not after it exits: it reports what arrives from the moment it is called.

It watches the same room as the TUI and the web app, so you can follow along while the agent works.

It starts empty every time your MCP client starts it.

## 📮 What the CLI reports about itself

`teley-cli` reports its own faults, the way any installed program does. That is the CLI's health, and it is a different thing from the telemetry you point at it.

**Never sent, in any mode:** your spans, logs, metrics, attribute values or payload bodies.

**Sent:** crashes and stack traces from the CLI's own code, and counters about its operation, which mode it ran in, how many payloads it accepted or rejected and why, connection close codes, and how long each MCP tool took and how it ended. A crash also carries the runtime it ran under, the OS and architecture, and the CLI's resolved dependency versions.

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
