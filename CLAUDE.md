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

Any PR touching `cli/` or `shared/` must add a changeset (`shared/parsers` is
bundled into the CLI, so it ships to npm too). CI enforces this, and the empty
changeset is the escape hatch.

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

## Architecture Notes

1. **Local-first**: All telemetry stored in browser IndexedDB. No backend database.
2. **Client-only SPA**: `ssr: false`, static Nitro preset.
3. **SharedWorker**: One WebSocket per room shared across all browser tabs. Auto-reconnect with 3s backoff.
4. **Durable Objects**: `TelemetryRoom` (per-room WebSocket state, 30-min inactivity cleanup), `SharedTrace` (24h snapshot TTL).
5. **Dual protocol**: OTLP + Sentry envelopes → unified internal schema.
6. **Resizable panels**: All sidebars drag-to-resize, widths persisted to localStorage.
7. **Trace comparison**: LCS algorithm aligns spans, diffs attributes/durations/statuses.
