#!/usr/bin/env bun
import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { LiveApp, DemoApp } from './App';
import { loadOrCreateSession, resolveEndpoints } from './session';
import { runStream } from './stream';
import pkg from '../package.json' with { type: 'json' };

// Deployed relay host. Override with --host / $TELEY_HOST (e.g. localhost:8787 for local dev).
const DEFAULT_HOST = 'teley.dev';

interface Args {
  host: string;
  fresh: boolean;
  demo: boolean;
  json: boolean;
  help: boolean;
  version: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    host: process.env.TELEY_HOST || DEFAULT_HOST,
    fresh: false,
    demo: false,
    json: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--host') {
      args.host = argv[++i] ?? args.host;
    } else if (arg.startsWith('--host=')) {
      args.host = arg.slice('--host='.length);
    } else if (arg === '--new') {
      args.fresh = true;
    } else if (arg === '--demo') {
      args.demo = true;
    } else if (arg === '--json') {
      args.json = true;
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

Options:
  --host <host>   Relay host (default: ${DEFAULT_HOST}, or $TELEY_HOST)
  --new           Start a fresh room (new DSN), ignoring the saved session
  --demo          Render sample traces without connecting
  --json          Stream newline-delimited JSON to stdout instead of the TUI
  -v, --version   Show the version number
  -h, --help      Show this help

Point your app's OpenTelemetry/Sentry SDK at the DSN shown in the header.
With --json the DSN is the first line on stdout, and every trace, log, and
status change follows as one JSON object per line.`;

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
const endpoints = resolveEndpoints(args.host, session);

async function runTui() {
  // Own Ctrl-C ourselves so quit always runs the same graceful teardown as `q`,
  // rather than the renderer's default which races our key handler.
  const renderer = await createCliRenderer({ exitOnCtrlC: false });
  const root = createRoot(renderer);

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

  root.render(
    args.demo ? (
      <DemoApp endpoints={endpoints} onQuit={shutdown} />
    ) : (
      <LiveApp endpoints={endpoints} onQuit={shutdown} />
    ),
  );
}

if (args.json) {
  runStream({ endpoints, session, version: pkg.version, demo: args.demo });
} else {
  await runTui();
}
