"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import Divider from "@mui/material/Divider";
import Tooltip from "@mui/material/Tooltip";
import useMediaQuery from "@mui/material/useMediaQuery";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Snackbar from "@mui/material/Snackbar";
import LinearProgress from "@mui/material/LinearProgress";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DeleteSweepIcon from "@mui/icons-material/DeleteSweep";
import RestoreFromTrashIcon from "@mui/icons-material/RestoreFromTrash";
import AddIcon from "@mui/icons-material/Add";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import NoteAltOutlinedIcon from "@mui/icons-material/NoteAltOutlined";
import TaskAltIcon from "@mui/icons-material/TaskAlt";
import SearchIcon from "@mui/icons-material/Search";
import PushPinIcon from "@mui/icons-material/PushPin";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import StarIcon from "@mui/icons-material/Star";
import StarBorderIcon from "@mui/icons-material/StarBorder";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import CreateNewFolderOutlinedIcon from "@mui/icons-material/CreateNewFolderOutlined";
import EditIcon from "@mui/icons-material/Edit";
import DriveFileMoveOutlinedIcon from "@mui/icons-material/DriveFileMoveOutlined";
import CheckIcon from "@mui/icons-material/Check";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import LockOpenOutlinedIcon from "@mui/icons-material/LockOpenOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import ShieldOutlinedIcon from "@mui/icons-material/ShieldOutlined";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { useTaskBoardStore } from "@/lib/store";
import { Note, Folder } from "@/lib/types";
import { VaultProvider, useVault } from "@/lib/vault-context";
import VaultSetupModal from "./VaultSetupModal";
import VaultUnlockModal from "./VaultUnlockModal";

dayjs.extend(relativeTime);

const RichTextEditor = dynamic(() => import("./RichTextEditor"), { ssr: false });

type SortField = "updatedAt" | "createdAt" | "title";
type SortDir = "desc" | "asc";
type FolderFilter = string | null | "all" | "starred";
type DragTarget = "unfiled" | string;

const SORT_LABELS: Record<SortField, string> = { updatedAt: "Modified", createdAt: "Created", title: "Title" };

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
function noteTimestamp(iso: string) {
  const d = dayjs(iso);
  const h = dayjs().diff(d, "hour");
  if (h < 1) return d.fromNow();
  if (h < 24) return d.format("h:mm A");
  if (h < 168) return d.format("ddd");
  return d.format("MMM D");
}
function matchesSearch(n: Note, q: string, decryptedTitle?: string) {
  const lq = q.toLowerCase();
  const titleToSearch = decryptedTitle ?? n.title;
  return titleToSearch.toLowerCase().includes(lq) || stripHtml(n.content).toLowerCase().includes(lq);
}

interface ContextMenu { x: number; y: number; note: Note }
interface Props { onCreateTask: (title: string, description: string) => void }

