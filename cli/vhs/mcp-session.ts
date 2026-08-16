#!/usr/bin/env bun
// Drives `teley mcp --local` over real stdio JSON-RPC and prints the agent loop
// as a transcript, for the MCP screenshot. Every tool call and every response
// below is real: the only staging is the order they are made in.
//
//   bun vhs/mcp-session.ts

import { join } from 'node:path';

const PORT = process.env.TELEY_DEMO_PORT || '8788';
const CLI = join(import.meta.dir, '..');

const proc = Bun.spawn(
  ['bun', 'run', 'src/index.tsx', 'mcp', '--local', '--port', PORT],
  { cwd: CLI, stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' },
);

const reader = proc.stdout.getReader();
const decoder = new TextDecoder();
const pending = new Map<number, (v: any) => void>();
let buf = '';

(async () => {
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        const resolve = msg.id != null && pending.get(msg.id);
        if (resolve) {
          resolve(msg);
          pending.delete(msg.id);
        }
      } catch {
        // not a JSON-RPC line, ignore
      }
    }
  }
})();

let nextId = 1;
function rpc(method: string, params?: any): Promise<any> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    proc.stdin.write(
      JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n',
    );
    proc.stdin.flush();
  });
}

// --- presentation -----------------------------------------------------------
const DIM = '\x1b[38;5;244m';
const ACCENT = '\x1b[38;5;111m';
const GREEN = '\x1b[38;5;114m';
const YELLOW = '\x1b[38;5;179m';
const BOLD = '\x1b[1m';
const R = '\x1b[0m';

const out = (s = '') => process.stdout.write(s + '\n');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function typeOut(s: string, ms = 14) {
  for (const ch of s) {
    process.stdout.write(ch);
    await sleep(ms);
  }
  process.stdout.write('\n');
}

function body(text: string, limit = 40) {
  const all = text.split('\n');
  for (const line of all.slice(0, limit)) out(`  ${DIM}${line}${R}`);
  if (all.length > limit) out(`  ${DIM}…${R}`);
}

async function call(label: string, name: string, args: any = {}, limit = 40) {
  await typeOut(
    `${ACCENT}${BOLD}→ ${name}${R}${label ? `${DIM} ${label}${R}` : ''}`,
  );
  await sleep(200);
  const res = await rpc('tools/call', { name, arguments: args });
  const text = res?.result?.content?.[0]?.text ?? JSON.stringify(res);
  body(text, limit);
  out();
  return text;
}

// --- the loop ---------------------------------------------------------------
await rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'demo-agent', version: '1.0.0' },
});
await sleep(400);

// Wipe the invoking command line so the capture is just the transcript.
process.stdout.write('\x1b[2J\x1b[3J\x1b[H');
out();
out(
  `${GREEN}●${R} ${BOLD}agent session${R} ${DIM}·  teley mcp --local  ·  nothing leaves this machine${R}`,
);
out();
await sleep(700);

// Only the endpoint lines are shown; the rest of the response is usage guidance
// aimed at a model, which is noise in a transcript.
await call('', 'get_dsn', {}, 4);
await sleep(500);

// The app under test runs while the wait is in flight. wait_for_traces reports
// what arrives from the moment it is called, so it cannot be left until after a
// short-lived app has already exited.
await typeOut(
  `${YELLOW}${BOLD}$ ${R}${BOLD}bun scripts/send-test-trace.ts --host localhost:${PORT}${R}`,
);
const app = Bun.spawn(
  ['bun', 'scripts/send-test-trace.ts', '--host', `localhost:${PORT}`],
  { cwd: CLI, stdout: 'pipe', stderr: 'pipe' },
);
const waiting = rpc('tools/call', {
  name: 'wait_for_traces',
  arguments: { idle_ms: 1500 },
});

await app.exited;
body((await new Response(app.stdout).text()).trim() || 'sent');
out();
await sleep(300);

await typeOut(
  `${ACCENT}${BOLD}→ wait_for_traces${R}${DIM} { idle_ms: 1500 }${R}`,
);
const waited =
  (await waiting)?.result?.content?.[0]?.text ?? '(no response)';
body(waited);
out();
await sleep(400);

// The summary lines carry a short id; get_trace takes any unambiguous prefix.
const traceId = waited.match(/^([0-9a-f]{8,})\s/m)?.[1];
if (traceId) {
  await call(
    `{ trace_id: "${traceId}", include_attributes: true }`,
    'get_trace',
    { trace_id: traceId, include_attributes: true },
  );
}

await sleep(1500);
proc.kill();
process.exit(0);
