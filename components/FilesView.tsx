"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import CircularProgress from "@mui/material/CircularProgress";
import Tooltip from "@mui/material/Tooltip";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import Snackbar from "@mui/material/Snackbar";
import GridViewIcon from "@mui/icons-material/GridView";
import ViewListIcon from "@mui/icons-material/ViewList";
import SortIcon from "@mui/icons-material/Sort";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import CheckIcon from "@mui/icons-material/Check";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import FolderIcon from "@mui/icons-material/Folder";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import DeleteIcon from "@mui/icons-material/Delete";
import DriveFileMoveIcon from "@mui/icons-material/DriveFileMove";
import DriveFileRenameOutlineIcon from "@mui/icons-material/DriveFileRenameOutline";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import VideoFileIcon from "@mui/icons-material/VideoFile";
import AudioFileIcon from "@mui/icons-material/AudioFile";
import FolderZipIcon from "@mui/icons-material/FolderZip";
import CloseIcon from "@mui/icons-material/Close";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { FileFolder, UploadFile } from "@/lib/types";

type SortField = "name" | "modified" | "created" | "size" | "kind";
type SortDir = "asc" | "desc";

const SORT_LABELS: Record<SortField, string> = {
  name: "Name",
  modified: "Date Modified",
  created: "Date Created",
  size: "File Size",
  kind: "Kind",
};

function fileKind(mimeType: string): string {
  if (mimeType.startsWith("image/")) {
    const sub = mimeType.split("/")[1].toUpperCase();
    return `${sub} Image`;
  }
  if (mimeType.startsWith("video/")) return "Video";
  if (mimeType.startsWith("audio/")) return "Audio";
  if (mimeType === "application/pdf") return "PDF";
  if (mimeType === "application/zip" || mimeType === "application/x-zip-compressed") return "ZIP Archive";
  if (mimeType.startsWith("text/")) return "Text";
  return mimeType.split("/")[1] ?? mimeType;
}

function sortFolders(folders: FileFolder[], field: SortField, dir: SortDir): FileFolder[] {
  return [...folders].sort((a, b) => {
    let cmp = 0;
    if (field === "modified") cmp = a.updatedAt.localeCompare(b.updatedAt);
    else if (field === "created") cmp = a.createdAt.localeCompare(b.createdAt);
    else cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    return dir === "asc" ? cmp : -cmp;
  });
}

function sortFiles(files: UploadFile[], field: SortField, dir: SortDir): UploadFile[] {
  return [...files].sort((a, b) => {
    let cmp = 0;
    if (field === "modified") cmp = a.updatedAt.localeCompare(b.updatedAt);
    else if (field === "created") cmp = a.createdAt.localeCompare(b.createdAt);
    else if (field === "size") cmp = a.size - b.size;
    else if (field === "kind") cmp = a.mimeType.localeCompare(b.mimeType);
    else cmp = a.originalName.localeCompare(b.originalName, undefined, { sensitivity: "base" });
    return dir === "asc" ? cmp : -cmp;
  });
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    + " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function FileIcon({ mimeType, size = 36 }: { mimeType: string; size?: number }) {
  const sx = { fontSize: size };
  if (mimeType.startsWith("video/")) return <VideoFileIcon sx={{ ...sx, color: "#818cf8" }} />;
  if (mimeType.startsWith("audio/")) return <AudioFileIcon sx={{ ...sx, color: "#34d399" }} />;
  if (mimeType === "application/pdf") return <PictureAsPdfIcon sx={{ ...sx, color: "#f87171" }} />;
  if (mimeType === "application/zip") return <FolderZipIcon sx={{ ...sx, color: "#fbbf24" }} />;
  return <InsertDriveFileIcon sx={{ ...sx, color: "var(--tx-4)" }} />;
}

interface BreadcrumbEntry { id: string | null; name: string }
type PendingDeleteEntry = { type: "file" | "folder"; item: UploadFile | FileFolder };

