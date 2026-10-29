import { useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, ScrollView, RefreshControl, Modal, Pressable,
  StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DraggableFlatList, { ScaleDecorator, type RenderItemParams } from 'react-native-draggable-flatlist';
import { useHabits, statsFor, habitLogs, nextOutcome, type HabitItem } from '@/lib/habits';
import { KIND_COPY, PRESETS } from '@/lib/habit-kind';
import { addDays, overallStats, weekRecords, type HabitKind, type WeekStart } from '@/lib/habit-stats';
import { WeekStrip, OutcomeButtons, StreakText, winLossColors } from '@/components/HabitParts';
import { useThemeColors, type ThemeColors } from '@/lib/theme-context';

const KINDS: HabitKind[] = ['GOOD', 'BAD'];

const shortDate = (d: string) =>
  new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const displayName = (h: HabitItem) => (h.locked ? '🔒 Locked habit' : h.name || 'Untitled habit');

export default function HabitsScreen() {
  const colors = useThemeColors();
  const s = makeStyles(colors);
  const wl = winLossColors(colors);
  const h = useHabits();
  const [creating, setCreating] = useState<HabitKind | 'pick' | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [reordering, setReordering] = useState<HabitKind | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const active = h.habits.filter((x) => !x.archivedAt);
  const archived = h.habits.filter((x) => x.archivedAt);
  const overall = useMemo(
    () => overallStats(active.map((x) => statsFor(x, h.today, h.weekStartsOn))),
    [active, h.today, h.weekStartsOn],
  );
  const detail = h.habits.find((x) => x.id === detailId) ?? null;

  const report = (err: string | null) => { if (err) Alert.alert('Not saved', err); return !err; };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <Text style={s.title}>Habits</Text>
        <TouchableOpacity style={s.newBtn} onPress={() => setCreating('pick')} accessibilityRole="button">
          <Text style={s.newBtnText}>+ New</Text>
        </TouchableOpacity>
      </View>

      {h.offline && (
        <View style={s.offlineBanner}>
          <Text style={s.offlineText}>⚠ Can't reach server. Your W and L taps are saved on this phone and sync when you reconnect.</Text>
        </View>
      )}

      {h.loading ? (
        <ActivityIndicator color="#6366f1" style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={s.content}
          refreshControl={<RefreshControl refreshing={h.refreshing} onRefresh={h.refresh} tintColor="#6366f1" />}
        >
          {active.length > 0 && (
            <View style={s.statsRow}>
              <Stat s={s} label="Wins" value={overall.wins} color={wl.winFg} />
              <Stat s={s} label="Losses" value={overall.losses} color={wl.lossFg} />
              <Stat s={s} label="Days" value={overall.days} />
              <Stat s={s} label="Win rate" value={overall.days ? `${overall.winRate}%` : '–'} />
            </View>
          )}

          {KINDS.map((kind) => {
            const items = active.filter((x) => x.kind === kind);
            return (
              <View key={kind} style={{ gap: 8 }}>
                <View style={s.groupHeader}>
                  <Text style={s.groupLabel}>{KIND_COPY[kind].group.toUpperCase()}</Text>
                  <View style={{ flexDirection: 'row', gap: 16 }}>
                    {items.length > 1 && (
                      <TouchableOpacity onPress={() => setReordering(kind)} hitSlop={8}>
                        <Text style={s.groupAction}>Reorder</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity onPress={() => setCreating(kind)} hitSlop={8}>
                      <Text style={s.groupAction}>+ Add</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                {items.length === 0 ? (
                  <View style={s.card}>
                    <Text style={s.emptyText}>
                      {kind === 'GOOD' ? 'Add something you want to do every day.' : 'Add something you want to stop doing.'}
                    </Text>
                  </View>
                ) : items.map((x) => (
                  <View key={x.id} style={s.card}>
                    <TouchableOpacity style={s.cardTop} onPress={() => setDetailId(x.id)} accessibilityRole="button">
                      <Text style={s.habitName} numberOfLines={2}>{displayName(x)}</Text>
                      <StreakText colors={colors} streak={statsFor(x, h.today, h.weekStartsOn).currentStreak} />
                    </TouchableOpacity>
                    <WeekStrip colors={colors} outcomes={x.outcomes} today={h.today} weekStartsOn={h.weekStartsOn} showLabels size={30}
                      onCycle={(date) => h.setOutcome(x.id, date, nextOutcome(x.outcomes[date]))} />
                    <OutcomeButtons colors={colors} kind={x.kind} value={x.outcomes[h.today]}
                      onChange={(o) => h.setOutcome(x.id, h.today, o)} />
                  </View>
                ))}
              </View>
            );
          })}

          {archived.length > 0 && (
            <View style={{ gap: 8 }}>
              <TouchableOpacity onPress={() => setShowArchived((v) => !v)} hitSlop={8}>
                <Text style={s.groupLabel}>ARCHIVED ({archived.length}) {showArchived ? '▴' : '▾'}</Text>
              </TouchableOpacity>
              {showArchived && (
                <View style={s.card}>
                  {archived.map((x) => {
                    const st = statsFor(x, h.today, h.weekStartsOn);
                    return (
                      <View key={x.id} style={s.archivedRow}>
                        <TouchableOpacity style={{ flex: 1 }} onPress={() => setDetailId(x.id)}>
                          <Text style={s.archivedName} numberOfLines={1}>{displayName(x)}</Text>
                        </TouchableOpacity>
                        <Text style={s.archivedRecord}>{st.wins}–{st.losses}</Text>
                        <TouchableOpacity onPress={async () => report(await h.updateHabit(x.id, { archived: false }))} hitSlop={8}>
                          <Text style={s.groupAction}>Restore</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>
          )}
        </ScrollView>
      )}

      {creating !== null && (
        <NewHabitModal
          colors={colors}
          initialKind={creating === 'pick' ? null : creating}
          onClose={() => setCreating(null)}
          onCreate={async (kind, name) => { if (report(await h.createHabit(kind, name))) setCreating(null); }}
        />
      )}

      {detail && (
        <HabitDetailModal
          key={detail.id}
          colors={colors}
          habit={detail}
          today={h.today}
          weekStartsOn={h.weekStartsOn}
          onClose={() => setDetailId(null)}
          onCycle={(date) => h.setOutcome(detail.id, date, nextOutcome(detail.outcomes[date]))}
          onRename={async (name) => { report(await h.updateHabit(detail.id, { name })); }}
          onArchive={async () => { if (report(await h.updateHabit(detail.id, { archived: !detail.archivedAt }))) setDetailId(null); }}
          onDelete={() => Alert.alert('Delete habit', 'This deletes the habit and its whole record. Archiving keeps the record.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: async () => { if (report(await h.deleteHabit(detail.id))) setDetailId(null); } },
          ])}
        />
      )}

      {reordering && (
        <ReorderModal
          colors={colors}
          items={active.filter((x) => x.kind === reordering)}
          title={`Reorder ${KIND_COPY[reordering].group.toLowerCase()}`}
          onClose={() => setReordering(null)}
          onSave={(ids) => { h.reorder(reordering, ids).then(report); }}
        />
      )}
    </SafeAreaView>
  );
}

function Stat({ s, label, value, color }: { s: ReturnType<typeof makeStyles>; label: string; value: number | string; color?: string }) {
  return (
    <View style={s.stat}>
      <Text style={[s.statValue, color ? { color } : null]}>{value}</Text>
      <Text style={s.statLabel}>{label.toUpperCase()}</Text>
    </View>
  );
}

// ── New habit: kind first, then the name ───────────────────────────────────────

function NewHabitModal({ colors, initialKind, onClose, onCreate }: {
  colors: ThemeColors;
  initialKind: HabitKind | null;
  onClose: () => void;
  onCreate: (kind: HabitKind, name: string) => Promise<void>;
}) {
  const s = makeStyles(colors);
  const [kind, setKind] = useState<HabitKind | null>(initialKind);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!kind || !name.trim() || saving) return;
    setSaving(true);
    await onCreate(kind, name.trim());
    setSaving(false);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={s.overlay} onPress={onClose}>
          <Pressable style={s.sheet} onPress={() => {}}>
            <View style={s.sheetHeader}>
              <Text style={s.sheetTitle}>{kind ? `New ${KIND_COPY[kind].title.toLowerCase()}` : 'New habit'}</Text>
              <TouchableOpacity onPress={onClose} hitSlop={8}><Text style={s.closeText}>✕</Text></TouchableOpacity>
            </View>
            {!kind ? (
              <View style={{ gap: 10 }}>
                {KINDS.map((k) => (
                  <TouchableOpacity key={k} style={s.kindCard} onPress={() => setKind(k)} accessibilityRole="button">
                    <Text style={s.kindTitle}>{KIND_COPY[k].title} <Text style={s.kindTag}>{KIND_COPY[k].group.toUpperCase()}</Text></Text>
                    <Text style={s.kindExplainer}>{KIND_COPY[k].explainer}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <View style={{ gap: 14 }}>
                <Text style={s.kindExplainer}>{KIND_COPY[kind].explainer}</Text>
                <TextInput
                  style={s.input}
                  placeholder="Name"
                  placeholderTextColor={colors.placeholder}
                  value={name}
                  onChangeText={setName}
                  maxLength={200}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={submit}
                />
                <View style={s.presets}>
                  {PRESETS[kind].map((p) => (
                    <TouchableOpacity key={p} onPress={() => setName(p)}
                      style={[s.preset, name === p && { borderColor: '#6366f1', backgroundColor: 'rgba(99,102,241,0.12)' }]}>
                      <Text style={[s.presetText, name === p && { color: '#6366f1' }]}>{p}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {!initialKind && (
                    <TouchableOpacity style={s.secondaryBtn} onPress={() => setKind(null)}>
                      <Text style={s.secondaryBtnText}>Back</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity style={[s.primaryBtn, (!name.trim() || saving) && { opacity: 0.5 }]} onPress={submit} disabled={!name.trim() || saving}>
                    <Text style={s.primaryBtnText}>{saving ? 'Adding…' : 'Add habit'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ── Habit detail: all-time stats and every past week ──────────────────────────

function HabitDetailModal({ colors, habit, today, weekStartsOn, onClose, onCycle, onRename, onArchive, onDelete }: {
  colors: ThemeColors;
  habit: HabitItem;
  today: string;
  weekStartsOn: WeekStart;
  onClose: () => void;
  onCycle: (date: string) => void;
  onRename: (name: string) => Promise<void>;
  onArchive: () => Promise<void>;
  onDelete: () => void;
}) {
  const s = makeStyles(colors);
  const wl = winLossColors(colors);
  const [name, setName] = useState(habit.name);
  const st = statsFor(habit, today, weekStartsOn);
  const weeks = weekRecords(habitLogs(habit), habit.createdDate, today, weekStartsOn);
  const saveName = () => { if (!habit.locked && name.trim() && name.trim() !== habit.name) onRename(name.trim()); };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={s.safe}>
        <View style={[s.sheetHeader, { paddingHorizontal: 16, paddingTop: 12 }]}>
          <Text style={s.groupLabel}>{KIND_COPY[habit.kind].group.toUpperCase()}{habit.archivedAt ? ' · ARCHIVED' : ''}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={8}><Text style={s.closeText}>Done</Text></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={[s.content, { paddingTop: 0 }]}>
          {habit.locked ? (
            <Text style={s.detailName}>🔒 Locked habit</Text>
          ) : (
            <TextInput style={s.detailName} value={name} onChangeText={setName} onEndEditing={saveName}
              maxLength={200} placeholder="Name" placeholderTextColor={colors.placeholder} accessibilityLabel="Habit name" />
          )}

          <View style={s.detailStats}>
            <DetailStat s={s} label="Day record" value={<><Text style={{ color: wl.winFg }}>{st.wins}</Text>–<Text style={{ color: wl.lossFg }}>{st.losses}</Text></>} />
            <DetailStat s={s} label="Win rate" value={st.days ? `${st.winRate}%` : '–'} />
            <DetailStat s={s} label="Current streak" value={st.currentStreak} />
            <DetailStat s={s} label="Best streak" value={st.bestStreak} />
            <DetailStat s={s} label="Week record" value={<><Text style={{ color: wl.winFg }}>{st.weeksWon}</Text>–<Text style={{ color: wl.lossFg }}>{st.weeksLost}</Text></>} />
            <DetailStat s={s} label="Weeks won" value={st.weeksWon + st.weeksLost ? `${st.weekWinRate}%` : '–'} />
            <DetailStat s={s} label="Days logged" value={st.days} />
          </View>

          <View style={{ gap: 4 }}>
            <Text style={s.groupLabel}>WEEKS</Text>
            <Text style={s.hint}>Tap a day to change it: blank, W, L, then blank again.</Text>
            {weeks.map((w) => {
              const result = w.current ? 'This week' : w.wins > w.losses ? 'Won' : w.losses > w.wins ? 'Lost' : w.wins + w.losses ? 'Tied' : 'Not played';
              const color = result === 'Won' ? wl.winFg : result === 'Lost' ? wl.lossFg : colors.tx4;
              return (
                <View key={w.start} style={s.weekRow}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={s.weekDates}>{shortDate(w.start)} – {shortDate(addDays(w.start, 6))}</Text>
                    <Text style={[s.weekResult, { color }]}>{w.wins}–{w.losses} · {result}</Text>
                  </View>
                  <WeekStrip colors={colors} outcomes={habit.outcomes} today={today} weekStartsOn={weekStartsOn}
                    weekOf={w.start} size={30} showLabels={w.current} onCycle={onCycle} />
                </View>
              );
            })}
          </View>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
            <TouchableOpacity style={s.secondaryBtn} onPress={onArchive}>
              <Text style={s.secondaryBtnText}>{habit.archivedAt ? 'Restore' : 'Archive'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.secondaryBtn, { borderColor: wl.lossLine }]} onPress={onDelete}>
              <Text style={[s.secondaryBtnText, { color: wl.lossFg }]}>Delete</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function DetailStat({ s, label, value }: { s: ReturnType<typeof makeStyles>; label: string; value: React.ReactNode }) {
  return (
    <View style={s.detailStat}>
      <Text style={s.detailStatValue}>{value}</Text>
      <Text style={s.statLabel}>{label.toUpperCase()}</Text>
    </View>
  );
}

function ReorderModal({ colors, items, title, onClose, onSave }: {
  colors: ThemeColors;
  items: HabitItem[];
  title: string;
  onClose: () => void;
  onSave: (ids: string[]) => void;
}) {
  const s = makeStyles(colors);
  const [order, setOrder] = useState(items);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.overlay} onPress={onClose}>
        <Pressable style={[s.sheet, { maxHeight: '75%' }]} onPress={() => {}}>
          <View style={s.sheetHeader}>
            <Text style={s.sheetTitle}>{title}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={8}><Text style={s.closeText}>Done</Text></TouchableOpacity>
          </View>
          <Text style={[s.hint, { marginBottom: 8 }]}>Hold and drag to reorder.</Text>
          <DraggableFlatList
            data={order}
            keyExtractor={(x) => x.id}
            onDragEnd={({ data }) => { setOrder(data); onSave(data.map((x) => x.id)); }}
            renderItem={({ item, drag, isActive }: RenderItemParams<HabitItem>) => (
              <ScaleDecorator>
                <TouchableOpacity onLongPress={drag} delayLongPress={150} style={[s.reorderRow, isActive && { opacity: 0.8 }]}>
                  <Text style={s.reorderHandle}>⠿</Text>
                  <Text style={s.habitName} numberOfLines={1}>{displayName(item)}</Text>
                </TouchableOpacity>
              </ScaleDecorator>
            )}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: c.bg },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
    title: { fontSize: 24, fontWeight: '800', color: c.tx },
    newBtn: { backgroundColor: '#6366f1', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
    newBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
    offlineBanner: { backgroundColor: '#7c2d12', paddingHorizontal: 16, paddingVertical: 8 },
    offlineText: { color: '#fdba74', fontSize: 12, fontWeight: '600', lineHeight: 16 },
    content: { padding: 16, gap: 20, paddingBottom: 40 },
    statsRow: { flexDirection: 'row', gap: 8 },
    stat: { flex: 1, backgroundColor: c.surface, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 8, borderWidth: 1, borderColor: c.cardBorder },
    statValue: { fontSize: 20, fontWeight: '800', color: c.tx, fontVariant: ['tabular-nums'] },
    statLabel: { fontSize: 9, fontWeight: '700', color: c.tx4, letterSpacing: 0.8, marginTop: 2 },
    groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    groupLabel: { fontSize: 11, fontWeight: '800', color: c.tx4, letterSpacing: 1.1 },
    groupAction: { fontSize: 13, fontWeight: '600', color: '#6366f1' },
    card: { backgroundColor: c.surface, borderRadius: 14, padding: 14, gap: 12, borderWidth: 1, borderColor: c.cardBorder },
    cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
    habitName: { flex: 1, fontSize: 16, fontWeight: '600', color: c.tx },
    emptyText: { fontSize: 14, color: c.tx4 },
    archivedRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    archivedName: { fontSize: 14, color: c.tx3 },
    archivedRecord: { fontSize: 12, color: c.tx4, fontVariant: ['tabular-nums'] },
    overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    sheet: { backgroundColor: c.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 32 },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, paddingHorizontal: 0 },
    sheetTitle: { fontSize: 18, fontWeight: '700', color: c.tx },
    closeText: { fontSize: 15, fontWeight: '600', color: '#6366f1' },
    kindCard: { borderWidth: 1.5, borderColor: c.border, borderRadius: 12, padding: 14, gap: 4 },
    kindTitle: { fontSize: 16, fontWeight: '700', color: c.tx },
    kindTag: { fontSize: 10, fontWeight: '700', color: c.tx4, letterSpacing: 1 },
    kindExplainer: { fontSize: 13, color: c.tx3, lineHeight: 18 },
    input: { borderWidth: 1.5, borderColor: c.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, color: c.tx, backgroundColor: c.surface2 },
    presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    preset: { borderWidth: 1.5, borderColor: c.border, borderRadius: 99, paddingHorizontal: 10, paddingVertical: 5 },
    presetText: { fontSize: 13, color: c.tx2 },
    primaryBtn: { flex: 1, backgroundColor: '#6366f1', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
    primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    secondaryBtn: { flex: 1, borderWidth: 1.5, borderColor: c.border, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
    secondaryBtnText: { color: c.tx2, fontWeight: '600', fontSize: 15 },
    detailName: { fontSize: 22, fontWeight: '800', color: c.tx, paddingVertical: 4 },
    detailStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    detailStat: { width: '31%', flexGrow: 1, backgroundColor: c.surface2, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: c.cardBorder },
    detailStatValue: { fontSize: 18, fontWeight: '800', color: c.tx, fontVariant: ['tabular-nums'] },
    hint: { fontSize: 12, color: c.tx4, marginBottom: 4 },
    weekRow: { gap: 8, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    weekDates: { fontSize: 13, color: c.tx2, fontWeight: '600' },
    weekResult: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
    reorderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border, backgroundColor: c.surface },
    reorderHandle: { fontSize: 18, color: c.tx4 },
  });
}
