<template>
  <div class="space-y-0">
    <!-- Column Headers -->
    <div class="grid grid-cols-2 gap-px bg-zinc-800 mb-2">
      <div class="bg-zinc-950 px-4 py-2">
        <span
          class="text-xs font-semibold text-zinc-400 uppercase tracking-wide"
          >Trace A</span
        >
      </div>
      <div class="bg-zinc-950 px-4 py-2">
        <span
          class="text-xs font-semibold text-zinc-400 uppercase tracking-wide"
          >Trace B</span
        >
      </div>
    </div>

    <!-- Aligned Rows -->
    <div
      v-for="(row, idx) in alignedRows"
      :key="idx"
      class="grid grid-cols-2 gap-px bg-zinc-800 cursor-pointer transition-colors"
      :class="{
        'ring-1 ring-inset ring-blue-500/50': selectedRow === row,
      }"
      @click="$emit('selectRow', row)"
    >
      <!-- Left (Trace A) -->
      <div
        class="py-2 px-2 transition-colors"
        :class="getRowBgClass(row, 'a')"
        :style="
          row.spanA ? { paddingLeft: `${row.spanA.depth * 16 + 8}px` } : {}
        "
      >
        <template v-if="row.spanA">
          <div class="flex items-center gap-2">
            <!-- Span info -->
            <div class="flex items-center gap-2 min-w-0 flex-1">
              <span v-if="row.spanA.depth > 0" class="text-zinc-600 text-xs"
                >└─</span
              >
              <span
                class="text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase shrink-0"
                :class="
                  getDepthColorClassForLabel(
                    row.spanA.depth,
                    row.spanA.span.status_code,
                  )
                "
              >
                {{ getSpanKindBadge(row.spanA.span.kind) }}
              </span>
              <span class="text-sm text-zinc-300 truncate">{{
                row.spanA.span.name
              }}</span>
              <span class="text-xs text-zinc-500 font-mono shrink-0 ml-auto">
                {{ formatDuration(row.spanA.span.duration) }}
              </span>
            </div>
          </div>
          <!-- Timeline bar -->
          <div class="relative h-4 mt-1">
            <div
              class="absolute h-3 rounded opacity-80"
              :class="
                getDepthColorClass(row.spanA.depth, row.spanA.span.status_code)
              "
              :style="{
                left: `${row.spanA.offsetPercent}%`,
                width: `${row.spanA.widthPercent}%`,
              }"
            />
          </div>
        </template>
        <template v-else>
          <div class="h-[52px] flex items-center justify-center">
            <div
              class="border border-dashed border-zinc-700 rounded h-4 w-full mx-4"
            />
          </div>
        </template>
      </div>

      <!-- Right (Trace B) -->
      <div
        class="py-2 px-2 transition-colors"
        :class="getRowBgClass(row, 'b')"
        :style="
          row.spanB ? { paddingLeft: `${row.spanB.depth * 16 + 8}px` } : {}
        "
      >
        <template v-if="row.spanB">
          <div class="flex items-center gap-2">
            <div class="flex items-center gap-2 min-w-0 flex-1">
              <span v-if="row.spanB.depth > 0" class="text-zinc-600 text-xs"
                >└─</span
              >
              <span
                class="text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase shrink-0"
                :class="
                  getDepthColorClassForLabel(
                    row.spanB.depth,
                    row.spanB.span.status_code,
                  )
                "
              >
                {{ getSpanKindBadge(row.spanB.span.kind) }}
              </span>
              <span class="text-sm text-zinc-300 truncate">{{
                row.spanB.span.name
              }}</span>
              <span class="text-xs text-zinc-500 font-mono shrink-0 ml-auto">
                {{ formatDuration(row.spanB.span.duration) }}
              </span>
            </div>
            <!-- Duration delta badge for matched rows -->
            <span
              v-if="row.type === 'matched' && row.diff"
              class="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded shrink-0"
              :class="getDeltaClass(row.diff.durationDelta)"
            >
              {{ formatDelta(row.diff.durationDelta) }}
            </span>
          </div>
          <!-- Timeline bar -->
          <div class="relative h-4 mt-1">
            <div
              class="absolute h-3 rounded opacity-80"
              :class="
                getDepthColorClass(row.spanB.depth, row.spanB.span.status_code)
              "
              :style="{
                left: `${row.spanB.offsetPercent}%`,
                width: `${row.spanB.widthPercent}%`,
              }"
            />
          </div>
        </template>
        <template v-else>
          <div class="h-[52px] flex items-center justify-center">
            <div
              class="border border-dashed border-zinc-700 rounded h-4 w-full mx-4"
            />
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AlignedRow } from '~/composables/useTraceComparison';
import { formatDuration, getSpanKindBadge } from '~/utils/formatters';

defineProps<{
  alignedRows: AlignedRow[];
  selectedRow: AlignedRow | null;
}>();

defineEmits<{
  selectRow: [row: AlignedRow];
}>();

function getRowBgClass(row: AlignedRow, side: 'a' | 'b'): string {
  if (row.type === 'added') {
    return side === 'b' ? 'bg-green-500/5' : 'bg-zinc-950';
  }
  if (row.type === 'removed') {
    return side === 'a' ? 'bg-red-500/5' : 'bg-zinc-950';
  }
  return 'bg-zinc-950 hover:bg-zinc-900';
}

function getDeltaClass(delta: number): string {
  if (delta < 0) return 'bg-green-500/20 text-green-400';
  if (delta > 0) return 'bg-red-500/20 text-red-400';
  return 'bg-zinc-700/20 text-zinc-500';
}

function formatDelta(delta: number): string {
  const sign = delta > 0 ? '+' : '';
  if (Math.abs(delta) < 1) {
    return `${sign}${(delta * 1000).toFixed(0)}µs`;
  } else if (Math.abs(delta) < 1000) {
    return `${sign}${delta.toFixed(1)}ms`;
  } else {
    return `${sign}${(delta / 1000).toFixed(2)}s`;
  }
}

function getDepthColorClass(depth: number, statusCode: number): string {
  if (statusCode === 2) return 'bg-red-500';
  const colors = [
    'bg-blue-500',
    'bg-purple-500',
    'bg-emerald-500',
    'bg-amber-500',
    'bg-cyan-500',
    'bg-pink-500',
    'bg-lime-500',
    'bg-indigo-500',
  ];
  return colors[depth % colors.length];
}

function getDepthColorClassForLabel(depth: number, statusCode: number): string {
  if (statusCode === 2) return 'bg-red-500/20 text-red-400';
  const colors = [
    'bg-blue-500/20 text-blue-400',
    'bg-purple-500/20 text-purple-400',
    'bg-emerald-500/20 text-emerald-400',
    'bg-amber-500/20 text-amber-400',
    'bg-cyan-500/20 text-cyan-400',
    'bg-pink-500/20 text-pink-400',
    'bg-lime-500/20 text-lime-400',
    'bg-indigo-500/20 text-indigo-400',
  ];
  return colors[depth % colors.length];
}
</script>
