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
import Switch from "@mui/material/Switch";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import { useHabits, habitLogs, type HabitItem } from "@/lib/useHabits";
import { KIND_COPY, PRESETS } from "@/lib/habit-kind";
import {
  addDays, habitStatsFor, monthRecords, overallStats, weekRecords, yearsWithLogs,
  type HabitKind, type StatsPeriod, type WeekStart,
} from "@/lib/habit-stats";
import { WeekStrip, MonthCalendar, PeriodSwitch, nextOutcome, groupLabelSx, SortableHabitRows, WIN, LOSS } from "./HabitParts";
import PageHeader from "./PageHeader";
import { cardSx, pageBodySx, primaryButtonSx, secondaryButtonSx, textButtonSx, type } from "@/lib/ui";

const KINDS: HabitKind[] = ["GOOD", "BAD"];

const shortDate = (d: string) =>
  new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const monthName = (m: string) =>
  new Date(m + "-01T12:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });

export default function HabitsView() {
  const h = useHabits();
  const isNarrow = useMediaQuery("(max-width: 899px)");
  const [creating, setCreating] = useState<HabitKind | "pick" | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const thisYear = Number(h.today.slice(0, 4));
  // null follows the current year, so a tab left open over New Year moves on with it.
  const [chosenPeriod, setChosenPeriod] = useState<StatsPeriod | null>(null);
  const period: StatsPeriod = useMemo(() => chosenPeriod ?? { kind: "year", year: thisYear }, [chosenPeriod, thisYear]);
  const setPeriod = (p: StatsPeriod) => setChosenPeriod(p.kind === "year" && p.year === thisYear ? null : p);

  const active = h.habits.filter((x) => !x.archivedAt);
  const archived = h.habits.filter((x) => x.archivedAt);
  const years = useMemo(() => yearsWithLogs(active.flatMap(habitLogs), h.today), [active, h.today]);
  const overall = useMemo(
    () => overallStats(active.map((x) => habitStatsFor(habitLogs(x), x.createdDate, h.today, h.weekStartsOn, period))),
    [active, h.today, h.weekStartsOn, period],
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
    <Box sx={{ minHeight: "100%", backgroundColor: "var(--bg)", display: "flex", flexDirection: "column" }}>
      <PageHeader
        title="Habits"
        actions={
          <Button size="small" startIcon={<AddIcon />} onClick={() => setCreating("pick")} sx={primaryButtonSx}>
            <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>New habit</Box>
            <Box component="span" sx={{ display: { xs: "inline", sm: "none" } }}>Habit</Box>
          </Button>
        }
      />
      <Box sx={pageBodySx}>

        {active.length > 0 && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.25 }}>
            <PeriodSwitch years={years} value={period} onChange={setPeriod} />
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", sm: "repeat(4, minmax(0, 1fr))" }, gap: 1.5 }}>
              <Stat label="Wins" value={overall.wins} color={WIN.fg} />
              <Stat label="Losses" value={overall.losses} color={LOSS.fg} />
              <Stat label="Days logged" value={overall.days} />
              <Stat label="Win rate" value={overall.days ? `${overall.winRate}%` : "–"} />
            </Box>
          </Box>
        )}

        {h.hiddenCount > 0 && (
          <Typography sx={{ ...type.small, display: "flex", alignItems: "center", gap: 0.75 }}>
            <VisibilityOffOutlinedIcon sx={{ fontSize: 16 }} />
            {h.hiddenCount} private habit{h.hiddenCount === 1 ? " is" : "s are"} hidden. Turn off privacy to see {h.hiddenCount === 1 ? "it" : "them"}.
          </Typography>
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
                  const s = habitStatsFor(habitLogs(x), x.createdDate, h.today, h.weekStartsOn, { kind: "all" });
                  return (
                    <Box key={x.id} sx={{ display: "flex", alignItems: "center", gap: 2, px: 2.5, py: 1.25, borderBottom: "1px solid var(--divider)", "&:last-child": { borderBottom: 0 } }}>
                      <ButtonBase onClick={() => setDetailId(x.id)} sx={{ flex: 1, minWidth: 0, justifyContent: "flex-start", textAlign: "left", borderRadius: 1 }}>
                        <Typography sx={{ fontSize: "0.875rem", color: "var(--tx-3)", overflowWrap: "anywhere" }}>{x.name || "Locked habit"}</Typography>
                      </ButtonBase>
                      <Typography sx={{ fontSize: "0.8rem", color: "var(--tx-3)", fontVariantNumeric: "tabular-nums" }}>{s.wins}–{s.losses}</Typography>
                      <Button size="small" onClick={() => h.updateHabit(x.id, { archived: false })} sx={{ ...textButtonSx, color: "var(--accent)" }}>Restore</Button>
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
          onCreate={async (kind, name, isPrivate) => { if (await h.createHabit(kind, name, isPrivate)) setCreating(null); }}
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
          onPrivate={(isPrivate) => h.updateHabit(detail.id, { private: isPrivate })}
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
      <Typography sx={{ fontSize: "1.25rem", fontWeight: 700, color: color ?? "var(--tx)", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{value}</Typography>
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
        <Button size="small" startIcon={<AddIcon sx={{ fontSize: 16 }} />} onClick={onAdd} sx={textButtonSx}>
          Add {KIND_COPY[kind].title.toLowerCase()}
        </Button>
      </Box>
      <Box sx={{ ...cardSx, py: 0.75 }}>
        {items.length === 0 ? (
          <Typography sx={{ ...type.body, color: "var(--tx-3)", px: 2.5, py: 2 }}>
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
  onCreate: (kind: HabitKind, name: string, isPrivate: boolean) => Promise<void>;
}) {
  const [kind, setKind] = useState<HabitKind | null>(initialKind);
  const [name, setName] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!kind || !name.trim() || saving) return;
    setSaving(true);
    await onCreate(kind, name.trim(), isPrivate);
    setSaving(false);
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle sx={{ fontWeight: 700, color: "var(--tx)", pb: 1 }}>
        {kind ? `New ${KIND_COPY[kind].title.toLowerCase()}` : "New habit"}
      </DialogTitle>
      <DialogContent>
        {!kind ? (
          <Box sx={{ display: "grid", gap: 1.25, pt: 0.5 }}>
            {KINDS.map((k) => (
              <ButtonBase key={k} onClick={() => setKind(k)} sx={{
                display: "block", textAlign: "left", p: 2, borderRadius: 2, border: "1px solid var(--border)",
                backgroundColor: "var(--surface-2)",
                "&:hover": { borderColor: "var(--accent-line)", backgroundColor: "var(--accent-tint)" },
                "&.Mui-focusVisible": { borderColor: "var(--accent)" },
              }}>
                <Typography sx={{ fontWeight: 700, color: "var(--tx)", fontSize: "0.95rem" }}>{KIND_COPY[k].title}</Typography>
                <Typography sx={{ fontSize: "0.8rem", color: "var(--tx-2)", mt: 0.25 }}>{KIND_COPY[k].explainer}</Typography>
              </ButtonBase>
            ))}
          </Box>
        ) : (
          <Box sx={{ display: "grid", gap: 2, pt: 0.5 }}>
            <Typography sx={{ fontSize: "0.8rem", color: "var(--tx-2)" }}>{KIND_COPY[kind].explainer}</Typography>
            <TextField autoFocus size="small" label="Name" value={name} slotProps={{ htmlInput: { maxLength: 200 } }}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
              />
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
              {PRESETS[kind].map((p) => (
                <ButtonBase key={p} onClick={() => setName(p)} sx={{
                  fontFamily: "inherit", fontSize: "0.8rem", px: 1.25, py: 0.5, borderRadius: 99,
                  border: `1px solid ${name === p ? "var(--accent-line)" : "var(--border)"}`,
                  color: name === p ? "var(--accent-fg)" : "var(--tx-2)",
                  backgroundColor: name === p ? "var(--accent-tint)" : "transparent",
                  "&:hover": { borderColor: "var(--accent-line)" },
                }}>{p}</ButtonBase>
              ))}
            </Box>
            <FormControlLabel
              control={<Checkbox size="small" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />}
              label={<Typography sx={{ fontSize: "0.875rem", color: "var(--tx-2)" }}>Private: hide it while privacy is on</Typography>}
            />
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        {kind && !initialKind && (
          <Button onClick={() => setKind(null)} sx={{ ...secondaryButtonSx, mr: "auto" }}>Back</Button>
        )}
        <Button onClick={onClose} sx={secondaryButtonSx}>Cancel</Button>
        {kind && <Button onClick={submit} disabled={!name.trim() || saving} sx={primaryButtonSx}>Add habit</Button>}
      </DialogActions>
    </Dialog>
  );
}

// ── Habit detail: stats for a year or all time, and every past week or month ───

function HabitDetailDialog({ habit, today, weekStartsOn, onClose, onOutcome, onRename, onArchive, onPrivate, onDelete }: {
  habit: HabitItem;
  today: string;
  weekStartsOn: WeekStart;
  onClose: () => void;
  onOutcome: (id: string, date: string, o: "W" | "L" | null) => void;
  onRename: (name: string) => Promise<boolean>;
  onArchive: (archived: boolean) => Promise<boolean>;
  onPrivate: (isPrivate: boolean) => Promise<boolean>;
  onDelete: () => Promise<void>;
}) {
  const [name, setName] = useState(habit.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [view, setView] = useState<"weeks" | "months">("weeks");
  const logs = habitLogs(habit);
  const years = yearsWithLogs(logs, today);
  const thisYear = Number(today.slice(0, 4));
  const [chosenPeriod, setChosenPeriod] = useState<StatsPeriod | null>(null);
  const period: StatsPeriod = chosenPeriod ?? { kind: "year", year: thisYear };
  const setPeriod = (p: StatsPeriod) => setChosenPeriod(p.kind === "year" && p.year === thisYear ? null : p);

  const s = habitStatsFor(logs, habit.createdDate, today, weekStartsOn, period);
  const weeks = weekRecords(logs, habit.createdDate, today, weekStartsOn);
  const months = monthRecords(logs, habit.createdDate, today);
  const saveName = () => { if (name.trim() && name.trim() !== habit.name) onRename(name.trim()); };
  const cycle = (date: string) => onOutcome(habit.id, date, nextOutcome(habit.outcomes[date]));

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1, pb: 1 }}>
        <Typography component="span" sx={groupLabelSx}>{KIND_COPY[habit.kind].group}{habit.archivedAt ? " · Archived" : ""}</Typography>
        <Box sx={{ flex: 1 }} />
        <IconButton aria-label="Close" onClick={onClose} size="small" sx={{ color: "var(--tx-3)" }}><CloseIcon fontSize="small" /></IconButton>
      </DialogTitle>
      <DialogContent sx={{ display: "grid", gap: 2.5 }}>
        <TextField variant="standard" value={name} placeholder="Name" slotProps={{ htmlInput: { maxLength: 200, "aria-label": "Habit name" } }}
          onChange={(e) => setName(e.target.value)} onBlur={saveName}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          sx={{ "& input": { fontSize: "1.25rem", fontWeight: 700, color: "var(--tx)" }, "& .MuiInput-underline:before": { borderColor: "var(--border)" }, "& .MuiInput-underline:after": { borderColor: "var(--accent)" } }} />

        <Box sx={{ display: "grid", gap: 1.25 }}>
          <PeriodSwitch years={years} value={period} onChange={setPeriod} />
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 1.25 }}>
            <DetailStat label="Day record" value={<><Box component="span" sx={{ color: WIN.fg }}>{s.wins}</Box>–<Box component="span" sx={{ color: LOSS.fg }}>{s.losses}</Box></>} />
            <DetailStat label="Win rate" value={s.days ? `${s.winRate}%` : "–"} />
            <DetailStat label="Current streak" value={s.currentStreak} />
            <DetailStat label="Best streak" value={s.bestStreak} />
            <DetailStat label="Week record" value={<><Box component="span" sx={{ color: WIN.fg }}>{s.weeksWon}</Box>–<Box component="span" sx={{ color: LOSS.fg }}>{s.weeksLost}</Box></>} />
            <DetailStat label="Weeks won" value={s.weeksWon + s.weeksLost ? `${s.weekWinRate}%` : "–"} />
            <DetailStat label="Days logged" value={s.days} />
          </Box>
        </Box>

        <Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            <Box role="tablist" sx={{ display: "inline-flex", p: "3px", borderRadius: 2, backgroundColor: "var(--surface-2)", border: "1px solid var(--border)", gap: "2px" }}>
              {(["weeks", "months"] as const).map((v) => (
                <ButtonBase key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} sx={{
                  fontFamily: "inherit", fontSize: "0.8rem", fontWeight: 600, px: 1.25, py: 0.4, borderRadius: 1.5,
                  color: view === v ? "var(--tx)" : "var(--tx-3)",
                  backgroundColor: view === v ? "var(--surface)" : "transparent",
                  boxShadow: view === v ? "0 1px 2px rgba(0,0,0,0.12)" : "none",
                }}>{v === "weeks" ? "Weeks" : "Months"}</ButtonBase>
              ))}
            </Box>
            <Typography sx={{ fontSize: "0.8rem", color: "var(--tx-3)" }}>Tap a day to change it.</Typography>
          </Box>

          <Box sx={{ display: "grid", gap: view === "weeks" ? 0.5 : 2.5, maxHeight: 380, overflowY: "auto", pr: 0.5 }}>
            {view === "weeks" ? weeks.map((w) => {
              const result = w.current ? "This week" : w.wins > w.losses ? "Won" : w.losses > w.wins ? "Lost" : w.wins + w.losses ? "Tied" : "Not played";
              const color = result === "Won" ? WIN.fg : result === "Lost" ? LOSS.fg : "var(--tx-3)";
              return (
                <Box key={w.start} sx={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto 44px 76px", alignItems: "center", gap: 1.5, py: 0.75, borderBottom: "1px solid var(--divider)" }}>
                  <Typography sx={{ fontSize: "0.8rem", color: "var(--tx-2)" }}>{shortDate(w.start)} – {shortDate(addDays(w.start, 6))}</Typography>
                  <WeekStrip outcomes={habit.outcomes} today={today} weekStartsOn={weekStartsOn} weekOf={w.start} size={20} onCycle={cycle} />
                  <Typography sx={{ fontSize: "0.8rem", color: "var(--tx-2)", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{w.wins}–{w.losses}</Typography>
                  <Typography sx={{ fontSize: "0.7rem", fontWeight: 700, color, textAlign: "right" }}>{result}</Typography>
                </Box>
              );
            }) : months.map((m) => {
              const days = m.wins + m.losses;
              return (
                <Box key={m.month} sx={{ display: "flex", gap: 3, flexWrap: "wrap", alignItems: "flex-start" }}>
                  <Box sx={{ minWidth: 130 }}>
                    <Typography sx={{ fontSize: "0.875rem", fontWeight: 700, color: "var(--tx)" }}>{monthName(m.month)}</Typography>
                    <Typography sx={{ fontSize: "0.8rem", color: "var(--tx-2)", fontVariantNumeric: "tabular-nums", mt: 0.25 }}>
                      <Box component="span" sx={{ color: WIN.fg, fontWeight: 700 }}>{m.wins}</Box>–<Box component="span" sx={{ color: LOSS.fg, fontWeight: 700 }}>{m.losses}</Box>
                      {days > 0 && ` · ${Math.round((m.wins / days) * 100)}%`}
                    </Typography>
                  </Box>
                  <MonthCalendar month={m.month} outcomes={habit.outcomes} today={today} weekStartsOn={weekStartsOn} onCycle={cycle} />
                </Box>
              );
            })}
          </Box>
        </Box>

        <FormControlLabel
          sx={{ ml: 0, gap: 1 }}
          control={<Switch size="small" checked={habit.private} onChange={(e) => onPrivate(e.target.checked)} />}
          label={<Typography sx={{ fontSize: "0.875rem", color: "var(--tx-2)" }}>Private: hide it while privacy is on</Typography>}
        />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5, gap: 1, flexWrap: "wrap" }}>
        {confirmDelete ? (
          <>
            <Typography sx={{ fontSize: "0.8rem", color: "var(--tx-2)", mr: "auto" }}>
              Delete this habit and its whole record? Archiving keeps the record.
            </Typography>
            <Button onClick={() => setConfirmDelete(false)} sx={secondaryButtonSx}>Cancel</Button>
            <Button onClick={onDelete} sx={{ ...primaryButtonSx, backgroundColor: "var(--danger-fg)", "&:hover": { backgroundColor: "var(--danger-fg)", opacity: 0.9 } }}>Delete</Button>
          </>
        ) : (
          <>
            <Button onClick={() => setConfirmDelete(true)} sx={{ ...textButtonSx, color: "var(--danger-fg)", mr: "auto" }}>Delete</Button>
            <Button onClick={() => onArchive(!habit.archivedAt)} sx={secondaryButtonSx}>
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
    <Box sx={{ backgroundColor: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 2, px: 1.5, py: 1.25 }}>
      <Typography sx={{ fontSize: "1.15rem", fontWeight: 800, color: "var(--tx)", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>{value}</Typography>
      <Typography sx={{ ...groupLabelSx, fontSize: "0.6rem", mt: 0.25 }}>{label}</Typography>
    </Box>
  );
}
