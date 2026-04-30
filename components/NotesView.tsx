"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import InputBase from "@mui/material/InputBase";
import Divider from "@mui/material/Divider";
import Tooltip from "@mui/material/Tooltip";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
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
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { useTaskBoardStore } from "@/lib/store";
import { Note, Folder } from "@/lib/types";

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
function matchesSearch(n: Note, q: string) {
  const lq = q.toLowerCase();
  return n.title.toLowerCase().includes(lq) || stripHtml(n.content).toLowerCase().includes(lq);
}

interface ContextMenu { x: number; y: number; note: Note }
interface Props { onCreateTask: (title: string, description: string) => void }

export default function NotesView({ onCreateTask }: Props) {
  const {
    notes, folders,
    fetchNotes, fetchFolders,
    createNote, duplicateNote, updateNote, deleteNote,
    createFolder, updateFolder, deleteFolder,
  } = useTaskBoardStore();

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

  // folder management
  const [newFolderMode, setNewFolderMode]       = useState(false);
  const [newFolderName, setNewFolderName]       = useState("");
  const [renamingFolder, setRenamingFolder]     = useState<Folder | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState("");

  // multi-select + drag-drop
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [draggedNoteIds, setDraggedNoteIds]   = useState<string[]>([]);
  const [dragOverTarget, setDragOverTarget]   = useState<DragTarget | null>(null);
  const lastClickedIdRef = useRef<string | null>(null);
  const sortedNotesRef   = useRef<Note[]>([]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { fetchNotes(); fetchFolders(); }, [fetchNotes, fetchFolders]);

  useEffect(() => {
    if (activeId === null) return;
    const note = notes.find((n) => n.id === activeId);
    if (!note) return;
    setLocalTitle(note.title);
    setLocalContent(note.content);
    setEditorKey((k) => k + 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // ── Auto-save ──
  const flush = (id: string, title: string, content: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    updateNote(id, { title, content });
  };
  const scheduleAutosave = (id: string, title: string, content: string) => {
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

  const handleDelete = async () => {
    if (activeId === null) return;
    flush(activeId, localTitle, localContent);
    await deleteNote(activeId);
    setActiveId(null); setLocalTitle(""); setLocalContent("");
    setSelectedNoteIds((prev) => { const next = new Set(prev); next.delete(activeId); return next; });
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

  const handleFolderDrop = async (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    setDragOverTarget(null);
    const ids: string[] = JSON.parse(e.dataTransfer.getData("text/plain") || "[]");
    if (ids.length === 0) return;
    await Promise.all(ids.map((id) => updateNote(id, { folderId })));
    setDraggedNoteIds([]);
  };

  // ── Context menu ──
  const openContextMenu = (e: React.MouseEvent, note: Note) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, note });
  };
  const closeContextMenu = () => setContextMenu(null);

  const ctxPin = () => {
    if (!contextMenu) return;
    updateNote(contextMenu.note.id, { pinned: !contextMenu.note.pinned });
    closeContextMenu();
  };
  const ctxStar = () => {
    if (!contextMenu) return;
    updateNote(contextMenu.note.id, { starred: !contextMenu.note.starred });
    closeContextMenu();
  };
  const ctxDuplicate = async () => {
    if (!contextMenu) return;
    const n = await duplicateNote(contextMenu.note.id);
    setActiveId(n.id);
    setSelectedNoteIds(new Set([n.id]));
    closeContextMenu();
  };
  const ctxDelete = async () => {
    if (!contextMenu) return;
    const id = contextMenu.note.id;
    closeContextMenu();
    if (id === activeId) { setActiveId(null); setLocalTitle(""); setLocalContent(""); }
    setSelectedNoteIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
    await deleteNote(id);
  };
  const ctxSendToBoard = () => {
    if (!contextMenu) return;
    onCreateTask(contextMenu.note.title || "Untitled", contextMenu.note.content);
    closeContextMenu();
  };
  const ctxMoveToFolder = (folderId: string | null) => {
    if (!contextMenu) return;
    updateNote(contextMenu.note.id, { folderId });
    closeContextMenu();
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
    if (selectedFolder === f.id) setSelectedFolder("all");
    await deleteFolder(f.id);
  };

  // ── Filtering & sorting ──
  const filteredNotes = notes.filter((n) => {
    const matchFolder =
      selectedFolder === "all"     ? true :
      selectedFolder === "starred" ? n.starred :
      selectedFolder === null      ? n.folderId === null :
      n.folderId === selectedFolder;
    return matchFolder && (!search || matchesSearch(n, search));
  });

  const sortedNotes = [...filteredNotes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const cmp = sortField === "title"
      ? (a.title || "Untitled").localeCompare(b.title || "Untitled")
      : new Date(a[sortField]).getTime() - new Date(b[sortField]).getTime();
    return sortDir === "asc" ? cmp : -cmp;
  });
  sortedNotesRef.current = sortedNotes;

  const notesPerFolder = (fid: string) => notes.filter((n) => n.folderId === fid).length;
  const starredCount   = notes.filter((n) => n.starred).length;
  const unfiled        = notes.filter((n) => n.folderId === null).length;
  const activeNote     = notes.find((n) => n.id === activeId) ?? null;
  const isDragging     = draggedNoteIds.length > 0;

  return (
    <Box sx={{ display: "flex", height: "100%", overflow: "hidden" }}>

      {/* ── Left panel ── */}
      <Box sx={{ width: 280, flexShrink: 0, borderRight: "1px solid #e2e8f0", display: "flex", flexDirection: "column", backgroundColor: "#f8fafc" }}>

        {/* Header */}
        <Box sx={{ px: 2, pt: 2.5, pb: 1.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5 }}>
            <Typography sx={{ fontWeight: 700, fontSize: "0.85rem", color: "#1e293b" }}>Notes</Typography>
            <Button size="small" startIcon={<AddIcon sx={{ fontSize: 16 }} />} onClick={handleNewNote}
              sx={{ background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)", color: "#fff", fontWeight: 700, fontSize: "0.75rem", textTransform: "none", borderRadius: 1.5, px: 1.5, py: 0.5, minWidth: 0, "&:hover": { background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" } }}>
              New
            </Button>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: 1.5, px: 1.25, py: 0.6 }}>
            <SearchIcon sx={{ fontSize: 16, color: "#94a3b8", flexShrink: 0 }} />
            <InputBase value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search notes…" sx={{ fontSize: "0.82rem", color: "#334155", flex: 1 }} />
          </Box>
        </Box>

        {/* Folder list */}
        <Box sx={{ px: 1.5, pb: 1 }}>
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
          {unfiled > 0 && (
            <FolderRow
              label="Unfiled" count={unfiled}
              active={selectedFolder === null}
              icon={<FolderOutlinedIcon sx={{ fontSize: 15 }} />}
              onClick={() => setSelectedFolder(null)}
              isDragOver={dragOverTarget === "unfiled"}
              onDragOver={(e) => handleFolderDragOver(e, "unfiled")}
              onDragLeave={handleFolderDragLeave}
              onDrop={(e) => handleFolderDrop(e, null)}
            />
          )}

          {/* User folders */}
          {folders.map((f) => (
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
                  icon={<FolderOutlinedIcon sx={{ fontSize: 15 }} />}
                  onClick={() => setSelectedFolder(f.id)}
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
        </Box>

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
          {sortedNotes.length === 0 && (
            <Box sx={{ p: 3, textAlign: "center" }}>
              <Typography sx={{ fontSize: "0.82rem", color: "#94a3b8" }}>
                {search ? "No matching notes" : "No notes yet"}
              </Typography>
            </Box>
          )}
          {sortedNotes.map((note) => {
            const isActive   = note.id === activeId;
            const isSelected = selectedNoteIds.has(note.id);
            const isDragged  = draggedNoteIds.includes(note.id);
            const preview    = stripHtml(note.content);
            const displayTitle = isActive ? (localTitle || "Untitled") : (note.title || "Untitled");
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
                  <Typography sx={{ fontWeight: isActive ? 700 : 500, fontSize: "0.85rem", color: "#1e293b", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                    {displayTitle}
                  </Typography>
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
                  {preview && <Typography sx={{ fontSize: "0.75rem", color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{preview.slice(0, 60)}</Typography>}
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* ── Editor pane ── */}
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", backgroundColor: "#fff" }}>
        {activeNote === null ? (
          <Box sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
            <NoteAltOutlinedIcon sx={{ fontSize: 52, color: "#cbd5e1" }} />
            <Typography sx={{ fontSize: "0.95rem", fontWeight: 500, color: "#94a3b8" }}>Select a note or create a new one</Typography>
            <Button startIcon={<AddIcon />} onClick={handleNewNote} variant="outlined"
              sx={{ color: "#6366f1", borderColor: "#c7d2fe", textTransform: "none", fontWeight: 600, borderRadius: 2, "&:hover": { borderColor: "#6366f1", backgroundColor: "#eef0ff" } }}>
              New Note
            </Button>
          </Box>
        ) : (
          <>
            <Box sx={{ px: 3, py: 1.5, borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                <Typography sx={{ fontSize: "0.75rem", color: "#94a3b8" }}>
                  {noteTimestamp(activeNote.updatedAt)} · auto-saved
                </Typography>
                {activeNote.folderId && folders.find((f) => f.id === activeNote.folderId) && (
                  <Typography sx={{ fontSize: "0.75rem", color: "#6366f1", display: "flex", alignItems: "center", gap: 0.25 }}>
                    <FolderOutlinedIcon sx={{ fontSize: 12 }} />
                    {folders.find((f) => f.id === activeNote.folderId)!.name}
                  </Typography>
                )}
                {activeNote.starred && (
                  <StarIcon sx={{ fontSize: 14, color: "#f59e0b" }} />
                )}
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <Button size="small" startIcon={<AddIcon sx={{ fontSize: 16 }} />} onClick={handleNewNote}
                  sx={{ color: "#475569", fontWeight: 600, fontSize: "0.8rem", textTransform: "none", backgroundColor: "#f1f5f9", borderRadius: 1.5, px: 1.5, "&:hover": { backgroundColor: "#e2e8f0" } }}>
                  New Note
                </Button>
                <Button size="small" startIcon={<TaskAltIcon sx={{ fontSize: 15 }} />} onClick={handleCreateTask}
                  sx={{ color: "#6366f1", fontWeight: 600, fontSize: "0.8rem", textTransform: "none", backgroundColor: "#eef0ff", borderRadius: 1.5, px: 1.5, "&:hover": { backgroundColor: "#e0e4ff" } }}>
                  Send to Board
                </Button>
                <IconButton size="small" onClick={handleDelete} title="Delete note"
                  sx={{ color: "#94a3b8", "&:hover": { color: "#ef4444", backgroundColor: "#fff1f2" } }}>
                  <DeleteOutlineIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Box>
            </Box>
            <Box sx={{ px: 3, pt: 3, pb: 1, flexShrink: 0 }}>
              <InputBase value={localTitle} onChange={(e) => handleTitleChange(e.target.value)} placeholder="Untitled" multiline fullWidth
                sx={{ fontSize: "1.6rem", fontWeight: 700, color: "#0f172a", lineHeight: 1.3, "& textarea": { padding: 0 } }} />
            </Box>
            <Box sx={{ px: 3, pb: 3, flex: 1, overflowY: "auto" }}>
              <RichTextEditor key={editorKey} value={localContent} onChange={handleContentChange} minHeight={400} />
            </Box>
          </>
        )}
      </Box>

      {/* ── Right-click context menu ── */}
      <Menu
        open={!!contextMenu}
        onClose={closeContextMenu}
        anchorReference="anchorPosition"
        anchorPosition={contextMenu ? { top: contextMenu.y, left: contextMenu.x } : undefined}
        slotProps={{ paper: { sx: { minWidth: 200, borderRadius: 2, boxShadow: "0 8px 32px rgba(0,0,0,0.16)", py: 0.5 } } }}
      >
        <MenuItem onClick={ctxPin} sx={menuItemSx}>
          <ListItemIcon>{contextMenu?.note.pinned ? <PushPinIcon sx={{ fontSize: 17, color: "#6366f1" }} /> : <PushPinOutlinedIcon sx={{ fontSize: 17 }} />}</ListItemIcon>
          <ListItemText primary={contextMenu?.note.pinned ? "Unpin" : "Pin to top"} slotProps={{ primary: { sx: { fontSize: "0.875rem" } } }} />
        </MenuItem>
        <MenuItem onClick={ctxStar} sx={menuItemSx}>
          <ListItemIcon>{contextMenu?.note.starred ? <StarIcon sx={{ fontSize: 17, color: "#f59e0b" }} /> : <StarBorderIcon sx={{ fontSize: 17 }} />}</ListItemIcon>
          <ListItemText primary={contextMenu?.note.starred ? "Unstar" : "Star"} slotProps={{ primary: { sx: { fontSize: "0.875rem" } } }} />
        </MenuItem>
        <MenuItem onClick={ctxDuplicate} sx={menuItemSx}>
          <ListItemIcon><ContentCopyIcon sx={{ fontSize: 17 }} /></ListItemIcon>
          <ListItemText primary="Duplicate" slotProps={{ primary: { sx: { fontSize: "0.875rem" } } }} />
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
              {contextMenu?.note.folderId === f.id ? <CheckIcon sx={{ fontSize: 17, color: "#6366f1" }} /> : <FolderOutlinedIcon sx={{ fontSize: 17 }} />}
            </ListItemIcon>
            <ListItemText primary={f.name} slotProps={{ primary: { sx: { fontSize: "0.875rem" } } }} />
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
          <ListItemText primary="Delete" slotProps={{ primary: { sx: { fontSize: "0.875rem" } } }} />
        </MenuItem>
      </Menu>
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
  sx?: object;
  isDragOver?: boolean;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}
function FolderRow({ label, count, active, icon, onClick, sx = {}, isDragOver, onDragOver, onDragLeave, onDrop }: FolderRowProps) {
  return (
    <Box
      onClick={onClick}
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
      <Typography sx={{ fontSize: "0.72rem", color: active ? "#6366f1" : "#94a3b8", fontWeight: 600, minWidth: "1.25rem", textAlign: "right", fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
        {count}
      </Typography>
    </Box>
  );
}
