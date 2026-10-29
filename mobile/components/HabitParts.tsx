import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { KIND_COPY } from '@/lib/habit-kind';
import { dayOfWeek, monthGrid, weekDates, type HabitKind, type StatsPeriod, type WeekStart } from '@/lib/habit-stats';
import type { HabitOutcome } from '@/lib/habits';
import type { ThemeColors } from '@/lib/theme-context';

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function winLossColors(c: ThemeColors) {
  const dark = c.statusBar === 'light';
  return {
    winFg: dark ? '#4ade80' : '#16a34a',
    winBg: dark ? 'rgba(34,197,94,0.16)' : '#dcfce7',
    winLine: dark ? 'rgba(74,222,128,0.45)' : '#86efac',
    lossFg: dark ? '#f87171' : '#dc2626',
    lossBg: dark ? 'rgba(239,68,68,0.16)' : '#fee2e2',
    lossLine: dark ? 'rgba(248,113,113,0.45)' : '#fca5a5',
  };
}

interface WeekStripProps {
  colors: ThemeColors;
  outcomes: Record<string, HabitOutcome>;
  today: string;
  weekStartsOn: WeekStart;
  /** The week to show, as any date inside it. Defaults to this week. */
  weekOf?: string;
  showLabels?: boolean;
  size?: number;
  /** When set, past days and today can be tapped to cycle their result. */
  onCycle?: (date: string) => void;
}

export function WeekStrip({ colors, outcomes, today, weekStartsOn, weekOf, showLabels, size = 20, onCycle }: WeekStripProps) {
  const wl = winLossColors(colors);
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {weekDates(weekOf ?? today, weekStartsOn).map((date) => {
        const o = outcomes[date];
        const future = date > today;
        const isToday = date === today;
        const dow = dayOfWeek(date);
        const cell = (
          <View style={{
            width: size, height: size, borderRadius: 5,
            alignItems: 'center', justifyContent: 'center',
            backgroundColor: o === 'W' ? wl.winBg : o === 'L' ? wl.lossBg : future ? 'transparent' : colors.border,
            borderWidth: isToday ? 2 : future ? 1 : 0,
            borderStyle: future && !isToday ? 'dashed' : 'solid',
            borderColor: isToday ? '#6366f1' : colors.border,
          }}>
            {o && <Text style={{ fontSize: size * 0.5, fontWeight: '800', color: o === 'W' ? wl.winFg : wl.lossFg }}>{o}</Text>}
          </View>
        );
        const label = `${DAY_NAMES[dow]}: ${o === 'W' ? 'win' : o === 'L' ? 'loss' : future ? 'upcoming' : 'not logged'}`;
        return (
          <View key={date} style={{ alignItems: 'center', gap: 3 }}>
            {showLabels && (
              <Text style={{ fontSize: 9, fontWeight: '700', color: isToday ? '#6366f1' : colors.tx4 }}>{DAY_LETTERS[dow]}</Text>
            )}
            {onCycle && !future ? (
              <TouchableOpacity onPress={() => onCycle(date)} accessibilityLabel={label} accessibilityRole="button"
                hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}>
                {cell}
              </TouchableOpacity>
            ) : (
              <View accessible accessibilityLabel={label}>{cell}</View>
            )}
          </View>
        );
      })}
    </View>
  );
}

interface OutcomeButtonsProps {
  colors: ThemeColors;
  kind: HabitKind;
  value: HabitOutcome | undefined | null;
  /** Called with the new value; tapping the selected answer again clears it. */
  onChange: (o: HabitOutcome | null) => void;
  /** Square W and L buttons instead of labelled ones. */
  compact?: boolean;
}

export function OutcomeButtons({ colors, kind, value, onChange, compact }: OutcomeButtonsProps) {
  const wl = winLossColors(colors);
  const copy = KIND_COPY[kind];
  const btn = (o: HabitOutcome, text: string) => {
    const on = value === o;
    const fg = o === 'W' ? wl.winFg : wl.lossFg;
    return (
      <TouchableOpacity
        key={o}
        onPress={() => onChange(on ? null : o)}
        accessibilityRole="button"
        accessibilityState={{ selected: on }}
        accessibilityLabel={`${o}, ${text}`}
        activeOpacity={0.7}
        style={[
          styles.btn,
          compact ? styles.btnCompact : styles.btnWide,
          {
            borderColor: on ? (o === 'W' ? wl.winLine : wl.lossLine) : colors.border,
            backgroundColor: on ? (o === 'W' ? wl.winBg : wl.lossBg) : colors.surface,
          },
        ]}
      >
        <Text style={{ fontSize: compact ? 15 : 13, fontWeight: compact ? '800' : '600', color: on ? fg : colors.tx3 }}>
          {compact ? o : `${o} · ${text}`}
        </Text>
      </TouchableOpacity>
    );
  };
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {btn('W', copy.win)}
      {btn('L', copy.loss)}
    </View>
  );
}

