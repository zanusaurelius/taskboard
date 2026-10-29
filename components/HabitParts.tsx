"use client";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import ButtonBase from "@mui/material/ButtonBase";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors, type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { KIND_COPY } from "@/lib/habit-kind";
import { dayOfWeek, monthGrid, weekDates, type HabitKind, type StatsPeriod, type WeekStart } from "@/lib/habit-stats";
import { statsFor, type HabitItem } from "@/lib/useHabits";
import { type } from "@/lib/ui";
import type { HabitOutcome } from "@/lib/types";

const DAY_LETTERS = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export const WIN = { fg: "var(--win-fg)", bg: "var(--win-bg)", line: "var(--win-line)" };
export const LOSS = { fg: "var(--loss-fg)", bg: "var(--loss-bg)", line: "var(--loss-line)" };

/** blank → W → L → blank */
export function nextOutcome(o: HabitOutcome | undefined | null): HabitOutcome | null {
  return o === "W" ? "L" : o === "L" ? null : "W";
}

interface WeekStripProps {
  outcomes: Record<string, HabitOutcome>;
  today: string;
  weekStartsOn: WeekStart;
  /** The week to show, as any date inside it. Defaults to this week. */
  weekOf?: string;
  showLabels?: boolean;
  size?: number;
  /** Rings today's cell. Off where today's W/L buttons sit beside the strip and already mark it. */
  markToday?: boolean;
  /** When set, past days and today can be tapped to cycle their result. */
  onCycle?: (date: string) => void;
}

