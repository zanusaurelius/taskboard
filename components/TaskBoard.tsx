"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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
import AddIcon from "@mui/icons-material/Add";
import ArchiveIcon from "@mui/icons-material/Archive";
import DeleteForeverIcon from "@mui/icons-material/DeleteForever";
import RestoreIcon from "@mui/icons-material/Restore";
import EditIcon from "@mui/icons-material/Edit";
import SearchIcon from "@mui/icons-material/Search";
import UndoIcon from "@mui/icons-material/Undo";
import {
  DndContext, DragEndEvent, DragOverEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors, closestCorners, useDroppable,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";

import { useTaskBoardStore } from "@/lib/store";
import { Task, Project } from "@/lib/types";
import TaskCard from "./TaskCard";
import TaskModal from "./TaskModal";

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
      backgroundColor: "#1e293b",
      borderRadius: 2,
      p: 2,
      minWidth: 320,
      maxWidth: 400,
      boxShadow: "0 8px 32px rgba(0,0,0,0.28)",
      overflow: "hidden",
    }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.25 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ color: "#f8fafc", fontSize: "0.875rem", fontWeight: 600, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Deleting &ldquo;{entry.label}&rdquo;
          </Typography>
          <Typography sx={{ color: "#94a3b8", fontSize: "0.78rem" }}>
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

const PROJECT_COLORS = [
  "#f59e0b", "#10b981", "#3b82f6", "#ec4899",
  "#8b5cf6", "#0ea5e9", "#14b8a6", "#f43f5e", "#84cc16", "#6366f1",
];
function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}
const projectColor = (id: string) => PROJECT_COLORS[hashId(id) % PROJECT_COLORS.length];

function DroppableColumn({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id });
  return <Box ref={setNodeRef} sx={{ flex: 1, minHeight: 80 }}>{children}</Box>;
}

interface TaskBoardProps {
  pendingNoteTask?: { title: string; description: string } | null;
  onClearPendingNoteTask?: () => void;
}

