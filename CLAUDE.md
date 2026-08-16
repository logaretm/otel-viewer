# Teley - Codebase Reference

## What is Teley?

A **real-time observability dashboard** for viewing traces, logs, and metrics. Built as a local-first, client-side SPA that accepts **OTLP (OpenTelemetry Protocol)** and **Sentry SDK** telemetry data. Users instrument their apps, point them at a Teley room URL, and see traces/logs/metrics appear in real time.

## Tech Stack

- **Framework**: Nuxt 4 (Vue 3 + TypeScript), SSR disabled (`ssr: false`)
- **Styling**: Tailwind CSS v4
- **State**: Vue composables with module-level state (no Pinia/Vuex)
- **Client DB**: Dexie.js (IndexedDB wrapper) — all data stored in browser
- **Backend**: Cloudflare Workers + Durable Objects
- **Charts**: Unovis
- **Icons**: Unplugin-icons (Iconify, prefix: `icon`)
- **Build**: Vite, static preset (`nuxt generate`)
- **Package Manager**: pnpm
- **Node**: >=24.0.0

## Directory Structure

```
app/
├── app.vue                  # Root component
├── assets/css/main.css      # Global styles (Tailwind)
├── components/              # 23 Vue components
├── composables/             # 12 composables (state/hooks)
├── database/                # IndexedDB schema + CRUD operations
│   ├── index.ts             # Dexie DB init (lazy singleton)
│   └── operations.ts        # All DB read/write functions
├── pages/                   # Nuxt file-based routing
│   ├── index.vue            # Traces dashboard (main page)
│   ├── logs.vue             # Logs viewer
│   ├── metrics.vue          # Metrics dashboard
│   ├── compare.vue          # Trace comparison (side-by-side)
│   ├── live/[roomId].vue    # Live shared session viewer
│   └── shared/[id].vue      # Shared trace snapshot viewer
├── utils/                   # Helpers
│   ├── span-tree.ts         # Build parent-child span hierarchy
│   ├── formatters.ts        # Duration, timestamp, ANSI, severity formatting
│   └── lcs.ts               # Longest Common Subsequence (trace comparison)
└── workers/
    └── relay-worker.ts      # SharedWorker: single WebSocket across tabs

shared/parsers/              # Framework-agnostic parsing (used by both client & worker)
├── types.ts                 # Core domain types (Trace, Span, Log, Metric, WebSocketMessage)
├── otlp-parser.ts           # Parse OTLP protocol (traces/logs/metrics)
├── otlp-protobuf.ts         # Decode OTLP/protobuf into the same shapes as OTLP/JSON
├── protobuf-reader.ts       # Minimal protobuf wire-format reader (no dependencies)
├── sentry-parser.ts         # Parse Sentry envelopes
├── sentry-to-otlp.ts        # Convert Sentry → unified OTLP format
├── helpers.ts               # Hex conversion, nano→ms, attribute parsing
└── index.ts                 # Parser entry point

server/api/                  # Nitro API (minimal, mostly stubs)
├── logs/index.get.ts        # GET /api/logs
└── logs/clear.post.ts       # POST /api/logs/clear

workers/src/                 # Cloudflare Worker runtime
├── index.ts                 # Request router (OTLP/Sentry ingest, WebSocket, sharing)
├── durable-object.ts        # TelemetryRoom DO (per-room WebSocket state)
├── shared-trace.ts          # SharedTrace DO (24h snapshot storage)
└── types.ts                 # Env/binding types

types/index.ts               # Re-exports shared types + app-specific (ParsedSpan, ParsedLog, etc.)
```

## Core Domain Types

Defined in `shared/parsers/types.ts`:

- **Trace**: `trace_id, service_name, operation_name, start_time, end_time, duration, status_code, source`
- **Span**: `span_id, trace_id, parent_span_id, name, kind, start/end_time, duration, attributes, events[], links[]`
- **Log**: `log_id, timestamp, trace_id?, span_id?, severity_number, severity_text, body, service_name, attributes`
- **Metric**: `metric_id, name, type (counter|gauge|histogram|set), service_name, timestamp, value, histogram?, attributes`
- **TraceSource**: `'OTLP' | 'SENTRY'`
- **WebSocketMessage**: Union of `trace_update | log_update | metric_update | clear_data | viewer_count | info`