export function WeekStrip({ outcomes, today, weekStartsOn, weekOf, showLabels, size = 22, markToday = true, onCycle }: WeekStripProps) {
  const dates = weekDates(weekOf ?? today, weekStartsOn);
  return (
    <Box sx={{ display: "flex", gap: "3px" }}>
      {dates.map((date) => {
        const o = outcomes[date];
        const future = date > today;
        const isToday = date === today;
        const dow = dayOfWeek(date);
        const label = `${DAY_NAMES[dow]} ${date}: ${o === "W" ? "win" : o === "L" ? "loss" : future ? "upcoming" : "not logged"}`;
        // Later days are a faint dot: there is nothing to read in them yet.
        const cell = future ? (
          <Box sx={{ width: size, height: size, display: "grid", placeItems: "center" }}>
            <Box sx={{ width: 4, height: 4, borderRadius: 99, backgroundColor: "var(--border-2)" }} />
          </Box>
        ) : (
          <Box sx={{
            width: size, height: size, borderRadius: "5px",
            display: "grid", placeItems: "center",
            fontSize: Math.round(size * 0.5) + "px", fontWeight: 800,
            backgroundColor: o === "W" ? WIN.bg : o === "L" ? LOSS.bg : "var(--surface-2)",
            boxShadow: o ? "none" : "inset 0 0 0 1px var(--border)",
            color: o === "W" ? WIN.fg : o === "L" ? LOSS.fg : "var(--tx-4)",
            outline: isToday && markToday ? "2px solid var(--accent)" : "none",
            outlineOffset: "1px",
          }}>
            {o ?? ""}
          </Box>
        );
        return (
          <Box key={date} sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "3px" }}>
            {showLabels && (
              <Typography component="span" sx={{ fontSize: "0.6rem", fontWeight: 700, color: isToday ? "var(--accent)" : "var(--tx-4)", lineHeight: 1 }}>
                {DAY_LETTERS[dow]}
              </Typography>
            )}
            {onCycle && !future ? (
              <ButtonBase aria-label={label} title={label} onClick={() => onCycle(date)}
                sx={{ borderRadius: "5px", "&:hover": { filter: "brightness(0.95)" }, "&.Mui-focusVisible": { outline: "2px solid var(--accent)", outlineOffset: "2px" } }}>
                {cell}
              </ButtonBase>
            ) : (
              <Box aria-label={label} role="img">{cell}</Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}

interface OutcomeButtonsProps {
  kind: HabitKind;
  value: HabitOutcome | undefined | null;
  /** Called with the new value; tapping the selected answer again clears it. */
  onChange: (o: HabitOutcome | null) => void;
  compact?: boolean;
}

export function OutcomeButtons({ kind, value, onChange, compact }: OutcomeButtonsProps) {
  const copy = KIND_COPY[kind];
  const btn = (o: HabitOutcome, text: string) => {
    const on = value === o;
    const c = o === "W" ? WIN : LOSS;
    return (
      <ButtonBase
        aria-pressed={on}
        aria-label={`${o}, ${text}`}
        onClick={() => onChange(on ? null : o)}
        sx={{
          fontFamily: "inherit", fontSize: compact ? "0.8rem" : "0.8rem", fontWeight: compact ? 800 : 600,
          px: compact ? 0 : 1.25, py: compact ? 0 : 0.6,
          width: compact ? 34 : "auto", height: compact ? 34 : "auto",
          borderRadius: 2, whiteSpace: "nowrap",
          border: `1.5px solid ${on ? c.line : "var(--border)"}`,
          backgroundColor: on ? c.bg : "var(--surface)",
          color: on ? c.fg : "var(--tx-3)",
          transition: "all 0.15s",
          "&:hover": { borderColor: on ? c.line : "var(--border-2)", color: on ? c.fg : "var(--tx-2)" },
          "&.Mui-focusVisible": { outline: "2px solid var(--accent)", outlineOffset: "2px" },
        }}
      >
        {compact ? o : `${o} · ${text}`}
      </ButtonBase>
    );
  };
  return (
    <Box sx={{ display: "flex", gap: 0.75 }}>
      {btn("W", copy.win)}
      {btn("L", copy.loss)}
    </Box>
  );
}

/** Current win streak. Nothing is shown for a streak of 0. */
export function StreakBadge({ streak }: { streak: number }) {
  if (streak <= 0) return null;
  const hot = streak >= 3;
  return (
    <Typography component="span" title={`Current win streak: ${streak}`} sx={{
      fontSize: "0.78rem", fontWeight: 700, fontVariantNumeric: "tabular-nums",
      color: hot ? "var(--streak)" : "var(--tx-3)", whiteSpace: "nowrap",
    }}>
      {hot ? "🔥 " : ""}{streak}
    </Typography>
  );
}

export const groupLabelSx = type.label;

// Shared by every row in every group so the week strips and buttons line up.
const ROW_COLUMNS = "18px minmax(0, 1fr) 182px 236px 52px";

interface SortableHabitRowsProps {
  items: HabitItem[];
  today: string;
  weekStartsOn: WeekStart;
  narrow: boolean;
  /** When true, past days in the week strip can be tapped to change them. */
  allowBackfill?: boolean;
  /** Puts day letters above the first row; the rows below line up with it. */
  labelFirst?: boolean;
  onOutcome: (id: string, date: string, o: HabitOutcome | null) => void;
  onOpen: (id: string) => void;
  onReorder: (ids: string[]) => void;
}

/** One group of habit rows (Building or Breaking), drag to reorder. */
export function SortableHabitRows({ items, today, weekStartsOn, narrow, allowBackfill = false, labelFirst = true, onOutcome, onOpen, onReorder }: SortableHabitRowsProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = items.map((x) => x.id);
    onReorder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((x) => x.id)} strategy={verticalListSortingStrategy}>
        {items.map((x, i) => (
          <HabitRow key={x.id} habit={x} first={labelFirst && i === 0} today={today} weekStartsOn={weekStartsOn}
            narrow={narrow} allowBackfill={allowBackfill} onOutcome={onOutcome} onOpen={() => onOpen(x.id)} />
        ))}
      </SortableContext>
    </DndContext>
  );
}

interface HabitRowProps {
  habit: HabitItem;
  first: boolean;
  today: string;
  weekStartsOn: WeekStart;
  narrow: boolean;
  allowBackfill: boolean;
  onOutcome: (id: string, date: string, o: "W" | "L" | null) => void;
  onOpen: () => void;
}

function HabitRow({ habit, first, today, weekStartsOn, narrow, allowBackfill, onOutcome, onOpen }: HabitRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: habit.id });
  const streak = statsFor(habit, today, weekStartsOn).currentStreak;
  const strip = (
    <WeekStrip outcomes={habit.outcomes} today={today} weekStartsOn={weekStartsOn} showLabels={first}
      size={narrow ? 18 : 22} markToday={false}
      onCycle={allowBackfill ? (date) => onOutcome(habit.id, date, nextOutcome(habit.outcomes[date])) : undefined} />
  );
  // On narrow screens the buttons are square W and L; the labels only fit on wide rows.
  const buttons = (
    <OutcomeButtons kind={habit.kind} value={habit.outcomes[today]} compact={narrow}
      onChange={(o) => onOutcome(habit.id, today, o)} />
  );
  const handle = (
    <Box {...attributes} {...listeners} aria-label="Drag to reorder" className="habit-drag"
      sx={{ cursor: "grab", color: "var(--tx-4)", display: "flex", opacity: { xs: 1, md: 0 }, transition: "opacity 0.15s", "&:focus-visible": { opacity: 1, outline: "2px solid var(--accent)", borderRadius: 1 } }}>
      <DragIndicatorIcon sx={{ fontSize: 16 }} />
    </Box>
  );
  const name = (
    <ButtonBase onClick={onOpen} sx={{ justifyContent: "flex-start", textAlign: "left", borderRadius: 1, minWidth: 0, "&:hover .habit-name": { color: "var(--accent)" } }}>
      <Typography className="habit-name" sx={{ fontSize: "0.9rem", fontWeight: 500, color: "var(--tx-2)", overflowWrap: "anywhere", transition: "color 0.15s" }}>
        {habit.name || "Locked habit"}
      </Typography>
    </ButtonBase>
  );

  return (
    <Box ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      sx={{
        px: narrow ? 0.5 : 1.5, py: 1, mx: narrow ? 0 : 0.75, borderRadius: 2,
        "&:hover": { backgroundColor: "var(--surface-2)" },
        "&:hover .habit-drag": { opacity: 1 },
        ...(narrow
          ? { display: "flex", alignItems: "center", gap: 1.5 }
          : { display: "grid", gridTemplateColumns: ROW_COLUMNS, alignItems: "end", gap: 2 }),
      }}>
      {narrow ? (
        // Reordering is done on the wide layout; a drag handle here only adds clutter.
        <>
          <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 0.75 }}>
            <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, minWidth: 0 }}>{name}<StreakBadge streak={streak} /></Box>
            {strip}
          </Box>
          {buttons}
        </>
      ) : (
        <>
          <Box sx={{ alignSelf: "center" }}>{handle}</Box>
          <Box sx={{ alignSelf: "center", minWidth: 0 }}>{name}</Box>
          {strip}
          <Box sx={{ alignSelf: "center" }}>{buttons}</Box>
          <Box sx={{ alignSelf: "center", textAlign: "right" }}><StreakBadge streak={streak} /></Box>
        </>
      )}
    </Box>
  );
}


