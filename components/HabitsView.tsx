"use client";
import { useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import ButtonBase from "@mui/material/ButtonBase";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Collapse from "@mui/material/Collapse";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import useMediaQuery from "@mui/material/useMediaQuery";
import AddIcon from "@mui/icons-material/Add";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import CloseIcon from "@mui/icons-material/Close";
import { useHabits, statsFor, habitLogs, type HabitItem } from "@/lib/useHabits";
import { KIND_COPY, PRESETS } from "@/lib/habit-kind";
import { addDays, overallStats, weekRecords, type HabitKind, type WeekStart } from "@/lib/habit-stats";
import { WeekStrip, nextOutcome, groupLabelSx, SortableHabitRows, WIN, LOSS } from "./HabitParts";

const KINDS: HabitKind[] = ["GOOD", "BAD"];

const primaryBtnSx = {
  textTransform: "none", fontWeight: 600, fontSize: "0.85rem", borderRadius: 2, px: 2, color: "#fff",
  background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
  "&:hover": { background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" },
  "&.Mui-disabled": { color: "rgba(255,255,255,0.7)", opacity: 0.6 },
} as const;

const cardSx = {
  backgroundColor: "var(--surface)", borderRadius: 2.5, boxShadow: "0 1px 4px rgba(0,0,0,0.07)",
} as const;

const shortDate = (d: string) =>
  new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default function HabitsView() {
  const h = useHabits();
  const isNarrow = useMediaQuery("(max-width: 899px)");
  const [creating, setCreating] = useState<HabitKind | "pick" | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const active = h.habits.filter((x) => !x.archivedAt);
  const archived = h.habits.filter((x) => x.archivedAt);
  const overall = useMemo(
    () => overallStats(active.map((x) => statsFor(x, h.today, h.weekStartsOn))),
    [active, h.today, h.weekStartsOn],
  );
  const detail = h.habits.find((x) => x.id === detailId) ?? null;

  useEffect(() => {
    const handler = () => setCreating("pick");
    window.addEventListener("habits:new", handler);
    return () => window.removeEventListener("habits:new", handler);
  }, []);

  if (h.loading) {
    return <Box sx={{ display: "grid", placeItems: "center", height: "100%" }}><CircularProgress size={28} /></Box>;
  }

  return (
    <Box sx={{ minHeight: "100%", backgroundColor: "var(--surface-2)" }}>
      <Box sx={{ maxWidth: 1000, mx: "auto", px: { xs: 2, sm: 4 }, py: { xs: 2.5, sm: 4 }, display: "flex", flexDirection: "column", gap: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
          <Typography component="h1" sx={{ fontSize: "1.4rem", fontWeight: 800, color: "var(--tx)" }}>Habits</Typography>
          <Box sx={{ flex: 1 }} />
          <Button startIcon={<AddIcon />} onClick={() => setCreating("pick")} sx={primaryBtnSx}>New habit</Button>
        </Box>

        {active.length > 0 && (
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(4, minmax(0, 1fr))" }, gap: 1.5 }}>
            <Stat label="Wins" value={overall.wins} color={WIN.fg} />
            <Stat label="Losses" value={overall.losses} color={LOSS.fg} />
            <Stat label="Days logged" value={overall.days} />
            <Stat label="Win rate" value={overall.days ? `${overall.winRate}%` : "–"} />
          </Box>
        )}

        {KINDS.map((kind) => (
          <HabitGroup
            key={kind}
            kind={kind}
            items={active.filter((x) => x.kind === kind)}
            today={h.today}
            weekStartsOn={h.weekStartsOn}
            narrow={isNarrow}
            onOutcome={h.setOutcome}
            onOpen={setDetailId}
            onAdd={() => setCreating(kind)}
            onReorder={(ids) => h.reorder(kind, ids)}
          />
        ))}

        {archived.length > 0 && (
          <Box>
            <ButtonBase onClick={() => setShowArchived((v) => !v)} sx={{ ...groupLabelSx, gap: 0.5, borderRadius: 1, px: 0.5 }}>
              Archived ({archived.length}) {showArchived ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
            </ButtonBase>
            <Collapse in={showArchived}>
              <Box sx={{ ...cardSx, mt: 1, py: 0.5 }}>
                {archived.map((x) => {
                  const s = statsFor(x, h.today, h.weekStartsOn);
                  return (
                    <Box key={x.id} sx={{ display: "flex", alignItems: "center", gap: 2, px: 2.5, py: 1.25, borderBottom: "1px solid var(--divider)", "&:last-child": { borderBottom: 0 } }}>
                      <ButtonBase onClick={() => setDetailId(x.id)} sx={{ flex: 1, minWidth: 0, justifyContent: "flex-start", textAlign: "left", borderRadius: 1 }}>
                        <Typography sx={{ fontSize: "0.88rem", color: "var(--tx-3)", overflowWrap: "anywhere" }}>{x.name || "Encrypted habit"}</Typography>
                      </ButtonBase>
                      <Typography sx={{ fontSize: "0.78rem", color: "var(--tx-4)", fontVariantNumeric: "tabular-nums" }}>{s.wins}–{s.losses}</Typography>
                      <Button size="small" onClick={() => h.updateHabit(x.id, { archived: false })} sx={{ textTransform: "none", color: "#6366f1", fontWeight: 600 }}>Restore</Button>
                    </Box>
                  );
                })}
              </Box>
            </Collapse>
          </Box>
        )}
      </Box>

      {creating !== null && (
        <NewHabitDialog
          initialKind={creating === "pick" ? null : creating}
          onClose={() => setCreating(null)}
          onCreate={async (kind, name) => { if (await h.createHabit(kind, name)) setCreating(null); }}
        />
      )}

      {detail && (
        <HabitDetailDialog
          key={detail.id}
          habit={detail}
          today={h.today}
          weekStartsOn={h.weekStartsOn}
          onClose={() => setDetailId(null)}
          onOutcome={h.setOutcome}
          onRename={(name) => h.updateHabit(detail.id, { name })}
          onArchive={(archived) => h.updateHabit(detail.id, { archived })}
          onDelete={async () => { await h.deleteHabit(detail.id); setDetailId(null); }}
        />
      )}

      <Snackbar open={!!h.error} autoHideDuration={5000} onClose={h.clearError} anchorOrigin={{ vertical: "bottom", horizontal: "center" }}>
        <Alert severity="error" onClose={h.clearError} sx={{ borderRadius: 2 }}>{h.error}</Alert>
      </Snackbar>
    </Box>
  );
}

function Stat({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <Box sx={{ ...cardSx, px: 2, py: 1.5 }}>
      <Typography sx={{ fontSize: "1.4rem", fontWeight: 800, color: color ?? "var(--tx)", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{value}</Typography>
      <Typography sx={{ ...groupLabelSx, mt: 0.25 }}>{label}</Typography>
    </Box>
  );
}

interface HabitGroupProps {
  kind: HabitKind;
  items: HabitItem[];
  today: string;
  weekStartsOn: WeekStart;
  narrow: boolean;
  onOutcome: (id: string, date: string, o: "W" | "L" | null) => void;
  onOpen: (id: string) => void;
  onAdd: () => void;
  onReorder: (ids: string[]) => void;
}

function HabitGroup({ kind, items, today, weekStartsOn, narrow, onOutcome, onOpen, onAdd, onReorder }: HabitGroupProps) {
  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
        <Typography component="h2" sx={groupLabelSx}>{KIND_COPY[kind].group}</Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" startIcon={<AddIcon sx={{ fontSize: 16 }} />} onClick={onAdd}
          sx={{ textTransform: "none", fontSize: "0.78rem", color: "var(--tx-3)", "&:hover": { color: "#6366f1" } }}>
          Add {KIND_COPY[kind].title.toLowerCase()}
        </Button>
      </Box>
      <Box sx={{ ...cardSx, py: 0.75 }}>
        {items.length === 0 ? (
          <Typography sx={{ px: 2.5, py: 2, fontSize: "0.85rem", color: "var(--tx-4)" }}>
            {kind === "GOOD" ? "Add something you want to do every day." : "Add something you want to stop doing."}
          </Typography>
        ) : (
          <SortableHabitRows items={items} today={today} weekStartsOn={weekStartsOn} narrow={narrow}
            onOutcome={onOutcome} onOpen={onOpen} onReorder={onReorder} allowBackfill />
        )}
      </Box>
    </Box>
  );
}

// ── New habit: kind first, then the name ───────────────────────────────────────

function NewHabitDialog({ initialKind, onClose, onCreate }: {
  initialKind: HabitKind | null;
  onClose: () => void;
  onCreate: (kind: HabitKind, name: string) => Promise<void>;
}) {
  const [kind, setKind] = useState<HabitKind | null>(initialKind);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!kind || !name.trim() || saving) return;
    setSaving(true);
    await onCreate(kind, name.trim());
    setSaving(false);
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs" slotProps={{ paper: { sx: { borderRadius: 3, backgroundColor: "var(--surface)" } } }}>
      <DialogTitle sx={{ fontWeight: 700, color: "var(--tx)", pb: 1 }}>
        {kind ? `New ${KIND_COPY[kind].title.toLowerCase()}` : "New habit"}
      </DialogTitle>
      <DialogContent>
        {!kind ? (
          <Box sx={{ display: "grid", gap: 1.25, pt: 0.5 }}>
            {KINDS.map((k) => (
              <ButtonBase key={k} onClick={() => setKind(k)} sx={{
                display: "block", textAlign: "left", p: 2, borderRadius: 2, border: "1.5px solid var(--border)",
                "&:hover": { borderColor: "#6366f1", backgroundColor: "var(--accent-tint)" },
                "&.Mui-focusVisible": { borderColor: "#6366f1" },
              }}>
                <Typography sx={{ fontWeight: 700, color: "var(--tx)", fontSize: "0.95rem" }}>
                  {KIND_COPY[k].title} <Typography component="span" sx={{ ...groupLabelSx, ml: 0.75 }}>{KIND_COPY[k].group}</Typography>
                </Typography>
                <Typography sx={{ fontSize: "0.82rem", color: "var(--tx-3)", mt: 0.25 }}>{KIND_COPY[k].explainer}</Typography>
              </ButtonBase>
            ))}
          </Box>
        ) : (
          <Box sx={{ display: "grid", gap: 2, pt: 0.5 }}>
            <Typography sx={{ fontSize: "0.82rem", color: "var(--tx-3)" }}>{KIND_COPY[kind].explainer}</Typography>
            <TextField autoFocus size="small" label="Name" value={name} slotProps={{ htmlInput: { maxLength: 200 } }}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              sx={{ "& .MuiOutlinedInput-root": { borderRadius: 2 }, "& .Mui-focused fieldset": { borderColor: "#6366f1 !important" }, "& .MuiInputLabel-root.Mui-focused": { color: "#6366f1" } }} />
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
              {PRESETS[kind].map((p) => (
                <ButtonBase key={p} onClick={() => setName(p)} sx={{
                  fontFamily: "inherit", fontSize: "0.78rem", px: 1.25, py: 0.5, borderRadius: 99,
                  border: `1.5px solid ${name === p ? "#6366f1" : "var(--border)"}`,
                  color: name === p ? "#6366f1" : "var(--tx-2)",
                  backgroundColor: name === p ? "var(--accent-tint)" : "transparent",
                  "&:hover": { borderColor: "#6366f1" },
                }}>{p}</ButtonBase>
              ))}
            </Box>
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        {kind && !initialKind && (
          <Button onClick={() => setKind(null)} sx={{ textTransform: "none", color: "var(--tx-3)", mr: "auto" }}>Back</Button>
        )}
        <Button onClick={onClose} sx={{ textTransform: "none", color: "var(--tx-3)" }}>Cancel</Button>
        {kind && <Button onClick={submit} disabled={!name.trim() || saving} sx={primaryBtnSx}>Add habit</Button>}
      </DialogActions>
    </Dialog>
  );
}

// ── Habit detail: all-time stats and every past week ──────────────────────────

function HabitDetailDialog({ habit, today, weekStartsOn, onClose, onOutcome, onRename, onArchive, onDelete }: {
  habit: HabitItem;
  today: string;
  weekStartsOn: WeekStart;
  onClose: () => void;
  onOutcome: (id: string, date: string, o: "W" | "L" | null) => void;
  onRename: (name: string) => Promise<boolean>;
  onArchive: (archived: boolean) => Promise<boolean>;
  onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState(habit.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const s = statsFor(habit, today, weekStartsOn);
  const weeks = weekRecords(habitLogs(habit), habit.createdDate, today, weekStartsOn);
  const saveName = () => { if (name.trim() && name.trim() !== habit.name) onRename(name.trim()); };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" slotProps={{ paper: { sx: { borderRadius: 3, backgroundColor: "var(--surface)" } } }}>
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pb: 1 }}>
        <Typography component="span" sx={groupLabelSx}>{KIND_COPY[habit.kind].group}{habit.archivedAt ? " · Archived" : ""}</Typography>
        <Box sx={{ flex: 1 }} />
        <IconButton aria-label="Close" onClick={onClose} size="small" sx={{ color: "var(--tx-4)" }}><CloseIcon fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 2.5 }}>
        <TextField variant="standard" value={name} placeholder="Name" slotProps={{ htmlInput: { maxLength: 200, "aria-label": "Habit name" } }}
          onChange={(e) => setName(e.target.value)} onBlur={saveName}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          sx={{ "& input": { fontSize: "1.25rem", fontWeight: 700, color: "var(--tx)" }, "& .MuiInput-underline:after": { borderColor: "#6366f1" } }} />

        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 1.25 }}>
          <DetailStat label="Day record" value={<><Box component="span" sx={{ color: WIN.fg }}>{s.wins}</Box>–<Box component="span" sx={{ color: LOSS.fg }}>{s.losses}</Box></>} />
          <DetailStat label="Win rate" value={s.days ? `${s.winRate}%` : "–"} />
          <DetailStat label="Current streak" value={s.currentStreak} />
          <DetailStat label="Best streak" value={s.bestStreak} />
          <DetailStat label="Week record" value={<><Box component="span" sx={{ color: WIN.fg }}>{s.weeksWon}</Box>–<Box component="span" sx={{ color: LOSS.fg }}>{s.weeksLost}</Box></>} />
          <DetailStat label="Weeks won" value={s.weeksWon + s.weeksLost ? `${s.weekWinRate}%` : "–"} />
          <DetailStat label="Days logged" value={s.days} />
        </Box>

        <Box>
          <Typography sx={{ ...groupLabelSx, mb: 1 }}>Weeks</Typography>
          <Box sx={{ display: "grid", gap: 0.5, maxHeight: 340, overflowY: "auto", pr: 0.5 }}>
            {weeks.map((w) => {
              const result = w.current ? "This week" : w.wins > w.losses ? "Won" : w.losses > w.wins ? "Lost" : w.wins + w.losses ? "Tied" : "Not played";
              const color = result === "Won" ? WIN.fg : result === "Lost" ? LOSS.fg : "var(--tx-4)";
              return (
                <Box key={w.start} sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto 44px 76px", alignItems: "center", gap: 1.5, py: 0.75, borderBottom: "1px solid var(--divider)" }}>
                  <Typography sx={{ fontSize: "0.82rem", color: "var(--tx-2)" }}>{shortDate(w.start)} – {shortDate(addDays(w.start, 6))}</Typography>
                  <WeekStrip outcomes={habit.outcomes} today={today} weekStartsOn={weekStartsOn} weekOf={w.start} size={20}
                    onCycle={(date) => onOutcome(habit.id, date, nextOutcome(habit.outcomes[date]))} />
                  <Typography sx={{ fontSize: "0.8rem", color: "var(--tx-3)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{w.wins}–{w.losses}</Typography>
                  <Typography sx={{ fontSize: "0.72rem", fontWeight: 700, color, textAlign: "right" }}>{result}</Typography>
                </Box>
              );
            })}
          </Box>
          <Typography sx={{ fontSize: "0.75rem", color: "var(--tx-4)", mt: 1 }}>
            Tap a day to change it: blank, W, L, then blank again.
          </Typography>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1, flexWrap: "wrap" }}>
        {confirmDelete ? (
          <>
            <Typography sx={{ fontSize: "0.82rem", color: "var(--tx-2)", mr: "auto" }}>
              Delete this habit and its whole record? Archiving keeps the record.
            </Typography>
            <Button onClick={() => setConfirmDelete(false)} sx={{ textTransform: "none", color: "var(--tx-3)" }}>Cancel</Button>
            <Button onClick={onDelete} sx={{ textTransform: "none", color: "#fff", backgroundColor: "#dc2626", "&:hover": { backgroundColor: "#b91c1c" } }}>Delete</Button>
          </>
        ) : (
          <>
            <Button onClick={() => setConfirmDelete(true)} sx={{ textTransform: "none", color: "#dc2626", mr: "auto" }}>Delete</Button>
            <Button onClick={() => onArchive(!habit.archivedAt)} sx={{ textTransform: "none", color: "var(--tx-2)", border: "1px solid var(--border)", borderRadius: 2, px: 2 }}>
              {habit.archivedAt ? "Restore" : "Archive"}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

function DetailStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box sx={{ backgroundColor: "var(--surface-2)", borderRadius: 2, px: 1.5, py: 1.25 }}>
      <Typography sx={{ fontSize: "1.15rem", fontWeight: 800, color: "var(--tx)", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{value}</Typography>
      <Typography sx={{ ...groupLabelSx, fontSize: "0.6rem", mt: 0.25 }}>{label}</Typography>
    </Box>
  );
}
