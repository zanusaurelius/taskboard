import { useSyncExternalStore } from 'react';
import * as SecureStore from 'expo-secure-store';

// Privacy mode hides sensitive tasks and private habits. One value for the whole app, saved
// across launches. On by default.

const KEY = 'taskboard_privacy_mode';
let on = true;
const listeners = new Set<() => void>();

SecureStore.getItemAsync(KEY).then((v) => {
  if (v !== null) setPrivacyMode(v === 'true');
}).catch(() => {});

export function setPrivacyMode(next: boolean) {
  if (next === on) return;
  on = next;
  SecureStore.setItemAsync(KEY, String(next)).catch(() => {});
  listeners.forEach((l) => l());
}

export function usePrivacyMode(): [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => on,
  );
  return [value, setPrivacyMode];
}
