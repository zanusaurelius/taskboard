import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, ActivityIndicator, RefreshControl,
  ScrollView, Modal, Alert, Platform, Pressable, BackHandler,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { apiFetch, isOk } from '@/lib/api';
import { useVault } from '@/lib/vault-context';
import type { Note, Folder } from '@/lib/types';

type ActiveFilter = 'all' | 'starred' | 'trash' | string; // string = folder id
type SortKey = 'modified' | 'created' | 'title';

function sortNotes(notes: Note[], key: SortKey): Note[] {
  const pinned = notes.filter((n) => n.pinned);
  const rest = notes.filter((n) => !n.pinned);
  const cmp = (a: Note, b: Note): number => {
    if (key === 'modified') return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    if (key === 'created') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    if (key === 'title') return (a.title || '').localeCompare(b.title || '');
    return 0;
  };
  return [...pinned.sort(cmp), ...rest.sort(cmp)];
}

export default function NotesScreen() {
  const { decrypt, encrypt, masterKey, isUnlocked, verifier, unlockWithPassword } = useVault();
  const router = useRouter();

  // Hidden vault notes
  const [revealToken, setRevealToken] = useState<string | null>(null);

  // Clear reveal token when the vault locks so hidden notes stop being visible
  useEffect(() => {
    if (!isUnlocked && revealToken) {
      apiFetch('/api/notes/vault/reveal', { method: 'DELETE' }).catch(() => {});
      setRevealToken(null);
    }
  }, [isUnlocked, revealToken]);
  const [vaultRevealModalVisible, setVaultRevealModalVisible] = useState(false);
  const [vaultRevealPassword, setVaultRevealPassword] = useState('');
  const [vaultRevealLoading, setVaultRevealLoading] = useState(false);
  const eggTapTimes = useRef<number[]>([]);

  const handleHeadingTap = () => {
    const now = Date.now();
    eggTapTimes.current = [...eggTapTimes.current.filter(t => now - t < 2000), now];
    if (eggTapTimes.current.length >= 10) {
      eggTapTimes.current = [];
      if (!verifier) { Alert.alert('No vault', 'Set up a vault first to access hidden notes.'); return; }
      if (revealToken) {
        // Already revealed — hide again
        apiFetch('/api/notes/vault/reveal', { method: 'DELETE' });
        setRevealToken(null);
        return;
      }
      // Prompt vault password to get reveal token
      setVaultRevealModalVisible(true);
    }
  };

  const [notes, setNotes] = useState<Note[]>([]);
  const [trashNotes, setTrashNotes] = useState<Note[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('modified');

  // Multi-select
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const isSelecting = selectedIds.size > 0;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  // Android hardware back button clears selection instead of navigating away
  useEffect(() => {
    if (!isSelecting) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      clearSelection();
      return true;
    });
    return () => sub.remove();
  }, [isSelecting]);

  const hideSelected = useCallback(() => {
    if (!isUnlocked) {
      Alert.alert('Vault locked', 'Unlock your vault first to hide notes.');
      return;
    }
    const ids = [...selectedIds];
    const notesToHide = notes.filter((n) => ids.includes(n.id) && !n.hidden);
    if (notesToHide.length === 0) { clearSelection(); return; }

    Alert.alert(
      `Vault ${notesToHide.length} note${notesToHide.length > 1 ? 's' : ''}?`,
      'Vaulted notes only appear when you enter your vault password.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Hide',
          onPress: async () => {
            const results = await Promise.all(notesToHide.map(async (note) => {
              const body: Record<string, unknown> = { hidden: true };
              if (masterKey) {
                const [eb1, eb2] = await Promise.all([encrypt(note.title), encrypt(note.content)]);
                if (eb1 && eb2) {
                  Object.assign(body, {
                    encTitle: JSON.stringify(eb1), title: '',
                    encContent: JSON.stringify(eb2), content: '',
                  });
                }
              }
              return apiFetch(`/api/notes/${note.id}`, { method: 'PUT', body: JSON.stringify(body) });
            }));
            const succeeded = new Set(
              notesToHide.filter((_, i) => isOk(results[i])).map((n) => n.id)
            );
            if (succeeded.size < notesToHide.length) {
              Alert.alert('Partial error', 'Some notes could not be hidden.');
            }
            if (succeeded.size > 0) {
              setNotes((prev) => prev.filter((n) => !succeeded.has(n.id)));
            }
            clearSelection();
          },
        },
      ]
    );
  }, [selectedIds, notes, isUnlocked, masterKey, encrypt]);

  const deleteSelected = useCallback(() => {
    const ids = [...selectedIds];
    const inTrash = activeFilter === 'trash';
    Alert.alert(
      inTrash ? 'Delete forever?' : `Move ${ids.length} note${ids.length > 1 ? 's' : ''} to trash?`,
      inTrash ? 'This cannot be undone.' : undefined,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: inTrash ? 'Delete' : 'Trash',
          style: 'destructive',
          onPress: async () => {
            const results = await Promise.all(ids.map((id) =>
              apiFetch(`/api/notes/${id}${inTrash ? '?permanent=true' : ''}`, { method: 'DELETE' })
            ));
            const succeeded = new Set(ids.filter((_, i) => isOk(results[i])));
            if (succeeded.size < ids.length) {
              Alert.alert('Partial error', 'Some notes could not be deleted.');
            }
            if (succeeded.size > 0) {
              if (inTrash) {
                setTrashNotes((prev) => prev.filter((n) => !succeeded.has(n.id)));
              } else {
                setNotes((prev) => prev.filter((n) => !succeeded.has(n.id)));
              }
            }
            clearSelection();
          },
        },
      ]
    );
  }, [selectedIds, activeFilter]);

  // Move-to-folder modal
  const [moveTarget, setMoveTarget] = useState<Note | null>(null);
  const [moveModalVisible, setMoveModalVisible] = useState(false);

  // New-folder inline input
  const [newFolderInput, setNewFolderInput] = useState('');
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [creatingFolder, setCreatingFolder] = useState(false);

  const fetchFolders = useCallback(async () => {
    const result = await apiFetch<Folder[]>('/api/folders');
    if (isOk(result)) setFolders(result.data);
  }, []);

  const decryptNote = useCallback(async (n: Note): Promise<Note> => ({
    ...n,
    title: n.encTitle ? (await decrypt(n.encTitle) ?? n.title) : n.title,
    content: n.encContent ? (await decrypt(n.encContent) ?? '') : n.content,
  }), [decrypt]);

  const fetchAndDecrypt = useCallback(async (overrideToken?: string) => {
    const token = overrideToken !== undefined ? overrideToken : revealToken;
    const revealHeaders: Record<string, string> = token ? { 'x-reveal-token': token } : {};
    const [notesResult, trashResult] = await Promise.all([
      apiFetch<Note[]>('/api/notes', { headers: revealHeaders }),
      apiFetch<Note[]>('/api/notes/trash', { headers: revealHeaders }),
    ] as const);
    fetchFolders();
    if (isOk(notesResult)) {
      const decrypted = await Promise.all(notesResult.data.map(decryptNote));
      setNotes(decrypted);
    }
    if (isOk(trashResult)) {
      const decrypted = await Promise.all(trashResult.data.map(decryptNote));
      setTrashNotes(decrypted);
    }
    setLoading(false);
    setRefreshing(false);
  }, [decryptNote, fetchFolders, revealToken]);

  useFocusEffect(useCallback(() => {
    fetchAndDecrypt();
  }, [fetchAndDecrypt, isUnlocked]));

  // Decrypt folder names
  const folderLabel = useCallback(
    (folder: Folder): string => folder.name || '(Unnamed)',
    [],
  );

  // Build filtered list
  const filtered = (() => {
    if (activeFilter === 'trash') {
      let base = trashNotes;
      if (search.trim()) {
        const q = search.toLowerCase();
        base = base.filter(
          (n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q),
        );
      }
      return base;
    }

    let base = notes.filter((n) => !n.deletedAt);

    if (activeFilter === 'starred') {
      base = base.filter((n) => n.starred);
    } else if (activeFilter !== 'all') {
      base = base.filter((n) => n.folderId === activeFilter);
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      base = base.filter(
        (n) => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q),
      );
    }

    return sortNotes(base, sortKey);
  })();

  const handleCreateFolder = async () => {
    const name = newFolderInput.trim();
    if (!name) return;
    setCreatingFolder(true);
    const result = await apiFetch('/api/folders', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    setCreatingFolder(false);
    if (isOk(result)) {
      setNewFolderInput('');
      setShowNewFolderInput(false);
      await fetchFolders();
    }
  };

  const handleNewFolderChip = () => {
    if (Platform.OS === 'ios') {
      Alert.prompt(
        'New Folder',
        'Enter a name for the folder',
        async (name) => {
          if (!name?.trim()) return;
          const result = await apiFetch('/api/folders', {
            method: 'POST',
            body: JSON.stringify({ name: name.trim() }),
          });
          if (isOk(result)) await fetchFolders();
        },
        'plain-text',
      );
    } else {
      setShowNewFolderInput(true);
    }
  };

  const handleMoveNote = async (note: Note, folderId: string | null) => {
    const result = await apiFetch(`/api/notes/${note.id}`, {
      method: 'PUT',
      body: JSON.stringify({ folderId }),
    });
    if (!isOk(result)) {
      Alert.alert('Error', 'Could not move note. Please try again.');
      return;
    }
    setMoveModalVisible(false);
    setMoveTarget(null);
    await fetchAndDecrypt();
  };

  const restoreNote = useCallback(async (noteId: string) => {
    const noteToRestore = trashNotes.find((n) => n.id === noteId);
    const result = await apiFetch(`/api/notes/${noteId}/restore`, { method: 'POST' });
    if (isOk(result)) {
      setTrashNotes((prev) => prev.filter((n) => n.id !== noteId));
      if (noteToRestore) {
        setNotes((prev) => [{ ...noteToRestore, deletedAt: null }, ...prev]);
      }
    } else {
      Alert.alert('Error', 'Could not restore note.');
    }
  }, [trashNotes]);

  const deleteForever = useCallback(async (noteId: string) => {
    Alert.alert('Delete forever?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          const result = await apiFetch(`/api/notes/${noteId}?permanent=true`, { method: 'DELETE' });
          if (isOk(result)) {
            setTrashNotes((prev) => prev.filter((n) => n.id !== noteId));
          } else {
            Alert.alert('Error', 'Could not delete note.');
          }
        },
      },
    ]);
  }, []);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color="#6366f1" size="large" /></View>;
  }

  const submitVaultReveal = async () => {
    if (!vaultRevealPassword || !verifier) return;
    setVaultRevealLoading(true);
    // Re-verify the typed password by re-deriving the master key.
    // unlockWithPassword calls decryptMasterKey (AES-GCM) which throws on wrong password.
    const unlockResult = await unlockWithPassword(vaultRevealPassword);
    if (unlockResult !== 'ok') {
      setVaultRevealLoading(false);
      setVaultRevealPassword('');
      Alert.alert('Incorrect password', 'Could not reveal hidden notes.');
      return;
    }
    const res = await apiFetch<{ token: string }>('/api/notes/vault/reveal', {
      method: 'POST',
      body: JSON.stringify({ verifier }),
    });
    setVaultRevealLoading(false);
    if (isOk(res)) {
      setRevealToken(res.data.token);
      setVaultRevealModalVisible(false);
      setVaultRevealPassword('');
      // Fetch immediately with the new token (don't rely on stale closure)
      fetchAndDecrypt(res.data.token);
    } else {
      setVaultRevealPassword('');
      Alert.alert('Incorrect password', 'Could not reveal hidden notes.');
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={handleHeadingTap} activeOpacity={1}>
          <Text style={styles.heading}>Notes</Text>
        </TouchableOpacity>
        <View style={styles.headerRight}>
          {revealToken && (
            <TouchableOpacity
              style={styles.revealBadge}
              onPress={() => { apiFetch('/api/notes/vault/reveal', { method: 'DELETE' }); setRevealToken(null); }}
            >
              <Text style={styles.revealBadgeText}>👁 Hide vault</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.count}>{activeFilter === 'trash' ? trashNotes.length : notes.length}</Text>
        </View>
      </View>

      {/* Multi-select action bar */}
      {isSelecting && (
        <View style={styles.selectionBar}>
          <TouchableOpacity onPress={clearSelection} style={styles.selectionCancel}>
            <Text style={styles.selectionCancelText}>✕</Text>
          </TouchableOpacity>
          <Text style={styles.selectionCount}>{selectedIds.size} selected</Text>
          <View style={styles.selectionActions}>
            {activeFilter !== 'trash' && (
              <TouchableOpacity onPress={hideSelected} style={styles.selectionHide}>
                <Text style={styles.selectionHideText}>Vault</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={deleteSelected} style={styles.selectionDelete}>
              <Text style={styles.selectionDeleteText}>{activeFilter === 'trash' ? 'Delete forever' : 'Trash'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Search bar */}
      {!isSelecting && (
        <View style={styles.searchWrap}>
          <TextInput
            style={styles.search}
            placeholder="Search notes…"
            placeholderTextColor="#475569"
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
          />
        </View>
      )}

      {/* Filter chip row: All, Starred, folders, Trash */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chipContent}
      >
        <TouchableOpacity
          style={[styles.chip, activeFilter === 'all' && styles.chipActive]}
          onPress={() => setActiveFilter('all')}
        >
          <Text style={[styles.chipText, activeFilter === 'all' && styles.chipTextActive]}>All</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.chip, activeFilter === 'starred' && styles.chipActive]}
          onPress={() => setActiveFilter('starred')}
        >
          <Text style={[styles.chipText, activeFilter === 'starred' && styles.chipTextActive]}>Starred</Text>
        </TouchableOpacity>

        {folders.map((folder) => (
          <TouchableOpacity
            key={folder.id}
            style={[styles.chip, activeFilter === folder.id && styles.chipActive]}
            onPress={() => setActiveFilter(folder.id)}
          >
            <Text style={[styles.chipText, activeFilter === folder.id && styles.chipTextActive]}>
              {folderLabel(folder)}
            </Text>
          </TouchableOpacity>
        ))}

        <TouchableOpacity
          style={[styles.chip, activeFilter === 'trash' && styles.chipTrashActive]}
          onPress={() => setActiveFilter(activeFilter === 'trash' ? 'all' : 'trash')}
        >
          <Text style={[styles.chipText, activeFilter === 'trash' && styles.chipTextActive]}>
            Trash{trashNotes.length > 0 ? ` (${trashNotes.length})` : ''}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.chip, styles.chipNew]} onPress={handleNewFolderChip}>
          <Text style={styles.chipNewText}>＋ New Folder</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Sort row: always visible, visually separated */}
      {activeFilter !== 'trash' && (
        <View style={styles.sortRow}>
          <Text style={styles.sortLabel}>Sort:</Text>
          {([
            { key: 'modified' as SortKey, label: 'Modified' },
            { key: 'created' as SortKey, label: 'Created' },
            { key: 'title' as SortKey, label: 'Title' },
          ] as const).map((opt) => (
            <TouchableOpacity
              key={opt.key}
              style={[styles.sortChip, sortKey === opt.key && styles.sortChipActive]}
              onPress={() => setSortKey(opt.key)}
            >
              <Text style={[styles.sortChipText, sortKey === opt.key && styles.sortChipTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Android new-folder inline input */}
      {showNewFolderInput && (
        <View style={styles.newFolderRow}>
          <TextInput
            style={styles.newFolderInput}
            placeholder="Folder name…"
            placeholderTextColor="#475569"
            value={newFolderInput}
            onChangeText={setNewFolderInput}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={handleCreateFolder}
          />
          <TouchableOpacity
            style={styles.newFolderConfirm}
            onPress={handleCreateFolder}
            disabled={creatingFolder}
          >
            <Text style={styles.newFolderConfirmText}>
              {creatingFolder ? '…' : 'Add'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.newFolderCancel}
            onPress={() => { setShowNewFolderInput(false); setNewFolderInput(''); }}
          >
            <Text style={styles.newFolderCancelText}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={filtered}
        keyExtractor={(n) => n.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); fetchAndDecrypt(); }}
            tintColor="#6366f1"
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}><Text style={styles.emptyText}>No notes yet</Text></View>
        }
        renderItem={({ item }) => (
          activeFilter === 'trash' ? (
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.title || '(Untitled)'}
                </Text>
              </View>
              <Text style={styles.cardSnippet} numberOfLines={2}>
                {item.content
                  ? item.content.replace(/<[^>]+>/g, '').slice(0, 120)
                  : 'No content'}
              </Text>
              <Text style={styles.cardDate}>
                {new Date(item.updatedAt).toLocaleDateString()}
              </Text>
              <View style={styles.trashActions}>
                <TouchableOpacity style={styles.restoreBtn} onPress={() => restoreNote(item.id)}>
                  <Text style={styles.restoreBtnText}>Restore</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteForeverBtn} onPress={() => deleteForever(item.id)}>
                  <Text style={styles.deleteForeverBtnText}>Delete forever</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.card}
              activeOpacity={0.7}
              onPress={() => {
                if (isSelecting) { toggleSelect(item.id); return; }
                router.push(item.hidden && revealToken
                  ? { pathname: `/note/${item.id}`, params: { revealToken } }
                  : `/note/${item.id}`);
              }}
              onLongPress={() => { toggleSelect(item.id); }}
              delayLongPress={400}
            >
              <View style={styles.cardTitleRow}>
                {isSelecting && (
                  <View style={[styles.checkbox, selectedIds.has(item.id) && styles.checkboxSelected]}>
                    {selectedIds.has(item.id) && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                )}
                <Text style={styles.cardTitle} numberOfLines={1}>
                  {item.title || '(Untitled)'}
                </Text>
                <View style={styles.cardBadges}>
                  {item.starred && <Text style={styles.starBadge}>★</Text>}
                  {item.pinned && <Text style={styles.pinBadge}>📌</Text>}
                  {item.hidden && <Text style={styles.hiddenBadge}>👁</Text>}
                </View>
              </View>
              <Text style={styles.cardSnippet} numberOfLines={2}>
                {item.content
                  ? item.content.replace(/<[^>]+>/g, '').slice(0, 120)
                  : 'No content'}
              </Text>
              <View style={styles.cardMeta}>
                {item.folderId && folders.find((f) => f.id === item.folderId) && (
                  <Text style={styles.cardFolder}>
                    {folderLabel(folders.find((f) => f.id === item.folderId)!)}
                  </Text>
                )}
                <Text style={[styles.cardDate, item.folderId ? styles.cardDateOffset : null]}>
                  {new Date(item.updatedAt).toLocaleDateString()}
                </Text>
              </View>
            </TouchableOpacity>
          )
        )}
      />

      {/* FAB — hidden in trash view */}
      {activeFilter !== 'trash' && (
        <TouchableOpacity style={styles.fab} onPress={() => router.push('/note/new')} activeOpacity={0.85}>
          <Text style={styles.fabIcon}>+</Text>
        </TouchableOpacity>
      )}

      {/* Move-to-folder modal */}
      <Modal
        visible={moveModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => { setMoveModalVisible(false); setMoveTarget(null); }}
      >
        <Pressable style={styles.modalOverlay} onPress={() => { setMoveModalVisible(false); setMoveTarget(null); }}>
          <Pressable style={styles.bottomSheet} onPress={() => { /* prevent close */ }}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Move to folder</Text>

            <TouchableOpacity
              style={styles.folderOption}
              onPress={() => moveTarget && handleMoveNote(moveTarget, null)}
            >
              <Text style={styles.folderOptionText}>No folder</Text>
            </TouchableOpacity>

            {folders.map((folder) => (
              <TouchableOpacity
                key={folder.id}
                style={[
                  styles.folderOption,
                  moveTarget?.folderId === folder.id && styles.folderOptionActive,
                ]}
                onPress={() => moveTarget && handleMoveNote(moveTarget, folder.id)}
              >
                <Text style={[
                  styles.folderOptionText,
                  moveTarget?.folderId === folder.id && styles.folderOptionTextActive,
                ]}>
                  {folderLabel(folder)}
                </Text>
              </TouchableOpacity>
            ))}

            <TouchableOpacity
              style={styles.sheetCancel}
              onPress={() => { setMoveModalVisible(false); setMoveTarget(null); }}
            >
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Vault reveal password modal (cross-platform) */}
      <Modal visible={vaultRevealModalVisible} transparent animationType="fade" onRequestClose={() => setVaultRevealModalVisible(false)}>
        <View style={styles.vaultOverlay}>
          <View style={styles.vaultCard}>
            <Text style={styles.vaultTitle}>Reveal hidden notes</Text>
            <Text style={styles.vaultSubtitle}>Enter your vault password</Text>
            <TextInput
              style={styles.vaultInput}
              value={vaultRevealPassword}
              onChangeText={setVaultRevealPassword}
              placeholder="Vault password"
              placeholderTextColor="#475569"
              secureTextEntry
              autoFocus
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={submitVaultReveal}
            />
            <View style={styles.vaultActions}>
              <TouchableOpacity style={styles.vaultCancelBtn} onPress={() => { setVaultRevealModalVisible(false); setVaultRevealPassword(''); }}>
                <Text style={styles.vaultCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.vaultConfirmBtn, !vaultRevealPassword && styles.vaultConfirmBtnDisabled]} onPress={submitVaultReveal} disabled={!vaultRevealPassword || vaultRevealLoading}>
                {vaultRevealLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.vaultConfirmText}>Reveal</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0f172a' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f172a' },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 12,
  },
  heading: { color: '#f1f5f9', fontSize: 26, fontWeight: '800' },
  count: { color: '#475569', fontSize: 15, fontWeight: '600' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  revealBadge: { backgroundColor: 'rgba(99,102,241,0.15)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: '#6366f1' },
  revealBadgeText: { color: '#a5b4fc', fontSize: 12, fontWeight: '700' },
  hiddenBadge: { fontSize: 13 },
  vaultOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  vaultCard: { backgroundColor: '#1e293b', borderRadius: 16, padding: 24, width: '100%', maxWidth: 340, borderWidth: 1, borderColor: '#334155' },
  vaultTitle: { color: '#f1f5f9', fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 4 },
  vaultSubtitle: { color: '#64748b', fontSize: 13, textAlign: 'center', marginBottom: 20 },
  vaultInput: { backgroundColor: '#0f172a', borderRadius: 10, borderWidth: 1, borderColor: '#334155', color: '#f1f5f9', fontSize: 15, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 16 },
  vaultActions: { flexDirection: 'row', gap: 10 },
  vaultCancelBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#0f172a', borderWidth: 1, borderColor: '#334155', alignItems: 'center' },
  vaultCancelText: { color: '#64748b', fontSize: 14, fontWeight: '600' },
  vaultConfirmBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: '#6366f1', alignItems: 'center' },
  vaultConfirmBtnDisabled: { opacity: 0.4 },
  vaultConfirmText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // Chip row
  chipScroll: { flexShrink: 0 },
  chipContent: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, gap: 8, flexDirection: 'row', alignItems: 'center' },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, borderWidth: 1, borderColor: '#334155',
    backgroundColor: '#1e293b', alignSelf: 'center',
  },
  chipActive: { borderColor: '#6366f1', backgroundColor: '#312e81' },
  chipText: { color: '#94a3b8', fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: '#a5b4fc' },
  chipNew: { borderStyle: 'dashed', borderColor: '#475569' },
  chipNewText: { color: '#475569', fontSize: 13, fontWeight: '600' },
  chipTrashActive: { borderColor: '#ef4444', backgroundColor: 'rgba(239,68,68,0.12)' },
  sortRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 16, paddingTop: 4, paddingBottom: 8,
  },
  sortLabel: { color: '#475569', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  sortChip: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 12, borderWidth: 1, borderColor: '#1e3a5f',
    backgroundColor: '#0f172a',
  },
  sortChipActive: { borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.15)' },
  sortChipText: { color: '#475569', fontSize: 12, fontWeight: '600' },
  sortChipTextActive: { color: '#93c5fd' },

  // New folder inline (Android)
  newFolderRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingBottom: 8, gap: 8,
  },
  newFolderInput: {
    flex: 1, backgroundColor: '#1e293b', borderRadius: 10,
    borderWidth: 1, borderColor: '#6366f1', color: '#f1f5f9',
    fontSize: 14, paddingHorizontal: 12, paddingVertical: 8,
  },
  newFolderConfirm: {
    backgroundColor: '#6366f1', borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 8,
  },
  newFolderConfirmText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  newFolderCancel: { padding: 8 },
  newFolderCancelText: { color: '#475569', fontSize: 16 },

  searchWrap: { paddingHorizontal: 16, paddingBottom: 10 },
  search: {
    backgroundColor: '#1e293b', borderRadius: 10, borderWidth: 1, borderColor: '#334155',
    color: '#f1f5f9', fontSize: 15, paddingHorizontal: 14, paddingVertical: 10,
  },
  list: { paddingHorizontal: 16, paddingBottom: 100, gap: 10 },
  selectionBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: '#1e293b', borderBottomWidth: 1, borderBottomColor: '#334155',
  },
  selectionCancel: { padding: 4 },
  selectionCancelText: { color: '#94a3b8', fontSize: 16, fontWeight: '600' },
  selectionCount: { color: '#f1f5f9', fontSize: 14, fontWeight: '700' },
  selectionActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  selectionHide: { padding: 4 },
  selectionHideText: { color: '#818cf8', fontSize: 14, fontWeight: '700' },
  selectionDelete: { padding: 4 },
  selectionDeleteText: { color: '#ef4444', fontSize: 14, fontWeight: '700' },
  checkbox: {
    width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#475569',
    marginRight: 10, alignItems: 'center', justifyContent: 'center',
  },
  checkboxSelected: { backgroundColor: '#6366f1', borderColor: '#6366f1' },
  checkmark: { color: '#fff', fontSize: 12, fontWeight: '800' },
  card: {
    backgroundColor: '#1e293b', borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: '#334155', gap: 6,
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardTitle: { color: '#f1f5f9', fontSize: 16, fontWeight: '700', flex: 1 },
  cardBadges: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 6 },
  starBadge: { color: '#f59e0b', fontSize: 14 },
  pinBadge: { fontSize: 13 },
  cardSnippet: { color: '#94a3b8', fontSize: 13, lineHeight: 18 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardFolder: { color: '#6366f1', fontSize: 11, fontWeight: '600', flex: 1 },
  cardDate: { color: '#475569', fontSize: 11 },
  cardDateOffset: { textAlign: 'right' },
  trashActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  restoreBtn: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8,
    backgroundColor: 'rgba(99,102,241,0.15)',
  },
  restoreBtnText: { color: '#6366f1', fontSize: 13, fontWeight: '600' },
  deleteForeverBtn: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8,
    backgroundColor: 'rgba(239,68,68,0.12)',
  },
  deleteForeverBtnText: { color: '#ef4444', fontSize: 13, fontWeight: '600' },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { color: '#475569', fontSize: 15 },
  fab: {
    position: 'absolute', bottom: 28, right: 24,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#6366f1', justifyContent: 'center', alignItems: 'center',
    shadowColor: '#6366f1', shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  fabIcon: { color: '#fff', fontSize: 28, lineHeight: 32 },

  // Move-to-folder modal
  modalOverlay: {
    flex: 1, justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  bottomSheet: {
    backgroundColor: '#1e293b', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingBottom: 36, paddingTop: 12,
    borderTopWidth: 1, borderColor: '#334155',
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2, backgroundColor: '#475569',
    alignSelf: 'center', marginBottom: 16,
  },
  sheetTitle: { color: '#94a3b8', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 },
  folderOption: {
    paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#0f172a',
  },
  folderOptionActive: { borderBottomColor: '#0f172a' },
  folderOptionText: { color: '#f1f5f9', fontSize: 16 },
  folderOptionTextActive: { color: '#818cf8', fontWeight: '700' },
  sheetCancel: {
    marginTop: 8, paddingVertical: 14, alignItems: 'center',
    backgroundColor: '#0f172a', borderRadius: 12,
  },
  sheetCancelText: { color: '#94a3b8', fontSize: 16, fontWeight: '600' },
});
