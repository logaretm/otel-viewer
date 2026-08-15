// ANSI escape code utilities
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

export function hasAnsi(str: string): boolean {
  return ANSI_REGEX.test(str);
}

export function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, '');
}

const ANSI_COLORS: Record<number, string> = {
  30: '#1e1e1e',
  31: '#e06c75',
  32: '#98c379',
  33: '#e5c07b',
  34: '#61afef',
  35: '#c678dd',
  36: '#56b6c2',
  37: '#abb2bf',
  90: '#5c6370',
  91: '#e06c75',
  92: '#98c379',
  93: '#e5c07b',
  94: '#61afef',
  95: '#c678dd',
  96: '#56b6c2',
  97: '#ffffff',
};

export function ansiToHtml(str: string): string {
  let result = '';
  let last = 0;
  const openTags: string[] = [];

  // eslint-disable-next-line no-control-regex
  const re = /\x1b\[([0-9;]*)m/g;
  let match;

  while ((match = re.exec(str)) !== null) {
    // Escape and append text before this code
    const text = str.slice(last, match.index);
    if (text) result += escapeHtml(text);
    last = re.lastIndex;

    const codes = match[1].split(';').map(Number);
    for (const code of codes) {
      if (code === 0 || code === 22 || code === 39) {
        // Reset / unbold / default color — close all open spans
        while (openTags.length) {
          result += openTags.pop();
        }
      } else if (code === 1) {
        result += '<span style="font-weight:bold">';
        openTags.push('</span>');
      } else if (ANSI_COLORS[code]) {
        result += `<span style="color:${ANSI_COLORS[code]}">`;
        openTags.push('</span>');
      }
    }
  }

  // Remaining text
  const tail = str.slice(last);
  if (tail) result += escapeHtml(tail);

  // Close any unclosed spans
  while (openTags.length) {
    result += openTags.pop();
  }

  return result;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Utility functions for formatting trace data
import { SpanStatusCode } from '@opentelemetry/api';
import type { TraceSource } from '@types';

export function formatDuration(ms: number): string {
  if (ms < 1) {
    return `${(ms * 1000).toFixed(2)}µs`;
  } else if (ms < 1000) {
    return `${ms.toFixed(2)}ms`;
  } else {
    return `${(ms / 1000).toFixed(2)}s`;
  }
}

export function formatDurationCompact(ms: number): string {
  if (ms === 0) return '0ms';
  if (ms < 1) {
    const val = ms * 1000;
    return `${parseFloat(val.toFixed(1))}µs`;
  } else if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  } else {
    return `${parseFloat((ms / 1000).toFixed(1))}s`;
  }
}

export function formatTimestamp(ms: number): string {
  const date = new Date(ms);
  return date.toLocaleString();
}

export function getStatusColor(statusCode: SpanStatusCode): string {
  switch (statusCode) {
    case SpanStatusCode.ERROR:
      return 'error';
    case SpanStatusCode.OK:
    case SpanStatusCode.UNSET:
    default:
      return 'success';
  }
}

// Spans keep the kind exactly as it arrived on the wire, so this maps the OTLP
// numbering (1=Internal .. 5=Consumer). `SpanKind` from `@opentelemetry/api`
// starts at INTERNAL=0 and would shift every label by one.
const SPAN_KIND_LABEL: Record<number, string> = {
  1: 'Internal',
  2: 'Server',
  3: 'Client',
  4: 'Producer',
  5: 'Consumer',
};

export function getSpanKindLabel(kind: number): string {
  return SPAN_KIND_LABEL[kind] ?? 'Internal';
}

// Single-letter badge, matching the CLI: Consumer shows N so it does not read
// as Client.
export function getSpanKindBadge(kind: number): string {
  if (kind === 5) return 'N';
  return getSpanKindLabel(kind)[0]!;
}

// Log severity mapping (OTLP spec: severity numbers 1-24)
export function getSeverityLabel(
  severityNumber: number,
  severityText?: string | null,
): string {
  if (severityText) {
    return severityText.toUpperCase();
  }

  // Map severity numbers to standard levels
  if (severityNumber >= 21) return 'FATAL';
  if (severityNumber >= 17) return 'ERROR';
  if (severityNumber >= 13) return 'WARN';
  if (severityNumber >= 9) return 'INFO';
  if (severityNumber >= 5) return 'DEBUG';
  if (severityNumber >= 1) return 'TRACE';
  return 'UNSET';
}

export function getSourceLabel(source: TraceSource): string {
  if (source === 'SENTRY') return 'Sentry';
  if (source === 'OTLP') return 'OTLP';

  return source;
}
