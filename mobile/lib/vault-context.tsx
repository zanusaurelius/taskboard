import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { deriveKey, decryptMasterKey, encryptContent, decryptContent, fromBase64 } from './vault-crypto';
import type { EncryptedBlob } from './vault-crypto';
import { apiFetch, isOk } from './api';
import type { VaultConfig } from './types';

const AUTO_LOCK_MS = 10 * 60 * 1000; // 10 minutes

interface VaultContextValue {
  masterKey: Uint8Array | null;
  isUnlocked: boolean;
  verifier: string | null;
  unlockWithPassword: (password: string) => Promise<'ok' | 'wrong_password' | 'not_configured' | 'locked'>;
  lock: () => void;
  encrypt: (plaintext: string) => Promise<EncryptedBlob | null>;
  decrypt: (blob: EncryptedBlob | string) => Promise<string | null>;
}

const VaultContext = createContext<VaultContextValue | null>(null);

export function useVault() {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error('useVault must be inside VaultProvider');
  return ctx;
}

export function VaultProvider({ children }: { children: React.ReactNode }) {
  const [masterKey, setMasterKey] = useState<Uint8Array | null>(null);
  const [verifier, setVerifier] = useState<string | null>(null);
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lockedRef = useRef(false); // cancels any in-flight unlock after lock() fires

  const resetLockTimer = useCallback(() => {
    if (lockTimer.current) clearTimeout(lockTimer.current);
    lockTimer.current = setTimeout(() => { setMasterKey(null); setVerifier(null); }, AUTO_LOCK_MS);
  }, []);

  const lock = useCallback(() => {
    if (lockTimer.current) clearTimeout(lockTimer.current);
    lockedRef.current = true;
    setMasterKey(null);
    setVerifier(null);
  }, []);

  // Lock vault when app moves to background
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        lock();
      }
    });
    return () => sub.remove();
  }, [lock]);

  const unlockWithPassword = useCallback(async (password: string): Promise<'ok' | 'wrong_password' | 'not_configured' | 'locked'> => {
    lockedRef.current = false;
    try {
      const result = await apiFetch<VaultConfig>('/api/notes/vault');
      if (!isOk(result)) return 'not_configured';
      if (!result.data.exists) return 'not_configured';
      const { encryptedMasterKey, masterKeySalt, verifier: storedVerifier } = result.data;

      const salt = fromBase64(masterKeySalt);
      const wrappingKey = await deriveKey(password, salt);
      const raw = await decryptMasterKey(JSON.parse(encryptedMasterKey) as EncryptedBlob, wrappingKey);

      // Abort if lock() fired while PBKDF2 was running (e.g. app went to background)
      if (lockedRef.current) return 'locked';

      setMasterKey(raw);
      setVerifier(storedVerifier ?? null);
      resetLockTimer();
      return 'ok';
    } catch {
      return 'wrong_password';
    }
  }, [resetLockTimer]);

  const encrypt = useCallback(async (plaintext: string): Promise<EncryptedBlob | null> => {
    if (!masterKey) return null;
    try {
      return await encryptContent(plaintext, masterKey);
    } catch {
      return null;
    }
  }, [masterKey]);

  const decrypt = useCallback(async (blob: EncryptedBlob | string): Promise<string | null> => {
    if (!masterKey) return null;
    try {
      return await decryptContent(blob, masterKey);
    } catch {
      return null;
    }
  }, [masterKey]);

  return (
    <VaultContext.Provider value={{ masterKey, isUnlocked: masterKey !== null, verifier, unlockWithPassword, lock, encrypt, decrypt }}>
      {children}
    </VaultContext.Provider>
  );
}