interface MonthCalendarProps {
  month: string; // YYYY-MM
  outcomes: Record<string, HabitOutcome>;
  today: string;
  weekStartsOn: WeekStart;
  onCycle?: (date: string) => void;
}

/** One month as a calendar of W/L days. Past days and today can be tapped to cycle them. */
export function MonthCalendar({ month, outcomes, today, weekStartsOn, onCycle }: MonthCalendarProps) {
  const weeks = monthGrid(month, weekStartsOn);
  const letters = Array.from({ length: 7 }, (_, i) => DAY_LETTERS[(i + weekStartsOn) % 7]);
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(7, 26px)", gap: "4px" }}>
      {letters.map((l, i) => (
        <Typography key={i} component="span" sx={{ fontSize: "0.58rem", fontWeight: 700, color: "var(--tx-3)", textAlign: "center" }}>{l}</Typography>
      ))}
      {weeks.flat().map((date, i) => {
        if (!date) return <Box key={`pad-${i}`} />;
        const o = outcomes[date];
        const future = date > today;
        const cell = (
          <Box sx={{
            width: 26, height: 26, borderRadius: "6px", display: "grid", placeItems: "center",
            fontSize: "0.62rem", fontWeight: o ? 800 : 500,
            backgroundColor: o === "W" ? WIN.bg : o === "L" ? LOSS.bg : future ? "transparent" : "var(--surface-2)",
            color: o === "W" ? WIN.fg : o === "L" ? LOSS.fg : "var(--tx-3)",
            outline: date === today ? "2px solid var(--accent)" : "none", outlineOffset: "1px",
            opacity: future ? 0.45 : 1,
          }}>
            {o ?? Number(date.slice(8))}
          </Box>
        );
        const label = `${date}: ${o === "W" ? "win" : o === "L" ? "loss" : "not logged"}`;
        return onCycle && !future ? (
          <ButtonBase key={date} aria-label={label} title={label} onClick={() => onCycle(date)}
            sx={{ borderRadius: "6px", "&.Mui-focusVisible": { outline: "2px solid var(--accent)", outlineOffset: "2px" } }}>
            {cell}
          </ButtonBase>
        ) : (
          <Box key={date} role="img" aria-label={label}>{cell}</Box>
        );
      })}
    </Box>
  );
}

/** "2026" / "All time" switch for stats. */
export function PeriodSwitch({ years, value, onChange }: { years: number[]; value: StatsPeriod; onChange: (p: StatsPeriod) => void }) {
  const options: { key: string; label: string; period: StatsPeriod }[] = [
    ...years.map((y) => ({ key: String(y), label: String(y), period: { kind: "year", year: y } as StatsPeriod })),
    { key: "all", label: "All time", period: { kind: "all" } },
  ];
  const current = value.kind === "all" ? "all" : String(value.year);
  return (
    <Box role="group" aria-label="Stats period" sx={{ display: "inline-flex", p: "3px", borderRadius: 2, backgroundColor: "var(--surface-2)", border: "1px solid var(--border)", gap: "2px" }}>
      {options.map((o) => {
        const on = o.key === current;
        return (
          <ButtonBase key={o.key} aria-pressed={on} onClick={() => onChange(o.period)} sx={{
            fontFamily: "inherit", fontSize: "0.78rem", fontWeight: 600, px: 1.25, py: 0.4, borderRadius: 1.5,
            color: on ? "var(--tx)" : "var(--tx-3)",
            backgroundColor: on ? "var(--surface)" : "transparent",
            boxShadow: on ? "0 1px 2px rgba(0,0,0,0.12)" : "none",
            "&.Mui-focusVisible": { outline: "2px solid var(--accent)" },
          }}>{o.label}</ButtonBase>
        );
      })}
    </Box>
  );
}