export default function FilesView() {
  const [viewMode, setViewMode] = useState<"grid" | "list">(() =>
    typeof window !== "undefined" ? (localStorage.getItem("filesViewMode") as "grid" | "list") ?? "grid" : "grid"
  );
  const [sortField, setSortField] = useState<SortField>(() =>
    typeof window !== "undefined" ? (localStorage.getItem("filesSortField") as SortField) ?? "name" : "name"
  );
  const [sortDir, setSortDir] = useState<SortDir>(() =>
    typeof window !== "undefined" ? (localStorage.getItem("filesSortDir") as SortDir) ?? "asc" : "asc"
  );
  const [sortAnchor, setSortAnchor] = useState<null | HTMLElement>(null);

  const [stack, setStack] = useState<BreadcrumbEntry[]>([{ id: null, name: "Files" }]);
  const currentFolder = stack[stack.length - 1];

  const [folders, setFolders] = useState<FileFolder[]>([]);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [loading, setLoading] = useState(true);

  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderError, setNewFolderError] = useState<string | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<FileFolder | null>(null);
  const [renameName, setRenameName] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renamingFile, setRenamingFile] = useState<UploadFile | null>(null);
  const [renameFileName, setRenameFileName] = useState("");
  const [renameFileError, setRenameFileError] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  // Context menu
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);
  const [menuTarget, setMenuTarget] = useState<{ type: "file" | "folder"; item: UploadFile | FileFolder } | null>(null);
  const [movePickerOpen, setMovePickerOpen] = useState(false);
  const [moveSuccessMsg, setMoveSuccessMsg] = useState<string | null>(null);

  // Attach picker
  const [attachMode, setAttachMode] = useState<"note" | "task" | null>(null);
  const [attachSearch, setAttachSearch] = useState("");
  const [attachItems, setAttachItems] = useState<{ id: string; title: string }[]>([]);
  const [attachLoading, setAttachLoading] = useState(false);
  const [attachSuccessMsg, setAttachSuccessMsg] = useState<string | null>(null);
  const attachFileRef = useRef<UploadFile | null>(null);

  // Undo-delete
  const [pendingDelete, setPendingDelete] = useState<PendingDeleteEntry[] | null>(null);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDeleteRef = useRef<PendingDeleteEntry[] | null>(null);

  // Selection
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [lastSelectedFileId, setLastSelectedFileId] = useState<string | null>(null);

  // Lightbox
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxFileId, setLightboxFileId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const fid = currentFolder.id;
    const folderQs = fid ? `?parentId=${fid}` : "";
    const fileQs = fid ? `?folderId=${fid}` : "";
    const [fRes, uRes] = await Promise.all([
      fetch(`/api/file-folders${folderQs}`),
      fetch(`/api/files${fileQs}`),
    ]);
    if (fRes.ok && uRes.ok) {
      const [f, u] = await Promise.all([fRes.json(), uRes.json()]);
      setFolders(f);
      setFiles(u);
    }
    setLoading(false);
  }, [currentFolder.id]);

  useEffect(() => { load(); }, [load]);

  // Clear selection when changing folder
  useEffect(() => {
    setSelectedFileIds(new Set());
    setLastSelectedFileId(null);
    setLightboxOpen(false);
    setLightboxFileId(null);
  }, [currentFolder.id]);

  // Navigate to a specific folder when dispatched from global search
  useEffect(() => {
    const handler = async (e: Event) => {
      const { folderId } = (e as CustomEvent<{ folderId: string }>).detail;
      const res = await fetch(`/api/file-folders/${folderId}`);
      if (!res.ok) return;
      const folder: FileFolder = await res.json();
      setStack([{ id: null, name: "Files" }, { id: folder.id, name: folder.name }]);
    };
    window.addEventListener("files:openFolder", handler);
    return () => window.removeEventListener("files:openFolder", handler);
  }, []);

  const sortedFolders = sortFolders(folders, sortField, sortDir);
  const sortedFiles = sortFiles(files, sortField, sortDir);

  const handleFileClick = useCallback((file: UploadFile, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      setSelectedFileIds(prev => {
        const next = new Set(prev);
        if (next.has(file.id)) next.delete(file.id);
        else next.add(file.id);
        return next;
      });
      setLastSelectedFileId(file.id);
    } else if (e.shiftKey && lastSelectedFileId) {
      window.getSelection()?.removeAllRanges();
      const ids = sortedFiles.map(f => f.id);
      const from = ids.indexOf(lastSelectedFileId);
      const to = ids.indexOf(file.id);
      if (from !== -1 && to !== -1) {
        const [lo, hi] = from < to ? [from, to] : [to, from];
        setSelectedFileIds(new Set(ids.slice(lo, hi + 1)));
      }
    } else {
      setSelectedFileIds(new Set([file.id]));
      setLastSelectedFileId(file.id);
    }
  }, [lastSelectedFileId, sortedFiles]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;

      if (lightboxOpen && lightboxFileId) {
        if (e.key === "Escape") { setLightboxOpen(false); return; }
        if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          const idx = sortedFiles.findIndex(f => f.id === lightboxFileId);
          const nextIdx = e.key === "ArrowUp" ? idx - 1 : idx + 1;
          if (nextIdx >= 0 && nextIdx < sortedFiles.length) {
            const nf = sortedFiles[nextIdx];
            setLightboxFileId(nf.id);
            setSelectedFileIds(new Set([nf.id]));
            setLastSelectedFileId(nf.id);
          }
          return;
        }
        if ((e.metaKey || e.ctrlKey) && e.key === "Backspace") {
          e.preventDefault();
          const file = sortedFiles.find(f => f.id === lightboxFileId);
          if (!file) return;
          const idx = sortedFiles.findIndex(f => f.id === lightboxFileId);
          const nextFile = sortedFiles[idx + 1] ?? sortedFiles[idx - 1] ?? null;
          setFiles(prev => prev.filter(f => f.id !== file.id));
          if (nextFile) {
            setLightboxFileId(nextFile.id);
            setSelectedFileIds(new Set([nextFile.id]));
            setLastSelectedFileId(nextFile.id);
          } else {
            setLightboxOpen(false);
            setLightboxFileId(null);
            setSelectedFileIds(new Set());
            setLastSelectedFileId(null);
          }
          if (deleteTimerRef.current) {
            clearTimeout(deleteTimerRef.current);
            deleteTimerRef.current = null;
            const prev = pendingDeleteRef.current;
            if (prev) Promise.all(prev.map(entry => fetch(entry.type === "file" ? `/api/files/${entry.item.id}` : `/api/file-folders/${entry.item.id}`, { method: "DELETE" }))).then(results => { if (results.some(r => !r.ok)) load(); });
          }
          const newPending: PendingDeleteEntry[] = [{ type: "file", item: file }];
          setPendingDelete(newPending);
          pendingDeleteRef.current = newPending;
          deleteTimerRef.current = setTimeout(async () => {
            await fetch(`/api/files/${file.id}`, { method: "DELETE" });
            setPendingDelete(null);
            pendingDeleteRef.current = null;
            deleteTimerRef.current = null;
          }, 5000);
          return;
        }
      } else {
        if (!inInput && e.key === "Escape" && selectedFileIds.size > 0) {
          setSelectedFileIds(new Set());
          setLastSelectedFileId(null);
          return;
        }
        if (!inInput && e.key === " " && selectedFileIds.size > 0) {
          e.preventDefault();
          const first = sortedFiles.find(f => selectedFileIds.has(f.id));
          if (first) { setLightboxFileId(first.id); setLightboxOpen(true); }
          return;
        }
        if (!inInput && (e.metaKey || e.ctrlKey) && e.key === "Backspace" && selectedFileIds.size > 0) {
          e.preventDefault();
          const toDelete = sortedFiles.filter(f => selectedFileIds.has(f.id));
          setFiles(prev => prev.filter(f => !selectedFileIds.has(f.id)));
          setSelectedFileIds(new Set());
          setLastSelectedFileId(null);
          if (deleteTimerRef.current) {
            clearTimeout(deleteTimerRef.current);
            deleteTimerRef.current = null;
            const prev = pendingDeleteRef.current;
            if (prev) Promise.all(prev.map(entry => fetch(entry.type === "file" ? `/api/files/${entry.item.id}` : `/api/file-folders/${entry.item.id}`, { method: "DELETE" }))).then(results => { if (results.some(r => !r.ok)) load(); });
          }
          const newPending = toDelete.map(f => ({ type: "file" as const, item: f }));
          setPendingDelete(newPending);
          pendingDeleteRef.current = newPending;
          deleteTimerRef.current = setTimeout(async () => {
            await Promise.all(toDelete.map(f => fetch(`/api/files/${f.id}`, { method: "DELETE" })));
            setPendingDelete(null);
            pendingDeleteRef.current = null;
            deleteTimerRef.current = null;
          }, 5000);
          return;
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [lightboxOpen, lightboxFileId, selectedFileIds, sortedFiles]);

  const toggleView = (mode: "grid" | "list") => {
    setViewMode(mode);
    localStorage.setItem("filesViewMode", mode);
  };

  const setSort = (field: SortField) => {
    const newDir: SortDir = field === sortField && sortDir === "asc" ? "desc" : "asc";
    setSortField(field);
    setSortDir(newDir);
    localStorage.setItem("filesSortField", field);
    localStorage.setItem("filesSortDir", newDir);
    setSortAnchor(null);
  };

  const enterFolder = (folder: FileFolder) => {
    setStack((s) => [...s, { id: folder.id, name: folder.name }]);
  };

  const navigateTo = (index: number) => {
    setStack((s) => s.slice(0, index + 1));
  };

  const uploadFiles = async (chosen: File[]) => {
    if (!chosen.length) return;
    setUploading(true);
    setUploadError(null);
    const errors: string[] = [];
    const uploadFolderId = currentFolder.id;
    for (const f of chosen) {
      const fd = new FormData();
      fd.append("file", f);
      if (uploadFolderId) fd.append("folderId", uploadFolderId);
      const res = await fetch("/api/files", { method: "POST", body: fd });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        errors.push(`${f.name}: ${d.error ?? "Upload failed"}`);
      }
    }
    if (errors.length) setUploadError(errors.join(" · "));
    await load();
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) =>
    uploadFiles(Array.from(e.target.files ?? []));

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current += 1;
    if (e.dataTransfer.types.includes("Files")) setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);

    const items = Array.from(e.dataTransfer.items);
    const hasDirectory = items.some((item) => item.kind === "file" && (item.webkitGetAsEntry?.()?.isDirectory ?? false));
    if (hasDirectory) {
      setUploadError("Folders cannot be uploaded. Please select individual files.");
      return;
    }

    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length) uploadFiles(dropped);
  };

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    setNewFolderError(null);
    const res = await fetch("/api/file-folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newFolderName.trim(), parentId: currentFolder.id }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setNewFolderError(d.error ?? "Failed to create folder");
      return;
    }
    setNewFolderOpen(false);
    setNewFolderName("");
    load();
  };

  const renameFolder = async () => {
    if (!renamingFolder || !renameName.trim()) return;
    setRenameError(null);
    const res = await fetch(`/api/file-folders/${renamingFolder.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: renameName.trim() }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setRenameError(d.error ?? "Failed to rename folder");
      return;
    }
    setRenamingFolder(null);
    load();
  };

  const renameFile = async () => {
    if (!renamingFile || !renameFileName.trim()) return;
    setRenameFileError(null);
    const res = await fetch(`/api/files/${renamingFile.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ originalName: renameFileName.trim() }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setRenameFileError(d.error ?? "Failed to rename file");
      return;
    }
    setRenamingFile(null);
    load();
  };

  const deleteItem = () => {
    if (!menuTarget) return;
    const target = menuTarget;
    setMenuPos(null);
    setMenuTarget(null);

    if (target.type === "folder") {
      setFolders((prev) => prev.filter((f) => f.id !== target.item.id));
    } else {
      setFiles((prev) => prev.filter((f) => f.id !== target.item.id));
    }

    if (deleteTimerRef.current) {
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = null;
      const prev = pendingDeleteRef.current;
      if (prev) Promise.all(prev.map(entry => fetch(entry.type === "file" ? `/api/files/${entry.item.id}` : `/api/file-folders/${entry.item.id}`, { method: "DELETE" }))).then(results => { if (results.some(r => !r.ok)) load(); });
    }
    setPendingDelete([target]);
    pendingDeleteRef.current = [target];

    deleteTimerRef.current = setTimeout(async () => {
      const url = target.type === "folder"
        ? `/api/file-folders/${target.item.id}`
        : `/api/files/${target.item.id}`;
      const res = await fetch(url, { method: "DELETE" });
      setPendingDelete(null);
      pendingDeleteRef.current = null;
      deleteTimerRef.current = null;
      if (!res.ok) load();
    }, 5000);
  };

  const undoDelete = () => {
    if (deleteTimerRef.current) { clearTimeout(deleteTimerRef.current); deleteTimerRef.current = null; }
    setPendingDelete(null);
    pendingDeleteRef.current = null;
    load();
  };

  const startMove = () => {
    setMenuPos(null);
    setMovePickerOpen(true);
  };

  const moveItem = async (folderId: string | null) => {
    if (!menuTarget) return;
    setMoveError(null);
    const url = menuTarget.type === "folder"
      ? `/api/file-folders/${menuTarget.item.id}`
      : `/api/files/${menuTarget.item.id}`;
    const body = menuTarget.type === "folder" ? { parentId: folderId } : { folderId };
    const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setMoveError(d.error ?? "Move failed");
      return;
    }
    setMovePickerOpen(false);
    const name = menuTarget.type === "folder" ? (menuTarget.item as FileFolder).name : (menuTarget.item as UploadFile).originalName;
    setMoveSuccessMsg(`"${name}" moved`);
    setMenuTarget(null);
    load();
  };

  const openFile = (file: UploadFile) => {
    window.open(`/api/files/${file.id}`, "_blank");
  };

  const openMenu = (e: React.MouseEvent<HTMLElement>, type: "file" | "folder", item: UploadFile | FileFolder) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    // right-click: use mouse pos; button click: use button bottom-left
    const isRightClick = e.type === "contextmenu";
    setMenuPos(isRightClick ? { left: e.clientX, top: e.clientY } : { left: rect.left, top: rect.bottom });
    setMenuTarget({ type, item });
  };

  const openAttachPicker = useCallback(async (mode: "note" | "task") => {
    attachFileRef.current = menuTarget?.type === "file" ? menuTarget.item as UploadFile : null;
    setMenuPos(null);
    setAttachMode(mode);
    setAttachSearch("");
    setAttachItems([]);
    setAttachLoading(true);
    if (mode === "note") {
      const res = await fetch("/api/notes");
      if (res.ok) {
        const data = await res.json() as { id: string; title: string; deletedAt?: string | null }[];
        setAttachItems(data.filter(n => !n.deletedAt).map(n => ({ id: n.id, title: n.title || "(untitled)" })));
      }
    } else {
      const res = await fetch("/api/tasks");
      if (res.ok) {
        const data = await res.json() as { id: string; title: string; archived?: boolean; stage?: string }[];
        setAttachItems(data.filter(t => !t.archived && t.stage !== "done").map(t => ({ id: t.id, title: t.title || "(untitled)" })));
      }
    }
    setAttachLoading(false);
  }, [menuTarget]);

  const handleAttach = useCallback(async (targetId: string) => {
    const file = attachFileRef.current;
    if (!file || !attachMode) return;
    const body = attachMode === "note"
      ? { uploadId: file.id, noteId: targetId }
      : { uploadId: file.id, taskId: targetId };
    const res = await fetch("/api/attachments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    attachFileRef.current = null;
    setAttachMode(null);
    setMenuTarget(null);
    if (res.ok) {
      setAttachSuccessMsg(`Attached to ${attachMode}`);
      load();
    }
  }, [attachMode, load]);

  const isEmpty = !loading && folders.length === 0 && files.length === 0;

  const lightboxFile = lightboxFileId ? sortedFiles.find(f => f.id === lightboxFileId) : undefined;
  const lightboxIdx = lightboxFile ? sortedFiles.findIndex(f => f.id === lightboxFileId) : -1;

  const pendingDeleteMsg = pendingDelete
    ? pendingDelete.length === 1
      ? `Deleted "${pendingDelete[0].type === "file" ? (pendingDelete[0].item as UploadFile).originalName : (pendingDelete[0].item as FileFolder).name}"${pendingDelete[0].type === "file" ? " — links in notes/tasks also removed" : ""}`
      : `Deleted ${pendingDelete.length} files`
    : "";

  return (
    <Box
      sx={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: "var(--surface-2)", position: "relative" }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onClick={() => {
        if (selectedFileIds.size > 0) {
          setSelectedFileIds(new Set());
          setLastSelectedFileId(null);
        }
      }}
    >
      {/* Drop overlay */}
      {isDragging && (
        <Box sx={{
          position: "absolute", inset: 0, zIndex: 10,
          backgroundColor: "rgba(99,102,241,0.08)",
          border: "2px dashed #6366f1",
          borderRadius: 2,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 1.5, pointerEvents: "none",
        }}>
          <UploadFileIcon sx={{ fontSize: 48, color: "#6366f1", opacity: 0.7 }} />
          <Typography sx={{ color: "#6366f1", fontWeight: 600, fontSize: "1rem" }}>
            Drop files to upload
          </Typography>
          {currentFolder.id && (
            <Typography sx={{ color: "var(--tx-3)", fontSize: "0.82rem" }}>
              into &ldquo;{currentFolder.name}&rdquo;
            </Typography>
          )}
        </Box>
      )}

      {/* Header */}
      <Box sx={{
        display: "flex", alignItems: "center", gap: 1,
        px: 3, py: 1.5,
        backgroundColor: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
      }}>
        {/* Breadcrumb */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flex: 1, minWidth: 0, flexWrap: "wrap" }}>
          {stack.length > 1 && (
            <IconButton size="small" onClick={() => navigateTo(stack.length - 2)} sx={{ color: "var(--tx-3)" }}>
              <ArrowBackIcon fontSize="small" />
            </IconButton>
          )}
          {stack.map((entry, i) => (
            <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              {i > 0 && <Typography sx={{ color: "var(--tx-4)", fontSize: "0.85rem" }}>/</Typography>}
              <Typography
                onClick={() => i < stack.length - 1 && navigateTo(i)}
                sx={{
                  fontSize: "0.9rem",
                  fontWeight: i === stack.length - 1 ? 700 : 500,
                  color: i === stack.length - 1 ? "var(--tx)" : "#6366f1",
                  cursor: i < stack.length - 1 ? "pointer" : "default",
                  "&:hover": i < stack.length - 1 ? { textDecoration: "underline" } : {},
                }}
              >
                {entry.name}
              </Typography>
            </Box>
          ))}
        </Box>

        {/* Selection count hint */}
        {selectedFileIds.size > 0 && (
          <Typography sx={{ fontSize: "0.78rem", color: "#6366f1", fontWeight: 600, flexShrink: 0 }}>
            {selectedFileIds.size} selected · Space to preview · ⌘⌫ to delete
          </Typography>
        )}

        {/* Actions */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
          <Tooltip title="List view">
            <IconButton size="small" onClick={() => toggleView("list")} sx={{ color: viewMode === "list" ? "#6366f1" : "var(--tx-2)" }}>
              <ViewListIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Grid view">
            <IconButton size="small" onClick={() => toggleView("grid")} sx={{ color: viewMode === "grid" ? "#6366f1" : "var(--tx-2)" }}>
              <GridViewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={`Sort: ${SORT_LABELS[sortField]}`}>
            <IconButton size="small" onClick={(e) => setSortAnchor(e.currentTarget)} sx={{ color: "var(--tx-2)" }}>
              <SortIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="New folder">
            <IconButton size="small" onClick={() => { setNewFolderName(""); setNewFolderOpen(true); }} sx={{ color: "var(--tx-4)", "&:hover": { color: "#6366f1" } }}>
              <CreateNewFolderIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={handleUpload}
          />
          <Button
            size="small"
            variant="contained"
            startIcon={uploading ? <CircularProgress size={14} sx={{ color: "#fff" }} /> : <UploadFileIcon />}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            sx={{ backgroundColor: "#6366f1", "&:hover": { backgroundColor: "#4f46e5" }, borderRadius: 2, textTransform: "none", fontWeight: 600, fontSize: "0.8rem" }}
          >
            {uploading ? "Uploading…" : "Upload"}
          </Button>
        </Box>
      </Box>

      {uploadError && (
        <Box sx={{ px: 3, py: 1, backgroundColor: "#fef2f2", borderBottom: "1px solid #fecaca" }}>
          <Typography sx={{ fontSize: "0.8rem", color: "#dc2626" }}>{uploadError}</Typography>
        </Box>
      )}

      {/* Content */}
      <Box sx={{ flex: 1, overflowY: "auto", p: 3 }} onClick={(e) => e.stopPropagation()}>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", pt: 8 }}>
            <CircularProgress sx={{ color: "#6366f1" }} />
          </Box>
        ) : isEmpty ? (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pt: 10, gap: 2 }}>
            <FolderIcon sx={{ fontSize: 64, color: "var(--border-2)" }} />
            <Typography sx={{ color: "var(--tx-4)", fontSize: "0.95rem" }}>This folder is empty</Typography>
            <Button
              variant="outlined"
              startIcon={<UploadFileIcon />}
              onClick={() => fileInputRef.current?.click()}
              sx={{ borderColor: "#6366f1", color: "#6366f1", textTransform: "none", borderRadius: 2 }}
            >
              Upload a file
            </Button>
          </Box>
        ) : viewMode === "grid" ? (
          <GridView
            folders={sortedFolders}
            files={sortedFiles}
            selectedFileIds={selectedFileIds}
            onEnterFolder={enterFolder}
            onFileClick={handleFileClick}
            onOpenFile={openFile}
            onMenu={openMenu}
          />
        ) : (
          <ListView
            folders={sortedFolders}
            files={sortedFiles}
            selectedFileIds={selectedFileIds}
            onEnterFolder={enterFolder}
            onFileClick={handleFileClick}
            onOpenFile={openFile}
            onMenu={openMenu}
            sortField={sortField}
            sortDir={sortDir}
            onSort={setSort}
          />
        )}
      </Box>

      {/* Sort menu */}
      <Menu anchorEl={sortAnchor} open={Boolean(sortAnchor)} onClose={() => setSortAnchor(null)}
        slotProps={{ paper: { sx: { backgroundColor: "var(--surface)", border: "1px solid var(--border)", borderRadius: 2, minWidth: 180 } } }}>
        {(["name", "modified", "created", "size", "kind"] as SortField[]).map((field) => (
          <MenuItem key={field} onClick={() => setSort(field)} sx={{ color: "var(--tx)", fontSize: "0.875rem", gap: 1 }}>
            <ListItemIcon sx={{ minWidth: 0, color: field === sortField ? "#6366f1" : "transparent" }}>
              {field === sortField ? (sortDir === "asc" ? <ArrowUpwardIcon fontSize="small" /> : <ArrowDownwardIcon fontSize="small" />) : <CheckIcon fontSize="small" sx={{ opacity: 0 }} />}
            </ListItemIcon>
            <Typography sx={{ flex: 1, fontSize: "0.875rem", color: field === sortField ? "#6366f1" : "var(--tx)", fontWeight: field === sortField ? 600 : 400 }}>
              {SORT_LABELS[field]}
            </Typography>
          </MenuItem>
        ))}
      </Menu>

      {/* Context menu */}
      <Menu anchorReference="anchorPosition" anchorPosition={menuPos ?? undefined} open={Boolean(menuPos)} onClose={() => { setMenuPos(null); setMenuTarget(null); }}>
        {menuTarget?.type === "file" && (
          <MenuItem onClick={() => { openFile(menuTarget.item as UploadFile); setMenuPos(null); setMenuTarget(null); }}>
            <OpenInNewIcon fontSize="small" sx={{ mr: 1, color: "var(--tx-3)" }} />
            Open
          </MenuItem>
        )}
        {menuTarget?.type === "file" && (
          <MenuItem onClick={() => { const f = menuTarget.item as UploadFile; setLightboxFileId(f.id); setLightboxOpen(true); setMenuPos(null); setMenuTarget(null); }}>
            <OpenInNewIcon fontSize="small" sx={{ mr: 1, color: "var(--tx-3)" }} /> Preview
          </MenuItem>
        )}
        {menuTarget?.type === "file" && (
          <MenuItem onClick={() => openAttachPicker("note")}>
            <InsertDriveFileIcon fontSize="small" sx={{ mr: 1, color: "var(--tx-3)" }} /> Add to note…
          </MenuItem>
        )}
        {menuTarget?.type === "file" && (
          <MenuItem onClick={() => openAttachPicker("task")}>
            <CheckIcon fontSize="small" sx={{ mr: 1, color: "var(--tx-3)" }} /> Add to task…
          </MenuItem>
        )}
        {menuTarget?.type === "folder" && (
          <MenuItem onClick={() => {
            setRenameName((menuTarget.item as FileFolder).name);
            setRenameError(null);
            setRenamingFolder(menuTarget.item as FileFolder);
            setMenuPos(null);
          }}>
            <DriveFileRenameOutlineIcon fontSize="small" sx={{ mr: 1, color: "var(--tx-3)" }} />
            Rename
          </MenuItem>
        )}
        {menuTarget?.type === "file" && (
          <MenuItem onClick={() => {
            setRenameFileName((menuTarget.item as UploadFile).originalName);
            setRenameFileError(null);
            setRenamingFile(menuTarget.item as UploadFile);
            setMenuPos(null);
          }}>
            <DriveFileRenameOutlineIcon fontSize="small" sx={{ mr: 1, color: "var(--tx-3)" }} />
            Rename
          </MenuItem>
        )}
        <MenuItem onClick={startMove}>
          <DriveFileMoveIcon fontSize="small" sx={{ mr: 1, color: "var(--tx-3)" }} />
          Move to…
        </MenuItem>
        <MenuItem onClick={deleteItem} sx={{ color: "#dc2626" }}>
          <DeleteIcon fontSize="small" sx={{ mr: 1 }} />
          {menuTarget?.type === "folder" ? "Delete folder" : "Delete file"}
        </MenuItem>
      </Menu>

      {/* Move picker */}
      <MovePicker
        open={movePickerOpen}
        excludeId={menuTarget?.type === "folder" ? menuTarget.item.id : null}
        moveError={moveError}
        onMove={moveItem}
        onClose={() => { setMovePickerOpen(false); setMenuTarget(null); setMoveError(null); }}
      />

      {/* Attach picker dialog */}
      <Dialog open={Boolean(attachMode)} onClose={() => { setAttachMode(null); setAttachSearch(""); }} maxWidth="xs" fullWidth
        slotProps={{ paper: { sx: { backgroundColor: "var(--surface)", borderRadius: 3, border: "1px solid var(--border)" } } }}>
        <DialogTitle sx={{ color: "var(--tx)", fontWeight: 700, pb: 1 }}>
          Add to {attachMode === "note" ? "Note" : "Task"}…
        </DialogTitle>
        <DialogContent sx={{ pt: 0 }}>
          <TextField
            autoFocus fullWidth size="small"
            placeholder={`Search ${attachMode === "note" ? "notes" : "tasks"}…`}
            value={attachSearch}
            onChange={(e) => setAttachSearch(e.target.value)}
            sx={{ mb: 1, "& .MuiInputBase-input": { color: "var(--tx)" }, "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--border)" } }}
          />
          {attachLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}><CircularProgress size={24} sx={{ color: "#6366f1" }} /></Box>
          ) : (
            <Box sx={{ maxHeight: 280, overflowY: "auto" }}>
              {attachItems
                .filter(i => !attachSearch.trim() || i.title.toLowerCase().includes(attachSearch.toLowerCase()))
                .map(item => (
                  <Box
                    key={item.id}
                    onClick={() => handleAttach(item.id)}
                    sx={{
                      py: 1.25, px: 1.5, cursor: "pointer", borderRadius: 1,
                      "&:hover": { backgroundColor: "var(--surface-2)" },
                      borderBottom: "1px solid var(--border)",
                    }}
                  >
                    <Typography sx={{ fontSize: "0.875rem", color: "var(--tx)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.title}
                    </Typography>
                  </Box>
                ))}
              {!attachLoading && attachItems.filter(i => !attachSearch.trim() || i.title.toLowerCase().includes(attachSearch.toLowerCase())).length === 0 && (
                <Typography sx={{ color: "var(--tx-4)", fontSize: "0.85rem", py: 2, textAlign: "center" }}>
                  No {attachMode === "note" ? "notes" : "tasks"} found
                </Typography>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => { setAttachMode(null); setAttachSearch(""); }} sx={{ color: "var(--tx-4)", textTransform: "none" }}>Cancel</Button>
        </DialogActions>
      </Dialog>

      {/* New folder dialog */}
      <Dialog open={newFolderOpen} onClose={() => { setNewFolderOpen(false); setNewFolderError(null); }} maxWidth="xs" fullWidth
        slotProps={{ paper: { sx: { backgroundColor: "var(--surface)", borderRadius: 3, border: "1px solid var(--border)" } } }}>
        <DialogTitle sx={{ color: "var(--tx)", fontWeight: 700, pb: 1 }}>New Folder</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus fullWidth size="small" placeholder="Folder name"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createFolder()}
            sx={{ mt: 1, "& .MuiInputBase-input": { color: "var(--tx)" }, "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--border)" } }}
          />
          {newFolderError && <Typography sx={{ color: "#f87171", fontSize: "0.78rem", mt: 1 }}>{newFolderError}</Typography>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => { setNewFolderOpen(false); setNewFolderError(null); }} sx={{ color: "var(--tx-4)", textTransform: "none" }}>Cancel</Button>
          <Button onClick={createFolder} variant="contained" sx={{ backgroundColor: "#6366f1", textTransform: "none", borderRadius: 2 }}>Create</Button>
        </DialogActions>
      </Dialog>

      {/* Rename folder dialog */}
      <Dialog open={Boolean(renamingFolder)} onClose={() => { setRenamingFolder(null); setRenameError(null); }} maxWidth="xs" fullWidth
        slotProps={{ paper: { sx: { backgroundColor: "var(--surface)", borderRadius: 3, border: "1px solid var(--border)" } } }}>
        <DialogTitle sx={{ color: "var(--tx)", fontWeight: 700, pb: 1 }}>Rename Folder</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus fullWidth size="small"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && renameFolder()}
            sx={{ mt: 1, "& .MuiInputBase-input": { color: "var(--tx)" }, "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--border)" } }}
          />
          {renameError && <Typography sx={{ color: "#f87171", fontSize: "0.78rem", mt: 1 }}>{renameError}</Typography>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => { setRenamingFolder(null); setRenameError(null); }} sx={{ color: "var(--tx-4)", textTransform: "none" }}>Cancel</Button>
          <Button onClick={renameFolder} variant="contained" sx={{ backgroundColor: "#6366f1", textTransform: "none", borderRadius: 2 }}>Rename</Button>
        </DialogActions>
      </Dialog>

      {/* Rename file dialog */}
      <Dialog open={Boolean(renamingFile)} onClose={() => { setRenamingFile(null); setRenameFileError(null); }} maxWidth="xs" fullWidth
        slotProps={{ paper: { sx: { backgroundColor: "var(--surface)", borderRadius: 3, border: "1px solid var(--border)" } } }}>
        <DialogTitle sx={{ color: "var(--tx)", fontWeight: 700, pb: 1 }}>Rename File</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus fullWidth size="small"
            value={renameFileName}
            onChange={(e) => setRenameFileName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && renameFile()}
            sx={{ mt: 1, "& .MuiInputBase-input": { color: "var(--tx)" }, "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--border)" } }}
          />
          {renameFileError && <Typography sx={{ color: "#f87171", fontSize: "0.78rem", mt: 1 }}>{renameFileError}</Typography>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => { setRenamingFile(null); setRenameFileError(null); }} sx={{ color: "var(--tx-4)", textTransform: "none" }}>Cancel</Button>
          <Button onClick={renameFile} variant="contained" sx={{ backgroundColor: "#6366f1", textTransform: "none", borderRadius: 2 }}>Rename</Button>
        </DialogActions>
      </Dialog>

      {/* Move success snackbar */}
      <Snackbar
        open={Boolean(moveSuccessMsg)}
        autoHideDuration={2500}
        onClose={() => setMoveSuccessMsg(null)}
        message={moveSuccessMsg ?? ""}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        slotProps={{ content: { sx: { backgroundColor: "var(--surface)", color: "var(--tx)", border: "1px solid var(--border)", borderRadius: 2 } } }}
      />

      {/* Attach success snackbar */}
      <Snackbar
        open={Boolean(attachSuccessMsg)}
        autoHideDuration={2500}
        onClose={() => setAttachSuccessMsg(null)}
        message={attachSuccessMsg ?? ""}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        slotProps={{ content: { sx: { backgroundColor: "var(--surface)", color: "var(--tx)", border: "1px solid var(--border)", borderRadius: 2 } } }}
      />

      {/* Undo-delete snackbar */}
      <Snackbar
        open={Boolean(pendingDelete)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        message={pendingDeleteMsg}
        action={
          <Button size="small" onClick={undoDelete} sx={{ color: "#a5b4fc", fontWeight: 700, textTransform: "none" }}>
            Undo
          </Button>
        }
        slotProps={{ content: { sx: { backgroundColor: "var(--surface)", color: "var(--tx)", border: "1px solid var(--border)", borderRadius: 2 } } }}
      />

      {/* Lightbox */}
      <Lightbox
        file={lightboxFile}
        files={sortedFiles}
        open={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        onNavigate={(fileId) => {
          setLightboxFileId(fileId);
          setSelectedFileIds(new Set([fileId]));
          setLastSelectedFileId(fileId);
        }}
      />
    </Box>
  );
}