function NotesViewInner({ onCreateTask }: Props) {
  const {
    notes, folders, trashNotes,
    fetchNotes, fetchFolders, fetchTrash,
    createNote, duplicateNote, updateNote, deleteNote,
    restoreNote, permanentDeleteNote, emptyTrash,
    createFolder, updateFolder, patchFolder, deleteFolder,
  } = useTaskBoardStore();

  const isMobile = useMediaQuery("(max-width: 599px)");
  const [mobilePanel, setMobilePanel] = useState<"list" | "editor">("list");

  // editor
  const [activeId, setActiveId]         = useState<string | null>(null);
  const [localTitle, setLocalTitle]     = useState("");
  const [localContent, setLocalContent] = useState("");
  const [editorKey, setEditorKey]       = useState(0);

  // ui
  const [search, setSearch]             = useState("");
  const [sortField, setSortField]       = useState<SortField>("updatedAt");
  const [sortDir, setSortDir]           = useState<SortDir>("desc");
  const [selectedFolder, setSelectedFolder] = useState<FolderFilter>("all");
  const [contextMenu, setContextMenu]   = useState<ContextMenu | null>(null);
  const [folderCtxMenu, setFolderCtxMenu] = useState<{ folder: Folder; x: number; y: number } | null>(null);
  const [listCtxMenu, setListCtxMenu]   = useState<{ x: number; y: number } | null>(null);

  // hint dialog (shown after locking a note)
  const [hintDialog, setHintDialog] = useState<{ noteId: string } | null>(null);
  const [hintValue, setHintValue]   = useState("");

  // folder management
  const [newFolderMode, setNewFolderMode]       = useState(false);
  const [newFolderName, setNewFolderName]       = useState("");
  const [renamingFolder, setRenamingFolder]     = useState<Folder | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState("");

  // folder section resize / collapse
  const [foldersCollapsed, setFoldersCollapsed] = useState(false);
  const [folderSectionHeight, setFolderSectionHeight] = useState(220);

  // multi-select + drag-drop
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [draggedNoteIds, setDraggedNoteIds]   = useState<string[]>([]);
  const [dragOverTarget, setDragOverTarget]   = useState<DragTarget | null>(null);
  const lastClickedIdRef  = useRef<string | null>(null);
  const sortedNotesRef    = useRef<Note[]>([]);
  const stableOrderRef    = useRef<string[]>([]);
  const prevStableKeyRef  = useRef("");
  const pendingActionRef  = useRef<(() => void) | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Vault ──
  const vault = useVault();
  const { isUnlocked, isRevealed, revealToken, encrypt, decrypt, lockVault, hideVault } = vault;
  // Always-current ref so pending actions don't capture stale encrypt after vault unlock
  const encryptRef = useRef(encrypt);
  encryptRef.current = encrypt;

  const handleCloseVault = () => {
    hideVault();
    lockVault();
  };

  const [vaultExists, setVaultExists] = useState(false);
  const [hasWebAuthn, setHasWebAuthn] = useState(false);
  const [setupModalOpen, setSetupModalOpen] = useState(false);
  const [unlockModalOpen, setUnlockModalOpen] = useState<{ open: boolean; mode: "unlock" | "reveal" }>({ open: false, mode: "unlock" });

  // 30-second undo for locked/hidden note deletion
  const [pendingDelete, setPendingDelete] = useState<{ id: string; label: string } | null>(null);
  const [undoCountdown, setUndoCountdown] = useState(30);
  const pendingDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 30-second undo for hidden/vault folder deletion
  const [pendingFolderDelete, setPendingFolderDelete] = useState<{ id: string; name: string; noteIds: string[] } | null>(null);
  const [folderUndoCountdown, setFolderUndoCountdown] = useState(30);
  const pendingFolderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const folderUndoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Decrypted content cache: noteId -> decrypted content/title
  const [decryptedNotes, setDecryptedNotes] = useState<Map<string, { title: string; content: string }>>(new Map());

  // Easter egg: 10 rapid clicks on "Notes" header
  const eggClickTimes = useRef<number[]>([]);
  const handleNotesHeaderClick = () => {
    const now = Date.now();
    eggClickTimes.current = [...eggClickTimes.current.filter(t => now - t < 2000), now];
    if (eggClickTimes.current.length >= 10) {
      eggClickTimes.current = [];
      if (!vaultExists) { setSetupModalOpen(true); return; }
      setUnlockModalOpen({ open: true, mode: "reveal" });
    }
  };

  const stableFetchNotes = useCallback(fetchNotes, [fetchNotes]);
  const stableFetchFolders = useCallback(fetchFolders, [fetchFolders]);
  const stableFetchTrash = useCallback(fetchTrash, [fetchTrash]);

  useEffect(() => {
    if (isMobile && activeId) setMobilePanel("editor");
  }, [isMobile, activeId]);

  useEffect(() => {
    stableFetchNotes();
    stableFetchFolders();
    stableFetchTrash();
    // Also fetch vault config
    fetch("/api/notes/vault")
      .then(r => r.json())
      .then(data => {
        setVaultExists(data.exists ?? false);
        setHasWebAuthn((data.webAuthnCredentials ?? []).length > 0);
      })
      .catch(() => {});
  }, [stableFetchNotes, stableFetchFolders, stableFetchTrash]);

  // Re-fetch with reveal token when revealed
  useEffect(() => {
    stableFetchNotes(revealToken ?? undefined);
    stableFetchFolders(revealToken ?? undefined);
  }, [revealToken, stableFetchNotes, stableFetchFolders]);

  // Fetch trash when switching to trash view
  useEffect(() => {
    if (selectedFolder === "trash") fetchTrash();
  }, [selectedFolder, fetchTrash]);

  // 30-second countdown for locked/hidden note deletion
  useEffect(() => {
    if (!pendingDelete) return;
    setUndoCountdown(30);
    undoIntervalRef.current = setInterval(() => setUndoCountdown((c) => Math.max(0, c - 1)), 1000);
    pendingDeleteTimerRef.current = setTimeout(async () => {
      await deleteNote(pendingDelete.id);
      setPendingDelete(null);
    }, 30000);
    return () => {
      if (undoIntervalRef.current) clearInterval(undoIntervalRef.current);
      if (pendingDeleteTimerRef.current) clearTimeout(pendingDeleteTimerRef.current);
    };
  }, [pendingDelete?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 30-second countdown for hidden/vault folder deletion
  useEffect(() => {
    if (!pendingFolderDelete) return;
    setFolderUndoCountdown(30);
    folderUndoIntervalRef.current = setInterval(() => setFolderUndoCountdown((c) => Math.max(0, c - 1)), 1000);
    const { id, noteIds } = pendingFolderDelete;
    pendingFolderTimerRef.current = setTimeout(async () => {
      // Delete all notes inside first, then the folder
      await Promise.all(noteIds.map(noteId => deleteNote(noteId)));
      await deleteFolder(id);
      if (selectedFolder === id) setSelectedFolder("all");
      setPendingFolderDelete(null);
    }, 30000);
    return () => {
      if (folderUndoIntervalRef.current) clearInterval(folderUndoIntervalRef.current);
      if (pendingFolderTimerRef.current) clearTimeout(pendingFolderTimerRef.current);
    };
  }, [pendingFolderDelete?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-decrypt locked notes when master key becomes available
  useEffect(() => {
    if (!isUnlocked) {
      setDecryptedNotes(new Map());
      return;
    }
    const lockedNotes = notes.filter(n => n.locked && n.encContent);
    if (lockedNotes.length === 0) return;

    Promise.all(
      lockedNotes.map(async (n) => {
        try {
          const blob = JSON.parse(n.encContent!);
          const content = await decrypt(blob);
          const title = n.encTitle ? await decrypt(JSON.parse(n.encTitle)) : null;
          return { id: n.id, title: title ?? n.title, content: content ?? "" };
        } catch {
          return null;
        }
      })
    ).then(results => {
      const map = new Map<string, { title: string; content: string }>();
      results.forEach(r => { if (r) map.set(r.id, { title: r.title, content: r.content }); });
      setDecryptedNotes(map);
    });
  }, [isUnlocked, notes, decrypt]);

  useEffect(() => {
    if (activeId === null) return;
    const note = notes.find((n) => n.id === activeId);
    if (!note) return;
    // For locked notes that are unlocked, use decrypted content
    if (note.locked && isUnlocked) {
      const dec = decryptedNotes.get(note.id);
      if (dec) {
        setLocalTitle(dec.title);
        setLocalContent(dec.content);
        setEditorKey((k) => k + 1);
        return;
      }
    }
    setLocalTitle(note.title);
    setLocalContent(note.content);
    setEditorKey((k) => k + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // When decrypted notes map updates and we have an active locked note, update local state
  useEffect(() => {
    if (activeId === null) return;
    const note = notes.find((n) => n.id === activeId);
    if (!note?.locked) return;
    const dec = decryptedNotes.get(activeId);
    if (dec) {
      setLocalTitle(dec.title);
      setLocalContent(dec.content);
      setEditorKey((k) => k + 1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decryptedNotes]);

  // ── Auto-save ──
  const flush = (id: string, title: string, content: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const note = notes.find(n => n.id === id);
    if (note?.locked && isUnlocked) {
      (async () => {
        const [encContent, encTitle] = await Promise.all([encrypt(content), encrypt(title || "Untitled")]);
        if (encContent && encTitle) {
          updateNote(id, { content: "", title: "", encContent: JSON.stringify(encContent), encTitle: JSON.stringify(encTitle) });
        }
      })();
      return;
    }
    updateNote(id, { title, content });
  };

  const scheduleAutosave = (id: string, title: string, content: string) => {
    const note = notes.find(n => n.id === id);
    if (note?.locked && isUnlocked) {
      // encrypt before saving
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        const [encContent, encTitle] = await Promise.all([encrypt(content), encrypt(title || "Untitled")]);
        if (encContent && encTitle) {
          updateNote(id, { content: "", title: "", encContent: JSON.stringify(encContent), encTitle: JSON.stringify(encTitle) });
        }
      }, 800);
      return;
    }
    // regular save
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => updateNote(id, { title, content }), 800);
  };

  const handleTitleChange = (val: string) => {
    setLocalTitle(val);
    if (activeId !== null) scheduleAutosave(activeId, val, localContent);
  };
  const handleContentChange = (html: string) => {
    setLocalContent(html);
    if (activeId !== null) scheduleAutosave(activeId, localTitle, html);
  };

  // ── Note actions ──
  const handleNewNote = async () => {
    if (activeId !== null) flush(activeId, localTitle, localContent);
    const note = await createNote();
    if (selectedFolder !== "all" && selectedFolder !== "starred" && selectedFolder !== null) {
      await updateNote(note.id, { folderId: selectedFolder });
    }
    setLocalTitle(""); setLocalContent(""); setEditorKey((k) => k + 1); setActiveId(note.id);
    setSelectedNoteIds(new Set([note.id]));
    lastClickedIdRef.current = note.id;
  };

  const handleSelectNote = (note: Note) => {
    if (note.id === activeId) return;
    if (activeId !== null) flush(activeId, localTitle, localContent);
    setActiveId(note.id);
  };

  const handleNoteClick = (e: React.MouseEvent, note: Note) => {
    // If note is locked and vault is locked, open unlock modal instead of selecting
    if (note.locked && !isUnlocked) {
      setUnlockModalOpen({ open: true, mode: "unlock" });
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      setSelectedNoteIds((prev) => {
        const next = new Set(prev);
        if (next.has(note.id)) next.delete(note.id);
        else next.add(note.id);
        return next;
      });
      lastClickedIdRef.current = note.id;
      return;
    }
    if (e.shiftKey && lastClickedIdRef.current !== null) {
      const ids = sortedNotesRef.current.map((n) => n.id);
      const startIdx = ids.indexOf(lastClickedIdRef.current);
      const endIdx   = ids.indexOf(note.id);
      const [lo, hi] = startIdx <= endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
      setSelectedNoteIds(new Set(ids.slice(lo, hi + 1)));
      return;
    }
    setSelectedNoteIds(new Set([note.id]));
    lastClickedIdRef.current = note.id;
    handleSelectNote(note);
  };

  const startPendingDelete = (note: Note) => {
    // If another pending delete is in flight, flush it immediately
    if (pendingDelete) {
      if (pendingDeleteTimerRef.current) clearTimeout(pendingDeleteTimerRef.current);
      if (undoIntervalRef.current) clearInterval(undoIntervalRef.current);
      deleteNote(pendingDelete.id);
    }
    const label = note.locked
      ? (note.encTitle ? "Locked note" : note.title || "Untitled")
      : (note.title || "Untitled");
    setPendingDelete({ id: note.id, label });
  };

  const handleDelete = async () => {
    if (activeId === null) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const note = notes.find((n) => n.id === activeId);
    if (!note) return;
    setActiveId(null); setLocalTitle(""); setLocalContent("");
    setSelectedNoteIds((prev) => { const next = new Set(prev); next.delete(activeId); return next; });
    if (note.locked || note.hidden) {
      // Remove from view immediately; server delete happens after undo window
      startPendingDelete(note);
    } else {
      await deleteNote(activeId);
    }
  };

  const handlePin = (e: React.MouseEvent, note: Note) => {
    e.stopPropagation();
    updateNote(note.id, { pinned: !note.pinned });
  };
  const handleStar = (e: React.MouseEvent, note: Note) => {
    e.stopPropagation();
    updateNote(note.id, { starred: !note.starred });
  };

  const handleCreateTask = () => {
    if (activeId !== null) flush(activeId, localTitle, localContent);
    onCreateTask(localTitle || "Untitled", localContent);
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir((d) => d === "desc" ? "asc" : "desc");
    else { setSortField(field); setSortDir(field === "title" ? "asc" : "desc"); }
  };

  // ── Drag and drop ──
  const handleNoteDragStart = (e: React.DragEvent, note: Note) => {
    const ids = selectedNoteIds.has(note.id) ? [...selectedNoteIds] : [note.id];
    setDraggedNoteIds(ids);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", JSON.stringify(ids));
    if (ids.length > 1) {
      const el = document.createElement("div");
      el.textContent = `${ids.length} notes`;
      el.style.cssText = "position:absolute;top:-999px;background:#6366f1;color:#fff;padding:4px 10px;border-radius:8px;font-size:12px;font-weight:700;font-family:sans-serif;";
      document.body.appendChild(el);
      e.dataTransfer.setDragImage(el, 0, 0);
      setTimeout(() => document.body.removeChild(el), 0);
    }
  };

  const handleNoteDragEnd = () => {
    setDraggedNoteIds([]);
    setDragOverTarget(null);
  };

  const handleFolderDragOver = (e: React.DragEvent, target: DragTarget) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverTarget(target);
  };

  const handleFolderDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverTarget(null);
    }
  };

  // ── Folder section resize ──
  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = folderSectionHeight;
    const handleMouseMove = (ev: MouseEvent) => {
      const newHeight = Math.max(60, Math.min(600, startHeight + ev.clientY - startY));
      setFolderSectionHeight(newHeight);
    };
    const handleMouseUp = () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  };

  // Move notes to a folder — if target is a vault folder, lock+hide them automatically
  const moveNotesToFolder = async (noteIds: string[], folderId: string | null) => {
    const targetFolder = folderId ? folders.find(f => f.id === folderId) : null;
    const isVaultFolder = !!(targetFolder?.hidden || targetFolder?.locked);

    if (isVaultFolder && !isUnlocked) {
      pendingActionRef.current = () => moveNotesToFolder(noteIds, folderId);
      setUnlockModalOpen({ open: true, mode: "unlock" });
      return;
    }

    await Promise.all(noteIds.map(async (id) => {
      const note = notes.find(n => n.id === id);
      if (!note) return;
      if (isVaultFolder) {
        const updates: Partial<Note> = { folderId, hidden: true };
        if (!note.locked) {
          const [encContent, encTitle] = await Promise.all([
            encryptRef.current(note.content),
            encryptRef.current(note.title || "Untitled"),
          ]);
          if (encContent && encTitle) {
            Object.assign(updates, {
              locked: true, content: "", title: "",
              encContent: JSON.stringify(encContent),
              encTitle: JSON.stringify(encTitle),
            });
          }
        }
        await updateNote(id, updates as Partial<Note>);
      } else {
        await updateNote(id, { folderId });
      }
    }));
  };

  const handleFolderDrop = async (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    setDragOverTarget(null);
    let ids: string[] = [];
    try { ids = JSON.parse(e.dataTransfer.getData("text/plain") || "[]"); } catch { return; }
    if (!Array.isArray(ids) || ids.length === 0) return;
    await moveNotesToFolder(ids, folderId);
    setDraggedNoteIds([]);
  };

  // ── Context menu ──
  const openContextMenu = (e: React.MouseEvent, note: Note) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, note });
  };
  const closeContextMenu = () => setContextMenu(null);

  const ctxPin = () => {
    if (!contextMenu) return;
    const isMulti = selectedNoteIds.has(contextMenu.note.id) && selectedNoteIds.size > 1;
    const ids = isMulti ? Array.from(selectedNoteIds) : [contextMenu.note.id];
    const pin = !contextMenu.note.pinned;
    ids.forEach(id => updateNote(id, { pinned: pin }));
    closeContextMenu();
  };
  const ctxStar = () => {
    if (!contextMenu) return;
    const isMulti = selectedNoteIds.has(contextMenu.note.id) && selectedNoteIds.size > 1;
    const ids = isMulti ? Array.from(selectedNoteIds) : [contextMenu.note.id];
    const star = !contextMenu.note.starred;
    ids.forEach(id => updateNote(id, { starred: star }));
    closeContextMenu();
  };
  const ctxDuplicate = async () => {
    if (!contextMenu) return;
    const isMulti = selectedNoteIds.has(contextMenu.note.id) && selectedNoteIds.size > 1;
    closeContextMenu();
    if (isMulti) {
      const ids = Array.from(selectedNoteIds).filter(id => !notes.find(n => n.id === id)?.locked);
      const results = await Promise.all(ids.map(id => duplicateNote(id)));
      if (results.length > 0) setSelectedNoteIds(new Set(results.map(n => n.id)));
      return;
    }
    if (contextMenu.note.locked) return;
    const n = await duplicateNote(contextMenu.note.id);
    setActiveId(n.id);
    setSelectedNoteIds(new Set([n.id]));
  };
  const ctxDelete = async () => {
    if (!contextMenu) return;
    const isMulti = selectedNoteIds.has(contextMenu.note.id) && selectedNoteIds.size > 1;
    closeContextMenu();
    if (isMulti) {
      const toDelete = Array.from(selectedNoteIds).map(id => notes.find(n => n.id === id)).filter((n): n is Note => !!n);
      if (activeId && selectedNoteIds.has(activeId)) { setActiveId(null); setLocalTitle(""); setLocalContent(""); }
      setSelectedNoteIds(new Set());
      // Regular notes → trash (recoverable); locked/hidden → hard-deleted immediately
      await Promise.all(toDelete.map(note => deleteNote(note.id)));
      return;
    }
    const note = contextMenu.note;
    if (note.id === activeId) { setActiveId(null); setLocalTitle(""); setLocalContent(""); }
    setSelectedNoteIds((prev) => { const next = new Set(prev); next.delete(note.id); return next; });
    if (note.locked || note.hidden) {
      startPendingDelete(note);
    } else {
      await deleteNote(note.id);
    }
  };
  const ctxSendToBoard = () => {
    if (!contextMenu) return;
    onCreateTask(contextMenu.note.title || "Untitled", contextMenu.note.content);
    closeContextMenu();
  };
  const ctxMoveToFolder = async (folderId: string | null) => {
    if (!contextMenu) return;
    // If multiple notes selected and the right-clicked note is among them, move all
    const ids = selectedNoteIds.has(contextMenu.note.id) && selectedNoteIds.size > 1
      ? Array.from(selectedNoteIds)
      : [contextMenu.note.id];
    closeContextMenu();
    await moveNotesToFolder(ids, folderId);
  };

  const ctxLockNote = async () => {
    if (!contextMenu) return;
    const note = contextMenu.note;
    closeContextMenu();
    if (note.locked) {
      // Unlock: restore plaintext
      if (!isUnlocked) { setUnlockModalOpen({ open: true, mode: "unlock" }); return; }
      const dec = decryptedNotes.get(note.id);
      await updateNote(note.id, {
        locked: false, hidden: false,
        content: dec?.content ?? "", title: dec?.title ?? note.title,
        encContent: null, encTitle: null,
      } as Partial<Note>);
      setDecryptedNotes(prev => { const m = new Map(prev); m.delete(note.id); return m; });
      return;
    }
    // Lock: encrypt content
    if (!vaultExists) { setSetupModalOpen(true); return; }
    if (!isUnlocked) {
      pendingActionRef.current = async () => {
        const [encContent, encTitle] = await Promise.all([
          encryptRef.current(note.content),
          encryptRef.current(note.title || "Untitled"),
        ]);
        if (!encContent || !encTitle) return;
        await updateNote(note.id, {
          locked: true, content: "", title: "",
          encContent: JSON.stringify(encContent),
          encTitle: JSON.stringify(encTitle),
        } as Partial<Note>);
        setHintDialog({ noteId: note.id }); setHintValue("");
      };
      setUnlockModalOpen({ open: true, mode: "unlock" });
      return;
    }
    const [encContent, encTitle] = await Promise.all([
      encrypt(note.content),
      encrypt(note.title || "Untitled"),
    ]);
    if (!encContent || !encTitle) return;
    await updateNote(note.id, {
      locked: true,
      content: "", title: "",
      encContent: JSON.stringify(encContent),
      encTitle: JSON.stringify(encTitle),
    } as Partial<Note>);
    setHintDialog({ noteId: note.id }); setHintValue("");
  };

  const ctxEditHint = () => {
    if (!contextMenu) return;
    setHintValue(contextMenu.note.hint ?? "");
    setHintDialog({ noteId: contextMenu.note.id });
    closeContextMenu();
  };

  const ctxHideNote = async () => {
    if (!contextMenu) return;
    const note = contextMenu.note;
    const isMulti = selectedNoteIds.has(note.id) && selectedNoteIds.size > 1;
    closeContextMenu();

    if (isMulti) {
      const targetNotes = notes.filter(n => selectedNoteIds.has(n.id));
      const allHidden = targetNotes.every(n => n.hidden);
      if (allHidden) {
        await Promise.all(targetNotes.map(n => updateNote(n.id, { hidden: false } as Partial<Note>)));
        return;
      }
      if (!vaultExists) { setSetupModalOpen(true); return; }
      const doHideAll = async () => {
        await Promise.all(targetNotes.map(async (n) => {
          if (n.hidden) return;
          const updates: Partial<Note> = { hidden: true };
          if (!n.locked) {
            const [encContent, encTitle] = await Promise.all([
              encryptRef.current(n.content),
              encryptRef.current(n.title || "Untitled"),
            ]);
            if (encContent && encTitle) {
              Object.assign(updates, { locked: true, content: "", title: "", encContent: JSON.stringify(encContent), encTitle: JSON.stringify(encTitle) });
            }
          }
          await updateNote(n.id, updates);
        }));
      };
      if (!isUnlocked) { pendingActionRef.current = doHideAll; setUnlockModalOpen({ open: true, mode: "unlock" }); return; }
      await doHideAll();
      return;
    }

    if (note.hidden) {
      await updateNote(note.id, { hidden: false } as Partial<Note>);
      return;
    }
    if (!vaultExists) { setSetupModalOpen(true); return; }
    if (!isUnlocked) {
      pendingActionRef.current = async () => {
        const updates: Partial<Note> = { hidden: true };
        if (!note.locked) {
          const [encContent, encTitle] = await Promise.all([
            encryptRef.current(note.content),
            encryptRef.current(note.title || "Untitled"),
          ]);
          if (encContent && encTitle) {
            Object.assign(updates, { locked: true, content: "", title: "", encContent: JSON.stringify(encContent), encTitle: JSON.stringify(encTitle) });
          }
        }
        await updateNote(note.id, updates);
      };
      setUnlockModalOpen({ open: true, mode: "unlock" });
      return;
    }
    const updates: Partial<Note> = { hidden: true };
    if (!note.locked) {
      const [encContent, encTitle] = await Promise.all([
        encrypt(note.content),
        encrypt(note.title || "Untitled"),
      ]);
      if (encContent && encTitle) {
        Object.assign(updates, { locked: true, content: "", title: "", encContent: JSON.stringify(encContent), encTitle: JSON.stringify(encTitle) });
      }
    }
    await updateNote(note.id, updates);
  };

  // ── Folder management ──
  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    await createFolder(newFolderName.trim());
    setNewFolderMode(false);
    setNewFolderName("");
    // intentionally don't navigate to new folder — it's empty
  };
  const handleRenameFolder = async () => {
    if (!renamingFolder || !renameFolderValue.trim()) return;
    await updateFolder(renamingFolder.id, renameFolderValue.trim());
    setRenamingFolder(null);
  };
  const handleDeleteFolder = async (f: Folder) => {
    if (f.hidden || f.locked) {
      // Hidden/vault folder: 30-second undo window, then hard-delete folder + all notes inside
      const noteIds = notes.filter(n => n.folderId === f.id).map(n => n.id);
      if (selectedFolder === f.id) setSelectedFolder("all");
      setPendingFolderDelete({ id: f.id, name: f.name, noteIds });
    } else {
      // Regular folder: soft-delete all notes inside → trash, then delete the folder
      if (selectedFolder === f.id) setSelectedFolder("all");
      const folderNotes = notes.filter(n => n.folderId === f.id);
      await Promise.all(folderNotes.map(n => deleteNote(n.id)));
      await deleteFolder(f.id);
    }
  };

  // ── Folder context menu ──
  const openFolderCtxMenu = (e: React.MouseEvent, folder: Folder) => {
    e.preventDefault();
    e.stopPropagation();
    setFolderCtxMenu({ folder, x: e.clientX, y: e.clientY });
  };
  const closeFolderCtxMenu = () => setFolderCtxMenu(null);

  const folderCtxTogglePin = async () => {
    if (!folderCtxMenu) return;
    const folder = folderCtxMenu.folder;
    closeFolderCtxMenu();
    await patchFolder(folder.id, { pinned: !folder.pinned });
  };

  const folderCtxRename = () => {
    if (!folderCtxMenu) return;
    setRenamingFolder(folderCtxMenu.folder);
    setRenameFolderValue(folderCtxMenu.folder.name);
    closeFolderCtxMenu();
  };

  const folderCtxToggleHide = async () => {
    if (!folderCtxMenu) return;
    const folder = folderCtxMenu.folder;
    closeFolderCtxMenu();
    if (folder.hidden) {
      await patchFolder(folder.id, { hidden: false });
      // Unhide all notes in this folder; decrypt+unlock if vault is currently unlocked
      const folderNotes = notes.filter(n => n.folderId === folder.id);
      await Promise.all(folderNotes.map(async (note) => {
        if (isUnlocked && note.locked) {
          const dec = decryptedNotes.get(note.id);
          await updateNote(note.id, {
            hidden: false, locked: false,
            content: dec?.content ?? "",
            title: dec?.title ?? note.title,
            encContent: null, encTitle: null,
          } as Partial<Note>);
        } else {
          await updateNote(note.id, { hidden: false } as Partial<Note>);
        }
      }));
      return;
    }
    if (!vaultExists) { setSetupModalOpen(true); return; }
    if (!isUnlocked) {
      pendingActionRef.current = async () => {
        await patchFolder(folder.id, { hidden: true });
        // Lock and hide all unlocked notes in this folder
        const folderNotes = notes.filter(n => n.folderId === folder.id && !n.locked);
        await Promise.all(folderNotes.map(async (note) => {
          const [encContent, encTitle] = await Promise.all([
            encryptRef.current(note.content),
            encryptRef.current(note.title || "Untitled"),
          ]);
          if (encContent && encTitle) {
            await updateNote(note.id, {
              locked: true, hidden: true, content: "", title: "",
              encContent: JSON.stringify(encContent),
              encTitle: JSON.stringify(encTitle),
            } as Partial<Note>);
          }
        }));
      };
      setUnlockModalOpen({ open: true, mode: "unlock" });
      return;
    }
    await patchFolder(folder.id, { hidden: true });
    const folderNotes = notes.filter(n => n.folderId === folder.id && !n.locked);
    await Promise.all(folderNotes.map(async (note) => {
      const [encContent, encTitle] = await Promise.all([
        encrypt(note.content),
        encrypt(note.title || "Untitled"),
      ]);
      if (encContent && encTitle) {
        await updateNote(note.id, {
          locked: true, hidden: true, content: "", title: "",
          encContent: JSON.stringify(encContent),
          encTitle: JSON.stringify(encTitle),
        } as Partial<Note>);
      }
    }));
  };

  const folderCtxDelete = () => {
    if (!folderCtxMenu) return;
    const f = folderCtxMenu.folder;
    closeFolderCtxMenu();
    handleDeleteFolder(f);
  };

  // ── Filtering & sorting ──
  const isTrashView = selectedFolder === "trash";

  const filteredNotes = isTrashView ? [] : notes.filter((n) => {
    // Exclude notes pending deletion (30-second undo window)
    if (n.id === pendingDelete?.id) return false;
    // Exclude notes inside a pending-delete vault folder
    if (pendingFolderDelete && n.folderId === pendingFolderDelete.id) return false;
    // Hide hidden notes unless vault is revealed
    if (n.hidden && !isRevealed) return false;
    const matchFolder =
      selectedFolder === "all"     ? true :
      selectedFolder === "starred" ? n.starred :
      selectedFolder === null      ? n.folderId === null :
      n.folderId === selectedFolder;
    if (!matchFolder) return false;
    if (!search) return true;
    const dec = decryptedNotes.get(n.id);
    return matchesSearch(n, search, dec?.title);
  });

  // Stable sort: only reorder when IDs, pinned state, or sort settings change.
  // Prevents notes from jumping position during auto-save (updatedAt bumps).
  const stableKey = filteredNotes.map(n => `${n.id}:${n.pinned ? 1 : 0}`).join(",") + `|${sortField}|${sortDir}`;
  if (stableKey !== prevStableKeyRef.current) {
    prevStableKeyRef.current = stableKey;
    stableOrderRef.current = [...filteredNotes].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const getTitle = (n: Note) => {
        if (n.locked) return decryptedNotes.get(n.id)?.title ?? "Locked note";
        return n.title || "Untitled";
      };
      const cmp = sortField === "title"
        ? getTitle(a).localeCompare(getTitle(b))
        : new Date(a[sortField]).getTime() - new Date(b[sortField]).getTime();
      return sortDir === "asc" ? cmp : -cmp;
    }).map(n => n.id);
  }
  const sortedNotes = stableOrderRef.current
    .map(id => filteredNotes.find(n => n.id === id))
    .filter((n): n is Note => !!n);
  sortedNotesRef.current = sortedNotes;

  const notesPerFolder = (fid: string) => notes.filter((n) => n.folderId === fid).length;
  const starredCount   = notes.filter((n) => n.starred).length;
  const trashCount     = trashNotes.length;
  const activeNote     = notes.find((n) => n.id === activeId) ?? null;
  const isDragging     = draggedNoteIds.length > 0;

  // Determine if we should show the lock prompt in the editor
  const showLockPrompt = activeNote?.locked && !isUnlocked;

  return (
    <Box sx={{ display: "flex", height: "100%", overflow: "hidden" }}>

      {/* ── Left panel ── */}
      <Box
        sx={{ width: { xs: "100%", sm: 280 }, flexShrink: 0, borderRight: "1px solid #e2e8f0", display: isMobile && mobilePanel === "editor" ? "none" : "flex", flexDirection: "column", backgroundColor: "#f8fafc" }}
        onContextMenu={(e) => { e.preventDefault(); setListCtxMenu({ x: e.clientX, y: e.clientY }); }}
      >

        {/* Header */}
        <Box sx={{ px: 2, pt: 2.5, pb: 1.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5 }}>
            <Typography
              onClick={handleNotesHeaderClick}
              sx={{ fontWeight: 700, fontSize: "0.85rem", color: "#1e293b", cursor: "default", userSelect: "none" }}
            >
              Notes
            </Typography>
            <Button size="small" startIcon={<AddIcon sx={{ fontSize: 16 }} />} onClick={handleNewNote}
              sx={{ background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)", color: "#fff", fontWeight: 700, fontSize: "0.75rem", textTransform: "none", borderRadius: 1.5, px: 1.5, py: 0.5, minWidth: 0, "&:hover": { background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" } }}>
              New
            </Button>
          </Box>
          {isRevealed && (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5, px: 0.75, py: 0.5, borderRadius: 1.5, backgroundColor: "#eef0ff" }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                <ShieldOutlinedIcon sx={{ fontSize: 13, color: "#6366f1" }} />
                <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, color: "#6366f1" }}>Vault open</Typography>
              </Box>
              <Tooltip title="Lock vault and hide hidden notes" placement="top">
                <IconButton size="small" onClick={handleCloseVault} sx={{ p: 0.25, color: "#6366f1", "&:hover": { backgroundColor: "#e0e4ff" } }}>
                  <LockOutlinedIcon sx={{ fontSize: 13 }} />
                </IconButton>
              </Tooltip>
            </Box>
          )}
          {isUnlocked && !isRevealed && (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5, px: 0.75, py: 0.5, borderRadius: 1.5, backgroundColor: "#f0fdf4" }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                <LockOpenOutlinedIcon sx={{ fontSize: 13, color: "#16a34a" }} />
                <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, color: "#16a34a" }}>Notes unlocked</Typography>
              </Box>
              <Tooltip title="Lock notes" placement="top">
                <IconButton size="small" onClick={() => lockVault()} sx={{ p: 0.25, color: "#16a34a", "&:hover": { backgroundColor: "#dcfce7" } }}>
                  <LockOutlinedIcon sx={{ fontSize: 13 }} />
                </IconButton>
              </Tooltip>
            </Box>
          )}
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: 1.5, px: 1.25, py: 0.6 }}>
            <SearchIcon sx={{ fontSize: 16, color: "#94a3b8", flexShrink: 0 }} />
            <InputBase value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search notes…" sx={{ fontSize: "0.82rem", color: "#334155", flex: 1 }} />
          </Box>
        </Box>

        {/* Always-visible navigation rows */}
        <Box sx={{ px: 1.5, pb: 0.5 }}>
          <FolderRow
            label="All Notes" count={notes.length}
            active={selectedFolder === "all"}
            icon={<FolderOpenIcon sx={{ fontSize: 15 }} />}
            onClick={() => setSelectedFolder("all")}
          />
          {starredCount > 0 && (
            <FolderRow
              label="Starred" count={starredCount}
              active={selectedFolder === "starred"}
              icon={<StarBorderIcon sx={{ fontSize: 15 }} />}
              onClick={() => setSelectedFolder("starred")}
            />
          )}
        </Box>

        {/* Folders section header with collapse toggle */}
        <Box sx={{ px: 1.5, py: 0.25, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <Typography sx={{ fontSize: "0.67rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.8, userSelect: "none" }}>
            Folders
          </Typography>
          <Tooltip title={foldersCollapsed ? "Expand folders" : "Collapse folders"} placement="top">
            <IconButton size="small" onClick={() => setFoldersCollapsed(c => !c)}
              sx={{ p: 0.2, color: "#94a3b8", "&:hover": { color: "#64748b", backgroundColor: "#f1f5f9" } }}>
              {foldersCollapsed ? <ExpandMoreIcon sx={{ fontSize: 14 }} /> : <ExpandLessIcon sx={{ fontSize: 14 }} />}
            </IconButton>
          </Tooltip>
        </Box>

        {/* Resizable folder container */}
        <Box sx={{
          height: foldersCollapsed ? 0 : folderSectionHeight,
          overflow: "hidden",
          flexShrink: 0,
          transition: foldersCollapsed ? "height 0.2s ease" : "none",
        }}>
          <Box sx={{ px: 1.5, pb: 1, height: "100%", overflowY: "auto" }}>

            {/* User folders — pinned first, then alpha; hide pending-delete folder */}
            {[...folders].filter(f => f.id !== pendingFolderDelete?.id).sort((a, b) => {
              if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
              return a.name.localeCompare(b.name);
            }).map((f) => (
              <Box key={f.id} sx={{ position: "relative", "&:hover .folder-actions": { opacity: 1 } }}>
                {renamingFolder?.id === f.id ? (
                  <InputBase
                    value={renameFolderValue}
                    onChange={(e) => setRenameFolderValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleRenameFolder(); if (e.key === "Escape") setRenamingFolder(null); }}
                    onBlur={handleRenameFolder}
                    autoFocus
                    sx={{ fontSize: "0.8rem", color: "#1e293b", width: "100%", px: 1, py: 0.5, backgroundColor: "#fff", borderRadius: 1.5, border: "1px solid #c7d2fe" }}
                  />
                ) : (
                  <FolderRow
                    label={f.name} count={notesPerFolder(f.id)}
                    active={selectedFolder === f.id}
                    icon={
                      f.hidden
                        ? <Box sx={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
                            <FolderOutlinedIcon sx={{ fontSize: 15, color: "#a5b4fc" }} />
                            <LockOutlinedIcon sx={{ position: "absolute", fontSize: 8, color: "#6366f1", bottom: -1, right: -3 }} />
                          </Box>
                        : <FolderOutlinedIcon sx={{ fontSize: 15 }} />
                    }
                    pinned={f.pinned}
                    onClick={() => setSelectedFolder(f.id)}
                    onContextMenu={(e) => openFolderCtxMenu(e, f)}
                    isDragOver={dragOverTarget === f.id}
                    onDragOver={(e) => handleFolderDragOver(e, f.id)}
                    onDragLeave={handleFolderDragLeave}
                    onDrop={(e) => handleFolderDrop(e, f.id)}
                  />
                )}
                <Box className="folder-actions" sx={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", display: "flex", opacity: 0, transition: "opacity 0.15s", gap: 0.25 }}>
                  <IconButton size="small" onClick={() => { setRenamingFolder(f); setRenameFolderValue(f.name); }}
                    sx={{ p: 0.3, color: "#64748b", backgroundColor: "rgba(248,250,252,0.9)", "&:hover": { color: "#475569", backgroundColor: "#e2e8f0" } }}>
                    <EditIcon sx={{ fontSize: 12 }} />
                  </IconButton>
                  <IconButton size="small" onClick={() => handleDeleteFolder(f)}
                    sx={{ p: 0.3, color: "#64748b", backgroundColor: "rgba(248,250,252,0.9)", "&:hover": { color: "#ef4444", backgroundColor: "#fff1f2" } }}>
                    <DeleteOutlineIcon sx={{ fontSize: 12 }} />
                  </IconButton>
                </Box>
              </Box>
            ))}

            {/* New folder */}
            {newFolderMode ? (
              <InputBase
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreateFolder(); if (e.key === "Escape") { setNewFolderMode(false); setNewFolderName(""); } }}
                onBlur={() => { if (!newFolderName.trim()) { setNewFolderMode(false); setNewFolderName(""); } else handleCreateFolder(); }}
                placeholder="Folder name…"
                autoFocus
                sx={{ fontSize: "0.8rem", color: "#1e293b", width: "100%", px: 1, py: 0.5, mt: 0.5, backgroundColor: "#fff", borderRadius: 1.5, border: "1px solid #c7d2fe" }}
              />
            ) : (
              <Box onClick={() => setNewFolderMode(true)}
                sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1, py: 0.6, mt: 0.25, cursor: "pointer", borderRadius: 1.5, color: "#94a3b8", "&:hover": { color: "#6366f1", backgroundColor: "#f1f5f9" }, transition: "all 0.15s" }}>
                <CreateNewFolderOutlinedIcon sx={{ fontSize: 14 }} />
                <Typography sx={{ fontSize: "0.78rem", fontWeight: 500 }}>New Folder</Typography>
              </Box>
            )}

            {/* Trash */}
            {trashCount > 0 && (
              <>
                <Divider sx={{ my: 0.75, borderColor: "#e2e8f0" }} />
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <FolderRow
                    label="Trash" count={trashCount}
                    active={selectedFolder === "trash"}
                    icon={<DeleteSweepIcon sx={{ fontSize: 15 }} />}
                    onClick={() => setSelectedFolder("trash")}
                    sx={{ flex: 1, color: selectedFolder === "trash" ? "#ef4444" : "#94a3b8",
                      backgroundColor: selectedFolder === "trash" ? "#fff1f2" : "transparent",
                      "&:hover": { backgroundColor: selectedFolder === "trash" ? "#fff1f2" : "#f1f5f9" } }}
                  />
                  {selectedFolder === "trash" && (
                    <Tooltip title="Empty trash" placement="top">
                      <IconButton size="small" onClick={emptyTrash}
                        sx={{ mr: 0.5, p: 0.4, color: "#ef4444", "&:hover": { backgroundColor: "#fff1f2" } }}>
                        <DeleteForeverIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                </Box>
              </>
            )}
          </Box>
        </Box>

        {/* Resize drag handle */}
        {!foldersCollapsed && (
          <Box
            onMouseDown={handleResizeStart}
            sx={{ height: 8, cursor: "row-resize", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, "&:hover .resize-grip": { backgroundColor: "#a5b4fc" } }}
          >
            <Box className="resize-grip" sx={{ width: 36, height: 2, backgroundColor: "#e2e8f0", borderRadius: 1, transition: "background-color 0.15s" }} />
          </Box>
        )}

        <Divider sx={{ borderColor: "#e2e8f0" }} />

        {/* Sort controls */}
        <Box sx={{ px: 2, py: 1.25, display: "flex", gap: 0.5 }}>
          {(["updatedAt", "createdAt", "title"] as SortField[]).map((field) => {
            const active = sortField === field;
            return (
              <Tooltip key={field} title={active ? (sortDir === "desc" ? "Oldest/A-Z first" : "Newest/Z-A first") : ""} placement="top">
                <Button size="small" onClick={() => handleSort(field)}
                  endIcon={active ? (sortDir === "desc" ? <ArrowDownwardIcon sx={{ fontSize: "11px !important" }} /> : <ArrowUpwardIcon sx={{ fontSize: "11px !important" }} />) : undefined}
                  sx={{ fontSize: "0.72rem", fontWeight: active ? 700 : 500, textTransform: "none", color: active ? "#6366f1" : "#94a3b8", backgroundColor: active ? "#eef0ff" : "transparent", borderRadius: 1.5, px: 1, py: 0.25, minWidth: 0, "& .MuiButton-endIcon": { ml: 0.25 }, "&:hover": { backgroundColor: active ? "#e0e4ff" : "#f1f5f9", color: active ? "#6366f1" : "#64748b" } }}>
                  {SORT_LABELS[field]}
                </Button>
              </Tooltip>
            );
          })}
        </Box>

        <Divider sx={{ borderColor: "#e2e8f0" }} />

        {/* Note list */}
        <Box sx={{ flex: 1, overflowY: "auto" }}>

          {/* ── Trash view ── */}
          {isTrashView && (
            <>
              {trashNotes.length === 0 ? (
                <Box sx={{ p: 3, textAlign: "center" }}>
                  <Typography sx={{ fontSize: "0.82rem", color: "#94a3b8" }}>Trash is empty</Typography>
                </Box>
              ) : trashNotes.map((note) => (
                <Box key={note.id} sx={{ px: 2, py: 1.25, borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 1, opacity: 0.75, "&:hover": { opacity: 1, backgroundColor: "#fef2f2" }, transition: "all 0.1s" }}>
                  {note.locked && <LockOutlinedIcon sx={{ fontSize: 13, color: "#94a3b8", flexShrink: 0 }} />}
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: "0.84rem", color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontStyle: note.locked ? "italic" : "normal" }}>
                      {note.locked ? "Locked note" : (note.title || "Untitled")}
                    </Typography>
                    <Typography sx={{ fontSize: "0.72rem", color: "#94a3b8" }}>
                      Deleted {noteTimestamp(note.deletedAt!)}
                    </Typography>
                  </Box>
                  <Tooltip title="Restore" placement="top">
                    <IconButton size="small" onClick={() => restoreNote(note.id)} sx={{ p: 0.5, color: "#6366f1", "&:hover": { backgroundColor: "#eef0ff" } }}>
                      <RestoreFromTrashIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title="Delete forever" placement="top">
                    <IconButton size="small" onClick={() => permanentDeleteNote(note.id)} sx={{ p: 0.5, color: "#ef4444", "&:hover": { backgroundColor: "#fff1f2" } }}>
                      <DeleteForeverIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                </Box>
              ))}
            </>
          )}

          {!isTrashView && sortedNotes.length === 0 && (
            <Box sx={{ p: 3, textAlign: "center" }}>
              <Typography sx={{ fontSize: "0.82rem", color: "#94a3b8" }}>
                {search ? "No matching notes" : "No notes yet"}
              </Typography>
            </Box>
          )}
          {!isTrashView && sortedNotes.map((note) => {
            const isActive   = note.id === activeId;
            const isSelected = selectedNoteIds.has(note.id);
            const isDragged  = draggedNoteIds.includes(note.id);

            const dec = decryptedNotes.get(note.id);
            const isLocked = note.locked;
            const isLockedAndSealed = isLocked && !isUnlocked;

            const displayTitle = isLocked
              ? (isUnlocked ? (dec?.title ?? "Locked note") : (note.hint || "Locked note"))
              : (isActive ? (localTitle || "Untitled") : (note.title || "Untitled"));

            const preview = isLocked
              ? (isUnlocked && dec ? stripHtml(dec.content) : "")
              : stripHtml(note.content);

            return (
              <Box
                key={note.id}
                draggable
                onDragStart={(e) => handleNoteDragStart(e, note)}
                onDragEnd={handleNoteDragEnd}
                onClick={(e) => handleNoteClick(e, note)}
                onContextMenu={(e) => openContextMenu(e, note)}
                sx={{
                  px: 2, py: 1.5,
                  cursor: isDragging ? "grabbing" : "pointer",
                  borderBottom: "1px solid #f1f5f9",
                  backgroundColor: isActive ? "#eef0ff" : isSelected ? "#f5f3ff" : "transparent",
                  borderLeft: isActive ? "3px solid #6366f1" : isSelected ? "3px solid #a5b4fc" : "3px solid transparent",
                  opacity: isDragged ? 0.45 : 1,
                  userSelect: "none",
                  "&:hover": { backgroundColor: isActive ? "#eef0ff" : isSelected ? "#f5f3ff" : "#f1f5f9" },
                  "&:hover .note-icons": { opacity: 1 },
                  transition: "background-color 0.1s, opacity 0.15s",
                }}
              >
                <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 0.5 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flex: 1, minWidth: 0 }}>
                    {isLocked && (
                      <LockOutlinedIcon sx={{ fontSize: 13, color: isUnlocked ? "#6366f1" : "#94a3b8", flexShrink: 0 }} />
                    )}
                    {note.hidden && isRevealed && (
                      <VisibilityOffOutlinedIcon sx={{ fontSize: 13, color: "#f59e0b", flexShrink: 0 }} />
                    )}
                    <Typography sx={{ fontWeight: isActive ? 700 : 500, fontSize: "0.85rem", color: isLockedAndSealed ? "#94a3b8" : "#1e293b", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0, fontStyle: isLockedAndSealed ? "italic" : "normal" }}>
                      {displayTitle}
                    </Typography>
                  </Box>
                  <Box className="note-icons" sx={{ display: "flex", alignItems: "center", opacity: (note.starred || note.pinned) ? 1 : 0, transition: "opacity 0.15s", flexShrink: 0, gap: 0.25 }}>
                    <Tooltip title={note.starred ? "Unstar" : "Star"} placement="top">
                      <IconButton size="small" onClick={(e) => handleStar(e, note)}
                        sx={{ p: 0.25, color: note.starred ? "#f59e0b" : "#94a3b8", "&:hover": { backgroundColor: "transparent", color: "#f59e0b" } }}>
                        {note.starred ? <StarIcon sx={{ fontSize: 13 }} /> : <StarBorderIcon sx={{ fontSize: 13 }} />}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={note.pinned ? "Unpin" : "Pin to top"} placement="top">
                      <IconButton size="small" onClick={(e) => handlePin(e, note)}
                        sx={{ p: 0.25, color: note.pinned ? "#6366f1" : "#94a3b8", "&:hover": { backgroundColor: "transparent", color: "#6366f1" } }}>
                        {note.pinned ? <PushPinIcon sx={{ fontSize: 13 }} /> : <PushPinOutlinedIcon sx={{ fontSize: 13 }} />}
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Box>
                <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mt: 0.3 }}>
                  <Typography sx={{ fontSize: "0.75rem", color: "#64748b", flexShrink: 0 }}>{noteTimestamp(note.updatedAt)}</Typography>
                  {isLockedAndSealed ? (
                    <Typography sx={{ fontSize: "0.75rem", color: "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", letterSpacing: 2 }}>
                      {"•••••••••"}
                    </Typography>
                  ) : (
                    preview && <Typography sx={{ fontSize: "0.75rem", color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{preview.slice(0, 60)}</Typography>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* ── Editor pane ── */}
      <Box sx={{ flex: 1, display: isMobile && mobilePanel === "list" ? "none" : "flex", flexDirection: "column", overflow: "hidden", backgroundColor: "#fff" }}>
        {isMobile && (
          <Box sx={{ px: 1.5, py: 0.75, borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", gap: 0.5, backgroundColor: "#f8fafc", flexShrink: 0 }}>
            <IconButton size="small" onClick={() => setMobilePanel("list")} sx={{ color: "#475569" }}>
              <ArrowBackIcon sx={{ fontSize: 20 }} />
            </IconButton>
            <Typography sx={{ fontSize: "0.85rem", fontWeight: 600, color: "#334155" }}>Notes</Typography>
          </Box>
        )}
        {activeNote === null ? (
          <Box sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
            <NoteAltOutlinedIcon sx={{ fontSize: 52, color: "#cbd5e1" }} />
            <Typography sx={{ fontSize: "0.95rem", fontWeight: 500, color: "#94a3b8" }}>Select a note or create a new one</Typography>
            <Button startIcon={<AddIcon />} onClick={handleNewNote} variant="outlined"
              sx={{ color: "#6366f1", borderColor: "#c7d2fe", textTransform: "none", fontWeight: 600, borderRadius: 2, "&:hover": { borderColor: "#6366f1", backgroundColor: "#eef0ff" } }}>
              New Note
            </Button>
          </Box>
        ) : showLockPrompt ? (
          /* Locked note, vault not unlocked — show lock prompt */
          <Box sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
            <LockOutlinedIcon sx={{ fontSize: 52, color: "#c7d2fe" }} />
            <Typography sx={{ fontSize: "0.95rem", fontWeight: 600, color: "#64748b" }}>This note is locked</Typography>
            <Typography sx={{ fontSize: "0.85rem", color: "#94a3b8" }}>Unlock vault to read this note</Typography>
            <Button
              startIcon={<LockOpenOutlinedIcon />}
              onClick={() => setUnlockModalOpen({ open: true, mode: "unlock" })}
              variant="outlined"
              sx={{ color: "#6366f1", borderColor: "#c7d2fe", textTransform: "none", fontWeight: 600, borderRadius: 2, "&:hover": { borderColor: "#6366f1", backgroundColor: "#eef0ff" } }}
            >
              Unlock
            </Button>
          </Box>
        ) : (
          <>
            <Box sx={{ px: { xs: 1.5, sm: 3 }, py: { xs: 0.75, sm: 1.5 }, borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0, overflow: "hidden" }}>
                <Typography sx={{ fontSize: "0.75rem", color: "#94a3b8", display: { xs: "none", sm: "block" }, flexShrink: 0 }}>
                  {noteTimestamp(activeNote.updatedAt)} · auto-saved
                </Typography>
                {activeNote.folderId && folders.find((f) => f.id === activeNote.folderId) && (
                  <Typography sx={{ fontSize: "0.75rem", color: "#6366f1", display: "flex", alignItems: "center", gap: 0.25, flexShrink: 0 }}>
                    <FolderOutlinedIcon sx={{ fontSize: 12 }} />
                    <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>
                      {folders.find((f) => f.id === activeNote.folderId)!.name}
                    </Box>
                  </Typography>
                )}
                {activeNote.starred && (
                  <StarIcon sx={{ fontSize: 14, color: "#f59e0b", flexShrink: 0 }} />
                )}
                {activeNote.locked && isUnlocked && (
                  <Tooltip title="Note is encrypted" placement="top">
                    <LockOutlinedIcon sx={{ fontSize: 14, color: "#6366f1", flexShrink: 0 }} />
                  </Tooltip>
                )}
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: { xs: 0.5, sm: 1 }, flexShrink: 0 }}>
                {isMobile ? (
                  <Tooltip title="New Note" placement="top">
                    <IconButton size="small" onClick={handleNewNote}
                      sx={{ color: "#475569", backgroundColor: "#f1f5f9", borderRadius: 1.5, "&:hover": { backgroundColor: "#e2e8f0" } }}>
                      <AddIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </Tooltip>
                ) : (
                  <Button size="small" startIcon={<AddIcon sx={{ fontSize: 16 }} />} onClick={handleNewNote}
                    sx={{ color: "#475569", fontWeight: 600, fontSize: "0.8rem", textTransform: "none", backgroundColor: "#f1f5f9", borderRadius: 1.5, px: 1.5, "&:hover": { backgroundColor: "#e2e8f0" } }}>
                    New Note
                  </Button>
                )}
                {isMobile ? (
                  <Tooltip title="Send to Board" placement="top">
                    <IconButton size="small" onClick={handleCreateTask}
                      sx={{ color: "#6366f1", backgroundColor: "#eef0ff", borderRadius: 1.5, "&:hover": { backgroundColor: "#e0e4ff" } }}>
                      <TaskAltIcon sx={{ fontSize: 18 }} />
                    </IconButton>
                  </Tooltip>
                ) : (
                  <Button size="small" startIcon={<TaskAltIcon sx={{ fontSize: 15 }} />} onClick={handleCreateTask}
                    sx={{ color: "#6366f1", fontWeight: 600, fontSize: "0.8rem", textTransform: "none", backgroundColor: "#eef0ff", borderRadius: 1.5, px: 1.5, "&:hover": { backgroundColor: "#e0e4ff" } }}>
                    Send to Board
                  </Button>
                )}
                <IconButton size="small" onClick={handleDelete} title="Delete note"
                  sx={{ color: "#94a3b8", "&:hover": { color: "#ef4444", backgroundColor: "#fff1f2" } }}>
                  <DeleteOutlineIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Box>
            </Box>
            <Box sx={{ px: { xs: 2, sm: 3 }, pt: { xs: 2, sm: 3 }, pb: 1, flexShrink: 0 }}>
              <InputBase value={localTitle} onChange={(e) => handleTitleChange(e.target.value)} placeholder="Untitled" multiline fullWidth
                sx={{ fontSize: "1.6rem", fontWeight: 700, color: "#0f172a", lineHeight: 1.3, "& textarea": { padding: 0 } }} />
            </Box>
            <Box sx={{ px: { xs: 2, sm: 3 }, pb: { xs: 2, sm: 3 }, flex: 1, overflowY: "auto" }}>
              <RichTextEditor key={editorKey} value={localContent} onChange={handleContentChange} minHeight={400} />
            </Box>
          </>
        )}
      </Box>

      {/* ── Right-click context menu ── */}
      {(() => {
        const isMultiCtx = !!(contextMenu && selectedNoteIds.has(contextMenu.note.id) && selectedNoteIds.size > 1);
        const multiCount = isMultiCtx ? selectedNoteIds.size : 1;
        const ctxNote = contextMenu?.note;
        const multiNotes = isMultiCtx ? notes.filter(n => selectedNoteIds.has(n.id)) : (ctxNote ? [ctxNote] : []);
        const allHidden = multiNotes.length > 0 && multiNotes.every(n => n.hidden);
        const suffix = isMultiCtx ? ` ${multiCount} notes` : "";
        return (
      <Menu
        open={!!contextMenu}
        onClose={closeContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.y, left: contextMenu.x } : undefined}
        slotProps={{ paper: { sx: { minWidth: 200, borderRadius: 2, boxShadow: "0 8px 32px rgba(0,0,0,0.16)", py: 0.5 } } }}
      >
        <MenuItem onClick={ctxPin} sx={menuItemSx}>
          <ListItemIcon>{ctxNote?.pinned ? <PushPinIcon sx={{ fontSize: 17, color: "#6366f1" }} /> : <PushPinOutlinedIcon sx={{ fontSize: 17 }} />}</ListItemIcon>
          <ListItemText primary={ctxNote?.pinned ? `Unpin${suffix}` : `Pin to top${suffix}`} slotProps={{ primary: { sx: { fontSize: "0.875rem" } } }} />
        </MenuItem>
        <MenuItem onClick={ctxStar} sx={menuItemSx}>
          <ListItemIcon>{ctxNote?.starred ? <StarIcon sx={{ fontSize: 17, color: "#f59e0b" }} /> : <StarBorderIcon sx={{ fontSize: 17 }} />}</ListItemIcon>
          <ListItemText primary={ctxNote?.starred ? `Unstar${suffix}` : `Star${suffix}`} slotProps={{ primary: { sx: { fontSize: "0.875rem" } } }} />
        </MenuItem>
        {!isMultiCtx && (
          <MenuItem onClick={ctxLockNote} sx={menuItemSx}>
            <ListItemIcon>
              {ctxNote?.locked
                ? <LockOpenOutlinedIcon sx={{ fontSize: 17, color: "#6366f1" }} />
                : <LockOutlinedIcon sx={{ fontSize: 17 }} />}
            </ListItemIcon>
            <ListItemText primary={ctxNote?.locked ? "Unlock note" : "Lock note"} slotProps={{ primary: { sx: { fontSize: "0.875rem" } } }} />
          </MenuItem>
        )}
        {!isMultiCtx && ctxNote?.locked && (
          <MenuItem onClick={ctxEditHint} sx={menuItemSx}>
            <ListItemIcon><EditIcon sx={{ fontSize: 17 }} /></ListItemIcon>
            <ListItemText primary={ctxNote.hint ? "Edit hint label" : "Add hint label"} slotProps={{ primary: { sx: { fontSize: "0.875rem" } } }} />
          </MenuItem>
        )}
        <MenuItem onClick={ctxHideNote} sx={menuItemSx}>
          <ListItemIcon>
            {allHidden
              ? <VisibilityOutlinedIcon sx={{ fontSize: 17, color: "#6366f1" }} />
              : <VisibilityOffOutlinedIcon sx={{ fontSize: 17 }} />}
          </ListItemIcon>
          <ListItemText primary={allHidden ? `Unhide${suffix}` : `Hide${suffix}`} slotProps={{ primary: { sx: { fontSize: "0.875rem" } } }} />
        </MenuItem>
        <MenuItem onClick={ctxDuplicate} disabled={!isMultiCtx && !!ctxNote?.locked} sx={menuItemSx}>
          <ListItemIcon><ContentCopyIcon sx={{ fontSize: 17 }} /></ListItemIcon>
          <ListItemText primary={`Duplicate${suffix}`} slotProps={{ primary: { sx: { fontSize: "0.875rem" } } }} />
        </MenuItem>

        <Divider sx={{ my: 0.5 }} />

        <Typography sx={{ px: 2, pt: 0.5, pb: 0.25, fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.8 }}>
          Move to folder
        </Typography>
        <MenuItem onClick={() => ctxMoveToFolder(null)} sx={menuItemSx}>
          <ListItemIcon>
            {contextMenu?.note.folderId === null ? <CheckIcon sx={{ fontSize: 17, color: "#6366f1" }} /> : <FolderOutlinedIcon sx={{ fontSize: 17 }} />}
          </ListItemIcon>
          <ListItemText primary="No folder" slotProps={{ primary: { sx: { fontSize: "0.875rem" } } }} />
        </MenuItem>
        {folders.map((f) => (
          <MenuItem key={f.id} onClick={() => ctxMoveToFolder(f.id)} sx={menuItemSx}>
            <ListItemIcon>
              {contextMenu?.note.folderId === f.id
                ? <CheckIcon sx={{ fontSize: 17, color: "#6366f1" }} />
                : f.hidden
                  ? <Box sx={{ position: "relative", display: "inline-flex" }}>
                      <FolderOutlinedIcon sx={{ fontSize: 17, color: "#a5b4fc" }} />
                      <LockOutlinedIcon sx={{ position: "absolute", fontSize: 9, color: "#6366f1", bottom: -1, right: -3 }} />
                    </Box>
                  : <FolderOutlinedIcon sx={{ fontSize: 17 }} />}
            </ListItemIcon>
            <ListItemText
              primary={f.name}
              slotProps={{ primary: { sx: { fontSize: "0.875rem", color: f.hidden ? "#6366f1" : undefined } } }}
            />
          </MenuItem>
        ))}
        {folders.length === 0 && (
          <MenuItem disabled sx={{ ...menuItemSx, opacity: 0.5 }}>
            <ListItemIcon><DriveFileMoveOutlinedIcon sx={{ fontSize: 17 }} /></ListItemIcon>
            <ListItemText primary="No folders yet" slotProps={{ primary: { sx: { fontSize: "0.875rem", fontStyle: "italic" } } }} />
          </MenuItem>
        )}

        <Divider sx={{ my: 0.5 }} />

        <MenuItem onClick={ctxSendToBoard} sx={menuItemSx}>
          <ListItemIcon><TaskAltIcon sx={{ fontSize: 17 }} /></ListItemIcon>
          <ListItemText primary="Send to Board" slotProps={{ primary: { sx: { fontSize: "0.875rem" } } }} />
        </MenuItem>

        <Divider sx={{ my: 0.5 }} />

        <MenuItem onClick={ctxDelete} sx={{ ...menuItemSx, color: "#ef4444", "& .MuiListItemIcon-root": { color: "#ef4444" } }}>
          <ListItemIcon><DeleteForeverIcon sx={{ fontSize: 17 }} /></ListItemIcon>
          <ListItemText primary={`Delete${suffix}`} slotProps={{ primary: { sx: { fontSize: "0.875rem" } } }} />
        </MenuItem>
      </Menu>
        );
      })()}

      {/* ── 30-second undo snackbar (locked/hidden note deletion) ── */}
      <Snackbar
        open={!!pendingDelete}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        sx={{ "& .MuiSnackbarContent-root": { borderRadius: 2, minWidth: 0, flexWrap: "nowrap" } }}
        message={
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 220 }}>
            <Typography sx={{ fontSize: "0.84rem", fontWeight: 600, color: "#fff" }}>
              &ldquo;{pendingDelete?.label}&rdquo; will be deleted in {undoCountdown}s
            </Typography>
            <LinearProgress
              variant="determinate"
              value={(undoCountdown / 30) * 100}
              sx={{ borderRadius: 1, height: 3, backgroundColor: "rgba(255,255,255,0.3)", "& .MuiLinearProgress-bar": { backgroundColor: "#fff" } }}
            />
          </Box>
        }
        action={
          <Button
            size="small"
            onClick={() => {
              if (pendingDeleteTimerRef.current) clearTimeout(pendingDeleteTimerRef.current);
              if (undoIntervalRef.current) clearInterval(undoIntervalRef.current);
              setPendingDelete(null);
            }}
            sx={{ color: "#a5b4fc", fontWeight: 700, fontSize: "0.82rem", textTransform: "none", ml: 1 }}
          >
            Undo
          </Button>
        }
      />

      {/* ── 30-second undo snackbar (vault folder deletion) ── */}
      <Snackbar
        open={!!pendingFolderDelete}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        sx={{ mb: !!pendingDelete ? 8 : 0, "& .MuiSnackbarContent-root": { borderRadius: 2, minWidth: 0, flexWrap: "nowrap" } }}
        message={
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, minWidth: 220 }}>
            <Typography sx={{ fontSize: "0.84rem", fontWeight: 600, color: "#fff" }}>
              Folder &ldquo;{pendingFolderDelete?.name}&rdquo; + contents deleted in {folderUndoCountdown}s
            </Typography>
            <LinearProgress
              variant="determinate"
              value={(folderUndoCountdown / 30) * 100}
              sx={{ borderRadius: 1, height: 3, backgroundColor: "rgba(255,255,255,0.3)", "& .MuiLinearProgress-bar": { backgroundColor: "#fff" } }}
            />
          </Box>
        }
        action={
          <Button
            size="small"
            onClick={() => {
              if (pendingFolderTimerRef.current) clearTimeout(pendingFolderTimerRef.current);
              if (folderUndoIntervalRef.current) clearInterval(folderUndoIntervalRef.current);
              setPendingFolderDelete(null);
            }}
            sx={{ color: "#a5b4fc", fontWeight: 700, fontSize: "0.82rem", textTransform: "none", ml: 1 }}
          >
            Undo
          </Button>
        }
      />

      {/* ── Left-panel background right-click menu ── */}
      <Menu
        open={!!listCtxMenu}
        onClose={() => setListCtxMenu(null)}
        anchorReference="anchorPosition"
        anchorPosition={listCtxMenu ? { top: listCtxMenu.y, left: listCtxMenu.x } : undefined}
        slotProps={{ paper: { sx: { borderRadius: 2, minWidth: 160, boxShadow: "0 8px 30px rgba(0,0,0,0.12)" } } }}
      >
        <MenuItem onClick={() => { setListCtxMenu(null); handleNewNote(); }} sx={menuItemSx}>
          <ListItemIcon><AddIcon sx={{ fontSize: 17 }} /></ListItemIcon>
          <ListItemText primary="New Note" slotProps={{ primary: { sx: { fontSize: "0.875rem" } } }} />
        </MenuItem>
        <MenuItem onClick={() => { setListCtxMenu(null); setNewFolderMode(true); }} sx={menuItemSx}>
          <ListItemIcon><CreateNewFolderOutlinedIcon sx={{ fontSize: 17 }} /></ListItemIcon>
          <ListItemText primary="New Folder" slotProps={{ primary: { sx: { fontSize: "0.875rem" } } }} />
        </MenuItem>
      </Menu>

      {/* ── Folder context menu ── */}
      <Menu
        open={!!folderCtxMenu}
        onClose={closeFolderCtxMenu}
        anchorReference="anchorPosition"
        anchorPosition={folderCtxMenu ? { top: folderCtxMenu.y, left: folderCtxMenu.x } : undefined}
        slotProps={{ paper: { sx: { borderRadius: 2, minWidth: 180, boxShadow: "0 8px 30px rgba(0,0,0,0.12)" } } }}
      >
        <MenuItem onClick={folderCtxTogglePin} sx={menuItemSx}>
          <ListItemIcon>
            {folderCtxMenu?.folder.pinned
              ? <PushPinIcon sx={{ fontSize: 17, color: "#6366f1" }} />
              : <PushPinOutlinedIcon sx={{ fontSize: 17 }} />}
          </ListItemIcon>
          <ListItemText
            primary={folderCtxMenu?.folder.pinned ? "Unpin" : "Pin to top"}
            slotProps={{ primary: { sx: { fontSize: "0.875rem" } } }}
          />
        </MenuItem>
        <MenuItem onClick={folderCtxRename} sx={menuItemSx}>
          <ListItemIcon><EditIcon sx={{ fontSize: 17 }} /></ListItemIcon>
          <ListItemText primary="Rename" slotProps={{ primary: { sx: { fontSize: "0.875rem" } } }} />
        </MenuItem>
        <MenuItem onClick={folderCtxToggleHide} sx={menuItemSx}>
          <ListItemIcon>
            {folderCtxMenu?.folder.hidden
              ? <VisibilityOutlinedIcon sx={{ fontSize: 17, color: "#6366f1" }} />
              : <VisibilityOffOutlinedIcon sx={{ fontSize: 17 }} />}
          </ListItemIcon>
          <ListItemText
            primary={folderCtxMenu?.folder.hidden ? "Unhide folder" : "Hide folder"}
            slotProps={{ primary: { sx: { fontSize: "0.875rem" } } }}
          />
        </MenuItem>
        <Divider sx={{ my: 0.5 }} />
        <MenuItem onClick={folderCtxDelete} sx={{ ...menuItemSx, color: "#ef4444", "& .MuiListItemIcon-root": { color: "#ef4444" } }}>
          <ListItemIcon><DeleteForeverIcon sx={{ fontSize: 17 }} /></ListItemIcon>
          <ListItemText primary="Delete" slotProps={{ primary: { sx: { fontSize: "0.875rem" } } }} />
        </MenuItem>
      </Menu>

      {/* ── Hint label dialog ── */}
      <Dialog open={!!hintDialog} onClose={() => setHintDialog(null)} maxWidth="xs" fullWidth slotProps={{ paper: { sx: { borderRadius: 2.5, p: 0.5 } } }}>
        <DialogContent>
          <Typography sx={{ fontWeight: 700, fontSize: "0.95rem", color: "#0f172a", mb: 0.5 }}>
            Add a hint label
          </Typography>
          <Typography sx={{ fontSize: "0.8rem", color: "#94a3b8", mb: 2 }}>
            This short label is visible when the note is locked — it&apos;s not encrypted. Leave blank to show &ldquo;Locked note&rdquo;.
          </Typography>
          <Box sx={{ backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 1.5, px: 1.5, py: 1, mb: 2 }}>
            <InputBase
              value={hintValue}
              onChange={(e) => setHintValue(e.target.value)}
              placeholder="e.g. Work credentials, Journal 2024…"
              fullWidth
              autoFocus
              inputProps={{ maxLength: 80 }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (hintDialog) updateNote(hintDialog.noteId, { hint: hintValue.trim() || null } as Partial<Note>);
                  setHintDialog(null);
                }
                if (e.key === "Escape") setHintDialog(null);
              }}
              sx={{ fontSize: "0.875rem", color: "#1e293b" }}
            />
          </Box>
          <Box sx={{ display: "flex", gap: 1.5 }}>
            <Button onClick={() => setHintDialog(null)} variant="outlined"
              sx={{ flex: 1, textTransform: "none", fontWeight: 600, borderRadius: 1.5, borderColor: "#e2e8f0", color: "#64748b" }}>
              Skip
            </Button>
            <Button
              onClick={() => {
                if (hintDialog) updateNote(hintDialog.noteId, { hint: hintValue.trim() || null } as Partial<Note>);
                setHintDialog(null);
              }}
              sx={{ flex: 1, background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)", color: "#fff", fontWeight: 700, textTransform: "none", borderRadius: 1.5, "&:hover": { background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" } }}>
              Save
            </Button>
          </Box>
        </DialogContent>
      </Dialog>

      {/* ── Vault modals ── */}
      <VaultSetupModal
        open={setupModalOpen}
        onClose={() => setSetupModalOpen(false)}
        onSuccess={() => {
          setVaultExists(true);
          fetch("/api/notes/vault").then(r => r.json()).then(d => setHasWebAuthn((d.webAuthnCredentials ?? []).length > 0));
        }}
      />
      <VaultUnlockModal
        open={unlockModalOpen.open}
        onClose={() => setUnlockModalOpen(o => ({ ...o, open: false }))}
        onSuccess={() => {
          setUnlockModalOpen(o => ({ ...o, open: false }));
          const action = pendingActionRef.current;
          pendingActionRef.current = null;
          if (action) setTimeout(action, 0);
        }}
        mode={unlockModalOpen.mode}
        hasWebAuthn={hasWebAuthn}
      />
    </Box>
  );
}

