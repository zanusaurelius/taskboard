import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { apiFetch, isConflict, isOk } from '@/lib/api';
import { useVault } from '@/lib/vault-context';
import { enqueue, setLastSynced } from '@/lib/offline-db';
import type { Task, Project } from '@/lib/types';

const STAGES: Task['stage'][] = ['todo', 'in_progress', 'blocked', 'done'];
const STAGE_LABELS: Record<Task['stage'], string> = {
  todo: 'To Do', in_progress: 'In Progress', blocked: 'Blocked', done: 'Done',
};
const STAGE_COLORS: Record<Task['stage'], string> = {
  todo: '#475569', in_progress: '#6366f1', blocked: '#ef4444', done: '#22c55e',
};
const PRIORITIES = ['low', 'medium', 'high'] as const;
const PRIORITY_COLORS: Record<string, string> = {
  high: '#ef4444', medium: '#f59e0b', low: '#22c55e',
};

export default function TaskEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { encrypt, decrypt, isUnlocked } = useVault();

  // For new tasks, id is "new" and projectId is passed as a query param
  const { projectId: qProjectId } = useLocalSearchParams<{ projectId?: string }>();
  const isNew = id === 'new';

  const [title, setTitle] = useState('');
  const [stage, setStage] = useState<Task['stage']>('todo');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | null>(null);
  const [projectId, setProjectId] = useState<string>(qProjectId ?? '');
  const [projects, setProjects] = useState<Project[]>([]);
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const loadData = useCallback(async () => {
    const [projectsRes, taskRes] = await Promise.all([
      apiFetch<Project[]>('/api/projects'),
      isNew ? Promise.resolve(null) : apiFetch<Task[]>('/api/tasks'),
    ]);

    if (isOk(projectsRes)) {
      const active = await Promise.all(
        projectsRes.data.filter((p) => !p.archived).map(async (p) => ({
          ...p,
          name: p.encName ? (await decrypt(p.encName) ?? p.name) : p.name,
        })),
      );
      setProjects(active);
      if (isNew && !projectId && active[0]) setProjectId(active[0].id);
    }

    if (!isNew && taskRes && isOk(taskRes)) {
      const found = taskRes.data.find((t) => t.id === id);
      if (found) {
        const decTitle = found.encTitle ? (await decrypt(found.encTitle) ?? found.title) : found.title;
        setTask(found);
        setTitle(decTitle);
        setStage(found.stage);
        setPriority(found.priority ?? null);
        setProjectId(found.projectId);
      }
    }

    setLoading(false);
  }, [id, isNew, projectId, decrypt]);

  useEffect(() => { loadData(); }, [loadData, isUnlocked]);

  const save = useCallback(async () => {
    if (saving || !title.trim()) {
      if (!title.trim()) Alert.alert('Required', 'Enter a task title.');
      return;
    }
    setSaving(true);

    const encTitleBlob = await encrypt(title);
    const encTitle = encTitleBlob ? JSON.stringify(encTitleBlob) : null;

    if (isNew) {
      if (!projectId) { Alert.alert('Required', 'Select a project.'); setSaving(false); return; }
      const body = { title: '', encTitle, stage, priority: priority ?? undefined, projectId };
      const result = await apiFetch<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(body) });

      if (isOk(result)) {
        await setLastSynced('task', result.data.id, result.data.updatedAt);
        router.replace(`/task/${result.data.id}`);
      } else if ((result as { status?: number }).status === 0) {
        await enqueue('POST', '/api/tasks', body);
        Alert.alert('Saved offline', 'Task will sync when you reconnect.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else {
        Alert.alert('Error', 'Could not create task.');
      }
    } else {
      const body = {
        title: '', encTitle, stage, priority: priority ?? undefined,
        clientUpdatedAt: task?.updatedAt,
      };
      const result = await apiFetch<Task>(`/api/tasks/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });

      if (isOk(result)) {
        await setLastSynced('task', id, result.data.updatedAt);
        setTask((prev) => prev ? { ...prev, updatedAt: result.data.updatedAt } : prev);
        setDirty(false);
      } else if (isConflict(result)) {
        const server = result.serverItem as Task;
        const serverTitle = server.encTitle ? (await decrypt(server.encTitle) ?? server.title) : server.title;
        Alert.alert(
          'Conflict',
          `This task was updated elsewhere.\n\nServer: "${serverTitle}"`,
          [
            {
              text: 'Keep mine',
              onPress: async () => {
                const r2 = await apiFetch<Task>(`/api/tasks/${id}`, {
                  method: 'PUT',
                  body: JSON.stringify({ title: '', encTitle, stage, priority: priority ?? undefined }),
                });
                if (isOk(r2)) {
                  await setLastSynced('task', id, r2.data.updatedAt);
                  setTask((prev) => prev ? { ...prev, updatedAt: r2.data.updatedAt } : prev);
                  setDirty(false);
                }
                setSaving(false);
              },
            },
            {
              text: 'Use server',
              onPress: async () => {
                const decTitle = server.encTitle ? (await decrypt(server.encTitle) ?? server.title) : server.title;
                setTitle(decTitle);
                setStage(server.stage);
                setPriority(server.priority ?? null);
                setTask(server);
                setDirty(false);
                setSaving(false);
              },
            },
          ],
        );
        return;
      } else if ((result as { status?: number }).status === 0) {
        await enqueue('PUT', `/api/tasks/${id}`, body);
        Alert.alert('Saved offline', 'Changes will sync when you reconnect.');
        setDirty(false);
      } else {
        Alert.alert('Error', 'Could not save task.');
      }
    }
    setSaving(false);
  }, [saving, isNew, id, title, stage, priority, projectId, task, encrypt, decrypt, router]);

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
      <View style={styles.header}>
        <TouchableOpacity onPress={handleBack} style={styles.backBtn}>
          <Text style={styles.backText}>‹ Board</Text>
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

      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionLabel}>Title</Text>
          <TextInput
            style={styles.titleInput}
            value={title}
            onChangeText={(v) => { setTitle(v); setDirty(true); }}
            placeholder="Task title"
            placeholderTextColor="#334155"
            autoFocus={isNew}
            returnKeyType="done"
          />

          <Text style={styles.sectionLabel}>Stage</Text>
          <View style={styles.chipRow}>
            {STAGES.map((s) => (
              <TouchableOpacity
                key={s}
                style={[styles.chip, stage === s && { backgroundColor: STAGE_COLORS[s] + '30', borderColor: STAGE_COLORS[s] }]}
                onPress={() => { setStage(s); setDirty(true); }}
              >
                <View style={[styles.dot, { backgroundColor: STAGE_COLORS[s] }]} />
                <Text style={[styles.chipText, stage === s && { color: STAGE_COLORS[s] }]}>{STAGE_LABELS[s]}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.sectionLabel}>Priority</Text>
          <View style={styles.chipRow}>
            {PRIORITIES.map((p) => (
              <TouchableOpacity
                key={p}
                style={[styles.chip, priority === p && { backgroundColor: PRIORITY_COLORS[p] + '30', borderColor: PRIORITY_COLORS[p] }]}
                onPress={() => { setPriority(priority === p ? null : p); setDirty(true); }}
              >
                <Text style={[styles.chipText, priority === p && { color: PRIORITY_COLORS[p] }]}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {isNew && projects.length > 1 && (
            <>
              <Text style={styles.sectionLabel}>Project</Text>
              <View style={styles.chipRow}>
                {projects.map((p) => (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.chip, projectId === p.id && styles.chipActive]}
                    onPress={() => { setProjectId(p.id); setDirty(true); }}
                  >
                    <Text style={[styles.chipText, projectId === p.id && styles.chipTextActive]}>
                      {p.name || '(Untitled)'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
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
  content: { padding: 20, gap: 12, paddingBottom: 60 },
  sectionLabel: { color: '#64748b', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1, marginTop: 8 },
  titleInput: {
    backgroundColor: '#1e293b', borderRadius: 10, borderWidth: 1, borderColor: '#334155',
    color: '#f1f5f9', fontSize: 17, fontWeight: '600', paddingHorizontal: 14, paddingVertical: 12,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155',
  },
  chipActive: { backgroundColor: 'rgba(99,102,241,0.15)', borderColor: '#6366f1' },
  chipText: { color: '#64748b', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#a5b4fc' },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
