import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Modal, Pressable, NativeModules, Alert,
  Keyboard, type KeyboardEvent,
} from 'react-native';
import { apiFetch, isOk, uploadFile, uploadOk } from '@/lib/api';
import { getBaseUrl, getToken } from '@/lib/storage';
import { useVault } from '@/lib/vault-context';
import { useThemeColors, type ThemeColors } from '@/lib/theme-context';
import type { Note, Task, Project } from '@/lib/types';

export interface SharedFile {
  path: string;
  name: string;
  type: string;
}

interface Props {
  files: SharedFile[];
  onDismiss: () => void;
}

type Mode = 'choose' | 'notes' | 'tasks' | 'uploading' | 'new-note' | 'new-task';

// Must use XHR — Expo SDK 56's new fetch rejects RN's {uri,type,name} FormData parts
async function uploadAsAttachment(
  file: SharedFile,
  noteId?: string,
  taskId?: string,
): Promise<void> {
  const [baseUrl, token] = await Promise.all([getBaseUrl(), getToken()]);
  if (!baseUrl) throw new Error('No server URL');
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('file', { uri: `file://${file.path}`, type: file.type, name: file.name } as unknown as Blob);
    if (noteId) fd.append('noteId', noteId);
    if (taskId) fd.append('taskId', taskId);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${baseUrl}/api/attachments`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.timeout = 30000;
    xhr.ontimeout = () => reject(new Error('Upload timed out'));
    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed: ${xhr.status || 'network error'}`));
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send(fd);
  });
}

