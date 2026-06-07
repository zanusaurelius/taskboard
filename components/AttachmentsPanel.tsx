"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Box, Typography, IconButton, Tooltip, CircularProgress, Button,
  Dialog, DialogTitle, DialogContent, DialogActions,
  List, ListItemButton, ListItemIcon, ListItemText, Breadcrumbs, Link,
} from "@mui/material";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import FolderIcon from "@mui/icons-material/Folder";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import PhotoLibraryIcon from "@mui/icons-material/PhotoLibrary";

interface Attachment {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  uploadId: string | null;
}

interface UploadFileMeta {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  fileFolderId: string | null;
}

interface FileFolderMeta {
  id: string;
  name: string;
  parentId: string | null;
  _count: { uploads: number; children: number };
}

interface Props {
  noteId?: string;
  taskId?: string;
  disabled?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mimeType: string): string {
  if (mimeType === "application/pdf") return "📄";
  if (mimeType.startsWith("image/")) return "🖼️";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType.includes(".sheet")) return "📊";
  if (mimeType.includes("presentation") || mimeType.includes("powerpoint")) return "📊";
  if (mimeType.includes("word") || mimeType.includes("wordprocessing")) return "📝";
  return "📎";
}

// ── File-gallery picker dialog ────────────────────────────────────────────────

interface StackEntry {
  id: string | null;
  name: string;
}

interface FilePickerDialogProps {
  open: boolean;
  noteId?: string;
  taskId?: string;
  linkedUploadIds: Set<string>;
  onPicked: (att: Attachment) => void;
  onClose: () => void;
}

