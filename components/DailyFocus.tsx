"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useMediaQuery from "@mui/material/useMediaQuery";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Checkbox from "@mui/material/Checkbox";
import Tooltip from "@mui/material/Tooltip";
import Button from "@mui/material/Button";
import Autocomplete from "@mui/material/Autocomplete";
import Collapse from "@mui/material/Collapse";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import AddIcon from "@mui/icons-material/Add";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import TaskAltIcon from "@mui/icons-material/TaskAlt";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ReplyIcon from "@mui/icons-material/Reply";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DraggableAttributes,
} from "@dnd-kit/core";
import type { SyntheticListenerMap } from "@dnd-kit/core/dist/hooks/utilities";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  arrayMove,
  verticalListSortingStrategy,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DailyGoal, Habit, Task } from "@/lib/types";
import { useVault } from "@/lib/vault-context";

const localDateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayStr = () => localDateStr(new Date());
const formatDate = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
const addDays = (base: string, days: number): string => {
  const d = new Date(base + "T12:00:00");
  d.setDate(d.getDate() + days);
  return localDateStr(d);
};

const getGoalLimit = () => {
  if (typeof window === "undefined") return 3;
  return parseInt(localStorage.getItem("dailyGoalLimit") ?? "3", 10) || 3;
};

interface DailyFocusProps {
  tasks: Task[];
  onCreateBoardTask?: (title: string, goalId: string) => void;
}

