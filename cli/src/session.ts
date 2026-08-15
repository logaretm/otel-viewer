// Room credentials + endpoint construction.
// Mirrors app/composables/useSession.ts, persisted to ~/.teley/session.json
// (the web app persists the same pair to IndexedDB).

import { nanoid } from 'nanoid';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const DIR = join(homedir(), '.teley');
const FILE = join(DIR, 'session.json');

export interface Session {
  roomId: string;
  receiveToken: string;
}

export function loadOrCreateSession(fresh = false): Session {
  if (!fresh && existsSync(FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(FILE, 'utf8'));
      if (
        typeof parsed.roomId === 'string' &&
        typeof parsed.receiveToken === 'string'
      ) {
        return { roomId: parsed.roomId, receiveToken: parsed.receiveToken };
      }
    } catch {
      // fall through and regenerate
    }
  }

  const session: Session = { roomId: nanoid(12), receiveToken: nanoid(24) };
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(session, null, 2), { mode: 0o600 });
  return session;
}

export interface Endpoints {
  host: string;
  secure: boolean;
  // True when this process is the ingest endpoint (--local): no relay, and no
  // web app or second device can reach the room.
  local: boolean;
  dsn: string; // Sentry DSN (public key = roomId)
  otlp: string; // OTLP HTTP ingest endpoint
  wsUrl: string; // WebSocket relay (carries the receive token)
}

// localhost / loopback hosts use plain http/ws; everything else uses TLS.
function isLocal(host: string): boolean {
  const name = host.replace(/:\d+$/, '');
  return (
    name === 'localhost' ||
    name === '127.0.0.1' ||
    name === '0.0.0.0' ||
    name === '[::1]'
  );
}

export function resolveEndpoints(
  host: string,
  session: Session,
  local = false,
): Endpoints {
  const secure = !isLocal(host);
  const http = secure ? 'https' : 'http';
  const ws = secure ? 'wss' : 'ws';

  return {
    host,
    secure,
    local,
    dsn: `${http}://${session.roomId}@${host}/0`,
    otlp: `${http}://${host}/r/${session.roomId}`,
    wsUrl: `${ws}://${host}/r/${session.roomId}?token=${session.receiveToken}`,
  };
}
