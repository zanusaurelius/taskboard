import { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, Linking, ActivityIndicator } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { getBaseUrl, getToken } from '@/lib/storage';
import { listAttachments, deleteAttachment, type AttachmentMeta } from '@/lib/api';

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

  const ext = mimeType.split('/')[1] ?? 'jpg';
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

export default function AttachmentsPanel({ noteId, taskId }: Props) {
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [uploading, setUploading] = useState(false);

  const reload = useCallback(async () => {
    const data = await listAttachments(noteId, taskId);
    setAttachments(data);
  }, [noteId, taskId]);

  useEffect(() => { reload(); }, [reload]);

  const handleAttach = () => {
    Alert.alert('Attach image', undefined, [
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
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const handleOpen = async (att: AttachmentMeta) => {
    const [baseUrl, token] = await Promise.all([getBaseUrl(), getToken()]);
    if (!baseUrl) return;
    const url = `${baseUrl}/api/attachments/${att.id}?token=${token ?? ''}`;
    Linking.openURL(url).catch(() => Alert.alert('Cannot open', 'No app available to open this file type.'));
  };

  const handleDelete = (att: AttachmentMeta) => {
    Alert.alert('Remove attachment?', att.originalName, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          const ok = await deleteAttachment(att.id);
          if (ok) setAttachments((prev) => prev.filter((a) => a.id !== att.id));
        },
      },
    ]);
  };

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.label}>Attachments</Text>
        <TouchableOpacity style={styles.attachBtn} onPress={handleAttach} disabled={uploading} activeOpacity={0.7}>
          {uploading
            ? <ActivityIndicator size="small" color="#6366f1" />
            : <Text style={styles.attachBtnText}>＋ Attach image</Text>}
        </TouchableOpacity>
      </View>

      {attachments.map((att) => (
        <View key={att.id} style={styles.row}>
          <Text style={styles.icon}>{fileIcon(att.mimeType)}</Text>
          <TouchableOpacity style={styles.nameWrap} onPress={() => handleOpen(att)} activeOpacity={0.7}>
            <Text style={styles.name} numberOfLines={1}>{att.originalName}</Text>
            <Text style={styles.size}>{formatBytes(att.size)}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleDelete(att)} style={styles.deleteBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.deleteText}>✕</Text>
          </TouchableOpacity>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  label: { color: '#475569', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  attachBtn: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    backgroundColor: 'rgba(99,102,241,0.12)', borderWidth: 1, borderColor: '#6366f1',
  },
  attachBtnText: { color: '#818cf8', fontSize: 13, fontWeight: '600' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#1e293b', borderRadius: 8, borderWidth: 1, borderColor: '#334155',
    paddingHorizontal: 12, paddingVertical: 10, marginBottom: 6,
  },
  icon: { fontSize: 18 },
  nameWrap: { flex: 1 },
  name: { color: '#e2e8f0', fontSize: 13, fontWeight: '500' },
  size: { color: '#64748b', fontSize: 11, marginTop: 1 },
  deleteBtn: { padding: 4 },
  deleteText: { color: '#64748b', fontSize: 13 },
});
