// Composable for relay communication via SharedWorker

import * as Sentry from '@sentry/browser';
import { METRIC } from '../../../shared/observability';
import type { WebSocketMessage } from '../../../shared/parsers/types';

type RelayStatus = 'disconnected' | 'connecting' | 'connected';

// Module-level state
let _worker: SharedWorker | null = null;
let _port: MessagePort | null = null;

// Event emitter for data updates
const dataCallbacks = new Set<(data: WebSocketMessage) => void>();

export function useRelay() {
  const status = useState<RelayStatus>('relay-status', () => 'disconnected');

  const connected = computed(() => status.value === 'connected');

  const initialize = (): void => {
    if (_worker) {
      console.log('[Relay] Already initialized');
      return;
    }

    console.log('[Relay] Initializing...');

    if (typeof SharedWorker === 'undefined') {
      console.error('[Relay] SharedWorker is not supported in this browser');
      // The whole live-data path depends on this. Without it the dashboard
      // loads and then silently never receives anything.
      Sentry.metrics.count(METRIC.RELAY_REJECTED, 1, {
        attributes: { surface: 'web', reason: 'sharedworker_unsupported' },
      });
      Sentry.logger.error('SharedWorker unsupported, relay unavailable', {
        user_agent: navigator.userAgent,
      });
      return;
    }

    try {
      _worker = new SharedWorker(
        new URL('../workers/relay-worker.ts', import.meta.url),
        { type: 'module', name: 'otel-relay' },
      );
      console.log('[Relay] SharedWorker created');

      _port = _worker.port;

      _port.onmessage = (event) => {
        console.log('[Relay] Message from worker:', event.data);
        handleWorkerMessage(event.data, status);
      };

      _worker.onerror = (error) => {
        console.error('[Relay] SharedWorker error:', error);
        Sentry.logger.error('SharedWorker runtime error', {
          message: error.message ?? 'unknown',
        });
      };

      _port.start();
      console.log('[Relay] Port started');

      if (typeof window !== 'undefined') {
        window.addEventListener('beforeunload', () => {
          _port?.postMessage({ type: 'port-closing' });
        });
      }
    } catch (error) {
      console.error('[Relay] Failed to create SharedWorker:', error);
      Sentry.captureException(error, { tags: { area: 'relay-init' } });
    }
  };

  const connect = (roomId: string, receiveToken: string): void => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/r/${roomId}?token=${receiveToken}`;

    // The receive token grants read access to the room and the URL embeds it,
    // so neither is printed: Sentry turns console output into breadcrumbs.
    console.log('[Relay] connect() called, room:', roomId.slice(0, 4) + '...');

    if (!_port) {
      console.error('[Relay] Cannot connect - port not initialized');
      Sentry.logger.error('Relay connect failed: port not initialized');
      return;
    }

    const message = {
      type: 'connect',
      roomId,
      receiveToken,
      wsUrl,
    };
    console.log('[Relay] Sending connect message to worker:', message);
    _port.postMessage(message);
  };

  const disconnect = (): void => {
    console.log('[Relay] disconnect() called');
    _port?.postMessage({ type: 'disconnect' });
  };

  const onData = (callback: (data: WebSocketMessage) => void): (() => void) => {
    dataCallbacks.add(callback);
    return () => dataCallbacks.delete(callback);
  };

  return {
    status: readonly(status),
    connected,
    initialize,
    connect,
    disconnect,
    onData,
  };
}

function handleWorkerMessage(msg: any, status: Ref<RelayStatus>) {
  console.log('[Relay] handleWorkerMessage:', msg.type, msg);

  switch (msg.type) {
    case 'status':
      console.log('[Relay] Status update:', msg.status);
      status.value = msg.status;
      break;

    case 'credentials':
      console.log('[Relay] Credentials received from SharedWorker');
      break;

    case 'data':
      console.log(
        '[Relay] Data received, broadcasting to',
        dataCallbacks.size,
        'callbacks',
      );
      console.log('[Relay] Data payload:', msg.payload);
      // Broadcast to all registered callbacks
      for (const callback of dataCallbacks) {
        try {
          callback(msg.payload);
        } catch (err) {
          console.error('[Relay] Error in data callback:', err);
          // A throwing subscriber drops this update for every later subscriber
          // too, so data goes missing without any visible failure.
          Sentry.captureException(err, { tags: { area: 'relay-dispatch' } });
        }
      }
      break;

    default:
      console.log('[Relay] Unknown message type:', msg.type);
  }
}
