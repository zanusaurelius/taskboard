import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  ScrollView, Modal, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { apiFetch, isConflict, isOk, uploadImage } from '@/lib/api';
import { enqueue, setLastSynced } from '@/lib/offline-db';
import { useVault } from '@/lib/vault-context';
import RichEditor, { type RichEditorRef } from '@/components/RichEditor';
import { BulletListIcon, NumberedListIcon, ImageUploadIcon } from '@/components/ToolbarIcons';
import AttachmentsPanel from '@/components/AttachmentsPanel';
import type { Note, Folder } from '@/lib/types';
import { useThemeColors, type ThemeColors } from '@/lib/theme-context';

type SavedNote = Note & { _title: string };

export default function NoteEditorScreen() {
  const { id, revealToken, fresh } = useLocalSearchParams<{ id: string; revealToken?: string; fresh?: string }>();
  const router = useRouter();
  const isNew = id === 'new';
  // "fresh" = note was just pre-created by the FAB; skip loading spinner and show full UI immediately
  const isFresh = fresh === '1';
  const { masterKey, isUnlocked, encrypt, decrypt } = useVault();
  const colors = useThemeColors();
  const s = makeStyles(colors);

  const [title, setTitle] = useState('');
  const [note, setNote] = useState<SavedNote | null>(null);
  // Fresh notes were just created — we know they're empty, so skip the spinner
  const [loading, setLoading] = useState(!isNew && !isFresh);
  const [savedFlash, setSavedFlash] = useState(false);
  const [starred, setStarred] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderModalVisible, setFolderModalVisible] = useState(false);
  const [editorFocused, setEditorFocused] = useState(false);
  const [editorHeight, setEditorHeight] = useState(300);

  const titleRef = useRef<TextInput>(null);
  const editorRef = useRef<RichEditorRef>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const noteRef = useRef<SavedNote | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const htmlRef = useRef('');  // always-current HTML so save() doesn't need it in deps
  const toolbarHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { noteRef.current = note; }, [note]);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  const flashSaved = useCallback(() => {
    if (flashTimer.current) clearTimeout(flashTimer.current);
    setSavedFlash(true);
    flashTimer.current = setTimeout(() => setSavedFlash(false), 2000);
  }, []);

  const load = useCallback(async () => {
    if (isNew) return;
    const headers: Record<string, string> = revealToken ? { 'x-reveal-token': revealToken } : {};
    const result = await apiFetch<Note>(`/api/notes/${id}`, { headers });
    if (!isOk(result)) { setLoading(false); return; }

    const n = result.data;
    const _title = n.encTitle ? (await decrypt(n.encTitle) ?? n.title) : n.title;
    const rawHtml = n.encContent ? (await decrypt(n.encContent) ?? n.content) : n.content;

    setNote({ ...n, _title });
    setTitle(_title);
    htmlRef.current = rawHtml;
    editorRef.current?.setContent(rawHtml);
    setStarred(n.starred);
    setPinned(n.pinned);
    setFolderId(n.folderId ?? null);
    setLoading(false);
  }, [id, isNew, decrypt, revealToken]);

  useEffect(() => { load(); }, [load, isUnlocked]);

  useEffect(() => {
    apiFetch<Folder[]>('/api/folders').then((r) => { if (isOk(r)) setFolders(r.data); });
  }, []);

  // ── Save ──────────────────────────────────────────────────────────────────────

  const save = useCallback(async (overrideTitle?: string, overrideHtml?: string) => {
    if (savingRef.current) return;
    savingRef.current = true;

    const t = overrideTitle ?? title;
    const html = overrideHtml ?? htmlRef.current;
    const currentNote = noteRef.current;

    // If the note was previously encrypted but the vault has since auto-locked,
    // refuse to silently downgrade it to plaintext.
    const wasEncrypted = !!(noteRef.current?.encTitle || noteRef.current?.encContent);
    if (wasEncrypted && !masterKey) {
      savingRef.current = false;
      Alert.alert(
        'Vault locked',
        'Your vault locked while you were editing. Unlock your vault to save these changes.',
      );
      return;
    }

    const encTitleBlob = masterKey ? await encrypt(t) : null;
    const encContentBlob = masterKey ? await encrypt(html) : null;
    const body = {
      title: encTitleBlob ? '' : t,
      encTitle: encTitleBlob ? JSON.stringify(encTitleBlob) : null,
      content: encContentBlob ? '' : html,
      encContent: encContentBlob ? JSON.stringify(encContentBlob) : null,
    };

    if (isNew) {
      // Don't create an empty note — user may just be moving focus to the editor.
      if (!t.trim() && !html.trim()) { savingRef.current = false; return; }
      const result = await apiFetch<Note>('/api/notes', { method: 'POST', body: JSON.stringify(body) });
      if (isOk(result)) {
        await setLastSynced('note', result.data.id, result.data.updatedAt);
        router.replace(`/note/${result.data.id}`);
      } else if ((result as { status?: number }).status === 0) {
        await enqueue('POST', '/api/notes', body);
        Alert.alert('Saved offline', 'This note will sync when you reconnect.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else {
        Alert.alert('Error', 'Could not save note. Try again.');
      }
    } else {
      const result = await apiFetch<Note>(`/api/notes/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ ...body, clientUpdatedAt: currentNote?.updatedAt }),
      });

      if (isOk(result)) {
        await setLastSynced('note', id, result.data.updatedAt);
        setNote((prev) => prev ? { ...prev, updatedAt: result.data.updatedAt } : prev);
        flashSaved();
      } else if (isConflict(result)) {
        const server = result.serverItem as Note;
        const serverTitle = server.encTitle ? (await decrypt(server.encTitle) ?? server.title) : server.title;
        const serverHtml = server.encContent ? (await decrypt(server.encContent) ?? server.content) : server.content;

        Alert.alert(
          'Conflict',
          `Someone else updated this note.\n\nServer: "${serverTitle}"\nYours: "${t}"`,
          [
            {
              text: 'Keep mine',
              onPress: async () => {
                const eb1 = masterKey ? await encrypt(t) : null;
                const eb2 = masterKey ? await encrypt(html) : null;
                const r2 = await apiFetch<Note>(`/api/notes/${id}`, {
                  method: 'PUT',
                  body: JSON.stringify({
                    title: eb1 ? '' : t, encTitle: eb1 ? JSON.stringify(eb1) : null,
                    content: eb2 ? '' : html, encContent: eb2 ? JSON.stringify(eb2) : null,
                  }),
                });
                if (isOk(r2)) {
                  await setLastSynced('note', id, r2.data.updatedAt);
                  setNote((prev) => prev ? { ...prev, updatedAt: r2.data.updatedAt } : prev);
                  flashSaved();
                }
                savingRef.current = false;
              },
            },
            {
              text: 'Use server version',
              onPress: () => {
                setTitle(serverTitle);
                htmlRef.current = serverHtml;
                editorRef.current?.setContent(serverHtml);
                setNote((prev) => prev ? { ...prev, ...server, _title: serverTitle } : prev);
                savingRef.current = false;
              },
            },
          ],
          { cancelable: false },
        );
        return;
      } else if ((result as { status?: number }).status === 0) {
        await enqueue('PUT', `/api/notes/${id}`, body);
        Alert.alert('Saved offline', 'Changes will sync when you reconnect.');
      } else {
        Alert.alert('Error', 'Could not save note. Try again.');
      }
    }
    savingRef.current = false;
  }, [isNew, id, title, router, masterKey, encrypt, decrypt, flashSaved]);

  const handleEditorChange = useCallback((html: string) => {
    htmlRef.current = html;
    if (contentTimer.current) clearTimeout(contentTimer.current);
    contentTimer.current = setTimeout(() => save(), 800);
  }, [save]);

  const handleTitleChange = useCallback((v: string) => {
    setTitle(v);
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = setTimeout(() => save(v), 800);
  }, [save]);

  const handleTitleBlur = useCallback(() => {
    if (titleTimer.current) { clearTimeout(titleTimer.current); titleTimer.current = null; }
    save();
  }, [save]);

  const handleEditorFocus = useCallback(() => {
    if (toolbarHideTimer.current) clearTimeout(toolbarHideTimer.current);
    setEditorFocused(true);
  }, []);

  const handleEditorBlur = useCallback(() => {
    if (contentTimer.current) { clearTimeout(contentTimer.current); contentTimer.current = null; }
    save();
    toolbarHideTimer.current = setTimeout(() => setEditorFocused(false), 200);
  }, [save]);

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
          if (url) editorRef.current?.insertImage(url);
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
          if (url) editorRef.current?.insertImage(url);
          else Alert.alert('Upload failed', 'Could not upload the image.');
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, []);

  // ── Header actions ───────────────────────────────────────────────────────────

  const handleBack = () => router.back();

  const toggleStar = useCallback(async () => {
    if (!note) return;
    const v = !starred; setStarred(v);
    const r = await apiFetch<Note>(`/api/notes/${id}`, { method: 'PUT', body: JSON.stringify({ starred: v }) });
    if (!isOk(r)) { setStarred(!v); Alert.alert('Error', 'Could not update star.'); }
    else setNote((p) => p ? { ...p, starred: v } : p);
  }, [note, starred, id]);

  const togglePin = useCallback(async () => {
    if (!note) return;
    const v = !pinned; setPinned(v);
    const r = await apiFetch<Note>(`/api/notes/${id}`, { method: 'PUT', body: JSON.stringify({ pinned: v }) });
    if (!isOk(r)) { setPinned(!v); Alert.alert('Error', 'Could not update pin.'); }
    else setNote((p) => p ? { ...p, pinned: v } : p);
  }, [note, pinned, id]);

  const toggleHidden = useCallback(async () => {
    if (!note) return;
    const nowHidden = !note.hidden;
    if (nowHidden && !isUnlocked) {
      Alert.alert('Vault locked', 'Unlock your vault first to vault notes.');
      return;
    }
    let body: Record<string, unknown> = { hidden: nowHidden };
    if (nowHidden && masterKey) {
      const html = htmlRef.current;
      const [eb1, eb2] = await Promise.all([encrypt(title), encrypt(html)]);
      if (!eb1 || !eb2) { Alert.alert('Error', 'Encryption failed.'); return; }
      body = { hidden: true, encTitle: JSON.stringify(eb1), encContent: JSON.stringify(eb2), title: '', content: '' };
    }
    const r = await apiFetch<Note>(`/api/notes/${id}`, {
      method: 'PUT',
      headers: revealToken ? { 'x-reveal-token': revealToken } : {},
      body: JSON.stringify(body),
    });
    if (!isOk(r)) { Alert.alert('Error', 'Could not update note.'); return; }
    setNote((p) => p ? { ...p, hidden: nowHidden } : p);
    if (nowHidden) router.back();
  }, [note, id, isUnlocked, masterKey, title, revealToken, encrypt, router]);

  const handleMoveToFolder = async (newFolderId: string | null) => {
    setFolderModalVisible(false);
    const prev = folderId; setFolderId(newFolderId);
    const r = await apiFetch(`/api/notes/${id}`, { method: 'PUT', body: JSON.stringify({ folderId: newFolderId }) });
    if (!isOk(r)) { setFolderId(prev); Alert.alert('Error', 'Could not move note.'); }
  };

  const handleTrash = () => {
    Alert.alert('Move to trash?', 'You can restore it from the trash.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Trash', style: 'destructive', onPress: async () => {
        const r = await apiFetch(`/api/notes/${id}`, { method: 'DELETE' });
        if (!isOk(r)) { Alert.alert('Error', 'Could not move note to trash.'); return; }
        router.back();
      }},
    ]);
  };

  const handleLockToggle = useCallback(async () => {
    if (!note) return;
    const html = htmlRef.current;
    if (!note.locked) {
      const eb1 = await encrypt(title); const eb2 = await encrypt(html);
      if (!eb1 || !eb2) { Alert.alert('Error', 'Vault not unlocked or encryption failed.'); return; }
      const r = await apiFetch<Note>(`/api/notes/${id}`, {
        method: 'PUT',
        headers: revealToken ? { 'x-reveal-token': revealToken } : {},
        body: JSON.stringify({ locked: true, encTitle: JSON.stringify(eb1), encContent: JSON.stringify(eb2), title: '', content: '' }),
      });
      if (isOk(r)) { setNote((p) => p ? { ...p, locked: true } : p); flashSaved(); }
      else Alert.alert('Error', 'Could not lock note.');
    } else {
      const decTitle = note.encTitle ? await decrypt(note.encTitle) : title;
      const decHtml = note.encContent ? await decrypt(note.encContent) : html;
      if (!decTitle || !decHtml) { Alert.alert('Error', 'Could not decrypt.'); return; }
      const r = await apiFetch<Note>(`/api/notes/${id}`, {
        method: 'PUT',
        headers: revealToken ? { 'x-reveal-token': revealToken } : {},
        body: JSON.stringify({ locked: false, title: decTitle, content: decHtml, encTitle: null, encContent: null }),
      });
      if (isOk(r)) {
        setNote((p) => p ? { ...p, locked: false } : p);
        setTitle(decTitle);
        htmlRef.current = decHtml;
        editorRef.current?.setContent(decHtml);
        flashSaved();
      } else Alert.alert('Error', 'Could not unlock note.');
    }
  }, [note, title, id, encrypt, decrypt, flashSaved, revealToken]);

  if (loading) {
    return <View style={s.center}><ActivityIndicator color="#6366f1" size="large" /></View>;
  }

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={handleBack} style={s.backBtn}>
          <Text style={s.backText}>‹ Notes</Text>
        </TouchableOpacity>

        {/* Saved indicator — absolutely centred so it never shifts the icon row */}
        <Text style={[s.savedText, { opacity: savedFlash ? 1 : 0 }]}>Saved</Text>

        {/* All action icons right-aligned */}
        <View style={s.headerRight}>
          {!isNew && (
            <TouchableOpacity onPress={toggleStar} style={s.iconBtn}>
              <Text style={[s.iconBtnText, starred && s.starActive]}>{starred ? '★' : '☆'}</Text>
            </TouchableOpacity>
          )}
          {!isNew && (
            <TouchableOpacity onPress={togglePin} style={s.iconBtn}>
              <Text style={[s.iconBtnText, !pinned && s.iconDim]}>📌</Text>
            </TouchableOpacity>
          )}
          {!isNew && isUnlocked && (
            <TouchableOpacity onPress={handleLockToggle} style={s.chipBtn}>
              <Text style={s.chipBtnText}>{note?.locked ? 'Unlock' : 'Lock'}</Text>
            </TouchableOpacity>
          )}
          {!isNew && (
            <TouchableOpacity onPress={() => setFolderModalVisible(true)} style={s.iconBtn}>
              <Text style={s.iconBtnText}>📁</Text>
            </TouchableOpacity>
          )}
          {!isNew && (
            <TouchableOpacity onPress={toggleHidden} style={s.iconBtn}>
              <Text style={s.iconBtnText}>{note?.hidden ? '👁' : '🙈'}</Text>
            </TouchableOpacity>
          )}
          {!isNew && (
            <TouchableOpacity onPress={handleTrash} style={s.iconBtn}>
              <Text style={[s.iconBtnText, { color: '#ef4444' }]}>🗑</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Folder modal */}
      <Modal visible={folderModalVisible} transparent animationType="fade" onRequestClose={() => setFolderModalVisible(false)}>
        <Pressable style={s.overlay} onPress={() => setFolderModalVisible(false)}>
          <View style={s.folderModal}>
            <Text style={s.folderModalTitle}>Move to folder</Text>
            <TouchableOpacity style={[s.folderOpt, folderId === null && s.folderOptActive]} onPress={() => handleMoveToFolder(null)}>
              <Text style={[s.folderOptText, folderId === null && s.folderOptTextActive]}>No folder</Text>
            </TouchableOpacity>
            {folders.map((f) => (
              <TouchableOpacity key={f.id} style={[s.folderOpt, folderId === f.id && s.folderOptActive]} onPress={() => handleMoveToFolder(f.id)}>
                <Text style={[s.folderOptText, folderId === f.id && s.folderOptTextActive]}>{f.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>

      {/* Editor area — toolbar at bottom (above keyboard) so title stays visible */}
      <KeyboardAvoidingView style={s.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView style={[s.flex, { backgroundColor: colors.surface }]} keyboardShouldPersistTaps="handled">
          {/* Title */}
          <TextInput
            ref={titleRef}
            style={s.titleInput}
            value={title}
            onChangeText={handleTitleChange}
            onBlur={handleTitleBlur}
            placeholder="Title"
            placeholderTextColor="#334155"
            returnKeyType="next"
            onSubmitEditing={() => editorRef.current?.focus()}
            autoFocus={isNew || isFresh}
            multiline={false}
          />
          <View style={s.divider} />

          {/* Rich text editor — renders bold/italic/bullets as actual formatted text */}
          <RichEditor
            ref={editorRef}
            initialContent={htmlRef.current}
            onChange={handleEditorChange}
            onFocus={handleEditorFocus}
            onBlur={handleEditorBlur}
            onHeightChange={setEditorHeight}
            style={[s.editor, { height: editorHeight }]}
          />
          {!isNew && <AttachmentsPanel noteId={id} />}
        </ScrollView>

        {/* Formatting toolbar — sits at the bottom just above the keyboard */}
        {editorFocused && (
          <View style={s.toolbar}>
            <TouchableOpacity style={s.fmtBtn} onPress={() => editorRef.current?.bold()}>
              <Text style={s.fmtBold}>B</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.fmtBtn} onPress={() => editorRef.current?.italic()}>
              <Text style={s.fmtItalic}>I</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.fmtBtn} onPress={() => editorRef.current?.underline()}>
              <Text style={s.fmtUnderline}>U</Text>
            </TouchableOpacity>
            <View style={s.fmtSep} />
            <TouchableOpacity style={s.fmtBtn} onPress={() => editorRef.current?.bulletList()}>
              <BulletListIcon />
            </TouchableOpacity>
            <TouchableOpacity style={s.fmtBtn} onPress={() => editorRef.current?.orderedList()}>
              <NumberedListIcon />
            </TouchableOpacity>
            <View style={s.fmtSep} />
            <TouchableOpacity style={s.fmtBtn} onPress={() => editorRef.current?.code()}>
              <Text style={s.fmtCode}>{'<>'}</Text>
            </TouchableOpacity>
            <View style={s.fmtSep} />
            <TouchableOpacity style={s.fmtBtn} onPress={handleImageUpload}>
              <ImageUploadIcon />
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    flex: { flex: 1 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: c.bg },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderColor: c.border,
    },
    backBtn: { padding: 4 },
    backText: { color: '#6366f1', fontSize: 17 },
    headerRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    iconBtn: { padding: 6 },
    iconBtnText: { fontSize: 19, color: c.tx2 },
    iconDim: { opacity: 0.35 },
    starActive: { color: '#f59e0b' },
    chipBtn: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 7, backgroundColor: 'rgba(99,102,241,0.15)' },
    chipBtnText: { color: '#818cf8', fontSize: 13, fontWeight: '600' },
    savedText: {
      flex: 1, textAlign: 'center',
      color: '#22c55e', fontSize: 13, fontWeight: '600', pointerEvents: 'none',
    },
    toolbar: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: c.surface, borderTopWidth: 1, borderTopColor: c.border,
      paddingHorizontal: 4, paddingVertical: 2,
    },
    fmtBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 6, marginHorizontal: 1 },
    fmtBtnText: { color: c.tx2, fontSize: 14, fontWeight: '600' },
    fmtBold: { color: c.tx, fontSize: 15, fontWeight: '800' },
    fmtItalic: { color: c.tx, fontSize: 15, fontStyle: 'italic', fontWeight: '600' },
    fmtUnderline: { color: c.tx, fontSize: 15, fontWeight: '600', textDecorationLine: 'underline' },
    fmtCode: { color: '#7dd3fc', fontSize: 13, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
    fmtSep: { width: 1, height: 20, backgroundColor: c.border, marginHorizontal: 4 },
    titleInput: {
      color: c.tx, fontSize: 22, fontWeight: '700',
      paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8,
      backgroundColor: c.surface,
    },
    divider: { height: 1, backgroundColor: c.border, marginHorizontal: 20, marginBottom: 4 },
    editor: { backgroundColor: c.surface },
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
    folderModal: { backgroundColor: c.surface, borderRadius: 16, padding: 20, width: '80%', gap: 4, borderWidth: 1, borderColor: c.border },
    folderModalTitle: { color: c.tx, fontSize: 16, fontWeight: '700', marginBottom: 8 },
    folderOpt: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10 },
    folderOptActive: { backgroundColor: 'rgba(99,102,241,0.2)' },
    folderOptText: { color: c.tx2, fontSize: 15, fontWeight: '600' },
    folderOptTextActive: { color: '#a5b4fc' },
  });
}
