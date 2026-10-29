"use client";
import { create } from "zustand";

// Privacy mode hides sensitive tasks and private habits from anyone looking at the screen.
// It is on by default, shared by every view, and turns back on whenever the vault locks.

interface PrivacyState {
  on: boolean;
  setOn: (on: boolean) => void;
  /** How many private habits exist, so the toggle knows whether revealing needs the vault. */
  privateHabits: number;
  setPrivateHabits: (n: number) => void;
}

export const usePrivacy = create<PrivacyState>((set) => ({
  on: true,
  setOn: (on) => set({ on }),
  privateHabits: 0,
  setPrivateHabits: (privateHabits) => set({ privateHabits }),
}));
