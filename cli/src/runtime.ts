// Only two things in the CLI are Bun-only: OpenTUI's renderer, which loads a
// native library over FFI, and --local's ingest server, which is Bun.serve.
// --json and mcp run on plain Node as they are.

// Node grew FFI behind --experimental-ffi in 26.4, which is enough for
// OpenTUI's renderer.
const NODE_FFI_MIN = { major: 26, minor: 4 };

export const isBun = Boolean(process.versions.bun);

function nodeHasFfi(): boolean {
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);

  return (
    major > NODE_FFI_MIN.major ||
    (major === NODE_FFI_MIN.major && minor >= NODE_FFI_MIN.minor)
  );
}

// Only for a renderer failure under Node: under Bun the same failure is a real
// crash and belongs to the fatal handler.
export function rendererHelp(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);

  return [
    `teley: could not start the TUI (${reason}).`,
    nodeHasFfi()
      ? 'It needs bun, or this Node with --experimental-ffi:'
      : `It needs bun, or Node ${NODE_FFI_MIN.major}.${NODE_FFI_MIN.minor}+ with --experimental-ffi (this is ${process.versions.node}):`,
    '',
    '  bunx teley-cli',
    ...(nodeHasFfi()
      ? [`  node --experimental-ffi ${process.argv[1] ?? 'teley'}`]
      : []),
  ].join('\n');
}

export function localIngestHelp(): string {
  return [
    `teley: --local needs bun, since its ingest server is Bun.serve (this is Node ${process.versions.node}).`,
    '',
    '  bunx teley-cli --local',
  ].join('\n');
}
