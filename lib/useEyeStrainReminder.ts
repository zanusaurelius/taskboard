"use client";
import { useEffect } from "react";

const MESSAGES = [
  "Look at something 20 feet away for 20 seconds.",
  "Rest your eyes — focus on a distant object for 20 seconds.",
  "20-20-20 break: find something far away and stare at it for 20 seconds.",
  "Give your eyes a break — look out a window or across the room.",
];

export function fireEyeStrainNotification() {
  if (Notification.permission !== "granted") return;
  const body = MESSAGES[Math.floor(Math.random() * MESSAGES.length)];
  new Notification("Eye Strain Reminder", { body, silent: true });
}

export function useEyeStrainReminder() {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    function restart() {
      if (timer) clearInterval(timer);
      timer = null;
      const enabled = localStorage.getItem("eyeStrainEnabled") === "true";
      const minutes = parseInt(localStorage.getItem("eyeStrainInterval") ?? "20", 10) || 20;
      if (!enabled || Notification.permission !== "granted") return;
      timer = setInterval(fireEyeStrainNotification, minutes * 60 * 1000);
    }

    restart();
    window.addEventListener("eyestrain:update", restart);
    return () => {
      if (timer) clearInterval(timer);
      window.removeEventListener("eyestrain:update", restart);
    };
  }, []);
}
