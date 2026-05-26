import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { getBaseUrl, clearAll } from '@/lib/storage';
import { logout } from '@/lib/api';
import { pendingCount } from '@/lib/sync';

export default function SettingsScreen() {
  const router = useRouter();
  const [serverUrl, setServerUrl] = useState('');
  const [pending, setPending] = useState(0);

  useEffect(() => {
    getBaseUrl().then(setServerUrl);
    pendingCount().then(setPending);
  }, []);

  const handleLogout = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out', style: 'destructive',
        onPress: async () => {
          await logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const handleChangeServer = () => {
    Alert.alert(
      'Change server',
      'This will sign you out and clear all saved data on this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Change server', style: 'destructive',
          onPress: async () => {
            await clearAll();
            router.replace('/(auth)/login');
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Text style={styles.heading}>Settings</Text>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Server</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Address</Text>
          <Text style={styles.rowValue} numberOfLines={1}>{serverUrl || '—'}</Text>
        </View>
        <TouchableOpacity style={[styles.row, styles.rowMt]} onPress={handleChangeServer}>
          <Text style={styles.rowLabel}>Change server</Text>
          <Text style={styles.rowChevron}>›</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Sync</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Pending changes</Text>
          <Text style={[styles.rowValue, pending > 0 && styles.pending]}>{pending}</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>Account</Text>
        <TouchableOpacity style={styles.dangerRow} onPress={handleLogout}>
          <Text style={styles.dangerText}>Sign out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a' },
  heading: { color: '#f1f5f9', fontSize: 26, fontWeight: '800', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
  section: { marginBottom: 24, paddingHorizontal: 20 },
  sectionLabel: { color: '#475569', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  row: {
    backgroundColor: '#1e293b', borderRadius: 12, padding: 16,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1, borderColor: '#334155',
  },
  rowMt: { marginTop: 8 },
  rowLabel: { color: '#94a3b8', fontSize: 15 },
  rowValue: { color: '#64748b', fontSize: 14, maxWidth: '60%', textAlign: 'right' },
  rowChevron: { color: '#475569', fontSize: 20 },
  pending: { color: '#f59e0b', fontWeight: '700' },
  dangerRow: {
    backgroundColor: '#1e293b', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: '#334155', alignItems: 'center',
  },
  dangerText: { color: '#ef4444', fontSize: 15, fontWeight: '600' },
});
