import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, Modal, FlatList, Alert, AppState,
} from 'react-native';
import { NestableDraggableFlatList, ScaleDecorator, type RenderItemParams } from 'react-native-draggable-flatlist';
import * as SecureStore from 'expo-secure-store';
import { apiFetch, apiFetchCached, isOfflineResult, isOk } from '@/lib/api';
import { useVault } from '@/lib/vault-context';
import { useRouter } from 'expo-router';
import { getGoalLimit } from '@/lib/storage';
import type { DailyGoal, Task, Project } from '@/lib/types';
import { useHabits, statsFor } from '@/lib/habits';
import { KIND_COPY } from '@/lib/habit-kind';
import type { HabitKind } from '@/lib/habit-stats';
import { WeekStrip, OutcomeButtons, StreakText } from '@/components/HabitParts';
import { useThemeColors, type ThemeColors } from '@/lib/theme-context';

const localDateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const todayStr = () => localDateStr(new Date());

const addDays = (base: string, days: number): string => {
  const d = new Date(base + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return localDateStr(d);
};

const formatDate = (iso: string) =>
  new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

const MAX_FUTURE = 7;

export default function DailyFocusSection() {
  const router = useRouter();
  const { masterKey, encrypt, decrypt } = useVault();
  const colors = useThemeColors();
  const s = makeStyles(colors);

  const vaultEncrypt = async (text: string): Promise<{ encText: string; text: string } | { text: string }> => {
    if (!masterKey) return { text };
    const blob = await encrypt(text);
    if (!blob) return { text };
    return { encText: JSON.stringify(blob), text: '' };
  };

  const vaultDecryptGoals = useCallback(async (goals: DailyGoal[]): Promise<DailyGoal[]> => {
    if (!masterKey) return goals;
    return Promise.all(goals.map(async (g) => {
      if (!g.encText) return g;
      const dec = await decrypt(JSON.parse(g.encText));
      return { ...g, text: dec ?? g.text };
    }));
  }, [masterKey, decrypt]);


  const [collapsed, setCollapsed] = useState(false);
  const [today, setToday] = useState(todayStr);
  const [dayOffset, setDayOffset] = useState(0);
  const [goalLimit, setGoalLimitState] = useState(3);
  const [extraSlots, setExtraSlots] = useState(0);

  const [goals, setGoals] = useState<DailyGoal[]>([]);
  const habitsApi = useHabits();
  const habits = habitsApi.habits.filter((h) => !h.archivedAt);
  const [carryOver, setCarryOver] = useState<DailyGoal[]>([]);
  const [reflection, setReflection] = useState('');
  const [gratitude, setGratitude] = useState('');
  const [prevReflection, setPrevReflection] = useState<string | null>(null);

  const [addingGoalIdx, setAddingGoalIdx] = useState<number | null>(null);
  const [goalInput, setGoalInput] = useState('');
  const [linkedTask, setLinkedTask] = useState<Task | null>(null);
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
  const [availableTasks, setAvailableTasks] = useState<(Task & { projectName: string })[]>([]);
  const [taskSearch, setTaskSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState(false);
  const [carryingOver, setCarryingOver] = useState(false);

  // Feature 1: inline goal editing
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [editingGoalText, setEditingGoalText] = useState('');

  const reflectionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gratitudeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchGenRef = useRef(0);

  const viewDate = dayOffset === 0 ? today : addDays(today, dayOffset);
  const isToday = dayOffset === 0;

  // Feature 4: persist collapse state — load on mount
  useEffect(() => {
    SecureStore.getItemAsync('taskboard_focus_collapsed').then(v => {
      if (v === 'true') setCollapsed(true);
    });
  }, []);

  // Feature 4: toggle with persistence
  const toggleCollapsed = () => setCollapsed(v => {
    const next = !v;
    SecureStore.setItemAsync('taskboard_focus_collapsed', String(next));
    return next;
  });

  useEffect(() => {
    const id = setInterval(() => setToday(todayStr()), 60_000);
    // Timers stop in the background; catch up as soon as the app is opened again.
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') setToday(todayStr()); });
    return () => { clearInterval(id); sub.remove(); };
  }, []);

  useEffect(() => { getGoalLimit().then(setGoalLimitState); }, []);

  // Fetches and decrypts everything for the current day without touching state.
  // Returns null when a newer fetch has started in the meantime.
  const loadFocusData = useCallback(async (gen: number) => {
    const [goalsRes, reflRes, prevReflRes] = await Promise.all([
      apiFetchCached<DailyGoal[]>(`/api/daily-goals?date=${viewDate}`),
      apiFetchCached<{ note?: string; encNote?: string; gratitude?: string; encGratitude?: string }>(`/api/daily-reflections?date=${today}`),
      apiFetchCached<{ note?: string; encNote?: string }>(`/api/daily-reflections?date=${addDays(today, -1)}`),
    ]);

    // Discard results if a newer navigation has already started a fetch
    if (gen !== fetchGenRef.current) return null;

    let goals: DailyGoal[] = [];
    if (isOk(goalsRes)) {
      const gs = await vaultDecryptGoals(goalsRes.data);
      goals = [...gs.filter(g => !g.completed), ...gs.filter(g => g.completed)];
    }

    // null = keep existing UI state on API error (may have unsaved user input)
    let reflection: { note: string; grat: string } | null = null;
    if (isOk(reflRes)) {
      if (reflRes.data) {
        const r = reflRes.data;
        const note = r.encNote && masterKey ? ((await decrypt(JSON.parse(r.encNote))) ?? r.note ?? '') : (r.note ?? '');
        const grat = r.encGratitude && masterKey ? ((await decrypt(JSON.parse(r.encGratitude))) ?? r.gratitude ?? '') : (r.gratitude ?? '');
        reflection = { note, grat };
      } else {
        // No reflection entry for today yet
        reflection = { note: '', grat: '' };
      }
    }

    let prevReflection: string | null = null;
    if (isOk(prevReflRes) && prevReflRes.data) {
      const r = prevReflRes.data;
      const note = r.encNote && masterKey ? ((await decrypt(JSON.parse(r.encNote))) ?? r.note ?? null) : (r.note ?? null);
      prevReflection = note || null;
    }

    let carryOver: DailyGoal[] = [];
    if (isToday) {
      const carryRes = await apiFetchCached<DailyGoal[]>(`/api/daily-goals?carryover=true&today=${today}`);
      if (gen !== fetchGenRef.current) return null;
      if (isOk(carryRes)) carryOver = await vaultDecryptGoals(carryRes.data);
    }

    // If all primary fetches returned network errors (status 0), flag as offline
    const offline = [goalsRes, reflRes].every(isOfflineResult);
    return { goals, reflection, prevReflection, carryOver, offline };
  }, [viewDate, today, isToday, masterKey, vaultDecryptGoals, decrypt]);

  const fetchAll = useCallback(() => {
    const gen = ++fetchGenRef.current;
    return loadFocusData(gen).then(
      (data) => {
        if (gen !== fetchGenRef.current) return;
        if (data) {
          setGoals(data.goals);
          if (data.reflection) {
            setReflection(data.reflection.note);
            setGratitude(data.reflection.grat);
          }
          setPrevReflection(data.prevReflection);
          setCarryOver(data.carryOver);
          setOffline(data.offline);
        }
        setLoading(false);
      },
      () => {
        if (gen !== fetchGenRef.current) return;
        setOffline(true);
        setLoading(false);
      },
    );
  }, [loadFocusData]);

  // Show the spinner whenever an input to fetchAll changes
  const [fetchInputs, setFetchInputs] = useState({ viewDate, today, isToday, masterKey, decrypt });
  if (
    fetchInputs.viewDate !== viewDate || fetchInputs.today !== today || fetchInputs.isToday !== isToday ||
    fetchInputs.masterKey !== masterKey || fetchInputs.decrypt !== decrypt
  ) {
    setFetchInputs({ viewDate, today, isToday, masterKey, decrypt });
    setLoading(true);
  }

  useEffect(() => {
    fetchAll().catch(() => setLoading(false));
  }, [fetchAll]);

  const [prevDayOffset, setPrevDayOffset] = useState(dayOffset);
  if (prevDayOffset !== dayOffset) {
    setPrevDayOffset(dayOffset);
    setAddingGoalIdx(null);
    setGoalInput('');
    setExtraSlots(0);
  }

  // ── Habits ──────────────────────────────────────────────────────────────────

  const openTaskPicker = async () => {
    const [tasksRes, projectsRes] = await Promise.all([
      apiFetch<Task[]>('/api/tasks'),
      apiFetch<Project[]>('/api/projects'),
    ]);
    if (!isOk(tasksRes) || !isOk(projectsRes)) return;
    const projectMap = Object.fromEntries(
      await Promise.all(projectsRes.data.map(async (p) => [
        p.id,
        p.encName ? ((await decrypt(JSON.parse(p.encName))) ?? p.name) : p.name,
      ]))
    );
    const active = await Promise.all(
      tasksRes.data
        .filter((t) => !t.archived && t.stage !== 'done')
        .map(async (t) => ({
          ...t,
          title: t.encTitle ? ((await decrypt(JSON.parse(t.encTitle))) ?? t.title) : t.title,
          projectName: projectMap[t.projectId] ?? '',
        }))
    );
    setAvailableTasks(active);
    setTaskSearch('');
    setTaskPickerOpen(true);
  };

  // ── Goals ───────────────────────────────────────────────────────────────────

  const handleAddGoal = async (slotIdx: number) => {
    const text = linkedTask ? linkedTask.title : goalInput.trim();
    if (!text) return;
    const encFields = await vaultEncrypt(text);
    const res = await apiFetch<DailyGoal>('/api/daily-goals', {
      method: 'POST',
      body: JSON.stringify({ ...encFields, taskId: linkedTask?.id ?? null, date: viewDate, position: slotIdx, limit: goalLimit }),
    });
    if (isOk(res)) {
      await fetchAll();
      setGoalInput('');
      setAddingGoalIdx(null);
      setLinkedTask(null);
    }
  };

  const handleToggleGoal = async (goal: DailyGoal) => {
    const nowCompleted = !goal.completed;
    const res = await apiFetch(`/api/daily-goals/${goal.id}`, {
      method: 'PUT',
      body: JSON.stringify({ completed: nowCompleted }),
    });
    if (!isOk(res)) return;
    if (nowCompleted && goal.taskId) {
      // Best-effort: mark linked task done; failure is non-critical
      await apiFetch(`/api/tasks/${goal.taskId}`, {
        method: 'PUT',
        body: JSON.stringify({ stage: 'done' }),
      });
      // Note: we still update goal UI state even if the task PUT fails
    }
    setGoals((prev) => {
      const updated = prev.map((g) => g.id === goal.id ? { ...g, completed: nowCompleted } : g);
      return [...updated.filter((g) => !g.completed), ...updated.filter((g) => g.completed)];
    });
  };

  const handleDeleteGoal = async (id: string) => {
    const res = await apiFetch(`/api/daily-goals/${id}`, { method: 'DELETE' });
    if (isOk(res)) setGoals((prev) => prev.filter((g) => g.id !== id));
  };

  // Feature 1: inline goal edit
  const handleEditGoal = async (id: string, newText: string) => {
    const encFields = await vaultEncrypt(newText);
    const res = await apiFetch(`/api/daily-goals/${id}`, { method: 'PUT', body: JSON.stringify(encFields) });
    if (isOk(res)) setGoals(prev => prev.map(g => g.id === id ? { ...g, text: newText } : g));
  };

  const commitGoalEdit = async (goal: DailyGoal) => {
    const trimmed = editingGoalText.trim();
    setEditingGoalId(null);
    if (trimmed && trimmed !== goal.text) {
      await handleEditGoal(goal.id, trimmed);
    }
  };

  // Feature 2: move goal to next day
  const handleMoveToNextDay = async (goalId: string) => {
    const nextDay = addDays(viewDate, 1);
    const res = await apiFetch(`/api/daily-goals/${goalId}`, { method: 'PUT', body: JSON.stringify({ date: nextDay }) });
    if (isOk(res)) setGoals(prev => prev.filter(g => g.id !== goalId));
  };

  const handleReorderGoals = useCallback(async (reordered: DailyGoal[]) => {
    const rePositioned = reordered.map((g, i) => ({ ...g, position: i }));
    setGoals(rePositioned);
    await Promise.all(
      rePositioned.map((g) =>
        apiFetch(`/api/daily-goals/${g.id}`, { method: 'PUT', body: JSON.stringify({ position: g.position }) })
      )
    );
  }, []);

  const handleCarryOver = async () => {
    if (carryingOver) return;
    // If any goal was encrypted but the vault is now locked, refuse to downgrade to plaintext
    if (carryOver.some((g) => g.encText) && !masterKey) {
      Alert.alert('Vault locked', 'Unlock your vault first to carry over encrypted goals.');
      return;
    }
    setCarryingOver(true);
    const limit = Math.min(goals.length + carryOver.length, 20);
    for (let i = 0; i < carryOver.length; i++) {
      const g = carryOver[i];
      const encFields = await vaultEncrypt(g.text);
      const res = await apiFetch('/api/daily-goals', {
        method: 'POST',
        body: JSON.stringify({ ...encFields, taskId: g.taskId, date: today, position: goals.length + i, limit }),
      });
      if (!isOk(res)) continue;
      const created = (res as { data: { id: string } }).data;
      const delRes = await apiFetch(`/api/daily-goals/${g.id}`, { method: 'DELETE' });
      if (!isOk(delRes)) {
        // Rollback: delete the just-created goal so the original isn't orphaned
        await apiFetch(`/api/daily-goals/${created.id}`, { method: 'DELETE' });
      }
    }
    setCarryOver([]);
    setCarryingOver(false);
    fetchAll();
  };

  // ── Reflections ─────────────────────────────────────────────────────────────

  const saveReflection = useCallback(async (note: string) => {
    const encFields = await vaultEncrypt(note);
    const body = 'encText' in encFields
      ? { date: today, encNote: (encFields as { encText: string }).encText, note: '' }
      : { date: today, note };
    await apiFetch('/api/daily-reflections', { method: 'PUT', body: JSON.stringify(body) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, masterKey]);

  const saveGratitude = useCallback(async (grat: string) => {
    const encFields = await vaultEncrypt(grat);
    const body = 'encText' in encFields
      ? { date: today, encGratitude: (encFields as { encText: string }).encText, gratitude: '' }
      : { date: today, gratitude: grat };
    await apiFetch('/api/daily-reflections', { method: 'PUT', body: JSON.stringify(body) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, masterKey]);

  const handleReflectionChange = (v: string) => {
    setReflection(v);
    if (reflectionTimer.current) clearTimeout(reflectionTimer.current);
    reflectionTimer.current = setTimeout(() => saveReflection(v), 1000);
  };

  const handleGratitudeChange = (v: string) => {
    setGratitude(v);
    if (gratitudeTimer.current) clearTimeout(gratitudeTimer.current);
    gratitudeTimer.current = setTimeout(() => saveGratitude(v), 1000);
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  // Feature 3: extraSlots increases total available slots
  const totalSlots = Math.max(goalLimit, goals.length) + extraSlots;
  const loggedHabits = habits.filter((h) => h.outcomes[habitsApi.today]).length;
  const completedGoals = goals.filter((g) => g.completed).length;

  const relativeLabel =
    dayOffset === -1 ? 'Yesterday' :
    dayOffset === 0  ? 'Today' :
    dayOffset === 1  ? 'Tomorrow' : null;

  return (
    <View style={s.card}>
      {/* Header */}
      <TouchableOpacity style={s.header} onPress={toggleCollapsed} activeOpacity={0.7}>
        {/* Row 1: title + stats + collapse icon */}
        <View style={s.headerRow}>
          <Text style={s.headerTitle}>Daily Focus</Text>
          <View style={s.headerRowRight}>
            {!collapsed && (goals.length > 0 || habits.length > 0) && (
              <View style={s.statsRow}>
                {goals.length > 0 && (
                  <View style={[s.statBadge, completedGoals === goals.length && s.statBadgeDone]}>
                    <Text style={[s.statBadgeText, completedGoals === goals.length && s.statBadgeTextDone]}>
                      {completedGoals}/{goals.length} goals
                    </Text>
                  </View>
                )}
                {habits.length > 0 && (
                  <View style={[s.statBadge, loggedHabits === habits.length && s.statBadgeDone]}>
                    <Text style={[s.statBadgeText, loggedHabits === habits.length && s.statBadgeTextDone]}>
                      {loggedHabits}/{habits.length} habits
                    </Text>
                  </View>
                )}
              </View>
            )}
            <Text style={s.collapseIcon}>{collapsed ? '▾' : '▴'}</Text>
          </View>
        </View>
        {/* Row 2: date nav — arrows stop event propagation, plain areas still collapse */}
        <View style={s.headerRow}>
          <View style={s.dateNav}>
            <TouchableOpacity onPress={() => setDayOffset((o) => o - 1)} style={s.navBtn} hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}>
              <Text style={s.navBtnText}>‹</Text>
            </TouchableOpacity>
            <Text style={s.dateText} numberOfLines={1}>{formatDate(viewDate)}</Text>
            <TouchableOpacity
              onPress={() => setDayOffset((o) => Math.min(o + 1, MAX_FUTURE))}
              disabled={dayOffset >= MAX_FUTURE}
              style={s.navBtn}
              hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
            >
              <Text style={[s.navBtnText, dayOffset >= MAX_FUTURE && s.navBtnDisabled]}>›</Text>
            </TouchableOpacity>
          </View>
          {dayOffset === 0 ? (
            <View style={s.relBadge}>
              <Text style={s.relBadgeText}>Today</Text>
            </View>
          ) : (
            <TouchableOpacity onPress={() => setDayOffset(0)} style={s.relBadge}>
              <Text style={s.relBadgeText}>{relativeLabel ?? 'Back to Today'}</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>

      {!collapsed && (
        <View style={s.body}>
          {loading ? (
            <ActivityIndicator color="#6366f1" style={{ paddingVertical: 20 }} />
          ) : (
            <>
              {offline && (
                <View style={s.offlineBanner}>
                  <Text style={s.offlineText}>⚠ Can&apos;t reach server — any changes will sync when you reconnect.</Text>
                </View>
              )}
              {/* Previous day's reflection banner */}
              {prevReflection && (
                <View style={s.prevReflBanner}>
                  <Text style={s.prevReflLabel}>{'ONE THING TO\nDO BETTER TODAY'}</Text>
                  <Text style={s.prevReflText}>{prevReflection}</Text>
                </View>
              )}

              {/* ── Habits (today only; past days are logged on the Habits tab) ── */}
              {isToday && (
                <View style={s.section}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={s.sectionLabel}>DAILY HABITS</Text>
                    <TouchableOpacity onPress={() => router.push('/habits')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Text style={s.habitsLink}>{habits.length === 0 ? 'Add a habit ›' : 'Habits ›'}</Text>
                    </TouchableOpacity>
                  </View>
                  {(['GOOD', 'BAD'] as HabitKind[]).map((kind) => {
                    const items = habits.filter((h) => h.kind === kind);
                    if (items.length === 0) return null;
                    return (
                      <View key={kind}>
                        <Text style={s.habitGroupLabel}>{KIND_COPY[kind].group.toUpperCase()}</Text>
                        {items.map((h, i) => (
                          <View key={h.id} style={[s.habitRow, i === items.length - 1 && { borderBottomWidth: 0 }]}>
                            <View style={{ flex: 1, gap: 6 }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <Text style={s.habitText} numberOfLines={1}>{h.locked ? '🔒 Locked habit' : h.name}</Text>
                                <StreakText colors={colors} streak={statsFor(h, habitsApi.today, habitsApi.weekStartsOn).currentStreak} />
                              </View>
                              <WeekStrip colors={colors} outcomes={h.outcomes} today={habitsApi.today} weekStartsOn={habitsApi.weekStartsOn} size={18} />
                            </View>
                            <OutcomeButtons colors={colors} kind={h.kind} value={h.outcomes[habitsApi.today]} compact
                              onChange={(o) => habitsApi.setOutcome(h.id, habitsApi.today, o)} />
                          </View>
                        ))}
                      </View>
                    );
                  })}
                </View>
              )}

              {/* ── Goals ── */}
              <View style={s.section}>
                <View style={s.goalsHeader}>
                  <Text style={s.sectionLabel}>
                    {isToday ? `Today's Top Goals` :
                      dayOffset === 1 ? `Tomorrow's Goals` :
                      dayOffset === -1 ? `Yesterday's Goals` :
                      `Goals`}
                  </Text>
                  {isToday && (carryOver.length > 0 || carryingOver) && (
                    <TouchableOpacity onPress={handleCarryOver} style={s.carryOverBtn} disabled={carryingOver}>
                      <Text style={s.carryOverText}>
                        {carryingOver ? '⏳ Carrying over…' : `${carryOver.length} from yesterday — Carry over`}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Existing goals — drag to reorder */}
                <NestableDraggableFlatList
                  data={goals}
                  keyExtractor={(g) => g.id}
                  onDragEnd={({ data }) => handleReorderGoals(data)}
                  contentContainerStyle={{ gap: 6 }}
                  renderItem={({ item: goal, drag, isActive, getIndex }: RenderItemParams<DailyGoal>) => {
                    const slotIdx = getIndex?.() ?? 0;
                    const isEditingThis = editingGoalId === goal.id;
                    return (
                      <ScaleDecorator>
                        <View style={[s.goalRow, goal.completed && s.goalRowDone, isActive && s.goalRowActive]}>
                          {/* Drag handle — disabled for completed goals */}
                          <TouchableOpacity
                            onLongPress={drag}
                            delayLongPress={150}
                            disabled={goal.completed}
                            style={s.goalDragHandle}
                          >
                            <Text style={[s.goalDragHandleText, goal.completed && { opacity: 0.15 }]}>⠿</Text>
                          </TouchableOpacity>
                          <View style={[s.goalNum, goal.completed && s.goalNumDone]}>
                            <Text style={[s.goalNumText, goal.completed && s.goalNumTextDone]}>{slotIdx + 1}</Text>
                          </View>
                          <TouchableOpacity onPress={() => handleToggleGoal(goal)} style={s.goalCheck}>
                            <Text style={[s.goalCheckText, goal.completed && s.goalCheckDone]}>
                              {goal.completed ? '●' : '○'}
                            </Text>
                          </TouchableOpacity>
                          <View style={{ flex: 1, justifyContent: 'center' }}>
                            {isEditingThis ? (
                              <TextInput
                                style={s.goalInput}
                                value={editingGoalText}
                                onChangeText={setEditingGoalText}
                                autoFocus
                                returnKeyType="done"
                                onSubmitEditing={() => commitGoalEdit(goal)}
                                onBlur={() => commitGoalEdit(goal)}
                              />
                            ) : (
                              <>
                                <Text style={[s.goalText, goal.completed && s.goalTextDone]} numberOfLines={2}>
                                  {goal.text}
                                </Text>
                                {goal.taskId && (
                                  <Text style={s.goalLinkedBadge}>🔗 linked to task</Text>
                                )}
                              </>
                            )}
                          </View>
                          {!goal.completed && dayOffset < MAX_FUTURE && (
                            <TouchableOpacity onPress={() => handleMoveToNextDay(goal.id)} style={s.goalMoveBtn}>
                              <Text style={s.goalMoveBtnText}>→</Text>
                            </TouchableOpacity>
                          )}
                          {!goal.completed && (
                            <TouchableOpacity
                              onPress={() => {
                                if (goal.taskId) {
                                  handleDeleteGoal(goal.id);
                                } else {
                                  router.push({ pathname: '/task/new', params: { prefillTitle: goal.text, fromGoalId: goal.id } });
                                }
                              }}
                              style={s.goalSendBackBtn}
                              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            >
                              <Text style={s.goalSendBackText}>↩</Text>
                            </TouchableOpacity>
                          )}
                          {!isEditingThis && (
                            <TouchableOpacity
                              onPress={() => { setEditingGoalId(goal.id); setEditingGoalText(goal.text); }}
                              style={s.goalEditBtn}
                            >
                              <Text style={s.goalEditBtnText}>✏</Text>
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity onPress={() => handleDeleteGoal(goal.id)} style={s.goalDelete}>
                            <Text style={s.goalDeleteText}>✕</Text>
                          </TouchableOpacity>
                        </View>
                      </ScaleDecorator>
                    );
                  }}
                  scrollEnabled={false}
                />

                {/* Empty slots below existing goals */}
                {Array.from({ length: Math.max(0, totalSlots - goals.length) }, (_, i) => {
                  const slotIdx = goals.length + i;
                  const isAdding = addingGoalIdx === slotIdx;

                  if (isAdding) {
                    return (
                      <View key={`adding-${slotIdx}`} style={s.goalAddingOuter}>
                        <View style={s.goalAddingRow}>
                          <View style={[s.goalNum, s.goalNumActive]}>
                            <Text style={[s.goalNumText, { color: '#fff' }]}>{slotIdx + 1}</Text>
                          </View>
                          {linkedTask ? (
                            <View style={s.linkedTaskPill}>
                              <Text style={s.linkedTaskName} numberOfLines={1}>{linkedTask.title}</Text>
                              <TouchableOpacity onPress={() => setLinkedTask(null)}>
                                <Text style={s.cancelText}>✕</Text>
                              </TouchableOpacity>
                            </View>
                          ) : (
                            <TextInput
                              style={s.goalInput}
                              placeholder="Type a goal…"
                              placeholderTextColor="#64748b"
                              value={goalInput}
                              onChangeText={setGoalInput}
                              autoFocus
                              returnKeyType="done"
                              onSubmitEditing={() => handleAddGoal(slotIdx)}
                              onBlur={() => { if (!goalInput.trim() && !linkedTask) setAddingGoalIdx(null); }}
                            />
                          )}
                          <TouchableOpacity onPress={() => handleAddGoal(slotIdx)} style={s.goalSaveBtn}>
                            <Text style={s.goalSaveBtnText}>Set</Text>
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => { setAddingGoalIdx(null); setGoalInput(''); setLinkedTask(null); }}>
                            <Text style={s.cancelText}>✕</Text>
                          </TouchableOpacity>
                        </View>
                        <TouchableOpacity style={s.linkTaskBtn} onPress={openTaskPicker}>
                          <Text style={s.linkTaskBtnText}>🔗 Link to a task</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  }

                  return (
                    <TouchableOpacity
                      key={`empty-${slotIdx}`}
                      style={s.goalEmpty}
                      onPress={() => { setAddingGoalIdx(slotIdx); setGoalInput(''); }}
                      activeOpacity={0.6}
                    >
                      <View style={s.goalNum}>
                        <Text style={s.goalNumText}>{slotIdx + 1}</Text>
                      </View>
                      <Text style={s.goalEmptyText}>Add a goal…</Text>
                    </TouchableOpacity>
                  );
                })}

                {/* Feature 3: "Add another" when all slots filled */}
                {goals.length >= totalSlots && addingGoalIdx === null && (
                  <TouchableOpacity
                    style={s.addAnotherBtn}
                    onPress={() => {
                      setExtraSlots(e => e + 1);
                      setAddingGoalIdx(totalSlots);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={s.addAnotherText}>＋ Add another</Text>
                  </TouchableOpacity>
                )}
              </View>

              {/* ── Reflection & Gratitude (today only) ── */}
              {isToday && (
                <>
                  <View style={s.divider} />
                  <View style={s.section}>
                    <View style={s.reflSectionHeader}>
                      <Text style={s.reflSectionLabel}>ONE THING TO DO{'\n'}BETTER TOMORROW</Text>
                    </View>
                    <TextInput
                      style={s.reflectionInput}
                      placeholder="Write one thing you can improve tomorrow…"
                      placeholderTextColor="#475569"
                      value={reflection}
                      onChangeText={handleReflectionChange}
                      onBlur={() => saveReflection(reflection)}
                      multiline
                      maxLength={500}
                    />
                  </View>

                  <View style={s.section}>
                    <View style={s.reflSectionHeader}>
                      <Text style={s.reflSectionLabel}>ONE THING I&apos;M{'\n'}GRATEFUL FOR</Text>
                    </View>
                    <TextInput
                      style={s.reflectionInput}
                      placeholder="Write one thing you're grateful for today…"
                      placeholderTextColor="#475569"
                      value={gratitude}
                      onChangeText={handleGratitudeChange}
                      onBlur={() => saveGratitude(gratitude)}
                      multiline
                      maxLength={500}
                    />
                  </View>
                </>
              )}
            </>
          )}
        </View>
      )}
      {/* ── Task picker modal ── */}
      <Modal visible={taskPickerOpen} animationType="slide" transparent onRequestClose={() => setTaskPickerOpen(false)}>
        <View style={s.pickerOverlay}>
          <View style={s.pickerSheet}>
            <View style={s.pickerHeader}>
              <Text style={s.pickerTitle}>Link to a task</Text>
              <TouchableOpacity onPress={() => setTaskPickerOpen(false)}>
                <Text style={s.cancelText}>✕</Text>
              </TouchableOpacity>
            </View>
            <TextInput
              style={s.pickerSearch}
              placeholder="Search tasks…"
              placeholderTextColor="#475569"
              value={taskSearch}
              onChangeText={setTaskSearch}
              autoFocus
            />
            <FlatList
              data={availableTasks.filter((t) => {
                if (!taskSearch.trim()) return true;
                // Encrypted tasks have no searchable title — show them always so user can see they're locked
                if (!t.title && t.encTitle) return true;
                if (!t.title) return false;
                return t.title.toLowerCase().includes(taskSearch.toLowerCase());
              })}
              keyExtractor={(t) => t.id}
              style={s.pickerList}
              ListEmptyComponent={<Text style={s.pickerEmpty}>No active tasks found</Text>}
              renderItem={({ item }) => {
                const isLocked = !item.title && !!item.encTitle;
                return (
                  <TouchableOpacity
                    style={[s.pickerItem, isLocked && s.pickerItemLocked]}
                    disabled={isLocked}
                    onPress={() => {
                      setLinkedTask(item);
                      setGoalInput(item.title);
                      setTaskPickerOpen(false);
                    }}
                  >
                    <Text style={[s.pickerItemTitle, isLocked && s.pickerItemLockedText]} numberOfLines={1}>
                      {isLocked ? '🔒 Locked task' : item.title}
                    </Text>
                    {isLocked
                      ? <Text style={s.pickerItemLockedHint}>Unlock vault to link this task</Text>
                      : <Text style={s.pickerItemProject}>{item.projectName}</Text>
                    }
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>

    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: 14,
      marginHorizontal: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: c.border,
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'column',
      gap: 6,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: c.border,
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    headerRowRight: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 'auto' },
    headerTitle: { color: c.tx, fontWeight: '700', fontSize: 14 },
    dateNav: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.bg, borderRadius: 8, paddingHorizontal: 4, paddingVertical: 2 },
    navBtn: { paddingHorizontal: 6, paddingVertical: 2 },
    navBtnText: { color: c.tx3, fontSize: 16, fontWeight: '700' },
    navBtnDisabled: { color: c.border },
    dateText: { color: c.tx2, fontSize: 11, fontWeight: '600', maxWidth: 120 },
    relBadge: { backgroundColor: '#312e81', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 },
    relBadgeText: { color: '#a5b4fc', fontSize: 11, fontWeight: '700' },
    statsRow: { flexDirection: 'row', gap: 4 },
    statBadge: { backgroundColor: c.bg, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 },
    statBadgeDone: { backgroundColor: '#14532d' },
    statBadgeText: { color: c.tx3, fontSize: 10, fontWeight: '700' },
    statBadgeTextDone: { color: '#4ade80' },
    collapseIcon: { color: c.tx3, fontSize: 12, marginLeft: 4 },

    body: { paddingHorizontal: 16, paddingVertical: 12, gap: 4 },

    offlineBanner: {
      backgroundColor: '#7c2d12',
      borderRadius: 8, padding: 10, marginBottom: 10,
    },
    offlineText: { color: '#fdba74', fontSize: 12, fontWeight: '600', lineHeight: 16 },

    prevReflBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      borderLeftWidth: 3, borderLeftColor: '#6366f1',
      paddingLeft: 10, paddingVertical: 6, marginBottom: 8,
    },
    prevReflLabel: { color: '#6366f1', fontSize: 9, fontWeight: '800', letterSpacing: 0.8, flexShrink: 0, textAlign: 'center' },
    prevReflText: { color: c.tx2, fontSize: 13, fontWeight: '500', lineHeight: 18, flex: 1 },

    section: { marginBottom: 12 },
    sectionLabel: { color: c.tx3, fontSize: 9, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
    reflSectionHeader: { borderLeftWidth: 2, borderLeftColor: '#6366f1', paddingLeft: 8, paddingVertical: 2, marginBottom: 8 },
    reflSectionLabel: { color: '#6366f1', fontSize: 9, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },

    habitsLink: { color: '#6366f1', fontSize: 12, fontWeight: '600', marginBottom: 8 },
    habitGroupLabel: { color: c.tx3, fontSize: 9, fontWeight: '700', letterSpacing: 1, marginTop: 4, marginBottom: 2 },
    habitRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border,
    },
    habitText: { color: c.tx2, fontSize: 14, fontWeight: '500', flexShrink: 1 },

    goalsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    carryOverBtn: { backgroundColor: '#78350f', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
    carryOverText: { color: '#fbbf24', fontSize: 11, fontWeight: '600' },

    goalRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: c.bg, borderRadius: 10, padding: 10,
      borderWidth: 1.5, borderColor: c.border, marginBottom: 6,
    },
    goalRowDone: { backgroundColor: '#052e16', borderColor: '#166534' },
    goalNum: {
      width: 22, height: 22, borderRadius: 11,
      backgroundColor: c.border, alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    },
    goalNumDone: { backgroundColor: '#22c55e' },
    goalNumActive: { backgroundColor: '#6366f1' },
    goalNumText: { color: c.tx2, fontSize: 10, fontWeight: '800' },
    goalNumTextDone: { color: '#fff' },
    goalCheck: { paddingHorizontal: 2 },
    goalCheckText: { color: c.tx4, fontSize: 16 },
    goalCheckDone: { color: '#22c55e' },
    goalText: { color: c.tx, fontSize: 14, fontWeight: '500', lineHeight: 18 },
    goalTextDone: { color: '#4ade80', textDecorationLine: 'line-through' },
    goalDelete: { paddingHorizontal: 6, paddingVertical: 4 },
    goalDeleteText: { color: c.tx4, fontSize: 12 },
    goalEditBtn: { paddingHorizontal: 4, paddingVertical: 4 },
    goalEditBtnText: { color: c.tx3, fontSize: 12 },
    goalMoveBtn: { paddingHorizontal: 4, paddingVertical: 4 },
    goalMoveBtnText: { color: c.tx3, fontSize: 14 },
    goalSendBackBtn: { paddingHorizontal: 4, paddingVertical: 4 },
    goalSendBackText: { color: '#6366f1', fontSize: 15 },

    goalAddingRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: c.surface2, borderRadius: 10, padding: 10,
      borderWidth: 1.5, borderColor: '#6366f1',
    },
    goalInput: { flex: 1, color: c.tx, fontSize: 14, paddingVertical: 0 },
    goalSaveBtn: { backgroundColor: '#6366f1', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
    goalSaveBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },

    goalEmpty: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      borderWidth: 1.5, borderColor: c.border, borderRadius: 10,
      borderStyle: 'dashed', padding: 10, marginBottom: 6,
    },
    goalEmptyText: { color: c.border2, fontSize: 14, fontWeight: '500' },

    cancelText: { color: c.tx3, fontSize: 16, paddingHorizontal: 4 },

    goalLinkedBadge: { color: '#6366f1', fontSize: 10, fontWeight: '600', marginTop: 2 },
    goalAddingOuter: { marginBottom: 6 },
    linkTaskBtn: { paddingVertical: 6, paddingHorizontal: 10, alignSelf: 'flex-start' },
    linkTaskBtnText: { color: '#6366f1', fontSize: 12, fontWeight: '600' },
    linkedTaskPill: {
      flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: 'rgba(99,102,241,0.15)', borderRadius: 8,
      paddingHorizontal: 10, paddingVertical: 4,
    },
    linkedTaskName: { flex: 1, color: '#a5b4fc', fontSize: 13, fontWeight: '600' },

    addAnotherBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      paddingVertical: 8, paddingHorizontal: 12, marginTop: 2,
      borderWidth: 1.5, borderColor: c.border, borderRadius: 10,
      borderStyle: 'dashed',
    },
    addAnotherText: { color: '#6366f1', fontSize: 13, fontWeight: '600' },

    pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    pickerSheet: {
      backgroundColor: c.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
      maxHeight: '75%', paddingBottom: 32,
    },
    pickerHeader: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    pickerTitle: { color: c.tx, fontSize: 16, fontWeight: '700' },
    pickerSearch: {
      margin: 16, backgroundColor: c.bg, borderRadius: 10,
      borderWidth: 1, borderColor: c.border, color: c.tx,
      fontSize: 14, paddingHorizontal: 14, paddingVertical: 10,
    },
    pickerList: { flex: 1 },
    pickerEmpty: { color: c.tx2, fontSize: 14, textAlign: 'center', paddingTop: 24 },
    pickerItem: {
      paddingHorizontal: 20, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    pickerItemTitle: { color: c.tx, fontSize: 14, fontWeight: '600' },
    pickerItemProject: { color: c.tx3, fontSize: 12, marginTop: 2 },
    pickerItemLocked: { opacity: 0.55 },
    pickerItemLockedText: { color: c.tx2 },
    pickerItemLockedHint: { color: c.tx4, fontSize: 12, marginTop: 2 },

    goalRowActive: { borderColor: '#6366f1', opacity: 0.9 },
    goalDragHandle: { paddingHorizontal: 4, paddingVertical: 4 },
    goalDragHandleText: { color: c.tx3, fontSize: 16 },

    divider: { height: 1, backgroundColor: c.border, marginBottom: 12 },

    reflectionInput: {
      backgroundColor: c.bg, borderRadius: 10, borderWidth: 1, borderColor: c.border,
      color: c.tx, fontSize: 14, paddingHorizontal: 14, paddingVertical: 10,
      lineHeight: 20, minHeight: 44, textAlignVertical: 'top',
    },

    pickerTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 20, paddingBottom: 12 },
    pickerTitleText: { color: c.tx, fontSize: 16, fontWeight: '700' },
  });
}
