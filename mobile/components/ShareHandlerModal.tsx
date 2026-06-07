import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, Modal, Pressable, NativeModules, Alert,
} from 'react-native';
import { apiFetch, isOk, uploadFile, uploadOk } from '@/lib/api';
import { getBaseUrl, getToken } from '@/lib/storage';
import { useVault } from '@/lib/vault-context';
import { useThemeColors, type ThemeColors } from '@/lib/theme-context';
import type { Note, Task } from '@/lib/types';

export interface SharedFile {
  path: string;
  name: string;
  type: string;
}

interface Props {
  files: SharedFile[];
  onDismiss: () => void;
}

type Mode = 'choose' | 'notes' | 'tasks' | 'uploading';

async function uploadAsAttachment(
  file: SharedFile,
  noteId?: string,
  taskId?: string,
): Promise<void> {
  const [baseUrl, token] = await Promise.all([getBaseUrl(), getToken()]);
  if (!baseUrl) throw new Error('No server URL');
  const fd = new FormData();
  fd.append('file', { uri: `file://${file.path}`, type: file.type, name: file.name } as unknown as Blob);
  if (noteId) fd.append('noteId', noteId);
  if (taskId) fd.append('taskId', taskId);
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${baseUrl}/api/attachments`, { method: 'POST', body: fd, headers });
  if (!res.ok) throw new Error(`Upload failed with status ${res.status}`);
}


export default function ShareHandlerModal({ files, onDismiss }: Props) {
  const colors = useThemeColors();
  const styles = makeStyles(colors);
  const { decrypt } = useVault();

  const [mode, setMode] = useState<Mode>('choose');

  // Notes picker state
  const [notes, setNotes] = useState<(Note & { displayTitle: string })[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteSearch, setNoteSearch] = useState('');

  // Tasks picker state
  const [tasks, setTasks] = useState<(Task & { displayTitle: string })[]>([]);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [taskSearch, setTaskSearch] = useState('');

  const loadNotes = useCallback(async () => {
    setNotesLoading(true);
    const result = await apiFetch<Note[]>('/api/notes');
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
  }, [decrypt]);

  const loadTasks = useCallback(async () => {
    setTasksLoading(true);
    const result = await apiFetch<Task[]>('/api/tasks');
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
  }, [decrypt]);

  useEffect(() => {
    if (mode === 'notes') loadNotes();
    if (mode === 'tasks') loadTasks();
  }, [mode, loadNotes, loadTasks]);

  const finishUpload = (succeededPaths: string[], failedCount: number) => {
    // Only clear cache files that were successfully uploaded
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
    const succeededPaths: string[] = [];
    let failed = 0;
    for (const file of files) {
      try {
        await uploadAsAttachment(file, noteId, undefined);
        succeededPaths.push(file.path);
      } catch { failed++; }
    }
    finishUpload(succeededPaths, failed);
  };

  const handleAttachToTask = async (taskId: string) => {
    setMode('uploading');
    const succeededPaths: string[] = [];
    let failed = 0;
    for (const file of files) {
      try {
        await uploadAsAttachment(file, undefined, taskId);
        succeededPaths.push(file.path);
      } catch { failed++; }
    }
    finishUpload(succeededPaths, failed);
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
        <Pressable style={styles.sheet} onPress={() => {}}>
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
                  ListEmptyComponent={
                    <Text style={styles.emptyText}>No notes found</Text>
                  }
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.listRow}
                      onPress={() => handleAttachToNote(item.id)}
                    >
                      <Text style={styles.listRowText} numberOfLines={1}>
                        {item.displayTitle}
                      </Text>
                    </TouchableOpacity>
                  )}
                />
              )}

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
                  ListEmptyComponent={
                    <Text style={styles.emptyText}>No tasks found</Text>
                  }
                  renderItem={({ item }) => (
                    <TouchableOpacity
                      style={styles.listRow}
                      onPress={() => handleAttachToTask(item.id)}
                    >
                      <Text style={styles.listRowText} numberOfLines={1}>
                        {item.displayTitle}
                      </Text>
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
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: c.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40, maxHeight: '80%' },
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
    search: { backgroundColor: c.bg, color: c.tx, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, borderWidth: 1, borderColor: c.border, marginBottom: 12 },
    list: { maxHeight: 320 },
    listLoader: { marginVertical: 24 },
    listRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border },
    listRowText: { flex: 1, color: c.tx, fontSize: 15 },
    listRowMeta: { color: c.tx3, fontSize: 12, marginLeft: 8, textTransform: 'capitalize' },
    emptyText: { color: c.tx2, fontSize: 14, textAlign: 'center', paddingVertical: 24 },
  });
}
