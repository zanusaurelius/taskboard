"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useMediaQuery from "@mui/material/useMediaQuery";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import Divider from "@mui/material/Divider";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import LinearProgress from "@mui/material/LinearProgress";
import Tooltip from "@mui/material/Tooltip";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import Popover from "@mui/material/Popover";
import AddIcon from "@mui/icons-material/Add";
import ArchiveIcon from "@mui/icons-material/Archive";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import RestoreIcon from "@mui/icons-material/Restore";
import EditIcon from "@mui/icons-material/Edit";
import PaletteIcon from "@mui/icons-material/Palette";
import SearchIcon from "@mui/icons-material/Search";
import UndoIcon from "@mui/icons-material/Undo";
import {
  DndContext, DragEndEvent, DragOverEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, closestCorners, useDroppable,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";

import { useTaskBoardStore } from "@/lib/store";
import { useVault } from "@/lib/vault-context";
import { Task, Project } from "@/lib/types";
import TaskCard from "./TaskCard";
import TaskModal from "./TaskModal";
import VaultUnlockModal from "./VaultUnlockModal";
import VaultSetupModal from "./VaultSetupModal";
import dynamic from "next/dynamic";
const DailyFocus = dynamic(() => import("./DailyFocus"), { ssr: false });

interface DeletionEntry {
  id: string;
  label: string;
  type: "project" | "task";
  itemId: string;
  createdAt: number;
  commit: () => Promise<void>;
}

const UNDO_DURATION = 30_000;

function DeletionToast({ entry, onUndo }: { entry: DeletionEntry; onUndo: () => void }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const iv = setInterval(() => setElapsed(Date.now() - entry.createdAt), 250);
    return () => clearInterval(iv);
  }, [entry.createdAt]);

  const remaining = Math.max(0, Math.ceil((UNDO_DURATION - elapsed) / 1000));
  const progress = Math.max(0, 100 - (elapsed / UNDO_DURATION) * 100);

  return (
    <Box sx={{
      backgroundColor: "var(--surface)",
      borderRadius: 2,
      p: 2,
      minWidth: 320,
      maxWidth: 400,
      boxShadow: "0 8px 32px rgba(0,0,0,0.28)",
      overflow: "hidden",
    }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.25 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ color: "var(--tx)", fontSize: "0.875rem", fontWeight: 600, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Deleting &ldquo;{entry.label}&rdquo;
          </Typography>
          <Typography sx={{ color: "var(--tx-2)", fontSize: "0.78rem" }}>
            Permanently removed in {remaining}s
          </Typography>
        </Box>
        <Button
          size="small"
          startIcon={<UndoIcon sx={{ fontSize: 15 }} />}
          onClick={onUndo}
          sx={{
            color: "#6366f1",
            fontWeight: 700,
            fontSize: "0.8rem",
            textTransform: "none",
            backgroundColor: "rgba(99,102,241,0.15)",
            borderRadius: 1.5,
            px: 1.5,
            ml: 1.5,
            flexShrink: 0,
            "&:hover": { backgroundColor: "rgba(99,102,241,0.25)" },
          }}
        >
          Undo
        </Button>
      </Box>
      <LinearProgress
        variant="determinate"
        value={progress}
        sx={{
          height: 3,
          borderRadius: 2,
          backgroundColor: "rgba(255,255,255,0.1)",
          "& .MuiLinearProgress-bar": { backgroundColor: "#ef4444", borderRadius: 2 },
        }}
      />
    </Box>
  );
}

const STAGES: { id: Task["stage"]; label: string }[] = [
  { id: "todo",        label: "To Do" },
  { id: "in_progress", label: "In Progress" },
  { id: "blocked",     label: "Blocker" },
  { id: "done",        label: "Done" },
];

const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

const STAGE_COLORS: Record<string, string> = {
  todo: "#6366f1", in_progress: "#3b82f6", blocked: "#ef4444", done: "#22c55e",
};
const STAGE_BG: Record<string, string> = {
  todo: "#eef0ff", in_progress: "#eff6ff", blocked: "#fff1f2", done: "#f0fdf4",
};

const STAGE_COLOR_OPTIONS = [
  "#6366f1", "#3b82f6", "#ef4444", "#22c55e",
  "#f59e0b", "#8b5cf6", "#0ea5e9", "#14b8a6",
  "#ec4899", "#f43f5e", "#64748b", "#10b981",
  "#06b6d4", "#a855f7", "#84cc16", "#1e293b",
];

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function loadStageColors(): Record<string, string> {
  if (typeof window === "undefined") return { ...STAGE_COLORS };
  try {
    const stored = localStorage.getItem("stageColors");
    return stored ? { ...STAGE_COLORS, ...JSON.parse(stored) } : { ...STAGE_COLORS };
  } catch { return { ...STAGE_COLORS }; }
}

const PROJECT_COLORS = [
  "#f59e0b", "#10b981", "#3b82f6", "#ec4899",
  "#8b5cf6", "#0ea5e9", "#14b8a6", "#f43f5e", "#84cc16", "#6366f1",
];
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}
const autoColor = (id: string) => PROJECT_COLORS[hashId(id) % PROJECT_COLORS.length];
const projectColor = (p: { id: string; color?: string | null }) => p.color ?? autoColor(p.id);

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mt: 2 }}>
      {PROJECT_COLORS.map((c) => (
        <Box
          key={c}
          onClick={() => onChange(c)}
          sx={{
            width: 28, height: 28, borderRadius: "50%",
            backgroundColor: c, cursor: "pointer", flexShrink: 0,
            border: value === c ? "3px solid var(--tx)" : "3px solid transparent",
            boxShadow: value === c ? `0 0 0 2px ${c}` : "none",
            transition: "all 0.1s ease",
            "&:hover": { transform: "scale(1.15)" },
          }}
        />
      ))}
    </Box>
  );
}