export default function DailyFocus({ tasks, onCreateBoardTask }: DailyFocusProps) {
  const isMobile = useMediaQuery("(max-width: 600px)");
  const vault = useVault();

  const vaultEncrypt = async (text: string): Promise<{ encText: string; text: string } | { text: string }> => {
    if (!vault.masterKey) return { text };
    const blob = await vault.encrypt(text);
    if (!blob) return { text };
    return { encText: JSON.stringify(blob), text: "" };
  };

  const vaultDecryptGoals = async (goals: DailyGoal[]): Promise<DailyGoal[]> => {
    if (!vault.masterKey) return goals;
    return Promise.all(goals.map(async (g) => {
      if (!g.encText) return g;
      const dec = await vault.decrypt(JSON.parse(g.encText));
      return { ...g, text: dec ?? g.text };
    }));
  };

  const vaultDecryptHabits = async (habits: Habit[]): Promise<Habit[]> => {
    if (!vault.masterKey) return habits;
    return Promise.all(habits.map(async (h) => {
      if (!h.encText) return h;
      const dec = await vault.decrypt(JSON.parse(h.encText));
      return { ...h, text: dec ?? h.text };
    }));
  };

  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("dailyFocusCollapsed") === "true";
  });
  const [goals, setGoals] = useState<DailyGoal[]>([]);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [carryOver, setCarryOver] = useState<DailyGoal[]>([]);
  const [goalLimit, setGoalLimit] = useState(getGoalLimit);
  const [todayReflection, setTodayReflection] = useState("");
  const [todayGratitude, setTodayGratitude] = useState("");
  const [prevDayReflection, setPrevDayReflection] = useState<string | null>(null);
  const [reflectionSaved, setReflectionSaved] = useState(false);
  const reflectionSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gratitudeSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reflectionSavedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [extraSlots, setExtraSlots] = useState(0);
  const [addingGoalSlot, setAddingGoalSlot] = useState<number | null>(null);
  const [sentBackSnackbar, setSentBackSnackbar] = useState(false);
  const [goalInput, setGoalInput] = useState("");
  const [goalTask, setGoalTask] = useState<Task | null>(null);

  const [addingHabit, setAddingHabit] = useState(false);
  const [habitInput, setHabitInput] = useState("");

  const [today, setToday] = useState<string>(todayStr);
  useEffect(() => {
    // Always override with the browser's local date — the server runs UTC and
    // can initialize this to the wrong calendar day after ~5 PM Pacific.
    setToday(todayStr());
    const id = setInterval(() => setToday(todayStr()), 60_000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [dayOffset, setDayOffset] = useState(0);

  const viewDate = useMemo(() => dayOffset === 0 ? today : addDays(today, dayOffset), [today, dayOffset]);
  const isToday = dayOffset === 0;
  const MAX_FUTURE = 7;
  const goalInputRef = useRef<HTMLInputElement>(null);
  const habitInputRef = useRef<HTMLInputElement>(null);

  const fetchGoals = useCallback(async () => {
    const viewRes = await fetch(`/api/daily-goals?date=${viewDate}`);
    const raw: DailyGoal[] = viewRes.ok ? await viewRes.json() : [];
    const viewGoals = await vaultDecryptGoals(raw);
    setGoals([...viewGoals.filter(g => !g.completed), ...viewGoals.filter(g => g.completed)]);
    if (isToday) {
      const carryRes = await fetch(`/api/daily-goals?carryover=true&today=${today}`);
      const carryRaw: DailyGoal[] = carryRes.ok ? await carryRes.json() : [];
      setCarryOver(await vaultDecryptGoals(carryRaw));
    } else {
      setCarryOver([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewDate, isToday, vault.masterKey]);

  const fetchHabits = useCallback(async () => {
    const res = await fetch(`/api/habits?date=${today}`);
    if (res.ok) {
      const raw: Habit[] = await res.json();
      setHabits(await vaultDecryptHabits(raw));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, vault.masterKey]);

  const fetchReflections = useCallback(async () => {
    const prevDay = addDays(viewDate, -1);
    const [todayRes, prevRes] = await Promise.all([
      fetch(`/api/daily-reflections?date=${today}`),
      fetch(`/api/daily-reflections?date=${prevDay}`),
    ]);
    if (todayRes.ok) {
      const r = await todayRes.json();
      const note = r?.encNote && vault.masterKey
        ? (await vault.decrypt(JSON.parse(r.encNote))) ?? r?.note ?? ""
        : (r?.note ?? "");
      const gratitude = r?.encGratitude && vault.masterKey
        ? (await vault.decrypt(JSON.parse(r.encGratitude))) ?? r?.gratitude ?? ""
        : (r?.gratitude ?? "");
      setTodayReflection(note);
      setTodayGratitude(gratitude);
    }
    if (prevRes.ok) {
      const r = await prevRes.json();
      const note = r?.encNote && vault.masterKey
        ? (await vault.decrypt(JSON.parse(r.encNote))) ?? r?.note ?? null
        : (r?.note ?? null);
      setPrevDayReflection(note);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, viewDate, vault.masterKey]);

  useEffect(() => {
    setAddingGoalSlot(null);
    setGoalInput("");
    setGoalTask(null);
    setExtraSlots(0);
  }, [dayOffset]);

  useEffect(() => {
    fetchGoals();
    fetchHabits();
    fetchReflections();
  }, [fetchGoals, fetchHabits, fetchReflections]);

  // Listen for external refresh trigger (e.g. from TaskCard pin button)
  useEffect(() => {
    const handler = () => { fetchGoals(); setGoalLimit(getGoalLimit()); };
    window.addEventListener("dailyfocus:refresh", handler);
    return () => window.removeEventListener("dailyfocus:refresh", handler);
  }, [fetchGoals]);

  useEffect(() => {
    if (addingGoalSlot !== null) goalInputRef.current?.focus();
  }, [addingGoalSlot]);

  useEffect(() => {
    if (addingHabit) habitInputRef.current?.focus();
  }, [addingHabit]);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem("dailyFocusCollapsed", String(next));
      return next;
    });
  };

  const handleAddGoal = async () => {
    const text = goalTask ? goalTask.title : goalInput.trim();
    if (!text) return;
    const encFields = await vaultEncrypt(text);
    const res = await fetch("/api/daily-goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...encFields, taskId: goalTask?.id ?? null, date: viewDate, position: goals.length, limit: totalSlots }),
    });
    if (res.ok) {
      await fetchGoals();
      setGoalInput("");
      setGoalTask(null);
      setAddingGoalSlot(null);
    }
  };

  const handleToggleGoal = async (goal: DailyGoal) => {
    const nowCompleted = !goal.completed;
    const res = await fetch(`/api/daily-goals/${goal.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: nowCompleted }),
    });
    if (res.ok) {
      setGoals((prev) => {
        const updated = prev.map((g) => g.id === goal.id ? { ...g, completed: nowCompleted } : g);
        return [...updated.filter((g) => !g.completed), ...updated.filter((g) => g.completed)];
      });
      if (nowCompleted && goal.taskId) {
        await fetch(`/api/tasks/${goal.taskId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ stage: "done" }),
        });
      }
    }
  };

  const handleDeleteGoal = async (id: string) => {
    await fetch(`/api/daily-goals/${id}`, { method: "DELETE" });
    setGoals((prev) => prev.filter((g) => g.id !== id));
  };

  const handleMoveToNextDay = async (id: string) => {
    const nextDay = addDays(viewDate, 1);
    const res = await fetch(`/api/daily-goals/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: nextDay }),
    });
    if (res.ok) setGoals((prev) => prev.filter((g) => g.id !== id));
  };

  const handleEditGoal = async (id: string, text: string) => {
    const encFields = await vaultEncrypt(text);
    const res = await fetch(`/api/daily-goals/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(encFields),
    });
    if (res.ok) {
      setGoals((prev) => prev.map((g) => g.id === id ? { ...g, text } : g));
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = goals.findIndex((g) => g.id === active.id);
    const newIndex = goals.findIndex((g) => g.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(goals, oldIndex, newIndex);
    setGoals(reordered);
    await Promise.all(
      reordered.map((g, i) =>
        fetch(`/api/daily-goals/${g.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position: i }),
        })
      )
    );
  };

  const handleHabitDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = displayHabits.findIndex((h) => h.id === active.id);
    const newIndex = displayHabits.findIndex((h) => h.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(displayHabits, oldIndex, newIndex);
    setHabits(reordered);
    await Promise.all(
      reordered.map((h, i) =>
        fetch(`/api/habits/${h.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ position: i }),
        })
      )
    );
  };

  const handleAddAnother = () => {
    const newSlotIndex = totalSlots;
    setExtraSlots((e) => e + 1);
    setAddingGoalSlot(newSlotIndex);
    setGoalInput("");
    setGoalTask(null);
  };

  const handleCarryOver = async () => {
    if (carryOver.some((g) => g.encText) && !vault.masterKey) {
      window.alert("Unlock your vault first to carry over encrypted goals.");
      return;
    }
    const limit = Math.min(goals.length + carryOver.length, 20);
    for (let i = 0; i < carryOver.length; i++) {
      const g = carryOver[i];
      const encFields = await vaultEncrypt(g.text);
      const createRes = await fetch("/api/daily-goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...encFields, taskId: g.taskId, date: today, position: goals.length + i, limit }),
      });
      if (!createRes.ok) continue;
      const created = await createRes.json();
      // Delete the original so it no longer appears as "unfinished from yesterday"
      const deleteRes = await fetch(`/api/daily-goals/${g.id}`, { method: "DELETE" });
      if (!deleteRes.ok) {
        // Rollback: remove the just-created goal to avoid duplication
        await fetch(`/api/daily-goals/${created.id}`, { method: "DELETE" });
      }
    }
    setCarryOver([]);
    await fetchGoals();
  };

  const handleAddHabit = async () => {
    if (!habitInput.trim()) return;
    const encFields = await vaultEncrypt(habitInput.trim());
    const res = await fetch("/api/habits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(encFields),
    });
    if (res.ok) {
      const raw = await res.json();
      const habit = { ...raw, text: habitInput.trim() };
      setHabits((prev) => [...prev, habit]);
      setHabitInput("");
      setAddingHabit(false);
    }
  };

  const handleToggleHabit = async (habit: Habit) => {
    const flip = (v: boolean) =>
      setHabits((prev) => prev.map((h) => h.id === habit.id ? { ...h, completedToday: v } : h));
    flip(!habit.completedToday); // optimistic
    if (habit.completedToday) {
      const res = await fetch(`/api/habits/${habit.id}/complete?date=${today}`, { method: "DELETE" });
      if (!res.ok) flip(true); // rollback
    } else {
      const res = await fetch(`/api/habits/${habit.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: today }),
      });
      if (!res.ok) flip(false); // rollback
    }
  };

  const handleDeleteHabit = async (id: string) => {
    const res = await fetch(`/api/habits/${id}`, { method: "DELETE" });
    if (res.ok) setHabits((prev) => prev.filter((h) => h.id !== id));
  };

  const flashSaved = useCallback(() => {
    setReflectionSaved(true);
    if (reflectionSavedTimer.current) clearTimeout(reflectionSavedTimer.current);
    reflectionSavedTimer.current = setTimeout(() => setReflectionSaved(false), 2000);
  }, []);

  const saveReflection = useCallback(async (note: string) => {
    const encFields = await vaultEncrypt(note);
    const body = "encText" in encFields
      ? { date: today, encNote: (encFields as { encText: string }).encText, note: "" }
      : { date: today, note };
    const res = await fetch("/api/daily-reflections", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) flashSaved();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, flashSaved, vault.masterKey]);

  const saveGratitude = useCallback(async (gratitude: string) => {
    const encFields = await vaultEncrypt(gratitude);
    const body = "encText" in encFields
      ? { date: today, encGratitude: (encFields as { encText: string }).encText, gratitude: "" }
      : { date: today, gratitude };
    const res = await fetch("/api/daily-reflections", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) flashSaved();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, flashSaved, vault.masterKey]);

  const handleReflectionChange = (value: string) => {
    setTodayReflection(value);
    if (reflectionSaveTimer.current) clearTimeout(reflectionSaveTimer.current);
    reflectionSaveTimer.current = setTimeout(() => saveReflection(value), 800);
  };

  const handleReflectionBlur = () => {
    if (reflectionSaveTimer.current) clearTimeout(reflectionSaveTimer.current);
    saveReflection(todayReflection);
  };

  const handleGratitudeChange = (value: string) => {
    setTodayGratitude(value);
    if (gratitudeSaveTimer.current) clearTimeout(gratitudeSaveTimer.current);
    gratitudeSaveTimer.current = setTimeout(() => saveGratitude(value), 800);
  };

  const handleGratitudeBlur = () => {
    if (gratitudeSaveTimer.current) clearTimeout(gratitudeSaveTimer.current);
    saveGratitude(todayGratitude);
  };

  const reflectionFieldSx = {
    "& .MuiOutlinedInput-root": {
      borderRadius: 2, fontSize: "0.875rem", backgroundColor: "var(--surface-2)",
      "& fieldset": { borderColor: "var(--border)" },
      "&:hover fieldset": { borderColor: "var(--border-2)" },
      "&.Mui-focused fieldset": { borderColor: "#6366f1", borderWidth: 1.5 },
    },
    "& textarea": { py: 1, px: 0.5, lineHeight: 1.5 },
  };

  const availableTasks = tasks.filter((t) => !t.archived && t.stage !== "done");
  const totalSlots = Math.max(goalLimit, goals.length) + extraSlots;
  const slots = Array.from({ length: totalSlots }, (_, i) => i);
  const allSlotsFilled = goals.length >= totalSlots;
  const completedGoals = goals.filter((g) => g.completed).length;
  const completedHabits = habits.filter((h) => h.completedToday).length;
  const displayHabits = [...habits].sort((a, b) => {
    if (a.completedToday === b.completedToday) return 0;
    return a.completedToday ? 1 : -1;
  });

  return (
    <Box sx={{
      backgroundColor: "var(--surface)",
      borderRadius: 2.5,
      boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
      mb: 3,
      flexShrink: 0,
      overflow: "hidden",
    }}>
      {/* Header */}
      <Box sx={{
        px: { xs: 2, sm: 3 }, py: 1.5,
        display: "flex", alignItems: "center", justifyContent: "space-between",
        borderBottom: collapsed ? "none" : "1px solid var(--border)",
        cursor: "pointer",
        "&:hover": { backgroundColor: "var(--surface-hover)" },
        transition: "background-color 0.15s",
      }} onClick={toggleCollapsed}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Typography sx={{ fontWeight: 700, fontSize: "0.9rem", color: "var(--tx)" }}>
            Daily Focus
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", border: "1px solid var(--border)", borderRadius: 2, px: 0.25, backgroundColor: "var(--surface-2)" }} onClick={(e) => e.stopPropagation()}>
            <IconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); setDayOffset((o) => o - 1); }}
              sx={{ p: 0.4, color: "var(--tx-3)", borderRadius: 1.5, "&:hover": { color: "var(--tx)", backgroundColor: "var(--border)" } }}
            >
              <ChevronLeftIcon sx={{ fontSize: 16 }} />
            </IconButton>
            <Typography sx={{ fontSize: "0.8rem", color: "var(--tx-2)", fontWeight: 600, mx: 0.75, userSelect: "none" }}>
              {isMobile
                ? new Date(viewDate + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
                : formatDate(viewDate)}
            </Typography>
            <IconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); setDayOffset((o) => Math.min(o + 1, MAX_FUTURE)); }}
              disabled={dayOffset >= MAX_FUTURE}
              sx={{ p: 0.4, color: "var(--tx-3)", borderRadius: 1.5, "&:hover": { color: "var(--tx)", backgroundColor: "var(--border)" }, "&.Mui-disabled": { color: "var(--border-2)" } }}
            >
              <ChevronRightIcon sx={{ fontSize: 16 }} />
            </IconButton>
            {(() => {
              const relativeLabel =
                dayOffset === -1 ? "Yesterday" :
                dayOffset === 0  ? "Today" :
                dayOffset === 1  ? "Tomorrow" :
                dayOffset === 2  ? "In 2 days" : null;

              if (relativeLabel) {
                return (
                  <Box sx={{ ml: 0.75, px: 1, py: 0.2, borderRadius: 99,
                    backgroundColor: "var(--accent-tint)", display: "inline-flex", alignItems: "center" }}>
                    <Typography sx={{ fontSize: "0.72rem", fontWeight: 700, color: "#6366f1", lineHeight: 1 }}>
                      {relativeLabel}
                    </Typography>
                  </Box>
                );
              }

              return (
                <Button
                  size="small"
                  onClick={(e) => { e.stopPropagation(); setDayOffset(0); }}
                  sx={{ ml: 0.5, textTransform: "none", fontSize: "0.72rem", fontWeight: 600,
                    color: "#6366f1", backgroundColor: "var(--accent-tint)", borderRadius: 99,
                    px: 1, py: 0.15, minWidth: 0, "&:hover": { backgroundColor: "var(--accent-tint)", opacity: 0.8 } }}
                >
                  Today
                </Button>
              );
            })()}
          </Box>
          {!collapsed && !isMobile && (goals.length > 0 || habits.length > 0) && (
            <Box sx={{ display: "flex", gap: 1 }}>
              {goals.length > 0 && (
                <Box sx={{
                  backgroundColor: completedGoals === goals.length ? "#dcfce7" : "var(--surface-2)",
                  borderRadius: 99, px: 1.25, py: 0.2,
                }}>
                  <Typography sx={{ fontSize: "0.72rem", fontWeight: 700, color: completedGoals === goals.length ? "#16a34a" : "var(--tx-3)" }}>
                    {completedGoals}/{goals.length} goals
                  </Typography>
                </Box>
              )}
              {habits.length > 0 && (
                <Box sx={{
                  backgroundColor: completedHabits === habits.length ? "#dcfce7" : "var(--surface-2)",
                  borderRadius: 99, px: 1.25, py: 0.2,
                }}>
                  <Typography sx={{ fontSize: "0.72rem", fontWeight: 700, color: completedHabits === habits.length ? "#16a34a" : "var(--tx-3)" }}>
                    {completedHabits}/{habits.length} habits
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </Box>
        <IconButton size="small" sx={{ color: "var(--tx-4)" }}>
          {collapsed ? <ExpandMoreIcon sx={{ fontSize: 18 }} /> : <ExpandLessIcon sx={{ fontSize: 18 }} />}
        </IconButton>
      </Box>

      <Snackbar
        open={sentBackSnackbar}
        autoHideDuration={2000}
        onClose={() => setSentBackSnackbar(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert onClose={() => setSentBackSnackbar(false)} severity="info" variant="filled"
          sx={{ borderRadius: 2, fontWeight: 600, fontSize: "0.875rem" }}>
          Sent to board
        </Alert>
      </Snackbar>

      <Collapse in={!collapsed}>
        <Box sx={{ px: { xs: 2, sm: 3 }, py: 2.5, display: "flex", flexDirection: "column", gap: 2.5 }}>

          {/* ── Previous day's reflection banner ── */}
          {prevDayReflection && (
            <Box sx={{
              display: "flex", alignItems: "flex-start", gap: 1.25,
              borderLeft: "3px solid #6366f1",
              pl: 1.5, py: 0.5,
            }}>
              <Typography sx={{ fontSize: "0.72rem", fontWeight: 800, color: "#6366f1", textTransform: "uppercase", letterSpacing: 0.8, flexShrink: 0, mt: "1px" }}>
                One thing to do better today
              </Typography>
              <Typography sx={{ fontSize: "0.85rem", color: "var(--tx-2)", fontWeight: 500, lineHeight: 1.4 }}>
                {prevDayReflection}
              </Typography>
            </Box>
          )}

          {/* ── Habits ── (today only) */}
          {isToday && <Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.25 }}>
              <Typography sx={{ fontSize: "0.7rem", fontWeight: 800, color: "var(--tx-4)", textTransform: "uppercase", letterSpacing: 1.1 }}>
                Daily Habits
              </Typography>
            </Box>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleHabitDragEnd}>
              <SortableContext items={displayHabits.map((h) => h.id)} strategy={rectSortingStrategy}>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, alignItems: "center" }}>
                  {displayHabits.map((habit) => (
                    <HabitChip
                      key={habit.id}
                      habit={habit}
                      onToggle={() => handleToggleHabit(habit)}
                      onDelete={() => handleDeleteHabit(habit.id)}
                    />
                  ))}
              {addingHabit ? (
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                  <TextField
                    inputRef={habitInputRef}
                    size="small"
                    placeholder="e.g. Meditate 10 mins"
                    value={habitInput}
                    onChange={(e) => setHabitInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleAddHabit();
                      if (e.key === "Escape") { setAddingHabit(false); setHabitInput(""); }
                    }}
                    sx={{
                      width: "100%", maxWidth: 220,
                      "& .MuiOutlinedInput-root": {
                        borderRadius: 2, fontSize: "0.85rem",
                        "& fieldset": { borderColor: "#6366f1" },
                      },
                      "& input": { py: "6px" },
                    }}
                  />
                  <Button size="small" variant="contained" onClick={handleAddHabit}
                    disabled={!habitInput.trim()}
                    sx={{ textTransform: "none", fontSize: "0.8rem", fontWeight: 600, borderRadius: 1.5, py: 0.6, px: 1.5, minWidth: 0,
                      background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
                      "&:hover": { background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" } }}>
                    Add
                  </Button>
                  <Button size="small" onClick={() => { setAddingHabit(false); setHabitInput(""); }}
                    sx={{ textTransform: "none", fontSize: "0.8rem", color: "var(--tx-4)", minWidth: 0 }}>
                    Cancel
                  </Button>
                </Box>
              ) : (
                <Tooltip title="Add a daily habit" placement="top">
                  <IconButton size="small" onClick={() => setAddingHabit(true)}
                    sx={{
                      border: "1.5px dashed var(--border)", borderRadius: 1.5, p: 0.6,
                      color: "var(--tx-4)",
                      "&:hover": { borderColor: "#6366f1", color: "#6366f1", backgroundColor: "#f5f3ff" },
                      transition: "all 0.15s",
                    }}>
                    <AddIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              )}
                </Box>
              </SortableContext>
            </DndContext>
          </Box>}

          {isToday && <Box sx={{ borderTop: "1px solid var(--divider)" }} />}

          {/* ── Goals ── */}
          <Box>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.25 }}>
              <Typography sx={{ fontSize: "0.7rem", fontWeight: 800, color: "var(--tx-4)", textTransform: "uppercase", letterSpacing: 1.1 }}>
                {isToday ? `Today's Top Goals` : dayOffset === 1 ? `Tomorrow's Goals` : dayOffset === -1 ? `Yesterday's Goals` : `${formatDate(viewDate).split(",")[0]}'s Goals`}
              </Typography>
              {isToday && carryOver.length > 0 && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography sx={{ fontSize: "0.75rem", color: "#f59e0b", fontWeight: 500 }}>
                    {carryOver.length} unfinished from yesterday
                  </Typography>
                  <Button size="small" onClick={handleCarryOver}
                    sx={{ textTransform: "none", fontSize: "0.75rem", fontWeight: 600, color: "#f59e0b",
                      backgroundColor: "#fef3c7", borderRadius: 1.5, px: 1.25, py: 0.3, minWidth: 0,
                      "&:hover": { backgroundColor: "#fde68a" } }}>
                    Carry over
                  </Button>
                </Box>
              )}
            </Box>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={goals.map((g) => g.id)} strategy={verticalListSortingStrategy}>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  {/* Filled goals — sortable */}
                  {goals.map((goal, index) => (
                    <SortableGoalSlot
                      key={goal.id}
                      id={goal.id}
                      slot={index}
                      goal={goal}
                      isAdding={false}
                      goalInput={goalInput}
                      goalTask={goalTask}
                      availableTasks={availableTasks}
                      goalInputRef={goalInputRef}
                      onStartAdd={() => {}}
                      onCancelAdd={() => { setAddingGoalSlot(null); setGoalInput(""); setGoalTask(null); }}
                      onGoalInputChange={setGoalInput}
                      onGoalTaskChange={setGoalTask}
                      onAddGoal={handleAddGoal}
                      onToggleGoal={() => handleToggleGoal(goal)}
                      onDeleteGoal={() => handleDeleteGoal(goal.id)}
                      onEditGoal={handleEditGoal}
                      onMoveToNextDay={dayOffset < MAX_FUTURE ? () => handleMoveToNextDay(goal.id) : undefined}
                      onSendToBoard={goal.taskId
                        ? async () => { await handleDeleteGoal(goal.id); setSentBackSnackbar(true); }
                        : onCreateBoardTask
                          ? () => onCreateBoardTask(goal.text, goal.id)
                          : undefined}
                      canAdd={false}
                    />
                  ))}
                  {/* Empty slots — not draggable */}
                  {slots.slice(goals.length).map((_, i) => {
                    const slotIndex = goals.length + i;
                    return (
                      <GoalSlot
                        key={`empty-${slotIndex}`}
                        slot={slotIndex}
                        goal={undefined}
                        isAdding={addingGoalSlot === slotIndex}
                        goalInput={goalInput}
                        goalTask={goalTask}
                        availableTasks={availableTasks}
                        goalInputRef={goalInputRef}
                        onStartAdd={() => { setAddingGoalSlot(slotIndex); setGoalInput(""); setGoalTask(null); }}
                        onCancelAdd={() => { setAddingGoalSlot(null); setGoalInput(""); setGoalTask(null); }}
                        onGoalInputChange={setGoalInput}
                        onGoalTaskChange={setGoalTask}
                        onAddGoal={handleAddGoal}
                        onToggleGoal={() => {}}
                        onDeleteGoal={() => {}}
                        onEditGoal={handleEditGoal}
                        canAdd={true}
                      />
                    );
                  })}
                  {allSlotsFilled && addingGoalSlot === null && (
                    <Box
                      onClick={handleAddAnother}
                      sx={{
                        display: "flex", alignItems: "center", gap: 0.75,
                        px: 1.5, py: 0.75, mt: 0.25,
                        cursor: "pointer", width: "fit-content",
                        color: "var(--tx-4)",
                        borderRadius: 1.5,
                        transition: "color 0.15s, background-color 0.15s",
                        "&:hover": { color: "#6366f1", backgroundColor: "#f5f3ff" },
                      }}
                    >
                      <AddIcon sx={{ fontSize: 14 }} />
                      <Typography sx={{ fontSize: "0.8rem", fontWeight: 600 }}>Add another</Typography>
                    </Box>
                  )}
                </Box>
              </SortableContext>
            </DndContext>
          </Box>

          {/* ── Reflection ── (today only) */}
          {isToday && (
            <>
              <Box sx={{ borderTop: "1px solid var(--divider)" }} />
              <Box>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                  <Typography sx={{ fontSize: "0.7rem", fontWeight: 800, color: "var(--tx-4)", textTransform: "uppercase", letterSpacing: 1.1 }}>
                    One thing to do better tomorrow
                  </Typography>
                  {reflectionSaved && (
                    <Typography sx={{ fontSize: "0.7rem", fontWeight: 600, color: "#22c55e" }}>
                      Saved
                    </Typography>
                  )}
                </Box>
                <TextField
                  fullWidth
                  multiline
                  minRows={1}
                  maxRows={3}
                  placeholder="Write one thing you can improve tomorrow…"
                  value={todayReflection}
                  onChange={(e) => handleReflectionChange(e.target.value)}
                  onBlur={handleReflectionBlur}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.target as HTMLElement).blur(); }
                  }}
                  slotProps={{ htmlInput: { maxLength: 500 } }}
                  sx={reflectionFieldSx}
                />
              </Box>

              <Box>
                <Typography sx={{ fontSize: "0.7rem", fontWeight: 800, color: "var(--tx-4)", textTransform: "uppercase", letterSpacing: 1.1, mb: 1 }}>
                  One thing I&apos;m grateful for
                </Typography>
                <TextField
                  fullWidth
                  multiline
                  minRows={1}
                  maxRows={3}
                  placeholder="Write one thing you're grateful for today…"
                  value={todayGratitude}
                  onChange={(e) => handleGratitudeChange(e.target.value)}
                  onBlur={handleGratitudeBlur}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.target as HTMLElement).blur(); }
                  }}
                  slotProps={{ htmlInput: { maxLength: 500 } }}
                  sx={reflectionFieldSx}
                />
              </Box>
            </>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

function HabitChip({ habit, onToggle, onDelete }: { habit: Habit; onToggle: () => void; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: habit.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return (
    <Box ref={setNodeRef} style={style} sx={{
      display: "flex", alignItems: "center", gap: 0.5,
      backgroundColor: habit.completedToday ? "#dcfce7" : "var(--surface-2)",
      border: `1.5px solid ${habit.completedToday ? "#86efac" : "var(--border)"}`,
      borderRadius: 99,
      pl: 0.5, pr: 0.75, py: 0.4,
      transition: "all 0.2s",
      "&:hover .habit-delete": { opacity: 1 },
      "&:hover .habit-drag": { opacity: 1 },
    }}>
      {/* Drag handle — appears on hover */}
      <Box className="habit-drag" {...attributes} {...listeners}
        sx={{ cursor: "grab", opacity: 0, transition: "opacity 0.15s", display: "flex", alignItems: "center", color: "var(--tx-4)", px: 0.25 }}>
        <DragIndicatorIcon sx={{ fontSize: 13 }} />
      </Box>
      <Checkbox
        checked={habit.completedToday}
        onChange={onToggle}
        size="small"
        icon={<RadioButtonUncheckedIcon sx={{ fontSize: 16, color: "var(--tx-4)" }} />}
        checkedIcon={<CheckCircleIcon sx={{ fontSize: 16, color: "#22c55e" }} />}
        sx={{ p: 0.25 }}
      />
      <Typography sx={{
        fontSize: "0.82rem", fontWeight: 500,
        color: habit.completedToday ? "#15803d" : "var(--tx-2)",
        textDecoration: habit.completedToday ? "line-through" : "none",
        transition: "all 0.2s",
      }}>
        {habit.text}
      </Typography>
      <IconButton className="habit-delete" size="small" onClick={onDelete}
        sx={{ p: 0.2, opacity: 0, transition: "opacity 0.15s", color: "var(--border-2)",
          "&:hover": { color: "#ef4444" }, ml: 0.25 }}>
        <DeleteOutlineIcon sx={{ fontSize: 13 }} />
      </IconButton>
    </Box>
  );
}

interface GoalSlotProps {
  slot: number;
  goal: DailyGoal | undefined;
  isAdding: boolean;
  goalInput: string;
  goalTask: Task | null;
  availableTasks: Task[];
  goalInputRef: React.RefObject<HTMLInputElement | null>;
  onStartAdd: () => void;
  onCancelAdd: () => void;
  onGoalInputChange: (v: string) => void;
  onGoalTaskChange: (t: Task | null) => void;
  onAddGoal: () => void;
  onToggleGoal: () => void;
  onDeleteGoal: () => void;
  onEditGoal: (id: string, text: string) => Promise<void>;
  onMoveToNextDay?: () => void;
  onSendToBoard?: () => void;
  canAdd: boolean;
  // drag-and-drop
  dragHandleListeners?: SyntheticListenerMap;
  dragHandleAttributes?: DraggableAttributes;
  isDragging?: boolean;
}

function GoalSlot({
  slot, goal, isAdding, goalInput, goalTask, availableTasks, goalInputRef,
  onStartAdd, onCancelAdd, onGoalInputChange, onGoalTaskChange,
  onAddGoal, onToggleGoal, onDeleteGoal, onEditGoal, onMoveToNextDay, onSendToBoard, canAdd,
  dragHandleListeners, dragHandleAttributes, isDragging,
}: GoalSlotProps) {
  const numberLabel = `${slot + 1}`;
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(goal?.text ?? "");
  const editRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) editRef.current?.focus();
  }, [isEditing]);

  useEffect(() => {
    if (goal) setEditText(goal.text);
  }, [goal?.text]);

  const handleSaveEdit = async () => {
    const trimmed = editText.trim();
    if (trimmed && goal && trimmed !== goal.text) {
      await onEditGoal(goal.id, trimmed);
    } else if (!trimmed && goal) {
      setEditText(goal.text);
    }
    setIsEditing(false);
  };

  if (goal) {
    return (
      <Box sx={{
        display: "flex", alignItems: "center", gap: 1,
        p: 1.25, borderRadius: 2,
        backgroundColor: goal.completed ? "#f0fdf4" : "var(--surface-2)",
        border: `1.5px solid ${isEditing ? "#6366f1" : goal.completed ? "#86efac" : "var(--border)"}`,
        transition: "all 0.2s",
        opacity: isDragging ? 0.4 : 1,
        "&:hover .goal-action": { opacity: 1 },
      }}>
        {dragHandleListeners && (
          <Box
            className="goal-action"
            {...dragHandleListeners}
            {...dragHandleAttributes}
            sx={{
              cursor: "grab", opacity: 0, flexShrink: 0,
              color: "var(--border-2)", display: "flex", alignItems: "center",
              transition: "opacity 0.15s, color 0.15s",
              "&:hover": { color: "var(--tx-4)" },
              "&:active": { cursor: "grabbing" },
            }}
          >
            <DragIndicatorIcon sx={{ fontSize: 16 }} />
          </Box>
        )}
        <Box sx={{
          width: 22, height: 22, borderRadius: 99, flexShrink: 0,
          backgroundColor: goal.completed ? "#22c55e" : "var(--border)",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "background-color 0.2s",
        }}>
          <Typography sx={{ fontSize: "0.7rem", fontWeight: 800, color: goal.completed ? "#fff" : "var(--tx-4)" }}>
            {numberLabel}
          </Typography>
        </Box>
        <Checkbox
          checked={goal.completed}
          onChange={onToggleGoal}
          size="small"
          icon={<RadioButtonUncheckedIcon sx={{ fontSize: 18, color: "var(--tx-4)" }} />}
          checkedIcon={<CheckCircleIcon sx={{ fontSize: 18, color: "#22c55e" }} />}
          sx={{ p: 0.25 }}
        />
        {isEditing ? (
          <TextField
            inputRef={editRef}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); handleSaveEdit(); }
              if (e.key === "Escape") { setEditText(goal.text); setIsEditing(false); }
            }}
            onBlur={handleSaveEdit}
            size="small"
            fullWidth
            sx={{
              flex: 1,
              "& .MuiOutlinedInput-root": {
                borderRadius: 1, fontSize: "0.875rem",
                "& fieldset": { border: "none" },
              },
              "& input": { py: "2px", px: 0.5 },
            }}
          />
        ) : (
          <Typography
            onDoubleClick={() => !goal.completed && setIsEditing(true)}
            sx={{
              flex: 1, fontSize: "0.875rem", fontWeight: 500,
              color: goal.completed ? "#15803d" : "var(--tx)",
              textDecoration: goal.completed ? "line-through" : "none",
              transition: "all 0.2s",
              cursor: goal.completed ? "default" : "text",
            }}
          >
            {goal.text}
          </Typography>
        )}
        {goal.taskId && !isEditing && (
          <Typography sx={{ fontSize: "0.7rem", color: "var(--tx-4)", fontWeight: 500, flexShrink: 0 }}>
            linked
          </Typography>
        )}
        {!goal.completed && !isEditing && (
          <Tooltip title="Edit" placement="top">
            <IconButton className="goal-action" size="small" onClick={() => setIsEditing(true)}
              sx={{ p: 0.5, opacity: 0, transition: "opacity 0.15s", color: "var(--border-2)",
                "&:hover": { color: "#6366f1" } }}>
              <EditOutlinedIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        )}
        {/* Mark done action — syncs linked task too */}
        {!goal.completed && !isEditing && (
          <Tooltip title={goal.taskId ? "Mark done & move task to Done" : "Mark done"} placement="top">
            <IconButton className="goal-action" size="small" onClick={onToggleGoal}
              sx={{ p: 0.5, opacity: 0, transition: "opacity 0.15s", color: "var(--border-2)",
                "&:hover": { color: "#22c55e" } }}>
              <TaskAltIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        )}
        {!goal.completed && !isEditing && onMoveToNextDay && (
          <Tooltip title="Move to next day" placement="top">
            <IconButton className="goal-action" size="small" onClick={onMoveToNextDay}
              sx={{ p: 0.5, opacity: 0, transition: "opacity 0.15s", color: "var(--border-2)",
                "&:hover": { color: "#6366f1" } }}>
              <ArrowForwardIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        )}
        {!goal.completed && !isEditing && onSendToBoard && (
          <Tooltip title="Send to board" placement="top">
            <IconButton className="goal-action" size="small" onClick={onSendToBoard}
              sx={{ p: 0.5, opacity: 0, transition: "opacity 0.15s", color: "var(--border-2)",
                "&:hover": { color: "#6366f1" } }}>
              <ReplyIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        )}
        {!isEditing && (
          <Tooltip title="Remove" placement="top">
            <IconButton className="goal-action" size="small" onClick={onDeleteGoal}
              sx={{ p: 0.5, opacity: 0, transition: "opacity 0.15s", color: "var(--border-2)",
                "&:hover": { color: "#ef4444" } }}>
              <DeleteOutlineIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    );
  }

  if (isAdding) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1, p: 1.25, borderRadius: 2, border: "1.5px solid #6366f1", backgroundColor: "var(--accent-tint)" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Box sx={{
            width: 22, height: 22, borderRadius: 99, flexShrink: 0,
            backgroundColor: "#6366f1",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Typography sx={{ fontSize: "0.7rem", fontWeight: 800, color: "#fff" }}>{numberLabel}</Typography>
          </Box>
          <Autocomplete
            freeSolo
            options={availableTasks}
            getOptionLabel={(o) => (typeof o === "string" ? o : (o.title || (o.locked || o.encTitle ? "🔒 Locked task" : "")))}
            getOptionDisabled={(o) => typeof o !== "string" && !o.title && !!(o.locked || o.encTitle)}
            value={goalTask}
            inputValue={goalInput}
            onInputChange={(_, v) => onGoalInputChange(v)}
            onChange={(_, v) => {
              if (v && typeof v !== "string") {
                onGoalTaskChange(v);
                onGoalInputChange(v.title);
              } else {
                onGoalTaskChange(null);
              }
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                inputRef={goalInputRef}
                size="small"
                placeholder="Type a goal or pick a task…"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onAddGoal(); }
                  if (e.key === "Escape") onCancelAdd();
                }}
                sx={{
                  "& .MuiOutlinedInput-root": {
                    borderRadius: 1.5, fontSize: "0.875rem", backgroundColor: "var(--surface)",
                    "& fieldset": { border: "none" },
                  },
                  "& input": { py: "6px" },
                }}
              />
            )}
            sx={{ flex: 1 }}
            renderOption={(props, option) => {
              const isLocked = !option.title && !!(option.locked || option.encTitle);
              return (
                <Box component="li" {...props} sx={{ fontSize: "0.85rem", opacity: isLocked ? 0.65 : 1 }}>
                  <Box sx={{ display: "flex", flexDirection: "column" }}>
                    <Typography sx={{ fontSize: "0.85rem", fontWeight: 500, color: isLocked ? "var(--tx-2)" : "inherit" }}>
                      {isLocked ? "🔒 Locked task" : option.title}
                    </Typography>
                    {isLocked
                      ? <Typography sx={{ fontSize: "0.7rem", color: "var(--tx-3)" }}>Unlock vault to link this task</Typography>
                      : option.project && <Typography sx={{ fontSize: "0.72rem", color: "var(--tx-4)" }}>{option.project.name}</Typography>
                    }
                  </Box>
                </Box>
              );
            }}
          />
        </Box>
        <Box sx={{ display: "flex", gap: 0.75, justifyContent: "flex-end" }}>
          <Button size="small" onClick={onCancelAdd}
            sx={{ textTransform: "none", fontSize: "0.8rem", color: "var(--tx-4)", minWidth: 0 }}>
            Cancel
          </Button>
          <Button size="small" variant="contained" onClick={onAddGoal}
            disabled={!goalInput.trim() && !goalTask}
            sx={{ textTransform: "none", fontSize: "0.8rem", fontWeight: 600, borderRadius: 1.5, px: 1.5, py: 0.5,
              background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
              "&:hover": { background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" } }}>
            Set Goal
          </Button>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      onClick={canAdd ? onStartAdd : undefined}
      sx={{
        display: "flex", alignItems: "center", gap: 1,
        p: 1.25, borderRadius: 2,
        border: "1.5px dashed var(--border)",
        cursor: canAdd ? "pointer" : "default",
        opacity: canAdd ? 1 : 0.4,
        "&:hover": canAdd ? { borderColor: "#6366f1", backgroundColor: "#f5f3ff" } : {},
        transition: "all 0.15s",
      }}>
      <Box sx={{
        width: 22, height: 22, borderRadius: 99, flexShrink: 0,
        backgroundColor: "var(--bg)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Typography sx={{ fontSize: "0.7rem", fontWeight: 800, color: "var(--border-2)" }}>{numberLabel}</Typography>
      </Box>
      <Typography sx={{ fontSize: "0.85rem", color: "var(--border-2)", fontWeight: 500 }}>
        {canAdd ? "Add a goal…" : "—"}
      </Typography>
    </Box>
  );
}

function SortableGoalSlot({ id, ...rest }: GoalSlotProps & { id: string }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <Box
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
    >
      <GoalSlot
        {...rest}
        dragHandleListeners={listeners}
        dragHandleAttributes={attributes}
        isDragging={isDragging}
      />
    </Box>
  );
}
