import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, ScrollView, KeyboardAvoidingView, Platform, Modal,
  DeviceEventEmitter,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import RichEditor, { type RichEditorRef } from '@/components/RichEditor';
import { BulletListIcon, NumberedListIcon, ImageUploadIcon } from '@/components/ToolbarIcons';
import AttachmentsPanel from '@/components/AttachmentsPanel';
import VaultUnlockModal from '@/components/VaultUnlockModal';
import { uploadImage } from '@/lib/api';
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


function formatDueDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  const monthName = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ][month - 1] ?? '';
  return `${monthName} ${day}, ${year}`;
}

function isValidDate(month: number, day: number, year: number): boolean {
  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;
  const daysInMonth = new Date(year, month, 0).getDate();
  return day <= daysInMonth;
}

export default function TaskEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { encrypt, decrypt, isUnlocked } = useVault();

  // For new tasks, id is "new" and projectId is passed as a query param
  const { projectId: qProjectId, prefillTitle, fromGoalId } = useLocalSearchParams<{ projectId?: string; prefillTitle?: string; fromGoalId?: string }>();
  const isNew = id === 'new';

  const [title, setTitle] = useState(isNew && prefillTitle ? prefillTitle : '');
  const [stage, setStage] = useState<Task['stage']>('todo');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [projectId, setProjectId] = useState<string>(qProjectId ?? '');
  const [projects, setProjects] = useState<Project[]>([]);
  const [sensitive, setSensitive] = useState(false);
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [vaultUnlockVisible, setVaultUnlockVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(isNew && !!prefillTitle);
  const [editorFocused, setEditorFocused] = useState(false);
  const [editorHeight, setEditorHeight] = useState(120);

  const editorRef = useRef<RichEditorRef>(null);
  const descHtmlRef = useRef('');

  // Due date picker modal state
  const [dateModalVisible, setDateModalVisible] = useState(false);
  const [dateInputMonth, setDateInputMonth] = useState('');
  const [dateInputDay, setDateInputDay] = useState('');
  const [dateInputYear, setDateInputYear] = useState('');

  const openDateModal = () => {
    if (dueDate) {
      const [y, m, d] = dueDate.split('-');
      setDateInputYear(y);
      setDateInputMonth(String(Number(m)));
      setDateInputDay(String(Number(d)));
    } else {
      setDateInputMonth('');
      setDateInputDay('');
      setDateInputYear('');
    }
    setDateModalVisible(true);
  };

  const confirmDate = () => {
    const month = Number(dateInputMonth);
    const day = Number(dateInputDay);
    const year = Number(dateInputYear);
    if (!isValidDate(month, day, year)) {
      Alert.alert('Invalid date', 'Please enter a valid month (1-12), day (1-31), and year.');
      return;
    }
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    setDueDate(iso);
    setDirty(true);
    setDateModalVisible(false);
  };

  const loadData = useCallback(async () => {
    const [projectsRes, taskRes] = await Promise.all([
      apiFetch<Project[]>('/api/projects'),
      isNew ? Promise.resolve(null) : apiFetch<Task[]>('/api/tasks?includeArchived=true'),
    ]);

    if (isOk(projectsRes)) {
      const active = await Promise.all(
        projectsRes.data.filter((p) => !p.archived).map(async (p) => ({
          ...p,
          name: p.encName ? (await decrypt(p.encName) ?? p.name) : p.name,
        })),
      );
      setProjects(active);
      if (isNew && active[0]) setProjectId((prev) => prev || active[0].id);
    }

    if (!isNew && taskRes && isOk(taskRes)) {
      const found = taskRes.data.find((t) => t.id === id);
      if (found) {
        if (found.locked && !isUnlocked) {
          setLoading(false);
          setVaultUnlockVisible(true);
          return;
        }
        const decTitle = found.encTitle ? (await decrypt(found.encTitle) ?? found.title) : found.title;
        setTask(found);
        setTitle(decTitle);
        descHtmlRef.current = found.description ?? '';
        editorRef.current?.setContent(found.description ?? '');
        setStage(found.stage);
        setPriority(found.priority ?? null);
        setDueDate(found.dueDate ?? null);
        setProjectId(found.projectId);
        setSensitive(found.sensitive ?? false);
      } else if (!isNew) {
        // Task not in list (may be archived or deleted) — go back rather than show blank editor
        setLoading(false);
        Alert.alert('Not found', 'This task could not be loaded.', [
          { text: 'OK', onPress: () => router.back() },
        ], { cancelable: false });
        return;
      }
    }

    setLoading(false);
  }, [id, isNew, decrypt]);

  useEffect(() => { loadData(); }, [loadData, isUnlocked]);

  // After vault unlock, re-run a save that was waiting for it
  const savePendingRef = useRef(false);
  const saveRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (!isUnlocked || !savePendingRef.current) return;
    savePendingRef.current = false;
    saveRef.current();
  }, [isUnlocked]);

  const save = useCallback(async () => {
    if (saving || !title.trim()) {
      if (!title.trim()) Alert.alert('Required', 'Enter a task title.');
      return;
    }

    // Gate: sensitive task requires vault to be unlocked so we can encrypt it
    if (sensitive && !isUnlocked) {
      const vaultRes = await apiFetch<{ exists: boolean }>('/api/notes/vault');
      if (isOk(vaultRes) && (vaultRes.data as { exists: boolean }).exists) {
        savePendingRef.current = true;
        setVaultUnlockVisible(true);
        return;
      }
      // No vault set up — tell the user to create one in the web app first
      Alert.alert(
        'Vault Required',
        'Protected tasks require a vault. Set one up in the web app under Settings, then come back to protect this task.',
        [{ text: 'OK' }],
      );
      setSensitive(false);
      return;
    }

    setSaving(true);

    const shouldEncrypt = sensitive && isUnlocked;
    const encTitleBlob = shouldEncrypt ? await encrypt(title) : null;
    const encTitle = encTitleBlob ? JSON.stringify(encTitleBlob) : null;
    const titleField = encTitleBlob ? '' : title;
    const locked = shouldEncrypt ? true : (sensitive === false ? false : undefined);

    const descHtml = descHtmlRef.current.trim() || null;
    if (isNew) {
      if (!projectId) { Alert.alert('Required', 'Select a project.'); setSaving(false); return; }
      const body = {
        title: titleField, encTitle, stage, priority: priority ?? undefined,
        projectId, description: descHtml,
        dueDate: dueDate ?? undefined, sensitive,
        ...(locked !== undefined && { locked }),
      };
      const result = await apiFetch<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(body) });

      if (isOk(result)) {
        await setLastSynced('task', result.data.id, result.data.updatedAt);
        if (fromGoalId) {
          await apiFetch(`/api/daily-goals/${fromGoalId}`, { method: 'DELETE' });
        }
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
        title: titleField, encTitle, stage, priority: priority ?? undefined,
        clientUpdatedAt: task?.updatedAt,
        description: descHtml,
        dueDate: dueDate ?? undefined, sensitive,
        ...(locked !== undefined && { locked }),
      };
      const result = await apiFetch<Task>(`/api/tasks/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });

      if (isOk(result)) {
        await setLastSynced('task', id, result.data.updatedAt);
        router.back();
        return;
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
                  body: JSON.stringify({
                    title: titleField, encTitle, stage, priority: priority ?? undefined,
                    description: descHtml, dueDate: dueDate ?? undefined,
                    sensitive,
                  }),
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
                descHtmlRef.current = server.description ?? '';
                editorRef.current?.setContent(server.description ?? '');
                setStage(server.stage);
                setPriority(server.priority ?? null);
                setDueDate(server.dueDate ?? null);
                setTask(server);
                setDirty(false);
                setSaving(false);
              },
            },
          ],
          { cancelable: false },
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
  }, [saving, isNew, id, title, stage, priority, dueDate, projectId, task, sensitive, isUnlocked, encrypt, decrypt, router]);
  // Keep ref up-to-date so the vault-unlock effect always calls the latest save
  saveRef.current = save;

  const handleDuplicate = async () => {
    if (!task) return;
    const copyTitle = `Copy of ${title}`;
    const shouldEncrypt = sensitive && isUnlocked;
    const encTitleBlob = shouldEncrypt ? await encrypt(copyTitle) : null;
    const encTitle = encTitleBlob ? JSON.stringify(encTitleBlob) : null;
    const res = await apiFetch<Task>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        title: encTitleBlob ? '' : copyTitle, encTitle,
        stage, priority: priority ?? undefined, projectId,
        description: descHtmlRef.current || undefined,
        dueDate: dueDate ?? undefined,
        sensitive,
        ...(shouldEncrypt && { locked: true }),
      }),
    });
    if (isOk(res)) {
      Alert.alert('Duplicated', 'Task duplicated successfully.', [
        { text: 'Open copy', onPress: () => router.replace(`/task/${res.data.id}`) },
        { text: 'Stay here', style: 'cancel' },
      ]);
    }
  };

  const handleArchive = async () => {
    if (!task) return;
    const nowArchived = !task.archived;
    const res = await apiFetch<Task>(`/api/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ archived: nowArchived }),
    });
    if (isOk(res)) {
      setTask((prev) => prev ? { ...prev, archived: nowArchived } : prev);
      Alert.alert(nowArchived ? 'Archived' : 'Restored', nowArchived ? 'Task archived.' : 'Task restored.');
    }
  };

  const handleDelete = () => {
    if (task?.archived) {
      Alert.alert('Delete task?', 'This cannot be undone.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            const result = await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
            if (!isOk(result)) { Alert.alert('Error', 'Could not delete task.'); return; }
            router.back();
          },
        },
      ]);
    } else {
      Alert.alert('Move to archive?', 'You can undo from the board.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive', style: 'destructive',
          onPress: async () => {
            const result = await apiFetch(`/api/tasks/${id}`, {
              method: 'PUT',
              body: JSON.stringify({ archived: true }),
            });
            if (!isOk(result)) { Alert.alert('Error', 'Could not archive task.'); return; }
            DeviceEventEmitter.emit('task:archived', { taskId: id, title });
            router.back();
          },
        },
      ]);
    }
  };

  const handleImageUpload = useCallback(async () => {
    Alert.alert('Insert image', undefined, [
      {
        text: 'Photo library', onPress: async () => {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) { Alert.alert('Permission required', 'Allow photo access in Settings.'); return; }
          const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.85 });
          if (result.canceled || !result.assets[0]) return;
          const asset = result.assets[0];
          const url = await uploadImage(asset.uri, asset.mimeType ?? 'image/jpeg');
          if (url) { editorRef.current?.insertImage(url); setDirty(true); }
          else Alert.alert('Upload failed', 'Could not upload the image.');
        },
      },
      {
        text: 'Camera', onPress: async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) { Alert.alert('Permission required', 'Allow camera access in Settings.'); return; }
          const result = await ImagePicker.launchCameraAsync({ mediaTypes: 'images', quality: 0.85 });
          if (result.canceled || !result.assets[0]) return;
          const asset = result.assets[0];
          const url = await uploadImage(asset.uri, asset.mimeType ?? 'image/jpeg');
          if (url) { editorRef.current?.insertImage(url); setDirty(true); }
          else Alert.alert('Upload failed', 'Could not upload the image.');
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, []);

  const handleBack = () => {
    if (dirty) {
      Alert.alert('Unsaved changes', 'Save before leaving?', [
        { text: 'Discard', style: 'destructive', onPress: () => router.back() },
        { text: 'Save', onPress: async () => { await save(); if (!isNew) router.back(); } },
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

      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <ScrollView style={styles.flex} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.sectionLabel}>Title <Text style={styles.sectionLabelAsterisk}>*</Text></Text>
          <TextInput
            style={styles.titleInput}
            value={title}
            onChangeText={(v) => { setTitle(v); setDirty(true); }}
            placeholder="Task title"
            placeholderTextColor="#334155"
            autoFocus={isNew}
            returnKeyType="done"
          />

          <Text style={styles.sectionLabel}>Project <Text style={styles.sectionLabelAsterisk}>*</Text></Text>
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

          <Text style={styles.sectionLabel}>Description</Text>
          {editorFocused && (
            <View style={styles.toolbar}>
              <TouchableOpacity style={styles.fmtBtn} onPress={() => editorRef.current?.bold()}>
                <Text style={styles.fmtBold}>B</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.fmtBtn} onPress={() => editorRef.current?.italic()}>
                <Text style={styles.fmtItalic}>I</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.fmtBtn} onPress={() => editorRef.current?.underline()}>
                <Text style={styles.fmtUnderline}>U</Text>
              </TouchableOpacity>
              <View style={styles.fmtSep} />
              <TouchableOpacity style={styles.fmtBtn} onPress={() => editorRef.current?.bulletList()}>
                <BulletListIcon />
              </TouchableOpacity>
              <TouchableOpacity style={styles.fmtBtn} onPress={() => editorRef.current?.orderedList()}>
                <NumberedListIcon />
              </TouchableOpacity>
              <View style={styles.fmtSep} />
              <TouchableOpacity style={styles.fmtBtn} onPress={() => editorRef.current?.code()}>
                <Text style={styles.fmtCode}>{'<>'}</Text>
              </TouchableOpacity>
              <View style={styles.fmtSep} />
              <TouchableOpacity style={styles.fmtBtn} onPress={handleImageUpload}>
                <ImageUploadIcon />
              </TouchableOpacity>
            </View>
          )}
          <RichEditor
            ref={editorRef}
            initialContent={descHtmlRef.current}
            onChange={(html) => { descHtmlRef.current = html; setDirty(true); }}
            onFocus={() => setEditorFocused(true)}
            onBlur={() => setEditorFocused(false)}
            onHeightChange={setEditorHeight}
            style={[styles.descriptionEditor, { height: Math.max(120, editorHeight) }]}
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

          <Text style={styles.sectionLabel}>Due Date</Text>
          <View style={styles.chipRow}>
            {dueDate ? (
              <>
                <TouchableOpacity style={styles.chip} onPress={openDateModal}>
                  <Text style={[styles.chipText, styles.dueDateText]}>{formatDueDate(dueDate)}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.clearDateBtn}
                  onPress={() => { setDueDate(null); setDirty(true); }}
                >
                  <Text style={styles.clearDateText}>✕</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={styles.dashedChip} onPress={openDateModal}>
                <Text style={styles.dashedChipText}>＋ Set due date</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* ── Attachments ── */}
          {!isNew && <AttachmentsPanel taskId={id} />}

          {/* ── Privacy ── */}
          <TouchableOpacity
            style={styles.sensitiveRow}
            onPress={() => { setSensitive((v) => !v); setDirty(true); }}
            activeOpacity={0.7}
          >
            <View style={styles.sensitiveLeft}>
              <Text style={styles.sensitiveName}>Hide in Privacy Mode</Text>
              <Text style={styles.sensitiveHint}>Blurs this task when privacy mode is on</Text>
            </View>
            <View style={[styles.toggle, sensitive && styles.toggleOn]}>
              <View style={[styles.toggleThumb, sensitive && styles.toggleThumbOn]} />
            </View>
          </TouchableOpacity>

          {/* ── Bottom actions ── */}
          <View style={styles.actionsSection}>
            <TouchableOpacity
              style={[styles.saveFullBtn, (!dirty && !isNew) && styles.saveFullBtnDisabled]}
              onPress={save}
              disabled={saving || (!dirty && !isNew)}
            >
              {saving
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.saveFullBtnText}>Save</Text>}
            </TouchableOpacity>
            {!isNew && (
              <View style={styles.actionsRow}>
                <TouchableOpacity style={styles.actionBtn} onPress={handleDuplicate}>
                  <Text style={styles.actionBtnText}>Duplicate</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.actionBtn} onPress={handleArchive}>
                  <Text style={styles.actionBtnText}>{task?.archived ? 'Unarchive' : 'Archive'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, styles.actionBtnDanger]} onPress={handleDelete}>
                  <Text style={styles.actionBtnTextDanger}>Delete</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Due date picker modal */}
      <Modal
        visible={dateModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDateModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setDateModalVisible(false)}
        >
          <TouchableOpacity activeOpacity={1} style={styles.datePickerCard}>
            <Text style={styles.datePickerTitle}>Set Due Date</Text>

            <View style={styles.dateFieldRow}>
              <View style={styles.dateField}>
                <Text style={styles.dateFieldLabel}>Month (1-12)</Text>
                <TextInput
                  style={styles.dateFieldInput}
                  value={dateInputMonth}
                  onChangeText={setDateInputMonth}
                  placeholder="MM"
                  placeholderTextColor="#475569"
                  keyboardType="number-pad"
                  maxLength={2}
                />
              </View>
              <View style={styles.dateField}>
                <Text style={styles.dateFieldLabel}>Day (1-31)</Text>
                <TextInput
                  style={styles.dateFieldInput}
                  value={dateInputDay}
                  onChangeText={setDateInputDay}
                  placeholder="DD"
                  placeholderTextColor="#475569"
                  keyboardType="number-pad"
                  maxLength={2}
                />
              </View>
              <View style={styles.dateField}>
                <Text style={styles.dateFieldLabel}>Year</Text>
                <TextInput
                  style={styles.dateFieldInput}
                  value={dateInputYear}
                  onChangeText={setDateInputYear}
                  placeholder="YYYY"
                  placeholderTextColor="#475569"
                  keyboardType="number-pad"
                  maxLength={4}
                />
              </View>
            </View>

            <View style={styles.datePickerActions}>
              <TouchableOpacity
                style={styles.datePickerCancel}
                onPress={() => setDateModalVisible(false)}
              >
                <Text style={styles.datePickerCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.datePickerSet} onPress={confirmDate}>
                <Text style={styles.datePickerSetText}>Set</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <VaultUnlockModal
        visible={vaultUnlockVisible}
        onSuccess={() => setVaultUnlockVisible(false)}
        onCancel={() => {
          setVaultUnlockVisible(false);
          savePendingRef.current = false;
          // Only go back if we were trying to load a locked task (not just trying to save)
          if (task?.locked) router.back();
        }}
      />
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
  sectionLabelAsterisk: { color: '#94a3b8', fontSize: 11, fontWeight: '600' },
  titleInput: {
    backgroundColor: '#1e293b', borderRadius: 10, borderWidth: 1, borderColor: '#334155',
    color: '#f1f5f9', fontSize: 17, fontWeight: '600', paddingHorizontal: 14, paddingVertical: 12,
  },
  descriptionEditor: {
    backgroundColor: '#1e293b', borderRadius: 10, borderWidth: 1, borderColor: '#334155',
    overflow: 'hidden',
  },
  toolbar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1e293b', borderRadius: 8, borderWidth: 1, borderColor: '#334155',
    paddingHorizontal: 4, paddingVertical: 2, marginBottom: 4,
  },
  fmtBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 6, marginHorizontal: 1 },
  fmtBtnText: { color: '#94a3b8', fontSize: 14, fontWeight: '600' },
  fmtBold: { color: '#e2e8f0', fontSize: 15, fontWeight: '800' },
  fmtItalic: { color: '#e2e8f0', fontSize: 15, fontStyle: 'italic', fontWeight: '600' },
  fmtUnderline: { color: '#e2e8f0', fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },
  fmtCode: { color: '#7dd3fc', fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  fmtSep: { width: 1, height: 20, backgroundColor: '#334155', marginHorizontal: 4 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155',
  },
  chipActive: { backgroundColor: 'rgba(99,102,241,0.15)', borderColor: '#6366f1' },
  chipText: { color: '#64748b', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#a5b4fc' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  dueDateText: { color: '#cbd5e1' },
  clearDateBtn: {
    paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8,
    backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155',
    alignItems: 'center', justifyContent: 'center',
  },
  clearDateText: { color: '#64748b', fontSize: 13, fontWeight: '600' },
  dashedChip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
    borderWidth: 1, borderColor: '#334155', borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
  dashedChipText: { color: '#475569', fontSize: 13, fontWeight: '600' },
  // Date picker modal
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  datePickerCard: {
    backgroundColor: '#1e293b', borderRadius: 16, padding: 24,
    width: '100%', maxWidth: 360,
    borderWidth: 1, borderColor: '#334155',
  },
  datePickerTitle: {
    color: '#f1f5f9', fontSize: 16, fontWeight: '700', marginBottom: 20, textAlign: 'center',
  },
  dateFieldRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  dateField: { flex: 1 },
  dateFieldLabel: { color: '#64748b', fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
  dateFieldInput: {
    backgroundColor: '#0f172a', borderRadius: 8, borderWidth: 1, borderColor: '#334155',
    color: '#f1f5f9', fontSize: 16, fontWeight: '600',
    paddingHorizontal: 10, paddingVertical: 10, textAlign: 'center',
  },
  datePickerActions: { flexDirection: 'row', gap: 12 },
  datePickerCancel: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155',
    alignItems: 'center',
  },
  datePickerCancelText: { color: '#64748b', fontSize: 15, fontWeight: '600' },
  datePickerSet: {
    flex: 1, paddingVertical: 12, borderRadius: 10,
    backgroundColor: 'rgba(99,102,241,0.2)', borderWidth: 1, borderColor: '#6366f1',
    alignItems: 'center',
  },
  datePickerSetText: { color: '#a5b4fc', fontSize: 15, fontWeight: '700' },

  sensitiveRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#1e293b', borderRadius: 10, borderWidth: 1, borderColor: '#334155',
    paddingHorizontal: 14, paddingVertical: 12, marginTop: 8,
  },
  sensitiveLeft: { flex: 1, marginRight: 12 },
  sensitiveName: { color: '#f1f5f9', fontSize: 14, fontWeight: '600' },
  sensitiveHint: { color: '#475569', fontSize: 12, marginTop: 2 },
  toggle: {
    width: 44, height: 26, borderRadius: 13,
    backgroundColor: '#334155', justifyContent: 'center', padding: 2,
  },
  toggleOn: { backgroundColor: '#6366f1' },
  toggleThumb: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff',
    shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 2, shadowOffset: { width: 0, height: 1 },
  },
  toggleThumbOn: { transform: [{ translateX: 18 }] },

  actionsSection: { marginTop: 24, marginBottom: 8, gap: 10 },
  saveFullBtn: {
    width: '100%', paddingVertical: 14, borderRadius: 12,
    backgroundColor: '#6366f1', alignItems: 'center',
  },
  saveFullBtnDisabled: { backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155' },
  saveFullBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  actionsRow: { flexDirection: 'row', gap: 8 },
  actionBtn: {
    flex: 1, paddingVertical: 11, borderRadius: 10,
    backgroundColor: '#1e293b', borderWidth: 1, borderColor: '#334155',
    alignItems: 'center', justifyContent: 'center',
  },
  actionBtnDanger: { borderColor: '#991b1b', backgroundColor: 'rgba(239,68,68,0.06)' },
  actionBtnText: { color: '#94a3b8', fontSize: 13, fontWeight: '600' },
  actionBtnTextDanger: { color: '#ef4444', fontSize: 13, fontWeight: '600' },
});
