import { useCallback, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { apiFetch, isOk } from '@/lib/api';
import { useVault } from '@/lib/vault-context';
import type { Note } from '@/lib/types';

export default function NotesScreen() {
  const { decrypt, isUnlocked } = useVault();
  const router = useRouter();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  const fetchAndDecrypt = useCallback(async () => {
    const result = await apiFetch<Note[]>('/api/notes');
    if (!isOk(result)) { setLoading(false); setRefreshing(false); return; }

    const decrypted = await Promise.all(result.data.map(async (n) => ({
      ...n,
      title: n.encTitle ? (await decrypt(n.encTitle) ?? n.title) : n.title,
      content: n.encContent ? (await decrypt(n.encContent) ?? '') : n.content,
    })));
    setNotes(decrypted);
    setLoading(false);
    setRefreshing(false);
  }, [decrypt]);

  useFocusEffect(useCallback(() => {
    fetchAndDecrypt();
  }, [fetchAndDecrypt, isUnlocked]));

  const filtered = search.trim()
    ? notes.filter((n) => {
        const q = search.toLowerCase();
        return n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q);
      })
    : notes;

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color="#6366f1" size="large" /></View>;
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.heading}>Notes</Text>
        <Text style={styles.count}>{notes.length}</Text>
      </View>

      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          placeholder="Search notes…"
          placeholderTextColor="#475569"
          value={search}
          onChangeText={setSearch}
          autoCorrect={false}
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(n) => n.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchAndDecrypt(); }}
            tintColor="#6366f1"
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}><Text style={styles.emptyText}>No notes yet</Text></View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.7}
            onPress={() => router.push(`/note/${item.id}`)}
          >
            <Text style={styles.cardTitle} numberOfLines={1}>
              {item.title || '(Untitled)'}
            </Text>
            <Text style={styles.cardSnippet} numberOfLines={2}>
              {item.content
                ? item.content.replace(/<[^>]+>/g, '').slice(0, 120)
                : 'No content'}
            </Text>
            <Text style={styles.cardDate}>
              {new Date(item.updatedAt).toLocaleDateString()}
            </Text>
          </TouchableOpacity>
        )}
      />

      {/* FAB */}
      <TouchableOpacity style={styles.fab} onPress={() => router.push('/note/new')} activeOpacity={0.85}>
        <Text style={styles.fabIcon}>+</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
  },
  heading: { color: '#f1f5f9', fontSize: 26, fontWeight: '800' },
  count: { color: '#475569', fontSize: 15, fontWeight: '600' },
  searchWrap: { paddingHorizontal: 16, paddingBottom: 10 },
  search: {
    backgroundColor: '#1e293b', borderRadius: 10, borderWidth: 1, borderColor: '#334155',
    color: '#f1f5f9', fontSize: 15, paddingHorizontal: 14, paddingVertical: 10,
  },
  list: { paddingHorizontal: 16, paddingBottom: 100, gap: 10 },
  card: {
    backgroundColor: '#1e293b', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: '#334155', gap: 6,
  },
  cardTitle: { color: '#f1f5f9', fontSize: 16, fontWeight: '700' },
  cardSnippet: { color: '#94a3b8', fontSize: 13, lineHeight: 18 },
  cardDate: { color: '#475569', fontSize: 11 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { color: '#475569', fontSize: 15 },
  fab: {
    position: 'absolute', bottom: 28, right: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#6366f1', justifyContent: 'center', alignItems: 'center',
    shadowColor: '#6366f1', shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  fabIcon: { color: '#fff', fontSize: 28, lineHeight: 32 },
});
