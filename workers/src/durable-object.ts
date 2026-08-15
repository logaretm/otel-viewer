// Durable Object for managing telemetry room state and WebSocket connections

import { DurableObject } from 'cloudflare:workers';
import * as Sentry from '@sentry/cloudflare';
import type { CloudflareOptions } from '@sentry/cloudflare';
import type { Env } from './types';
import { roomTag } from './util';
import { METRIC } from '../../shared/observability';

class TelemetryRoomBase extends DurableObject<Env> {
  private receiveToken: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);

    // Restore token from storage
    void this.ctx.blockConcurrencyWhile(async () => {
      this.receiveToken =
        (await this.ctx.storage.get<string>('receiveToken')) ?? null;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Internal broadcast from main worker
    if (url.pathname === '/broadcast') {
      const data = await request.json();
      this.broadcast(data);
      await this.resetAlarm();
      return new Response('OK');
    }

    // WebSocket upgrade
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }

    return new Response('Not Found', { status: 404 });
  }

  private async handleWebSocket(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');

    console.log(
      '[DO] WebSocket upgrade request, token:',
      token ? 'present' : 'missing',
    );

    if (!token) {
      Sentry.logger.warn('WebSocket rejected: no token', {
        room: this.roomName(),
      });
      return new Response('Missing token', { status: 400 });
    }

    // First connection claims the room
    if (!this.receiveToken) {
      console.log('[DO] First connection, claiming room with token');
      this.receiveToken = token;
      await this.ctx.storage.put('receiveToken', token);
      Sentry.logger.info('Room claimed by first connection', {
        room: this.roomName(),
      });
    }

    // Validate token
    if (token !== this.receiveToken) {
      console.log('[DO] Token mismatch, rejecting');
      // Expected when a stale tab reconnects to a reclaimed room, but a burst
      // of these against one room is the signature of someone guessing.
      Sentry.metrics.count(METRIC.RELAY_REJECTED, 1, {
        attributes: { surface: 'worker', reason: 'token_mismatch' },
      });
      Sentry.logger.warn('WebSocket rejected: token mismatch', {
        room: this.roomName(),
      });
      return new Response('Unauthorized', { status: 401 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept the WebSocket with hibernation support
    this.ctx.acceptWebSocket(server);
    const viewers = this.ctx.getWebSockets().length;
    console.log('[DO] WebSocket accepted, total sockets:', viewers);
    Sentry.logger.debug('WebSocket accepted', {
      room: this.roomName(),
      viewers,
    });

    server.send(
      JSON.stringify({
        type: 'connected',
        message: 'Connected to room',
      }),
    );

    Sentry.metrics.count(METRIC.RELAY_CONNECTED, 1, {
      attributes: { surface: 'worker' },
    });
    this.broadcastViewerCount();
    await this.resetAlarm();

    return new Response(null, { status: 101, webSocket: client });
  }

  private broadcast(data: any): void {
    const message = JSON.stringify(data);

    // Use getWebSockets() for hibernation-compatible WebSocket access
    const sockets = this.ctx.getWebSockets();
    console.log('[DO] Broadcasting to', sockets.length, 'sockets:', data.type);

    let failed = 0;
    for (const ws of sockets) {
      try {
        ws.send(message);
      } catch (error) {
        failed++;
        console.error('[DO] Failed to send to socket:', error);
      }
    }

    if (failed > 0) {
      // Each failure is one viewer silently missing this update.
      Sentry.logger.warn('Broadcast dropped for some sockets', {
        room: this.roomName(),
        message_type: data?.type ?? 'unknown',
        failed,
        total: sockets.length,
      });
    }
  }

  private async resetAlarm(): Promise<void> {
    // Set alarm for 30 minutes from now
    await this.ctx.storage.setAlarm(Date.now() + 30 * 60 * 1000);
  }

  async alarm(): Promise<void> {
    // Check if there are any active sessions
    const sockets = this.ctx.getWebSockets();
    console.log('[DO] Alarm fired, active sockets:', sockets.length);

    if (sockets.length === 0) {
      // No active sessions, clean up the room
      console.log('[DO] No active sockets, cleaning up room');
      // The receive token dies with the room, so the next connection claims it
      // fresh. Worth a trail when a viewer complains their room "reset".
      Sentry.logger.info('Room evicted after inactivity', {
        room: this.roomName(),
      });
      await this.ctx.storage.deleteAll();
      return;
    }

    // There are active sessions, extend the alarm
    await this.resetAlarm();
  }

  // WebSocket event handlers for hibernation
  webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): void {
    // Handle ping/pong for keepalive
    if (message === 'ping') {
      ws.send('pong');
    }
  }

  webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean,
  ): void {
    console.log('[DO] WebSocket closed, code:', code, 'reason:', reason);
    // Every client reconnects with backoff and loses whatever arrived in the
    // gap, so the distribution of close codes is the shape of that data loss.
    Sentry.metrics.count(METRIC.RELAY_CLOSED, 1, {
      attributes: { surface: 'worker', code },
    });
    this.broadcastViewerCount();
  }

  private broadcastViewerCount(): void {
    const sockets = this.ctx.getWebSockets();
    Sentry.metrics.gauge(METRIC.ROOM_VIEWERS, sockets.length, {
      attributes: { surface: 'worker' },
    });
    const message = JSON.stringify({
      type: 'viewer_count',
      count: sockets.length,
    });
    for (const ws of sockets) {
      try {
        ws.send(message);
      } catch (error) {
        console.error('[DO] Failed to send viewer count:', error);
      }
    }
  }

  webSocketError(ws: WebSocket, error: unknown): void {
    console.error('[DO] WebSocket error:', error);
    Sentry.logger.error('WebSocket error', {
      room: this.roomName(),
      error: error instanceof Error ? error.message : String(error),
    });
  }

  /**
   * Durable Objects are addressed by name, so the room ID is recoverable here.
   * Truncate it for the same reason the worker does: it is an ingest credential.
   */
  private roomName(): string {
    return roomTag(this.ctx.id.name ?? this.ctx.id.toString());
  }
}

export const TelemetryRoom = Sentry.instrumentDurableObjectWithSentry(
  (env: Env): CloudflareOptions => ({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,
    release: env.CF_VERSION_METADATA?.id,
    enableLogs: true,
    // Every viewer sends a keepalive ping every 30s, and each one lands in
    // webSocketMessage, so tracing that handler is one transaction per tab per
    // half minute with nothing in it.
    tracesSampler: ({ name, inheritOrSampleWith }) =>
      name === 'webSocketMessage' ? 0 : inheritOrSampleWith(0.1),
    // v11 removed sendDefaultPii, and its replacement defaults to collecting
    // request data. Nothing about a room's telemetry belongs in our project.
    dataCollection: {
      userInfo: false,
      cookies: false,
      urlQueryParams: false,
      httpHeaders: { request: false, response: false },
      httpBodies: [],
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      graphQL: { document: false, variables: false },
    },
  }),
  TelemetryRoomBase,
);
