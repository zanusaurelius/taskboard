"use client";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useVault } from "./vault-context";
import { habitStats, localDateStr, type HabitKind, type HabitLogEntry, type HabitStats, type WeekStart } from "./habit-stats";
import type { HabitOutcome } from "./types";
import { usePrivacy } from "./privacy";

export interface HabitItem {
  id: string;
  name: string;
  encText: string | null;
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

export function habitLogs(h: HabitItem): HabitLogEntry[] {
  return Object.entries(h.outcomes).map(([date, o]) => ({ date, isLoss: o === "L" }));
}

export function statsFor(h: HabitItem, today: string, weekStartsOn: WeekStart): HabitStats {
  return habitStats(habitLogs(h), h.createdDate, today, weekStartsOn);
}

/**
 * Today's local date, kept current. Recomputed every minute and whenever the tab becomes
 * visible again, so a tab left open overnight never logs against yesterday.
 */
export function useToday(): string {
  const [today, setToday] = useState(() => localDateStr(new Date()));
  useEffect(() => {
    const tick = () => setToday(localDateStr(new Date()));
    tick();
    const id = setInterval(tick, 60_000);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
      window.removeEventListener("focus", tick);
    };
  }, []);
  return today;
}

export function useHabits() {
  const vault = useVault();
  const today = useToday();
  const [habits, setHabits] = useState<HabitItem[]>([]);
  const [weekStartsOn, setWeekStartsOn] = useState<WeekStart>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadSeq = useRef(0);
  const id = useId();
  const instanceId = useRef(id);

  const decryptName = useCallback(async (text: string, encText: string | null) => {
    if (!encText || !vault.masterKey) return text;
    return (await vault.decrypt(JSON.parse(encText))) ?? text;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault.masterKey]);

  // Only private habit names are encrypted, and only while the vault is unlocked.
  const encryptName = useCallback(async (name: string, isPrivate: boolean): Promise<{ text: string; encText?: string | null }> => {
    if (!isPrivate || !vault.masterKey) return { text: name, encText: null };
    const blob = await vault.encrypt(name);
    if (!blob) return { text: name, encText: null };
    return { text: "", encText: JSON.stringify(blob) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault.masterKey]);

  const reload = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      const res = await fetch("/api/habits/summary");
      if (!res.ok) throw new Error(String(res.status));
      const data: { weekStartsOn: number; habits: SummaryHabit[] } = await res.json();
      const items = await Promise.all(data.habits.map(async (h): Promise<HabitItem> => ({
        id: h.id,
        name: await decryptName(h.text, h.encText),
        encText: h.encText,
        kind: h.kind === "BAD" ? "BAD" : "GOOD",
        archivedAt: h.archivedAt,
        private: !!h.private,
        position: h.position,
        createdDate: localDateStr(new Date(h.createdAt)),
        outcomes: Object.fromEntries(h.logs.map((l) => [l.date, l.isLoss ? "L" : "W"])),
      })));
      if (seq !== loadSeq.current) return;
      setHabits(items);
      setWeekStartsOn(data.weekStartsOn === 1 ? 1 : 0);
      setError(null);
    } catch {
      if (seq === loadSeq.current) setError("Couldn't load habits. Check your connection and try again.");
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [decryptName]);

  useEffect(() => { reload(); }, [reload]);

  // Other views (Daily Focus, the Habits page) announce changes so each copy stays current.
  // A view ignores its own announcements; its state is already up to date.
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== instanceId.current) reload();
    };
    window.addEventListener("habits:changed", handler);
    return () => window.removeEventListener("habits:changed", handler);
  }, [reload]);

  const announce = () => window.dispatchEvent(new CustomEvent("habits:changed", { detail: instanceId.current }));

  const patchLocal = (id: string, fn: (h: HabitItem) => HabitItem) =>
    setHabits((prev) => prev.map((h) => (h.id === id ? fn(h) : h)));

  /** Sets or clears one day. Optimistic; reloads from the server if the save fails. */
  const setOutcome = useCallback(async (id: string, date: string, outcome: HabitOutcome | null) => {
    patchLocal(id, (h) => {
      const outcomes = { ...h.outcomes };
      if (outcome) outcomes[date] = outcome;
      else delete outcomes[date];
      return { ...h, outcomes };
    });
    const res = await fetch(`/api/habits/${id}/logs/${date}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outcome }),
    }).catch(() => null);
    if (!res?.ok) {
      setError("That change didn't save. Check your connection and try again.");
      reload();
      return;
    }
    announce();
  }, [reload]);

  const createHabit = useCallback(async (kind: HabitKind, name: string, isPrivate = false) => {
    const res = await fetch("/api/habits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, private: isPrivate, ...(await encryptName(name, isPrivate)) }),
    }).catch(() => null);
    if (!res?.ok) {
      setError("Couldn't add that habit. Check your connection and try again.");
      return false;
    }
    await reload();
    announce();
    return true;
  }, [encryptName, reload]);

  const updateHabit = useCallback(async (id: string, fields: { name?: string; archived?: boolean; position?: number; private?: boolean }) => {
    const { name, ...rest } = fields;
    const current = habits.find((h) => h.id === id);
    const isPrivate = fields.private ?? current?.private ?? false;
    // Changing the name or the private flag rewrites the stored name to match the new rule.
    const newName = name ?? (fields.private !== undefined ? current?.name : undefined);
    const body = { ...rest, ...(newName !== undefined && (await encryptName(newName, isPrivate))) };
    const res = await fetch(`/api/habits/${id}?date=${localDateStr(new Date())}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res?.ok) {
      setError("That change didn't save. Check your connection and try again.");
      return false;
    }
    await reload();
    announce();
    return true;
  }, [encryptName, reload, habits]);

  const deleteHabit = useCallback(async (id: string) => {
    const res = await fetch(`/api/habits/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) {
      setError("Couldn't delete that habit. Check your connection and try again.");
      return;
    }
    setHabits((prev) => prev.filter((h) => h.id !== id));
    announce();
  }, []);

  /** Saves a new order for one group. Positions are rewritten across all habits. */
  const reorder = useCallback(async (kind: HabitKind, orderedIds: string[]) => {
    const current = [...habits].sort((a, b) => a.position - b.position);
    const byId = new Map(current.map((h) => [h.id, h]));
    const moved = orderedIds.map((id) => byId.get(id)).filter((h): h is HabitItem => !!h);
    const rest = current.filter((h) => !orderedIds.includes(h.id));
    const group = (k: HabitKind) => (k === kind ? [...moved, ...rest.filter((h) => h.kind === k)] : rest.filter((h) => h.kind === k));
    const next = [...group("GOOD"), ...group("BAD")].map((h, i) => ({ ...h, position: i }));
    setHabits(next);
    const before = new Map(current.map((h) => [h.id, h.position]));
    const results = await Promise.all(
      next.filter((h) => before.get(h.id) !== h.position).map((h) =>
        fetch(`/api/habits/${h.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position: h.position }),
        }).then((r) => r.ok, () => false)
      )
    );
    if (results.some((ok) => !ok)) {
      setError("The new order didn't save. Check your connection and try again.");
      reload();
      return;
    }
    announce();
  }, [habits, reload]);

  const saveWeekStart = useCallback(async (value: WeekStart) => {
    setWeekStartsOn(value);
    const res = await fetch("/api/settings/week-start", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekStartsOn: value }),
    }).catch(() => null);
    if (!res?.ok) {
      setError("Couldn't save the week start. Check your connection and try again.");
      reload();
      return;
    }
    announce();
  }, [reload]);

  const sorted = useMemo(() => [...habits].sort((a, b) => a.position - b.position), [habits]);

  // Tell the privacy toggle whether private habits exist, and hide them while privacy is on.
  const privacyOn = usePrivacy((s) => s.on);
  const setPrivateHabits = usePrivacy((s) => s.setPrivateHabits);
  const privateCount = sorted.filter((h) => h.private).length;
  useEffect(() => { if (!loading) setPrivateHabits(privateCount); }, [privateCount, loading, setPrivateHabits]);
  const visible = useMemo(() => (privacyOn ? sorted.filter((h) => !h.private) : sorted), [sorted, privacyOn]);

  return {
    habits: visible,
    /** Private habits currently hidden by privacy mode. */
    hiddenCount: privacyOn ? privateCount : 0,
    privacyOn,
    weekStartsOn,
    today,
    loading,
    error,
    clearError: () => setError(null),
    reload,
    setOutcome,
    createHabit,
    updateHabit,
    deleteHabit,
    reorder,
    saveWeekStart,
  };
}
