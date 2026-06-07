import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, RefreshControl,
  Alert, Modal, Image, Pressable, PanResponder, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import {
  apiFetch, isOk,
  listFiles, listFileFolders, uploadFile, uploadOk, deleteFile,
  createFileFolder, renameFileFolder, deleteFileFolder,
  moveFile, moveFolderTo, renameFile,
  fileUrl, fileThumbnailUrl,
  type UploadFileMeta, type FileFolderMeta,
} from '@/lib/api';
import { getBaseUrl, getToken } from '@/lib/storage';
import { getCachedFile } from '@/lib/file-cache';
import { useThemeColors, type ThemeColors } from '@/lib/theme-context';

type ViewMode = 'grid' | 'list';
type SortField = 'name' | 'modified' | 'created' | 'size' | 'kind';
type SortDir = 'asc' | 'desc';

const SORT_LABELS: Record<SortField, string> = {
  name: 'Name',
  modified: 'Date Modified',
  created: 'Date Created',
  size: 'File Size',
  kind: 'Kind',
};

interface BreadcrumbEntry { id: string | null; name: string }

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function fileEmoji(mimeType: string) {
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.startsWith('video/')) return '🎬';
  if (mimeType.startsWith('audio/')) return '🎵';
  if (mimeType === 'application/pdf') return '📄';
  if (mimeType === 'application/zip') return '🗜️';
  return '📎';
}

function fileKind(mimeType: string): string {
  if (mimeType.startsWith('image/')) return `${mimeType.split('/')[1].toUpperCase()} Image`;
  if (mimeType.startsWith('video/')) return 'Video';
  if (mimeType.startsWith('audio/')) return 'Audio';
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType === 'application/zip' || mimeType === 'application/x-zip-compressed') return 'ZIP Archive';
  if (mimeType.startsWith('text/')) return 'Text';
  return mimeType.split('/')[1] ?? mimeType;
}

function sortFolders(folders: FileFolderMeta[], field: SortField, dir: SortDir): FileFolderMeta[] {
  return [...folders].sort((a, b) => {
    let cmp = 0;
    if (field === 'modified') cmp = a.updatedAt.localeCompare(b.updatedAt);
    else if (field === 'created') cmp = a.createdAt.localeCompare(b.createdAt);
    else cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    return dir === 'asc' ? cmp : -cmp;
  });
}

function sortFiles(files: UploadFileMeta[], field: SortField, dir: SortDir): UploadFileMeta[] {
  return [...files].sort((a, b) => {
    let cmp = 0;
    if (field === 'modified') cmp = a.updatedAt.localeCompare(b.updatedAt);
    else if (field === 'created') cmp = a.createdAt.localeCompare(b.createdAt);
    else if (field === 'size') cmp = a.size - b.size;
    else if (field === 'kind') cmp = a.mimeType.localeCompare(b.mimeType);
    else cmp = a.originalName.localeCompare(b.originalName, undefined, { sensitivity: 'base' });
    return dir === 'asc' ? cmp : -cmp;
  });
}

// Calculates which file index (in sortedFiles order) a touch point falls on.
// Returns null if outside the file grid area.
function computeGridIndex(
  pageX: number,
  pageY: number,
  listTopY: number,
  scrollOffset: number,
  foldersSectionHeight: number,
  cellSize: number,
  fileCount: number,
): number | null {
  if (cellSize <= 0) return null;
  const relY = pageY - listTopY + scrollOffset;
  const gridY = relY - foldersSectionHeight;
  if (gridY < 0) return null;
  const row = Math.floor(gridY / cellSize);
  const col = Math.max(0, Math.min(2, Math.floor((pageX - 2) / cellSize)));
  const idx = row * 3 + col;
  if (idx < 0 || idx >= fileCount) return null;
  return idx;
}

