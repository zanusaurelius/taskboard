import { useCallback, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, ActivityIndicator, ScrollView, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { apiFetch, isOk } from '@/lib/api';
import { useVault } from '@/lib/vault-context';
import type { Task, Project } from '@/lib/types';

const STAGES: Task['stage'][] = ['todo', 'in_progress', 'blocked', 'done'];
const STAGE_LABELS: Record<Task['stage'], string> = {
  todo: 'To Do', in_progress: 'In Progress', blocked: 'Blocked', done: 'Done',
};
const STAGE_COLORS: Record<Task['stage'], string> = {
  todo: '#475569', in_progress: '#6366f1', blocked: '#ef4444', done: '#22c55e',
};
const PRIORITY_COLORS: Record<string, string> = {
  high: '#ef4444', medium: '#f59e0b', low: '#22c55e',
};

export default function BoardScreen() {
  const { decrypt, isUnlocked } = useVault();
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAndDecrypt = useCallback(async () => {
    const [tasksRes, projectsRes] = await Promise.all([
      apiFetch<Task[]>('/api/tasks'),
      apiFetch<Project[]>('/api/projects'),
    ]);

    if (isOk(tasksRes)) {
      const decrypted = await Promise.all(tasksRes.data.map(async (t) => ({
        ...t,
        title: t.encTitle ? (await decrypt(t.encTitle) ?? t.title) : t.title,
      })));
      setTasks(decrypted);
    }

    if (isOk(projectsRes)) {
      const active = await Promise.all(
        projectsRes.data.filter((p) => !p.archived).map(async (p) => ({
          ...p,
          name: p.encName ? (await decrypt(p.encName) ?? p.name) : p.name,
        })),
      );
      setProjects(active);
      setSelectedProject((prev) => prev ?? (active[0]?.id ?? null));
    }

    setLoading(false);
    setRefreshing(false);
  }, [decrypt]);

  useFocusEffect(useCallback(() => {
    fetchAndDecrypt();
  }, [fetchAndDecrypt, isUnlocked]));

  const projectTasks = tasks.filter((t) => t.projectId === selectedProject && !t.archived);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color="#6366f1" size="large" /></View>;
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Text style={styles.heading}>Board</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.projectTabs} contentContainerStyle={styles.projectTabsContent}>
        {projects.map((p) => (
          <TouchableOpacity
            key={p.id}
            style={[styles.projectTab, selectedProject === p.id && styles.projectTabActive]}
            onPress={() => setSelectedProject(p.id)}
          >
            <Text style={[styles.projectTabText, selectedProject === p.id && styles.projectTabTextActive]}>
              {p.name || '(Untitled)'}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAndDecrypt(); }} tintColor="#6366f1" />}
        contentContainerStyle={styles.columns}
      >
        {STAGES.map((stage) => {
          const stageTasks = projectTasks.filter((t) => t.stage === stage);
          return (
            <View key={stage} style={styles.column}>
              <View style={styles.columnHeader}>
                <View style={[styles.stageDot, { backgroundColor: STAGE_COLORS[stage] }]} />
                <Text style={styles.stageLabel}>{STAGE_LABELS[stage]}</Text>
                <Text style={styles.stageCount}>{stageTasks.length}</Text>
              </View>
              <FlatList
                data={stageTasks}
                keyExtractor={(t) => t.id}
                scrollEnabled={false}
                contentContainerStyle={styles.columnCards}
                ListEmptyComponent={<Text style={styles.emptyCol}>No tasks</Text>}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.taskCard}
                    activeOpacity={0.75}
                    onPress={() => router.push(`/task/${item.id}`)}
                  >
                    <Text style={styles.taskTitle} numberOfLines={3}>{item.title || '(Untitled)'}</Text>
                    {item.priority && (
                      <View style={[styles.priorityBadge, { backgroundColor: PRIORITY_COLORS[item.priority] ?? '#475569' }]}>
                        <Text style={styles.priorityText}>{item.priority}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                )}
              />
            </View>
          );
        })}
      </ScrollView>

      {/* FAB — creates task in currently selected project */}
      {selectedProject && (
        <TouchableOpacity
          style={styles.fab}
          activeOpacity={0.85}
          onPress={() => router.push({ pathname: '/task/new', params: { projectId: selectedProject } })}
        >
          <Text style={styles.fabIcon}>+</Text>
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a' },
  heading: { color: '#f1f5f9', fontSize: 26, fontWeight: '800', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  projectTabs: { flexGrow: 0, paddingBottom: 4 },
  projectTabsContent: { paddingHorizontal: 16, gap: 8 },
  projectTab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155' },
  projectTabActive: { backgroundColor: 'rgba(99,102,241,0.2)', borderColor: '#6366f1' },
  projectTabText: { color: '#64748b', fontSize: 13, fontWeight: '600' },
  projectTabTextActive: { color: '#a5b4fc' },
  columns: { padding: 16, gap: 12, alignItems: 'flex-start' },
  column: { width: 220, backgroundColor: '#1e293b', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#334155' },
  columnHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  stageDot: { width: 8, height: 8, borderRadius: 4 },
  stageLabel: { color: '#94a3b8', fontSize: 12, fontWeight: '700', flex: 1, textTransform: 'uppercase', letterSpacing: 0.5 },
  stageCount: { color: '#475569', fontSize: 12, fontWeight: '600' },
  columnCards: { gap: 8 },
  taskCard: { backgroundColor: '#0f172a', borderRadius: 8, padding: 12, borderWidth: 1, borderColor: '#1e293b', gap: 6 },
  taskTitle: { color: '#e2e8f0', fontSize: 13, fontWeight: '600', lineHeight: 18 },
  emptyCol: { color: '#334155', fontSize: 12, textAlign: 'center', paddingVertical: 12 },
  priorityBadge: { alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  priorityText: { color: '#fff', fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  fab: {
    position: 'absolute', bottom: 28, right: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#6366f1', justifyContent: 'center', alignItems: 'center',
    shadowColor: '#6366f1', shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  fabIcon: { color: '#fff', fontSize: 28, lineHeight: 32 },
});
