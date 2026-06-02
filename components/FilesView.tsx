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
import GridViewIcon from "@mui/icons-material/GridView";
import ViewListIcon from "@mui/icons-material/ViewList";
import CreateNewFolderIcon from "@mui/icons-material/CreateNewFolder";
import UploadFileIcon from "@mui/icons-material/UploadFile";
import FolderIcon from "@mui/icons-material/Folder";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import DeleteIcon from "@mui/icons-material/Delete";
import DriveFileMoveIcon from "@mui/icons-material/DriveFileMove";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import PictureAsPdfIcon from "@mui/icons-material/PictureAsPdf";
import VideoFileIcon from "@mui/icons-material/VideoFile";
import AudioFileIcon from "@mui/icons-material/AudioFile";
import FolderZipIcon from "@mui/icons-material/FolderZip";
import type { FileFolder, UploadFile } from "@/lib/types";

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function FileIcon({ mimeType, size = 36 }: { mimeType: string; size?: number }) {
  const sx = { fontSize: size };
  if (mimeType.startsWith("video/")) return <VideoFileIcon sx={{ ...sx, color: "#818cf8" }} />;
  if (mimeType.startsWith("audio/")) return <AudioFileIcon sx={{ ...sx, color: "#34d399" }} />;
  if (mimeType === "application/pdf") return <PictureAsPdfIcon sx={{ ...sx, color: "#f87171" }} />;
  if (mimeType === "application/zip") return <FolderZipIcon sx={{ ...sx, color: "#fbbf24" }} />;
  return <InsertDriveFileIcon sx={{ ...sx, color: "#94a3b8" }} />;
}

interface BreadcrumbEntry { id: string | null; name: string }

