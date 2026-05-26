import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, ScrollView, RefreshControl, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { apiFetch, isOk } from '@/lib/api';
import { useVault } from '@/lib/vault-context';
import { enqueue } from '@/lib/offline-db';
import type { DailyReflection } from '@/lib/types';

const localDateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const formatDay = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

interface DecryptedReflection extends DailyReflection {
  _note: string;
  _gratitude: string;
  _body: string;
}

export default function JournalScreen() {
  const { encrypt, decrypt, isUnlocked } = useVault();
  const [entries, setEntries] = useState<DecryptedReflection[]>([]);
  const [selected, setSelected] = useState<DecryptedReflection | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const today = localDateStr(new Date());

  // Editable fields for today's entry
  const [note, setNote] = useState('');
  const [gratitude, setGratitude] = useState('');
  const [body, setBody] = useState('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchAndDecrypt = useCallback(async () => {
    const result = await apiFetch<DailyReflection[]>('/api/daily-reflections');
    if (!isOk(result)) { setLoading(false); setRefreshing(false); return; }

    const decrypted = await Promise.all(result.data.map(async (e) => ({
      ...e,
      _note: e.encNote ? (await decrypt(e.encNote) ?? e.note ?? '') : (e.note ?? ''),
      _gratitude: e.encGratitude ? (await decrypt(e.encGratitude) ?? e.gratitude ?? '') : (e.gratitude ?? ''),
      _body: e.encBody ? (await decrypt(e.encBody) ?? e.body ?? '') : (e.body ?? ''),
    })));

    setEntries(decrypted);
    const todayEntry = decrypted.find((e) => e.date === today) ?? null;
    setSelected(todayEntry);

    // Sync edit fields with today's entry (only if not dirty)
    if (!dirty) {
      setNote(todayEntry?._note ?? '');
      setGratitude(todayEntry?._gratitude ?? '');
      setBody(todayEntry?._body ?? '');
    }

    setLoading(false);
    setRefreshing(false);
  }, [decrypt, today, dirty]);

  useEffect(() => { fetchAndDecrypt(); }, [fetchAndDecrypt, isUnlocked]);

  const selectEntry = (entry: DecryptedReflection | null) => {
    if (dirty) {
      Alert.alert('Unsaved changes', 'You have unsaved changes for today. Save first?', [
        { text: 'Discard', style: 'destructive', onPress: () => { setDirty(false); setSelected(entry); } },
        { text: 'Stay', style: 'cancel' },
      ]);
      return;
    }
    setSelected(entry);
  };

  const save = useCallback(async () => {
    if (saving || !dirty) return;
    setSaving(true);

    const encNoteBlob = note.trim() ? await encrypt(note) : null;
    const encGratitudeBlob = gratitude.trim() ? await encrypt(gratitude) : null;
    const encBodyBlob = body.trim() ? await encrypt(body) : null;

    const payload = {
      date: today,
      note: '',
      encNote: encNoteBlob ? JSON.stringify(encNoteBlob) : null,
      gratitude: '',
      encGratitude: encGratitudeBlob ? JSON.stringify(encGratitudeBlob) : null,
      body: '',
      encBody: encBodyBlob ? JSON.stringify(encBodyBlob) : null,
    };

    const result = await apiFetch<DailyReflection>('/api/daily-reflections', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });

    if (isOk(result)) {
      setDirty(false);
      // Update entries list with new encrypted data
      const updated: DecryptedReflection = { ...result.data, _note: note, _gratitude: gratitude, _body: body };
      setEntries((prev) => {
        const existing = prev.findIndex((e) => e.date === today);
        if (existing >= 0) {
          const next = [...prev];
          next[existing] = updated;
          return next;
        }
        return [updated, ...prev];
      });
      setSelected(updated);
    } else if ((result as { status?: number }).status === 0) {
      await enqueue('PUT', '/api/daily-reflections', payload);
      Alert.alert('Saved offline', 'Entry will sync when you reconnect.');
      setDirty(false);
    } else {
      Alert.alert('Error', 'Could not save entry. Try again.');
    }

    setSaving(false);
  }, [saving, dirty, today, note, gratitude, body, encrypt]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color="#6366f1" size="large" /></View>;
  }

  const isToday = selected?.date === today || selected === null;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.titleRow}>
        <Text style={styles.heading}>Journal</Text>
        {isToday && dirty && (
          <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving}>
            {saving
              ? <ActivityIndicator color="#6366f1" size="small" />
              : <Text style={styles.saveBtnText}>Save</Text>}
          </TouchableOpacity>
        )}
      </View>

      {/* Entry sidebar */}
      <ScrollView
        horizontal={false}
        style={styles.sidebar}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAndDecrypt(); }} tintColor="#6366f1" />}
      >
        <TouchableOpacity
          style={[styles.entryRow, isToday && styles.entryRowActive]}
          onPress={() => selectEntry(entries.find((e) => e.date === today) ?? null)}
        >
          <Text style={[styles.entryDate, isToday && styles.entryDateActive]}>Today</Text>
          <Text style={styles.entrySubDate}>{formatDay(today)}</Text>
        </TouchableOpacity>

        {entries.filter((e) => e.date !== today).map((item) => (
          <TouchableOpacity
            key={item.id}
            style={[styles.entryRow, selected?.id === item.id && styles.entryRowActive]}
            onPress={() => selectEntry(item)}
          >
            <Text style={[styles.entryDate, selected?.id === item.id && styles.entryDateActive]}>
              {formatDay(item.date)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Detail / Editor */}
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.detail} contentContainerStyle={styles.detailContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.detailDate}>
            {isToday ? 'Today' : selected ? formatDay(selected.date) : ''}
          </Text>

          {isToday ? (
            // Editable today's entry
            <>
              <Text style={styles.fieldLabel}>One thing to do better tomorrow</Text>
              <TextInput
                style={styles.fieldInput}
                value={note}
                onChangeText={(v) => { setNote(v); setDirty(true); }}
                placeholder="What could go better?"
                placeholderTextColor="#334155"
                multiline
              />
              <Text style={styles.fieldLabel}>One thing I'm grateful for</Text>
              <TextInput
                style={styles.fieldInput}
                value={gratitude}
                onChangeText={(v) => { setGratitude(v); setDirty(true); }}
                placeholder="Something you appreciated today"
                placeholderTextColor="#334155"
                multiline
              />
              <Text style={styles.fieldLabel}>Journal</Text>
              <TextInput
                style={[styles.fieldInput, styles.fieldInputTall]}
                value={body}
                onChangeText={(v) => { setBody(v); setDirty(true); }}
                placeholder="How did today go?"
                placeholderTextColor="#334155"
                multiline
                textAlignVertical="top"
              />
            </>
          ) : selected ? (
            // Read-only past entries
            <>
              <Text style={styles.fieldLabel}>One thing to do better tomorrow</Text>
              <View style={styles.fieldBox}>
                <Text style={styles.fieldText}>{selected._note || '—'}</Text>
              </View>
              <Text style={styles.fieldLabel}>One thing I'm grateful for</Text>
              <View style={styles.fieldBox}>
                <Text style={styles.fieldText}>{selected._gratitude || '—'}</Text>
              </View>
              <Text style={styles.fieldLabel}>Journal</Text>
              <View style={styles.fieldBox}>
                <Text style={styles.fieldText}>{selected._body || '—'}</Text>
              </View>
            </>
          ) : (
            <View style={styles.emptyDetail}>
              <Text style={styles.emptyText}>Select a day to view your entry</Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a' },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a' },
  titleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8,
  },
  heading: { color: '#f1f5f9', fontSize: 26, fontWeight: '800' },
  saveBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: 'rgba(99,102,241,0.15)' },
  saveBtnText: { color: '#6366f1', fontSize: 15, fontWeight: '700' },
  sidebar: { maxHeight: 180, borderBottomWidth: 1, borderColor: '#1e293b' },
  entryRow: { paddingHorizontal: 20, paddingVertical: 10, borderLeftWidth: 3, borderLeftColor: 'transparent' },
  entryRowActive: { backgroundColor: 'rgba(99,102,241,0.08)', borderLeftColor: '#6366f1' },
  entryDate: { color: '#94a3b8', fontSize: 14, fontWeight: '600' },
  entryDateActive: { color: '#a5b4fc' },
  entrySubDate: { color: '#475569', fontSize: 12, marginTop: 1 },
  detail: { flex: 1 },
  detailContent: { padding: 20, gap: 10, paddingBottom: 60 },
  detailDate: { color: '#f1f5f9', fontSize: 18, fontWeight: '700', marginBottom: 4 },
  fieldLabel: { color: '#64748b', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  fieldInput: {
    backgroundColor: '#1e293b', borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: '#334155', color: '#cbd5e1', fontSize: 14, lineHeight: 20,
  },
  fieldInputTall: { minHeight: 120, textAlignVertical: 'top' },
  fieldBox: { backgroundColor: '#1e293b', borderRadius: 10, padding: 14, borderWidth: 1, borderColor: '#334155' },
  fieldText: { color: '#cbd5e1', fontSize: 14, lineHeight: 20 },
  emptyDetail: { flex: 1, alignItems: 'center', paddingTop: 60 },
  emptyText: { color: '#475569', fontSize: 15 },
});