export default function ShareHandlerModal({ files, onDismiss }: Props) {
  const colors = useThemeColors();
  const styles = makeStyles(colors);
  const { decrypt } = useVault();

  const [mode, setMode] = useState<Mode>('choose');
  const [newTitle, setNewTitle] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e: KeyboardEvent) => setKeyboardHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  const [notes, setNotes] = useState<(Note & { displayTitle: string })[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteSearch, setNoteSearch] = useState('');

  const [tasks, setTasks] = useState<(Task & { displayTitle: string })[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [taskSearch, setTaskSearch] = useState('');

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);

  // Loading flags are raised during render below, when the mode (or decrypt key) changes
  const loadNotes = useCallback(() => apiFetch<Note[]>('/api/notes').then(async (result) => {
    if (isOk(result)) {
      const decrypted = await Promise.all(
        result.data
          .filter((n) => !n.deletedAt)
          .map(async (n) => {
            let displayTitle = n.title;
            if (!displayTitle && n.encTitle) {
              const dec = await decrypt(n.encTitle).catch(() => null);
              displayTitle = dec ?? '(encrypted)';
            }
            return { ...n, displayTitle: displayTitle || '(untitled)' };
          }),
      );
      setNotes(decrypted);
    }
    setNotesLoading(false);
  }), [decrypt]);

  const loadTasks = useCallback(() => apiFetch<Task[]>('/api/tasks').then(async (result) => {
    if (isOk(result)) {
      const decrypted = await Promise.all(
        result.data
          .filter((t) => !t.archived)
          .map(async (t) => {
            let displayTitle = t.title;
            if (!displayTitle && t.encTitle) {
              const dec = await decrypt(t.encTitle).catch(() => null);
              displayTitle = dec ?? '(encrypted)';
            }
            return { ...t, displayTitle: displayTitle || '(untitled)' };
          }),
      );
      setTasks(decrypted);
    }
    setTasksLoading(false);
  }), [decrypt]);

  const loadProjects = useCallback(() => apiFetch<Project[]>('/api/projects').then((result) => {
    if (isOk(result)) setProjects(result.data);
    setProjectsLoading(false);
  }), []);

  const [loadInputs, setLoadInputs] = useState({ mode, decrypt });
  if (loadInputs.mode !== mode || loadInputs.decrypt !== decrypt) {
    const modeChanged = loadInputs.mode !== mode;
    setLoadInputs({ mode, decrypt });
    if (mode === 'notes') setNotesLoading(true);
    if (mode === 'tasks') setTasksLoading(true);
    if (mode === 'new-task' && modeChanged) setProjectsLoading(true);
  }

  useEffect(() => {
    if (mode === 'notes') loadNotes();
    if (mode === 'tasks') loadTasks();
    if (mode === 'new-task') loadProjects();
  }, [mode, loadNotes, loadTasks, loadProjects]);

  const finishUpload = (succeededPaths: string[], failedCount: number) => {
    NativeModules.TaskboardShare?.clearCachedFiles(succeededPaths);
    if (failedCount > 0) {
      Alert.alert(
        'Some uploads failed',
        `${failedCount} of ${files.length} file${files.length !== 1 ? 's' : ''} could not be uploaded. Share them again from your gallery to retry.`,
        [{ text: 'OK', onPress: onDismiss }],
      );
    } else {
      onDismiss();
    }
  };

  const attachFilesTo = async (noteId?: string, taskId?: string) => {
    const succeededPaths: string[] = [];
    let failed = 0;
    for (const file of files) {
      try {
        await uploadAsAttachment(file, noteId, taskId);
        succeededPaths.push(file.path);
      } catch { failed++; }
    }
    finishUpload(succeededPaths, failed);
  };

  const handleSaveToFiles = async () => {
    setMode('uploading');
    const succeededPaths: string[] = [];
    let failed = 0;
    for (const file of files) {
      const result = await uploadFile(`file://${file.path}`, file.name, file.type, null);
      if (uploadOk(result)) succeededPaths.push(file.path);
      else failed++;
    }
    finishUpload(succeededPaths, failed);
  };

  const handleAttachToNote = async (noteId: string) => {
    setMode('uploading');
    await attachFilesTo(noteId, undefined);
  };

  const handleAttachToTask = async (taskId: string) => {
    setMode('uploading');
    await attachFilesTo(undefined, taskId);
  };

  const handleCreateNote = async () => {
    const title = newTitle.trim() || 'Shared files';
    setMode('uploading');
    const result = await apiFetch<{ id: string }>('/api/notes', {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
    if (!isOk(result)) {
      Alert.alert('Error', 'Could not create note', [{ text: 'OK', onPress: onDismiss }]);
      return;
    }
    await attachFilesTo(result.data.id, undefined);
  };

  const handleCreateTask = async () => {
    if (!selectedProjectId || !newTitle.trim()) return;
    setMode('uploading');
    const result = await apiFetch<{ id: string }>('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: newTitle.trim(), projectId: selectedProjectId, stage: 'todo' }),
    });
    if (!isOk(result)) {
      Alert.alert('Error', 'Could not create task', [{ text: 'OK', onPress: onDismiss }]);
      return;
    }
    await attachFilesTo(undefined, result.data.id);
  };

  const filteredNotes = notes.filter((n) =>
    n.displayTitle.toLowerCase().includes(noteSearch.toLowerCase()),
  );
  const filteredTasks = tasks.filter((t) =>
    t.displayTitle.toLowerCase().includes(taskSearch.toLowerCase()),
  );

  const fileCount = files.length;
  const fileLabel = `${fileCount} file${fileCount !== 1 ? 's' : ''}`;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onDismiss}>
      <Pressable style={styles.overlay} onPress={mode === 'choose' ? onDismiss : undefined}>
        <Pressable style={[styles.sheet, keyboardHeight > 0 && { marginBottom: keyboardHeight }]} onPress={() => {}}>

          {mode === 'uploading' && (
            <View style={styles.uploading}>
              <ActivityIndicator size="large" color="#6366f1" />
              <Text style={styles.uploadingText}>Uploading…</Text>
            </View>
          )}

          {mode === 'choose' && (
            <>
              <Text style={styles.title}>Share to Taskboard</Text>
              <Text style={styles.subtitle}>{fileLabel}</Text>
              <TouchableOpacity style={styles.option} onPress={handleSaveToFiles}>
                <Text style={styles.optionIcon}>📁</Text>
                <Text style={styles.optionText}>Save to Files</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.option} onPress={() => setMode('notes')}>
                <Text style={styles.optionIcon}>📝</Text>
                <Text style={styles.optionText}>Attach to a note…</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.option} onPress={() => setMode('tasks')}>
                <Text style={styles.optionIcon}>📋</Text>
                <Text style={styles.optionText}>Attach to a task…</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancel} onPress={onDismiss}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}

          {mode === 'notes' && (
            <>
              <View style={styles.pickerHeader}>
                <TouchableOpacity onPress={() => setMode('choose')} style={styles.backBtn}>
                  <Text style={styles.backText}>← Back</Text>
                </TouchableOpacity>
                <Text style={styles.pickerTitle}>Choose a note</Text>
              </View>
              <TouchableOpacity style={styles.createRow} onPress={() => { setNewTitle(''); setMode('new-note'); }}>
                <Text style={styles.createRowIcon}>+</Text>
                <Text style={styles.createRowText}>Create new note…</Text>
              </TouchableOpacity>
              <TextInput
                style={styles.search}
                placeholder="Search notes…"
                placeholderTextColor={colors.placeholder}
                value={noteSearch}
                onChangeText={setNoteSearch}
              />
              {notesLoading ? (
                <ActivityIndicator style={styles.listLoader} color="#6366f1" />
              ) : (
                <FlatList
                  data={filteredNotes}
                  keyExtractor={(n) => n.id}
                  style={styles.list}
                  ListEmptyComponent={<Text style={styles.emptyText}>No notes found</Text>}
                  renderItem={({ item }) => (
                    <TouchableOpacity style={styles.listRow} onPress={() => handleAttachToNote(item.id)}>
                      <Text style={styles.listRowText} numberOfLines={1}>{item.displayTitle}</Text>
                    </TouchableOpacity>
                  )}
                />
              )}
              <TouchableOpacity style={styles.cancel} onPress={onDismiss}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}

          {mode === 'new-note' && (
            <>
              <View style={styles.pickerHeader}>
                <TouchableOpacity onPress={() => setMode('notes')} style={styles.backBtn}>
                  <Text style={styles.backText}>← Back</Text>
                </TouchableOpacity>
                <Text style={styles.pickerTitle}>New note</Text>
              </View>
              <TextInput
                style={styles.search}
                placeholder="Note title…"
                placeholderTextColor={colors.placeholder}
                value={newTitle}
                onChangeText={setNewTitle}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleCreateNote}
              />
              <TouchableOpacity style={styles.createBtn} onPress={handleCreateNote}>
                <Text style={styles.createBtnText}>Create & Attach</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancel} onPress={onDismiss}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}

          {mode === 'tasks' && (
            <>
              <View style={styles.pickerHeader}>
                <TouchableOpacity onPress={() => setMode('choose')} style={styles.backBtn}>
                  <Text style={styles.backText}>← Back</Text>
                </TouchableOpacity>
                <Text style={styles.pickerTitle}>Choose a task</Text>
              </View>
              <TouchableOpacity style={styles.createRow} onPress={() => { setNewTitle(''); setSelectedProjectId(null); setMode('new-task'); }}>
                <Text style={styles.createRowIcon}>+</Text>
                <Text style={styles.createRowText}>Create new task…</Text>
              </TouchableOpacity>
              <TextInput
                style={styles.search}
                placeholder="Search tasks…"
                placeholderTextColor={colors.placeholder}
                value={taskSearch}
                onChangeText={setTaskSearch}
              />
              {tasksLoading ? (
                <ActivityIndicator style={styles.listLoader} color="#6366f1" />
              ) : (
                <FlatList
                  data={filteredTasks}
                  keyExtractor={(t) => t.id}
                  style={styles.list}
                  ListEmptyComponent={<Text style={styles.emptyText}>No tasks found</Text>}
                  renderItem={({ item }) => (
                    <TouchableOpacity style={styles.listRow} onPress={() => handleAttachToTask(item.id)}>
                      <Text style={styles.listRowText} numberOfLines={1}>{item.displayTitle}</Text>
                      <Text style={styles.listRowMeta}>{item.stage.replace('_', ' ')}</Text>
                    </TouchableOpacity>
                  )}
                />
              )}
              <TouchableOpacity style={styles.cancel} onPress={onDismiss}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}

          {mode === 'new-task' && (
            <>
              <View style={styles.pickerHeader}>
                <TouchableOpacity onPress={() => setMode('tasks')} style={styles.backBtn}>
                  <Text style={styles.backText}>← Back</Text>
                </TouchableOpacity>
                <Text style={styles.pickerTitle}>New task</Text>
              </View>
              <TextInput
                style={styles.search}
                placeholder="Task title…"
                placeholderTextColor={colors.placeholder}
                value={newTitle}
                onChangeText={setNewTitle}
                autoFocus
                returnKeyType="next"
              />
              <Text style={[styles.sectionLabel, { color: colors.tx2 }]}>Project</Text>
              {projectsLoading ? (
                <ActivityIndicator style={styles.listLoader} color="#6366f1" />
              ) : (
                <FlatList
                  data={projects}
                  keyExtractor={(p) => p.id}
                  style={styles.list}
                  ListEmptyComponent={<Text style={styles.emptyText}>No projects found</Text>}
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={[styles.listRow, selectedProjectId === item.id && styles.listRowSelected]}
                      onPress={() => setSelectedProjectId(item.id)}
                    >
                      <Text style={styles.listRowText} numberOfLines={1}>{item.name || '(untitled)'}</Text>
                      {selectedProjectId === item.id && <Text style={styles.checkmark}>✓</Text>}
                    </TouchableOpacity>
                  )}
                />
              )}
              <TouchableOpacity
                style={[styles.createBtn, (!newTitle.trim() || !selectedProjectId) && styles.createBtnDisabled]}
                onPress={handleCreateTask}
                disabled={!newTitle.trim() || !selectedProjectId}
              >
                <Text style={styles.createBtnText}>Create & Attach</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancel} onPress={onDismiss}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </>
          )}

        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: c.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40, maxHeight: '85%' },
    title: { color: c.tx, fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 4 },
    subtitle: { color: c.tx3, fontSize: 13, textAlign: 'center', marginBottom: 20 },
    option: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.border },
    optionIcon: { fontSize: 22, width: 36 },
    optionText: { color: c.tx, fontSize: 16 },
    cancel: { marginTop: 16, alignItems: 'center' },
    cancelText: { color: c.tx2, fontSize: 15, fontWeight: '600' },
    uploading: { alignItems: 'center', paddingVertical: 32, gap: 16 },
    uploadingText: { color: c.tx2, fontSize: 15 },
    pickerHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
    backBtn: { marginRight: 12 },
    backText: { color: '#6366f1', fontSize: 14, fontWeight: '600' },
    pickerTitle: { color: c.tx, fontSize: 16, fontWeight: '700' },
    createRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border, marginBottom: 8 },
    createRowIcon: { color: '#6366f1', fontSize: 20, width: 28, fontWeight: '700' },
    createRowText: { color: '#6366f1', fontSize: 15, fontWeight: '600' },
    search: { backgroundColor: c.bg, color: c.tx, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, borderWidth: 1, borderColor: c.border, marginBottom: 12 },
    sectionLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, marginTop: 4 },
    list: { maxHeight: 260 },
    listLoader: { marginVertical: 24 },
    listRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border },
    listRowSelected: { backgroundColor: 'rgba(99,102,241,0.08)' },
    listRowText: { flex: 1, color: c.tx, fontSize: 15 },
    listRowMeta: { color: c.tx3, fontSize: 12, marginLeft: 8, textTransform: 'capitalize' },
    checkmark: { color: '#6366f1', fontSize: 16, fontWeight: '700' },
    emptyText: { color: c.tx2, fontSize: 14, textAlign: 'center', paddingVertical: 24 },
    createBtn: { width: '100%', backgroundColor: '#6366f1', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
    createBtnDisabled: { opacity: 0.35 },
    createBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  });
}
