#!/usr/bin/env bun
import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { LiveApp } from './App';
import { loadOrCreateSession, resolveEndpoints } from './session';
import { initObservability, onFatal } from './observability';
import { relaySource } from './source';
import { runStream } from './stream';
import pkg from '../package.json' with { type: 'json' };

// Deployed relay host. Override with --host / $TELEY_HOST (e.g. localhost:8787 for local dev).
const DEFAULT_HOST = 'teley.dev';
// Ingest port for --local. 8787 is the worker's dev port, so this sits beside it.
const DEFAULT_LOCAL_PORT = 8788;

interface Args {
  command: 'tui' | 'mcp';
  host: string;
  fresh: boolean;
  demo: boolean;
  json: boolean;
  local: boolean;
  port: number;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: 'tui',
    host: process.env.TELEY_HOST || DEFAULT_HOST,
    fresh: false,
    demo: false,
    json: false,
    local: false,
    port: DEFAULT_LOCAL_PORT,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === 'mcp') {
      args.command = 'mcp';
    } else if (arg === '--host') {
      args.host = argv[++i] ?? args.host;
    } else if (arg.startsWith('--host=')) {
      args.host = arg.slice('--host='.length);
    } else if (arg === '--new') {
      args.fresh = true;
    } else if (arg === '--demo') {
      args.demo = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--local') {
      args.local = true;
    } else if (arg === '--port') {
      args.port = Number(argv[++i] ?? args.port);
      args.local = true;
    } else if (arg.startsWith('--port=')) {
      args.port = Number(arg.slice('--port='.length));
      args.local = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--version' || arg === '-v') {
      args.version = true;
    }
  }

  return args;
}

const HELP = `teley — terminal trace viewer

Usage: teley [options]
       teley mcp [options]   Serve the room to a coding agent over MCP (stdio)

Options:
  --host <host>   Relay host (default: ${DEFAULT_HOST}, or $TELEY_HOST)
  --new           Start a fresh room (new DSN), ignoring the saved session
  --demo          Render sample traces without connecting
  --json          Stream newline-delimited JSON to stdout instead of the TUI
  --local         Receive telemetry on this machine, with no relay involved
  --port <port>   Ingest port for --local (default: ${DEFAULT_LOCAL_PORT}, 0 picks a free one)
  -v, --version   Show the version number
  -h, --help      Show this help

Point your app's OpenTelemetry/Sentry SDK at the DSN shown in the header.
With --json the DSN is the first line on stdout, and every trace, log, and
status change follows as one JSON object per line.

--local makes this process the ingest endpoint, so nothing leaves the machine.
The web dashboard cannot open a local room; the terminal and MCP work the same.`;

const args = parseArgs(process.argv.slice(2));

if (args.version) {
  console.log(pkg.version);
  process.exit(0);
}

if (args.help) {
  console.log(HELP);
  process.exit(0);
}

const session = loadOrCreateSession(args.fresh);

// --local binds the ingest port up front, so a collision is a clear message
// here rather than a stack trace from inside whichever mode starts next. The
// bound port decides the endpoints, since --port 0 lets the OS pick.
async function resolveSource() {
  if (!args.local) {
    const endpoints = resolveEndpoints(args.host, session);
    return { endpoints, source: relaySource(endpoints.wsUrl) };
  }

  const { createLocalIngest } = await import('./local-server');
  try {
    const ingest = createLocalIngest(args.port);
    return {
      endpoints: resolveEndpoints(`localhost:${ingest.port}`, session, true),
      source: ingest.source,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(
      `teley: could not listen on port ${args.port} (${reason}). Pass --port to pick another, or --port 0 for any free one.`,
    );
    process.exit(1);
  }
}

const { endpoints, source } = await resolveSource();

// The CLI's own health, not the room's telemetry: see src/observability.ts for
// where that line is drawn. Init before any mode starts, so a crash on the way
// up is reported like any other.
initObservability({
  mode: args.command === 'mcp' ? 'mcp' : args.json ? 'json' : 'tui',
  transport: endpoints.local ? 'local' : 'relay',
  version: pkg.version,
});

async function runTui() {
  // Own Ctrl-C ourselves so quit always runs the same graceful teardown as `q`,
  // rather than the renderer's default which races our key handler.
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  const root = createRoot(renderer);

  // A crash exits through observability's fatal handler, which cannot know
  // about the renderer, so hand it the teardown.
  onFatal(() => {
    root.unmount();
    renderer.destroy();
  });

  let shuttingDown = false;
  function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    // Exit in finally so a throwing teardown never leaves the CLI hung.
    try {
      root.unmount(); // runs effect cleanups, closing the relay WebSocket
      renderer.destroy(); // restores the terminal (exits alt-screen, shows cursor)
    } finally {
      process.exit(0);
    }
  }

  // The sample data is only loaded when --demo asks for it, so a live run never
  // carries it.
  if (args.demo) {
    const { DemoApp } = await import('./demo');
    root.render(<DemoApp endpoints={endpoints} onQuit={shutdown} />);
  } else {
    root.render(
      <LiveApp endpoints={endpoints} source={source} onQuit={shutdown} />,
    );
  }
}

if (args.command === 'mcp') {
  const { runMcp } = await import('./mcp');
  runMcp(endpoints, session, source, pkg.version);
} else if (args.json) {
  await runStream({
    endpoints,
    session,
    source,
    version: pkg.version,
    demo: args.demo,
  });
} else {
  await runTui();
}
