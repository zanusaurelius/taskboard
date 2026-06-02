import { useEffect, useRef, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  ActivityIndicator, StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useVault } from '@/lib/vault-context';

interface Props {
  visible: boolean;
  onSuccess: () => void;
  onCancel: () => void;
}

export default function VaultUnlockModal({ visible, onSuccess, onCancel }: Props) {
  const { unlockWithPassword } = useVault();
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (visible) {
      setPassword('');
      setError(null);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [visible]);

  const handleUnlock = async () => {
    if (!password) { setError('Enter your vault password'); return; }
    setLoading(true);
    setError(null);
    const result = await unlockWithPassword(password);
    setLoading(false);
    if (result === 'ok') {
      onSuccess();
    } else if (result === 'not_configured') {
      setError('Vault not set up. Configure it in the web app first.');
    } else if (result === 'locked') {
      setError('Vault locked while unlocking. Try again.');
    } else {
      setError('Wrong password — try again.');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.card}>
          <Text style={styles.title}>Unlock Vault</Text>
          <Text style={styles.subtitle}>Enter your vault password to view protected tasks</Text>
          <TextInput
            ref={inputRef}
            style={[styles.input, error ? styles.inputError : null]}
            placeholder="Vault password"
            placeholderTextColor="#64748b"
            value={password}
            onChangeText={(v) => { setPassword(v); setError(null); }}
            secureTextEntry
            returnKeyType="done"
            onSubmitEditing={handleUnlock}
          />
          {error && <Text style={styles.errorText}>{error}</Text>}
          <TouchableOpacity style={styles.button} onPress={handleUnlock} disabled={loading}>
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.buttonText}>Unlock</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 360,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f1f5f9',
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 13,
    color: '#94a3b8',
    marginBottom: 20,
    lineHeight: 18,
  },
  input: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    color: '#f1f5f9',
    marginBottom: 8,
  },
  inputError: {
    borderColor: '#ef4444',
  },
  errorText: {
    color: '#f87171',
    fontSize: 13,
    marginBottom: 12,
  },
  button: {
    backgroundColor: '#6366f1',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  cancelButton: {
    alignItems: 'center',
    padding: 12,
    marginTop: 4,
  },
  cancelText: {
    color: '#64748b',
    fontSize: 14,
  },
});
