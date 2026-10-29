import NetInfo from '@react-native-community/netinfo';
import { apiFetch, isConflict, isOk } from './api';
import { allPending, dequeue, incrementRetry, pendingCount } from './offline-db';
import { getToken } from './storage';

const MAX_RETRY = 5;

let isFlushing = false;
// Set when a flush is requested while one is running, so writes queued meanwhile go out
// right after it instead of waiting for the next reconnect.
let flushAgain = false;

const flushListeners = new Set<() => void>();

/** Runs after any flush that applied at least one queued write, so screens can reload. */
export function onQueueFlushed(cb: () => void): () => void {
  flushListeners.add(cb);
  return () => { flushListeners.delete(cb); };
}

export type ConflictHandler = (op: {
  method: string;
  path: string;
  body: object | null;
}, serverItem: unknown) => void;

export interface FlushResult {
  flushed: number;
  failed: number;
  dropped: number;
  /** Stopped because the server couldn't be reached; ops are still queued. */
  offline: boolean;
}

/**
 * Sends queued writes in order. Only one flush runs at a time, so two writes to the same
 * path can never be in flight together; a call made during a flush re-runs it afterwards.
 */
export async function flushQueue(onConflict?: ConflictHandler): Promise<FlushResult> {
  if (isFlushing) {
    flushAgain = true;
    return { flushed: 0, failed: 0, dropped: 0, offline: false };
  }
  isFlushing = true;
  const total: FlushResult = { flushed: 0, failed: 0, dropped: 0, offline: false };
  try {
    do {
      flushAgain = false;
      const result = await _flushQueue(onConflict);
      total.flushed += result.flushed;
      total.failed += result.failed;
      total.dropped += result.dropped;
      total.offline = result.offline;
      if (result.offline) break;
    } while (flushAgain);
    if (total.flushed > 0 || total.failed > 0) flushListeners.forEach((cb) => cb());
    return total;
  } finally {
    isFlushing = false;
  }
}

async function _flushQueue(onConflict?: ConflictHandler): Promise<FlushResult> {
  const token = await getToken();
  if (!token) return { flushed: 0, failed: 0, dropped: 0, offline: false };

  const ops = await allPending();
  let flushed = 0;
  let failed = 0;
  let dropped = 0;
  let offline = false;

  for (const op of ops) {
    if (op.retry_count >= MAX_RETRY) {
      await dequeue(op.id);
      console.warn(`[sync] Dropped op after ${MAX_RETRY} retries:`, op.method, op.path);
      dropped++;
      continue;
    }

    let body: object | undefined;
    try {
      body = op.body ? (JSON.parse(op.body) as object) : undefined;
    } catch {
      await dequeue(op.id);
      failed++;
      continue;
    }
    const result = await apiFetch(op.path, {
      method: op.method,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (isConflict(result)) {
      onConflict?.({ method: op.method, path: op.path, body: body ?? null }, result.serverItem);
      await dequeue(op.id);
      flushed++;
    } else if (!isOk(result) && result.status === 0) {
      // Network error — stop flushing, will retry when back online. Not counted as a retry:
      // being offline says nothing about the op, and counting it would discard offline
      // changes after a few failed reconnects.
      offline = true;
      break;
    } else if (!isOk(result) && (result.status === 401 || result.status === 423)) {
      // Auth expired or DB locked — stop flushing, preserve ops for after re-auth/unlock
      break;
    } else if (!isOk(result) && result.status >= 500) {
      // Transient server error — retry later, don't discard the op
      await incrementRetry(op.id);
      break;
    } else {
      await dequeue(op.id);
      if (!isOk(result)) {
        console.warn('[sync] Server rejected queued op:', op.method, op.path, result.status);
        failed++;
      } else flushed++;
    }
  }

  return { flushed, failed, dropped, offline };
}


/** Subscribe to connectivity changes; calls onOnline whenever connectivity is restored. */
export function watchConnectivity(onOnline: () => void): () => void {
  let wasOffline = false;
  return NetInfo.addEventListener((state) => {
    const online = !!(state.isConnected && state.isInternetReachable);
    if (online && wasOffline) onOnline();
    wasOffline = !online;
  });
}

export { pendingCount };
