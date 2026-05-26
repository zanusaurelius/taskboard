import { useEffect, useState } from 'react';
import { useRouter, useSegments, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { getToken, getBaseUrl, clearToken } from '@/lib/storage';
import { onUnauthorized, onDbLocked } from '@/lib/api';
import { VaultProvider, useVault } from '@/lib/vault-context';
import { flushQueue, watchConnectivity } from '@/lib/sync';

// Inner component has access to VaultProvider context
function RootNavigator() {
  const router = useRouter();
  const segments = useSegments();
  const { isUnlocked } = useVault();
  const [authState, setAuthState] = useState<'loading' | 'authed' | 'unauthed'>('loading');

  const checkAuth = async () => {
    const [token, baseUrl] = await Promise.all([getToken(), getBaseUrl()]);
    setAuthState(token && baseUrl ? 'authed' : 'unauthed');
  };

  useEffect(() => {
    checkAuth();
    onUnauthorized(() => setAuthState('unauthed'));
    // When DB is locked mid-session, redirect to login so user can re-unlock + re-auth.
    // The Bearer token bypass in proxy.ts means most calls get 401 (not 423) when DB is
    // locked, so this handler catches the rare case where 423 slips through.
    onDbLocked(async () => {
      await clearToken();
      setAuthState('unauthed');
    });
  }, []);

  // Flush offline queue when vault unlocks, and whenever connectivity is restored
  useEffect(() => {
    if (!isUnlocked) return;
    flushQueue();
    return watchConnectivity(() => flushQueue());
  }, [isUnlocked]);

  useEffect(() => {
    if (authState === 'loading') return;
    const inAuth = segments[0] === '(auth)';
    const onVaultScreen = (segments as string[])[1] === 'vault';

    if (authState === 'unauthed') {
      if (!inAuth || onVaultScreen) router.replace('/(auth)/login');
      return;
    }

    // Authed but vault locked → vault screen
    if (!isUnlocked && !(inAuth && onVaultScreen)) {
      router.replace('/(auth)/vault');
      return;
    }

    // Authed + vault unlocked → main app
    if (isUnlocked && inAuth) {
      router.replace('/(app)');
    }
  }, [authState, isUnlocked, segments]);

  return <Stack screenOptions={{ headerShown: false }} />;
}

export default function RootLayout() {
  return (
    <VaultProvider>
      <StatusBar style="light" />
      <RootNavigator />
    </VaultProvider>
  );
}
