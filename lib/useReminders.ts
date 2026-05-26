"use client";
import { useEffect } from "react";

export interface Reminder {
  id: string;
  title: string;
  body: string;
  intervalMinutes: number;
  enabled: boolean;
}

export function loadReminders(): Reminder[] {
  try {
    return JSON.parse(localStorage.getItem("reminders") ?? "[]");
  } catch {
    return [];
  }
}

export function saveReminders(reminders: Reminder[]) {
  localStorage.setItem("reminders", JSON.stringify(reminders));
  window.dispatchEvent(new Event("reminders:update"));
}

async function showNotification(title: string, body: string) {
  if (Notification.permission !== "granted") return;
  if ("serviceWorker" in navigator) {
    try {
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("sw-timeout")), 3000)),
      ]);
      await reg.showNotification(title, { body: body || undefined, silent: true });
      return;
    } catch {
      // fall through to legacy constructor
    }
  }
  new Notification(title, { body: body || undefined, silent: true });
}

export function fireReminder(r: Reminder) {
  showNotification(r.title, r.body).catch(() => {});
}

export function useReminders() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }

    const timers = new Map<string, ReturnType<typeof setInterval>>();

    function restart() {
      timers.forEach((t) => clearInterval(t));
      timers.clear();
      if (Notification.permission !== "granted") return;
      for (const r of loadReminders()) {
        if (!r.enabled) continue;
        timers.set(r.id, setInterval(() => fireReminder(r), r.intervalMinutes * 60 * 1000));
      }
    }

    restart();
    window.addEventListener("reminders:update", restart);
    return () => {
      timers.forEach((t) => clearInterval(t));
      window.removeEventListener("reminders:update", restart);
    };
  }, []);
}