export function StreakText({ streak, colors }: { streak: number; colors: ThemeColors }) {
  const hot = streak >= 3;
  return (
    <Text style={{ fontSize: 12, fontWeight: '700', color: hot ? '#ea580c' : colors.tx4 }} accessibilityLabel={`Current win streak ${streak}`}>
      {hot ? '🔥 ' : ''}{streak}
    </Text>
  );
}

interface MonthCalendarProps {
  colors: ThemeColors;
  month: string; // YYYY-MM
  outcomes: Record<string, HabitOutcome>;
  today: string;
  weekStartsOn: WeekStart;
  onCycle?: (date: string) => void;
}

/** One month as a calendar of W/L days. Past days and today can be tapped to cycle them. */
export function MonthCalendar({ colors, month, outcomes, today, weekStartsOn, onCycle }: MonthCalendarProps) {
  const wl = winLossColors(colors);
  const letters = Array.from({ length: 7 }, (_, i) => DAY_LETTERS[(i + weekStartsOn) % 7]);
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {letters.map((l, i) => (
          <Text key={i} style={{ width: 36, textAlign: 'center', fontSize: 9, fontWeight: '700', color: colors.tx3 }}>{l}</Text>
        ))}
      </View>
      {monthGrid(month, weekStartsOn).map((week, wi) => (
        <View key={wi} style={{ flexDirection: 'row', gap: 4 }}>
          {week.map((date, di) => {
            if (!date) return <View key={di} style={{ width: 36, height: 36 }} />;
            const o = outcomes[date];
            const future = date > today;
            const cell = (
              <View style={{
                width: 36, height: 36, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
                backgroundColor: o === 'W' ? wl.winBg : o === 'L' ? wl.lossBg : future ? 'transparent' : colors.surface2,
                borderWidth: date === today ? 2 : 0, borderColor: '#6366f1', opacity: future ? 0.45 : 1,
              }}>
                <Text style={{ fontSize: o ? 13 : 11, fontWeight: o ? '800' : '500', color: o === 'W' ? wl.winFg : o === 'L' ? wl.lossFg : colors.tx3 }}>
                  {o ?? Number(date.slice(8))}
                </Text>
              </View>
            );
            return onCycle && !future ? (
              <TouchableOpacity key={date} onPress={() => onCycle(date)} accessibilityRole="button"
                accessibilityLabel={`${date}: ${o === 'W' ? 'win' : o === 'L' ? 'loss' : 'not logged'}`}>
                {cell}
              </TouchableOpacity>
            ) : <View key={date}>{cell}</View>;
          })}
        </View>
      ))}
    </View>
  );
}

/** Segmented control, e.g. "2026" / "All time" or "Weeks" / "Months". */
export function Segmented<T extends string>({ colors, options, value, onChange }: {
  colors: ThemeColors;
  options: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', alignSelf: 'flex-start', padding: 3, gap: 2, borderRadius: 10, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <TouchableOpacity key={o.key} onPress={() => onChange(o.key)} accessibilityRole="button" accessibilityState={{ selected: on }}
            style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8, backgroundColor: on ? colors.surface : 'transparent' }}>
            <Text style={{ fontSize: 13, fontWeight: '600', color: on ? colors.tx : colors.tx3 }}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/** Period options for the Segmented control: each year with logs, then all time. */
export function periodOptions(years: number[]): { key: string; label: string }[] {
  return [...years.map((y) => ({ key: String(y), label: String(y) })), { key: 'all', label: 'All time' }];
}

export function periodFromKey(key: string): StatsPeriod {
  return key === 'all' ? { kind: 'all' } : { kind: 'year', year: Number(key) };
}

const styles = StyleSheet.create({
  btn: { borderWidth: 1.5, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  btnCompact: { width: 42, height: 42 },
  btnWide: { flex: 1, paddingVertical: 9, paddingHorizontal: 8 },
});
