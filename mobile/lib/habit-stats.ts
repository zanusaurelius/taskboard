// Pure habit maths shared by the web app and the phone app (mobile/lib/habit-stats.ts is a copy;
// keep the two identical). Clients compute stats themselves because only they know the local
// date, and the phone has to show stats offline from its cache.
//
// Dates are local calendar dates as YYYY-MM-DD strings. Date.UTC is used below purely as a
// calendar calculator on those strings, never to convert a local time, so the result is the
// same in every timezone.

export type HabitKind = "GOOD" | "BAD";
export type WeekStart = 0 | 1; // 0 = Sunday, 1 = Monday

export interface HabitLogEntry {
  date: string; // YYYY-MM-DD
  isLoss: boolean;
}

export interface WeekRecord {
  start: string; // YYYY-MM-DD of the week's first day
  wins: number;
  losses: number;
  current: boolean;
}

export interface HabitStats {
  days: number;
  wins: number;
  losses: number;
  winRate: number;
  currentStreak: number;
  bestStreak: number;
  weeksWon: number;
  weeksLost: number;
  weekWinRate: number;
}

export interface OverallStats {
  days: number;
  wins: number;
  losses: number;
  winRate: number;
}

const DAY_MS = 86_400_000;

function toUtcMs(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtcMs(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Local calendar date of a Date object, e.g. new Date() for today. */
export function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(date: string, n: number): string {
  return fromUtcMs(toUtcMs(date) + n * DAY_MS);
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(date: string): number {
  return new Date(toUtcMs(date)).getUTCDay();
}

export function weekStartOf(date: string, weekStartsOn: WeekStart): string {
  const offset = (dayOfWeek(date) - weekStartsOn + 7) % 7;
  return addDays(date, -offset);
}

/** The seven dates of the week containing `date`. */
export function weekDates(date: string, weekStartsOn: WeekStart): string[] {
  const start = weekStartOf(date, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

// A streak is a run of logged wins. A loss resets it; an unlogged day neither adds to it nor
// breaks it. Future-dated logs are ignored.
export function winStreaks(logs: HabitLogEntry[], today: string): { current: number; best: number } {
  const past = logs.filter((l) => l.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  let run = 0;
  let best = 0;
  for (const l of past) {
    if (l.isLoss) {
      run = 0;
    } else {
      run++;
      best = Math.max(best, run);
    }
  }
  return { current: run, best };
}

// Every week from the habit's first day (creation or earliest backdated log) to today, newest
// first. Weeks with no logs are included so the history has no gaps.
export function weekRecords(
  logs: HabitLogEntry[],
  createdDate: string,
  today: string,
  weekStartsOn: WeekStart,
): WeekRecord[] {
  const past = logs.filter((l) => l.date <= today);
  let first = createdDate;
  for (const l of past) if (l.date < first) first = l.date;
  if (first > today) first = today;

  const currentStart = weekStartOf(today, weekStartsOn);
  const weeks = new Map<string, WeekRecord>();
  for (let s = weekStartOf(first, weekStartsOn); s <= currentStart; s = addDays(s, 7)) {
    weeks.set(s, { start: s, wins: 0, losses: 0, current: s === currentStart });
  }
  for (const l of past) {
    const week = weeks.get(weekStartOf(l.date, weekStartsOn));
    if (!week) continue;
    if (l.isLoss) week.losses++;
    else week.wins++;
  }
  return Array.from(weeks.values()).reverse();
}

function rate(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

export function habitStats(
  logs: HabitLogEntry[],
  createdDate: string,
  today: string,
  weekStartsOn: WeekStart,
): HabitStats {
  const past = logs.filter((l) => l.date <= today);
  const losses = past.filter((l) => l.isLoss).length;
  const wins = past.length - losses;
  const { current, best } = winStreaks(past, today);

  // A finished week is won if it has more wins than losses. The current week is still in play.
  const finished = weekRecords(past, createdDate, today, weekStartsOn).filter((w) => !w.current);
  const weeksWon = finished.filter((w) => w.wins > w.losses).length;
  const weeksLost = finished.filter((w) => w.losses > w.wins).length;

  return {
    days: past.length,
    wins,
    losses,
    winRate: rate(wins, past.length),
    currentStreak: current,
    bestStreak: best,
    weeksWon,
    weeksLost,
    weekWinRate: rate(weeksWon, weeksWon + weeksLost),
  };
}

export function overallStats(perHabit: HabitStats[]): OverallStats {
  const days = perHabit.reduce((n, s) => n + s.days, 0);
  const wins = perHabit.reduce((n, s) => n + s.wins, 0);
  return { days, wins, losses: days - wins, winRate: rate(wins, days) };
}

/** All-time, or one calendar year. */
export type StatsPeriod = { kind: "all" } | { kind: "year"; year: number };

/** Calendar years that have logs, plus the current one, newest first. */
export function yearsWithLogs(logs: HabitLogEntry[], today: string): number[] {
  const years = new Set<number>([Number(today.slice(0, 4))]);
  for (const l of logs) if (l.date <= today) years.add(Number(l.date.slice(0, 4)));
  return Array.from(years).sort((a, b) => b - a);
}

/**
 * Stats for a period. For a year, only that year's days count, and weeks are counted from
 * Jan 1. The current streak is always the live one, whichever period is shown.
 */
export function habitStatsFor(
  logs: HabitLogEntry[],
  createdDate: string,
  today: string,
  weekStartsOn: WeekStart,
  period: StatsPeriod,
): HabitStats {
  if (period.kind === "all") return habitStats(logs, createdDate, today, weekStartsOn);
  const from = `${period.year}-01-01`;
  const to = `${period.year}-12-31`;
  const end = today < to ? today : to;
  const inYear = logs.filter((l) => l.date >= from && l.date <= end);
  const stats = habitStats(inYear, createdDate > from ? createdDate : from, end, weekStartsOn);
  return { ...stats, currentStreak: winStreaks(logs, today).current };
}

export interface MonthRecord {
  month: string; // YYYY-MM
  wins: number;
  losses: number;
}

/** Every month from the habit's first day to today, newest first. */
export function monthRecords(logs: HabitLogEntry[], createdDate: string, today: string): MonthRecord[] {
  const past = logs.filter((l) => l.date <= today);
  let first = createdDate.slice(0, 7);
  for (const l of past) if (l.date.slice(0, 7) < first) first = l.date.slice(0, 7);
  const last = today.slice(0, 7);
  if (first > last) first = last;

  const months = new Map<string, MonthRecord>();
  let [y, m] = first.split("-").map(Number);
  for (;;) {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    months.set(key, { month: key, wins: 0, losses: 0 });
    if (key === last) break;
    m++;
    if (m > 12) { m = 1; y++; }
  }
  for (const l of past) {
    const rec = months.get(l.date.slice(0, 7));
    if (!rec) continue;
    if (l.isLoss) rec.losses++;
    else rec.wins++;
  }
  return Array.from(months.values()).reverse();
}

/** The dates of a month laid out in weeks for a calendar; null pads the first and last week. */
export function monthGrid(month: string, weekStartsOn: WeekStart): (string | null)[][] {
  const first = `${month}-01`;
  const days: string[] = [];
  for (let d = first; d.slice(0, 7) === month; d = addDays(d, 1)) days.push(d);
  const lead = (dayOfWeek(first) - weekStartsOn + 7) % 7;
  const cells: (string | null)[] = [...Array(lead).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (string | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}