export default function TaskBoard({ pendingNoteTask, onClearPendingNoteTask }: TaskBoardProps = {}) {
  const { tasks, projects, fetchAll, createTask, updateTask, deleteTask, createProject, updateProject, deleteProject, permanentDeleteProject, archiveAllDone } = useTaskBoardStore();

  const [localTasks, setLocalTasks] = useState<Task[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [defaultStage, setDefaultStage] = useState<Task["stage"]>("todo");
  const [modalDefaultTitle, setModalDefaultTitle] = useState("");
  const [modalDefaultDescription, setModalDefaultDescription] = useState("");
  const [projectFilter, setProjectFilter] = useState<string[]>([]);
  const [stageFilter, setStageFilter] = useState<Task["stage"][]>([]);
  const [searchText, setSearchText] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [showArchivedProjects, setShowArchivedProjects] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [pendingTaskStage, setPendingTaskStage] = useState<Task["stage"] | null>(null);
  const [renamingProject, setRenamingProject] = useState<Project | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    confirmColor: "warning" | "error";
    onConfirm: () => void;
  } | null>(null);
  const [deletionQueue, setDeletionQueue] = useState<DeletionEntry[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      timersRef.current.forEach((t) => clearTimeout(t));
    };
  }, []);

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

  useEffect(() => { fetchAll(showArchived, showArchivedProjects); }, [fetchAll, showArchived, showArchivedProjects]);
  useEffect(() => { if (activeId === null) setLocalTasks(tasks); }, [tasks, activeId]);

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

  const visibleTasks = localTasks.filter((t) => {
    if (pendingTaskIds.has(t.id)) return false;
    if (projectFilter.length > 0 && !projectFilter.includes(t.projectId)) return false;
    if (stageFilter.length > 0 && !stageFilter.includes(t.stage)) return false;
    if (searchText && !t.title.toLowerCase().includes(searchText.toLowerCase())) return false;
    return true;
  });

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
    updateTask(moved.id, { stage: moved.stage, position: (prevPos + nextPos) / 2 });
  };

  const openCreate = (stage: Task["stage"]) => {
    if (projects.filter((p) => !p.archived).length === 0) {
      setPendingTaskStage(stage);
      setNewProjectOpen(true);
      return;
    }
    setEditingTask(null);
    setDefaultStage(stage);
    setModalOpen(true);
  };
  const openEdit = (task: Task) => { setEditingTask(task); setModalOpen(true); };

  const handleSave = async (fields: Partial<Task>) => {
    if (editingTask) {
      await updateTask(editingTask.id, fields);
    } else {
      const stageTasks = tasks.filter((t) => t.stage === fields.stage);
      const maxPos = stageTasks.length > 0 ? Math.max(...stageTasks.map((t) => t.position)) : 0;
      await createTask({ ...fields, position: maxPos + 1000 });
    }
    setModalOpen(false);
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
      await deleteTask(editingTask.id);
      setModalOpen(false);
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
    await createProject(newProjectName.trim());
    setNewProjectName("");
    setNewProjectOpen(false);
    if (pendingTaskStage !== null) {
      setEditingTask(null);
      setDefaultStage(pendingTaskStage);
      setModalOpen(true);
      setPendingTaskStage(null);
    }
  };

  const handleRename = async () => {
    if (!renamingProject || !renameValue.trim()) return;
    await updateProject(renamingProject.id, { name: renameValue.trim() });
    setRenamingProject(null);
  };

  const toggleProjectFilter = (id: string) =>
    setProjectFilter((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const toggleStageFilter = (id: Task["stage"]) =>
    setStageFilter((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  return (
    <Box sx={{ height: "100vh", backgroundColor: "#f1f5f9", display: "flex", flexDirection: "column" }}>

      {/* ── Top action bar ── */}
      <Box sx={{
        backgroundColor: "#fff",
        borderBottom: "1px solid #e2e8f0",
        px: 3, py: 1.5,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <Typography sx={{ fontWeight: 700, fontSize: "1rem", color: "#1e293b", letterSpacing: "-0.2px" }}>
          Task Board
        </Typography>
        <Box sx={{ display: "flex", gap: 1.5 }}>
          <Button
            size="small"
            startIcon={<AddIcon />}
            onClick={() => setNewProjectOpen(true)}
            variant="outlined"
            sx={{
              color: "#475569",
              borderColor: "#cbd5e1",
              fontSize: "0.85rem",
              fontWeight: 600,
              textTransform: "none",
              borderRadius: 2,
              px: 2,
              "&:hover": { borderColor: "#94a3b8", backgroundColor: "#f8fafc" },
            }}>
            New Project
          </Button>
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
              px: 2,
              boxShadow: "0 2px 8px rgba(99,102,241,0.4)",
              "&:hover": { background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" },
            }}>
            New Task
          </Button>
        </Box>
      </Box>

      {/* ── Page body ── */}
      <Box sx={{ flex: 1, p: 3, display: "flex", flexDirection: "column", overflowX: "auto", overflowY: "hidden" }}>

        {/* ── Filter bar ── */}
        <Box sx={{
          backgroundColor: "#fff",
          borderRadius: 2.5,
          boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
          p: 3,
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
                    <SearchIcon sx={{ fontSize: 20, color: "#94a3b8" }} />
                  </InputAdornment>
                ),
              },
            }}
            sx={{
              maxWidth: 340, mb: 2.5,
              "& .MuiOutlinedInput-root": {
                borderRadius: 2,
                fontSize: "0.95rem",
                backgroundColor: "#f8fafc",
                "& fieldset": { borderColor: "#e2e8f0" },
                "&:hover fieldset": { borderColor: "#cbd5e1" },
                "&.Mui-focused fieldset": { borderColor: "#6366f1" },
              },
              "& input": { py: "10px" },
            }}
          />

          <Divider sx={{ borderColor: "#f1f5f9", mb: 2.5 }} />

          {/* Projects row */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, flexWrap: "wrap", mb: 2 }}>
            <Typography sx={{
              color: "#94a3b8", fontWeight: 800, fontSize: "0.7rem",
              textTransform: "uppercase", letterSpacing: 1.2, minWidth: 70,
            }}>
              Projects
            </Typography>
            <Chip label="All" size="small"
              onClick={() => setProjectFilter([])}
              sx={allChipSx(projectFilter.length === 0)} />
            {projects.filter((p) => !p.archived).map((p) => (
              <Box key={p.id} sx={{ display: "inline-flex", alignItems: "center", gap: 0.25, "&:hover .proj-edit": { opacity: 1 } }}>
                <Chip
                  label={`${p.name} · ${taskCountByProject[p.id] || 0}`}
                  size="small"
                  onClick={() => toggleProjectFilter(p.id)}
                  onDelete={() => handleArchiveProject(p.id)}
                  sx={filterChipSx(projectFilter.includes(p.id), projectColor(p.id))}
                />
                <IconButton className="proj-edit" size="small"
                  onClick={() => { setRenamingProject(p); setRenameValue(p.name); }}
                  sx={{ opacity: 0, p: 0.4, transition: "opacity 0.15s", color: "#94a3b8", "&:hover": { color: "#475569" } }}>
                  <EditIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Box>
            ))}
            {showArchivedProjects && projects.filter((p) => p.archived && !pendingProjectIds.has(p.id)).map((p) => (
              <Box key={p.id} sx={{ display: "inline-flex", alignItems: "center", gap: 0.25 }}>
                <Chip
                  label={p.name}
                  size="small"
                  sx={{ ...filterChipSx(false, "#94a3b8"), opacity: 0.6 }}
                />
                <IconButton size="small" title="Restore project"
                  onClick={() => updateProject(p.id, { archived: false })}
                  sx={{ p: 0.4, color: "#94a3b8", "&:hover": { color: "#22c55e", backgroundColor: "#f0fdf4" } }}>
                  <RestoreIcon sx={{ fontSize: 15 }} />
                </IconButton>
                <IconButton size="small" title="Delete permanently"
                  onClick={() => handlePermanentDeleteProject(p.id, p.name)}
                  sx={{ p: 0.4, color: "#94a3b8", "&:hover": { color: "#ef4444", backgroundColor: "#fff1f2" } }}>
                  <DeleteForeverIcon sx={{ fontSize: 15 }} />
                </IconButton>
              </Box>
            ))}
            <Chip
              label={showArchivedProjects ? "Hide Archived" : "Show Archived Projects"}
              size="small"
              onClick={() => setShowArchivedProjects((v) => !v)}
              sx={{ ...filterChipSx(showArchivedProjects, "#f59e0b"), ml: "auto" }}
            />
          </Box>

          {/* Stages row */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, flexWrap: "wrap" }}>
            <Typography sx={{
              color: "#94a3b8", fontWeight: 800, fontSize: "0.7rem",
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
                sx={filterChipSx(stageFilter.includes(s.id), STAGE_COLORS[s.id])} />
            ))}
            <Chip
              label={showArchived ? "Hide Archived Tasks" : "Show Archived Tasks"}
              size="small"
              onClick={() => setShowArchived((v) => !v)}
              sx={{ ...filterChipSx(showArchived, "#f59e0b"), ml: "auto" }}
            />
          </Box>
        </Box>

        {/* ── Board ── */}
        <DndContext sensors={sensors} collisionDetection={closestCorners}
          onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
          <Box sx={{ display: "flex", gap: 3, alignItems: "flex-start" }}>
            {STAGES.map((stage) => {
              const color = STAGE_COLORS[stage.id];
              const bg = STAGE_BG[stage.id];
              const columnTasks = tasksForStage(stage.id);
              return (
                <Box key={stage.id} sx={{
                  minWidth: 300, flex: "0 0 300px",
                  borderRadius: 2.5,
                  overflow: "hidden",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                  display: "flex", flexDirection: "column",
                  maxHeight: "calc(100vh - 210px)",
                }}>
                  {/* Column header */}
                  <Box sx={{
                    backgroundColor: color,
                    px: 2.5, py: 1.75,
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    flexShrink: 0,
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
                  <Box sx={{ backgroundColor: bg, p: 1.75, flex: 1, overflowY: "auto" }}>
                    <DroppableColumn id={stage.id}>
                      <SortableContext items={columnTasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                        {columnTasks.map((task) => (
                          <TaskCard key={task.id} task={task} onClick={() => openEdit(task)} />
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

          <DragOverlay dropAnimation={null}>
            {activeTask && (
              <Box sx={{ transform: "rotate(2deg)", opacity: 0.95 }}>
                <TaskCard task={activeTask} onClick={() => {}} />
              </Box>
            )}
          </DragOverlay>
        </DndContext>
      </Box>

      {/* ── Task modal ── */}
      <TaskModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setModalDefaultTitle("");
          setModalDefaultDescription("");
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
        <DialogTitle sx={{ fontWeight: 700, fontSize: "1.05rem", color: "#1e293b", pb: 1 }}>
          {confirmDialog?.title}
        </DialogTitle>
        <DialogContent>
          <Typography sx={{ color: "#64748b", fontSize: "0.9rem", lineHeight: 1.6 }}>
            {confirmDialog?.message}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button onClick={() => setConfirmDialog(null)}
            sx={{ color: "#64748b", textTransform: "none", fontWeight: 500 }}>
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
        <DialogTitle sx={{ fontWeight: 700, fontSize: "1.05rem", color: "#1e293b" }}>
          Rename Project
        </DialogTitle>
        <DialogContent sx={{ pt: "12px !important" }}>
          <TextField label="Project name" value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            fullWidth autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleRename()}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button onClick={() => setRenamingProject(null)}
            sx={{ color: "#64748b", textTransform: "none", fontWeight: 500 }}>
            Cancel
          </Button>
          <Button onClick={handleRename} variant="contained" disabled={!renameValue.trim()}
            sx={{ textTransform: "none", fontWeight: 600, borderRadius: 1.5, px: 2.5 }}>
            Rename
          </Button>
        </DialogActions>
      </Dialog>

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
        <DialogTitle sx={{ fontWeight: 700, fontSize: "1.05rem", color: "#1e293b" }}>
          New Project
        </DialogTitle>
        <DialogContent sx={{ pt: "12px !important" }}>
          {pendingTaskStage !== null && (
            <Typography sx={{ fontSize: "0.85rem", color: "#64748b", mb: 2 }}>
              You need a project before creating tasks. Create one to continue.
            </Typography>
          )}
          <TextField label="Project name" value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            fullWidth autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleCreateProject()}
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5, gap: 1 }}>
          <Button onClick={() => { setNewProjectOpen(false); setPendingTaskStage(null); }}
            sx={{ color: "#64748b", textTransform: "none", fontWeight: 500 }}>
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
    backgroundColor: active ? color : "#f1f5f9",
    color: active ? "#fff" : "#475569",
    border: `1.5px solid ${active ? color : "#e2e8f0"}`,
    "& .MuiChip-label": { px: 1.5 },
    "&:hover": { backgroundColor: active ? color : "#e2e8f0", borderColor: active ? color : "#cbd5e1" },
    transition: "all 0.15s ease",
  };
}

function allChipSx(active: boolean) {
  return {
    cursor: "pointer",
    fontWeight: 700,
    fontSize: "0.8rem",
    height: 30,
    backgroundColor: active ? "#1e293b" : "#f1f5f9",
    color: active ? "#fff" : "#94a3b8",
    border: `1.5px solid ${active ? "#1e293b" : "#e2e8f0"}`,
    "& .MuiChip-label": { px: 1.5 },
    "&:hover": { backgroundColor: active ? "#1e293b" : "#e2e8f0" },
    transition: "all 0.15s ease",
  };
}
