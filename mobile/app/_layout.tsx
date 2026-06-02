import { useEffect, useState } from 'react';
import { Alert, TextInput, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter, useSegments, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { getToken, getBaseUrl } from '@/lib/storage';
import { onUnauthorized, onDbLocked, checkDbStatus, unlockDb } from '@/lib/api';
import { DeviceEventEmitter } from 'react-native';
import { VaultProvider, useVault } from '@/lib/vault-context';
import { flushQueue, watchConnectivity } from '@/lib/sync';

// Inner component has access to VaultProvider context
function RootNavigator() {
  const router = useRouter();
  const segments = useSegments();
  useVault(); // keep VaultProvider context alive for optional vault features
  const [authState, setAuthState] = useState<'loading' | 'authed' | 'unauthed'>('loading');
  const [dbLocked, setDbLocked] = useState(false);
  const [dbPassphrase, setDbPassphrase] = useState('');
  const [dbUnlocking, setDbUnlocking] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);

  const checkAuth = async () => {
    const [token, baseUrl] = await Promise.all([getToken(), getBaseUrl()]);
    if (!token || !baseUrl) { setAuthState('unauthed'); return; }
    // Check if DB is locked — if so, show unlock prompt before proceeding
    const dbStatus = await checkDbStatus(baseUrl);
    if (dbStatus === 'locked') {
      setDbLocked(true);
      setAuthState('authed'); // auth is fine, just need DB unlock
      return;
    }
    setAuthState('authed');
  };

  const handleDbUnlock = async () => {
    if (!dbPassphrase) return;
    setDbUnlocking(true);
    setDbError(null);
    const baseUrl = await getBaseUrl();
    const result = await unlockDb(baseUrl, dbPassphrase);
    setDbUnlocking(false);
    if (!result.ok) { setDbError(result.error ?? 'Unlock failed — check your passphrase'); return; }
    setDbLocked(false);
    setDbPassphrase('');
  };

  useEffect(() => {
    checkAuth();
    onUnauthorized(() => setAuthState('unauthed'));
    onDbLocked(() => {
      setDbLocked(true);
    });
    // Login screen emits this after storing the token so we re-check immediately,
    // avoiding a race where authState is still 'unauthed' when navigation fires.
    const sub = DeviceEventEmitter.addListener('auth:login', checkAuth);
    return () => sub.remove();
  }, []);

  // Flush offline queue on auth and whenever connectivity is restored
  useEffect(() => {
    if (authState !== 'authed') return;
    flushQueue();
    return watchConnectivity(() => flushQueue());
  }, [authState]);

  useEffect(() => {
    if (authState === 'loading') return;
    const inAuth = segments[0] === '(auth)';

    if (authState === 'unauthed') {
      if (!inAuth) {
        router.replace('/(auth)/login');
      }
      return;
    }

    // Authed → main app (vault is optional, not a blocking gate)
    if (inAuth) {
      router.replace('/(app)/board');
    }
  }, [authState, segments]);

  if (dbLocked) {
    return (
      <View style={dbStyles.root}>
        <View style={dbStyles.card}>
          <Text style={dbStyles.icon}>🔐</Text>
          <Text style={dbStyles.title}>Database locked</Text>
          <Text style={dbStyles.subtitle}>Enter your database passphrase to continue</Text>
          <TextInput
            style={[dbStyles.input, dbError ? dbStyles.inputError : null]}
            placeholder="Database passphrase"
            placeholderTextColor="#64748b"
            value={dbPassphrase}
            onChangeText={(v) => { setDbPassphrase(v); setDbError(null); }}
            secureTextEntry
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleDbUnlock}
          />
          {dbError && <Text style={dbStyles.error}>{dbError}</Text>}
          <TouchableOpacity style={dbStyles.btn} onPress={handleDbUnlock} disabled={dbUnlocking || !dbPassphrase}>
            {dbUnlocking ? <ActivityIndicator color="#fff" /> : <Text style={dbStyles.btnText}>Unlock</Text>}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}

const dbStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 380, backgroundColor: '#1e293b', borderRadius: 16, padding: 28, alignItems: 'center', gap: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  icon: { fontSize: 40, marginBottom: 4 },
  title: { color: '#f1f5f9', fontSize: 20, fontWeight: '700' },
  subtitle: { color: '#64748b', fontSize: 13, textAlign: 'center', lineHeight: 18 },
  input: { width: '100%', backgroundColor: '#0f172a', borderRadius: 10, borderWidth: 1, borderColor: '#334155', color: '#f1f5f9', fontSize: 15, paddingHorizontal: 14, paddingVertical: 12, marginTop: 8 },
  inputError: { borderColor: '#ef4444' },
  error: { color: '#ef4444', fontSize: 13, textAlign: 'center' },
  btn: { width: '100%', backgroundColor: '#6366f1', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <VaultProvider>
        <StatusBar style="light" />
        <RootNavigator />
      </VaultProvider>
    </GestureHandlerRootView>
  );
}
