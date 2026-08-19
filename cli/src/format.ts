// Formatting helpers. Ported from app/utils/formatters.ts.

export function formatDuration(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
  if (ms < 1000) return `${ms.toFixed(1)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

// OTLP span kind numbering: 1=Internal 2=Server 3=Client 4=Producer 5=Consumer
const KIND_LABEL: Record<number, string> = {
  1: 'Internal',
  2: 'Server',
  3: 'Client',
  4: 'Producer',
  5: 'Consumer',
};

export function spanKindLabel(kind: number): string {
  return KIND_LABEL[kind] ?? 'Internal';
}

// Single-letter badge (P is Producer; Consumer shows N to disambiguate from Client)
export function spanKindBadge(kind: number): string {
  if (kind === 5) return 'N';
  return spanKindLabel(kind)[0]!;
}

export function statusLabel(code: number): string {
  return code === 2 ? 'ERROR' : 'OK';
}

// Log severity mapping (OTLP spec: severity numbers 1-24). Ported from the web app.
export function severityLabel(
  severityNumber: number,
  severityText?: string | null,
): string {
  if (severityText) return severityText.toUpperCase();
  if (severityNumber >= 21) return 'FATAL';
  if (severityNumber >= 17) return 'ERROR';
  if (severityNumber >= 13) return 'WARN';
  if (severityNumber >= 9) return 'INFO';
  if (severityNumber >= 5) return 'DEBUG';
  if (severityNumber >= 1) return 'TRACE';
  return 'UNSET';
}

// Clock time for the log stream: HH:MM:SS.mmm (local).
export function formatLogTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number, w = 2) => n.toString().padStart(w, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

// Strip ANSI escape sequences so control codes don't corrupt the terminal render.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*m/g;
export function stripAnsi(str: string): string {
  return str.replace(ANSI_RE, '');
}

export function truncate(str: string, max: number): string {
  if (max <= 0) return '';
  if (str.length <= max) return str;
  if (max <= 1) return str.slice(0, max);
  return str.slice(0, max - 1) + '…';
}

// Greedy word wrap to a column width, hard-splitting words longer than the width.
export function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [text];
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (word.length > width) {
        if (line) {
          lines.push(line);
          line = '';
        }
        for (let i = 0; i < word.length; i += width)
          lines.push(word.slice(i, i + width));
        continue;
      }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

// Render an attribute value as a single-line string for display.
export function stringifyValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// Compact number for chart axes and metric readouts: 1.2k, 3.4M, 0.75. Axis
// ticks are read for magnitude, not for exact value, and a raw float would cost
// more columns than the plot beside it can spare.
export function formatCompact(value: number): string {
  if (!Number.isFinite(value)) return value > 0 ? '+∞' : '-∞';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${trimZeros(value / 1e9)}G`;
  if (abs >= 1e6) return `${trimZeros(value / 1e6)}M`;
  if (abs >= 1e3) return `${trimZeros(value / 1e3)}k`;
  if (Number.isInteger(value)) return String(value);
  if (abs >= 1) return trimZeros(value);
  // Small values are where the interesting precision usually is (rates,
  // ratios), so keep more of it than the one decimal used above.
  return Number(value.toPrecision(3)).toString();
}

function trimZeros(value: number): string {
  return Number(value.toFixed(1)).toString();
}

// OTLP carries units as UCUM, where a few codes are not what a reader expects,
// and Sentry spells the same dimensions out in full. Both are mapped to the
// symbol a chart has room for. Anything unlisted passes through.
const UNIT_LABEL: Record<string, string> = {
  // UCUM, as OTLP sends it.
  '1': '',
  '%': '%',
  By: 'bytes',
  KiBy: 'KiB',
  MiBy: 'MiB',
  GiBy: 'GiB',
  ns: 'ns',
  us: 'µs',
  ms: 'ms',
  s: 's',
  min: 'min',
  h: 'h',
  // Sentry's spelled-out units. `none` and `ratio` are dimensionless, so they
  // print as nothing rather than as a word beside every value.
  none: '',
  ratio: '',
  percent: '%',
  nanosecond: 'ns',
  microsecond: 'µs',
  millisecond: 'ms',
  second: 's',
  minute: 'min',
  hour: 'h',
  day: 'd',
  week: 'w',
  byte: 'bytes',
  kilobyte: 'kB',
  kibibyte: 'KiB',
  megabyte: 'MB',
  mebibyte: 'MiB',
  gigabyte: 'GB',
  gibibyte: 'GiB',
};

// The unit to print after a value. Empty when there is nothing worth printing:
// UCUM's `1` is dimensionless, and an annotation like `{request}` names what is
// being counted rather than a dimension, which the metric's own name already
// says. Detail panels show the raw unit instead, where there is room for it.
export function unitLabel(unit: string | null | undefined): string {
  if (!unit) return '';
  if (/^\{.*\}$/.test(unit)) return '';
  return UNIT_LABEL[unit] ?? unit;
}