App-specific types in `types/index.ts`: `ParsedSpan`, `ParsedLog`, `TraceUpdateData`, `LogUpdateData`, response types.

## Data Flow

```
Instrumented App
  ├─ OTLP POST /r/{roomId}
  └─ Sentry POST /api/{projectId}/envelope
        │
        ▼
Cloudflare Worker (workers/src/index.ts)
  → Parse payload (OTLP or Sentry → OTLP)
  → Broadcast to TelemetryRoom Durable Object
        │
        ▼
TelemetryRoom DO (durable-object.ts)
  → WebSocket broadcast to all connected clients
        │
        ▼
SharedWorker (app/workers/relay-worker.ts)
  → Single WebSocket per room, shared across browser tabs
  → Fan-out via MessagePort to each tab
        │
        ▼
useDataSync composable (event bus)
  → Routes by type: trace_update → upsertTrace+upsertSpans
                     log_update → upsertLog
                     metric_update → upsertMetric
  → Writes to IndexedDB (Dexie)
  → Fires event callbacks
        │
        ▼
useTraces / useLogs / useMetrics composables
  → Reactive state updates → Vue component re-renders
```

## Key Composables

| Composable                              | Purpose                                                                      |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| `useSession()`                          | Generates/loads roomId (nanoid 12) + receiveToken (nanoid 24) from IndexedDB |
| `useRelay()`                            | Manages SharedWorker lifecycle, connect/disconnect                           |
| `useDataSync()`                         | Event bus: relay messages → IndexedDB writes → component notifications       |
| `useTraces()`                           | Trace list state, fetches 100 from IndexedDB, real-time updates              |
| `useLogs()`                             | Log state, 500 cap                                                           |
| `useMetrics()`                          | Metric state, 1000 cap                                                       |
| `useTraceDetails(traceId)`              | Single trace + spans, reactive to ID changes                                 |
| `useTraceComparison(idA, idB)`          | LCS-based span alignment, diff calculation                                   |
| `useServiceFilter()`                    | Multi-service filter across data types                                       |
| `useResizablePanel(key, default, opts)` | Drag-to-resize panels, persisted to localStorage                             |
| `useHashTabs()`                         | Hash-based tab navigation                                                    |
| `useConfirmation(onConfirm)`            | Programmatic confirmation dialogs                                            |

## IndexedDB Schema (Dexie v2)

```
traces:    trace_id, start_time, service_name
spans:     span_id, trace_id, parent_span_id
logs:      log_id, timestamp, trace_id, severity_number
metrics:   metric_id, name, timestamp, service_name, type
credentials: key (stores roomId, receiveToken)
```

## API Endpoints

### Cloudflare Worker

| Endpoint                    | Method    | Purpose                        |
| --------------------------- | --------- | ------------------------------ |
| `/r/{roomId}`               | POST      | OTLP ingest (JSON or protobuf) |
| `/r/{roomId}`               | WebSocket | Real-time relay connection     |
| `/api/{projectId}/envelope` | POST      | Sentry envelope ingest         |
| `/api/share`                | POST      | Store trace snapshot (24h TTL) |
| `/api/share/{id}`           | GET       | Retrieve trace snapshot        |

### Auth Model

- No user auth (no OAuth/JWT)
- Room-based: first WebSocket connection claims room with `receiveToken`
- Subsequent connections must match token or get 401
- Sharing via URL with embedded room/token

## Components (23 total)

**Traces**: `TraceList`, `TraceCard`, `TraceDetail`, `TraceWaterfall`, `TraceCompareWaterfall`, `SpanDetails`, `SpanDiffDetails`
**Logs**: `LogRow`
**Metrics**: `MetricCard`, `MetricChart`
**Filtering**: `ServiceFilterBar`
**Navigation**: `SideNav`
**Dialogs**: `ModalDialog`, `ConfirmDialog`, `SetupModal`, `LiveSessionModal`, `HelpDialog`
**Guides**: `TracesSetupGuide`, `LogsSetupGuide`, `MetricsSetupGuide`
**Utility**: `ClearDataButton`, `ToggleCheckbox`, `SourceIcon`