export default function FilesView() {
  const [viewMode, setViewMode] = useState<"grid" | "list">(() =>
    typeof window !== "undefined" ? (localStorage.getItem("filesViewMode") as "grid" | "list") ?? "grid" : "grid"
  );
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Context menu
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuTarget, setMenuTarget] = useState<{ type: "file" | "folder"; item: UploadFile | FileFolder } | null>(null);
  const [movePickerOpen, setMovePickerOpen] = useState(false);

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

  const toggleView = (mode: "grid" | "list") => {
    setViewMode(mode);
    localStorage.setItem("filesViewMode", mode);
  };

  const enterFolder = (folder: FileFolder) => {
    setStack((s) => [...s, { id: folder.id, name: folder.name }]);
  };

  const navigateTo = (index: number) => {
    setStack((s) => s.slice(0, index + 1));
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(e.target.files ?? []);
    if (!chosen.length) return;
    setUploading(true);
    setUploadError(null);
    const errors: string[] = [];
    for (const f of chosen) {
      const fd = new FormData();
      fd.append("file", f);
      if (currentFolder.id) fd.append("folderId", currentFolder.id);
      const res = await fetch("/api/files", { method: "POST", body: fd });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        errors.push(`${f.name}: ${d.error ?? "Upload failed"}`);
      }
    }
    if (errors.length) setUploadError(errors.join(" · "));
    load();
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
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

  const deleteItem = async () => {
    if (!menuTarget) return;
    const url = menuTarget.type === "folder"
      ? `/api/file-folders/${menuTarget.item.id}`
      : `/api/files/${menuTarget.item.id}`;
    await fetch(url, { method: "DELETE" });
    setMenuAnchor(null);
    setMenuTarget(null);
    load();
  };

  const startMove = () => {
    setMenuAnchor(null);
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
    setMenuTarget(null);
    load();
  };

  const openFile = (file: UploadFile) => {
    window.open(`/api/files/${file.id}`, "_blank");
  };

  const openMenu = (e: React.MouseEvent<HTMLElement>, type: "file" | "folder", item: UploadFile | FileFolder) => {
    e.stopPropagation();
    setMenuAnchor(e.currentTarget);
    setMenuTarget({ type, item });
  };

  const isEmpty = !loading && folders.length === 0 && files.length === 0;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: "#f8fafc" }}>
      {/* Header */}
      <Box sx={{
        display: "flex", alignItems: "center", gap: 1,
        px: 3, py: 1.5,
        backgroundColor: "#fff",
        borderBottom: "1px solid #e2e8f0",
        flexShrink: 0,
      }}>
        {/* Breadcrumb */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flex: 1, minWidth: 0, flexWrap: "wrap" }}>
          {stack.length > 1 && (
            <IconButton size="small" onClick={() => navigateTo(stack.length - 2)} sx={{ color: "#64748b" }}>
              <ArrowBackIcon fontSize="small" />
            </IconButton>
          )}
          {stack.map((entry, i) => (
            <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              {i > 0 && <Typography sx={{ color: "#94a3b8", fontSize: "0.85rem" }}>/</Typography>}
              <Typography
                onClick={() => i < stack.length - 1 && navigateTo(i)}
                sx={{
                  fontSize: "0.9rem",
                  fontWeight: i === stack.length - 1 ? 700 : 500,
                  color: i === stack.length - 1 ? "#1e293b" : "#6366f1",
                  cursor: i < stack.length - 1 ? "pointer" : "default",
                  "&:hover": i < stack.length - 1 ? { textDecoration: "underline" } : {},
                }}
              >
                {entry.name}
              </Typography>
            </Box>
          ))}
        </Box>

        {/* Actions */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
          <Tooltip title="List view">
            <IconButton size="small" onClick={() => toggleView("list")} sx={{ color: viewMode === "list" ? "#6366f1" : "#94a3b8" }}>
              <ViewListIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Grid view">
            <IconButton size="small" onClick={() => toggleView("grid")} sx={{ color: viewMode === "grid" ? "#6366f1" : "#94a3b8" }}>
              <GridViewIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="New folder">
            <IconButton size="small" onClick={() => { setNewFolderName(""); setNewFolderOpen(true); }} sx={{ color: "#94a3b8", "&:hover": { color: "#6366f1" } }}>
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
      <Box sx={{ flex: 1, overflowY: "auto", p: 3 }}>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", pt: 8 }}>
            <CircularProgress sx={{ color: "#6366f1" }} />
          </Box>
        ) : isEmpty ? (
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pt: 10, gap: 2 }}>
            <FolderIcon sx={{ fontSize: 64, color: "#cbd5e1" }} />
            <Typography sx={{ color: "#94a3b8", fontSize: "0.95rem" }}>This folder is empty</Typography>
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
          <GridView folders={folders} files={files} onEnterFolder={enterFolder} onOpenFile={openFile} onMenu={openMenu} />
        ) : (
          <ListView folders={folders} files={files} onEnterFolder={enterFolder} onOpenFile={openFile} onMenu={openMenu} />
        )}
      </Box>

      {/* Context menu */}
      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => { setMenuAnchor(null); setMenuTarget(null); }}>
        {menuTarget?.type === "folder" && (
          <MenuItem onClick={() => {
            setRenameName((menuTarget.item as FileFolder).name);
            setRenameError(null);
            setRenamingFolder(menuTarget.item as FileFolder);
            setMenuAnchor(null);
          }}>
            <DriveFileMoveIcon fontSize="small" sx={{ mr: 1, color: "#64748b" }} />
            Rename
          </MenuItem>
        )}
        {menuTarget?.type === "file" && (
          <MenuItem onClick={() => {
            setRenameFileName((menuTarget.item as UploadFile).originalName);
            setRenameFileError(null);
            setRenamingFile(menuTarget.item as UploadFile);
            setMenuAnchor(null);
          }}>
            <DriveFileMoveIcon fontSize="small" sx={{ mr: 1, color: "#64748b" }} />
            Rename
          </MenuItem>
        )}
        <MenuItem onClick={startMove}>
          <DriveFileMoveIcon fontSize="small" sx={{ mr: 1, color: "#64748b" }} />
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

      {/* New folder dialog */}
      <Dialog open={newFolderOpen} onClose={() => { setNewFolderOpen(false); setNewFolderError(null); }} maxWidth="xs" fullWidth
        slotProps={{ paper: { sx: { backgroundColor: "#1e293b", borderRadius: 3, border: "1px solid #334155" } } }}>
        <DialogTitle sx={{ color: "#f1f5f9", fontWeight: 700, pb: 1 }}>New Folder</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus fullWidth size="small" placeholder="Folder name"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createFolder()}
            sx={{ mt: 1, "& .MuiInputBase-input": { color: "#f1f5f9" }, "& .MuiOutlinedInput-notchedOutline": { borderColor: "#475569" } }}
          />
          {newFolderError && <Typography sx={{ color: "#f87171", fontSize: "0.78rem", mt: 1 }}>{newFolderError}</Typography>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => { setNewFolderOpen(false); setNewFolderError(null); }} sx={{ color: "#94a3b8", textTransform: "none" }}>Cancel</Button>
          <Button onClick={createFolder} variant="contained" sx={{ backgroundColor: "#6366f1", textTransform: "none", borderRadius: 2 }}>Create</Button>
        </DialogActions>
      </Dialog>

      {/* Rename folder dialog */}
      <Dialog open={Boolean(renamingFolder)} onClose={() => { setRenamingFolder(null); setRenameError(null); }} maxWidth="xs" fullWidth
        slotProps={{ paper: { sx: { backgroundColor: "#1e293b", borderRadius: 3, border: "1px solid #334155" } } }}>
        <DialogTitle sx={{ color: "#f1f5f9", fontWeight: 700, pb: 1 }}>Rename Folder</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus fullWidth size="small"
            value={renameName}
            onChange={(e) => setRenameName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && renameFolder()}
            sx={{ mt: 1, "& .MuiInputBase-input": { color: "#f1f5f9" }, "& .MuiOutlinedInput-notchedOutline": { borderColor: "#475569" } }}
          />
          {renameError && <Typography sx={{ color: "#f87171", fontSize: "0.78rem", mt: 1 }}>{renameError}</Typography>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => { setRenamingFolder(null); setRenameError(null); }} sx={{ color: "#94a3b8", textTransform: "none" }}>Cancel</Button>
          <Button onClick={renameFolder} variant="contained" sx={{ backgroundColor: "#6366f1", textTransform: "none", borderRadius: 2 }}>Rename</Button>
        </DialogActions>
      </Dialog>

      {/* Rename file dialog */}
      <Dialog open={Boolean(renamingFile)} onClose={() => { setRenamingFile(null); setRenameFileError(null); }} maxWidth="xs" fullWidth
        slotProps={{ paper: { sx: { backgroundColor: "#1e293b", borderRadius: 3, border: "1px solid #334155" } } }}>
        <DialogTitle sx={{ color: "#f1f5f9", fontWeight: 700, pb: 1 }}>Rename File</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus fullWidth size="small"
            value={renameFileName}
            onChange={(e) => setRenameFileName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && renameFile()}
            sx={{ mt: 1, "& .MuiInputBase-input": { color: "#f1f5f9" }, "& .MuiOutlinedInput-notchedOutline": { borderColor: "#475569" } }}
          />
          {renameFileError && <Typography sx={{ color: "#f87171", fontSize: "0.78rem", mt: 1 }}>{renameFileError}</Typography>}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => { setRenamingFile(null); setRenameFileError(null); }} sx={{ color: "#94a3b8", textTransform: "none" }}>Cancel</Button>
          <Button onClick={renameFile} variant="contained" sx={{ backgroundColor: "#6366f1", textTransform: "none", borderRadius: 2 }}>Rename</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

