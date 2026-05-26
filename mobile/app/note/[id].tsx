import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { apiFetch, isConflict, isOk } from '@/lib/api';
import { useVault } from '@/lib/vault-context';
import { enqueue, setLastSynced } from '@/lib/offline-db';
import type { Note } from '@/lib/types';

type SavedNote = Note & { _title: string; _content: string };

export default function NoteEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { encrypt, decrypt, isUnlocked } = useVault();

  const isNew = id === 'new';

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [note, setNote] = useState<SavedNote | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const titleRef = useRef<TextInput>(null);
  const contentRef = useRef<TextInput>(null);

  const load = useCallback(async () => {
    if (isNew) return;
    const result = await apiFetch<Note>(`/api/notes/${id}`);
    if (!isOk(result)) { setLoading(false); return; }

    const n = result.data;
    const _title = n.encTitle ? (await decrypt(n.encTitle) ?? n.title) : n.title;
    const _content = n.encContent ? (await decrypt(n.encContent) ?? n.content) : n.content;
    const plainContent = _content.replace(/<[^>]+>/g, '');

    setNote({ ...n, _title, _content: plainContent });
    setTitle(_title);
    setContent(plainContent);
    setLoading(false);
  }, [id, isNew, decrypt]);

  useEffect(() => { load(); }, [load, isUnlocked]);

  const save = useCallback(async () => {
    if (saving) return;
    setSaving(true);

    const encTitleBlob = title.trim() ? await encrypt(title) : null;
    const encContentBlob = content.trim() ? await encrypt(content) : null;
    const encTitle = encTitleBlob ? JSON.stringify(encTitleBlob) : null;
    const encContent = encContentBlob ? JSON.stringify(encContentBlob) : null;

    if (isNew) {
      const body = { title: '', content: '', encTitle, encContent };
      const result = await apiFetch<Note>('/api/notes', {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (isOk(result)) {
        await setLastSynced('note', result.data.id, result.data.updatedAt);
        router.replace(`/note/${result.data.id}`);
      } else if (!isOk(result) && (result as { status?: number }).status === 0) {
        await enqueue('POST', '/api/notes', body);
        Alert.alert('Saved offline', 'This note will sync when you reconnect.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else {
        Alert.alert('Error', 'Could not save note. Try again.');
      }
    } else {
      const body = {
        title: '',
        content: '',
        encTitle,
        encContent,
        clientUpdatedAt: note?.updatedAt,
      };
      const result = await apiFetch<Note>(`/api/notes/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });

      if (isOk(result)) {
        await setLastSynced('note', id, result.data.updatedAt);
        setNote((prev) => prev ? { ...prev, updatedAt: result.data.updatedAt } : prev);
        setDirty(false);
      } else if (isConflict(result)) {
        const server = result.serverItem as Note;
        const serverTitle = server.encTitle ? (await decrypt(server.encTitle) ?? server.title) : server.title;
        const serverContent = server.encContent ? (await decrypt(server.encContent) ?? server.content) : server.content;
        const plainServerContent = serverContent.replace(/<[^>]+>/g, '');

        Alert.alert(
          'Conflict',
          `Someone else updated this note.\n\nServer: "${serverTitle}"\nYours: "${title}"`,
          [
            {
              text: 'Keep mine',
              onPress: async () => {
                const forceBody = { title: '', content: '', encTitle, encContent };
                const r2 = await apiFetch<Note>(`/api/notes/${id}`, {
                  method: 'PUT',
                  body: JSON.stringify(forceBody),
                });
                if (isOk(r2)) {
                  await setLastSynced('note', id, r2.data.updatedAt);
                  setNote((prev) => prev ? { ...prev, updatedAt: r2.data.updatedAt } : prev);
                  setDirty(false);
                }
                setSaving(false);
              },
            },
            {
              text: 'Use server version',
              onPress: () => {
                setTitle(serverTitle);
                setContent(plainServerContent);
                setNote((prev) => prev ? { ...prev, ...server, _title: serverTitle, _content: plainServerContent } : prev);
                setDirty(false);
                setSaving(false);
              },
            },
          ],
        );
        return;
      } else if ((result as { status?: number }).status === 0) {
        await enqueue('PUT', `/api/notes/${id}`, body);
        Alert.alert('Saved offline', 'Changes will sync when you reconnect.');
        setDirty(false);
      } else {
        Alert.alert('Error', 'Could not save note. Try again.');
      }
    }

    setSaving(false);
  }, [saving, isNew, id, title, content, note, encrypt, decrypt, router]);

  const handleBack = () => {
    if (dirty) {
      Alert.alert('Unsaved changes', 'Save before leaving?', [
        { text: 'Discard', style: 'destructive', onPress: () => router.back() },
        { text: 'Save', onPress: async () => { await save(); router.back(); } },
        { text: 'Cancel', style: 'cancel' },
      ]);
    } else {
      router.back();
    }
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color="#6366f1" size="large" /></View>;
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
          <Text style={styles.backText}>‹ Notes</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={save}
          style={[styles.saveBtn, (!dirty && !isNew) && styles.saveBtnDisabled]}
          disabled={saving || (!dirty && !isNew)}
        >
          {saving
            ? <ActivityIndicator color="#6366f1" size="small" />
            : <Text style={[styles.saveText, (!dirty && !isNew) && styles.saveTextDisabled]}>Save</Text>}
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <ScrollView style={styles.flex} contentContainerStyle={styles.editorContent} keyboardShouldPersistTaps="handled">
          <TextInput
            ref={titleRef}
            style={styles.titleInput}
            value={title}
            onChangeText={(v) => { setTitle(v); setDirty(true); }}
            placeholder="Title"
            placeholderTextColor="#334155"
            returnKeyType="next"
            onSubmitEditing={() => contentRef.current?.focus()}
            autoFocus={isNew}
            multiline={false}
          />
          <View style={styles.divider} />
          <TextInput
            ref={contentRef}
            style={styles.contentInput}
            value={content}
            onChangeText={(v) => { setContent(v); setDirty(true); }}
            placeholder="Start writing…"
            placeholderTextColor="#334155"
            multiline
            textAlignVertical="top"
            scrollEnabled={false}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a' },
  flex: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderColor: '#1e293b',
  },
  backBtn: { padding: 4 },
  backText: { color: '#6366f1', fontSize: 17 },
  saveBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, backgroundColor: 'rgba(99,102,241,0.15)' },
  saveBtnDisabled: { backgroundColor: 'transparent' },
  saveText: { color: '#6366f1', fontSize: 15, fontWeight: '700' },
  saveTextDisabled: { color: '#334155' },
  editorContent: { padding: 20, paddingBottom: 60, gap: 0 },
  titleInput: {
    color: '#f1f5f9', fontSize: 22, fontWeight: '700',
    paddingVertical: 8, marginBottom: 4,
  },
  divider: { height: 1, backgroundColor: '#1e293b', marginVertical: 12 },
  contentInput: {
    color: '#cbd5e1', fontSize: 16, lineHeight: 26,
    minHeight: 300, paddingTop: 0,
  },
});
