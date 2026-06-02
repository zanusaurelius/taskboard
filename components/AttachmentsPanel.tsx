"use client";

import { useEffect, useRef, useState } from "react";
import { Box, Typography, IconButton, Tooltip, CircularProgress, Button } from "@mui/material";
import AttachFileIcon from "@mui/icons-material/AttachFile";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

interface Attachment {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
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

export default function AttachmentsPanel({ noteId, taskId, disabled }: Props) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  return (
    <Box sx={{ mt: 3, pt: 2, borderTop: "1px solid", borderColor: "divider" }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5 }}>
        <Typography variant="caption" sx={{ color: "text.secondary", fontWeight: 700, textTransform: "uppercase", letterSpacing: 1 }}>
          Attachments {attachments.length > 0 && `(${attachments.length})`}
        </Typography>
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
            <Typography variant="body2" sx={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {att.originalName}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {formatBytes(att.size)}
            </Typography>
          </Box>
          <Tooltip title="Open">
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
          <Tooltip title="Delete">
            <IconButton size="small" onClick={() => handleDelete(att.id)} sx={{ color: "text.disabled", "&:hover": { color: "error.main" } }}>
              <DeleteOutlinedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Box>
      ))}
    </Box>
  );
}
