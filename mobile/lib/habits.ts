import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AppState, DeviceEventEmitter } from 'react-native';
import { apiFetch, isOk } from './api';
import { dequeuePath, enqueueReplacing, getCached, pendingWithPrefix, setCached } from './offline-db';
import { flushQueue, onQueueFlushed } from './sync';
import { useVault } from './vault-context';
import { usePrivacyMode } from './privacy';
import { habitStats, localDateStr, type HabitKind, type HabitLogEntry, type HabitStats, type WeekStart } from './habit-stats';

// Habits work offline: the last summary from the server is cached in offline.db, and W/L taps
// that can't reach the server are queued as idempotent PUTs and replayed on reconnect. Queued
// taps are laid over whatever the cache or server returns until they have synced.
// Creating, renaming, archiving, deleting and reordering need a connection.

export type HabitOutcome = 'W' | 'L';

export interface HabitItem {
  id: string;
  name: string;
  locked: boolean; // name is vault-encrypted and the vault is locked
  kind: HabitKind;
  archivedAt: string | null;
  private: boolean;
  position: number;
  createdDate: string; // local YYYY-MM-DD
  outcomes: Record<string, HabitOutcome>; // date → W/L; a missing date is unlogged
}

interface SummaryHabit {
  id: string;
  text: string;
  encText: string | null;
  kind: HabitKind;
  archivedAt: string | null;
  private?: boolean;
  position: number;
  createdAt: string;
  logs: { date: string; isLoss: boolean }[];
}

interface Summary {
  weekStartsOn: number;
  habits: SummaryHabit[];
}

const CACHE_KEY = 'habits:summary';
const CHANGED_EVENT = 'habits:changed';
const LOG_PATH_RE = /^\/api\/habits\/([^/]+)\/logs\/(\d{4}-\d{2}-\d{2})$/;

const logPath = (id: string, date: string) => `/api/habits/${id}/logs/${date}`;

export function habitLogs(h: HabitItem): HabitLogEntry[] {
  return Object.entries(h.outcomes).map(([date, o]) => ({ date, isLoss: o === 'L' }));
}

export function statsFor(h: HabitItem, today: string, weekStartsOn: WeekStart): HabitStats {
  return habitStats(habitLogs(h), h.createdDate, today, weekStartsOn);
}

/** blank → W → L → blank */
export function nextOutcome(o: HabitOutcome | undefined | null): HabitOutcome | null {
  return o === 'W' ? 'L' : o === 'L' ? null : 'W';
}

/**
 * Today's local date, kept current. Recomputed every minute and whenever the app comes back to
 * the foreground (timers don't run in the background), so a phone left overnight never logs a
 * tap against yesterday.
 */
export function useToday(): string {
  const [today, setToday] = useState(() => localDateStr(new Date()));
  useEffect(() => {
    const tick = () => setToday(localDateStr(new Date()));
    const id = setInterval(tick, 60_000);
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') tick(); });
    return () => { clearInterval(id); sub.remove(); };
  }, []);
  return today;
}

/** Applies a summary's logs to the cached copy so a cold start offline shows the latest taps. */
function applyToSummary(summary: Summary, id: string, date: string, outcome: HabitOutcome | null): Summary {
  return {
    ...summary,
    habits: summary.habits.map((h) => {
      if (h.id !== id) return h;
      const logs = h.logs.filter((l) => l.date !== date);
      if (outcome) logs.push({ date, isLoss: outcome === 'L' });
      logs.sort((a, b) => a.date.localeCompare(b.date));
      return { ...h, logs };
    }),
  };
}

