import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { useRouter } from 'expo-router';
import { login, checkDbStatus, unlockDb } from '@/lib/api';
import { DeviceEventEmitter } from 'react-native';
import { getBaseUrl, setBaseUrl, clearAll } from '@/lib/storage';

type Step = 'loading' | 'server' | 'db-unlock' | 'credentials';

export default function LoginScreen() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('loading');
  const [serverUrl, setServerUrl] = useState('');
  const [dbPassphrase, setDbPassphrase] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const saved = await getBaseUrl();
      if (!saved) { setStep('server'); return; }
      setServerUrl(saved);
      const status = await checkDbStatus(saved);
      setStep(status === 'locked' || status === 'setup' ? 'db-unlock' : 'credentials');
    })();
  }, []);

  const handleConnectServer = async () => {
    const url = serverUrl.trim().replace(/\/$/, '');
    if (!url) { setError('Enter your server URL'); return; }
    if (!url.startsWith('http')) { setError('URL must start with http:// or https://'); return; }
    setLoading(true);
    setError(null);
    const status = await checkDbStatus(url);
    setLoading(false);
    if (status === 'error') { setError('Could not reach server — check the URL and try again'); return; }
    await setBaseUrl(url);
    setServerUrl(url); // keep state in sync with the normalized value used in subsequent steps
    setStep(status === 'locked' || status === 'setup' ? 'db-unlock' : 'credentials');
  };

  const handleDbUnlock = async () => {
    if (!dbPassphrase) { setError('Enter your database passphrase'); return; }
    setLoading(true);
    setError(null);
    const result = await unlockDb(serverUrl, dbPassphrase);
    setLoading(false);
    if (!result.ok) { setError(result.error ?? 'Unlock failed'); return; }
    setDbPassphrase('');
    setStep('credentials');
  };

  const handleLogin = async () => {
    if (!username.trim()) { setError('Enter your username'); return; }
    if (!password) { setError('Enter your password'); return; }
    setLoading(true);
    setError(null);
    const result = await login(serverUrl, username.trim(), password);
    setLoading(false);
    if (!result.ok) {
      if (result.dbLocked) {
        setStep('db-unlock');
        setError('Server database is locked — enter your passphrase to unlock it');
        return;
      }
      setError(result.error ?? 'Login failed');
      return;
    }
    DeviceEventEmitter.emit('auth:login');
    router.replace('/(app)/board');
  };

  const handleChangeServer = () => {
    Alert.alert(
      'Change server',
      'This will sign you out and clear all saved data.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Change server', style: 'destructive',
          onPress: async () => {
            await clearAll();
            setServerUrl('');
            setUsername('');
            setPassword('');
            setDbPassphrase('');
            setError(null);
            setStep('server');
          },
        },
      ],
    );
  };

  if (step === 'loading') {
    return (
      <View style={styles.loadingRoot}>
        <ActivityIndicator color="#6366f1" size="large" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior="padding"
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        <View style={styles.card}>
          <View style={styles.logo}>
            <Text style={styles.logoText}>T</Text>
          </View>
          <Text style={styles.title}>Taskboard</Text>

          {step !== 'server' && (
            <View style={styles.serverChip}>
              <Text style={styles.serverChipText} numberOfLines={1}>{serverUrl}</Text>
              <TouchableOpacity onPress={handleChangeServer}>
                <Text style={styles.changeLink}>Change</Text>
              </TouchableOpacity>
            </View>
          )}

          {step === 'server' && (
            <>
              <Text style={styles.subtitle}>Enter your server address</Text>
              <TextInput
                style={styles.input}
                placeholder="http://youraddress.onion"
                placeholderTextColor="#64748b"
                value={serverUrl}
                onChangeText={(v) => { setServerUrl(v); setError(null); }}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                returnKeyType="go"
                onSubmitEditing={handleConnectServer}
                autoFocus
              />
              {error && <Text style={styles.errorText}>{error}</Text>}
              <TouchableOpacity style={styles.button} onPress={handleConnectServer} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Connect</Text>}
              </TouchableOpacity>
            </>
          )}

          {step === 'db-unlock' && (
            <>
              <Text style={styles.subtitle}>Enter your database passphrase to unlock the server</Text>
              <TextInput
                style={[styles.input, error ? styles.inputError : null]}
                placeholder="Database passphrase"
                placeholderTextColor="#64748b"
                value={dbPassphrase}
                onChangeText={(v) => { setDbPassphrase(v); setError(null); }}
                secureTextEntry
                returnKeyType="go"
                onSubmitEditing={handleDbUnlock}
                autoFocus
              />
              {error && <Text style={styles.errorText}>{error}</Text>}
              <TouchableOpacity style={styles.button} onPress={handleDbUnlock} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Unlock database</Text>}
              </TouchableOpacity>
              {loading && <Text style={styles.hint}>Deriving key… this takes a few seconds</Text>}
            </>
          )}

          {step === 'credentials' && (
            <>
              <Text style={styles.subtitle}>Sign in to your account</Text>
              <TextInput
                style={[styles.input, error ? styles.inputError : null]}
                placeholder="Username"
                placeholderTextColor="#64748b"
                value={username}
                onChangeText={(v) => { setUsername(v); setError(null); }}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                autoFocus
              />
              <TextInput
                style={[styles.input, error ? styles.inputError : null]}
                placeholder="Password"
                placeholderTextColor="#64748b"
                value={password}
                onChangeText={(v) => { setPassword(v); setError(null); }}
                secureTextEntry
                returnKeyType="done"
                onSubmitEditing={handleLogin}
              />
              {error && <Text style={styles.errorText}>{error}</Text>}
              <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in</Text>}
              </TouchableOpacity>
            </>
          )}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#0f172a' },
  loadingRoot: { flex: 1, backgroundColor: '#0f172a', justifyContent: 'center', alignItems: 'center' },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  logo: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#6366f1',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  logoText: { color: '#fff', fontSize: 22, fontWeight: '900' },
  title: { color: '#f1f5f9', fontSize: 22, fontWeight: '700', marginBottom: 4 },
  subtitle: { color: '#64748b', fontSize: 13, marginBottom: 20, textAlign: 'center', marginTop: 4 },
  serverChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 16,
    gap: 8,
    maxWidth: '100%',
  },
  serverChipText: { color: '#475569', fontSize: 12, flex: 1 },
  changeLink: { color: '#6366f1', fontSize: 12, fontWeight: '600' },
  input: {
    width: '100%',
    backgroundColor: '#0f172a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#334155',
    color: '#f1f5f9',
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
  },
  inputError: { borderColor: '#ef4444' },
  errorText: { color: '#ef4444', fontSize: 13, textAlign: 'center', marginBottom: 8 },
  button: {
    width: '100%',
    backgroundColor: '#6366f1',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  hint: { color: '#475569', fontSize: 12, textAlign: 'center', marginTop: 8 },
});
