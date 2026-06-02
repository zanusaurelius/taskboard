import { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, RefreshControl,
  Alert, Modal, Image, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import {
  listFiles, listFileFolders, uploadFile, deleteFile,
  createFileFolder, renameFileFolder, deleteFileFolder,
  fileUrl, fileThumbnailUrl,
  type UploadFileMeta, type FileFolderMeta,
} from '@/lib/api';
import { getBaseUrl, getToken } from '@/lib/storage';

type ViewMode = 'grid' | 'list';

interface BreadcrumbEntry { id: string | null; name: string }

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fileEmoji(mimeType: string) {
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.startsWith('video/')) return '🎬';
  if (mimeType.startsWith('audio/')) return '🎵';
  if (mimeType === 'application/pdf') return '📄';
  if (mimeType === 'application/zip') return '🗜️';
  return '📎';
}

export default function FilesScreen() {
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [stack, setStack] = useState<BreadcrumbEntry[]>([{ id: null, name: 'Files' }]);
  const currentFolder = stack[stack.length - 1];

  const [folders, setFolders] = useState<FileFolderMeta[]>([]);
  const [files, setFiles] = useState<UploadFileMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);

  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState<string | null>(null);

  // Folder creation / rename modal (shared)
  const [folderModalVisible, setFolderModalVisible] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderCreating, setFolderCreating] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<FileFolderMeta | null>(null);

  // Upload picker modal
  const [uploadModalVisible, setUploadModalVisible] = useState(false);

  useEffect(() => {
    Promise.all([getBaseUrl(), getToken()]).then(([url, tok]) => {
      setBaseUrl(url);
      setToken(tok);
    });
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const fid = currentFolder.id;
    const [f, u] = await Promise.all([listFileFolders(fid), listFiles(fid)]);
    setFolders(f);
    setFiles(u);
    if (!silent) setLoading(false);
  }, [currentFolder.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const refresh = async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  };

  const enterFolder = (folder: FileFolderMeta) => {
    setStack((s) => [...s, { id: folder.id, name: folder.name }]);
  };

  const goBack = () => {
    if (stack.length > 1) setStack((s) => s.slice(0, -1));
  };

  const handleCreateFolder = async () => {
    if (!folderName.trim()) return;
    setFolderCreating(true);
    if (renamingFolder) {
      await renameFileFolder(renamingFolder.id, folderName.trim());
    } else {
      await createFileFolder(folderName.trim(), currentFolder.id);
    }
    setFolderCreating(false);
    setFolderModalVisible(false);
    setFolderName('');
    setRenamingFolder(null);
    load();
  };

  const handleDeleteFile = (file: UploadFileMeta) => {
    Alert.alert('Delete File', `Delete "${file.originalName}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteFile(file.id); load(); } },
    ]);
  };

  const handleDeleteFolder = (folder: FileFolderMeta) => {
    Alert.alert('Delete Folder', `Delete "${folder.name}"? Files inside will be moved to the parent folder.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteFileFolder(folder.id); load(); } },
    ]);
  };

  const handleRenameFolder = (folder: FileFolderMeta) => {
    setRenamingFolder(folder);
    setFolderName(folder.name);
    setFolderModalVisible(true);
  };

  const pickFromLibrary = async () => {
    setUploadModalVisible(false);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow access to your photo library to upload files.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 1,
      allowsMultipleSelection: false,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const name = asset.fileName ?? `upload.${asset.mimeType?.split('/')[1] ?? 'jpg'}`;
    setUploading(true);
    await uploadFile(asset.uri, name, asset.mimeType ?? 'image/jpeg', currentFolder.id);
    setUploading(false);
    load();
  };

  const pickDocument = async () => {
    setUploadModalVisible(false);
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setUploading(true);
    await uploadFile(asset.uri, asset.name, asset.mimeType ?? 'application/octet-stream', currentFolder.id);
    setUploading(false);
    load();
  };

  const takePhoto = async () => {
    setUploadModalVisible(false);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow camera access to take photos.'); return; }
    const result = await ImagePicker.launchCameraAsync({ quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const name = asset.fileName ?? `photo_${Date.now()}.jpg`;
    setUploading(true);
    await uploadFile(asset.uri, name, asset.mimeType ?? 'image/jpeg', currentFolder.id);
    setUploading(false);
    load();
  };

  // Build combined list data for FlatList
  type ListItem =
    | { type: 'sectionHeader'; title: string }
    | { type: 'folder'; data: FileFolderMeta }
    | { type: 'file'; data: UploadFileMeta };

  const listData: ListItem[] = [];
  if (folders.length > 0) {
    listData.push({ type: 'sectionHeader', title: 'Folders' });
    folders.forEach((f) => listData.push({ type: 'folder', data: f }));
  }
  if (files.length > 0) {
    if (folders.length > 0) listData.push({ type: 'sectionHeader', title: 'Files' });
    files.forEach((f) => listData.push({ type: 'file', data: f }));
  }

  const GRID_COLS = 3;

  // For grid mode, group files into rows of GRID_COLS
  const gridRows: (UploadFileMeta | null)[][] = [];
  for (let i = 0; i < files.length; i += GRID_COLS) {
    const row = files.slice(i, i + GRID_COLS);
    while (row.length < GRID_COLS) row.push(null);
    gridRows.push(row);
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.breadcrumb}>
          {stack.length > 1 && (
            <TouchableOpacity onPress={goBack} style={styles.backBtn}>
              <Text style={styles.backArrow}>←</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.headerTitle} numberOfLines={1}>
            {currentFolder.name}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')} style={styles.iconBtn}>
            <Text style={styles.iconBtnText}>{viewMode === 'grid' ? '☰' : '⊞'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { setFolderName(''); setFolderModalVisible(true); }} style={styles.iconBtn}>
            <Text style={styles.iconBtnText}>📁+</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setUploadModalVisible(true)} style={styles.uploadBtn} disabled={uploading}>
            {uploading
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.uploadBtnText}>+ Upload</Text>}
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#6366f1" />
        </View>
      ) : folders.length === 0 && files.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyIcon}>📂</Text>
          <Text style={styles.emptyText}>This folder is empty</Text>
          <TouchableOpacity onPress={() => setUploadModalVisible(true)} style={styles.emptyBtn}>
            <Text style={styles.emptyBtnText}>Upload a file</Text>
          </TouchableOpacity>
        </View>
      ) : viewMode === 'list' ? (
        <FlatList
          data={listData}
          keyExtractor={(item, i) => `${item.type}-${i}`}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#6366f1" />}
          renderItem={({ item }) => {
            if (item.type === 'sectionHeader') {
              return <Text style={styles.sectionHeader}>{item.title}</Text>;
            }
            if (item.type === 'folder') {
              const f = item.data;
              const count = f._count.uploads + f._count.children;
              return (
                <TouchableOpacity
                  style={styles.listRow}
                  onPress={() => enterFolder(f)}
                  onLongPress={() => Alert.alert(f.name, '', [
                    { text: 'Rename', onPress: () => handleRenameFolder(f) },
                    { text: 'Delete', style: 'destructive', onPress: () => handleDeleteFolder(f) },
                    { text: 'Cancel', style: 'cancel' },
                  ])}
                >
                  <Text style={styles.listIcon}>📁</Text>
                  <View style={styles.listInfo}>
                    <Text style={styles.listName} numberOfLines={1}>{f.name}</Text>
                    <Text style={styles.listMeta}>{count === 0 ? 'Empty' : `${count} item${count !== 1 ? 's' : ''}`}</Text>
                  </View>
                  <Text style={styles.chevron}>›</Text>
                </TouchableOpacity>
              );
            }
            // file row
            const f = item.data;
            const isImg = f.mimeType.startsWith('image/');
            return (
              <TouchableOpacity
                style={styles.listRow}
                onLongPress={() => Alert.alert(f.originalName, '', [
                  { text: 'Delete', style: 'destructive', onPress: () => handleDeleteFile(f) },
                  { text: 'Cancel', style: 'cancel' },
                ])}
              >
                {isImg && baseUrl ? (
                  <Image source={{ uri: fileThumbnailUrl(f.id, baseUrl, token), headers: token ? { Authorization: `Bearer ${token}` } : undefined }} style={styles.listThumb} />
                ) : (
                  <Text style={styles.listIcon}>{fileEmoji(f.mimeType)}</Text>
                )}
                <View style={styles.listInfo}>
                  <Text style={styles.listName} numberOfLines={1}>{f.originalName}</Text>
                  <Text style={styles.listMeta}>{formatBytes(f.size)}</Text>
                </View>
              </TouchableOpacity>
            );
          }}
        />
      ) : (
        // Grid mode — folders in a horizontal scroll, then photo grid
        <FlatList
          data={[
            ...(folders.length > 0 ? [{ type: 'folders' as const }] : []),
            ...gridRows.map((row) => ({ type: 'gridRow' as const, row })),
          ]}
          keyExtractor={(item, i) => `grid-${i}`}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#6366f1" />}
          renderItem={({ item }) => {
            if (item.type === 'folders') {
              return (
                <View>
                  <Text style={styles.sectionHeader}>Folders</Text>
                  <FlatList
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    data={folders}
                    keyExtractor={(f) => f.id}
                    contentContainerStyle={{ paddingHorizontal: 12, gap: 10 }}
                    renderItem={({ item: f }) => {
                      const count = f._count.uploads + f._count.children;
                      return (
                        <TouchableOpacity
                          style={styles.folderCard}
                          onPress={() => enterFolder(f)}
                          onLongPress={() => Alert.alert(f.name, '', [
                            { text: 'Rename', onPress: () => handleRenameFolder(f) },
                            { text: 'Delete', style: 'destructive', onPress: () => handleDeleteFolder(f) },
                            { text: 'Cancel', style: 'cancel' },
                          ])}
                        >
                          <Text style={styles.folderCardIcon}>📁</Text>
                          <Text style={styles.folderCardName} numberOfLines={2}>{f.name}</Text>
                          <Text style={styles.folderCardCount}>{count === 0 ? 'Empty' : `${count} item${count !== 1 ? 's' : ''}`}</Text>
                        </TouchableOpacity>
                      );
                    }}
                  />
                  {files.length > 0 && <Text style={[styles.sectionHeader, { marginTop: 12 }]}>Files</Text>}
                </View>
              );
            }
            // Grid row
            return (
              <View style={styles.gridRow}>
                {item.row.map((file, idx) =>
                  file === null ? (
                    <View key={idx} style={styles.gridCell} />
                  ) : file.mimeType.startsWith('image/') && baseUrl ? (
                    <TouchableOpacity
                      key={file.id}
                      style={styles.gridCell}
                      onLongPress={() => Alert.alert(file.originalName, '', [
                        { text: 'Delete', style: 'destructive', onPress: () => handleDeleteFile(file) },
                        { text: 'Cancel', style: 'cancel' },
                      ])}
                    >
                      <Image
                        source={{ uri: fileThumbnailUrl(file.id, baseUrl, token) }}
                        style={styles.gridThumb}
                      />
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      key={file.id}
                      style={[styles.gridCell, styles.gridCellDoc]}
                      onLongPress={() => Alert.alert(file.originalName, '', [
                        { text: 'Delete', style: 'destructive', onPress: () => handleDeleteFile(file) },
                        { text: 'Cancel', style: 'cancel' },
                      ])}
                    >
                      <Text style={styles.gridDocIcon}>{fileEmoji(file.mimeType)}</Text>
                      <Text style={styles.gridDocName} numberOfLines={2}>{file.originalName}</Text>
                    </TouchableOpacity>
                  )
                )}
              </View>
            );
          }}
        />
      )}

      {/* Upload source modal */}
      <Modal visible={uploadModalVisible} transparent animationType="slide" onRequestClose={() => setUploadModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setUploadModalVisible(false)}>
          <View style={styles.uploadSheet}>
            <Text style={styles.uploadSheetTitle}>Upload</Text>
            <TouchableOpacity style={styles.uploadOption} onPress={takePhoto}>
              <Text style={styles.uploadOptionIcon}>📷</Text>
              <Text style={styles.uploadOptionText}>Take Photo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.uploadOption} onPress={pickFromLibrary}>
              <Text style={styles.uploadOptionIcon}>🖼️</Text>
              <Text style={styles.uploadOptionText}>Photo / Video Library</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.uploadOption} onPress={pickDocument}>
              <Text style={styles.uploadOptionIcon}>📎</Text>
              <Text style={styles.uploadOptionText}>Browse Files</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.uploadCancel} onPress={() => setUploadModalVisible(false)}>
              <Text style={styles.uploadCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>

      {/* New folder / rename modal */}
      <Modal visible={folderModalVisible} transparent animationType="fade" onRequestClose={() => { setFolderModalVisible(false); setRenamingFolder(null); }}>
        <Pressable style={styles.modalOverlay} onPress={() => { setFolderModalVisible(false); setRenamingFolder(null); }}>
          <Pressable style={styles.folderModal} onPress={() => {}}>
            <Text style={styles.folderModalTitle}>{renamingFolder ? 'Rename Folder' : 'New Folder'}</Text>
            <TextInput
              style={styles.folderInput}
              placeholder="Folder name"
              placeholderTextColor="#64748b"
              value={folderName}
              onChangeText={setFolderName}
              autoFocus
              onSubmitEditing={handleCreateFolder}
            />
            <View style={styles.folderModalBtns}>
              <TouchableOpacity onPress={() => { setFolderModalVisible(false); setRenamingFolder(null); }} style={styles.folderModalCancel}>
                <Text style={styles.folderModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleCreateFolder} style={styles.folderModalCreate} disabled={folderCreating}>
                {folderCreating
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.folderModalCreateText}>{renamingFolder ? 'Rename' : 'Create'}</Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  breadcrumb: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 },
  backBtn: { marginRight: 8 },
  backArrow: { color: '#a5b4fc', fontSize: 22, fontWeight: '300' },
  headerTitle: { color: '#f1f5f9', fontSize: 18, fontWeight: '700', flexShrink: 1 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  iconBtn: { padding: 6 },
  iconBtnText: { fontSize: 18 },
  uploadBtn: { backgroundColor: '#6366f1', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, minWidth: 80, alignItems: 'center' },
  uploadBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyIcon: { fontSize: 64 },
  emptyText: { color: '#94a3b8', fontSize: 16 },
  emptyBtn: { marginTop: 8, backgroundColor: '#6366f1', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  emptyBtnText: { color: '#fff', fontWeight: '600' },
  sectionHeader: { color: '#64748b', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginHorizontal: 16, marginTop: 16, marginBottom: 8 },
  // List view
  listRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  listIcon: { fontSize: 26, width: 36, textAlign: 'center' },
  listThumb: { width: 36, height: 36, borderRadius: 4 },
  listInfo: { flex: 1, marginLeft: 10 },
  listName: { color: '#f1f5f9', fontSize: 14, fontWeight: '500' },
  listMeta: { color: '#64748b', fontSize: 12, marginTop: 1 },
  chevron: { color: '#475569', fontSize: 20 },
  // Grid view
  gridRow: { flexDirection: 'row', paddingHorizontal: 2 },
  gridCell: { flex: 1, aspectRatio: 1, padding: 1 },
  gridThumb: { flex: 1, borderRadius: 2 },
  gridCellDoc: { backgroundColor: '#1e293b', margin: 1, borderRadius: 6, padding: 8, alignItems: 'center', justifyContent: 'center' },
  gridDocIcon: { fontSize: 28 },
  gridDocName: { color: '#94a3b8', fontSize: 10, textAlign: 'center', marginTop: 4 },
  // Folder card (horizontal scroll)
  folderCard: { width: 110, backgroundColor: '#1e293b', borderRadius: 10, padding: 12, alignItems: 'center' },
  folderCardIcon: { fontSize: 36, marginBottom: 6 },
  folderCardName: { color: '#f1f5f9', fontSize: 12, fontWeight: '600', textAlign: 'center' },
  folderCardCount: { color: '#64748b', fontSize: 11, marginTop: 2 },
  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  uploadSheet: { backgroundColor: '#1e293b', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
  uploadSheetTitle: { color: '#f1f5f9', fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 20 },
  uploadOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  uploadOptionIcon: { fontSize: 24, width: 40 },
  uploadOptionText: { color: '#e2e8f0', fontSize: 16 },
  uploadCancel: { marginTop: 16, alignItems: 'center' },
  uploadCancelText: { color: '#94a3b8', fontSize: 15, fontWeight: '600' },
  folderModal: { backgroundColor: '#1e293b', borderRadius: 16, padding: 24, marginHorizontal: 32, marginTop: 'auto', marginBottom: 'auto' },
  folderModalTitle: { color: '#f1f5f9', fontSize: 16, fontWeight: '700', marginBottom: 16, textAlign: 'center' },
  folderInput: { backgroundColor: '#0f172a', color: '#f1f5f9', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, borderWidth: 1, borderColor: '#334155' },
  folderModalBtns: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, gap: 10 },
  folderModalCancel: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  folderModalCancelText: { color: '#94a3b8', fontWeight: '600' },
  folderModalCreate: { flex: 1, backgroundColor: '#6366f1', borderRadius: 8, alignItems: 'center', paddingVertical: 10 },
  folderModalCreateText: { color: '#fff', fontWeight: '700' },
});
