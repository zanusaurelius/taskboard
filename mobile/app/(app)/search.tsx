import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { apiFetch, isOk } from '@/lib/api';
import { useVault } from '@/lib/vault-context';
import type { Task, Note, DailyReflection } from '@/lib/types';

const stripHtml = (html: string) => html.replace(/<[^>]+>/g, '');

const formatDate = (iso: string) =>
  new Date(iso + (iso.length === 10 ? 'T12:00:00' : '')).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });

interface DecryptedReflection extends DailyReflection {
  _note: string;
  _gratitude: string;
  _body: string;
}

interface SearchResults {
  tasks: Task[];
  notes: Note[];
  journal: DecryptedReflection[];
}

export default function SearchScreen() {
  const router = useRouter();
  const { decrypt } = useVault();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeqRef = useRef(0);
  const inputRef = useRef<TextInput>(null);

  const runSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }

    const seq = ++searchSeqRef.current;
    setSearching(true);
    const lq = q.toLowerCase();

    const [tasksRes, notesRes, journalRes] = await Promise.all([
      apiFetch<Task[]>('/api/tasks'),
      apiFetch<Note[]>('/api/notes'),
      apiFetch<DailyReflection[]>('/api/daily-reflections'),
    ]);

    // Tasks — decrypt encTitle if needed, filter client-side
    let tasks: Task[] = [];
    if (isOk(tasksRes)) {
      const decrypted = await Promise.all(tasksRes.data.map(async (t) => ({
        ...t,
        title: t.encTitle ? (await decrypt(t.encTitle) ?? t.title) : t.title,
      })));
      tasks = decrypted.filter((t) => t.title.toLowerCase().includes(lq));
    }

    // Notes — decrypt encTitle / encContent, filter by title or content
    let notes: Note[] = [];
    if (isOk(notesRes)) {
      const decrypted = await Promise.all(notesRes.data.map(async (n) => ({
        ...n,
        title: n.encTitle ? (await decrypt(n.encTitle) ?? n.title) : n.title,
        content: n.encContent ? (await decrypt(n.encContent) ?? n.content) : n.content,
      })));
      notes = decrypted.filter((n) => {
        const plainContent = stripHtml(n.content);
        return (
          n.title.toLowerCase().includes(lq) ||
          plainContent.toLowerCase().includes(lq)
        );
      });
    }

    // Journal — decrypt enc fields, filter by note/gratitude/body
    let journal: DecryptedReflection[] = [];
    if (isOk(journalRes)) {
      const decrypted = await Promise.all(journalRes.data.map(async (e) => ({
        ...e,
        _note: e.encNote ? (await decrypt(e.encNote) ?? e.note ?? '') : (e.note ?? ''),
        _gratitude: e.encGratitude ? (await decrypt(e.encGratitude) ?? e.gratitude ?? '') : (e.gratitude ?? ''),
        _body: e.encBody ? (await decrypt(e.encBody) ?? e.body ?? '') : (e.body ?? ''),
      })));
      journal = decrypted.filter((e) =>
        e._note.toLowerCase().includes(lq) ||
        e._gratitude.toLowerCase().includes(lq) ||
        e._body.toLowerCase().includes(lq)
      );
    }

    // Discard if a newer search has started since this one was launched
    if (seq !== searchSeqRef.current) return;
    setResults({ tasks, notes, journal });
    setSearching(false);
  }, [decrypt]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    debounceRef.current = setTimeout(() => runSearch(query), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, runSearch]);

  const hasResults = results && (
    results.tasks.length > 0 || results.notes.length > 0 || results.journal.length > 0
  );

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TextInput
          ref={inputRef}
          style={styles.searchInput}
          placeholder="Search tasks, notes, journal…"
          placeholderTextColor="#475569"
          value={query}
          onChangeText={setQuery}
          autoFocus
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
        <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Hint state */}
        {query.length < 2 && !searching && (
          <View style={styles.hintWrap}>
            <Text style={styles.hintText}>Search tasks, notes, and journal entries</Text>
          </View>
        )}

        {/* Searching indicator */}
        {searching && (
          <View style={styles.hintWrap}>
            <ActivityIndicator color="#6366f1" size="small" />
          </View>
        )}

        {/* No results */}
        {!searching && results && !hasResults && (
          <View style={styles.hintWrap}>
            <Text style={styles.hintText}>No results for "{query}"</Text>
          </View>
        )}

        {/* Tasks section */}
        {!searching && results && results.tasks.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>TASKS ({results.tasks.length})</Text>
            {results.tasks.map((task) => (
              <TouchableOpacity
                key={task.id}
                style={styles.card}
                activeOpacity={0.7}
                onPress={() => router.push(`/task/${task.id}`)}
              >
                <Text style={styles.cardTitle} numberOfLines={2}>{task.title || '(Untitled)'}</Text>
                <View style={styles.cardMeta}>
                  {task.stage && (
                    <Text style={styles.cardMetaText}>{task.stage.replace('_', ' ')}</Text>
                  )}
                  {task.priority && (
                    <Text style={[styles.cardMetaText, styles.priorityText, task.priority === 'high' ? styles.priorityHigh : task.priority === 'medium' ? styles.priorityMed : styles.priorityLow]}>
                      {task.priority}
                    </Text>
                  )}
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Notes section */}
        {!searching && results && results.notes.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>NOTES ({results.notes.length})</Text>
            {results.notes.map((note) => (
              <TouchableOpacity
                key={note.id}
                style={styles.card}
                activeOpacity={0.7}
                onPress={() => router.push(`/note/${note.id}`)}
              >
                <Text style={styles.cardTitle} numberOfLines={1}>{note.title || '(Untitled)'}</Text>
                {note.content ? (
                  <Text style={styles.cardSnippet} numberOfLines={2}>
                    {stripHtml(note.content).slice(0, 120)}
                  </Text>
                ) : null}
                <Text style={styles.cardDate}>{new Date(note.updatedAt).toLocaleDateString()}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Journal section */}
        {!searching && results && results.journal.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionHeader}>JOURNAL ({results.journal.length})</Text>
            {results.journal.map((entry) => {
              const preview = entry._body || entry._note || entry._gratitude;
              return (
                <TouchableOpacity
                  key={entry.id ?? entry.date}
                  style={styles.card}
                  activeOpacity={0.7}
                  onPress={() => router.push({ pathname: '/(app)/journal', params: { date: entry.date } })}
                >
                  <Text style={styles.cardTitle}>{formatDate(entry.date)}</Text>
                  {preview ? (
                    <Text style={styles.cardSnippet} numberOfLines={2}>
                      {preview.slice(0, 120)}
                    </Text>
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a' },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10,
    borderBottomWidth: 1, borderColor: '#1e293b',
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#1e293b', borderRadius: 10, borderWidth: 1, borderColor: '#334155',
    color: '#f1f5f9', fontSize: 16, paddingHorizontal: 14, paddingVertical: 11,
  },
  cancelBtn: { paddingHorizontal: 4, paddingVertical: 6 },
  cancelText: { color: '#6366f1', fontSize: 16, fontWeight: '600' },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 80 },
  hintWrap: { alignItems: 'center', paddingTop: 60 },
  hintText: { color: '#475569', fontSize: 15, textAlign: 'center', paddingHorizontal: 32 },
  section: { paddingHorizontal: 16, paddingTop: 20, gap: 8 },
  sectionHeader: {
    color: '#475569', fontSize: 10, fontWeight: '800',
    textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 4,
  },
  card: {
    backgroundColor: '#1e293b', borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: '#334155', gap: 5,
  },
  cardTitle: { color: '#f1f5f9', fontSize: 15, fontWeight: '700' },
  cardSnippet: { color: '#94a3b8', fontSize: 13, lineHeight: 18 },
  cardDate: { color: '#475569', fontSize: 11 },
  cardMeta: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  cardMetaText: { color: '#64748b', fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  priorityText: { fontWeight: '700' },
  priorityHigh: { color: '#ef4444' },
  priorityMed: { color: '#f59e0b' },
  priorityLow: { color: '#22c55e' },
});
