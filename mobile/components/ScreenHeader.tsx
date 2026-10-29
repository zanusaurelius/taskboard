import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useThemeColors, type ThemeColors } from '@/lib/theme-context';

export interface HeaderAction {
  label: string;
  onPress: () => void;
  /** The screen's main action. Use for one action per screen, placed last. */
  primary?: boolean;
  disabled?: boolean;
}

interface Props {
  title: string;
  actions?: HeaderAction[];
  /** Privacy button state and handler, on screens that hide private items. */
  privacy?: { on: boolean; onPress: () => void };
  /** Hides the search button on screens that are themselves search. */
  hideSearch?: boolean;
  /** Long-press on the title, for screens that hang a gesture off it. */
  onTitleLongPress?: () => void;
  onTitlePress?: () => void;
  /** Small status shown before the buttons, e.g. "Saved". */
  extra?: React.ReactNode;
}

/** The row at the top of every tab: title, then search, privacy and the screen's actions. */
export default function ScreenHeader({ title, actions = [], privacy, hideSearch, onTitlePress, onTitleLongPress, extra }: Props) {
  const colors = useThemeColors();
  const s = makeStyles(colors);
  const router = useRouter();
  return (
    <View style={s.row}>
      <Text style={s.title} numberOfLines={1} onPress={onTitlePress} onLongPress={onTitleLongPress} suppressHighlighting>
        {title}
      </Text>
      <View style={s.actions}>
        {extra}
        {!hideSearch && (
          <TouchableOpacity style={s.iconBtn} onPress={() => router.push('/(app)/search')} accessibilityRole="button" accessibilityLabel="Search">
            <Text style={s.iconText}>🔍</Text>
          </TouchableOpacity>
        )}
        {privacy && (
          <TouchableOpacity style={[s.iconBtn, privacy.on && s.iconBtnOn]} onPress={privacy.onPress} accessibilityRole="button"
            accessibilityLabel={privacy.on ? 'Privacy on. Show private items' : 'Privacy off. Hide private items'}>
            <Text style={s.iconText}>{privacy.on ? '🔒' : '🔓'}</Text>
          </TouchableOpacity>
        )}
        {actions.map((a) => (
          <TouchableOpacity key={a.label} onPress={a.onPress} disabled={a.disabled} activeOpacity={0.8} accessibilityRole="button"
            style={[a.primary ? s.primaryBtn : s.secondaryBtn, a.disabled && { opacity: 0.5 }]}>
            <Text style={a.primary ? s.primaryText : s.secondaryText}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, minHeight: 56 },
    title: { flex: 1, fontSize: 22, fontWeight: '800', color: c.tx, letterSpacing: -0.3 },
    actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    iconBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: c.border, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface },
    iconBtnOn: { borderColor: 'rgba(99,102,241,0.45)', backgroundColor: 'rgba(99,102,241,0.12)' },
    iconText: { fontSize: 15 },
    primaryBtn: { height: 36, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#6366f1', alignItems: 'center', justifyContent: 'center' },
    primaryText: { color: '#fff', fontSize: 14, fontWeight: '700' },
    secondaryBtn: { height: 36, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: c.border2, alignItems: 'center', justifyContent: 'center' },
    secondaryText: { color: c.tx2, fontSize: 14, fontWeight: '600' },
  });
}