// ── Helpers ──

const menuItemSx = { borderRadius: 1, mx: 0.5, px: 1.5, py: 0.75, minHeight: 0 };

interface FolderRowProps {
  label: string;
  count: number;
  active: boolean;
  icon: React.ReactNode;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  pinned?: boolean;
  sx?: object;
  isDragOver?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}
function FolderRow({ label, count, active, icon, onClick, onContextMenu, pinned, sx = {}, isDragOver, onDragOver, onDragLeave, onDrop }: FolderRowProps) {
  return (
    <Box
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      sx={{
        display: "flex", alignItems: "center", gap: 0.75,
        px: 1, py: 0.65, borderRadius: 1.5, cursor: "pointer",
        backgroundColor: isDragOver ? "#eef0ff" : active ? "#eef0ff" : "transparent",
        color: active ? "#6366f1" : "#64748b",
        outline: isDragOver ? "2px dashed #6366f1" : "none",
        outlineOffset: "-1px",
        "&:hover": { backgroundColor: active ? "#eef0ff" : "#f1f5f9" },
        transition: "all 0.1s",
        ...sx,
      }}
    >
      <Box sx={{ color: "inherit", display: "flex", alignItems: "center", flexShrink: 0 }}>{icon}</Box>
      <Typography sx={{ fontSize: "0.8rem", fontWeight: active ? 700 : 500, color: "inherit", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </Typography>
      {pinned && <PushPinIcon sx={{ fontSize: 11, color: active ? "#6366f1" : "#c7d2fe", flexShrink: 0, mr: 0.25 }} />}
      <Typography sx={{ fontSize: "0.72rem", color: active ? "#6366f1" : "#94a3b8", fontWeight: 600, minWidth: "1.25rem", textAlign: "right", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
        {count}
      </Typography>
    </Box>
  );
}

export default function NotesView({ onCreateTask }: Props) {
  return <NotesViewInner onCreateTask={onCreateTask} />;
}
