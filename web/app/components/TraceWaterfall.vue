<template>
  <div class="h-full flex flex-col bg-zinc-950">
    <!-- Header -->
    <div class="bg-zinc-900 border-b border-zinc-800 p-6">
      <div>
        <div class="flex items-center justify-between mb-3 gap-3">
          <div class="flex-1 min-w-0">
            <div v-if="renaming" class="flex items-center gap-2">
              <input
                ref="renameInputRef"
                v-model="renameDraft"
                type="text"
                placeholder="Custom trace name…"
                class="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-lg font-semibold text-zinc-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                @keydown.enter="commitRename"
                @keydown.esc="cancelRename"
                @blur="commitRename"
              />
            </div>
            <div v-else class="flex items-center gap-2 group/title min-w-0">
              <h2
                v-if="trace.custom_name"
                class="text-xl font-semibold text-zinc-100 truncate flex items-center gap-2"
              >
                <IconPhTagBold class="w-4 h-4 text-amber-400 shrink-0" />
                <span class="truncate">{{ trace.custom_name }}</span>
                <span class="text-sm font-normal text-zinc-500 truncate">{{
                  trace.operation_name
                }}</span>
              </h2>
              <h2 v-else class="text-xl font-semibold text-zinc-100 truncate">
                {{ trace.operation_name }}
              </h2>
              <button
                v-if="!readonly"
                @click="startRename"
                class="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 opacity-0 group-hover/title:opacity-100 transition-opacity shrink-0"
                :title="trace.custom_name ? 'Rename' : 'Add custom name'"
              >
                <IconPhPencilSimpleBold class="w-3.5 h-3.5" />
              </button>
              <button
                v-if="trace.custom_name && !readonly"
                @click="clearName"
                class="p-1 rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-800 opacity-0 group-hover/title:opacity-100 transition-opacity shrink-0"
                title="Clear custom name"
              >
                <IconPhXBold class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button
              @click="$emit('share')"
              title="Open this trace in Spanshot (spanshot.dev)"
              class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
            >
              <IconPhShareNetworkBold class="w-3.5 h-3.5" />
              Share
            </button>
            <button
              @click="$emit('compare')"
              class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
            >
              <IconPhArrowsLeftRightBold class="w-3.5 h-3.5" />
              Compare
            </button>
            <button
              @click="zoomedOut = !zoomedOut"
              class="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
              :class="{ '!text-zinc-200 !bg-zinc-700': !zoomedOut }"
              :title="
                zoomedOut
                  ? 'Switch to scrollable timeline'
                  : 'Switch to fit-to-view timeline'
              "
            >
              <IconPhArrowsOutBold v-if="zoomedOut" class="w-3.5 h-3.5" />
              <IconPhArrowsInBold v-else class="w-3.5 h-3.5" />
              {{ zoomedOut ? 'Fit' : 'Scroll' }}
            </button>
          </div>
        </div>
        <div class="flex gap-6 flex-wrap items-center text-sm">
          <span class="text-zinc-400">
            <strong class="text-zinc-200 mr-1">Provider:</strong>

            <span class="inline-flex items-center gap-1">
              {{ getSourceLabel(trace.source) }}
              <SourceIcon :source="trace.source" class="size-4" />
            </span>
          </span>
          <span class="text-zinc-400">
            <strong class="text-zinc-200 mr-1">Service:</strong>
            {{ trace.service_name }}
          </span>
          <span class="text-zinc-400">
            <strong class="text-zinc-200 mr-1">Duration:</strong>
            {{ formatDuration(trace.duration) }}
          </span>
          <span class="text-zinc-400">
            <strong class="text-zinc-200 mr-1">Spans:</strong>
            {{ spans.length }}
          </span>
          <span
            class="px-2 py-1 rounded text-xs font-bold uppercase"
            :class="{
              'bg-green-500/20 text-green-400':
                getStatusColor(trace.status_code) === 'success',
              'bg-red-500/20 text-red-400':
                getStatusColor(trace.status_code) === 'error',
            }"
          >
            {{ getStatusLabel(trace.status_code) }}
          </span>
        </div>
      </div>

      <!-- Error Banner -->
      <div
        v-if="trace.status_code === 2 && trace.status_message"
        class="mt-4 p-3 bg-red-500/10 border-l-2 border-red-500 rounded text-sm text-red-400"
      >
        <strong class="text-red-500 mr-2">Error:</strong>
        {{ trace.status_message }}
      </div>
    </div>

    <!-- Waterfall Content -->
    <div
      class="flex-1 overflow-y-auto p-4 relative"
      :style="{ '--name-col': nameColWidth + 'px' }"
    >
      <!-- Column Resize Handle -->
      <div
        class="absolute top-0 bottom-0 z-10 cursor-col-resize -mx-[1.5px] px-[1.5px] border-l border-zinc-800 hover:border-zinc-600 transition-colors"
        :class="{ '!border-zinc-600': nameColDragging }"
        :style="{ left: nameColWidth + 32 + 'px' }"
        @mousedown="onNameColMouseDown"
      />

      <!-- Time Scale -->
      <div class="grid grid-cols-[var(--name-col)_1fr] gap-4 mb-2">
        <div></div>
        <div
          ref="timeScaleRef"
          class="flex justify-between py-2 pl-2 border-b border-zinc-800"
        >
          <span
            v-for="(label, idx) in timeLabels"
            :key="idx"
            class="text-xs text-zinc-500 font-mono"
          >
            {{ label }}
          </span>
        </div>
      </div>

      <!-- Spans -->
      <div class="space-y-0.5" :class="{ 'wf-anim': animate }">
        <div
          v-for="(spanRow, i) in spanTree"
          :key="spanRow.span.span_id"
          class="span-row grid grid-cols-[var(--name-col)_1fr] gap-4 items-center hover:bg-zinc-900/60 cursor-pointer py-1.5 px-2 rounded-lg"
          :class="{
            'is-error': spanRow.span.status_code === 2,
            shown: entered,
          }"
          :style="{ '--enter-delay': enterDelay(i) }"
          @click="$emit('selectSpan', spanRow.span)"
        >
          <!-- Span Name -->
          <div
            class="flex items-center gap-2 min-w-0"
            :style="{ paddingLeft: `${spanRow.depth * 14}px` }"
          >
            <span
              v-if="spanRow.depth > 0"
              class="span-guide shrink-0"
              aria-hidden="true"
            />
            <span
              v-if="spanRow.span.status_code === 2"
              class="err-dot shrink-0"
              title="error"
            />
            <span
              class="text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase shrink-0 tracking-wide"
              :class="
                getDepthColorClassForLabel(
                  spanRow.depth,
                  spanRow.span.status_code,
                )
              "
            >
              {{ getSpanKindBadge(spanRow.span.kind) }}
            </span>
            <span class="text-sm text-zinc-300 truncate">
              {{ spanRow.span.name }}
            </span>
          </div>

          <!-- Timeline -->
          <div
            class="relative h-6 flex items-center"
            :class="zoomedOut ? 'overflow-hidden' : ''"
          >
            <!-- Bar -->
            <div
              class="span-bar absolute h-[18px] rounded-md flex items-center justify-end overflow-hidden"
              :style="getBarStyle(spanRow)"
            >
              <span
                v-if="durationPlacement(spanRow) === 'inside'"
                class="text-[10px] leading-none text-white/85 font-mono px-1.5 pointer-events-none"
              >
                {{ formatDuration(spanRow.span.duration) }}
              </span>
            </div>
            <!-- Duration spilled outside a too-thin bar -->
            <span
              v-if="durationPlacement(spanRow) !== 'inside'"
              class="absolute top-1/2 -translate-y-1/2 text-[10px] leading-none text-zinc-500 font-mono whitespace-nowrap pointer-events-none"
              :style="durationOutsideStyle(spanRow)"
            >
              {{ formatDuration(spanRow.span.duration) }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { SpanStatusCode } from '@opentelemetry/api';
import type { Trace, Span } from '@types';
import {
  formatDuration,
  formatDurationCompact,
  getStatusColor,
  getSpanKindBadge,
} from '~/utils/formatters';
import { useResizeObserver } from '@vueuse/core';
import { buildSpanTree } from '../../../shared/parsers/span-tree';
import SourceIcon from './SourceIcon.vue';

interface Props {
  trace: Trace;
  spans: Span[];
  readonly?: boolean;
  animate?: boolean;
}

const props = withDefaults(defineProps<Props>(), { animate: true });
const emit = defineEmits<{
  selectSpan: [span: Span];
  compare: [];
  share: [];
  rename: [name: string | null];
}>();

const renaming = ref(false);
const renameDraft = ref('');
const renameInputRef = ref<HTMLInputElement | null>(null);

function startRename() {
  renameDraft.value = props.trace.custom_name ?? '';
  renaming.value = true;
  nextTick(() => renameInputRef.value?.focus());
}
function commitRename() {
  if (!renaming.value) return;
  renaming.value = false;
  const next = renameDraft.value.trim();
  const current = props.trace.custom_name ?? '';
  if (next === current) return;
  emit('rename', next || null);
}
function cancelRename() {
  renaming.value = false;
}
function clearName() {
  emit('rename', null);
}

const {
  width: nameColWidth,
  dragging: nameColDragging,
  onMouseDownLeft: onNameColMouseDown,
} = useResizablePanel('waterfall-name-col', 250, { min: 150, max: 500 });
const zoomedOut = ref(true);

const spanTree = computed(() => buildSpanTree(props.spans, props.trace));

// Lighter -> darker gradient pairs, one per tree depth (cycled). Mirrors the
// solid depth palette below but gives bars the dimensional look of Spanshot.
const DEPTH_GRADIENTS: [string, string][] = [
  ['#60a5fa', '#3b82f6'], // blue
  ['#c084fc', '#a855f7'], // purple
  ['#34d399', '#10b981'], // emerald
  ['#fbbf24', '#f59e0b'], // amber
  ['#22d3ee', '#06b6d4'], // cyan
  ['#f472b6', '#ec4899'], // pink
  ['#a3e635', '#84cc16'], // lime
  ['#818cf8', '#6366f1'], // indigo
];
const ERROR_GRADIENT: [string, string] = ['#f87171', '#dc2626'];

function getBarGradient(depth: number, statusCode: number): string {
  const [from, to] =
    statusCode === 2
      ? ERROR_GRADIENT
      : DEPTH_GRADIENTS[depth % DEPTH_GRADIENTS.length]!;
  return `linear-gradient(90deg, ${from}, ${to})`;
}

type BarRow = {
  offsetPercent: number;
  widthPercent: number;
  depth: number;
  span: Span;
};

// Bar geometry (percent) after the fit-mode clamp, shared by the bar itself and
// the duration-label placement so they always agree.
function barMetrics(spanRow: BarRow): { left: number; width: number } {
  if (!zoomedOut.value) {
    return { left: spanRow.offsetPercent, width: spanRow.widthPercent };
  }
  const left = Math.min(spanRow.offsetPercent, 100);
  return { left, width: Math.min(spanRow.widthPercent, 100 - left) };
}

function getBarStyle(spanRow: BarRow) {
  const { left, width } = barMetrics(spanRow);
  return {
    background: getBarGradient(spanRow.depth, spanRow.span.status_code),
    left: `${left}%`,
    width: `${width}%`,
    minWidth: '2px',
  };
}

// Rough pixel budget the duration label needs vs. the bar's rendered width.
// When the bar is too thin (e.g. sub-millisecond spans), spill the label out to
// the side that has room instead of clipping it to an unreadable sliver.
function durationText(span: Span): string {
  return formatDuration(span.duration);
}

function durationPlacement(spanRow: BarRow): 'inside' | 'right' | 'left' {
  const { left, width } = barMetrics(spanRow);
  const barPx = (width / 100) * (containerWidth.value || 0);
  const labelPx = durationText(spanRow.span).length * 6.2 + 12;
  if (barPx >= labelPx + 6) return 'inside';
  return left + width > 80 ? 'left' : 'right';
}

function durationOutsideStyle(spanRow: BarRow) {
  const { left, width } = barMetrics(spanRow);
  return left + width > 80
    ? { right: `${100 - left}%`, paddingRight: '5px' }
    : { left: `${left + width}%`, paddingLeft: '5px' };
}

// Staggered entrance: rows fade/rise and bars wipe in the first time the
// waterfall renders, replayed whenever the trace changes.
const entered = ref(false);
const prefersReducedMotion =
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function reveal() {
  if (!props.animate || prefersReducedMotion) {
    entered.value = true;
    return;
  }
  entered.value = false;
  nextTick(() => requestAnimationFrame(() => (entered.value = true)));
}

onMounted(reveal);
watch(() => props.trace.trace_id, reveal);

// Cap the cumulative stagger so long traces still finish revealing quickly.
function enterDelay(i: number): string {
  return `${Math.min(i * 20, 500)}ms`;
}

// Adaptive time scale labels
const timeScaleRef = ref<HTMLElement | null>(null);
const containerWidth = ref(0);

useResizeObserver(timeScaleRef, (entries) => {
  const entry = entries[0];
  if (entry) {
    containerWidth.value = entry.contentRect.width;
  }
});

const numLabels = computed(() => {
  const width = containerWidth.value;
  if (width === 0) return 10;
  return Math.min(10, Math.max(2, Math.floor(width / 60)));
});

const timeLabels = computed(() => {
  const duration = props.trace.duration;
  const labels: string[] = [];
  const count = numLabels.value;

  for (let i = 0; i <= count; i++) {
    const time = (duration / count) * i;
    labels.push(formatDurationCompact(time));
  }

  return labels;
});

function getStatusLabel(code: SpanStatusCode): string {
  switch (code) {
    case SpanStatusCode.ERROR:
      return 'ERROR';
    case SpanStatusCode.OK:
    case SpanStatusCode.UNSET:
    default:
      return 'OK';
  }
}

// Keyed by the OTLP wire numbering the span was stored with, same as
// getSpanKindLabel.
function getSpanKindClass(kind: number): string {
  const classes: Record<number, string> = {
    1: 'internal',
    2: 'server',
    3: 'client',
    4: 'producer',
    5: 'consumer',
  };
  return classes[kind] ?? 'internal';
}

function getDepthColorClassForLabel(
  depth: number,
  statusCode: SpanStatusCode,
): string {
  // If error, always show red
  if (statusCode === 2) {
    return 'bg-red-500/20 text-red-400';
  }

  // Color palette for different depth levels (with opacity for backgrounds and corresponding text colors)
  const depthColors = [
    'bg-blue-500/20 text-blue-400', // Level 0 (root)
    'bg-purple-500/20 text-purple-400', // Level 1
    'bg-emerald-500/20 text-emerald-400', // Level 2
    'bg-amber-500/20 text-amber-400', // Level 3
    'bg-cyan-500/20 text-cyan-400', // Level 4
    'bg-pink-500/20 text-pink-400', // Level 5
    'bg-lime-500/20 text-lime-400', // Level 6
    'bg-indigo-500/20 text-indigo-400', // Level 7
  ];

  // Cycle through colors for deeper levels
  return (
    depthColors[depth % depthColors.length] || 'bg-blue-500/20 text-blue-400'
  );
}
</script>

<style scoped>
@reference '../../app/assets/css/main.css';

/* Nested-span connector: a short guide tick before indented rows. */
.span-guide {
  width: 8px;
  height: 1px;
  background: #3f3f46;
}

/* Glowing error marker in the name column. */
.err-dot {
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background: #ef4444;
  box-shadow: 0 0 6px rgba(239, 68, 68, 0.7);
}

/* Depth-tinted bars get a soft drop shadow for a lifted, glossy feel. Kept
   tight so it hugs the bar rather than haloing across the row. */
.span-bar {
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
}
.span-row.is-error .span-bar {
  box-shadow:
    0 0 0 1px rgba(239, 68, 68, 0.4),
    0 1px 4px rgba(220, 38, 38, 0.3);
}

.span-row {
  transition: background-color 120ms ease;
}

/* Staggered entrance: rows fade/rise, bars wipe left-to-right. `--enter-delay`
   is set inline per row and inherits down to the bar. */
.wf-anim .span-row {
  opacity: 0;
  transform: translateY(4px);
  transition:
    opacity 320ms ease var(--enter-delay, 0ms),
    transform 320ms ease var(--enter-delay, 0ms),
    background-color 120ms ease 0ms;
}
.wf-anim .span-bar {
  clip-path: inset(0 100% 0 0);
  transition: clip-path 420ms cubic-bezier(0.22, 1, 0.36, 1)
    var(--enter-delay, 0ms);
}
.wf-anim .span-row.shown {
  opacity: 1;
  transform: none;
}
.wf-anim .span-row.shown .span-bar {
  clip-path: inset(0 0 0 0);
}
@media (prefers-reduced-motion: reduce) {
  .wf-anim .span-row,
  .wf-anim .span-bar {
    opacity: 1;
    transform: none;
    clip-path: none;
    transition: none;
  }
}

.kind-server {
  @apply bg-blue-500/20 text-blue-400;
}

.kind-client {
  @apply bg-purple-500/20 text-purple-400;
}

.kind-internal {
  @apply bg-zinc-600/20 text-zinc-400;
}

.kind-producer {
  @apply bg-green-500/20 text-green-400;
}

.kind-consumer {
  @apply bg-orange-500/20 text-orange-400;
}
</style>
