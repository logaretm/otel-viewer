<template>
  <div class="h-full flex flex-col bg-zinc-900">
    <!-- Header -->
    <div class="p-4 border-b border-zinc-800 flex justify-between items-center">
      <h2 class="text-base font-semibold text-zinc-100">Span Details</h2>
      <button
        @click="$emit('close')"
        class="w-8 h-8 flex items-center justify-center text-zinc-500 hover:bg-zinc-800 hover:text-zinc-100 rounded transition-colors"
        title="Close"
      >
        <IconPhXBold class="w-5 h-5" />
      </button>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto p-4 space-y-6">
      <!-- Information Section -->
      <section>
        <h3
          class="text-sm font-semibold text-zinc-100 uppercase tracking-wide mb-3"
        >
          Information
        </h3>
        <div class="space-y-3">
          <div class="flex flex-col gap-1">
            <span class="text-xs text-zinc-500 uppercase tracking-wide"
              >Name</span
            >
            <span class="text-sm text-zinc-200">{{ span.name }}</span>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-xs text-zinc-500 uppercase tracking-wide"
              >Span ID</span
            >
            <span class="text-xs text-zinc-400 font-mono">{{
              span.span_id
            }}</span>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-xs text-zinc-500 uppercase tracking-wide"
              >Trace ID</span
            >
            <span class="text-xs text-zinc-400 font-mono">{{
              span.trace_id
            }}</span>
          </div>

          <div v-if="span.parent_span_id" class="flex flex-col gap-1">
            <span class="text-xs text-zinc-500 uppercase tracking-wide"
              >Parent Span ID</span
            >
            <span class="text-xs text-zinc-400 font-mono">{{
              span.parent_span_id
            }}</span>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-xs text-zinc-500 uppercase tracking-wide"
              >Kind</span
            >
            <span
              class="inline-flex items-center px-2 py-1 rounded text-xs font-semibold uppercase w-fit"
              :class="`kind-${getSpanKindClass(span.kind)}`"
            >
              {{ getSpanKindLabel(span.kind) }}
            </span>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-xs text-zinc-500 uppercase tracking-wide"
              >Status</span
            >
            <span
              class="inline-flex items-center px-2 py-1 rounded text-xs font-semibold uppercase w-fit"
              :class="{
                'bg-green-500/20 text-green-400':
                  getStatusColor(span.status_code) === 'success',
                'bg-red-500/20 text-red-400':
                  getStatusColor(span.status_code) === 'error',
              }"
            >
              {{ getStatusLabel(span.status_code) }}
            </span>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-xs text-zinc-500 uppercase tracking-wide"
              >Duration</span
            >
            <span class="text-sm text-zinc-200">{{
              formatDuration(span.duration)
            }}</span>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-xs text-zinc-500 uppercase tracking-wide"
              >Start Time</span
            >
            <span class="text-sm text-zinc-200">{{
              formatTimestamp(span.start_time)
            }}</span>
          </div>

          <div class="flex flex-col gap-1">
            <span class="text-xs text-zinc-500 uppercase tracking-wide"
              >End Time</span
            >
            <span class="text-sm text-zinc-200">{{
              formatTimestamp(span.end_time)
            }}</span>
          </div>
        </div>

        <!-- Error Message -->
        <div
          v-if="span.status_code === 2 && span.status_message"
          class="mt-4 p-4 bg-red-500/10 border-l-2 border-red-500 rounded"
        >
          <strong
            class="text-xs text-red-500 uppercase tracking-wide block mb-2"
          >
            Error Message
          </strong>
          <p class="text-sm text-red-400 m-0">{{ span.status_message }}</p>
        </div>
      </section>

      <!-- Attributes Section -->
      <section
        v-if="parsedAttributes && Object.keys(parsedAttributes).length > 0"
      >
        <h3
          class="text-sm font-semibold text-zinc-100 uppercase tracking-wide mb-3"
        >
          Attributes
        </h3>
        <div class="space-y-2">
          <div
            v-for="(value, key) in parsedAttributes"
            :key="key"
            class="grid grid-cols-[140px_1fr] gap-4 p-2 bg-zinc-950 rounded text-sm"
          >
            <span class="text-xs text-zinc-400 font-mono break-words">{{
              key
            }}</span>
            <span
              class="text-xs text-zinc-200 font-mono break-all whitespace-pre-wrap"
            >
              {{ formatAttributeValue(value) }}
            </span>
          </div>
        </div>
      </section>

      <!-- Events Section -->
      <section v-if="parsedEvents && parsedEvents.length > 0">
        <h3
          class="text-sm font-semibold text-zinc-100 uppercase tracking-wide mb-3"
        >
          Events ({{ parsedEvents.length }})
        </h3>
        <div class="space-y-2">
          <div
            v-for="(event, idx) in parsedEvents"
            :key="idx"
            class="p-4 bg-zinc-950 rounded border-l-2 border-blue-500"
          >
            <div class="flex justify-between items-center mb-3">
              <span class="font-medium text-zinc-100 text-sm">{{
                event.name
              }}</span>
              <span class="text-xs text-zinc-500 font-mono">
                {{ formatTimestamp(event.time) }}
              </span>
            </div>
            <div
              v-if="
                event.attributes && Object.keys(event.attributes).length > 0
              "
              class="space-y-2"
            >
              <div
                v-for="(value, key) in event.attributes"
                :key="key"
                class="grid grid-cols-[140px_1fr] gap-4 p-2 bg-zinc-900 rounded text-sm"
              >
                <span class="text-xs text-zinc-400 font-mono break-words">{{
                  key
                }}</span>
                <span
                  class="text-xs text-zinc-200 font-mono break-all whitespace-pre-wrap"
                >
                  {{ formatAttributeValue(value) }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Links Section -->
      <section v-if="parsedLinks && parsedLinks.length > 0">
        <h3
          class="text-sm font-semibold text-zinc-100 uppercase tracking-wide mb-3"
        >
          Links ({{ parsedLinks.length }})
        </h3>
        <div class="space-y-2">
          <div
            v-for="(link, idx) in parsedLinks"
            :key="idx"
            class="p-4 bg-zinc-950 rounded border-l-2 border-blue-500"
          >
            <div class="space-y-2 mb-2">
              <div class="flex flex-col gap-1">
                <span class="text-xs text-zinc-500 uppercase">Trace ID</span>
                <span class="text-xs text-zinc-400 font-mono">{{
                  link.traceId
                }}</span>
              </div>
              <div class="flex flex-col gap-1">
                <span class="text-xs text-zinc-500 uppercase">Span ID</span>
                <span class="text-xs text-zinc-400 font-mono">{{
                  link.spanId
                }}</span>
              </div>
            </div>
            <div
              v-if="link.attributes && Object.keys(link.attributes).length > 0"
              class="space-y-2 mt-3"
            >
              <div
                v-for="(value, key) in link.attributes"
                :key="key"
                class="grid grid-cols-[140px_1fr] gap-4 p-2 bg-zinc-900 rounded text-sm"
              >
                <span class="text-xs text-zinc-400 font-mono break-words">{{
                  key
                }}</span>
                <span
                  class="text-xs text-zinc-200 font-mono break-all whitespace-pre-wrap"
                >
                  {{ formatAttributeValue(value) }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { SpanStatusCode } from '@opentelemetry/api';
import type { Span } from '@types';
import {
  formatDuration,
  formatTimestamp,
  getStatusColor,
  getSpanKindLabel,
} from '~/utils/formatters';

interface Props {
  span: Span;
}

const props = defineProps<Props>();
defineEmits<{
  close: [];
}>();

const parsedAttributes = computed(() => {
  const attrs = props.span.attributes;
  if (typeof attrs === 'string') {
    try {
      return JSON.parse(attrs);
    } catch {
      return {};
    }
  }
  return attrs || {};
});

const parsedEvents = computed(() => {
  const events = props.span.events;
  if (typeof events === 'string') {
    try {
      return JSON.parse(events);
    } catch {
      return [];
    }
  }
  return events || [];
});

const parsedLinks = computed(() => {
  const links = props.span.links;
  if (typeof links === 'string') {
    try {
      return JSON.parse(links);
    } catch {
      return [];
    }
  }
  return links || [];
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

function formatAttributeValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}
</script>

<style scoped>
@reference '../../app/assets/css/main.css';

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