export default function FilesScreen() {
  const { openFolderId } = useLocalSearchParams<{ openFolderId?: string }>();
  const handledOpenFolderRef = useRef<string | null>(null);
  const colors = useThemeColors();
  const styles = makeStyles(colors);
  const { width: screenWidth } = useWindowDimensions();

  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [sortModalVisible, setSortModalVisible] = useState(false);
  const [stack, setStack] = useState<BreadcrumbEntry[]>([{ id: null, name: 'Files' }]);
  const currentFolder = stack[stack.length - 1];

  const [folders, setFolders] = useState<FileFolderMeta[]>([]);
  const [files, setFiles] = useState<UploadFileMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [offline, setOffline] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Selection
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());

  type PendingDelete =
    | { type: 'file'; item: UploadFileMeta }
    | { type: 'folder'; item: FileFolderMeta }
    | { type: 'files'; items: UploadFileMeta[] };

  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDeleteRef = useRef<PendingDelete | null>(null);
  useEffect(() => { pendingDeleteRef.current = pendingDelete; }, [pendingDelete]);

  const [baseUrl, setBaseUrl] = useState('');
  const [token, setToken] = useState<string | null>(null);

  const [folderModalVisible, setFolderModalVisible] = useState(false);
  const [folderName, setFolderName] = useState('');
  const [folderCreating, setFolderCreating] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState<FileFolderMeta | null>(null);
  const [renamingFile, setRenamingFile] = useState<UploadFileMeta | null>(null);

  const [uploadModalVisible, setUploadModalVisible] = useState(false);

  // Local file:// URIs for cached images — populated progressively by background sync
  const [localUris, setLocalUris] = useState<Record<string, string>>({});

  // In-app image viewer (avoids Fresco/Tor proxy mismatch)
  const [viewerFile, setViewerFile] = useState<UploadFileMeta | null>(null);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);

  const closeViewer = () => { setViewerFile(null); setViewerUri(null); setViewerError(null); };

  const [moveTarget, setMoveTarget] = useState<{ type: 'file' | 'folder'; item: UploadFileMeta | FileFolderMeta } | null>(null);
  const [moveModalVisible, setMoveModalVisible] = useState(false);
  const [movePickerStack, setMovePickerStack] = useState<BreadcrumbEntry[]>([{ id: null, name: 'Files' }]);
  const [movePickerFolders, setMovePickerFolders] = useState<FileFolderMeta[]>([]);
  const [movePickerLoading, setMovePickerLoading] = useState(false);

  useEffect(() => {
    Promise.all([getBaseUrl(), getToken()]).then(([url, tok]) => {
      setBaseUrl(url);
      setToken(tok);
    });
  }, []);

  // ── Drag-to-select refs (grid mode) ───────────────────────────────────────
  const [isDragging, setIsDragging] = useState(false);
  const cellSizeRef = useRef(0);
  const scrollOffsetRef = useRef(0);
  const gridWrapperRef = useRef<View>(null);
  const listTopYRef = useRef(0);
  const foldersSectionHeightRef = useRef(0);
  const selectionModeRef = useRef(false);
  const selectedFileIdsRef = useRef<Set<string>>(new Set());
  const sortedFilesRef = useRef<UploadFileMeta[]>([]);
  const dragAnchorIdxRef = useRef<number | null>(null);
  const preSelectionRef = useRef<Set<string>>(new Set());
  const lastDragRangeRef = useRef<[number, number] | null>(null);

  // Keep lightweight refs in sync during render (no useEffect overhead needed)
  selectionModeRef.current = selectionMode;
  selectedFileIdsRef.current = selectedFileIds;

  const dragPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      // Capture the gesture (stealing from FlatList scroll) once the finger
      // has clearly moved and we're in selection mode.
      onMoveShouldSetPanResponderCapture: (_, gs) =>
        selectionModeRef.current && (Math.abs(gs.dx) > 5 || Math.abs(gs.dy) > 5),
      onPanResponderGrant: (_, gs) => {
        setIsDragging(true);
        preSelectionRef.current = new Set(selectedFileIdsRef.current);
        dragAnchorIdxRef.current = computeGridIndex(
          gs.x0, gs.y0,
          listTopYRef.current, scrollOffsetRef.current,
          foldersSectionHeightRef.current, cellSizeRef.current,
          sortedFilesRef.current.length,
        );
        lastDragRangeRef.current = null;
      },
      onPanResponderMove: (_, gs) => {
        const curIdx = computeGridIndex(
          gs.moveX, gs.moveY,
          listTopYRef.current, scrollOffsetRef.current,
          foldersSectionHeightRef.current, cellSizeRef.current,
          sortedFilesRef.current.length,
        );
        if (curIdx === null) return;
        if (dragAnchorIdxRef.current === null) dragAnchorIdxRef.current = curIdx;
        const anchor = dragAnchorIdxRef.current;
        const min = Math.min(anchor, curIdx);
        const max = Math.max(anchor, curIdx);
        // Skip update if range didn't change (avoids a React re-render every frame)
        if (lastDragRangeRef.current?.[0] === min && lastDragRangeRef.current?.[1] === max) return;
        lastDragRangeRef.current = [min, max];
        setSelectedFileIds(() => {
          const next = new Set(preSelectionRef.current);
          for (let i = min; i <= max; i++) {
            const f = sortedFilesRef.current[i];
            if (f) next.add(f.id);
          }
          return next;
        });
      },
      onPanResponderRelease: () => {
        setIsDragging(false);
        dragAnchorIdxRef.current = null;
        lastDragRangeRef.current = null;
      },
      onPanResponderTerminate: () => {
        setIsDragging(false);
        dragAnchorIdxRef.current = null;
        lastDragRangeRef.current = null;
      },
    })
  ).current;

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const fid = currentFolder.id;
      const fqs = fid ? `?parentId=${fid}` : '';
      const uqs = fid ? `?folderId=${fid}` : '';
      const [fRes, uRes] = await Promise.all([
        apiFetch<FileFolderMeta[]>(`/api/file-folders${fqs}`),
        apiFetch<UploadFileMeta[]>(`/api/files${uqs}`),
      ]);
      console.log('[files] folderId:', fid);
      console.log('[files] folders result:', JSON.stringify(fRes));
      console.log('[files] files result:', JSON.stringify(uRes));
      setOffline([fRes, uRes].every((r) => !r.ok && (r as { status?: number }).status === 0));
      const filesOk = isOk(uRes);
      setFetchError(filesOk ? null : `Could not load files (${(uRes as {status?:number}).status})`);
      setFolders(isOk(fRes) ? fRes.data : []);
      setFiles(filesOk && Array.isArray(uRes.data) ? uRes.data : []);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [currentFolder.id]);

  const commitPendingDelete = useCallback(() => {
    if (deleteTimerRef.current) { clearTimeout(deleteTimerRef.current); deleteTimerRef.current = null; }
    const target = pendingDeleteRef.current;
    if (target) {
      pendingDeleteRef.current = null;
      setPendingDelete(null);
      if (target.type === 'file') deleteFile(target.item.id);
      else if (target.type === 'folder') deleteFileFolder(target.item.id);
      else Promise.all(target.items.map((f) => deleteFile(f.id)));
    }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
    return () => { commitPendingDelete(); };
  }, [load, commitPendingDelete]));

  // Background sync: cache every image in the current folder as it loads.
  // Runs sequentially so we don't hammer the Tor circuit. Each file that
  // finishes immediately updates the grid thumbnail via localUris.
  useEffect(() => {
    if (!files.length || !baseUrl || !token) return;
    let cancelled = false;
    (async () => {
      for (const file of files) {
        if (cancelled) break;
        if (!file.mimeType.startsWith('image/')) continue;
        if (localUris[file.id]) continue; // already cached this session
        try {
          const uri = await getCachedFile(file.id, file.mimeType, fileUrl(file.id, baseUrl, token), token);
          if (!cancelled) setLocalUris((prev) => ({ ...prev, [file.id]: uri }));
        } catch { /* skip — will retry next time */ }
      }
    })();
    return () => { cancelled = true; };
  }, [files, baseUrl, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear selection when folder changes
  useEffect(() => {
    setSelectionMode(false);
    setSelectedFileIds(new Set());
  }, [currentFolder.id]);

  useEffect(() => {
    if (!openFolderId || handledOpenFolderRef.current === openFolderId) return;
    handledOpenFolderRef.current = openFolderId;
    apiFetch<{ id: string; name: string }>(`/api/file-folders/${openFolderId}`).then((res) => {
      if (isOk(res)) setStack([{ id: null, name: 'Files' }, { id: res.data.id, name: res.data.name }]);
    });
  }, [openFolderId]);

  const refresh = async () => {
    setRefreshing(true);
    await load(true);
    setRefreshing(false);
  };

  const enterFolder = (folder: FileFolderMeta) => {
    if (selectionMode) return; // don't navigate while selecting
    setStack((s) => [...s, { id: folder.id, name: folder.name }]);
  };

  const goBack = () => {
    if (stack.length > 1) setStack((s) => s.slice(0, -1));
  };

  // ── Selection ──────────────────────────────────────────────────────────────

  const enterSelectionMode = (file: UploadFileMeta) => {
    setSelectionMode(true);
    setSelectedFileIds(new Set([file.id]));
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedFileIds(new Set());
    setIsDragging(false);
  };

  const selectAll = () => {
    setSelectedFileIds(new Set(sortedFiles.map((f) => f.id)));
  };

  const toggleFileSelection = (file: UploadFileMeta) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(file.id)) next.delete(file.id);
      else next.add(file.id);
      if (next.size === 0) setSelectionMode(false);
      return next;
    });
  };

  // ── Folder / file actions ──────────────────────────────────────────────────

  const handleCreateFolder = async () => {
    if (!folderName.trim()) return;
    setFolderCreating(true);
    if (renamingFile) {
      await renameFile(renamingFile.id, folderName.trim());
    } else if (renamingFolder) {
      await renameFileFolder(renamingFolder.id, folderName.trim());
    } else {
      await createFileFolder(folderName.trim(), currentFolder.id);
    }
    setFolderCreating(false);
    setFolderModalVisible(false);
    setFolderName('');
    setRenamingFolder(null);
    setRenamingFile(null);
    await load();
  };

  const UNDO_DELAY = 8000;

  const handleDeleteFile = useCallback((file: UploadFileMeta) => {
    commitPendingDelete();
    setFiles((prev) => prev.filter((f) => f.id !== file.id));
    const target: PendingDelete = { type: 'file', item: file };
    pendingDeleteRef.current = target;
    setPendingDelete(target);
    deleteTimerRef.current = setTimeout(() => {
      pendingDeleteRef.current = null;
      setPendingDelete(null);
      deleteTimerRef.current = null;
      deleteFile(file.id);
    }, UNDO_DELAY);
  }, [commitPendingDelete]);

  const handleDeleteFolder = useCallback((folder: FileFolderMeta) => {
    commitPendingDelete();
    setFolders((prev) => prev.filter((f) => f.id !== folder.id));
    const target: PendingDelete = { type: 'folder', item: folder };
    pendingDeleteRef.current = target;
    setPendingDelete(target);
    deleteTimerRef.current = setTimeout(() => {
      pendingDeleteRef.current = null;
      setPendingDelete(null);
      deleteTimerRef.current = null;
      deleteFileFolder(folder.id);
    }, UNDO_DELAY);
  }, [commitPendingDelete]);

  const deleteSelected = useCallback(() => {
    const toDelete = files.filter((f) => selectedFileIds.has(f.id));
    if (!toDelete.length) return;
    exitSelectionMode();
    commitPendingDelete();
    setFiles((prev) => prev.filter((f) => !selectedFileIds.has(f.id)));
    const target: PendingDelete = { type: 'files', items: toDelete };
    pendingDeleteRef.current = target;
    setPendingDelete(target);
    deleteTimerRef.current = setTimeout(() => {
      pendingDeleteRef.current = null;
      setPendingDelete(null);
      deleteTimerRef.current = null;
      Promise.all(toDelete.map((f) => deleteFile(f.id)));
    }, UNDO_DELAY);
  }, [files, selectedFileIds, commitPendingDelete]);

  const undoDelete = useCallback(() => {
    if (deleteTimerRef.current) { clearTimeout(deleteTimerRef.current); deleteTimerRef.current = null; }
    const target = pendingDeleteRef.current;
    if (!target) return;
    pendingDeleteRef.current = null;
    setPendingDelete(null);
    if (target.type === 'file') setFiles((prev) => [...prev, target.item as UploadFileMeta]);
    else if (target.type === 'folder') setFolders((prev) => [...prev, target.item as FileFolderMeta]);
    else setFiles((prev) => [...prev, ...(target as { type: 'files'; items: UploadFileMeta[] }).items]);
  }, []);

  const handleRenameFolder = (folder: FileFolderMeta) => {
    setRenamingFolder(folder);
    setFolderName(folder.name);
    setFolderModalVisible(true);
  };

  const openFile = useCallback(async (file: UploadFileMeta) => {
    if (!baseUrl) return;
    if (!file.mimeType.startsWith('image/')) {
      Alert.alert(
        file.originalName || 'File',
        `${fileKind(file.mimeType)} · ${formatBytes(file.size)}\n\nThis file type can only be downloaded. File download support coming soon.`,
      );
      return;
    }
    setViewerFile(file);
    setViewerUri(null);
    setViewerError(null);
    setViewerLoading(true);
    try {
      // If already synced this session, use it directly — no disk check needed
      const localUri = localUris[file.id]
        ?? await getCachedFile(file.id, file.mimeType, fileUrl(file.id, baseUrl, token), token);
      setViewerUri(localUri);
      if (!localUris[file.id]) setLocalUris((prev) => ({ ...prev, [file.id]: localUri }));
    } catch (e) {
      setViewerError(e instanceof Error ? e.message : 'Could not load file');
    } finally {
      setViewerLoading(false);
    }
  }, [baseUrl, token, localUris]);

  const handleRenameFile = (file: UploadFileMeta) => {
    setRenamingFile(file);
    setFolderName(file.originalName);
    setFolderModalVisible(true);
  };

  const openMovePicker = (type: 'file' | 'folder', item: UploadFileMeta | FileFolderMeta) => {
    setMoveTarget({ type, item });
    setMovePickerStack([{ id: null, name: 'Files' }]);
    setMovePickerFolders([]);
    setMoveModalVisible(true);
  };

  const openMovePickerForSelection = () => {
    setMoveTarget(null);
    setMovePickerStack([{ id: null, name: 'Files' }]);
    setMovePickerFolders([]);
    setMoveModalVisible(true);
  };

  const loadMovePickerFolders = useCallback(async (parentId: string | null) => {
    setMovePickerLoading(true);
    const f = await listFileFolders(parentId);
    setMovePickerFolders(f);
    setMovePickerLoading(false);
  }, []);

  useEffect(() => {
    if (moveModalVisible) {
      const current = movePickerStack[movePickerStack.length - 1];
      loadMovePickerFolders(current.id);
    }
  }, [moveModalVisible, movePickerStack, loadMovePickerFolders]);

  const handleMove = async (folderId: string | null) => {
    if (selectionMode && selectedFileIds.size > 0) {
      const ids = Array.from(selectedFileIds);
      const results = await Promise.all(ids.map((id) => moveFile(id, folderId)));
      if (results.every(Boolean)) {
        setMoveModalVisible(false);
        exitSelectionMode();
        load();
      } else {
        Alert.alert('Some moves failed', 'Could not move all selected files.');
      }
    } else if (moveTarget) {
      const ok = moveTarget.type === 'folder'
        ? await moveFolderTo(moveTarget.item.id, folderId)
        : await moveFile(moveTarget.item.id, folderId);
      if (ok) {
        setMoveModalVisible(false);
        setMoveTarget(null);
        load();
      } else {
        Alert.alert('Move failed', 'Could not move the item. It may be a circular folder reference.');
      }
    }
  };

  const pickFromLibrary = async () => {
    setUploadModalVisible(false);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow access to your photo library to upload files.'); return; }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 1,
      allowsMultipleSelection: true,
    });
    if (picked.canceled || picked.assets.length === 0) return;
    setUploading(true);
    let failed = 0;
    let lastError = '';
    for (const asset of picked.assets) {
      const name = asset.fileName ?? `upload.${asset.mimeType?.split('/')[1] ?? 'jpg'}`;
      const uploadResult = await uploadFile(asset.uri, name, asset.mimeType ?? 'image/jpeg', currentFolder.id);
      if (!uploadOk(uploadResult)) { failed++; lastError = uploadResult.error; }
    }
    setUploading(false);
    if (failed > 0) {
      Alert.alert('Upload failed', `${failed} file${failed > 1 ? 's' : ''} could not be uploaded.\n\n${lastError}`);
    }
    await load();
  };

  const pickDocument = async () => {
    setUploadModalVisible(false);
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
    if (result.canceled || result.assets.length === 0) return;
    setUploading(true);
    let failed = 0;
    let lastError = '';
    for (const asset of result.assets) {
      const uploadResult = await uploadFile(asset.uri, asset.name, asset.mimeType ?? 'application/octet-stream', currentFolder.id);
      if (!uploadOk(uploadResult)) { failed++; lastError = uploadResult.error; }
    }
    setUploading(false);
    if (failed > 0) {
      Alert.alert('Upload failed', `${failed} file${failed > 1 ? 's' : ''} could not be uploaded.\n\n${lastError}`);
    }
    await load();
  };

  const takePhoto = async () => {
    setUploadModalVisible(false);
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permission needed', 'Allow camera access to take photos.'); return; }
    const photo = await ImagePicker.launchCameraAsync({ quality: 1 });
    if (photo.canceled || !photo.assets[0]) return;
    const asset = photo.assets[0];
    const name = asset.fileName ?? `photo_${Date.now()}.jpg`;
    setUploading(true);
    const uploadResult = await uploadFile(asset.uri, name, asset.mimeType ?? 'image/jpeg', currentFolder.id);
    setUploading(false);
    if (!uploadOk(uploadResult)) {
      Alert.alert('Upload failed', uploadResult.error);
      return;
    }
    await load();
  };

  const setSort = (field: SortField) => {
    const newDir: SortDir = field === sortField && sortDir === 'asc' ? 'desc' : 'asc';
    setSortField(field);
    setSortDir(newDir);
    setSortModalVisible(false);
  };

  const sortedFolders = sortFolders(folders, sortField, sortDir);
  const sortedFiles = sortFiles(files, sortField, sortDir);
  const allSelected = sortedFiles.length > 0 && selectedFileIds.size === sortedFiles.length;

  // Keep drag-select refs in sync with latest computed values
  sortedFilesRef.current = sortedFiles;
  cellSizeRef.current = (screenWidth - 4) / 3;
  if (sortedFolders.length === 0) foldersSectionHeightRef.current = 0;

  // Build combined list data for FlatList (list mode)
  type ListItem =
    | { type: 'sectionHeader'; title: string }
    | { type: 'folder'; data: FileFolderMeta }
    | { type: 'file'; data: UploadFileMeta };

  const listData: ListItem[] = [];
  if (sortedFolders.length > 0) {
    listData.push({ type: 'sectionHeader', title: 'Folders' });
    sortedFolders.forEach((f) => listData.push({ type: 'folder', data: f }));
  }
  if (sortedFiles.length > 0) {
    if (sortedFolders.length > 0) listData.push({ type: 'sectionHeader', title: 'Files' });
    sortedFiles.forEach((f) => listData.push({ type: 'file', data: f }));
  }

  const GRID_COLS = 3;
  const gridRows: (UploadFileMeta | null)[][] = [];
  for (let i = 0; i < sortedFiles.length; i += GRID_COLS) {
    const row: (UploadFileMeta | null)[] = sortedFiles.slice(i, i + GRID_COLS);
    while (row.length < GRID_COLS) row.push(null);
    gridRows.push(row);
  }

  const pendingDeleteMsg = pendingDelete
    ? pendingDelete.type === 'files'
      ? `${pendingDelete.items.length} file${pendingDelete.items.length !== 1 ? 's' : ''} deleted`
      : pendingDelete.type === 'file'
      ? `"${(pendingDelete.item as UploadFileMeta).originalName}" deleted`
      : `"${(pendingDelete.item as FileFolderMeta).name}" deleted`
    : '';

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        {selectionMode ? (
          <>
            <View style={styles.breadcrumb}>
              <Text style={styles.headerTitle}>{selectedFileIds.size} selected</Text>
            </View>
            <TouchableOpacity onPress={allSelected ? exitSelectionMode : selectAll} style={styles.cancelSelectionBtn}>
              <Text style={styles.cancelSelectionText}>{allSelected ? 'Deselect All' : 'Select All'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={exitSelectionMode} style={styles.cancelSelectionBtn}>
              <Text style={styles.cancelSelectionText}>Cancel</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
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
              <TouchableOpacity onPress={() => setSortModalVisible(true)} style={styles.iconBtn}>
                <Text style={[styles.iconBtnText, { fontSize: 15 }]}>⇅</Text>
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
          </>
        )}
      </View>

      {offline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>⚠ Can't reach server — any changes will sync when you reconnect.</Text>
        </View>
      )}
      {fetchError && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>⚠ {fetchError}</Text>
        </View>
      )}

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
          style={{ flex: 1 }}
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
              const countStr = count === 0 ? 'Empty' : `${count} item${count !== 1 ? 's' : ''}`;
              const dateStr = sortField === 'created' ? formatDate(f.createdAt) : formatDate(f.updatedAt);
              return (
                <TouchableOpacity
                  style={[styles.listRow, selectionMode && styles.listRowDimmed]}
                  onPress={() => enterFolder(f)}
                  onLongPress={() => {
                    if (selectionMode) return;
                    Alert.alert(f.name, '', [
                      { text: 'Rename', onPress: () => handleRenameFolder(f) },
                      { text: 'Move to…', onPress: () => openMovePicker('folder', f) },
                      { text: 'Delete', style: 'destructive', onPress: () => handleDeleteFolder(f) },
                      { text: 'Cancel', style: 'cancel' },
                    ]);
                  }}
                >
                  <Text style={styles.listIcon}>📁</Text>
                  <View style={styles.listInfo}>
                    <Text style={styles.listName} numberOfLines={1}>{f.name}</Text>
                    <Text style={styles.listMeta}>Folder · {countStr}</Text>
                  </View>
                  <Text style={styles.listDate}>{dateStr}</Text>
                  <Text style={styles.chevron}>›</Text>
                </TouchableOpacity>
              );
            }
            // file row
            const f = item.data;
            const isImg = f.mimeType.startsWith('image/');
            const isSelected = selectedFileIds.has(f.id);
            const dateStr = sortField === 'created' ? formatDate(f.createdAt) : formatDate(f.updatedAt);
            return (
              <TouchableOpacity
                style={[styles.listRow, isSelected && styles.listRowSelected]}
                onPress={() => selectionMode ? toggleFileSelection(f) : openFile(f)}
                onLongPress={() => {
                  if (selectionMode) { toggleFileSelection(f); return; }
                  enterSelectionMode(f);
                }}
              >
                {selectionMode ? (
                  <View style={[styles.checkbox, isSelected && styles.checkboxChecked]}>
                    {isSelected && <Text style={styles.checkboxTick}>✓</Text>}
                  </View>
                ) : localUris[f.id] ? (
                  <Image source={{ uri: localUris[f.id] }} style={styles.listThumb} />
                ) : (
                  <Text style={styles.listIcon}>{fileEmoji(f.mimeType)}</Text>
                )}
                <View style={styles.listInfo}>
                  <Text style={styles.listName} numberOfLines={1}>{f.originalName}</Text>
                  <Text style={styles.listMeta}>{fileKind(f.mimeType)} · {formatBytes(f.size)}</Text>
                </View>
                <Text style={styles.listDate}>{dateStr}</Text>
              </TouchableOpacity>
            );
          }}
        />
      ) : (
        // Grid mode — wrapped in a View that owns the drag-to-select PanResponder
        <View
          ref={gridWrapperRef}
          style={{ flex: 1 }}
          onLayout={() => {
            gridWrapperRef.current?.measureInWindow((_, y) => { listTopYRef.current = y; });
          }}
          {...dragPanResponder.panHandlers}
        >
        <FlatList
          style={{ flex: 1 }}
          data={[
            ...(sortedFolders.length > 0 ? [{ type: 'folders' as const }] : []),
            ...gridRows.map((row) => ({ type: 'gridRow' as const, row })),
          ]}
          keyExtractor={(item, i) => `grid-${i}`}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#6366f1" />}
          scrollEnabled={!isDragging}
          onScroll={(e) => { scrollOffsetRef.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
          renderItem={({ item }) => {
            if (item.type === 'folders') {
              return (
                <View onLayout={(e) => { foldersSectionHeightRef.current = e.nativeEvent.layout.height; }}>
                  <Text style={styles.sectionHeader}>Folders</Text>
                  <FlatList
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    data={sortedFolders}
                    keyExtractor={(f) => f.id}
                    contentContainerStyle={{ paddingHorizontal: 12, gap: 10 }}
                    renderItem={({ item: f }) => {
                      const count = f._count.uploads + f._count.children;
                      return (
                        <TouchableOpacity
                          style={[styles.folderCard, selectionMode && styles.folderCardDimmed]}
                          onPress={() => enterFolder(f)}
                          onLongPress={() => {
                            if (selectionMode) return;
                            Alert.alert(f.name, '', [
                              { text: 'Rename', onPress: () => handleRenameFolder(f) },
                              { text: 'Move to…', onPress: () => openMovePicker('folder', f) },
                              { text: 'Delete', style: 'destructive', onPress: () => handleDeleteFolder(f) },
                              { text: 'Cancel', style: 'cancel' },
                            ]);
                          }}
                        >
                          <Text style={styles.folderCardIcon}>📁</Text>
                          <Text style={styles.folderCardName} numberOfLines={2}>{f.name}</Text>
                          <Text style={styles.folderCardCount}>{count === 0 ? 'Empty' : `${count} item${count !== 1 ? 's' : ''}`}</Text>
                        </TouchableOpacity>
                      );
                    }}
                  />
                  {sortedFiles.length > 0 && <Text style={[styles.sectionHeader, { marginTop: 12 }]}>Files</Text>}
                </View>
              );
            }
            // Grid row
            return (
              <View style={styles.gridRow}>
                {item.row.map((file, idx) =>
                  file === null ? (
                    <View key={idx} style={styles.gridCell} />
                  ) : localUris[file.id] ? (
                    <TouchableOpacity
                      key={file.id}
                      style={[styles.gridCell, selectedFileIds.has(file.id) && styles.gridCellSelected]}
                      onPress={() => selectionMode ? toggleFileSelection(file) : openFile(file)}
                      onLongPress={() => {
                        if (selectionMode) { toggleFileSelection(file); return; }
                        enterSelectionMode(file);
                      }}
                    >
                      <Image
                        source={{ uri: localUris[file.id] }}
                        style={styles.gridThumb}
                      />
                      {selectionMode && (
                        <View style={styles.gridCheckOverlay}>
                          <View style={[styles.gridCheckCircle, selectedFileIds.has(file.id) && styles.gridCheckCircleChecked]}>
                            {selectedFileIds.has(file.id) && <Text style={styles.gridCheckTick}>✓</Text>}
                          </View>
                        </View>
                      )}
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      key={file.id}
                      style={[styles.gridCell, styles.gridCellDoc, selectedFileIds.has(file.id) && styles.gridCellSelected]}
                      onPress={() => selectionMode ? toggleFileSelection(file) : openFile(file)}
                      onLongPress={() => {
                        if (selectionMode) { toggleFileSelection(file); return; }
                        enterSelectionMode(file);
                      }}
                    >
                      <Text style={styles.gridDocIcon}>{fileEmoji(file.mimeType)}</Text>
                      <Text style={styles.gridDocName} numberOfLines={2}>{file.originalName}</Text>
                      {selectionMode && (
                        <View style={styles.gridCheckOverlay}>
                          <View style={[styles.gridCheckCircle, selectedFileIds.has(file.id) && styles.gridCheckCircleChecked]}>
                            {selectedFileIds.has(file.id) && <Text style={styles.gridCheckTick}>✓</Text>}
                          </View>
                        </View>
                      )}
                    </TouchableOpacity>
                  )
                )}
              </View>
            );
          }}
        />
        </View>
      )}

      {/* Image viewer */}
      <Modal visible={!!viewerFile} transparent={false} animationType="fade" onRequestClose={closeViewer}>
        <SafeAreaView style={styles.viewerRoot} edges={['top', 'bottom']}>
          <View style={styles.viewerHeader}>
            <TouchableOpacity onPress={closeViewer} style={styles.viewerCloseBtn}>
              <Text style={styles.viewerCloseText}>✕</Text>
            </TouchableOpacity>
            <Text style={styles.viewerTitle} numberOfLines={1}>{viewerFile?.originalName || 'File'}</Text>
            <View style={{ width: 36 }} />
          </View>
          <View style={styles.viewerBody}>
            {viewerLoading ? (
              <ActivityIndicator size="large" color="#6366f1" />
            ) : viewerError ? (
              <Text style={styles.viewerError}>{viewerError}</Text>
            ) : viewerUri ? (
              <Image source={{ uri: viewerUri }} style={styles.viewerImage} resizeMode="contain" />
            ) : null}
          </View>
          {viewerFile && (
            <Text style={styles.viewerMeta}>{fileKind(viewerFile.mimeType)} · {formatBytes(viewerFile.size)}</Text>
          )}
        </SafeAreaView>
      </Modal>

      {/* Sort modal */}
      <Modal visible={sortModalVisible} transparent animationType="slide" onRequestClose={() => setSortModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setSortModalVisible(false)}>
          <Pressable style={styles.uploadSheet} onPress={() => {}}>
            <Text style={styles.uploadSheetTitle}>Sort by</Text>
            {(Object.keys(SORT_LABELS) as SortField[]).map((field) => {
              const active = sortField === field;
              const arrow = active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';
              return (
                <TouchableOpacity key={field} style={styles.sortOption} onPress={() => setSort(field)}>
                  <Text style={[styles.sortOptionText, active && styles.sortOptionActive]}>
                    {SORT_LABELS[field]}{arrow}
                  </Text>
                  {active && <Text style={styles.sortCheck}>✓</Text>}
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={styles.uploadCancel} onPress={() => setSortModalVisible(false)}>
              <Text style={styles.uploadCancelText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

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

      {/* Move picker modal */}
      <Modal visible={moveModalVisible} transparent animationType="slide" onRequestClose={() => setMoveModalVisible(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setMoveModalVisible(false)}>
          <Pressable style={styles.moveSheet} onPress={() => {}}>
            <View style={styles.moveSheetHeader}>
              <Text style={styles.moveSheetTitle}>Move to…</Text>
              {movePickerStack.length > 1 && (
                <TouchableOpacity onPress={() => setMovePickerStack((s) => s.slice(0, -1))}>
                  <Text style={styles.moveSheetBack}>← Back</Text>
                </TouchableOpacity>
              )}
            </View>
            <Text style={styles.moveSheetBreadcrumb} numberOfLines={1}>
              {movePickerStack.map((e) => e.name).join(' / ')}
            </Text>
            {movePickerLoading ? (
              <ActivityIndicator style={{ marginVertical: 24 }} color="#6366f1" />
            ) : (
              <FlatList
                data={movePickerFolders.filter((f) => moveTarget?.type === 'folder' ? f.id !== moveTarget.item.id : true)}
                keyExtractor={(f) => f.id}
                style={{ maxHeight: 280 }}
                ListEmptyComponent={<Text style={styles.moveSheetEmpty}>No subfolders here</Text>}
                renderItem={({ item: f }) => (
                  <TouchableOpacity
                    style={styles.moveSheetRow}
                    onPress={() => setMovePickerStack((s) => [...s, { id: f.id, name: f.name }])}
                  >
                    <Text style={styles.moveSheetRowIcon}>📁</Text>
                    <Text style={styles.moveSheetRowName} numberOfLines={1}>{f.name}</Text>
                    <Text style={styles.moveSheetRowChevron}>›</Text>
                  </TouchableOpacity>
                )}
              />
            )}
            <TouchableOpacity
              style={styles.moveHereBtn}
              onPress={() => handleMove(movePickerStack[movePickerStack.length - 1].id)}
            >
              <Text style={styles.moveHereBtnText}>Move here</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.uploadCancel} onPress={() => setMoveModalVisible(false)}>
              <Text style={styles.uploadCancelText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Selection action bar */}
      {selectionMode && (
        <View style={styles.selectionBar}>
          <TouchableOpacity
            style={[styles.selectionBarBtn, selectedFileIds.size === 0 && styles.selectionBarBtnDisabled]}
            disabled={selectedFileIds.size === 0}
            onPress={openMovePickerForSelection}
          >
            <Text style={[styles.selectionBarBtnText, selectedFileIds.size === 0 && styles.selectionBarBtnTextDisabled]}>
              Move ({selectedFileIds.size})
            </Text>
          </TouchableOpacity>
          <View style={styles.selectionBarDivider} />
          <TouchableOpacity
            style={[styles.selectionBarBtn, selectedFileIds.size === 0 && styles.selectionBarBtnDisabled]}
            disabled={selectedFileIds.size === 0}
            onPress={deleteSelected}
          >
            <Text style={[styles.selectionBarBtnText, styles.selectionBarBtnDelete, selectedFileIds.size === 0 && styles.selectionBarBtnTextDisabled]}>
              Delete ({selectedFileIds.size})
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Undo-delete snackbar */}
      {pendingDelete && (
        <View style={[styles.undoBar, selectionMode && styles.undoBarAboveSelection]}>
          <Text style={styles.undoBarText} numberOfLines={1}>{pendingDeleteMsg}</Text>
          <TouchableOpacity onPress={undoDelete} style={styles.undoBtn}>
            <Text style={styles.undoBtnText}>Undo</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* New folder / rename modal */}
      <Modal visible={folderModalVisible} transparent animationType="fade" onRequestClose={() => { setFolderModalVisible(false); setRenamingFolder(null); setRenamingFile(null); }}>
        <Pressable style={styles.modalOverlay} onPress={() => { setFolderModalVisible(false); setRenamingFolder(null); setRenamingFile(null); }}>
          <Pressable style={styles.folderModal} onPress={() => {}}>
            <Text style={styles.folderModalTitle}>{renamingFile ? 'Rename File' : renamingFolder ? 'Rename Folder' : 'New Folder'}</Text>
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
              <TouchableOpacity onPress={() => { setFolderModalVisible(false); setRenamingFolder(null); setRenamingFile(null); }} style={styles.folderModalCancel}>
                <Text style={styles.folderModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleCreateFolder} style={styles.folderModalCreate} disabled={folderCreating}>
                {folderCreating
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Text style={styles.folderModalCreateText}>{renamingFile || renamingFolder ? 'Rename' : 'Create'}</Text>}
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: c.bg },
    offlineBanner: { backgroundColor: '#7c2d12', paddingHorizontal: 16, paddingVertical: 8 },
    offlineText: { color: '#fdba74', fontSize: 12, fontWeight: '600', lineHeight: 16 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border },
    breadcrumb: { flexDirection: 'row', alignItems: 'center', flex: 1, minWidth: 0 },
    backBtn: { marginRight: 8 },
    backArrow: { color: '#a5b4fc', fontSize: 22, fontWeight: '300' },
    headerTitle: { color: c.tx, fontSize: 18, fontWeight: '700', flexShrink: 1 },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    cancelSelectionBtn: { paddingHorizontal: 6, paddingVertical: 4 },
    cancelSelectionText: { color: '#a5b4fc', fontSize: 15, fontWeight: '600' },
    iconBtn: { padding: 6 },
    iconBtnText: { fontSize: 18 },
    uploadBtn: { backgroundColor: '#6366f1', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, minWidth: 80, alignItems: 'center' },
    uploadBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
    emptyIcon: { fontSize: 64 },
    emptyText: { color: c.tx2, fontSize: 16 },
    emptyBtn: { marginTop: 8, backgroundColor: '#6366f1', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
    emptyBtnText: { color: '#fff', fontWeight: '600' },
    sectionHeader: { color: c.tx3, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginHorizontal: 16, marginTop: 16, marginBottom: 8 },
    // List view
    listRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border },
    listRowSelected: { backgroundColor: 'rgba(99,102,241,0.1)', borderLeftWidth: 3, borderLeftColor: '#6366f1', paddingLeft: 13 },
    listRowDimmed: { opacity: 0.4 },
    listIcon: { fontSize: 26, width: 36, textAlign: 'center' },
    listThumb: { width: 36, height: 36, borderRadius: 4 },
    listInfo: { flex: 1, marginLeft: 10 },
    listName: { color: c.tx, fontSize: 14, fontWeight: '500' },
    listMeta: { color: c.tx3, fontSize: 12, marginTop: 1 },
    listDate: { color: c.tx3, fontSize: 11, marginLeft: 8, flexShrink: 0 },
    chevron: { color: c.tx2, fontSize: 20 },
    // Checkbox (list mode selection)
    checkbox: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.border, alignItems: 'center', justifyContent: 'center', marginRight: 2, backgroundColor: c.surface },
    checkboxChecked: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
    checkboxTick: { color: '#fff', fontSize: 13, fontWeight: '800', lineHeight: 15 },
    // Grid view
    gridRow: { flexDirection: 'row', paddingHorizontal: 2 },
    gridCell: { flex: 1, aspectRatio: 1, padding: 1 },
    gridCellSelected: { opacity: 0.75 },
    gridThumb: { flex: 1, borderRadius: 2 },
    gridCellDoc: { backgroundColor: c.surface, margin: 1, borderRadius: 6, padding: 8, alignItems: 'center', justifyContent: 'center' },
    gridDocIcon: { fontSize: 28 },
    gridDocName: { color: c.tx2, fontSize: 10, textAlign: 'center', marginTop: 4 },
    // Grid selection overlay
    gridCheckOverlay: { position: 'absolute', top: 5, left: 5 },
    gridCheckCircle: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#fff', backgroundColor: 'rgba(0,0,0,0.35)', alignItems: 'center', justifyContent: 'center' },
    gridCheckCircleChecked: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
    gridCheckTick: { color: '#fff', fontSize: 13, fontWeight: '800', lineHeight: 15 },
    // Folder card (horizontal scroll)
    folderCard: { width: 110, backgroundColor: c.surface, borderRadius: 10, padding: 12, alignItems: 'center' },
    folderCardDimmed: { opacity: 0.4 },
    folderCardIcon: { fontSize: 36, marginBottom: 6 },
    folderCardName: { color: c.tx, fontSize: 12, fontWeight: '600', textAlign: 'center' },
    folderCardCount: { color: c.tx3, fontSize: 11, marginTop: 2 },
    // Selection action bar
    selectionBar: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.border,
      paddingBottom: 28,
    },
    selectionBarBtn: { flex: 1, alignItems: 'center', paddingVertical: 14 },
    selectionBarBtnDisabled: { opacity: 0.4 },
    selectionBarBtnText: { color: '#6366f1', fontSize: 15, fontWeight: '700' },
    selectionBarBtnDelete: { color: '#f87171' },
    selectionBarBtnTextDisabled: {},
    selectionBarDivider: { width: 1, height: 24, backgroundColor: c.border },
    // Modals
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    uploadSheet: { backgroundColor: c.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
    uploadSheetTitle: { color: c.tx, fontSize: 16, fontWeight: '700', textAlign: 'center', marginBottom: 20 },
    uploadOption: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.border },
    uploadOptionIcon: { fontSize: 24, width: 40 },
    uploadOptionText: { color: c.tx, fontSize: 16 },
    uploadCancel: { marginTop: 16, alignItems: 'center' },
    uploadCancelText: { color: c.tx2, fontSize: 15, fontWeight: '600' },
    sortOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: c.border },
    sortOptionText: { color: c.tx, fontSize: 16 },
    sortOptionActive: { color: '#6366f1', fontWeight: '700' },
    sortCheck: { color: '#6366f1', fontSize: 16, fontWeight: '700' },
    // Move sheet
    moveSheet: { backgroundColor: c.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 },
    moveSheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
    moveSheetTitle: { color: c.tx, fontSize: 16, fontWeight: '700' },
    moveSheetBack: { color: '#6366f1', fontSize: 14, fontWeight: '600' },
    moveSheetBreadcrumb: { color: c.tx3, fontSize: 12, marginBottom: 12 },
    moveSheetRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: c.border },
    moveSheetRowIcon: { fontSize: 20, width: 32 },
    moveSheetRowName: { flex: 1, color: c.tx, fontSize: 15 },
    moveSheetRowChevron: { color: c.tx2, fontSize: 20, marginLeft: 8 },
    moveSheetEmpty: { color: c.tx2, fontSize: 14, paddingVertical: 20, textAlign: 'center' },
    moveHereBtn: { marginTop: 16, backgroundColor: '#6366f1', borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
    moveHereBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    folderModal: { backgroundColor: c.surface, borderRadius: 16, padding: 24, marginHorizontal: 32, marginTop: 'auto', marginBottom: 'auto' },
    folderModalTitle: { color: c.tx, fontSize: 16, fontWeight: '700', marginBottom: 16, textAlign: 'center' },
    folderInput: { backgroundColor: c.bg, color: c.tx, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, borderWidth: 1, borderColor: c.border },
    folderModalBtns: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, gap: 10 },
    folderModalCancel: { flex: 1, alignItems: 'center', paddingVertical: 10 },
    folderModalCancelText: { color: c.tx2, fontWeight: '600' },
    folderModalCreate: { flex: 1, backgroundColor: '#6366f1', borderRadius: 8, alignItems: 'center', paddingVertical: 10 },
    folderModalCreateText: { color: '#fff', fontWeight: '700' },
    undoBar: {
      position: 'absolute', bottom: 28, left: 16, right: 16,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: '#1e293b', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12,
      borderWidth: 1, borderColor: '#334155',
      shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
      elevation: 8,
    },
    undoBarAboveSelection: { bottom: 90 },
    undoBarText: { color: '#cbd5e1', fontSize: 13, flex: 1, marginRight: 12 },
    undoBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: 'rgba(99,102,241,0.2)', borderWidth: 1, borderColor: '#6366f1' },
    undoBtnText: { color: '#a5b4fc', fontSize: 13, fontWeight: '700' },
    // Image viewer
    viewerRoot: { flex: 1, backgroundColor: '#000' },
    viewerHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10 },
    viewerCloseBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
    viewerCloseText: { color: '#fff', fontSize: 20, fontWeight: '300' },
    viewerTitle: { flex: 1, color: '#e2e8f0', fontSize: 14, fontWeight: '600', textAlign: 'center' },
    viewerBody: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    viewerImage: { width: '100%', height: '100%' },
    viewerError: { color: '#f87171', fontSize: 14 },
    viewerMeta: { color: '#475569', fontSize: 12, textAlign: 'center', paddingVertical: 10 },
  });
}