// ── Grid view ────────────────────────────────────────────────────────────────

function GridView({ folders, files, onEnterFolder, onOpenFile, onMenu }: {
  folders: FileFolder[];
  files: UploadFile[];
  onEnterFolder: (f: FileFolder) => void;
  onOpenFile: (f: UploadFile) => void;
  onMenu: (e: React.MouseEvent<HTMLElement>, type: "file" | "folder", item: UploadFile | FileFolder) => void;
}) {
  return (
    <Box>
      {folders.length > 0 && (
        <Box sx={{ mb: 3 }}>
          <Typography sx={{ fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, mb: 1.5 }}>Folders</Typography>
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
            <Typography sx={{ fontSize: "0.7rem", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, mb: 1.5 }}>Files</Typography>
          )}
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 1.5 }}>
            {files.map((f) => (
              <FileCard key={f.id} file={f} onOpen={() => onOpenFile(f)} onMenu={onMenu} />
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
        backgroundColor: "#fff",
        border: "1px solid #e2e8f0",
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
        sx={{ position: "absolute", top: 4, right: 4, color: "#94a3b8", opacity: 0, ".MuiBox-root:hover &": { opacity: 1 } }}
      >
        <MoreVertIcon fontSize="small" />
      </IconButton>
      <FolderIcon sx={{ fontSize: 40, color: "#fbbf24", mb: 1 }} />
      <Typography sx={{ fontSize: "0.82rem", fontWeight: 600, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {folder.name}
      </Typography>
      <Typography sx={{ fontSize: "0.72rem", color: "#94a3b8" }}>
        {count === 0 ? "Empty" : `${count} item${count !== 1 ? "s" : ""}`}
      </Typography>
    </Box>
  );
}

function FileCard({ file, onOpen, onMenu }: { file: UploadFile; onOpen: () => void; onMenu: (e: React.MouseEvent<HTMLElement>, type: "file" | "folder", item: UploadFile) => void }) {
  const [imgError, setImgError] = useState(false);
  const isImg = file.mimeType.startsWith("image/") && !imgError;
  return (
    <Box
      onClick={onOpen}
      sx={{
        position: "relative",
        backgroundColor: "#fff",
        border: "1px solid #e2e8f0",
        borderRadius: 2,
        overflow: "hidden",
        cursor: "pointer",
        transition: "border-color 0.15s, box-shadow 0.15s",
        "&:hover": { borderColor: "#6366f1", boxShadow: "0 0 0 1px #6366f1" },
      }}
    >
      <IconButton
        size="small"
        onClick={(e) => onMenu(e, "file", file)}
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
        <Box sx={{ height: 120, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#f8fafc" }}>
          <FileIcon mimeType={file.mimeType} size={48} />
        </Box>
      )}
      <Box sx={{ p: 1.25 }}>
        <Typography sx={{ fontSize: "0.78rem", fontWeight: 600, color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {file.originalName}
        </Typography>
        <Typography sx={{ fontSize: "0.7rem", color: "#94a3b8" }}>{formatBytes(file.size)}</Typography>
      </Box>
    </Box>
  );
}

// ── List view ────────────────────────────────────────────────────────────────

function ListView({ folders, files, onEnterFolder, onOpenFile, onMenu }: {
  folders: FileFolder[];
  files: UploadFile[];
  onEnterFolder: (f: FileFolder) => void;
  onOpenFile: (f: UploadFile) => void;
  onMenu: (e: React.MouseEvent<HTMLElement>, type: "file" | "folder", item: UploadFile | FileFolder) => void;
}) {
  const rowSx = {
    display: "flex", alignItems: "center", gap: 1.5,
    px: 2, py: 1.25,
    backgroundColor: "#fff",
    borderBottom: "1px solid #f1f5f9",
    cursor: "pointer",
    "&:hover": { backgroundColor: "#f8fafc" },
  };

  return (
    <Box sx={{ border: "1px solid #e2e8f0", borderRadius: 2, overflow: "hidden" }}>
      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, px: 2, py: 1, backgroundColor: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
        <Box sx={{ width: 32 }} />
        <Typography sx={{ flex: 1, fontSize: "0.72rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>Name</Typography>
        <Typography sx={{ width: 80, fontSize: "0.72rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right" }}>Size</Typography>
        <Typography sx={{ width: 110, fontSize: "0.72rem", fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, textAlign: "right" }}>Modified</Typography>
        <Box sx={{ width: 32 }} />
      </Box>

      {folders.map((f) => (
        <Box key={f.id} onClick={() => onEnterFolder(f)} sx={rowSx}>
          <FolderIcon sx={{ fontSize: 22, color: "#fbbf24", flexShrink: 0 }} />
          <Typography sx={{ flex: 1, fontSize: "0.875rem", color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {f.name}
          </Typography>
          <Typography sx={{ width: 80, fontSize: "0.8rem", color: "#94a3b8", textAlign: "right" }}>—</Typography>
          <Typography sx={{ width: 110, fontSize: "0.8rem", color: "#94a3b8", textAlign: "right" }}>{formatDate(f.updatedAt)}</Typography>
          <IconButton size="small" onClick={(e) => onMenu(e, "folder", f)} sx={{ color: "#94a3b8" }}>
            <MoreVertIcon fontSize="small" />
          </IconButton>
        </Box>
      ))}

      {files.map((f) => (
        <Box key={f.id} onClick={() => onOpenFile(f)} sx={rowSx}>
          {f.mimeType.startsWith("image/") ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/files/${f.id}/thumbnail`}
              alt=""
              style={{ width: 32, height: 32, objectFit: "cover", borderRadius: 4, flexShrink: 0 }}
              loading="lazy"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          ) : (
            <Box sx={{ width: 32, display: "flex", justifyContent: "center", flexShrink: 0 }}>
              <FileIcon mimeType={f.mimeType} size={22} />
            </Box>
          )}
          <Typography sx={{ flex: 1, fontSize: "0.875rem", color: "#1e293b", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {f.originalName}
          </Typography>
          <Typography sx={{ width: 80, fontSize: "0.8rem", color: "#94a3b8", textAlign: "right" }}>{formatBytes(f.size)}</Typography>
          <Typography sx={{ width: 110, fontSize: "0.8rem", color: "#94a3b8", textAlign: "right" }}>{formatDate(f.updatedAt)}</Typography>
          <IconButton size="small" onClick={(e) => onMenu(e, "file", f)} sx={{ color: "#94a3b8" }}>
            <MoreVertIcon fontSize="small" />
          </IconButton>
        </Box>
      ))}
    </Box>
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
      setPickerFolders([]); // clear stale data from previous open
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setPickerLoading(true);
    const qs = current.id ? `?parentId=${current.id}` : "";
    fetch(`/api/file-folders${qs}`)
      .then((r) => r.json())
      .then((d) => setPickerFolders(d))
      .finally(() => setPickerLoading(false));
  }, [open, current.id]);

  const displayFolders = excludeId ? pickerFolders.filter((f) => f.id !== excludeId) : pickerFolders;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth
      slotProps={{ paper: { sx: { backgroundColor: "#1e293b", borderRadius: 3, border: "1px solid #334155" } } }}>
      <DialogTitle sx={{ color: "#f1f5f9", fontWeight: 700, pb: 0.5 }}>Move to…</DialogTitle>
      <DialogContent sx={{ px: 0, pb: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 3, py: 1, flexWrap: "wrap" }}>
          {pickerStack.map((entry, i) => (
            <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              {i > 0 && <Typography sx={{ color: "#475569", fontSize: "0.8rem" }}>/</Typography>}
              <Typography
                onClick={() => i < pickerStack.length - 1 && setPickerStack((s) => s.slice(0, i + 1))}
                sx={{
                  fontSize: "0.82rem",
                  fontWeight: i === pickerStack.length - 1 ? 700 : 500,
                  color: i === pickerStack.length - 1 ? "#e2e8f0" : "#6366f1",
                  cursor: i < pickerStack.length - 1 ? "pointer" : "default",
                  "&:hover": i < pickerStack.length - 1 ? { textDecoration: "underline" } : {},
                }}
              >
                {entry.name}
              </Typography>
            </Box>
          ))}
        </Box>
        <Box sx={{ borderTop: "1px solid #334155", minHeight: 160, maxHeight: 280, overflowY: "auto" }}>
          {pickerLoading ? (
            <Box sx={{ display: "flex", justifyContent: "center", pt: 3 }}>
              <CircularProgress size={24} sx={{ color: "#6366f1" }} />
            </Box>
          ) : displayFolders.length === 0 ? (
            <Typography sx={{ color: "#475569", fontSize: "0.85rem", px: 3, py: 3 }}>No subfolders here</Typography>
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
              <Typography sx={{ flex: 1, color: "#e2e8f0", fontSize: "0.875rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {f.name}
              </Typography>
              <Typography sx={{ color: "#475569", fontSize: "1rem" }}>›</Typography>
            </Box>
          ))}
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, py: 2, flexDirection: "column", alignItems: "stretch", gap: 1 }}>
        {moveError && <Typography sx={{ color: "#f87171", fontSize: "0.78rem" }}>{moveError}</Typography>}
        <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1 }}>
          <Button onClick={onClose} sx={{ color: "#94a3b8", textTransform: "none" }}>Cancel</Button>
          <Button onClick={() => onMove(current.id)} variant="contained"
            sx={{ backgroundColor: "#6366f1", "&:hover": { backgroundColor: "#4f46e5" }, textTransform: "none", borderRadius: 2 }}>
            Move here
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
