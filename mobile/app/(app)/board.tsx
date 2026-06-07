import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, ScrollView, RefreshControl,
  Modal, Platform, Alert, DeviceEventEmitter,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import DraggableFlatList, {
  NestableScrollContainer,
  NestableDraggableFlatList,
  ScaleDecorator,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import { apiFetch, isOk } from '@/lib/api';
import { useVault } from '@/lib/vault-context';
import { getAutoArchiveDays } from '@/lib/storage';
import type { Task, Project } from '@/lib/types';
import DailyFocusSection from '@/components/DailyFocusSection';
import VaultUnlockModal from '@/components/VaultUnlockModal';
import { useThemeColors, type ThemeColors } from '@/lib/theme-context';

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
const STAGE_COLOR_PALETTE = ['#6366f1', '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6', '#0ea5e9', '#64748b'];
const STAGE_COLORS_KEY = 'taskboard_stage_colors';
// Must match web TaskBoard.tsx PROJECT_COLORS + hashId algorithm for color consistency
const PROJECT_PALETTE = [
  '#f59e0b', '#10b981', '#3b82f6', '#ec4899',
  '#8b5cf6', '#0ea5e9', '#14b8a6', '#f43f5e', '#84cc16', '#6366f1',
];

const PRIVACY_MODE_KEY = 'taskboard_privacy_mode';

function hashProjectColor(projectId: string): string {
  let h = 0;
  for (let i = 0; i < projectId.length; i++) h = (Math.imul(31, h) + projectId.charCodeAt(i)) | 0;
  return PROJECT_PALETTE[Math.abs(h) % PROJECT_PALETTE.length];
}

export default function BoardScreen() {
  const { decrypt, isUnlocked, lock } = useVault();
  const router = useRouter();
  const colors = useThemeColors();
  const styles = makeStyles(colors);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offline, setOffline] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  // Privacy mode
  const [privacyMode, setPrivacyMode] = useState(true);
  const [vaultUnlockVisible, setVaultUnlockVisible] = useState(false);
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);

  // Search & filter state
  const [searchText, setSearchText] = useState('');
  const [stageFilter, setStageFilter] = useState<Task['stage'][]>([]);
  const [showArchived, setShowArchived] = useState(false);

  // Undo banner state
  const [undoTask, setUndoTask] = useState<{ id: string; title: string } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // New project modal state
  const [newProjectModalVisible, setNewProjectModalVisible] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [savingProject, setSavingProject] = useState(false);

  // Edit project modal state
  const [editProjectModalVisible, setEditProjectModalVisible] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editProjectName, setEditProjectName] = useState('');
  const [editProjectColor, setEditProjectColor] = useState(PROJECT_PALETTE[0]);
  const [savingEditProject, setSavingEditProject] = useState(false);

  // Stage color customization
  const [stageColors, setStageColors] = useState<Record<Task['stage'], string>>({ ...STAGE_COLORS });
  const [colorPickerStage, setColorPickerStage] = useState<Task['stage'] | null>(null);

  // Load privacy mode from SecureStore on mount
  useEffect(() => {
    SecureStore.getItemAsync(PRIVACY_MODE_KEY).then((val) => {
      // Default true if not set; stored as 'true'/'false'
      setPrivacyMode(val === null ? true : val === 'true');
    });
  }, []);

  // Load stage colors from server (falls back to SecureStore cache)
  useEffect(() => {
    apiFetch<Record<string, string>>('/api/settings/stage-colors').then((result) => {
      if (isOk(result) && Object.keys(result.data).length > 0) {
        setStageColors({ ...STAGE_COLORS, ...result.data });
        SecureStore.setItemAsync(STAGE_COLORS_KEY, JSON.stringify(result.data)).catch(() => {});
      } else {
        SecureStore.getItemAsync(STAGE_COLORS_KEY).then((val) => {
          if (val) { try { setStageColors({ ...STAGE_COLORS, ...JSON.parse(val) }); } catch { /* ignore */ } }
        });
      }
    });
  }, []);

  // When vault auto-locks, restore privacy mode
  useEffect(() => {
    if (!isUnlocked) setPrivacyMode(true);
  }, [isUnlocked]);

  const handlePrivacyChip = () => {
    if (privacyMode) {
      // Trying to reveal — open vault unlock if locked tasks exist
      if (tasks.some((t) => t.locked || t.sensitive)) {
        setVaultUnlockVisible(true);
      } else {
        setPrivacyMode(false);
        SecureStore.setItemAsync(PRIVACY_MODE_KEY, 'false');
      }
    } else {
      // Hiding again — lock vault and restore privacy
      lock();
      setPrivacyMode(true);
      SecureStore.setItemAsync(PRIVACY_MODE_KEY, 'true');
    }
  };

  const fetchAndDecrypt = useCallback(async () => {
    const [tasksRes, projectsRes] = await Promise.all([
      apiFetch<Task[]>('/api/tasks?includeArchived=true'),
      apiFetch<Project[]>('/api/projects'),
    ]);

    const allOffline = [tasksRes, projectsRes].every(
      (r) => !r.ok && (r as { status?: number }).status === 0
    );
    const anyServerError = [tasksRes, projectsRes].some(
      (r) => !r.ok && (r as { status?: number }).status !== 0
    );
    setOffline(allOffline);
    setFetchError(!allOffline && anyServerError && !isOk(tasksRes));

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
    }

    setLoading(false);
    setRefreshing(false);
  }, [decrypt]);

  useFocusEffect(useCallback(() => {
    fetchAndDecrypt();
  }, [fetchAndDecrypt, isUnlocked]));

  // Run auto-archive on mount if configured
  useEffect(() => {
    getAutoArchiveDays().then((days) => {
      if (!days) return;
      apiFetch('/api/tasks/auto-archive', {
        method: 'POST',
        body: JSON.stringify({ days }),
      }).then((res) => {
        if (isOk(res) && (res.data as { count?: number }).count) fetchAndDecrypt();
      });
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for task:archived events to show the undo banner
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('task:archived', ({ taskId, title }) => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
      setUndoTask({ id: taskId, title });
      undoTimer.current = setTimeout(() => setUndoTask(null), 7000);
    });
    return () => sub.remove();
  }, []);

  const handleUndo = async () => {
    if (!undoTask) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    const result = await apiFetch(`/api/tasks/${undoTask.id}`, {
      method: 'PUT',
      body: JSON.stringify({ archived: false }),
    });
    if (!isOk(result)) {
      Alert.alert('Error', 'Could not undo archive. Please try again.');
      return;
    }
    setUndoTask(null);
    fetchAndDecrypt();
  };

  const handleSwipeStage = useCallback(async (taskId: string, newStage: Task['stage']) => {
    const originalStage = tasks.find((t) => t.id === taskId)?.stage;
    setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, stage: newStage } : t));
    const result = await apiFetch(`/api/tasks/${taskId}`, {
      method: 'PUT',
      body: JSON.stringify({ stage: newStage }),
    });
    if (!isOk(result) && originalStage !== undefined) {
      setTasks((prev) => prev.map((t) => t.id === taskId ? { ...t, stage: originalStage } : t));
    }
  }, [tasks]);

  const handleReorderTasks = useCallback(async (stage: Task['stage'], orderedTasks: Task[]) => {
    // Assign new position values locally so tasksForStage()'s position sort
    // preserves the drag order instead of reverting to the old order.
    const rePositioned = orderedTasks.map((task, index) => ({ ...task, position: (index + 1) * 1000 }));
    setTasks(prev => [...prev.filter(t => t.stage !== stage), ...rePositioned]);
    await Promise.all(
      rePositioned.map((task) =>
        apiFetch(`/api/tasks/${task.id}`, {
          method: 'PUT',
          body: JSON.stringify({ position: task.position }),
        })
      )
    );
  }, []);

  // Filtered tasks
  const visibleTasks = tasks.filter((t) => {
    if (!showArchived && t.archived) return false;
    if (selectedProject !== null && t.projectId !== selectedProject) return false;
    if (searchText) {
      const q = searchText.toLowerCase();
      const inTitle = t.title.toLowerCase().includes(q);
      const plainDesc = t.description ? t.description.replace(/<[^>]*>/g, ' ').toLowerCase() : '';
      const inDesc = plainDesc.includes(q);
      if (!inTitle && !inDesc) return false;
    }
    if (stageFilter.length > 0 && !stageFilter.includes(t.stage)) return false;
    return true;
  });

  // Project lookup map — computed once per render
  const projectMap = Object.fromEntries(projects.map((p) => [p.id, p]));

  // Sort by position only so drag reordering is the primary sort on mobile
  const tasksForStage = (stage: Task['stage']) =>
    visibleTasks.filter((t) => t.stage === stage).sort((a, b) => a.position - b.position);

  const toggleStageFilter = (stage: Task['stage']) => {
    setStageFilter((prev) =>
      prev.includes(stage) ? prev.filter((s) => s !== stage) : [...prev, stage],
    );
  };

  const handleCreateProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;
    setSavingProject(true);
    const res = await apiFetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color: PROJECT_PALETTE[0] }),
    });
    setSavingProject(false);
    if (isOk(res)) {
      setNewProjectModalVisible(false);
      setNewProjectName('');
      await fetchAndDecrypt();
    } else {
      Alert.alert('Error', 'Failed to create project. Please try again.');
    }
  };

  const openEditProjectModal = (project: Project) => {
    setEditingProject(project);
    setEditProjectName(project.name || '');
    setEditProjectColor(project.color ?? hashProjectColor(project.id));
    setEditProjectModalVisible(true);
  };

  const handleSaveEditProject = async () => {
    if (!editingProject) return;
    const name = editProjectName.trim();
    if (!name) return;
    setSavingEditProject(true);
    const res = await apiFetch(`/api/projects/${editingProject.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color: editProjectColor }),
    });
    setSavingEditProject(false);
    if (isOk(res)) {
      setEditProjectModalVisible(false);
      setEditingProject(null);
      await fetchAndDecrypt();
    } else {
      Alert.alert('Error', 'Failed to save project. Please try again.');
    }
  };

  const handleDeleteProject = () => {
    if (!editingProject) return;
    Alert.alert(
      'Archive Project',
      `Archive "${editingProject.name}"? Tasks will be preserved.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: async () => {
            const res = await apiFetch(`/api/projects/${editingProject.id}`, { method: 'DELETE' });
            if (isOk(res)) {
              setEditProjectModalVisible(false);
              setEditingProject(null);
              // Switch away from the deleted project if it was selected
              if (selectedProject === editingProject.id) setSelectedProject(null);
              await fetchAndDecrypt();
            } else {
              Alert.alert('Error', 'Failed to archive project.');
            }
          },
        },
      ],
    );
  };

  const handleArchiveAllDone = () => {
    Alert.alert(
      'Archive Done Tasks',
      'Archive all completed tasks in this project?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive All',
          style: 'destructive',
          onPress: async () => {
            const doneTasks = tasks.filter(
              (t) => t.stage === 'done' && !t.archived &&
                (selectedProject === null || t.projectId === selectedProject)
            );
            const results = await Promise.all(
              doneTasks.map((t) =>
                apiFetch(`/api/tasks/${t.id}`, {
                  method: 'PUT',
                  body: JSON.stringify({ archived: true }),
                })
              )
            );
            if (results.some((r) => !isOk(r))) {
              Alert.alert('Partial error', 'Some tasks could not be archived. The list will refresh.');
            }
            await fetchAndDecrypt();
          },
        },
      ],
    );
  };

  const parseLocalDate = (dueDate: string) => {
    const [y, m, d] = dueDate.split('-').map(Number);
    return new Date(y, m - 1, d);
  };

  const formatDueDate = (dueDate: string) =>
    parseLocalDate(dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const isOverdue = (dueDate: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return parseLocalDate(dueDate) < today;
  };

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color="#6366f1" size="large" /></View>;
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      {offline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>⚠ Can't reach server — any changes will sync when you reconnect.</Text>
        </View>
      )}
      {fetchError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorBannerText}>⚠ Failed to load tasks. Pull down to retry.</Text>
        </View>
      )}
      <NestableScrollContainer
        style={styles.mainScroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAndDecrypt(); }} tintColor="#6366f1" />}
      >
        {/* Heading row */}
        <View style={styles.headingRow}>
          <Text style={styles.heading}>Board</Text>
          <View style={styles.headingActions}>
            <TouchableOpacity
              style={styles.searchIconBtn}
              activeOpacity={0.7}
              onPress={() => router.push('/(app)/search')}
            >
              <Text style={styles.searchIconText}>🔍</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.newProjectBtn}
              activeOpacity={0.8}
              onPress={() => setNewProjectModalVisible(true)}
            >
              <Text style={styles.newProjectBtnText}>＋ Project</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.newTaskBtn}
              activeOpacity={0.8}
              onPress={() => router.push({ pathname: '/task/new', params: { projectId: selectedProject ?? '' } })}
            >
              <Text style={styles.newTaskBtnText}>＋ Task</Text>
            </TouchableOpacity>
          </View>
        </View>

        {undoTask && (
          <View style={styles.undoBanner}>
            <Text style={styles.undoBannerText} numberOfLines={1}>
              Archived "{undoTask.title}"
            </Text>
            <TouchableOpacity onPress={handleUndo} style={styles.undoBtn}>
              <Text style={styles.undoBtnText}>Undo</Text>
            </TouchableOpacity>
          </View>
        )}

        <DailyFocusSection />

        {/* Search bar */}
        <View style={styles.searchWrap}>
          <TextInput
            style={styles.search}
            placeholder="Search tasks…"
            placeholderTextColor={colors.placeholder}
            value={searchText}
            onChangeText={setSearchText}
            autoCorrect={false}
          />
        </View>

        {/* Project tabs */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.projectTabs} contentContainerStyle={styles.projectTabsContent}>
          <TouchableOpacity
            style={[styles.projectTab, selectedProject === null && styles.projectTabActive]}
            onPress={() => setSelectedProject(null)}
          >
            <Text style={[styles.projectTabText, selectedProject === null && styles.projectTabTextActive]}>All</Text>
          </TouchableOpacity>
          {projects.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={[styles.projectTab, selectedProject === p.id && styles.projectTabActive]}
              onPress={() => setSelectedProject(p.id)}
              onLongPress={() => openEditProjectModal(p)}
              delayLongPress={400}
            >
              <Text style={[styles.projectTabText, selectedProject === p.id && styles.projectTabTextActive]}>
                {p.name || '(Untitled)'}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Stage filter chips + Privacy toggle + Show Archived — all in one scroll row */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stageChips} style={styles.stageChipsScroll}>
          <TouchableOpacity
            style={[styles.stageChip, stageFilter.length === 0 && styles.stageChipAllActive]}
            onPress={() => setStageFilter([])}
          >
            <Text style={[styles.stageChipText, stageFilter.length === 0 && styles.stageChipAllActiveText]}>All</Text>
          </TouchableOpacity>
          {STAGES.map((stage) => {
            const active = stageFilter.includes(stage);
            return (
              <TouchableOpacity
                key={stage}
                style={[styles.stageChip, active && { backgroundColor: STAGE_COLORS[stage] + '33', borderColor: STAGE_COLORS[stage] }]}
                onPress={() => toggleStageFilter(stage)}
              >
                <Text style={[styles.stageChipText, active && { color: STAGE_COLORS[stage] }]}>{STAGE_LABELS[stage]}</Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={[styles.stageChip, privacyMode && styles.privacyChipActive]}
            onPress={handlePrivacyChip}
          >
            <Text style={[styles.stageChipText, privacyMode && styles.privacyChipActiveText]}>
              {privacyMode ? '🔒 Privacy' : '🔓 Privacy'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.stageChip, showArchived && styles.archivedChipActive]}
            onPress={() => setShowArchived((v) => !v)}
          >
            <Text style={[styles.stageChipText, showArchived && styles.archivedChipActiveText]}>Archived</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* Kanban columns */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          nestedScrollEnabled
          contentContainerStyle={styles.columns}
        >
          {STAGES.map((stage) => {
            const stageTasks = tasksForStage(stage);
            const isDoneColumn = stage === 'done';
            return (
              <View key={stage} style={styles.column}>
                <View style={styles.columnHeader}>
                  <TouchableOpacity
                    onPress={() => setColorPickerStage(stage)}
                    activeOpacity={0.7}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <View style={[styles.stageDot, { backgroundColor: stageColors[stage] }]} />
                  </TouchableOpacity>
                  <Text style={styles.stageLabel}>{STAGE_LABELS[stage]}</Text>
                  <Text style={styles.stageCount}>{stageTasks.length}</Text>
                  {isDoneColumn && (
                    <TouchableOpacity
                      style={styles.archiveDoneBtn}
                      activeOpacity={0.7}
                      onPress={handleArchiveAllDone}
                    >
                      <Text style={styles.archiveDoneBtnText}>Archive Done</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <DraggableFlatList
                  data={stageTasks}
                  keyExtractor={(t) => t.id}
                  onDragEnd={({ data }) => handleReorderTasks(stage, data)}
                  scrollEnabled={false}
                  contentContainerStyle={styles.columnCards}
                  ListEmptyComponent={<Text style={styles.emptyCol}>No tasks</Text>}
                  renderItem={({ item, drag, isActive }: RenderItemParams<Task>) => {
                    const projectColor = projectMap[item.projectId]?.color ?? hashProjectColor(item.projectId);
                    const projectName = projectMap[item.projectId]?.name;
                    const isRedacted = (item.locked && !isUnlocked) || (privacyMode && item.sensitive);
                    const displayTitle = isRedacted ? '••••••••••' : (item.title || '(Untitled)');
                    const stageIdx = STAGES.indexOf(item.stage);
                    const nextStage = STAGES[stageIdx + 1] ?? null;
                    const prevStage = STAGES[stageIdx - 1] ?? null;
                    return (
                      <ScaleDecorator>
                        <Swipeable
                          friction={2}
                          overshootLeft={false}
                          overshootRight={false}
                          enabled={!isActive}
                          renderLeftActions={nextStage ? () => (
                            <View style={[styles.swipeAction, { backgroundColor: (stageColors[nextStage] ?? STAGE_COLORS[nextStage]) + 'cc' }]}>
                              <Text style={styles.swipeActionText}>→ {STAGE_LABELS[nextStage]}</Text>
                            </View>
                          ) : undefined}
                          renderRightActions={prevStage ? () => (
                            <View style={[styles.swipeAction, { backgroundColor: (stageColors[prevStage] ?? STAGE_COLORS[prevStage]) + 'cc' }]}>
                              <Text style={styles.swipeActionText}>{STAGE_LABELS[prevStage]} ←</Text>
                            </View>
                          ) : undefined}
                          onSwipeableOpen={(direction) => {
                            if (direction === 'left' && nextStage) handleSwipeStage(item.id, nextStage);
                            if (direction === 'right' && prevStage) handleSwipeStage(item.id, prevStage);
                          }}
                        >
                          <TouchableOpacity
                            style={[styles.taskCard, isActive && styles.taskCardDragging]}
                            activeOpacity={0.75}
                            onPress={() => {
                              if ((item.locked && !isUnlocked) || (privacyMode && item.sensitive && !isUnlocked)) {
                                setPendingTaskId(item.id);
                                setVaultUnlockVisible(true);
                                return;
                              }
                              router.push(`/task/${item.id}`);
                            }}
                            onLongPress={drag}
                            delayLongPress={250}
                          >
                            {projectName ? (
                              <Text style={[styles.cardProject, { color: projectColor }]} numberOfLines={1}>
                                {projectName.toUpperCase()}
                              </Text>
                            ) : null}
                            <Text style={styles.taskTitle} numberOfLines={3}>{displayTitle}</Text>
                            {item.dueDate ? (
                              <Text style={[styles.cardDueDate, isOverdue(item.dueDate) && styles.cardDueDateOverdue]}>
                                📅 {formatDueDate(item.dueDate)}
                              </Text>
                            ) : null}
                            <View style={styles.cardFooter}>
                              {item.priority ? (
                                <View style={[styles.priorityBadge, { backgroundColor: PRIORITY_COLORS[item.priority] ?? '#475569' }]}>
                                  <Text style={styles.priorityText}>{item.priority}</Text>
                                </View>
                              ) : null}
                              {item.sensitive && !isRedacted && (
                                <Text style={styles.sensitiveBadge}>🔒</Text>
                              )}
                              <Text style={styles.dragHint}>⠿</Text>
                            </View>
                          </TouchableOpacity>
                        </Swipeable>
                      </ScaleDecorator>
                    );
                  }}
                />
              </View>
            );
          })}
        </ScrollView>

        <View style={{ height: 100 }} />
      </NestableScrollContainer>

      {/* FAB — creates task, optionally in the selected project */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.85}
        onPress={() => router.push({ pathname: '/task/new', params: { projectId: selectedProject ?? '' } })}
      >
        <Text style={styles.fabIcon}>+</Text>
      </TouchableOpacity>

      {/* New Project Modal */}
      <Modal
        visible={newProjectModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setNewProjectModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New Project</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Project name"
              placeholderTextColor={colors.placeholder}
              value={newProjectName}
              onChangeText={setNewProjectName}
              autoFocus
              autoCorrect={false}
              onSubmitEditing={handleCreateProject}
              returnKeyType="done"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => { setNewProjectModalVisible(false); setNewProjectName(''); }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalCreateBtn, (!newProjectName.trim() || savingProject) && styles.modalCreateBtnDisabled]}
                onPress={handleCreateProject}
                disabled={!newProjectName.trim() || savingProject}
              >
                <Text style={styles.modalCreateText}>{savingProject ? 'Creating…' : 'Create'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Edit Project Modal */}
      <Modal
        visible={editProjectModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => { setEditProjectModalVisible(false); setEditingProject(null); }}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Edit Project</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Project name"
              placeholderTextColor={colors.placeholder}
              value={editProjectName}
              onChangeText={setEditProjectName}
              autoCorrect={false}
              returnKeyType="done"
            />
            {/* Color picker */}
            <View style={styles.colorPickerRow}>
              {PROJECT_PALETTE.map((color) => (
                <TouchableOpacity
                  key={color}
                  style={[
                    styles.colorCircle,
                    { backgroundColor: color },
                    editProjectColor === color && styles.colorCircleSelected,
                  ]}
                  onPress={() => setEditProjectColor(color)}
                  activeOpacity={0.8}
                />
              ))}
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalDeleteBtn}
                onPress={handleDeleteProject}
              >
                <Text style={styles.modalDeleteText}>Archive</Text>
              </TouchableOpacity>
              <View style={{ flex: 1 }} />
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => { setEditProjectModalVisible(false); setEditingProject(null); }}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalCreateBtn, (!editProjectName.trim() || savingEditProject) && styles.modalCreateBtnDisabled]}
                onPress={handleSaveEditProject}
                disabled={!editProjectName.trim() || savingEditProject}
              >
                <Text style={styles.modalCreateText}>{savingEditProject ? 'Saving…' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Stage Color Picker Modal */}
      <Modal
        visible={colorPickerStage !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setColorPickerStage(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>
              {colorPickerStage ? `${STAGE_LABELS[colorPickerStage]} Color` : 'Stage Color'}
            </Text>
            <View style={styles.stageColorGrid}>
              {STAGE_COLOR_PALETTE.map((color) => (
                <TouchableOpacity
                  key={color}
                  style={[
                    styles.colorCircle,
                    { backgroundColor: color },
                    colorPickerStage && stageColors[colorPickerStage] === color && styles.colorCircleSelected,
                  ]}
                  activeOpacity={0.8}
                  onPress={async () => {
                    if (!colorPickerStage) return;
                    const updated = { ...stageColors, [colorPickerStage]: color };
                    setStageColors(updated);
                    await SecureStore.setItemAsync(STAGE_COLORS_KEY, JSON.stringify(updated));
                    apiFetch('/api/settings/stage-colors', { method: 'PATCH', body: JSON.stringify(updated) }).catch(() => {});
                    setColorPickerStage(null);
                  }}
                />
              ))}
            </View>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setColorPickerStage(null)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <VaultUnlockModal
        visible={vaultUnlockVisible}
        onSuccess={() => {
          setVaultUnlockVisible(false);
          setPrivacyMode(false);
          if (pendingTaskId) {
            router.push(`/task/${pendingTaskId}`);
            setPendingTaskId(null);
          }
        }}
        onCancel={() => { setVaultUnlockVisible(false); setPendingTaskId(null); }}
      />
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    offlineBanner: { backgroundColor: '#7c2d12', paddingHorizontal: 16, paddingVertical: 8 },
    offlineText: { color: '#fdba74', fontSize: 12, fontWeight: '600', lineHeight: 16 },
    errorBanner: { backgroundColor: '#450a0a', paddingHorizontal: 16, paddingVertical: 8 },
    errorBannerText: { color: '#fca5a5', fontSize: 12, fontWeight: '600', lineHeight: 16 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: c.bg },
    mainScroll: { flex: 1 },

    // Heading row
    headingRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8,
    },
    heading: { color: c.tx, fontSize: 26, fontWeight: '800' },
    headingActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    searchIconBtn: {
      width: 36, height: 36, borderRadius: 8,
      backgroundColor: c.surface2,
      alignItems: 'center', justifyContent: 'center',
    },
    searchIconText: { fontSize: 16 },
    newProjectBtn: {
      paddingHorizontal: 12, paddingVertical: 6,
      borderRadius: 8, backgroundColor: 'rgba(99,102,241,0.15)',
      borderWidth: 1, borderColor: '#6366f1',
    },
    newProjectBtnText: { color: '#a5b4fc', fontSize: 13, fontWeight: '700' },
    newTaskBtn: {
      paddingHorizontal: 12, paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: '#6366f1',
    },
    newTaskBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },

    // Search
    searchWrap: { paddingHorizontal: 16, paddingBottom: 10 },
    search: {
      backgroundColor: c.surface, borderRadius: 10, borderWidth: 1, borderColor: c.border,
      color: c.tx, fontSize: 15, paddingHorizontal: 14, paddingVertical: 10,
    },

    // Project tabs
    projectTabs: { flexGrow: 0, paddingBottom: 4 },
    projectTabsContent: { paddingHorizontal: 16, gap: 8 },
    projectTab: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, backgroundColor: c.surface, borderWidth: 1, borderColor: c.border },
    projectTabActive: { backgroundColor: 'rgba(99,102,241,0.2)', borderColor: '#6366f1' },
    projectTabText: { color: c.tx3, fontSize: 13, fontWeight: '600' },
    projectTabTextActive: { color: '#a5b4fc' },

    // Filter row
    filterRow: {
      flexDirection: 'row', alignItems: 'center',
      paddingRight: 12, marginBottom: 4,
    },
    stageChipsScroll: { flexShrink: 1 },
    stageChips: { paddingHorizontal: 16, gap: 6, alignItems: 'center' },
    stageChip: {
      paddingHorizontal: 10, paddingVertical: 5,
      borderRadius: 20, backgroundColor: c.surface,
      borderWidth: 1, borderColor: c.border,
    },
    stageChipAllActive: { backgroundColor: 'rgba(99,102,241,0.2)', borderColor: '#6366f1' },
    stageChipText: { color: c.tx3, fontSize: 12, fontWeight: '600' },
    stageChipAllActiveText: { color: '#a5b4fc' },
    privacyChipActive: { backgroundColor: 'rgba(239,68,68,0.15)', borderColor: '#ef4444' },
    privacyChipActiveText: { color: '#f87171' },
    archivedChipActive: { backgroundColor: 'rgba(245,158,11,0.15)', borderColor: '#f59e0b' },
    archivedChipActiveText: { color: '#fbbf24' },

    // Kanban
    columns: { padding: 16, gap: 12, alignItems: 'flex-start' },
    column: { width: 220, backgroundColor: c.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: c.border },
    columnHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
    stageDot: { width: 8, height: 8, borderRadius: 4 },
    stageLabel: { color: c.tx2, fontSize: 12, fontWeight: '700', flex: 1, textTransform: 'uppercase', letterSpacing: 0.5 },
    stageCount: { color: c.tx4, fontSize: 12, fontWeight: '600' },
    stagePaletteBtn: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
    stagePaletteBtnText: { fontSize: 13 },
    stageColorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center', paddingVertical: 4 },
    archiveDoneBtn: {
      paddingHorizontal: 6, paddingVertical: 2,
      borderRadius: 4, backgroundColor: c.surface2,
      borderWidth: 1, borderColor: c.border,
    },
    archiveDoneBtnText: { color: c.tx3, fontSize: 10, fontWeight: '600' },
    columnCards: { gap: 8 },
    taskCard: { backgroundColor: c.bg, borderRadius: 8, padding: 12, borderWidth: 1, borderColor: c.border, gap: 4 },
    taskCardDragging: { borderColor: '#6366f1', shadowColor: '#6366f1', shadowOpacity: 0.4, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
    cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
    dragHint: { color: c.border, fontSize: 14, opacity: 0.6 },
    swipeAction: {
      justifyContent: 'center', alignItems: 'center',
      width: 110, borderRadius: 8, marginBottom: 0,
    },
    swipeActionText: { color: '#fff', fontSize: 12, fontWeight: '700', textAlign: 'center', paddingHorizontal: 8 },
    cardProject: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
    taskTitle: { color: c.tx, fontSize: 13, fontWeight: '600', lineHeight: 18 },
    cardDueDate: { fontSize: 11, color: c.tx3, marginTop: 1 },
    cardDueDateOverdue: { color: '#ef4444' },
    emptyCol: { color: c.border2, fontSize: 12, textAlign: 'center', paddingVertical: 12 },
    priorityBadge: { alignSelf: 'flex-start', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginTop: 2 },
    priorityText: { color: '#fff', fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
    sensitiveBadge: { fontSize: 11, opacity: 0.7 },

    // FAB
    fab: {
      position: 'absolute', bottom: 28, right: 24,
      width: 56, height: 56, borderRadius: 28,
      backgroundColor: '#6366f1', justifyContent: 'center', alignItems: 'center',
      shadowColor: '#6366f1', shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
      elevation: 8,
    },
    fabIcon: { color: '#fff', fontSize: 28, lineHeight: 32 },

    // Modals (shared)
    modalOverlay: {
      flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
      justifyContent: 'center', alignItems: 'center', padding: 32,
    },
    modalCard: {
      width: '100%', backgroundColor: c.surface,
      borderRadius: 16, padding: 24, borderWidth: 1, borderColor: c.border, gap: 16,
    },
    modalTitle: { color: c.tx, fontSize: 18, fontWeight: '800' },
    modalInput: {
      backgroundColor: c.bg, borderRadius: 10, borderWidth: 1, borderColor: c.border,
      color: c.tx, fontSize: 15, paddingHorizontal: 14, paddingVertical: 12,
    },
    modalActions: { flexDirection: 'row', gap: 10, alignItems: 'center' },
    modalCancelBtn: {
      paddingHorizontal: 16, paddingVertical: 9,
      borderRadius: 8, backgroundColor: c.bg, borderWidth: 1, borderColor: c.border,
    },
    modalCancelText: { color: c.tx2, fontSize: 14, fontWeight: '600' },
    modalCreateBtn: {
      paddingHorizontal: 16, paddingVertical: 9,
      borderRadius: 8, backgroundColor: '#6366f1',
    },
    modalCreateBtnDisabled: { opacity: 0.45 },
    modalCreateText: { color: '#fff', fontSize: 14, fontWeight: '700' },
    modalDeleteBtn: {
      paddingHorizontal: 12, paddingVertical: 9,
      borderRadius: 8, backgroundColor: 'rgba(239,68,68,0.12)',
      borderWidth: 1, borderColor: '#ef4444',
    },
    modalDeleteText: { color: '#f87171', fontSize: 14, fontWeight: '600' },

    // Color picker
    colorPickerRow: { flexDirection: 'row', gap: 12, justifyContent: 'center', paddingVertical: 4 },
    colorCircle: { width: 32, height: 32, borderRadius: 16 },
    colorCircleSelected: { borderWidth: 3, borderColor: c.tx, transform: [{ scale: 1.15 }] },

    // Undo banner
    undoBanner: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: c.surface, marginHorizontal: 16, marginBottom: 8,
      borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
      borderWidth: 1, borderColor: c.border,
    },
    undoBannerText: { color: c.tx2, fontSize: 13, flex: 1 },
    undoBtn: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 6, backgroundColor: 'rgba(99,102,241,0.2)', marginLeft: 8 },
    undoBtnText: { color: '#a5b4fc', fontSize: 13, fontWeight: '700' },
  });
}
