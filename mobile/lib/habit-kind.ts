import type { HabitKind } from "./habit-stats";

// Wording and name presets per habit kind. GOOD: a day you do it is a W. BAD: a day without it
// is a W. mobile/lib/habit-kind.ts is a copy; keep the two identical.

interface KindCopy {
  title: string;
  group: string;
  explainer: string;
  win: string;
  loss: string;
}

export const KIND_COPY: Record<HabitKind, KindCopy> = {
  GOOD: {
    title: "Good habit",
    group: "Good habits",
    explainer: "Something to do every day. A day you do it is a W.",
    win: "Did it",
    loss: "Missed it",
  },
  BAD: {
    title: "Bad habit",
    group: "Bad habits",
    explainer: "Something to stop. A day without it is a W.",
    win: "Avoided it",
    loss: "Did it",
  },
};

export const PRESETS: Record<HabitKind, string[]> = {
  GOOD: [
    "Exercise",
    "Read",
    "Meditate",
    "Walk 10k steps",
    "Journal",
    "Stretch",
    "In bed by 10",
  ],
  BAD: [
    "Porn",
    "Weed",
    "Smoking",
    "Vaping",
    "Drinking alcohol",
    "Gambling",
    "Doom scrolling",
    "Junk food",
    "Energy drinks",
    "Snoozing the alarm",
    "Impulse shopping",
    "Nail biting",
  ],
};