function DroppableColumn({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id });
  return <Box ref={setNodeRef} sx={{ flex: 1, minHeight: 80 }}>{children}</Box>;
}

interface TaskBoardProps {
  pendingNoteTask?: { title: string; description: string } | null;
  onClearPendingNoteTask?: () => void;
}

export default function TaskBoard({ pendingNoteTask, onClearPendingNoteTask }: TaskBoardProps = {}) {
  const isMobile = useMediaQuery("(max-width: 860px)");
  const { isUnlocked: vaultIsUnlocked, lockVault, hideVault } = useVault();
  const { tasks, projects, fetchAll, createTask, updateTask, deleteTask, createProject, updateProject, deleteProject, permanentDeleteProject, archiveAllDone } = useTaskBoardStore();

  const [localTasks, setLocalTasks] = useState<Task[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [defaultStage, setDefaultStage] = useState<Task["stage"]>("todo");
  const [stageColors, setStageColors] = useState<Record<string, string>>(loadStageColors);
  useEffect(() => {
    fetch("/api/settings/stage-colors").then(r => r.ok ? r.json() : null).then(data => {
      if (data && Object.keys(data).length > 0) setStageColors(prev => ({ ...prev, ...data }));
    }).catch(() => {});
  }, []);
  const [stageColorAnchor, setStageColorAnchor] = useState<HTMLElement | null>(null);
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [modalDefaultTitle, setModalDefaultTitle] = useState("");
  const [modalDefaultDescription, setModalDefaultDescription] = useState("");
  const [projectFilter, setProjectFilter] = useState<string[]>([]);
  const [stageFilter, setStageFilter] = useState<Task["stage"][]>([]);
  const [searchText, setSearchText] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [showArchivedProjects, setShowArchivedProjects] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(true);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectColor, setNewProjectColor] = useState(PROJECT_COLORS[0]);
  const [pendingTaskStage, setPendingTaskStage] = useState<Task["stage"] | null>(null);
  const [renamingProject, setRenamingProject] = useState<Project | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameColor, setRenameColor] = useState(PROJECT_COLORS[0]);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    confirmColor: "warning" | "error";
    onConfirm: () => void;
  } | null>(null);
  const [deletionQueue, setDeletionQueue] = useState<DeletionEntry[]>([]);
  const [focusSnackbar, setFocusSnackbar] = useState(false);
  const [archiveError, setArchiveError] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [pendingFocusGoalId, setPendingFocusGoalId] = useState<string | null>(null);
  const [vaultUnlockOpen, setVaultUnlockOpen] = useState(false);
  const [vaultSetupOpen, setVaultSetupOpen] = useState(false);
  const [vaultExists, setVaultExists] = useState(false);
  const [hasWebAuthn, setHasWebAuthn] = useState(false);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const newProjectInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      timersRef.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  useEffect(() => {
    if (!newProjectOpen) return;
    const t = setTimeout(() => newProjectInputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [newProjectOpen]);

  useEffect(() => {
    if (!renamingProject) return;
    const t = setTimeout(() => renameInputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [renamingProject]);

  const scheduleDeletion = useCallback((
    label: string,
    type: "project" | "task",
    itemId: string,
    commit: () => Promise<void>,
  ) => {
    const id = `${type}-${itemId}-${Date.now()}`;
    const entry: DeletionEntry = { id, label, type, itemId, createdAt: Date.now(), commit };
    setDeletionQueue((prev) => [...prev, entry]);
    const timer = setTimeout(async () => {
      await commit();
      setDeletionQueue((prev) => prev.filter((e) => e.id !== id));
      timersRef.current.delete(id);
    }, UNDO_DURATION);
    timersRef.current.set(id, timer);
  }, []);

  const undoDeletion = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) clearTimeout(timer);
    timersRef.current.delete(id);
    setDeletionQueue((prev) => prev.filter((e) => e.id !== id));
  }, []);

  useEffect(() => {
    fetchAll(showArchived, showArchivedProjects).then((ok) => { if (!ok) setFetchError(true); });
  }, [fetchAll, showArchived, showArchivedProjects]);

  useEffect(() => {
    fetch("/api/notes/vault")
      .then((r) => r.json())
      .then((d) => {
        setVaultExists(!!d.exists);
        if (d.exists) {
          try {
            const creds = JSON.parse(d.webAuthnCredentials ?? "[]");
            setHasWebAuthn(Array.isArray(creds) && creds.length > 0);
          } catch { /* ignore */ }
        }
      })
      .catch(() => {});
  }, []);

  // When vault auto-locks (inactivity timer), restore privacy mode
  useEffect(() => {
    if (!vaultIsUnlocked) setPrivacyMode(true);
  }, [vaultIsUnlocked]);

  const handlePrivacyModeToggle = () => {
    if (privacyMode) {
      // Trying to reveal — open vault unlock if there are locked tasks, else plain toggle
      if (vaultExists && tasks.some((t) => t.sensitive)) {
        setVaultUnlockOpen(true);
      } else {
        setPrivacyMode(false);
      }
    } else {
      // Hiding again — lock vault and restore privacy
      lockVault();
      hideVault();
      setPrivacyMode(true);
    }
  };

  useEffect(() => {
    const days = parseInt(localStorage.getItem("autoArchiveDays") ?? "0", 10);
    if (!days) return;
    fetch("/api/tasks/auto-archive", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days }),
    }).then(async (res) => {
      if (res.ok) {
        const { count } = await res.json();
        if (count > 0) fetchAll(showArchived, showArchivedProjects);
      } else {
        setArchiveError(true);
      }
    }).catch(() => setArchiveError(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (activeId === null) setLocalTasks(tasks); }, [tasks, activeId]);

  useEffect(() => {
    const handler = () => openCreate("todo");
    window.addEventListener("taskboard:newtask", handler);
    return () => window.removeEventListener("taskboard:newtask", handler);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps


  useEffect(() => {
    if (!pendingNoteTask) return;
    setEditingTask(null);
    setDefaultStage("todo");
    setModalDefaultTitle(pendingNoteTask.title);
    setModalDefaultDescription(pendingNoteTask.description);
    setModalOpen(true);
    onClearPendingNoteTask?.();
  }, [pendingNoteTask]); // eslint-disable-line react-hooks/exhaustive-deps

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const activeTask = activeId !== null ? localTasks.find((t) => t.id === activeId) ?? null : null;

  const taskCountByProject = tasks.reduce((acc, t) => {
    acc[t.projectId] = (acc[t.projectId] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const pendingProjectIds = new Set(deletionQueue.filter((e) => e.type === "project").map((e) => e.itemId));
  const pendingTaskIds = new Set(deletionQueue.filter((e) => e.type === "task").map((e) => e.itemId));

  const visibleTasks = useMemo(() => localTasks.filter((t) => {
    if (pendingTaskIds.has(t.id)) return false;
    if (projectFilter.length > 0 && !projectFilter.includes(t.projectId)) return false;
    if (stageFilter.length > 0 && !stageFilter.includes(t.stage)) return false;
    if (searchText) {
      const q = searchText.trim().toLowerCase();
      const inTitle = t.title.toLowerCase().includes(q);
      const plainDesc = t.description
        ? decodeEntities(t.description.replace(/<[^>]*>/g, " ")).toLowerCase()
        : "";
      const inDesc = plainDesc.includes(q);
      if (!inTitle && !inDesc) return false;
    }
    return true;
  }), [localTasks, pendingTaskIds, projectFilter, stageFilter, searchText]); // eslint-disable-line react-hooks/exhaustive-deps

  const tasksForStage = (stage: Task["stage"]) =>
    visibleTasks.filter((t) => t.stage === stage).sort((a, b) => {
      const pa = a.priority ? (PRIORITY_ORDER[a.priority] ?? 3) : 3;
      const pb = b.priority ? (PRIORITY_ORDER[b.priority] ?? 3) : 3;
      if (pa !== pb) return pa - pb;
      if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return a.position - b.position;
    });

  const handleDragStart = (e: DragStartEvent) => setActiveId(e.active.id as string);

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const dragged = localTasks.find((t) => t.id === active.id);
    if (!dragged) return;
    const overTask = localTasks.find((t) => t.id === over.id);
    const overStage = STAGES.find((s) => s.id === over.id);
    const targetStage = overTask?.stage ?? overStage?.id;
    if (!targetStage) return;
    setLocalTasks((prev) => {
      const updated = prev.map((t) => t.id === dragged.id ? { ...t, stage: targetStage } : t);
      if (overTask) {
        const fi = updated.findIndex((t) => t.id === dragged.id);
        const ti = updated.findIndex((t) => t.id === overTask.id);
        if (fi !== -1 && ti !== -1) return arrayMove(updated, fi, ti);
      }
      return updated;
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active } = event;
    setActiveId(null);
    const moved = localTasks.find((t) => t.id === active.id);
    if (!moved) return;
    const colTasks = localTasks.filter((t) => t.stage === moved.stage).sort((a, b) =>
      localTasks.findIndex((x) => x.id === a.id) - localTasks.findIndex((x) => x.id === b.id)
    );
    const idx = colTasks.findIndex((t) => t.id === moved.id);
    const prevPos = colTasks[idx - 1] ? (tasks.find((t) => t.id === colTasks[idx - 1].id)?.position ?? 0) : 0;
    const nextPos = colTasks[idx + 1] ? (tasks.find((t) => t.id === colTasks[idx + 1].id)?.position ?? prevPos + 2000) : prevPos + 2000;
    const newPos = (prevPos + nextPos) / 2;

    // If positions have converged too close, renormalize the whole column to multiples of 1000
    if (nextPos - prevPos < 0.5) {
      const stageTasks = colTasks.map((t, i) => ({ id: t.id, position: (i + 1) * 1000 }));
      const movedEntry = stageTasks[idx];
      stageTasks.forEach((t) => {
        if (t.id === moved.id) updateTask(t.id, { stage: moved.stage, position: movedEntry.position });
        else updateTask(t.id, { stage: moved.stage, position: t.position });
      });
      return;
    }
    updateTask(moved.id, { stage: moved.stage, position: newPos });
  };

  const openCreate = (stage: Task["stage"]) => {
    if (projects.filter((p) => !p.archived).length === 0) {
      setPendingTaskStage(stage);
      setNewProjectOpen(true);
      return;
    }
    setEditingTask(null);
    setDefaultStage(stage);
    setModalDefaultTitle("");
    setModalDefaultDescription("");
    setModalOpen(true);
  };
  const openEdit = (task: Task) => {
    if (task.locked && !vaultIsUnlocked) return; // locked task — must unlock vault first
    setEditingTask(task);
    setModalOpen(true);
  };

  // Ref keeps the latest executeSave available to the vault-unlock effect without stale closures
  const pendingSaveRef = useRef<Partial<Task> | null>(null);
  const executeSaveRef = useRef<(fields: Partial<Task>) => Promise<void>>(async () => {});

  const executeSave = async (fields: Partial<Task>) => {
    if (editingTask) {
      await updateTask(editingTask.id, fields);
    } else {
      const stageTasks = tasks.filter((t) => t.stage === fields.stage);
      const maxPos = stageTasks.length > 0 ? Math.max(...stageTasks.map((t) => t.position)) : 0;
      await createTask({ ...fields, position: maxPos + 1000 });
      if (pendingFocusGoalId) {
        await fetch(`/api/daily-goals/${pendingFocusGoalId}`, { method: "DELETE" });
        window.dispatchEvent(new Event("dailyfocus:refresh"));
        setPendingFocusGoalId(null);
      }
    }
    setModalOpen(false);
  };
  executeSaveRef.current = executeSave;

  // After vault unlock, fire any save that was waiting for it.
  // This useEffect runs after AppShell's useEffect (parent before child in React's commit order),
  // so store.masterKey is already set by the time this fires.
  useEffect(() => {
    if (!vaultIsUnlocked || !pendingSaveRef.current) return;
    const fields = pendingSaveRef.current;
    pendingSaveRef.current = null;
    executeSaveRef.current(fields);
  }, [vaultIsUnlocked]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async (fields: Partial<Task>) => {
    if (fields.sensitive) {
      if (!vaultExists) {
        // No vault yet — prompt to create one first
        pendingSaveRef.current = fields;
        setVaultSetupOpen(true);
        return;
      }
      if (!vaultIsUnlocked) {
        // Vault exists but locked — require unlock before encrypting
        pendingSaveRef.current = fields;
        setVaultUnlockOpen(true);
        return;
      }
    }
    await executeSave(fields);
  };

  const handleDuplicate = async () => {
    if (!editingTask) return;
    const stageTasks = tasks.filter((t) => t.stage === editingTask.stage);
    const maxPos = stageTasks.length > 0 ? Math.max(...stageTasks.map((t) => t.position)) : 0;
    await createTask({
      title: `Copy of ${editingTask.title}`,
      description: editingTask.description,
      stage: editingTask.stage,
      priority: editingTask.priority,
      dueDate: editingTask.dueDate,
      projectId: editingTask.projectId,
      position: maxPos + 1000,
    });
    setModalOpen(false);
  };

  const handleArchive = async () => {
    if (!editingTask) return;
    await updateTask(editingTask.id, { archived: true });
    setModalOpen(false);
  };

  const handleUnarchiveTask = async () => {
    if (!editingTask) return;
    await updateTask(editingTask.id, { archived: false });
    setModalOpen(false);
  };

  const handleDelete = async () => {
    if (!editingTask) return;
    if (editingTask.archived) {
      setModalOpen(false);
      scheduleDeletion(editingTask.title, "task", editingTask.id, () => deleteTask(editingTask.id));
    } else {
      try {
        await deleteTask(editingTask.id);
        setModalOpen(false);
      } catch {
        // deleteTask already removed from UI optimistically in store; error means server failed
        // re-fetch to restore state
        fetchAll();
      }
    }
  };

  const handleArchiveProject = (id: string) => {
    setConfirmDialog({
      title: "Archive Project?",
      message: 'This project will be hidden but can be restored from "Show Archived Projects".',
      confirmLabel: "Archive",
      confirmColor: "warning",
      onConfirm: async () => {
        await deleteProject(id);
        setProjectFilter((prev) => prev.filter((x) => x !== id));
        setConfirmDialog(null);
      },
    });
  };

  const handlePermanentDeleteProject = (id: string, name: string) => {
    setProjectFilter((prev) => prev.filter((x) => x !== id));
    scheduleDeletion(name, "project", id, () => permanentDeleteProject(id));
  };

  const handleArchiveAllDone = () => {
    const count = tasks.filter((t) => t.stage === "done" && !t.archived).length;
    if (count === 0) return;
    setConfirmDialog({
      title: "Archive Completed Tasks?",
      message: `Archive all ${count} completed task${count === 1 ? "" : "s"}? They can be restored later.`,
      confirmLabel: "Archive All",
      confirmColor: "warning",
      onConfirm: async () => {
        await archiveAllDone();
        setConfirmDialog(null);
      },
    });
  };

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) return;
    await createProject(newProjectName.trim(), newProjectColor);
    setNewProjectName("");
    setNewProjectColor(PROJECT_COLORS[0]);
    setNewProjectOpen(false);
    if (pendingTaskStage !== null) {
      setEditingTask(null);
      setDefaultStage(pendingTaskStage);
      setModalOpen(true);
      setPendingTaskStage(null);
    }
  };

  const handleAddToFocus = async (task: Task) => {
    const today = new Date().toISOString().slice(0, 10);
    let limit = parseInt(typeof window !== "undefined" ? (localStorage.getItem("dailyGoalLimit") ?? "3") : "3", 10) || 3;
    let res = await fetch("/api/daily-goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: task.title, taskId: task.id, date: today, position: 999, limit }),
    });
    if (!res.ok && limit < 20) {
      limit += 1;
      localStorage.setItem("dailyGoalLimit", String(limit));
      res = await fetch("/api/daily-goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: task.title, taskId: task.id, date: today, position: 999, limit }),
      });
    }
    if (res.ok) setFocusSnackbar(true);
    window.dispatchEvent(new Event("dailyfocus:refresh"));
  };

  const handleCreateFromFocus = (goalTitle: string, goalId: string) => {
    if (projects.filter((p) => !p.archived).length === 0) {
      setPendingTaskStage("todo");
      setNewProjectOpen(true);
      return;
    }
    setEditingTask(null);
    setDefaultStage("todo");
    setModalDefaultTitle(goalTitle);
    setModalDefaultDescription("");
    setPendingFocusGoalId(goalId);
    setModalOpen(true);
  };

  const handleRename = async () => {
    if (!renamingProject || !renameValue.trim()) return;
    await updateProject(renamingProject.id, { name: renameValue.trim(), color: renameColor });
    setRenamingProject(null);
  };

  const toggleProjectFilter = (id: string) =>
    setProjectFilter((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const handleStageColorChange = (stageId: string, color: string) => {
    const updated = { ...stageColors, [stageId]: color };
    setStageColors(updated);
    localStorage.setItem("stageColors", JSON.stringify(updated));
    fetch("/api/settings/stage-colors", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updated) }).catch(() => {});
  };

  const toggleStageFilter = (id: Task["stage"]) =>
    setStageFilter((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  return (
    <Box sx={{ minHeight: "100%", backgroundColor: "var(--bg)", display: "flex", flexDirection: "column" }}>

      {/* ── Top action bar ── */}
      <Box sx={{
        backgroundColor: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        px: { xs: 1.5, sm: 3 }, py: 1.5,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <Typography sx={{ fontWeight: 700, fontSize: "1rem", color: "var(--tx)", letterSpacing: "-0.2px" }}>
          Task Board
        </Typography>
        <Box sx={{ display: "flex", gap: { xs: 0.75, sm: 1.5 }, alignItems: "center" }}>
          <Tooltip title="Search everything  ⌘K" placement="bottom" arrow>
            <IconButton
              size="small"
              onClick={() => window.dispatchEvent(new CustomEvent("globalsearch:open"))}
              sx={{
                color: "var(--tx-3)",
                border: "1px solid var(--border)",
                borderRadius: 1.5,
                p: 0.75,
                "&:hover": { backgroundColor: "var(--surface-hover)", color: "var(--tx)", borderColor: "var(--border-2)" },
              }}
            >
              <SearchIcon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => setNewProjectOpen(true)}
            variant="outlined"
            sx={{
              color: "var(--tx-2)",
              borderColor: "var(--border-2)",
              fontSize: "0.85rem",
              fontWeight: 600,
              textTransform: "none",
              borderRadius: 2,
              px: { xs: 1, sm: 2 },
              minWidth: 0,
              "&:hover": { borderColor: "var(--tx-4)", backgroundColor: "var(--surface-2)" },
            }}>
            <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>New Project</Box>
          </Button>
          <Tooltip title="New Task" placement="bottom" arrow>
            <Button
              size="small"
              startIcon={<AddIcon />}
              variant="contained"
              onClick={() => openCreate("todo")}
              sx={{
                background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
                fontSize: "0.85rem",
                fontWeight: 600,
                textTransform: "none",
                borderRadius: 2,
                px: { xs: 1, sm: 2 },
                minWidth: 0,
                boxShadow: "0 2px 8px rgba(99,102,241,0.4)",
                "&:hover": { background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" },
              }}>
              <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>New Task</Box>
            </Button>
          </Tooltip>
        </Box>
      </Box>

      {/* ── Page body ── */}
      <Box sx={{ flex: 1, p: { xs: 1.5, sm: 3 }, display: "flex", flexDirection: "column", overflowX: isMobile ? "hidden" : "auto" }}>

        {/* ── Daily Focus ── */}
        <DailyFocus tasks={tasks} onCreateBoardTask={handleCreateFromFocus} />

        {/* ── Filter bar ── */}
        <Box sx={{
          backgroundColor: "var(--surface)",
          borderRadius: 2.5,
          boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
          p: { xs: 1.5, sm: 3 },
          mb: 3,
          flexShrink: 0,
        }}>
          <TextField
            size="small"
            placeholder="Search tasks…"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ fontSize: 20, color: "var(--tx-4)" }} />
                  </InputAdornment>
                ),
              },
            }}
            sx={{
              maxWidth: 340, mb: 2.5,
              "& .MuiOutlinedInput-root": {
                borderRadius: 2,
                fontSize: "0.95rem",
                backgroundColor: "var(--surface-2)",
                "& fieldset": { borderColor: "var(--border)" },
                "&:hover fieldset": { borderColor: "var(--border-2)" },
                "&.Mui-focused fieldset": { borderColor: "#6366f1" },
              },
              "& input": { py: "10px" },
            }}
          />

          <Divider sx={{ borderColor: "var(--border)", mb: 2.5 }} />

          {/* Projects row */}
          <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5, mb: 2 }}>
            <Typography sx={{
              color: "var(--tx-4)", fontWeight: 800, fontSize: "0.7rem",
              textTransform: "uppercase", letterSpacing: 1.2,
              flexShrink: 0, minWidth: 70, lineHeight: "30px",
            }}>
              Projects
            </Typography>
            <Box sx={{
              flex: 1, minWidth: 0,
              display: "flex",
              flexWrap: "wrap",
              gap: 1.25,
              alignItems: "center",
            }}>
              <Chip label="All" size="small"
                onClick={() => setProjectFilter([])}
                sx={allChipSx(projectFilter.length === 0)} />
              {projects.filter((p) => !p.archived).map((p) => (
                <Tooltip key={p.id} title={`${p.name} · ${taskCountByProject[p.id] || 0} task${(taskCountByProject[p.id] || 0) === 1 ? "" : "s"}`} placement="top" arrow>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.25, "&:hover .proj-edit": { opacity: 1 } }}>
                    <Chip
                      label={`${p.name} · ${taskCountByProject[p.id] || 0}`}
                      size="small"
                      onClick={() => toggleProjectFilter(p.id)}
                      onDelete={() => handleArchiveProject(p.id)}
                      sx={{
                        ...filterChipSx(projectFilter.includes(p.id), projectColor(p)),
                        maxWidth: 200,
                        "& .MuiChip-label": { px: 1.5, overflow: "hidden", textOverflow: "ellipsis", display: "block" },
                      }}
                    />
                    <IconButton className="proj-edit" size="small"
                      onClick={() => { setRenamingProject(p); setRenameValue(p.name); setRenameColor(p.color ?? autoColor(p.id)); }}
                      sx={{ opacity: 0, p: 0.4, flexShrink: 0, transition: "opacity 0.15s", color: "var(--tx-4)", "&:hover": { color: "var(--tx-2)" } }}>
                      <EditIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Box>
                </Tooltip>
              ))}
              {showArchivedProjects && projects.filter((p) => p.archived && !pendingProjectIds.has(p.id)).map((p) => (
                <Box key={p.id} sx={{ display: "flex", alignItems: "center", gap: 0.25 }}>
                  <Chip label={p.name} size="small"
                    sx={{
                      ...filterChipSx(false, "#94a3b8"), opacity: 0.6, maxWidth: 160,
                      "& .MuiChip-label": { overflow: "hidden", textOverflow: "ellipsis", display: "block" },
                    }}
                  />
                  <IconButton size="small" title="Restore project"
                    onClick={() => updateProject(p.id, { archived: false })}
                    sx={{ p: 0.4, flexShrink: 0, color: "var(--tx-4)", "&:hover": { color: "#22c55e", backgroundColor: "#f0fdf4" } }}>
                    <RestoreIcon sx={{ fontSize: 15 }} />
                  </IconButton>
                  <IconButton size="small" title="Delete permanently"
                    onClick={() => handlePermanentDeleteProject(p.id, p.name)}
                    sx={{ p: 0.4, flexShrink: 0, color: "var(--tx-4)", "&:hover": { color: "#ef4444", backgroundColor: "#fff1f2" } }}>
                    <DeleteForeverIcon sx={{ fontSize: 15 }} />
                  </IconButton>
                </Box>
              ))}
              <Chip
                label={showArchivedProjects ? "Hide Archived" : "Show Archived"}
                size="small"
                onClick={() => setShowArchivedProjects((v) => !v)}
                sx={filterChipSx(showArchivedProjects, "#f59e0b")}
              />
            </Box>
          </Box>

          {/* Stages row */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, flexWrap: "wrap" }}>
            <Typography sx={{
              color: "var(--tx-2)", fontWeight: 800, fontSize: "0.7rem",
              textTransform: "uppercase", letterSpacing: 1.2, minWidth: 70,
            }}>
              Stages
            </Typography>
            <Chip label="All" size="small"
              onClick={() => setStageFilter([])}
              sx={allChipSx(stageFilter.length === 0)} />
            {STAGES.map((s) => (
              <Chip key={s.id} label={s.label} size="small"
                onClick={() => toggleStageFilter(s.id)}
                sx={filterChipSx(stageFilter.includes(s.id), stageColors[s.id] ?? STAGE_COLORS[s.id])} />
            ))}
            <Chip
              label={privacyMode ? "Privacy Mode On" : "Privacy Mode"}
              size="small"
              onClick={handlePrivacyModeToggle}
              sx={{ ...filterChipSx(privacyMode, "#64748b"), ml: "auto" }}
            />
            <Chip
              label={showArchived ? "Hide Archived Tasks" : "Show Archived Tasks"}
              size="small"
              onClick={() => setShowArchived((v) => !v)}
              sx={filterChipSx(showArchived, "#f59e0b")}
            />
          </Box>
        </Box>

        {/* ── Board ── */}
        <DndContext sensors={sensors} collisionDetection={closestCorners}
          onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
          <Box sx={{
            display: "flex",
            flexDirection: isMobile ? "column" : "row",
            gap: 3,
            alignItems: isMobile ? "stretch" : "flex-start",
            flexWrap: "nowrap",
          }}>
            {STAGES.map((stage) => {
              const color = stageColors[stage.id] ?? STAGE_COLORS[stage.id];
              const bg = hexToRgba(color, 0.08);
              const columnTasks = tasksForStage(stage.id);
              return (
                <Box key={stage.id} sx={{
                  ...(isMobile
                    ? { width: "100%" }
                    : { minWidth: 240, flex: "1 1 240px", maxWidth: 400 }
                  ),
                  borderRadius: 2.5,
                  overflow: "hidden",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                  display: "flex", flexDirection: "column",
                  ...(!isMobile && { maxHeight: "calc(100vh - 210px)" }),
                }}>
                  {/* Column header */}
                  <Box sx={{
                    backgroundColor: color,
                    px: 2.5, py: 1.75,
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    flexShrink: 0,
                    "&:hover .stage-palette": { opacity: 1 },
                  }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
                      <Typography sx={{ fontWeight: 700, fontSize: "0.95rem", color: "#fff", letterSpacing: 0.1 }}>
                        {stage.label}
                      </Typography>
                      <Box sx={{
                        backgroundColor: "rgba(255,255,255,0.28)",
                        borderRadius: 99, px: 1, py: 0.15,
                        minWidth: 24, textAlign: "center",
                      }}>
                        <Typography sx={{ fontSize: "0.78rem", fontWeight: 700, color: "#fff" }}>
                          {columnTasks.length}
                        </Typography>
                      </Box>
                    </Box>
                    <Box sx={{ display: "flex", alignItems: "center" }}>
                      <Tooltip title="Change color" placement="top">
                        <IconButton
                          size="small"
                          className="stage-palette"
                          onClick={(e) => { setEditingStageId(stage.id); setStageColorAnchor(e.currentTarget); }}
                          sx={{ color: "rgba(255,255,255,0.55)", opacity: 0, transition: "opacity 0.15s",
                            "&:hover": { backgroundColor: "rgba(255,255,255,0.2)", color: "#fff" } }}
                        >
                          <PaletteIcon sx={{ fontSize: 15 }} />
                        </IconButton>
                      </Tooltip>
                      {stage.id === "done" && (
                        <IconButton size="small" title="Archive all completed tasks"
                          onClick={handleArchiveAllDone}
                          sx={{ color: "rgba(255,255,255,0.75)", "&:hover": { backgroundColor: "rgba(255,255,255,0.2)", color: "#fff" } }}>
                          <ArchiveIcon sx={{ fontSize: 18 }} />
                        </IconButton>
                      )}
                      <IconButton size="small" onClick={() => openCreate(stage.id)} sx={{
                        color: "rgba(255,255,255,0.85)",
                        "&:hover": { backgroundColor: "rgba(255,255,255,0.2)", color: "#fff" },
                      }}>
                        <AddIcon sx={{ fontSize: 20 }} />
                      </IconButton>
                    </Box>
                  </Box>

                  {/* Column body */}
                  <Box sx={{ backgroundColor: bg, p: 1.75, flex: 1, ...(!isMobile && { overflowY: "auto" }) }}>
                    <DroppableColumn id={stage.id}>
                      <SortableContext items={columnTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                        {columnTasks.map((task) => (
                          <TaskCard key={task.id} task={task} onClick={() => openEdit(task)}
                            onAddToFocus={task.stage !== "done" ? () => handleAddToFocus(task) : undefined}
                            privacyMode={privacyMode}
                          />
                        ))}
                      </SortableContext>
                      {columnTasks.length === 0 && (
                        <Box sx={{
                          border: `2px dashed ${color}45`,
                          borderRadius: 2, p: 3, textAlign: "center",
                        }}>
                          <Typography sx={{ fontSize: "0.875rem", color: `${color}80`, fontWeight: 500 }}>
                            Drop here
                          </Typography>
                        </Box>
                      )}
                    </DroppableColumn>
                  </Box>
                </Box>
              );
            })}
          </Box>

          {/* Stage color picker popover */}
          <Popover
            open={Boolean(stageColorAnchor)}
            anchorEl={stageColorAnchor}
            onClose={() => { setStageColorAnchor(null); setEditingStageId(null); }}
            anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
            transformOrigin={{ vertical: "top", horizontal: "left" }}
            slotProps={{ paper: { sx: { p: 1.5, borderRadius: 2, boxShadow: "0 8px 24px rgba(0,0,0,0.14)" } } }}
          >
            <Typography sx={{ fontSize: "0.7rem", fontWeight: 700, color: "var(--tx-4)", textTransform: "uppercase", letterSpacing: 0.8, mb: 1 }}>
              Stage color
            </Typography>
            <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", maxWidth: 180 }}>
              {STAGE_COLOR_OPTIONS.map((c) => {
                const active = editingStageId ? (stageColors[editingStageId] ?? STAGE_COLORS[editingStageId]) === c : false;
                return (
                  <Box key={c} onClick={() => { if (editingStageId) handleStageColorChange(editingStageId, c); }}
                    sx={{
                      width: 26, height: 26, borderRadius: "50%", backgroundColor: c,
                      cursor: "pointer", flexShrink: 0,
                      border: active ? "3px solid var(--tx)" : "3px solid transparent",
                      boxShadow: active ? `0 0 0 2px ${c}` : "none",
                      transition: "all 0.1s",
                      "&:hover": { transform: "scale(1.15)" },
                    }}
                  />
                );
              })}
            </Box>
          </Popover>

          <DragOverlay dropAnimation={null}>
            {activeTask && (
              <Box sx={{ transform: "rotate(2deg)", opacity: 0.95 }}>
                <TaskCard task={activeTask} onClick={() => {}} privacyMode={privacyMode} />
              </Box>
            )}
          </DragOverlay>
        </DndContext>
      </Box>

      {/* ── Vault setup modal (shown when user marks a task sensitive but has no vault) ── */}
      <VaultSetupModal
        open={vaultSetupOpen}
        onClose={() => { setVaultSetupOpen(false); pendingSaveRef.current = null; }}
        onSuccess={() => {
          setVaultSetupOpen(false);
          setVaultExists(true);
          // Vault was just created — now unlock it so we can encrypt the pending save
          if (pendingSaveRef.current) setVaultUnlockOpen(true);
        }}
      />

      {/* ── Vault unlock modal (for locked sensitive tasks) ── */}
      <VaultUnlockModal
        open={vaultUnlockOpen}
        onClose={() => { setVaultUnlockOpen(false); pendingSaveRef.current = null; }}
        onSuccess={() => { setVaultUnlockOpen(false); setPrivacyMode(false); }}
        mode="unlock"
        hasWebAuthn={hasWebAuthn}
      />

      {/* ── Task modal ── */}
      <TaskModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setModalDefaultTitle("");
          setModalDefaultDescription("");
          setPendingFocusGoalId(null);
        }}
        onSave={handleSave}
        onDelete={editingTask ? handleDelete : undefined}
        onArchive={editingTask && !editingTask.archived ? handleArchive : undefined}
        onUnarchive={editingTask?.archived ? handleUnarchiveTask : undefined}
        onDuplicate={editingTask ? handleDuplicate : undefined}
        task={editingTask}
        projects={projects}
        defaultStage={defaultStage}
        defaultTitle={modalDefaultTitle}
        defaultDescription={modalDefaultDescription}
      />

      {/* ── Confirm dialog ── */}
      <Dialog open={!!confirmDialog} onClose={() => setConfirmDialog(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, fontSize: "1.05rem", color: "var(--tx)", pb: 1 }}>
          {confirmDialog?.title}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ color: "var(--tx-3)", fontSize: "0.9rem", lineHeight: 1.6 }}>
            {confirmDialog?.message}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button onClick={() => setConfirmDialog(null)}
            sx={{ color: "var(--tx-3)", textTransform: "none", fontWeight: 500 }}>
            Cancel
          </Button>
          <Button onClick={confirmDialog?.onConfirm} variant="contained"
            color={confirmDialog?.confirmColor ?? "warning"}
            sx={{ textTransform: "none", fontWeight: 600, borderRadius: 1.5, px: 2.5 }}>
            {confirmDialog?.confirmLabel}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Rename project dialog ── */}
      <Dialog open={!!renamingProject} onClose={() => setRenamingProject(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, fontSize: "1.05rem", color: "var(--tx)" }}>
          Edit Project
        </DialogTitle>
        <DialogContent sx={{ pt: "12px !important" }}>
          <TextField label="Project name" value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            fullWidth inputRef={renameInputRef}
            onKeyDown={(e) => e.key === "Enter" && handleRename()}
          />
          <ColorPicker value={renameColor} onChange={setRenameColor} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button onClick={() => setRenamingProject(null)}
            sx={{ color: "var(--tx-3)", textTransform: "none", fontWeight: 500 }}>
            Cancel
          </Button>
          <Button onClick={handleRename} variant="contained" disabled={!renameValue.trim()}
            sx={{ textTransform: "none", fontWeight: 600, borderRadius: 1.5, px: 2.5 }}>
            Rename
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Focus added snackbar ── */}
      <Snackbar
        open={focusSnackbar}
        autoHideDuration={2500}
        onClose={() => setFocusSnackbar(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          onClose={() => setFocusSnackbar(false)}
          severity="success"
          variant="filled"
          sx={{ borderRadius: 2, fontWeight: 600, fontSize: "0.875rem" }}
        >
          Added to today&apos;s focus
        </Alert>
      </Snackbar>

      {/* ── Auto-archive error snackbar ── */}
      <Snackbar
        open={archiveError}
        autoHideDuration={5000}
        onClose={() => setArchiveError(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert onClose={() => setArchiveError(false)} severity="warning" variant="filled"
          sx={{ borderRadius: 2, fontWeight: 600, fontSize: "0.875rem" }}>
          Auto-archive failed — completed tasks were not archived.
        </Alert>
      </Snackbar>

      {/* ── Fetch error snackbar ── */}
      <Snackbar
        open={fetchError}
        autoHideDuration={6000}
        onClose={() => setFetchError(false)}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
      >
        <Alert onClose={() => setFetchError(false)} severity="error" variant="filled"
          sx={{ borderRadius: 2, fontWeight: 600, fontSize: "0.875rem" }}>
          Failed to load tasks — check your connection and refresh.
        </Alert>
      </Snackbar>

      {/* ── Undo deletion toasts ── */}
      {deletionQueue.length > 0 && (
        <Box sx={{
          position: "fixed", bottom: 24, left: 24,
          zIndex: 9999,
          display: "flex", flexDirection: "column", gap: 1.5,
        }}>
          {deletionQueue.map((entry) => (
            <DeletionToast key={entry.id} entry={entry} onUndo={() => undoDeletion(entry.id)} />
          ))}
        </Box>
      )}

      {/* ── New project dialog ── */}
      <Dialog open={newProjectOpen} onClose={() => { setNewProjectOpen(false); setPendingTaskStage(null); }} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 700, fontSize: "1.05rem", color: "var(--tx)" }}>
          New Project
        </DialogTitle>
        <DialogContent sx={{ pt: "12px !important" }}>
          {pendingTaskStage !== null && (
            <Typography sx={{ fontSize: "0.85rem", color: "var(--tx-3)", mb: 2 }}>
              You need a project before creating tasks. Create one to continue.
            </Typography>
          )}
          <TextField label="Project name" value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            fullWidth inputRef={newProjectInputRef}
            onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
          />
          <ColorPicker value={newProjectColor} onChange={setNewProjectColor} />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button onClick={() => { setNewProjectOpen(false); setPendingTaskStage(null); }}
            sx={{ color: "var(--tx-3)", textTransform: "none", fontWeight: 500 }}>
            Cancel
          </Button>
          <Button onClick={handleCreateProject} variant="contained" disabled={!newProjectName.trim()}
            sx={{ textTransform: "none", fontWeight: 600, borderRadius: 1.5, px: 2.5 }}>
            {pendingTaskStage !== null ? "Create & Add Task" : "Create"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function filterChipSx(active: boolean, color: string) {
  return {
    cursor: "pointer",
    fontWeight: 600,
    fontSize: "0.8rem",
    height: 30,
    backgroundColor: active ? color : "var(--surface-2)",
    color: active ? "#fff" : "var(--tx-2)",
    border: `1.5px solid ${active ? color : "var(--border)"}`,
    "& .MuiChip-label": { px: 1.5 },
    "&:hover": { backgroundColor: active ? color : "var(--border)", borderColor: active ? color : "var(--border-2)" },
    transition: "all 0.15s ease",
  };
}

function allChipSx(active: boolean) {
  return {
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "0.8rem",
    height: 30,
    backgroundColor: active ? "var(--tx)" : "var(--surface-2)",
    color: active ? "var(--bg)" : "var(--tx-4)",
    border: `1.5px solid ${active ? "var(--tx)" : "var(--border)"}`,
    "& .MuiChip-label": { px: 1.5 },
    "&:hover": { backgroundColor: active ? "var(--tx)" : "var(--border)" },
    transition: "all 0.15s ease",
  };
}
