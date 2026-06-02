"use client";
import { useEffect, useRef } from "react";
import { useVault } from "@/lib/vault-context";

const DONE_KEY = "e2e_reversal_v2";

interface Props {
  onComplete: (didRun: boolean) => void;
}

export default function E2EReversal({ onComplete }: Props) {
  const { masterKey, decrypt } = useVault();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    if (!masterKey) {
      // No vault configured — nothing to reverse, mark done immediately
      ran.current = true;
      localStorage.setItem(DONE_KEY, "1");
      onComplete(false);
      return;
    }
    ran.current = true;
    run()
      .then(() => {
        localStorage.setItem(DONE_KEY, "1");
        onComplete(true);
      })
      .catch(() => {
        ran.current = false;
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masterKey]);

  async function dec(enc: string | null | undefined): Promise<string | null> {
    if (!enc) return null;
    // Let the error propagate — reversal halts rather than silently writing empty strings
    return await decrypt(JSON.parse(enc) as Parameters<typeof decrypt>[0]);
  }

  async function run() {
    // Tasks
    const tasks = await fetch("/api/tasks?includeArchived=true").then(r => r.ok ? r.json() : []).catch(() => []) as Record<string, unknown>[];
    for (const t of tasks) {
      if (!t.encTitle && !t.encDescription) continue;
      const title = (await dec(t.encTitle as string)) ?? (t.title as string ?? "");
      const description = (await dec(t.encDescription as string)) ?? (t.description as string ?? "");
      if (!title) continue;
      await fetch(`/api/tasks/${t.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...t, title, encTitle: null, description, encDescription: null }),
      }).catch(() => {});
    }

    // Projects
    const projects = await fetch("/api/projects").then(r => r.ok ? r.json() : []).catch(() => []) as Record<string, unknown>[];
    for (const p of projects) {
      if (!p.encName) continue;
      const name = (await dec(p.encName as string)) ?? (p.name as string ?? "");
      if (!name.trim()) continue;
      await fetch(`/api/projects/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, encName: null }),
      }).catch(() => {});
    }

    // Folders
    const folders = await fetch("/api/folders").then(r => r.ok ? r.json() : []).catch(() => []) as Record<string, unknown>[];
    for (const f of folders) {
      if (!f.encName) continue;
      const name = (await dec(f.encName as string)) ?? (f.name as string ?? "");
      if (!name.trim()) continue;
      await fetch(`/api/folders/${f.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...f, name, encName: null }),
      }).catch(() => {});
    }

    // Notes (skip vault notes — hidden/locked stay encrypted)
    const notes = await fetch("/api/notes").then(r => r.ok ? r.json() : []).catch(() => []) as Record<string, unknown>[];
    for (const n of notes) {
      if (n.hidden || n.locked) continue;
      if (!n.encTitle && !n.encContent) continue;
      const title = (await dec(n.encTitle as string)) ?? (n.title as string ?? "");
      const content = (await dec(n.encContent as string)) ?? (n.content as string ?? "");
      await fetch(`/api/notes/${n.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...n, title, encTitle: null, content, encContent: null }),
      }).catch(() => {});
    }

    // Daily Goals (all dates)
    const goals = await fetch("/api/daily-goals?all=true").then(r => r.ok ? r.json() : []).catch(() => []) as Record<string, unknown>[];
    for (const g of goals) {
      if (!g.encText) continue;
      const text = await dec(g.encText as string);
      if (!text?.trim()) continue;
      await fetch(`/api/daily-goals/${g.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, encText: null, date: g.date, completed: g.completed, position: g.position }),
      }).catch(() => {});
    }

    // Habits
    const habits = await fetch("/api/habits").then(r => r.ok ? r.json() : []).catch(() => []) as Record<string, unknown>[];
    for (const h of habits) {
      if (!h.encText) continue;
      const text = await dec(h.encText as string);
      if (!text?.trim()) continue;
      await fetch(`/api/habits/${h.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, encText: null }),
      }).catch(() => {});
    }

    // Daily Reflections
    const reflections = await fetch("/api/daily-reflections").then(r => r.ok ? r.json() : []).catch(() => []) as Record<string, unknown>[];
    for (const r of reflections) {
      if (!r.encNote && !r.encGratitude && !r.encBody) continue;
      const note      = r.encNote      ? ((await dec(r.encNote as string))      ?? (r.note as string      ?? "")) : (r.note as string      ?? "");
      const gratitude = r.encGratitude ? ((await dec(r.encGratitude as string)) ?? (r.gratitude as string ?? "")) : (r.gratitude as string ?? "");
      const body      = r.encBody      ? ((await dec(r.encBody as string))      ?? (r.body as string      ?? "")) : (r.body as string      ?? "");
      await fetch("/api/daily-reflections", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: r.date, note, encNote: null, gratitude, encGratitude: null, body, encBody: null }),
      }).catch(() => {});
    }
  }

  return null;
}