function FilePickerDialog({ open, noteId, taskId, linkedUploadIds, onPicked, onClose }: FilePickerDialogProps) {
  const [stack, setStack] = useState<StackEntry[]>([{ id: null, name: "Files" }]);
  const [folders, setFolders] = useState<FileFolderMeta[]>([]);
  const [files, setFiles] = useState<UploadFileMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);

  const currentFolder = stack[stack.length - 1];

  const loadFolder = useCallback(async (folderId: string | null) => {
    setLoading(true);
    const qs = folderId ? `?parentId=${folderId}` : "";
    const fileQs = folderId ? `?folderId=${folderId}` : "";
    const [fRes, uRes] = await Promise.all([
      fetch(`/api/file-folders${qs}`),
      fetch(`/api/files${fileQs}`),
    ]);
    const [fData, uData] = await Promise.all([fRes.json(), uRes.json()]);
    setFolders(Array.isArray(fData) ? fData : []);
    setFiles(Array.isArray(uData) ? uData : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) {
      setStack([{ id: null, name: "Files" }]);
      loadFolder(null);
    }
  }, [open, loadFolder]);

  const handleFolderClick = (folder: FileFolderMeta) => {
    setStack((prev) => [...prev, { id: folder.id, name: folder.name }]);
    loadFolder(folder.id);
  };

  const handleBack = () => {
    const newStack = stack.slice(0, -1);
    setStack(newStack);
    loadFolder(newStack[newStack.length - 1].id);
  };

  const handleBreadcrumbClick = (idx: number) => {
    const newStack = stack.slice(0, idx + 1);
    setStack(newStack);
    loadFolder(newStack[newStack.length - 1].id);
  };

  const handleFileClick = async (file: UploadFileMeta) => {
    if (linkedUploadIds.has(file.id)) return; // already linked
    setLinking(true);
    const res = await fetch("/api/attachments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId: file.id, noteId, taskId }),
    });
    setLinking(false);
    if (res.ok) {
      const att = await res.json() as Attachment;
      onPicked(att);
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pb: 1 }}>
        <PhotoLibraryIcon sx={{ fontSize: 20, color: "text.secondary" }} />
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            Choose from Files gallery
          </Typography>
          {stack.length > 1 && (
            <Breadcrumbs sx={{ fontSize: 12, mt: 0.25 }}>
              {stack.map((entry, idx) =>
                idx < stack.length - 1 ? (
                  <Link
                    key={idx}
                    component="button"
                    underline="hover"
                    color="inherit"
                    sx={{ fontSize: 12, cursor: "pointer" }}
                    onClick={() => handleBreadcrumbClick(idx)}
                  >
                    {entry.name}
                  </Link>
                ) : (
                  <Typography key={idx} sx={{ fontSize: 12, color: "text.primary" }}>
                    {entry.name}
                  </Typography>
                ),
              )}
            </Breadcrumbs>
          )}
        </Box>
        {stack.length > 1 && (
          <Tooltip title="Back">
            <IconButton size="small" onClick={handleBack}>
              <ArrowBackIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        )}
      </DialogTitle>

      <DialogContent dividers sx={{ minHeight: 260, p: 0 }}>
        {loading || linking ? (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", py: 6, gap: 1.5 }}>
            <CircularProgress size={28} />
            {linking && <Typography variant="caption" color="text.secondary">Linking file…</Typography>}
          </Box>
        ) : folders.length === 0 && files.length === 0 ? (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", py: 6 }}>
            <Typography variant="body2" sx={{ color: "text.disabled", fontStyle: "italic" }}>
              No files in this folder
            </Typography>
          </Box>
        ) : (
          <List dense disablePadding>
            {folders.map((folder) => (
              <ListItemButton key={folder.id} onClick={() => handleFolderClick(folder)} divider>
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <FolderIcon sx={{ fontSize: 20, color: "warning.main" }} />
                </ListItemIcon>
                <ListItemText
                  primary={<Typography sx={{ fontSize: 14, fontWeight: 500 }}>{folder.name}</Typography>}
                  secondary={<Typography sx={{ fontSize: 12 }}>{folder._count.children} folders · {folder._count.uploads} files</Typography>}
                />
                <Typography sx={{ color: "text.disabled", fontSize: 16, ml: 1 }}>›</Typography>
              </ListItemButton>
            ))}
            {files.map((file) => {
              const alreadyLinked = linkedUploadIds.has(file.id);
              return (
                <ListItemButton key={file.id} onClick={() => handleFileClick(file)} divider disabled={alreadyLinked}>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <Typography sx={{ fontSize: 18, lineHeight: 1 }}>{fileIcon(file.mimeType)}</Typography>
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <Typography sx={{ fontSize: 14, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.originalName}</Typography>
                        {alreadyLinked && (
                          <Typography sx={{ fontSize: 10, fontWeight: 700, color: "primary.main", bgcolor: "action.selected", px: 0.75, py: 0.25, borderRadius: 1, flexShrink: 0, lineHeight: 1.4 }}>
                            Already linked
                          </Typography>
                        )}
                      </Box>
                    }
                    secondary={<Typography sx={{ fontSize: 12 }}>{formatBytes(file.size)}</Typography>}
                  />
                </ListItemButton>
              );
            })}
          </List>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} sx={{ textTransform: "none", color: "text.secondary" }}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export default function AttachmentsPanel({ noteId, taskId, disabled }: Props) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const query = noteId ? `noteId=${noteId}` : `taskId=${taskId}`;

  useEffect(() => {
    if (!noteId && !taskId) return;
    fetch(`/api/attachments?${query}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setAttachments(data); })
      .catch(() => {});
  }, [noteId, taskId, query]);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);

    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", file);
      if (noteId) fd.append("noteId", noteId);
      if (taskId) fd.append("taskId", taskId);

      const res = await fetch("/api/attachments", { method: "POST", body: fd });
      if (res.ok) {
        const att = await res.json() as Attachment;
        setAttachments((prev) => [...prev, att]);
      } else {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setError(body.error ?? "Upload failed");
      }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleDelete = async (id: string) => {
    const res = await fetch(`/api/attachments/${id}`, { method: "DELETE" });
    if (res.ok) setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const handlePicked = (att: Attachment) => {
    setAttachments((prev) => [...prev, att]);
  };

  return (
    <Box sx={{ mt: 3, pt: 2, borderTop: "1px solid", borderColor: "divider" }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5, gap: 1, flexWrap: "wrap" }}>
        <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>
          Attachments {attachments.length > 0 && `(${attachments.length})`}
        </Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Tooltip title={disabled ? "Save the task first, then you can add attachments" : ""}>
            <span>
              <Button
                size="small"
                variant="outlined"
                startIcon={uploading ? <CircularProgress size={14} /> : <AttachFileIcon sx={{ fontSize: 16 }} />}
                onClick={() => fileRef.current?.click()}
                disabled={uploading || disabled}
                sx={{ fontSize: 12, textTransform: "none", borderColor: "divider", color: "text.secondary",
                  "&:hover": { borderColor: "primary.main", color: "primary.main" } }}
              >
                {uploading ? "Uploading…" : "Attach file"}
              </Button>
            </span>
          </Tooltip>
          <Tooltip title={disabled ? "Save the task first, then you can add attachments" : ""}>
            <span>
              <Button
                size="small"
                variant="outlined"
                startIcon={<PhotoLibraryIcon sx={{ fontSize: 16 }} />}
                onClick={() => setPickerOpen(true)}
                disabled={disabled}
                sx={{ fontSize: 12, textTransform: "none", borderColor: "divider", color: "text.secondary",
                  "&:hover": { borderColor: "primary.main", color: "primary.main" } }}
              >
                From Files gallery
              </Button>
            </span>
          </Tooltip>
        </Box>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,.docx,.xlsx,.pptx,.odt,.ods,.jpg,.jpeg,.png,.gif,.webp"
          style={{ display: "none" }}
          onChange={(e) => handleFiles(e.target.files)}
        />
      </Box>

      {error && (
        <Typography variant="caption" sx={{ color: "error.main", display: "block", mb: 1 }}>
          {error}
        </Typography>
      )}

      {attachments.length === 0 && !uploading && (
        <Typography variant="caption" sx={{ color: "text.disabled", fontStyle: "italic" }}>
          {disabled
            ? "Save the task first to add attachments."
            : "No attachments yet — PDF, DOCX, XLSX, PPTX, and images supported (max 50 MB each)."}
        </Typography>
      )}

      {attachments.map((att) => (
        <Box
          key={att.id}
          sx={{
            display: "flex", alignItems: "center", gap: 1,
            px: 1.5, py: 1, mb: 0.5, borderRadius: 1.5,
            bgcolor: "action.hover", border: "1px solid", borderColor: "divider",
            "&:hover": { borderColor: "action.selected" },
          }}
        >
          <Typography sx={{ fontSize: 16, lineHeight: 1 }}>{fileIcon(att.mimeType)}</Typography>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
              <Typography variant="body2" sx={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {att.originalName}
              </Typography>
              {att.uploadId && (
                <Typography variant="caption" sx={{
                  color: "primary.main", bgcolor: "action.selected",
                  px: 0.75, borderRadius: 1, fontSize: "0.65rem", fontWeight: 700,
                  flexShrink: 0, lineHeight: 1.6,
                }}>
                  From Files
                </Typography>
              )}
            </Box>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {formatBytes(att.size)}
            </Typography>
          </Box>
          <Tooltip title="Open in new tab">
            <IconButton
              size="small"
              component="a"
              href={`/api/attachments/${att.id}`}
              target="_blank"
              rel="noopener noreferrer"
              sx={{ color: "text.disabled", "&:hover": { color: "text.secondary" } }}
            >
              <OpenInNewIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title={att.uploadId ? "Remove link (file stays in Files gallery)" : "Delete attachment"}>
            <IconButton size="small" onClick={() => handleDelete(att.id)} sx={{ color: "text.disabled", "&:hover": { color: "error.main" } }}>
              <DeleteOutlinedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Box>
      ))}

      <FilePickerDialog
        open={pickerOpen}
        noteId={noteId}
        taskId={taskId}
        linkedUploadIds={new Set(attachments.map((a) => a.uploadId).filter(Boolean) as string[])}
        onPicked={handlePicked}
        onClose={() => setPickerOpen(false)}
      />
    </Box>
  );
}
