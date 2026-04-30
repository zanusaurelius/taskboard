"use client";
import { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import DeleteIcon from "@mui/icons-material/Delete";
import ArchiveIcon from "@mui/icons-material/Archive";
import RestoreIcon from "@mui/icons-material/Restore";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import CloseFullscreenIcon from "@mui/icons-material/CloseFullscreen";
import { Task, Project } from "@/lib/types";

const RichTextEditor = dynamic(() => import("./RichTextEditor"), { ssr: false });

const STAGES = [
  { value: "todo",        label: "To Do" },
  { value: "in_progress", label: "In Progress" },
  { value: "blocked",     label: "Blocker" },
  { value: "done",        label: "Done" },
];

const PRIORITIES = [
  { value: "",       label: "None" },
  { value: "low",    label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high",   label: "High" },
];

function htmlIsEmpty(html: string) {
  return !html || html.replace(/<[^>]*>/g, "").trim() === "";
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (fields: Partial<Task>) => void;
  onDelete?: () => void;
  onArchive?: () => void;
  onUnarchive?: () => void;
  onDuplicate?: () => void;
  task?: Task | null;
  projects: Project[];
  defaultStage?: Task["stage"];
  defaultTitle?: string;
  defaultDescription?: string;
}

export default function TaskModal({
  open, onClose, onSave, onDelete, onArchive, onUnarchive, onDuplicate,
  task, projects, defaultStage = "todo", defaultTitle = "", defaultDescription = "",
}: Props) {
  const [title, setTitle]           = useState("");
  const [stage, setStage]           = useState<Task["stage"]>(defaultStage);
  const [priority, setPriority]     = useState("");
  const [dueDate, setDueDate]       = useState("");
  const [projectId, setProjectId]   = useState<string>("");
  const [description, setDesc]      = useState("");
  const [expanded, setExpanded]     = useState(false);

  // A counter that increments each time the modal opens with a new task,
  // used as the RichTextEditor key to force a fresh editor instance.
  const editorEpoch = useRef(0);
  const [editorKey, setEditorKey] = useState(0);

  useEffect(() => {
    if (!open) return;
    editorEpoch.current += 1;
    setEditorKey(editorEpoch.current);

    if (task) {
      setTitle(task.title);
      setDesc(task.description || "");
      setStage(task.stage);
      setPriority(task.priority || "");
      setDueDate(task.dueDate || "");
      setProjectId(task.projectId);
    } else {
      setTitle(defaultTitle);
      setDesc(defaultDescription);
      setStage(defaultStage);
      setPriority("");
      setDueDate("");
      setProjectId(projects.length === 1 ? projects[0].id : "");

    }
    setExpanded(false);
  // Intentionally exclude `projects` — a new array reference from the store
  // would increment editorEpoch and remount the editor, erasing in-progress edits.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, open, defaultStage]);

  const handleSave = () => {
    if (!title.trim() || !projectId) return;
    onSave({
      title: title.trim(),
      description: htmlIsEmpty(description) ? null : description,
      stage,
      priority: (priority as Task["priority"]) || null,
      dueDate: dueDate || null,
      projectId,
    });
  };

  const descMinHeight = expanded ? 460 : 130;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth={expanded ? "lg" : "sm"}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", pr: 1 }}>
        <Typography sx={{ fontWeight: 700, fontSize: "1rem", color: "#1e293b" }}>
          {task ? "Edit Task" : "New Task"}
        </Typography>
        <Box sx={{ display: "flex", gap: 0.5 }}>
          <IconButton size="small" onClick={() => setExpanded((v) => !v)} title={expanded ? "Collapse" : "Expand"}>
            {expanded
              ? <CloseFullscreenIcon sx={{ fontSize: 17, color: "#94a3b8" }} />
              : <OpenInFullIcon sx={{ fontSize: 17, color: "#94a3b8" }} />
            }
          </IconButton>
          <IconButton size="small" onClick={onClose}>
            <CloseIcon sx={{ fontSize: 18, color: "#94a3b8" }} />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: "12px !important" }}>
        <TextField
          label="Title" value={title}
          onChange={(e) => setTitle(e.target.value)}
          fullWidth required autoFocus
        />

        <Box sx={{ display: "flex", gap: 2 }}>
          <FormControl fullWidth required>
            <InputLabel>Project</InputLabel>
            <Select value={projectId} label="Project" onChange={(e) => setProjectId(e.target.value)}>
              {projects.filter((p) => !p.archived).map((p) => (
                <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl fullWidth>
            <InputLabel>Stage</InputLabel>
            <Select value={stage} label="Stage" onChange={(e) => setStage(e.target.value as Task["stage"])}>
              {STAGES.map((s) => <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>

        {/* Rich text description */}
        <Box>
          <Typography variant="caption" sx={{ color: "#64748b", fontWeight: 600, fontSize: "0.78rem", mb: 0.75, display: "block" }}>
            Description
          </Typography>
          <RichTextEditor
            key={editorKey}
            value={description}
            onChange={setDesc}
            minHeight={descMinHeight}
          />
        </Box>

        <Box sx={{ display: "flex", gap: 2 }}>
          <FormControl fullWidth>
            <InputLabel>Priority</InputLabel>
            <Select value={priority} label="Priority" onChange={(e) => setPriority(e.target.value)}>
              {PRIORITIES.map((p) => <MenuItem key={p.value} value={p.value}>{p.label}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField
            label="Due Date" type="date" value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            fullWidth
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        {task && (
          <Box sx={{ display: "flex", gap: 1, mr: "auto" }}>
            {onDuplicate && (
              <Button onClick={onDuplicate} startIcon={<ContentCopyIcon />} color="inherit" variant="outlined" size="small" sx={{ color: "#64748b", borderColor: "#cbd5e1" }}>
                Duplicate
              </Button>
            )}
            {onArchive && (
              <Button onClick={onArchive} startIcon={<ArchiveIcon />} color="inherit" variant="outlined" size="small" sx={{ color: "#64748b", borderColor: "#cbd5e1" }}>
                Archive
              </Button>
            )}
            {onUnarchive && (
              <Button onClick={onUnarchive} startIcon={<RestoreIcon />} color="inherit" variant="outlined" size="small" sx={{ color: "#64748b", borderColor: "#cbd5e1" }}>
                Unarchive
              </Button>
            )}
            {onDelete && (
              <Button onClick={onDelete} startIcon={<DeleteIcon />} color="error" variant="outlined" size="small">
                Delete
              </Button>
            )}
          </Box>
        )}
        <Button onClick={onClose} sx={{ color: "#64748b", textTransform: "none" }}>Cancel</Button>
        <Button onClick={handleSave} variant="contained" disabled={!title.trim() || !projectId}
          sx={{ textTransform: "none", fontWeight: 600, px: 2.5 }}>
          {task ? "Save" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