// ── Grid view ────────────────────────────────────────────────────────────────

function GridView({ folders, files, selectedFileIds, onEnterFolder, onFileClick, onOpenFile, onMenu }: {
  folders: FileFolder[];
  files: UploadFile[];
  selectedFileIds: Set<string>;
  onEnterFolder: (f: FileFolder) => void;
  onFileClick: (f: UploadFile, e: React.MouseEvent) => void;
  onOpenFile: (f: UploadFile) => void;
  onMenu: (e: React.MouseEvent<HTMLElement>, type: "file" | "folder", item: UploadFile | FileFolder) => void;
}) {
  return (
    <Box>
      {folders.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--tx-4)", textTransform: "uppercase", letterSpacing: 1, mb: 1.5 }}>Folders</Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 1.5 }}>
            {folders.map((f) => (
              <FolderCard key={f.id} folder={f} onEnter={() => onEnterFolder(f)} onMenu={onMenu} />
            ))}
          </Box>
        </Box>
      )}
      {files.length > 0 && (
        <Box>
          {folders.length > 0 && (
            <Typography sx={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--tx-4)", textTransform: "uppercase", letterSpacing: 1, mb: 1.5 }}>Files</Typography>
          )}
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 1.5 }}>
            {files.map((f) => (
              <FileCard
                key={f.id}
                file={f}
                selected={selectedFileIds.has(f.id)}
                onClick={onFileClick}
                onOpen={() => onOpenFile(f)}
                onMenu={onMenu}
              />
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}

function FolderCard({ folder, onEnter, onMenu }: { folder: FileFolder; onEnter: () => void; onMenu: (e: React.MouseEvent<HTMLElement>, type: "file" | "folder", item: FileFolder) => void }) {
  const count = folder._count.uploads + folder._count.children;
  return (
    <Box
      onClick={onEnter}
      sx={{
        position: "relative",
        backgroundColor: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 2,
        p: 2,
        cursor: "pointer",
        transition: "border-color 0.15s, box-shadow 0.15s",
        "&:hover": { borderColor: "#6366f1", boxShadow: "0 0 0 1px #6366f1" },
      }}
    >
      <IconButton
        size="small"
        onClick={(e) => onMenu(e, "folder", folder)}
        sx={{ position: "absolute", top: 4, right: 4, color: "var(--tx-4)", opacity: 0, ".MuiBox-root:hover &": { opacity: 1 } }}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <FolderIcon sx={{ fontSize: 40, color: "#fbbf24", mb: 1 }} />
      <Typography sx={{ fontSize: "0.82rem", fontWeight: 600, color: "var(--tx)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {folder.name}
      </Typography>
      <Typography sx={{ fontSize: "0.72rem", color: "var(--tx-4)" }}>
        {count === 0 ? "Empty" : `${count} item${count !== 1 ? "s" : ""}`}
      </Typography>
    </Box>
  );
}

function FileCard({ file, selected, onClick, onOpen, onMenu }: {
  file: UploadFile;
  selected: boolean;
  onClick: (f: UploadFile, e: React.MouseEvent) => void;
  onOpen: () => void;
  onMenu: (e: React.MouseEvent<HTMLElement>, type: "file" | "folder", item: UploadFile) => void;
}) {
  const [imgError, setImgError] = useState(false);
  const isImg = file.mimeType.startsWith("image/") && !imgError;
  return (
    <Box
      onClick={(e) => { e.stopPropagation(); onClick(file, e); }}
      onDoubleClick={(e) => { e.stopPropagation(); onOpen(); }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onMenu(e, "file", file); }}
      sx={{
        position: "relative",
        backgroundColor: "var(--surface)",
        border: selected ? "2px solid #6366f1" : "1px solid var(--border)",
        borderRadius: 2,
        overflow: "hidden",
        cursor: "pointer",
        transition: "border-color 0.15s, box-shadow 0.15s",
        boxShadow: selected ? "0 0 0 1px #6366f1" : "none",
        "&:hover": { borderColor: "#6366f1", boxShadow: "0 0 0 1px #6366f1" },
      }}
    >
      {selected && (
        <Box sx={{
          position: "absolute", top: 6, left: 6, zIndex: 2,
          width: 18, height: 18, borderRadius: "50%",
          backgroundColor: "#6366f1", display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <CheckIcon sx={{ fontSize: 12, color: "#fff" }} />
        </Box>
      )}
      <IconButton
        size="small"
        onClick={(e) => { e.stopPropagation(); onMenu(e, "file", file); }}
        sx={{ position: "absolute", top: 4, right: 4, color: "#fff", zIndex: 1, backgroundColor: "rgba(0,0,0,0.3)", "&:hover": { backgroundColor: "rgba(0,0,0,0.5)" }, opacity: 0, ".MuiBox-root:hover &": { opacity: 1 } }}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      {isImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/files/${file.id}/thumbnail`}
          alt={file.originalName}
          style={{ width: "100%", height: 120, objectFit: "cover", display: "block" }}
          loading="lazy"
          onError={() => setImgError(true)}
        />
      ) : (
        <Box sx={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "var(--surface-2)" }}>
          <FileIcon mimeType={file.mimeType} size={48} />
        </Box>
      )}
      <Box sx={{ p: 1.25 }}>
        <Typography sx={{ fontSize: "0.78rem", fontWeight: 600, color: "var(--tx)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {file.originalName}
        </Typography>
        <Typography sx={{ fontSize: "0.7rem", color: "var(--tx-4)" }}>{formatBytes(file.size)}</Typography>
      </Box>
    </Box>
  );
}

// ── List-view file row ───────────────────────────────────────────────────────

function FileListRowItem({ file, selected, rowSx, cellSx, onClick, onOpen, onMenu }: {
  file: UploadFile;
  selected: boolean;
  rowSx: object;
  cellSx: (width: number, align?: "left" | "right") => object;
  onClick: (f: UploadFile, e: React.MouseEvent) => void;
  onOpen: () => void;
  onMenu: (e: React.MouseEvent<HTMLElement>) => void;
}) {
  const [imgError, setImgError] = useState(false);
  const isImg = file.mimeType.startsWith("image/") && !imgError;
  return (
    <Box
      onClick={(e) => { e.stopPropagation(); onClick(file, e); }}
      onDoubleClick={(e) => { e.stopPropagation(); onOpen(); }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onMenu(e); }}
      sx={{
        ...rowSx,
        backgroundColor: selected ? "rgba(99,102,241,0.08)" : undefined,
        borderLeft: selected ? "2px solid #6366f1" : "2px solid transparent",
        "&:hover": { backgroundColor: selected ? "rgba(99,102,241,0.12)" : "var(--surface-2)" },
      }}
    >
      {isImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/files/${file.id}/thumbnail`}
          alt=""
          style={{ width: 32, height: 32, objectFit: "cover", borderRadius: 4, flexShrink: 0 }}
          loading="lazy"
          onError={() => setImgError(true)}
        />
      ) : (
        <Box sx={{ width: 32, display: "flex", justifyContent: "center", flexShrink: 0 }}>
          <FileIcon mimeType={file.mimeType} size={22} />
        </Box>
      )}
      <Typography sx={{ flex: 1, fontSize: "0.875rem", color: "var(--tx)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {file.originalName}
      </Typography>
      <Typography sx={cellSx(120)}>{fileKind(file.mimeType)}</Typography>
      <Typography sx={cellSx(80)}>{formatBytes(file.size)}</Typography>
      <Box sx={{ width: 100, flexShrink: 0, display: "flex", justifyContent: "flex-end", gap: 0.5 }}>
        {Array.from(new Set(file.attachments.map(a => a.taskId ? "Task" : a.noteId ? "Note" : null).filter(Boolean))).map(label => (
          <Box key={label} sx={{ fontSize: "0.68rem", fontWeight: 600, px: 0.75, py: 0.2, borderRadius: 1, backgroundColor: label === "Task" ? "rgba(99,102,241,0.12)" : "rgba(34,197,94,0.12)", color: label === "Task" ? "#6366f1" : "#15803d" }}>{label}</Box>
        ))}
      </Box>
      <Typography sx={cellSx(150)}>{formatDate(file.updatedAt)}</Typography>
      <Typography sx={cellSx(150)}>{formatDate(file.createdAt)}</Typography>
      <IconButton size="small" onClick={(e) => { e.stopPropagation(); onMenu(e); }} sx={{ color: "var(--tx-4)", flexShrink: 0 }}>
        <MoreVertIcon fontSize="small" />
      </IconButton>
    </Box>
  );
}

// ── List view ────────────────────────────────────────────────────────────────

function ListView({ folders, files, selectedFileIds, onEnterFolder, onFileClick, onOpenFile, onMenu, sortField, sortDir, onSort }: {
  folders: FileFolder[];
  files: UploadFile[];
  selectedFileIds: Set<string>;
  onEnterFolder: (f: FileFolder) => void;
  onFileClick: (f: UploadFile, e: React.MouseEvent) => void;
  onOpenFile: (f: UploadFile) => void;
  onMenu: (e: React.MouseEvent<HTMLElement>, type: "file" | "folder", item: UploadFile | FileFolder) => void;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (field: SortField) => void;
}) {
  const rowSx = {
    display: "flex", alignItems: "center", gap: 1.5,
    px: 2, py: 1.25,
    backgroundColor: "var(--surface)",
    borderBottom: "1px solid var(--divider)",
    cursor: "pointer",
    userSelect: "none",
    "&:hover": { backgroundColor: "var(--surface-2)" },
  };

  const SortArrow = ({ field }: { field: SortField }) =>
    sortField === field
      ? (sortDir === "asc" ? <ArrowUpwardIcon sx={{ fontSize: "0.7rem", ml: 0.25 }} /> : <ArrowDownwardIcon sx={{ fontSize: "0.7rem", ml: 0.25 }} />)
      : null;

  const colHd = (field: SortField, label: string, width: number, align: "left" | "right" = "right") => (
    <Box
      onClick={() => onSort(field)}
      sx={{
        ...(width === 0 ? { flex: 1, minWidth: 0 } : { width, flexShrink: 0 }),
        fontSize: "0.72rem", fontWeight: 700,
        color: sortField === field ? "#6366f1" : "var(--tx-3)",
        textTransform: "uppercase", letterSpacing: 0.5,
        cursor: "pointer", userSelect: "none",
        display: "flex", alignItems: "center",
        justifyContent: align === "right" ? "flex-end" : "flex-start",
        "&:hover": { color: "#6366f1" },
      }}
    >
      {align === "right" && <SortArrow field={field} />}
      {label}
      {align === "left" && <SortArrow field={field} />}
    </Box>
  );

  const cellSx = (width: number, align: "left" | "right" = "right") => ({
    width, flexShrink: 0,
    fontSize: "0.8rem", color: "var(--tx-4)",
    textAlign: align,
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const,
  });

  return (
    <Box sx={{ border: "1px solid var(--border)", borderRadius: 2, overflow: "hidden" }}>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2, py: 1, backgroundColor: "var(--surface-2)", borderBottom: "1px solid var(--border)" }}>
        <Box sx={{ width: 32, flexShrink: 0 }} />
        {colHd("name", "Name", 0, "left")}
        {colHd("kind", "Kind", 120)}
        {colHd("size", "Size", 80)}
        <Box sx={{ width: 100, flexShrink: 0, fontSize: "0.72rem", fontWeight: 700, color: "var(--tx-3)", textTransform: "uppercase", letterSpacing: 0.5, display: "flex", justifyContent: "flex-end" }}>Used In</Box>
        {colHd("modified", "Modified", 150)}
        {colHd("created", "Created", 150)}
        <Box sx={{ width: 32, flexShrink: 0 }} />
      </Box>

      {folders.map((f) => (
        <Box key={f.id} onClick={() => onEnterFolder(f)} sx={rowSx}>
          <FolderIcon sx={{ fontSize: 22, color: "#fbbf24", flexShrink: 0, width: 32 }} />
          <Typography sx={{ flex: 1, fontSize: "0.875rem", color: "var(--tx)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {f.name}
          </Typography>
          <Typography sx={cellSx(120)}>Folder</Typography>
          <Typography sx={cellSx(80)}>—</Typography>
          <Box sx={{ width: 100, flexShrink: 0 }} />
          <Typography sx={cellSx(150)}>{formatDate(f.updatedAt)}</Typography>
          <Typography sx={cellSx(150)}>{formatDate(f.createdAt)}</Typography>
          <IconButton size="small" onClick={(e) => { e.stopPropagation(); onMenu(e, "folder", f); }} sx={{ color: "var(--tx-4)", flexShrink: 0 }}>
            <MoreVertIcon fontSize="small" />
          </IconButton>
        </Box>
      ))}

      {files.map((f) => (
        <FileListRowItem
          key={f.id}
          file={f}
          selected={selectedFileIds.has(f.id)}
          rowSx={rowSx}
          cellSx={cellSx}
          onClick={onFileClick}
          onOpen={() => onOpenFile(f)}
          onMenu={(e) => onMenu(e, "file", f)}
        />
      ))}
    </Box>
  );
}


// ── Lightbox ────────────────────────────────────────────────────────────────

function LightboxPreview({ file }: { file: UploadFile }) {
  if (file.mimeType.startsWith("image/")) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/files/${file.id}`}
        alt={file.originalName}
        style={{ maxWidth: "100%", maxHeight: "72vh", objectFit: "contain", borderRadius: 4 }}
      />
    );
  }
  if (file.mimeType.startsWith("video/")) {
    return (
      <video
        src={`/api/files/${file.id}`}
        controls
        style={{ maxWidth: "100%", maxHeight: "72vh" }}
      />
    );
  }
  if (file.mimeType.startsWith("audio/")) {
    return (
      <Box sx={{ textAlign: "center", p: 4 }}>
        <AudioFileIcon sx={{ fontSize: 72, color: "#34d399", mb: 2 }} />
        <Typography sx={{ color: "rgba(255,255,255,0.7)", mb: 2, fontSize: "0.9rem" }}>{file.originalName}</Typography>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <audio src={`/api/files/${file.id}`} controls style={{ display: "block" }} />
      </Box>
    );
  }
  return (
    <Box sx={{ textAlign: "center", p: 4 }}>
      <FileIcon mimeType={file.mimeType} size={72} />
      <Typography sx={{ color: "rgba(255,255,255,0.7)", mt: 2, mb: 3, fontSize: "0.95rem", fontWeight: 500 }}>
        {file.originalName}
      </Typography>
      <Button
        variant="outlined"
        startIcon={<OpenInNewIcon />}
        onClick={() => window.open(`/api/files/${file.id}`, "_blank")}
        sx={{ color: "#fff", borderColor: "rgba(255,255,255,0.3)", "&:hover": { borderColor: "#fff", backgroundColor: "rgba(255,255,255,0.08)" }, textTransform: "none" }}
      >
        Open in browser
      </Button>
    </Box>
  );
}

function Lightbox({ file, files, open, onClose, onNavigate }: {
  file: UploadFile | undefined;
  files: UploadFile[];
  open: boolean;
  onClose: () => void;
  onNavigate: (fileId: string) => void;
}) {
  const idx = file ? files.findIndex(f => f.id === file.id) : -1;
  const canPrev = idx > 0;
  const canNext = idx < files.length - 1;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            backgroundColor: "rgba(8,8,12,0.96)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 2,
            maxHeight: "92vh",
            overflow: "hidden",
          }
        }
      }}
    >
      {/* Header */}
      <Box sx={{
        display: "flex", alignItems: "center", gap: 1,
        px: 2, py: 1,
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        flexShrink: 0,
      }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ color: "#fff", fontWeight: 600, fontSize: "0.9rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {file?.originalName}
          </Typography>
          <Typography sx={{ color: "rgba(255,255,255,0.35)", fontSize: "0.72rem" }}>
            {file && formatBytes(file.size)}
            {files.length > 1 && ` · ${idx + 1} of ${files.length} · ↑↓ to navigate · ⌘⌫ to delete`}
          </Typography>
        </Box>
        <Tooltip title="Open in browser">
          <IconButton
            onClick={() => file && window.open(`/api/files/${file.id}`, "_blank")}
            sx={{ color: "rgba(255,255,255,0.6)", "&:hover": { color: "#fff" } }}
          >
            <OpenInNewIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Close (Esc)">
          <IconButton onClick={onClose} sx={{ color: "rgba(255,255,255,0.6)", "&:hover": { color: "#fff" } }}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Preview area */}
      <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", p: 3, minHeight: 300 }}>
        {file && <LightboxPreview file={file} />}
      </Box>

      {/* Navigation footer */}
      {files.length > 1 && (
        <Box sx={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 2,
          py: 1.5, borderTop: "1px solid rgba(255,255,255,0.07)", flexShrink: 0,
        }}>
          <Tooltip title="Previous (↑)">
            <span>
              <IconButton
                disabled={!canPrev}
                onClick={() => canPrev && onNavigate(files[idx - 1].id)}
                sx={{ color: canPrev ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.2)", "&:hover": { color: "#fff" } }}
              >
                <ArrowUpwardIcon />
              </IconButton>
            </span>
          </Tooltip>
          <Typography sx={{ color: "rgba(255,255,255,0.4)", fontSize: "0.8rem", minWidth: 60, textAlign: "center" }}>
            {idx + 1} / {files.length}
          </Typography>
          <Tooltip title="Next (↓)">
            <span>
              <IconButton
                disabled={!canNext}
                onClick={() => canNext && onNavigate(files[idx + 1].id)}
                sx={{ color: canNext ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.2)", "&:hover": { color: "#fff" } }}
              >
                <ArrowDownwardIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      )}
    </Dialog>
  );
}

// ── Move picker dialog ───────────────────────────────────────────────────────

function MovePicker({ open, excludeId, moveError, onMove, onClose }: {
  open: boolean;
  excludeId: string | null;
  moveError: string | null;
  onMove: (folderId: string | null) => void;
  onClose: () => void;
}) {
  const [pickerStack, setPickerStack] = useState<BreadcrumbEntry[]>([{ id: null, name: "Files" }]);
  const [pickerFolders, setPickerFolders] = useState<FileFolder[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const current = pickerStack[pickerStack.length - 1];

  useEffect(() => {
    if (open) {
      setPickerStack([{ id: null, name: "Files" }]);
      setPickerFolders([]);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setPickerLoading(true);
    const qs = current.id ? `?parentId=${current.id}` : "";
    fetch(`/api/file-folders${qs}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(r)))
      .then((d) => setPickerFolders(d))
      .catch((err) => { if (err instanceof Error && err.name !== "AbortError") setPickerFolders([]); })
      .finally(() => setPickerLoading(false));
    return () => controller.abort();
  }, [open, current.id]);

  const displayFolders = excludeId ? pickerFolders.filter((f) => f.id !== excludeId) : pickerFolders;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth
      slotProps={{ paper: { sx: { backgroundColor: "var(--surface)", borderRadius: 3, border: "1px solid var(--border)" } } }}>
      <DialogTitle sx={{ color: "var(--tx)", fontWeight: 700, pb: 0.5 }}>Move to…</DialogTitle>
      <DialogContent sx={{ px: 0, pb: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 3, py: 1, flexWrap: "wrap" }}>
          {pickerStack.map((entry, i) => (
            <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              {i > 0 && <Typography sx={{ color: "var(--tx-2)", fontSize: "0.8rem" }}>/</Typography>}
              <Typography
                onClick={() => i < pickerStack.length - 1 && setPickerStack((s) => s.slice(0, i + 1))}
                sx={{
                  fontSize: "0.82rem",
                  fontWeight: i === pickerStack.length - 1 ? 700 : 500,
                  color: i === pickerStack.length - 1 ? "var(--tx)" : "#6366f1",
                  cursor: i < pickerStack.length - 1 ? "pointer" : "default",
                  "&:hover": i < pickerStack.length - 1 ? { textDecoration: "underline" } : {},
                }}
              >
                {entry.name}
              </Typography>
            </Box>
          ))}
        </Box>
        <Box sx={{ borderTop: "1px solid var(--border)", minHeight: 160, maxHeight: 280, overflowY: "auto" }}>
          {pickerLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", pt: 3 }}>
              <CircularProgress size={24} sx={{ color: "#6366f1" }} />
            </Box>
          ) : displayFolders.length === 0 ? (
            <Typography sx={{ color: "var(--tx-2)", fontSize: "0.85rem", px: 3, py: 3 }}>No subfolders here</Typography>
          ) : displayFolders.map((f) => (
            <Box
              key={f.id}
              onClick={() => setPickerStack((s) => [...s, { id: f.id, name: f.name }])}
              sx={{
                display: "flex", alignItems: "center", gap: 1.5,
                px: 3, py: 1.25, cursor: "pointer",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                "&:hover": { backgroundColor: "rgba(255,255,255,0.05)" },
              }}
            >
              <FolderIcon sx={{ fontSize: 20, color: "#fbbf24", flexShrink: 0 }} />
              <Typography sx={{ flex: 1, color: "var(--tx)", fontSize: "0.875rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {f.name}
              </Typography>
              <Typography sx={{ color: "var(--tx-4)", fontSize: "0.75rem" }}>›</Typography>
            </Box>
          ))}
        </Box>
        {moveError && <Typography sx={{ color: "#f87171", fontSize: "0.78rem", px: 3, pt: 1.5 }}>{moveError}</Typography>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, pt: 1.5, borderTop: "1px solid var(--border)", flexDirection: "column", alignItems: "stretch", gap: 0.5 }}>
        <Button
          onClick={() => onMove(current.id)}
          variant="contained"
          sx={{ backgroundColor: "#6366f1", textTransform: "none", borderRadius: 2, fontWeight: 600 }}
        >
          Move here{current.id ? ` → ${current.name}` : " (root)"}
        </Button>
        <Button onClick={onClose} sx={{ color: "var(--tx-4)", textTransform: "none" }}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}
