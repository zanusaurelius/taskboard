import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert,
  ActivityIndicator, Modal, FlatList, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { getBaseUrl, getToken } from '@/lib/storage';
import { getCachedFile } from '@/lib/file-cache';
import {
  listAttachments, deleteAttachment, linkFileAsAttachment,
  listFileFolders, listFiles,
  type AttachmentMeta, type FileFolderMeta, type UploadFileMeta,
} from '@/lib/api';
import { useThemeColors, type ThemeColors } from '@/lib/theme-context';

interface Props {
  noteId?: string;
  taskId?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mimeType: string): string {
  if (mimeType === 'application/pdf') return '📄';
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.includes('spreadsheet') || mimeType.includes('.sheet')) return '📊';
  if (mimeType.includes('presentation')) return '📊';
  if (mimeType.includes('word') || mimeType.includes('wordprocessing')) return '📝';
  return '📎';
}

async function uploadAttachment(
  uri: string,
  mimeType: string,
  originalName: string,
  noteId?: string,
  taskId?: string,
): Promise<AttachmentMeta | null> {
  const [baseUrl, token] = await Promise.all([getBaseUrl(), getToken()]);
  if (!baseUrl) return null;

  const formData = new FormData();
  formData.append('file', { uri, type: mimeType, name: originalName } as unknown as Blob);
  if (noteId) formData.append('noteId', noteId);
  if (taskId) formData.append('taskId', taskId);

  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  try {
    const res = await fetch(`${baseUrl}/api/attachments`, { method: 'POST', body: formData, headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      Alert.alert('Upload failed', body.error ?? 'Could not upload file.');
      return null;
    }
    return await res.json() as AttachmentMeta;
  } catch {
    Alert.alert('Upload failed', 'Could not connect to server.');
    return null;
  }
}

// ── File Picker Modal ─────────────────────────────────────────────────────────

type PickerEntry =
  | { type: 'folder'; item: FileFolderMeta }
  | { type: 'file';   item: UploadFileMeta };

interface StackEntry {
  id: string | null;
  name: string;
}

interface FilePickerProps {
  visible: boolean;
  noteId?: string;
  taskId?: string;
  linkedUploadIds: Set<string>;
  onPicked: (att: AttachmentMeta) => void;
  onClose: () => void;
  colors: ThemeColors;
}

function FilePicker({ visible, noteId, taskId, linkedUploadIds, onPicked, onClose, colors }: FilePickerProps) {
  const [stack, setStack] = useState<StackEntry[]>([{ id: null, name: 'Files' }]);
  const [entries, setEntries] = useState<PickerEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);

  const currentFolder = stack[stack.length - 1];

  const load = useCallback(async (folderId: string | null) => {
    setLoading(true);
    const [folders, files] = await Promise.all([
      listFileFolders(folderId),
      listFiles(folderId),
    ]);
    const folderEntries: PickerEntry[] = folders.map((f) => ({ type: 'folder', item: f }));
    const fileEntries: PickerEntry[] = files.map((f) => ({ type: 'file', item: f }));
    setEntries([...folderEntries, ...fileEntries]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (visible) {
      setStack([{ id: null, name: 'Files' }]);
      load(null);
    }
  }, [visible, load]);

  const handleFolderPress = (folder: FileFolderMeta) => {
    setStack((prev) => [...prev, { id: folder.id, name: folder.name }]);
    load(folder.id);
  };

  const handleBack = () => {
    const newStack = stack.slice(0, -1);
    setStack(newStack);
    load(newStack[newStack.length - 1].id);
  };

  const handleFilePress = async (file: UploadFileMeta) => {
    if (linkedUploadIds.has(file.id)) return; // already linked
    setLinking(true);
    const att = await linkFileAsAttachment(file.id, noteId, taskId);
    setLinking(false);
    if (att) {
      onPicked(att);
      onClose();
    } else {
      Alert.alert('Error', 'Could not link file as attachment.');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[pickerStyles.root, { backgroundColor: colors.bg }]}>
        {/* Header */}
        <View style={[pickerStyles.header, { borderBottomColor: colors.border }]}>
          {stack.length > 1 ? (
            <TouchableOpacity onPress={handleBack} style={pickerStyles.backBtn}>
              <Text style={[pickerStyles.backText, { color: '#6366f1' }]}>← Back</Text>
            </TouchableOpacity>
          ) : (
            <View style={pickerStyles.backBtn} />
          )}
          <Text style={[pickerStyles.title, { color: colors.tx }]} numberOfLines={1}>
            {currentFolder.name}
          </Text>
          <TouchableOpacity onPress={onClose} style={pickerStyles.backBtn}>
            <Text style={[pickerStyles.backText, { color: colors.tx2 }]}>Cancel</Text>
          </TouchableOpacity>
        </View>

        {/* Breadcrumb */}
        {stack.length > 1 && (
          <View style={[pickerStyles.crumb, { borderBottomColor: colors.border }]}>
            <Text style={{ color: colors.tx3, fontSize: 12 }} numberOfLines={1}>
              {stack.map((s) => s.name).join(' / ')}
            </Text>
          </View>
        )}

        {/* Content */}
        {loading || linking ? (
          <View style={pickerStyles.center}>
            <ActivityIndicator size="large" color={'#6366f1'} />
            {linking && <Text style={{ color: colors.tx2, marginTop: 8, fontSize: 13 }}>Linking file…</Text>}
          </View>
        ) : entries.length === 0 ? (
          <View style={pickerStyles.center}>
            <Text style={{ color: colors.tx3, fontSize: 14 }}>No files here</Text>
          </View>
        ) : (
          <FlatList
            data={entries}
            keyExtractor={(e) => (e.type === 'folder' ? `f-${e.item.id}` : `u-${e.item.id}`)}
            renderItem={({ item: entry }) => {
              if (entry.type === 'folder') {
                const folder = entry.item;
                return (
                  <TouchableOpacity
                    style={[pickerStyles.row, { borderBottomColor: colors.border }]}
                    onPress={() => handleFolderPress(folder)}
                    activeOpacity={0.7}
                  >
                    <Text style={pickerStyles.rowIcon}>📁</Text>
                    <View style={pickerStyles.rowInfo}>
                      <Text style={[pickerStyles.rowName, { color: colors.tx }]}>{folder.name}</Text>
                      <Text style={[pickerStyles.rowMeta, { color: colors.tx3 }]}>
                        {folder._count.children} folders · {folder._count.uploads} files
                      </Text>
                    </View>
                    <Text style={{ color: colors.tx3, fontSize: 16 }}>›</Text>
                  </TouchableOpacity>
                );
              } else {
                const file = entry.item;
                const alreadyLinked = linkedUploadIds.has(file.id);
                return (
                  <TouchableOpacity
                    style={[pickerStyles.row, { borderBottomColor: colors.border, opacity: alreadyLinked ? 0.5 : 1 }]}
                    onPress={() => handleFilePress(file)}
                    activeOpacity={alreadyLinked ? 1 : 0.7}
                  >
                    <Text style={pickerStyles.rowIcon}>{fileIcon(file.mimeType)}</Text>
                    <View style={pickerStyles.rowInfo}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={[pickerStyles.rowName, { color: colors.tx, flexShrink: 1 }]} numberOfLines={1}>
                          {file.originalName}
                        </Text>
                        {alreadyLinked && (
                          <Text style={{ color: '#818cf8', fontSize: 9, fontWeight: '800', backgroundColor: 'rgba(99,102,241,0.12)', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, overflow: 'hidden', textTransform: 'uppercase' }}>
                            Linked
                          </Text>
                        )}
                      </View>
                      <Text style={[pickerStyles.rowMeta, { color: colors.tx3 }]}>{formatBytes(file.size)}</Text>
                    </View>
                  </TouchableOpacity>
                );
              }
            }}
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const pickerStyles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1,
  },
  backBtn: { minWidth: 60 },
  backText: { fontSize: 15, fontWeight: '500' },
  title: { fontSize: 16, fontWeight: '700', flex: 1, textAlign: 'center' },
  crumb: { paddingHorizontal: 16, paddingVertical: 6, borderBottomWidth: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 60 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowIcon: { fontSize: 22 },
  rowInfo: { flex: 1 },
  rowName: { fontSize: 14, fontWeight: '500' },
  rowMeta: { fontSize: 12, marginTop: 2 },
});

// ── Main Panel ────────────────────────────────────────────────────────────────

export default function AttachmentsPanel({ noteId, taskId }: Props) {
  const colors = useThemeColors();
  const styles = makeStyles(colors);
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [uploading, setUploading] = useState(false);
  const [filePickerVisible, setFilePickerVisible] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [localUris, setLocalUris] = useState<Record<string, string>>({});

  useEffect(() => {
    Promise.all([getBaseUrl(), getToken()]).then(([url, tok]) => { setBaseUrl(url); setToken(tok); });
  }, []);

  // Background-sync image attachments as soon as the list loads
  const syncCancelRef = useRef(false);
  useEffect(() => {
    if (!attachments.length || !baseUrl || !token) return;
    syncCancelRef.current = false;
    (async () => {
      for (const att of attachments) {
        if (syncCancelRef.current) break;
        if (!att.mimeType.startsWith('image/')) continue;
        if (localUris[att.id]) continue;
        try {
          const uri = await getCachedFile(att.id, att.mimeType, `${baseUrl}/api/attachments/${att.id}`, token);
          if (!syncCancelRef.current) setLocalUris((prev) => ({ ...prev, [att.id]: uri }));
        } catch { /* skip */ }
      }
    })();
    return () => { syncCancelRef.current = true; };
  }, [attachments, baseUrl, token]); // eslint-disable-line react-hooks/exhaustive-deps

  const [viewerAtt, setViewerAtt] = useState<AttachmentMeta | null>(null);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const closeViewer = () => { setViewerAtt(null); setViewerUri(null); setViewerError(null); };

  const reload = useCallback(async () => {
    const data = await listAttachments(noteId, taskId);
    setAttachments(data);
  }, [noteId, taskId]);

  useEffect(() => { reload(); }, [reload]);

  const handleAttach = () => {
    Alert.alert('Attach file', undefined, [
      {
        text: 'Photo library', onPress: async () => {
          const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!perm.granted) { Alert.alert('Permission required', 'Allow photo access in Settings.'); return; }
          const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', quality: 0.85 });
          if (result.canceled || !result.assets[0]) return;
          const asset = result.assets[0];
          const mimeType = asset.mimeType ?? 'image/jpeg';
          const ext = mimeType.split('/')[1] ?? 'jpg';
          setUploading(true);
          const att = await uploadAttachment(asset.uri, mimeType, `photo.${ext}`, noteId, taskId);
          if (att) setAttachments((prev) => [...prev, att]);
          setUploading(false);
        },
      },
      {
        text: 'Camera', onPress: async () => {
          const perm = await ImagePicker.requestCameraPermissionsAsync();
          if (!perm.granted) { Alert.alert('Permission required', 'Allow camera access in Settings.'); return; }
          const result = await ImagePicker.launchCameraAsync({ mediaTypes: 'images', quality: 0.85 });
          if (result.canceled || !result.assets[0]) return;
          const asset = result.assets[0];
          const mimeType = asset.mimeType ?? 'image/jpeg';
          const ext = mimeType.split('/')[1] ?? 'jpg';
          setUploading(true);
          const att = await uploadAttachment(asset.uri, mimeType, `photo.${ext}`, noteId, taskId);
          if (att) setAttachments((prev) => [...prev, att]);
          setUploading(false);
        },
      },
      {
        text: 'Choose from Files', onPress: () => {
          setFilePickerVisible(true);
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleOpen = async (att: AttachmentMeta) => {
    if (!att.mimeType.startsWith('image/')) {
      Alert.alert(att.originalName, `${formatBytes(att.size)}\n\nThis file type can only be downloaded. File download support coming soon.`);
      return;
    }
    if (!baseUrl) return;
    setViewerAtt(att);
    setViewerUri(null);
    setViewerError(null);
    setViewerLoading(true);
    try {
      const localUri = localUris[att.id]
        ?? await getCachedFile(att.id, att.mimeType, `${baseUrl}/api/attachments/${att.id}`, token);
      setViewerUri(localUri);
      if (!localUris[att.id]) setLocalUris((prev) => ({ ...prev, [att.id]: localUri }));
    } catch (e) {
      setViewerError(e instanceof Error ? e.message : 'Could not load file');
    } finally {
      setViewerLoading(false);
    }
  };

  const handleDelete = (att: AttachmentMeta) => {
    const message = att.uploadId
      ? `Remove link to "${att.originalName}"? The original file stays in your Files gallery.`
      : `Delete "${att.originalName}"? This cannot be undone.`;
    Alert.alert(att.uploadId ? 'Remove link?' : 'Delete attachment?', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: att.uploadId ? 'Remove link' : 'Delete', style: 'destructive', onPress: async () => {
          const ok = await deleteAttachment(att.id);
          if (ok) setAttachments((prev) => prev.filter((a) => a.id !== att.id));
        },
      },
    ]);
  };

  const handleFilePicked = (att: AttachmentMeta) => {
    setAttachments((prev) => [...prev, att]);
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.label}>{taskId ? 'Task attachments' : 'Note attachments'}</Text>
        <TouchableOpacity style={styles.attachBtn} onPress={handleAttach} disabled={uploading} activeOpacity={0.7}>
          {uploading
            ? <ActivityIndicator size="small" color="#6366f1" />
            : <Text style={styles.attachBtnText}>＋ Attach</Text>}
        </TouchableOpacity>
      </View>

      {attachments.map((att) => (
        <View key={att.id} style={styles.row}>
          {localUris[att.id]
            ? <Image source={{ uri: localUris[att.id] }} style={styles.thumb} />
            : <Text style={styles.icon}>{fileIcon(att.mimeType)}</Text>}
          <TouchableOpacity style={styles.nameWrap} onPress={() => handleOpen(att)} activeOpacity={0.7}>
            <View style={styles.nameRow}>
              <Text style={styles.name} numberOfLines={1}>{att.originalName}</Text>
              {att.uploadId && <Text style={styles.linkedBadge}>From Files</Text>}
            </View>
            <Text style={styles.size}>{formatBytes(att.size)}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => handleDelete(att)}
            style={styles.deleteBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.deleteText}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}

      <FilePicker
        visible={filePickerVisible}
        noteId={noteId}
        taskId={taskId}
        linkedUploadIds={new Set(attachments.map((a) => a.uploadId).filter((id): id is string => !!id))}
        onPicked={handleFilePicked}
        onClose={() => setFilePickerVisible(false)}
        colors={colors}
      />

      <Modal visible={!!viewerAtt} transparent={false} animationType="fade" onRequestClose={closeViewer}>
        <SafeAreaView style={attViewerStyles.root} edges={['top', 'bottom']}>
          <View style={attViewerStyles.header}>
            <TouchableOpacity onPress={closeViewer} style={attViewerStyles.closeBtn}>
              <Text style={attViewerStyles.closeText}>✕</Text>
            </TouchableOpacity>
            <Text style={attViewerStyles.title} numberOfLines={1}>{viewerAtt?.originalName || 'File'}</Text>
            <View style={{ width: 36 }} />
          </View>
          <View style={attViewerStyles.body}>
            {viewerLoading ? (
              <ActivityIndicator size="large" color="#6366f1" />
            ) : viewerError ? (
              <Text style={attViewerStyles.error}>{viewerError}</Text>
            ) : viewerUri ? (
              <Image source={{ uri: viewerUri }} style={attViewerStyles.image} resizeMode="contain" />
            ) : null}
          </View>
          {viewerAtt && (
            <Text style={attViewerStyles.meta}>{formatBytes(viewerAtt.size)}</Text>
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    label: { color: c.tx2, fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
    attachBtn: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
      backgroundColor: 'rgba(99,102,241,0.12)', borderWidth: 1, borderColor: '#6366f1',
    },
    attachBtnText: { color: '#818cf8', fontSize: 13, fontWeight: '600' },
    row: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: c.surface, borderRadius: 8, borderWidth: 1, borderColor: c.border,
      paddingHorizontal: 12, paddingVertical: 10, marginBottom: 6,
    },
    icon: { fontSize: 18, width: 36, textAlign: 'center' },
    thumb: { width: 36, height: 36, borderRadius: 4 },
    nameWrap: { flex: 1 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    name: { color: c.tx, fontSize: 13, fontWeight: '500', flexShrink: 1 },
    linkedBadge: { color: '#818cf8', backgroundColor: 'rgba(99,102,241,0.12)', fontSize: 9, fontWeight: '800', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, overflow: 'hidden', textTransform: 'uppercase', letterSpacing: 0.5 },
    size: { color: c.tx3, fontSize: 11, marginTop: 1 },
    deleteBtn: { padding: 4 },
    deleteText: { color: c.tx3, fontSize: 13 },
  });
}

const attViewerStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
  closeBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#fff', fontSize: 20, fontWeight: '300' },
  title: { flex: 1, color: '#e2e8f0', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  error: { color: '#f87171', fontSize: 14 },
  meta: { color: '#475569', fontSize: 12, textAlign: 'center', paddingVertical: 10 },
});
