import NetInfo from '@react-native-community/netinfo';
import { apiFetch, isConflict, isOk } from './api';
import { allPending, dequeue, incrementRetry, pendingCount } from './offline-db';
import { getToken } from './storage';

const MAX_RETRY = 5;

export type ConflictHandler = (op: {
  method: string;
  path: string;
  body: object | null;
}, serverItem: unknown) => void;

export async function flushQueue(onConflict?: ConflictHandler): Promise<{ flushed: number; failed: number }> {
  const token = await getToken();
  if (!token) return { flushed: 0, failed: 0 };

  const ops = await allPending();
  let flushed = 0;
  let failed = 0;

  for (const op of ops) {
    if (op.retry_count >= MAX_RETRY) {
      await dequeue(op.id);
      failed++;
      continue;
    }

    const body = op.body ? (JSON.parse(op.body) as object) : undefined;
    const result = await apiFetch(op.path, {
      method: op.method,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (isConflict(result)) {
      onConflict?.({ method: op.method, path: op.path, body: body ?? null }, result.serverItem);
      await dequeue(op.id);
      flushed++;
    } else if (!isOk(result) && result.status === 0) {
      // Network error — stop flushing, will retry when back online
      await incrementRetry(op.id);
      break;
    } else {
      await dequeue(op.id);
      if (!isOk(result)) failed++;
      else flushed++;
    }
  }

  return { flushed, failed };
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
