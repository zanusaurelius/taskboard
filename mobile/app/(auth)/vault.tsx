import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useVault } from '@/lib/vault-context';

export default function VaultUnlockScreen() {
  const router = useRouter();
  const { unlockWithPassword } = useVault();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUnlock = async () => {
    if (!password) { setError('Enter your vault password'); return; }
    setLoading(true);
    setError(null);
    const result = await unlockWithPassword(password);
    setLoading(false);

    if (result === 'ok') {
      router.replace('/(app)/board');
    } else if (result === 'not_configured') {
      setError('Vault not set up. Open the web app and configure your vault first.');
    } else if (result === 'locked') {
      setError('Vault locked while unlocking (app went to background). Try again.');
    } else {
      setError('Wrong password — check and try again.');
    }
  };

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding">
      <View style={styles.card}>
        <Text style={styles.icon}>🔒</Text>
        <Text style={styles.title}>Unlock your vault</Text>
        <Text style={styles.subtitle}>
          Enter your vault password to decrypt your notes and data
        </Text>

        <TextInput
          style={[styles.input, error ? styles.inputError : null]}
          placeholder="Vault password"
          placeholderTextColor="#64748b"
          value={password}
          onChangeText={(v) => { setPassword(v); setError(null); }}
          secureTextEntry
          returnKeyType="done"
          onSubmitEditing={handleUnlock}
          autoFocus
        />

        {error && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity style={styles.button} onPress={handleUnlock} disabled={loading}>
          {loading
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.buttonText}>Unlock</Text>}
        </TouchableOpacity>

        {loading && (
          <Text style={styles.hint}>Deriving key… this takes a few seconds</Text>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0f172a',
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
    gap: 12,
  },
  icon: { fontSize: 40, marginBottom: 4 },
  title: { color: '#f1f5f9', fontSize: 20, fontWeight: '700' },
  subtitle: { color: '#64748b', fontSize: 13, textAlign: 'center', lineHeight: 18 },
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
    marginTop: 8,
  },
  inputError: { borderColor: '#ef4444' },
  errorText: { color: '#ef4444', fontSize: 13, textAlign: 'center' },
  button: {
    width: '100%',
    backgroundColor: '#6366f1',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  hint: { color: '#475569', fontSize: 12, textAlign: 'center' },
});
