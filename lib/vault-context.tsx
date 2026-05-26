"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import {
  deriveKey, decryptMasterKey, encryptContent, decryptContent,
  computeVerifier, fromBase64, EncryptedBlob,
} from "./vault-crypto";

const AUTO_LOCK_MS = 10 * 60 * 1000; // 10 minutes

interface VaultContextValue {
  // State
  masterKey: Uint8Array | null;
  revealToken: string | null;
  isUnlocked: boolean;
  isRevealed: boolean;
  // Actions
  unlockWithPassword: (password: string) => Promise<boolean>;
  unlockWithRecovery: (code: string) => Promise<boolean>;
  // Key-only variants: decrypt locked notes WITHOUT revealing hidden ones
  unlockKeyOnly: (password: string) => Promise<boolean>;
  unlockKeyOnlyWithRecovery: (code: string) => Promise<boolean>;
  lockVault: () => void;
  reveal: (token: string) => void;
  hideVault: () => void;
  // Crypto helpers
  encrypt: (plaintext: string) => Promise<EncryptedBlob | null>;
  decrypt: (blob: EncryptedBlob) => Promise<string | null>;
}

const VaultContext = createContext<VaultContextValue | null>(null);

export function useVault() {
  const ctx = useContext(VaultContext);
  if (!ctx) throw new Error("useVault must be used inside VaultProvider");
  return ctx;
}

interface VaultConfig {
  encryptedMasterKey: EncryptedBlob;
  masterKeySalt: string;
  encryptedMasterKeyBak: EncryptedBlob;
  backupKeySalt: string;
}

interface VaultProviderProps {
  children: React.ReactNode;
  onAutoLock?: () => void;
  onAutoHide?: () => void;
}

export function VaultProvider({ children, onAutoLock, onAutoHide }: VaultProviderProps) {
  const [masterKey, setMasterKey] = useState<Uint8Array | null>(null);
  const [revealToken, setRevealToken] = useState<string | null>(null);
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetLockTimer = useCallback(() => {
    if (lockTimer.current) clearTimeout(lockTimer.current);
    lockTimer.current = setTimeout(() => {
      setMasterKey(null);
      onAutoLock?.();
    }, AUTO_LOCK_MS);
  }, [onAutoLock]);

  const resetHideTimer = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setRevealToken(null);
      fetch("/api/notes/vault/reveal", { method: "DELETE" }).catch(() => {});
      onAutoHide?.();
    }, AUTO_LOCK_MS);
  }, [onAutoHide]);

  // Reset inactivity timer on user activity
  useEffect(() => {
    if (!masterKey && !revealToken) return;
    const reset = () => {
      if (masterKey) resetLockTimer();
      if (revealToken) resetHideTimer();
    };
    window.addEventListener("mousemove", reset, { passive: true });
    window.addEventListener("keydown", reset, { passive: true });
    return () => {
      window.removeEventListener("mousemove", reset);
      window.removeEventListener("keydown", reset);
    };
  }, [masterKey, revealToken, resetLockTimer, resetHideTimer]);

  // Fetch vault config from server
  const fetchVaultConfig = useCallback(async (): Promise<VaultConfig | null> => {
    const res = await fetch("/api/notes/vault");
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.exists) return null;
    return {
      encryptedMasterKey: JSON.parse(data.encryptedMasterKey),
      masterKeySalt: data.masterKeySalt,
      encryptedMasterKeyBak: JSON.parse(data.encryptedMasterKeyBak),
      backupKeySalt: data.backupKeySalt,
    };
  }, []);

  const unlockWithPassword = useCallback(async (password: string): Promise<boolean> => {
    try {
      const config = await fetchVaultConfig();
      if (!config) return false;
      const salt = fromBase64(config.masterKeySalt);
      const key = await deriveKey(password, salt);
      const raw = await decryptMasterKey(config.encryptedMasterKey, key);
      const verifier = await computeVerifier(raw);
      // Server-verify the derived key is correct
      const res = await fetch("/api/notes/vault/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verifier }),
      });
      if (!res.ok) return false;
      const { token } = await res.json();
      setMasterKey(raw);
      setRevealToken(token);
      resetLockTimer();
      resetHideTimer();
      return true;
    } catch {
      return false;
    }
  }, [fetchVaultConfig, resetLockTimer, resetHideTimer]);

  const unlockWithRecovery = useCallback(async (code: string): Promise<boolean> => {
    try {
      const config = await fetchVaultConfig();
      if (!config) return false;
      const salt = fromBase64(config.backupKeySalt);
      const key = await deriveKey(code.toUpperCase().replace(/[-\s]/g, ""), salt);
      const raw = await decryptMasterKey(config.encryptedMasterKeyBak, key);
      const verifier = await computeVerifier(raw);
      const res = await fetch("/api/notes/vault/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verifier }),
      });
      if (!res.ok) return false;
      const { token } = await res.json();
      setMasterKey(raw);
      setRevealToken(token);
      resetLockTimer();
      resetHideTimer();
      return true;
    } catch {
      return false;
    }
  }, [fetchVaultConfig, resetLockTimer, resetHideTimer]);

  // Unlocks the master key only — hidden notes stay hidden.
  // Verification is purely client-side: AES-GCM decryptMasterKey throws if the password is wrong.
  const unlockKeyOnly = useCallback(async (password: string): Promise<boolean> => {
    try {
      const config = await fetchVaultConfig();
      if (!config) return false;
      const salt = fromBase64(config.masterKeySalt);
      const key = await deriveKey(password, salt);
      const raw = await decryptMasterKey(config.encryptedMasterKey, key);
      setMasterKey(raw);
      resetLockTimer();
      return true;
    } catch {
      return false;
    }
  }, [fetchVaultConfig, resetLockTimer]);

  const unlockKeyOnlyWithRecovery = useCallback(async (code: string): Promise<boolean> => {
    try {
      const config = await fetchVaultConfig();
      if (!config) return false;
      const salt = fromBase64(config.backupKeySalt);
      const key = await deriveKey(code.toUpperCase().replace(/[-\s]/g, ""), salt);
      const raw = await decryptMasterKey(config.encryptedMasterKeyBak, key);
      setMasterKey(raw);
      resetLockTimer();
      return true;
    } catch {
      return false;
    }
  }, [fetchVaultConfig, resetLockTimer]);

  const lockVault = useCallback(() => {
    if (lockTimer.current) clearTimeout(lockTimer.current);
    setMasterKey(null);
  }, []);

  const reveal = useCallback((token: string) => {
    setRevealToken(token);
    resetHideTimer();
  }, [resetHideTimer]);

  const hideVault = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setRevealToken(null);
    fetch("/api/notes/vault/reveal", { method: "DELETE" }).catch(() => {});
  }, []);

  const encrypt = useCallback(async (plaintext: string): Promise<EncryptedBlob | null> => {
    if (!masterKey) return null;
    return encryptContent(plaintext, masterKey);
  }, [masterKey]);

  const decrypt = useCallback(async (blob: EncryptedBlob): Promise<string | null> => {
    if (!masterKey) return null;
    try {
      return await decryptContent(blob, masterKey);
    } catch {
      return null;
    }
  }, [masterKey]);

  return (
    <VaultContext.Provider value={{
      masterKey,
      revealToken,
      isUnlocked: masterKey !== null,
      isRevealed: revealToken !== null,
      unlockWithPassword,
      unlockWithRecovery,
      unlockKeyOnly,
      unlockKeyOnlyWithRecovery,
      lockVault,
      reveal,
      hideVault,
      encrypt,
      decrypt,
    }}>
      {children}
    </VaultContext.Provider>
  );
}
