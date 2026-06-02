import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, ScrollView, RefreshControl,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { apiFetch, isOk } from '@/lib/api';
import { useVault } from '@/lib/vault-context';
import { enqueue } from '@/lib/offline-db';
import type { DailyReflection } from '@/lib/types';

const localDateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const formatDay = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

const formatDayFull = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

const monthKey = (iso: string) => iso.slice(0, 7);
const monthLabel = (key: string) =>
  new Date(key + '-01T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

interface DecryptedReflection extends DailyReflection {
  _note: string;
  _gratitude: string;
  _body: string;
}

export default function JournalScreen() {
  const { encrypt, decrypt, isUnlocked } = useVault();
  const { date: paramDate } = useLocalSearchParams<{ date?: string }>();
  const [entries, setEntries] = useState<DecryptedReflection[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const today = localDateStr(new Date());

  const [selectedDate, setSelectedDate] = useState(paramDate ?? today);

  // Update selected date if navigated to with a different date param (e.g. from search results)
  useEffect(() => {
    if (paramDate) setSelectedDate(paramDate);
  }, [paramDate]);
  const [search, setSearch] = useState('');
  const [focusField, setFocusField] = useState<'note' | 'gratitude' | 'body' | null>(null);

  // Editable fields
  const [note, setNote] = useState('');
  const [gratitude, setGratitude] = useState('');
  const [body, setBody] = useState('');
  const [saved, setSaved] = useState(false);
  const [editorCollapsed, setEditorCollapsed] = useState(false);

  // Refs to latest field values so debounce timers always read current state
  const noteRef = useRef(note);
  const gratRef = useRef(gratitude);
  const bodyRef = useRef(body);
  useEffect(() => { noteRef.current = note; }, [note]);
  useEffect(() => { gratRef.current = gratitude; }, [gratitude]);
  useEffect(() => { bodyRef.current = body; }, [body]);

  // Debounce timers
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gratTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Tracks which date's data is currently loaded into the edit fields

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
    setLoading(false);
    setRefreshing(false);
  }, [decrypt]);

  useFocusEffect(useCallback(() => {
    fetchAndDecrypt();
  }, [fetchAndDecrypt, isUnlocked]));

  // Load editing fields when the selected date changes or entries first arrive from fetch.
  // No ref guard here — save() only updates entries with the user's own current input,
  // so re-running on entries change is always safe (it either confirms what was typed or
  // loads freshly fetched server data).
  useEffect(() => {
    const entry = entries.find((e) => e.date === selectedDate);
    setNote(entry?._note ?? '');
    setGratitude(entry?._gratitude ?? '');
    setBody(entry?._body ?? '');
  }, [selectedDate, entries]);

  const flashSaved = useCallback(() => {
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2000);
  }, []);

  const save = useCallback(async (n: string, g: string, b: string) => {
    const encNoteBlob = n.trim() ? await encrypt(n) : null;
    const encGratitudeBlob = g.trim() ? await encrypt(g) : null;
    const encBodyBlob = b.trim() ? await encrypt(b) : null;

    const encNote = encNoteBlob ? JSON.stringify(encNoteBlob) : null;
    const encGratitude = encGratitudeBlob ? JSON.stringify(encGratitudeBlob) : null;
    const encBody = encBodyBlob ? JSON.stringify(encBodyBlob) : null;

    const payload = {
      date: selectedDate,
      note: encNote ? '' : n,
      encNote,
      gratitude: encGratitude ? '' : g,
      encGratitude,
      body: encBody ? '' : b,
      encBody,
    };

    const result = await apiFetch<DailyReflection>('/api/daily-reflections', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });

    if (isOk(result)) {
      flashSaved();
      const updated: DecryptedReflection = { ...result.data, _note: n, _gratitude: g, _body: b };
      setEntries((prev) => {
        const exists = prev.find((e) => e.date === selectedDate);
        if (!n.trim() && !g.trim() && !b.trim()) {
          return prev.filter((e) => e.date !== selectedDate);
        }
        if (exists) return prev.map((e) => e.date === selectedDate ? updated : e);
        return [updated, ...prev].sort((a, b) => b.date.localeCompare(a.date));
      });
    } else if ((result as { status?: number }).status === 0) {
      await enqueue('PUT', '/api/daily-reflections', payload);
      flashSaved();
    }
  }, [selectedDate, encrypt, flashSaved]);

  const handleNote = (v: string) => {
    setNote(v);
    noteRef.current = v;
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => save(v, gratRef.current, bodyRef.current), 800);
  };
  const handleNoteBlur = () => {
    if (noteTimer.current) clearTimeout(noteTimer.current);
    save(noteRef.current, gratRef.current, bodyRef.current);
  };

  const handleGrat = (v: string) => {
    setGratitude(v);
    gratRef.current = v;
    if (gratTimer.current) clearTimeout(gratTimer.current);
    gratTimer.current = setTimeout(() => save(noteRef.current, v, bodyRef.current), 800);
  };
  const handleGratBlur = () => {
    if (gratTimer.current) clearTimeout(gratTimer.current);
    save(noteRef.current, gratRef.current, bodyRef.current);
  };

  const handleBody = (v: string) => {
    setBody(v);
    bodyRef.current = v;
    if (bodyTimer.current) clearTimeout(bodyTimer.current);
    bodyTimer.current = setTimeout(() => save(noteRef.current, gratRef.current, v), 800);
  };
  const handleBodyBlur = () => {
    if (bodyTimer.current) clearTimeout(bodyTimer.current);
    save(noteRef.current, gratRef.current, bodyRef.current);
  };

  const selectDate = (date: string) => {
    // If there are unsaved changes pending, flush them to the current date before switching.
    if (noteTimer.current || gratTimer.current || bodyTimer.current) {
      if (noteTimer.current) clearTimeout(noteTimer.current);
      if (gratTimer.current) clearTimeout(gratTimer.current);
      if (bodyTimer.current) clearTimeout(bodyTimer.current);
      save(noteRef.current, gratRef.current, bodyRef.current);
    }
    setSelectedDate(date);
  };

  // Search filter
  const lq = search.trim().toLowerCase();
  const filtered = lq
    ? entries.filter((e) =>
        e._note.toLowerCase().includes(lq) ||
        e._gratitude.toLowerCase().includes(lq) ||
        e._body.toLowerCase().includes(lq)
      )
    : entries;

  const showTodayInList = !lq || filtered.some((e) => e.date === today);

  // Group past entries by month
  const pastEntries = filtered.filter((e) => e.date !== today);
  const grouped: Record<string, DecryptedReflection[]> = {};
  for (const e of pastEntries) {
    const k = monthKey(e.date);
    if (!grouped[k]) grouped[k] = [];
    grouped[k].push(e);
  }
  const months = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  const isToday = selectedDate === today;

  // Stream view helpers
  const fieldLabel = focusField === 'note'
    ? 'One thing to do better tomorrow'
    : focusField === 'gratitude'
    ? "One thing I'm grateful for"
    : 'Journal';

  const fieldValue = (entry: DecryptedReflection) =>
    focusField === 'note' ? entry._note
    : focusField === 'gratitude' ? entry._gratitude
    : entry._body;

  const filteredEntries = focusField
    ? [...entries]
        .filter((e) => fieldValue(e).trim().length > 0)
        .sort((a, b) => b.date.localeCompare(a.date))
    : [];

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color="#6366f1" size="large" /></View>;
  }

  if (focusField !== null) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.streamHeader}>
          <TouchableOpacity onPress={() => setFocusField(null)}>
            <Text style={styles.streamBack}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.streamTitle}>{fieldLabel}</Text>
        </View>
        <ScrollView contentContainerStyle={styles.streamContent}>
          {filteredEntries.length === 0 ? (
            <Text style={styles.streamEmpty}>No entries yet.</Text>
          ) : (
            filteredEntries.map((entry, idx) => (
              <TouchableOpacity
                key={entry.id ?? entry.date}
                style={[styles.streamItem, idx < filteredEntries.length - 1 && styles.streamItemDivider]}
                onPress={() => { setFocusField(null); selectDate(entry.date); }}
              >
                <Text style={styles.streamItemDate}>{formatDayFull(entry.date)}</Text>
                <Text style={styles.streamItemText}>{fieldValue(entry)}</Text>
              </TouchableOpacity>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.titleRow}>
        <Text style={styles.heading}>Journal</Text>
        {saved && <Text style={styles.savedFlash}>Saved</Text>}
      </View>

      {/* Entry sidebar */}
      <View style={[styles.sidebar, editorCollapsed && styles.sidebarExpanded]}>
        {/* Search bar */}
        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search journal..."
            placeholderTextColor="#475569"
            clearButtonMode="while-editing"
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>

        <ScrollView
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAndDecrypt(); }} tintColor="#6366f1" />}
        >
          {/* Today */}
          {showTodayInList && (
            <TouchableOpacity
              style={[styles.entryRow, selectedDate === today && styles.entryRowActive]}
              onPress={() => selectDate(today)}
            >
              <Text style={[styles.entryDate, selectedDate === today && styles.entryDateActive]}>Today</Text>
              <Text style={styles.entrySubDate}>{formatDay(today)}</Text>
            </TouchableOpacity>
          )}

          {/* Past entries grouped by month */}
          {months.map((month) => (
            <View key={month}>
              <Text style={styles.monthHeader}>{monthLabel(month)}</Text>
              {grouped[month].map((item) => (
                <TouchableOpacity
                  key={item.id ?? item.date}
                  style={[styles.entryRow, selectedDate === item.date && styles.entryRowActive]}
                  onPress={() => selectDate(item.date)}
                >
                  <Text style={[styles.entryDate, selectedDate === item.date && styles.entryDateActive]}>
                    {formatDay(item.date)}
                  </Text>
                  {(item._note || item._gratitude || item._body) ? (
                    <Text style={styles.entryPreview} numberOfLines={1}>
                      {item._body || item._note || item._gratitude}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              ))}
            </View>
          ))}

          {!showTodayInList && months.length === 0 && (
            <Text style={styles.noResults}>No entries match your search.</Text>
          )}
        </ScrollView>
      </View>

      {/* Detail / Editor */}
      <KeyboardAvoidingView style={editorCollapsed ? undefined : styles.flex} behavior="padding">
        <TouchableOpacity style={styles.detailToggleRow} onPress={() => setEditorCollapsed((v) => !v)} activeOpacity={0.7}>
          <View>
            <Text style={styles.detailDate}>{isToday ? 'Today' : formatDay(selectedDate)}</Text>
            <Text style={styles.detailDateSub}>{formatDayFull(selectedDate)}</Text>
          </View>
          <Text style={styles.detailToggleIcon}>{editorCollapsed ? '▾' : '▴'}</Text>
        </TouchableOpacity>
        {!editorCollapsed && (
        <ScrollView style={styles.detail} contentContainerStyle={styles.detailContent} keyboardShouldPersistTaps="handled">

          <View style={styles.fieldLabelRow}>
            <Text style={styles.fieldLabel}>One thing to do better tomorrow</Text>
            <TouchableOpacity onPress={() => setFocusField('note')}>
              <Text style={styles.viewAllBtn}>View all →</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.fieldInput}
            value={note}
            onChangeText={handleNote}
            onBlur={handleNoteBlur}
            placeholder="What could go better?"
            placeholderTextColor="#334155"
            multiline
          />

          <View style={styles.fieldLabelRow}>
            <Text style={styles.fieldLabel}>One thing I'm grateful for</Text>
            <TouchableOpacity onPress={() => setFocusField('gratitude')}>
              <Text style={styles.viewAllBtn}>View all →</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={styles.fieldInput}
            value={gratitude}
            onChangeText={handleGrat}
            onBlur={handleGratBlur}
            placeholder="Something you appreciated today"
            placeholderTextColor="#334155"
            multiline
          />

          <View style={styles.fieldLabelRow}>
            <Text style={styles.fieldLabel}>Journal</Text>
            <TouchableOpacity onPress={() => setFocusField('body')}>
              <Text style={styles.viewAllBtn}>View all →</Text>
            </TouchableOpacity>
          </View>
          <TextInput
            style={[styles.fieldInput, styles.fieldInputTall]}
            value={body}
            onChangeText={handleBody}
            onBlur={handleBodyBlur}
            placeholder="How did today go?"
            placeholderTextColor="#334155"
            multiline
            textAlignVertical="top"
          />
        </ScrollView>
        )}
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
  savedFlash: { color: '#22c55e', fontSize: 13, fontWeight: '600' },
  sidebar: { maxHeight: 220, borderBottomWidth: 1, borderColor: '#1e293b' },
  sidebarExpanded: { flex: 1, maxHeight: 9999 },
  detailToggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8,
    borderTopWidth: 1, borderTopColor: '#1e293b',
  },
  detailToggleIcon: { color: '#475569', fontSize: 14 },
  searchRow: { paddingHorizontal: 14, paddingVertical: 8 },
  searchInput: {
    backgroundColor: '#1e293b', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    color: '#cbd5e1', fontSize: 14, borderWidth: 1, borderColor: '#334155',
  },
  monthHeader: {
    color: '#475569', fontSize: 10, fontWeight: '800',
    textTransform: 'uppercase', letterSpacing: 1.1,
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 4,
  },
  entryRow: { paddingHorizontal: 20, paddingVertical: 10, borderLeftWidth: 3, borderLeftColor: 'transparent' },
  entryRowActive: { backgroundColor: 'rgba(99,102,241,0.08)', borderLeftColor: '#6366f1' },
  entryDate: { color: '#94a3b8', fontSize: 14, fontWeight: '600' },
  entryDateActive: { color: '#a5b4fc' },
  entrySubDate: { color: '#475569', fontSize: 12, marginTop: 1 },
  entryPreview: { color: '#475569', fontSize: 12, marginTop: 1 },
  noResults: { color: '#475569', fontSize: 14, textAlign: 'center', paddingTop: 16, paddingHorizontal: 20 },
  detail: { flex: 1 },
  detailContent: { padding: 20, gap: 10, paddingBottom: 60 },
  detailDate: { color: '#f1f5f9', fontSize: 18, fontWeight: '700', marginBottom: 0 },
  detailDateSub: { color: '#475569', fontSize: 12, marginTop: 2, marginBottom: 4 },
  fieldLabelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fieldLabel: { color: '#64748b', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  viewAllBtn: { color: '#6366f1', fontSize: 11 },
  fieldInput: {
    backgroundColor: '#1e293b', borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: '#334155', color: '#cbd5e1', fontSize: 14, lineHeight: 20,
  },
  fieldInputTall: { minHeight: 120, textAlignVertical: 'top' },
  // Stream view styles
  streamHeader: {
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14,
    borderBottomWidth: 1, borderColor: '#1e293b', gap: 6,
  },
  streamBack: { color: '#6366f1', fontSize: 15 },
  streamTitle: { color: '#f1f5f9', fontSize: 20, fontWeight: '800' },
  streamContent: { padding: 20, paddingBottom: 60 },
  streamEmpty: { color: '#64748b', fontSize: 15, textAlign: 'center', marginTop: 40 },
  streamItem: { paddingVertical: 16 },
  streamItemDivider: { borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  streamItemDate: { color: '#f1f5f9', fontWeight: '700', fontSize: 16 },
  streamItemText: { color: '#94a3b8', fontSize: 14, lineHeight: 20, marginTop: 6 },
});