export function useHabits() {
  const { masterKey, encrypt, decrypt } = useVault();
  const today = useToday();
  const instanceId = useId();
  const [habits, setHabits] = useState<HabitItem[]>([]);
  const [weekStartsOn, setWeekStartsOn] = useState<WeekStart>(0);
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const summaryRef = useRef<Summary | null>(null);
  const loadSeq = useRef(0);
  // Serialises writes per habit and day so two quick taps reach the server in order.
  const writeChains = useRef(new Map<string, Promise<unknown>>());

  const build = useCallback(async (summary: Summary): Promise<HabitItem[]> => {
    const pending = await pendingWithPrefix('/api/habits/').catch(() => []);
    const overlay = new Map<string, HabitOutcome | null>();
    for (const op of pending) {
      const m = op.method === 'PUT' ? LOG_PATH_RE.exec(op.path) : null;
      if (!m) continue;
      try {
        const outcome = (JSON.parse(op.body ?? '{}') as { outcome?: HabitOutcome | null }).outcome ?? null;
        overlay.set(`${m[1]}|${m[2]}`, outcome);
      } catch { /* malformed op; sync drops it */ }
    }
    return Promise.all(summary.habits.map(async (h): Promise<HabitItem> => {
      let name = h.text;
      let locked = false;
      if (h.encText) {
        const dec = masterKey ? await decrypt(JSON.parse(h.encText)) : null;
        if (dec !== null) name = dec;
        else locked = true;
      }
      const outcomes: Record<string, HabitOutcome> = {};
      for (const l of h.logs) outcomes[l.date] = l.isLoss ? 'L' : 'W';
      for (const [key, o] of overlay) {
        const [id, date] = key.split('|');
        if (id !== h.id) continue;
        if (o) outcomes[date] = o;
        else delete outcomes[date];
      }
      return {
        id: h.id,
        name,
        locked,
        kind: h.kind === 'BAD' ? 'BAD' : 'GOOD',
        archivedAt: h.archivedAt,
        private: !!h.private,
        position: h.position,
        createdDate: localDateStr(new Date(h.createdAt)),
        outcomes,
      };
    }));
  }, [masterKey, decrypt]);

  // Promise chains rather than async/await so the mount effect below never sets state
  // synchronously (react-hooks/set-state-in-effect).
  const show = useCallback((summary: Summary, seq: number) => {
    return build(summary).then((items) => {
      if (seq !== loadSeq.current) return;
      summaryRef.current = summary;
      setHabits(items);
      setWeekStartsOn(summary.weekStartsOn === 1 ? 1 : 0);
    });
  }, [build]);

  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    // Paint from the cache first so the screen is never empty offline.
    const painted = summaryRef.current
      ? show(summaryRef.current, seq)
      : getCached<Summary>(CACHE_KEY).then(async (cached) => {
        if (cached && seq === loadSeq.current) {
          await show(cached.data, seq);
          setLoading(false);
        }
      });
    return painted
      .then(() => apiFetch<Summary>('/api/habits/summary'))
      .then(async (res) => {
        if (seq !== loadSeq.current) return;
        if (isOk(res)) {
          await setCached(CACHE_KEY, res.data);
          await show(res.data, seq);
          setOffline(false);
        } else {
          setOffline((res as { status?: number }).status === 0);
        }
        if (seq === loadSeq.current) setLoading(false);
      });
  }, [show]);

  useEffect(() => { load(); }, [load]);

  // Reload when queued taps sync, when the app returns to the foreground, and when another
  // screen changes habits. Foregrounding also retries the queue, since a server that was
  // unreachable while the network stayed up never triggers a reconnect event.
  useEffect(() => {
    const offFlush = onQueueFlushed(() => { load(); });
    const app = AppState.addEventListener('change', (state) => {
      if (state === 'active') flushQueue().finally(() => load());
    });
    const changed = DeviceEventEmitter.addListener(CHANGED_EVENT, (source: string) => {
      if (source !== instanceId) load();
    });
    return () => { offFlush(); app.remove(); changed.remove(); };
  }, [load, instanceId]);

  const announce = () => DeviceEventEmitter.emit(CHANGED_EVENT, instanceId);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await flushQueue().catch(() => {});
    await load();
    setRefreshing(false);
  }, [load]);

  /** Sets or clears one day. Shows at once; queues the write if the server can't be reached. */
  const setOutcome = useCallback((id: string, date: string, outcome: HabitOutcome | null) => {
    setHabits((prev) => prev.map((h) => {
      if (h.id !== id) return h;
      const outcomes = { ...h.outcomes };
      if (outcome) outcomes[date] = outcome;
      else delete outcomes[date];
      return { ...h, outcomes };
    }));
    if (summaryRef.current) {
      summaryRef.current = applyToSummary(summaryRef.current, id, date, outcome);
      setCached(CACHE_KEY, summaryRef.current);
    }

    const path = logPath(id, date);
    const key = `${id}|${date}`;
    const prev = writeChains.current.get(key) ?? Promise.resolve();
    const next = prev.then(async () => {
      // This value supersedes anything queued earlier for the same day.
      await dequeuePath('PUT', path).catch(() => {});
      const res = await apiFetch(path, { method: 'PUT', body: JSON.stringify({ outcome }) });
      if (isOk(res)) {
        setOffline(false);
        announce();
        return;
      }
      const status = (res as { status?: number }).status ?? 0;
      if (status === 0 || status === 401 || status === 423 || status >= 500) {
        await enqueueReplacing('PUT', path, { outcome });
        if (status === 0) setOffline(true);
        announce();
      } else {
        // The server rejected it (e.g. the habit was deleted elsewhere); show what it has.
        load();
      }
    });
    writeChains.current.set(key, next.catch(() => {}));
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  // Only private habit names are encrypted, and only while the vault is unlocked.
  const encryptName = useCallback(async (name: string, isPrivate: boolean): Promise<{ text: string; encText?: string | null }> => {
    if (!isPrivate || !masterKey) return { text: name, encText: null };
    const blob = await encrypt(name);
    if (!blob) return { text: name, encText: null };
    return { text: '', encText: JSON.stringify(blob) };
  }, [masterKey, encrypt]);

  /** Online-only changes. Resolves to an error message, or null on success. */
  const mutate = useCallback(async (path: string, init: RequestInit): Promise<string | null> => {
    const res = await apiFetch(path, init);
    if (isOk(res)) {
      await load();
      announce();
      return null;
    }
    return (res as { status?: number }).status === 0
      ? "You're offline. Connect to the server to make this change."
      : 'That change didn\'t save. Try again.';
  }, [load]); // eslint-disable-line react-hooks/exhaustive-deps

  const createHabit = useCallback(async (kind: HabitKind, name: string, isPrivate = false) =>
    mutate('/api/habits', { method: 'POST', body: JSON.stringify({ kind, private: isPrivate, ...(await encryptName(name, isPrivate)) }) }),
  [mutate, encryptName]);

  const updateHabit = useCallback(async (id: string, fields: { name?: string; archived?: boolean; private?: boolean }) => {
    const { name, ...rest } = fields;
    const current = habits.find((h) => h.id === id);
    const isPrivate = fields.private ?? current?.private ?? false;
    // Changing the name or the private flag rewrites the stored name to match the new rule.
    // A locked name can't be rewritten, so it is left as it is.
    const newName = name ?? (fields.private !== undefined && current && !current.locked ? current.name : undefined);
    const body = { ...rest, ...(newName !== undefined ? await encryptName(newName, isPrivate) : {}) };
    return mutate(`/api/habits/${id}?date=${localDateStr(new Date())}`, { method: 'PATCH', body: JSON.stringify(body) });
  }, [mutate, encryptName, habits]);

  const deleteHabit = useCallback((id: string) => mutate(`/api/habits/${id}`, { method: 'DELETE' }), [mutate]);

  /** Saves a new order for one group. Positions are rewritten across all habits. */
  const reorder = useCallback(async (kind: HabitKind, orderedIds: string[]): Promise<string | null> => {
    const current = [...habits].sort((a, b) => a.position - b.position);
    const byId = new Map(current.map((h) => [h.id, h]));
    const moved = orderedIds.map((id) => byId.get(id)).filter((h): h is HabitItem => !!h);
    const rest = current.filter((h) => !orderedIds.includes(h.id));
    const group = (k: HabitKind) => (k === kind ? [...moved, ...rest.filter((h) => h.kind === k)] : rest.filter((h) => h.kind === k));
    const next = [...group('GOOD'), ...group('BAD')].map((h, i) => ({ ...h, position: i }));
    const before = new Map(current.map((h) => [h.id, h.position]));
    setHabits(next);
    const results = await Promise.all(
      next.filter((h) => before.get(h.id) !== h.position).map((h) =>
        apiFetch(`/api/habits/${h.id}`, { method: 'PATCH', body: JSON.stringify({ position: h.position }) })),
    );
    await load();
    if (results.every(isOk)) {
      announce();
      return null;
    }
    return results.some((r) => (r as { status?: number }).status === 0)
      ? "You're offline. Connect to the server to reorder habits."
      : "The new order didn't save. Try again.";
  }, [habits, load]); // eslint-disable-line react-hooks/exhaustive-deps

  const sorted = useMemo(() => [...habits].sort((a, b) => a.position - b.position), [habits]);
  const [privacyOn] = usePrivacyMode();
  const privateCount = sorted.filter((h) => h.private).length;
  const visible = useMemo(() => (privacyOn ? sorted.filter((h) => !h.private) : sorted), [sorted, privacyOn]);

  return {
    habits: visible,
    /** Private habits currently hidden by privacy mode. */
    hiddenCount: privacyOn ? privateCount : 0,
    privateCount,
    weekStartsOn,
    today,
    loading,
    offline,
    refreshing,
    refresh,
    setOutcome,
    createHabit,
    updateHabit,
    deleteHabit,
    reorder,
  };
}
