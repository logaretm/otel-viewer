// Color palette. Depth colors mirror the web waterfall (TraceWaterfall.vue).
import { TextAttributes } from '@opentui/core';

export const BOLD = TextAttributes.BOLD;

export const DEPTH_COLORS = [
  '#3b82f6', // blue   — root
  '#a855f7', // purple
  '#10b981', // emerald
  '#f59e0b', // amber
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#84cc16', // lime
  '#6366f1', // indigo
];

export const ERROR_RED = '#ef4444';
export const OK_GREEN = '#22c55e';

// Log severity colors, keyed by the label from severityLabel().
export const SEVERITY_COLORS: Record<string, string> = {
  FATAL: '#f87171', // red-400
  ERROR: '#f87171',
  WARN: '#fbbf24', // amber-400
  INFO: '#60a5fa', // blue-400
  DEBUG: '#c084fc', // purple-400
  TRACE: '#a1a1aa', // zinc-400
  UNSET: '#a1a1aa',
};

export function severityColor(label: string): string {
  return SEVERITY_COLORS[label] ?? SEVERITY_COLORS.UNSET!;
}

// UI chrome (zinc scale, matching the web app)
export const UI = {
  bg: '#09090b', // zinc-950
  panel: '#18181b', // zinc-900
  border: '#27272a', // zinc-800
  borderActive: '#52525b', // zinc-600
  text: '#d4d4d8', // zinc-300
  textStrong: '#f4f4f5', // zinc-100
  dim: '#71717a', // zinc-500
  accent: '#3b82f6', // blue-500
};

const STATUS_ERROR = 2;

export function depthColor(depth: number, statusCode: number): string {
  if (statusCode === STATUS_ERROR) return ERROR_RED;
  return DEPTH_COLORS[depth % DEPTH_COLORS.length]!;
}

// Metric type colors, matching the badges the web app's MetricCard uses.
export const METRIC_TYPE_COLORS: Record<string, string> = {
  counter: '#22c55e', // green-500
  gauge: '#3b82f6', // blue-500
  histogram: '#f59e0b', // amber-500
  set: '#a855f7', // purple-500
};

export function metricTypeColor(type: string): string {
  return METRIC_TYPE_COLORS[type] ?? UI.dim;
}

// The plotted line and bars. One color: a chart shows one series at a time, so
// coloring by anything else would be decoration rather than information.
export const CHART_LINE = '#3b82f6';