## Scripts

```bash
pnpm dev              # Nuxt dev server
pnpm build            # Static build (nuxt generate)
pnpm dev:worker       # Cloudflare Worker dev
pnpm deploy:worker    # Deploy Worker
pnpm deploy:static    # Deploy to Cloudflare Pages
```

## Releasing

`teley-cli` is the only published package. `teley` (web) and `teley-worker` are
private and deploy to Cloudflare rather than release, so they are never
versioned.

Versioning is driven by [changesets](https://github.com/changesets/changesets):

```bash
pnpm changeset          # describe a user-visible CLI change
pnpm changeset --empty  # record that a change ships nothing user-visible
pnpm changeset:status   # what would be released right now
```

Every PR must add a changeset, and CI enforces it as a required check. Only
`cli/` and `shared/` ship to npm (`shared/parsers` is bundled into the CLI), so
a PR touching anything else takes an empty changeset. Reach for `--empty`
whenever a change ships nothing user-visible.

Merging a changeset does not release. `changesets/action` opens and keeps
updating a `chore(cli): release` PR carrying the accumulated version bump and
`cli/CHANGELOG.md` entry, so consecutive merges batch into one release. Merging
_that_ PR publishes to npm via trusted publishing, tags `cli-vX.Y.Z`, and cuts a
GitHub release from the new changelog section.

The `Publish CLI` workflow also takes a manual dispatch: `release` mode with a
`bump` to open a release PR for something that merged without a changeset, and
`snapshot` mode to publish the current branch under a dist-tag
(`bunx teley-cli@next`) without touching git.

If the release PR ever fails to open, check Settings → Actions → General →
**Allow GitHub Actions to create and approve pull requests**.

## README Screenshots

Everything in `docs/screenshots/` shares one treatment: the raw capture sits in
a rounded macOS-style window, on an indigo mesh gradient. Match it exactly when
adding or reshooting an image, otherwise the READMEs stop reading as one set.

### The gradient

A mesh gradient, not a linear one: a dark base with five colored blobs whose
influence falls off smoothly. Deep indigo and violet across the top, teal at the
bottom right, near-black in the middle so the dark UI still separates from it.

Base `rgb(10, 11, 24)`, then blend each blob over it in order. Positions and
radii are fractions of the canvas, colors are the blob's own:

| x    | y    | radius | color                |
| ---- | ---- | ------ | -------------------- |
| 0.08 | 0.06 | 0.62   | `rgb(79, 70, 229)`   |
| 0.92 | 0.10 | 0.55   | `rgb(124, 58, 237)`  |
| 0.78 | 0.95 | 0.60   | `rgb(16, 132, 129)`  |
| 0.20 | 0.98 | 0.52   | `rgb(37, 39, 96)`    |
| 0.50 | 0.45 | 0.40   | `rgb(30, 27, 75)`    |

For each pixel at fractional position `(fx, fy)` with `aspect = width / height`:

```
dx = (fx - bx) * aspect
dy = fy - by
d  = sqrt(dx² + dy²)
t  = max(0, 1 - d / (radius * aspect))
t  = t * t * (3 - 2t)                      # smoothstep
channel += (blobChannel - channel) * t     # per channel, blobs applied in order
```

Compute it at 128px wide (height proportional), then upscale to the full canvas
with Lanczos and apply a 2px Gaussian blur. Evaluating per-pixel at full size is
slow and bands; the upscale is what keeps it smooth.

### The window

`s` is the capture's pixel ratio: 2 for a 2x Chrome capture or a terminal
replay. Every measurement below is multiplied by it.

- **Title bar**: 38 tall, fill `rgb(26, 26, 32)`, 1px bottom hairline
  `rgb(46, 46, 54)`. Traffic lights are 12 across, centered vertically, at x =
  20, 40, 60: `#ff5f57`, `#febc2e`, `#28c840`. No URL pill (we dropped it).
- **Corners**: 14 radius on the whole window (bar + capture), as an alpha mask.
- **Edge**: 1px rounded-rect outline, white at 15% alpha, so the dark window
  separates from the dark gradient.
- **Shadow**: rounded rect the size of the window, offset 10 down at the top and
  22 at the bottom, black at 59% alpha, Gaussian blurred by 26. Composite it
  under the window.
- **Padding**: 64 of gradient on every side.
- **Output**: downscale to 2000px wide with Lanczos and save optimized PNG.

### Capturing

- **Web**: Chrome DevTools MCP at a 1600x900 viewport (captures at 2x, so
  3200x1800). Send real telemetry to a room rather than faking DB rows. To shoot
  unreleased UI, `pnpm build` in `web/` then `wrangler dev` in `workers/`, which
  serves `web/.output/public` and handles ingest, so the app behaves exactly as
  deployed. Override `span-panel-width` in localStorage (500 works well) when a
  detail panel is squeezed.
- **CLI**: the TUI cannot be screenshotted directly. Run it on a pty
  (`pty.fork` plus a `TIOCSWINSZ` ioctl to pin the grid, 140x27 is the size in
  use) while writing timed keystrokes to the master fd, capture the raw ANSI,
  then replay that stream through xterm.js in a self-contained page and
  screenshot it in Chrome. Terminal theme is the app's zinc palette on
  `#09090b`, 13px SF Mono at 1.2 line height, 14px padding.
- Capture the CLI against `teley.dev`, not localhost, so the DSN in the header
  looks real. `--local` is the exception: localhost endpoints in the header are
  the whole point of that image.

### Re-recording the CLI images with vhs

`cli/vhs/` scripts the four CLI images, so they can be reshot when the TUI
changes. [vhs](https://github.com/charmbracelet/vhs) does the pty-plus-xterm.js
capture described above (it drives ttyd through headless Chrome), and
`cli/vhs/frame.py` applies the gradient and window treatment above. `frame.py`
is the executable copy of this section, so the numbers here and the constants
there have to move together.

```sh
cd cli/vhs && ./record.sh          # all four, straight into docs/screenshots
cd cli/vhs && ./record.sh json     # navigation | mcp | json | local
```

- `brew install vhs`, and register SF Mono first. macOS ships it inside
  Terminal.app but hides it from other apps, so Chrome falls back to a
  proportional serif and the grid comes out wrong:
  `cp /System/Applications/Utilities/Terminal.app/Contents/Resources/Fonts/SF-Mono-{Regular,Bold,RegularItalic,BoldItalic}.otf ~/Library/Fonts/`
- `common.tape` pins the grid: 2464px wide at 2x, SF Mono 26px, 28px padding
  gives exactly 140 columns. Each tape sets `Height` to `56 + rows * 38.26`.
- vhs cannot parse an absolute path after `Output` or `Source`, and `Screenshot`
  needs a `Sleep` after it or the file is never written.
- Recordings use a throwaway room id, never a real one, and GIFs are written at
  1200px wide rather than 2000 since every frame carries the gradient.
- `cli/vhs/README.md` has the rest.

## Architecture Notes

1. **Local-first**: All telemetry stored in browser IndexedDB. No backend database.
2. **Client-only SPA**: `ssr: false`, static Nitro preset.
3. **SharedWorker**: One WebSocket per room shared across all browser tabs. Auto-reconnect with 3s backoff.
4. **Durable Objects**: `TelemetryRoom` (per-room WebSocket state, 30-min inactivity cleanup), `SharedTrace` (24h snapshot TTL).
5. **Dual protocol**: OTLP + Sentry envelopes → unified internal schema.
6. **Resizable panels**: All sidebars drag-to-resize, widths persisted to localStorage.
7. **Trace comparison**: LCS algorithm aligns spans, diffs attributes/durations/statuses.
