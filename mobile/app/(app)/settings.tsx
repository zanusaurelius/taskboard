import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert,
  TextInput, ScrollView, ActivityIndicator, DeviceEventEmitter,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { getBaseUrl, clearAll, getGoalLimit, setGoalLimit as storeGoalLimit, getAutoArchiveDays, setAutoArchiveDays as storeAutoArchiveDays } from '@/lib/storage';
import { apiFetch, isOk, logout } from '@/lib/api';
import { useTheme, useThemeColors, type ThemeMode } from '@/lib/theme-context';
import type { ThemeColors } from '@/lib/theme-context';

const GOAL_LIMIT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const AUTO_ARCHIVE_OPTIONS = [
  { label: 'Off', value: 0 },
  { label: 'After 1 day', value: 1 },
  { label: 'After 3 days', value: 3 },
  { label: 'After 7 days', value: 7 },
  { label: 'After 30 days', value: 30 },
];

function Section({ title, subtitle, children, c }: { title: string; subtitle?: string; children: React.ReactNode; c: ThemeColors }) {
  const s = makeStyles(c);
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {subtitle && <Text style={s.sectionSubtitle}>{subtitle}</Text>}
      <View style={s.sectionCard}>{children}</View>
    </View>
  );
}

function Field({ label, children, c }: { label: string; children: React.ReactNode; c: ThemeColors }) {
  const s = makeStyles(c);
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

function PickerRow({ label, options, value, onChange, c }: {
  label: string;
  options: { label: string; value: number }[];
  value: number;
  onChange: (v: number) => void;
  c: ThemeColors;
}) {
  const s = makeStyles(c);
  return (
    <View style={s.pickerSection}>
      <Text style={s.fieldLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.pickerRow}>
        {options.map((o) => (
          <TouchableOpacity
            key={o.value}
            style={[s.pickerChip, value === o.value && s.pickerChipActive]}
            onPress={() => onChange(o.value)}
          >
            <Text style={[s.pickerChipText, value === o.value && s.pickerChipTextActive]}>{o.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const { mode: themeMode, setMode: setThemeMode } = useTheme();
  const s = makeStyles(colors);

  const [serverUrl, setServerUrl] = useState('');
  const [currentUsername, setCurrentUsername] = useState('');

  // Account
  const [newUsername, setNewUsername] = useState('');
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  const [goalLimit, setGoalLimit] = useState(3);
  const [autoArchiveDays, setAutoArchiveDays] = useState(0);

  // Delete account
  const [deleteConfirmPw, setDeleteConfirmPw] = useState('');
  const [showDeleteForm, setShowDeleteForm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    getBaseUrl().then(setServerUrl);
    getGoalLimit().then(setGoalLimit);
    getAutoArchiveDays().then(setAutoArchiveDays);
    apiFetch<{ username: string }>('/api/auth/me').then((res) => {
      if (isOk(res)) setCurrentUsername(res.data.username ?? '');
    });
  }, []);


  const handleGoalLimitChange = async (v: number) => {
    setGoalLimit(v);
    await storeGoalLimit(v);
  };

  const handleAutoArchiveChange = async (v: number) => {
    setAutoArchiveDays(v);
    await storeAutoArchiveDays(v);
  };

  const handleChangeUsername = async () => {
    if (!newUsername.trim()) return;
    setUsernameLoading(true);
    const res = await apiFetch('/api/auth/account', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'changeUsername', newUsername: newUsername.trim() }),
    });
    setUsernameLoading(false);
    if (isOk(res)) {
      Alert.alert('Updated', 'Username changed successfully.');
      setNewUsername('');
    } else {
      const err = (res as { error?: string }).error ?? 'Failed to update username.';
      Alert.alert('Error', err);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPw || !newPw || !confirmPw) {
      Alert.alert('Required', 'Fill in all password fields.');
      return;
    }
    if (newPw !== confirmPw) {
      Alert.alert('Mismatch', "New passwords don't match.");
      return;
    }
    if (newPw.length < 8) {
      Alert.alert('Too short', 'Password must be at least 8 characters.');
      return;
    }
    setPwLoading(true);
    const res = await apiFetch('/api/auth/account', {
      method: 'PATCH',
      body: JSON.stringify({ action: 'changePassword', currentPassword: currentPw, newPassword: newPw }),
    });
    setPwLoading(false);
    if (isOk(res)) {
      Alert.alert('Updated', 'Password changed. You will be signed out.', [
        { text: 'OK', onPress: async () => { await logout(); router.replace('/(auth)/login'); } },
      ]);
      setCurrentPw(''); setNewPw(''); setConfirmPw('');
    } else {
      const err = (res as { error?: string }).error ?? 'Failed to update password.';
      Alert.alert('Error', err);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deleteConfirmPw) {
      Alert.alert('Required', 'Enter your password to confirm.');
      return;
    }
    setDeleteLoading(true);
    const res = await apiFetch('/api/auth/account', {
      method: 'DELETE',
      body: JSON.stringify({ currentPassword: deleteConfirmPw }),
    });
    setDeleteLoading(false);
    if (isOk(res)) {
      await clearAll();
      DeviceEventEmitter.emit('auth:logout');
    } else {
      const err = (res as { error?: string }).error ?? 'Failed to delete account.';
      Alert.alert('Error', err);
    }
  };

  const handleLogout = () => {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: async () => { await logout(); DeviceEventEmitter.emit('auth:logout'); } },
    ]);
  };

  const handleChangeServer = () => {
    Alert.alert('Change server', 'This will sign you out and clear all saved data on this device.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Change server', style: 'destructive', onPress: async () => { await clearAll(); DeviceEventEmitter.emit('auth:logout'); } },
    ]);
  };

  const THEME_OPTIONS: { label: string; value: ThemeMode }[] = [
    { label: 'Auto', value: 'system' },
    { label: 'Light', value: 'light' },
    { label: 'Dark', value: 'dark' },
  ];

  return (
    <SafeAreaView style={[s.root]} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.headingRow}>
          <Text style={s.heading}>Settings</Text>
          {currentUsername ? (
            <Text style={s.signedInAs}>Signed in as <Text style={s.signedInName}>{currentUsername}</Text></Text>
          ) : null}
        </View>

        {/* ── Appearance ── */}
        <Section title="Appearance" c={colors}>
          <View style={s.row}>
            <Text style={s.rowLabel}>Theme</Text>
            <View style={s.themePicker}>
              {THEME_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[s.themeChip, themeMode === opt.value && s.themeChipActive]}
                  onPress={() => setThemeMode(opt.value)}
                >
                  <Text style={[s.themeChipText, themeMode === opt.value && s.themeChipTextActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </Section>

        {/* ── Server ── */}
        <Section title="Server" c={colors}>
          <TouchableOpacity
            style={s.row}
            onPress={() => Alert.alert('Server address', serverUrl || '(not set)')}
          >
            <Text style={s.rowLabel}>Address</Text>
            <Text style={s.rowValue} numberOfLines={1}>{serverUrl || '—'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.row, s.rowMt]} onPress={handleChangeServer}>
            <Text style={s.rowLabel}>Change server</Text>
            <Text style={s.rowChevron}>›</Text>
          </TouchableOpacity>
        </Section>


        {/* ── Username ── */}
        <Section title="Username" subtitle="Change how you sign in." c={colors}>
          <Field label="New username" c={colors}>
            <TextInput
              style={s.input}
              value={newUsername}
              onChangeText={setNewUsername}
              placeholder="Enter new username"
              placeholderTextColor={colors.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={handleChangeUsername}
            />
          </Field>
          <TouchableOpacity
            style={[s.btn, !newUsername.trim() && s.btnDisabled]}
            onPress={handleChangeUsername}
            disabled={!newUsername.trim() || usernameLoading}
          >
            {usernameLoading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.btnText}>Update username</Text>}
          </TouchableOpacity>
        </Section>

        {/* ── Password ── */}
        <Section title="Password" subtitle="You'll need your current password to set a new one." c={colors}>
          <Field label="Current password" c={colors}>
            <TextInput
              style={s.input}
              value={currentPw}
              onChangeText={setCurrentPw}
              placeholder="Current password"
              placeholderTextColor={colors.placeholder}
              secureTextEntry
              autoCapitalize="none"
            />
          </Field>
          <Field label="New password" c={colors}>
            <TextInput
              style={s.input}
              value={newPw}
              onChangeText={setNewPw}
              placeholder="At least 8 characters"
              placeholderTextColor={colors.placeholder}
              secureTextEntry
              autoCapitalize="none"
            />
          </Field>
          <Field label="Confirm new password" c={colors}>
            <TextInput
              style={s.input}
              value={confirmPw}
              onChangeText={setConfirmPw}
              placeholder="Repeat new password"
              placeholderTextColor={colors.placeholder}
              secureTextEntry
              autoCapitalize="none"
              returnKeyType="done"
              onSubmitEditing={handleChangePassword}
            />
          </Field>
          <TouchableOpacity
            style={[s.btn, (!currentPw || !newPw || !confirmPw) && s.btnDisabled]}
            onPress={handleChangePassword}
            disabled={!currentPw || !newPw || !confirmPw || pwLoading}
          >
            {pwLoading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={s.btnText}>Update password</Text>}
          </TouchableOpacity>
        </Section>

        {/* ── Daily Focus ── */}
        <Section title="Daily Focus" subtitle="Number of goal slots shown in Today's Top N." c={colors}>
          <PickerRow
            label="Goals per day"
            options={GOAL_LIMIT_OPTIONS.map((n) => ({ label: String(n), value: n }))}
            value={goalLimit}
            onChange={handleGoalLimitChange}
            c={colors}
          />
        </Section>

        {/* ── Task Board ── */}
        <Section title="Task Board" subtitle="Auto-archive tasks after they're marked done." c={colors}>
          <PickerRow
            label="Auto-archive done tasks"
            options={AUTO_ARCHIVE_OPTIONS}
            value={autoArchiveDays}
            onChange={handleAutoArchiveChange}
            c={colors}
          />
          <Text style={s.hint}>Runs each time the board loads.</Text>
        </Section>

        {/* ── Account ── */}
        <Section title="Account" c={colors}>
          <TouchableOpacity style={s.row} onPress={handleLogout}>
            <Text style={s.dangerText}>Sign out</Text>
          </TouchableOpacity>
        </Section>

        {/* ── Danger zone ── */}
        <Section title="Delete Account" subtitle="Permanently deletes your account and all data. This cannot be undone." c={colors}>
          {!showDeleteForm ? (
            <TouchableOpacity style={s.dangerBtn} onPress={() => setShowDeleteForm(true)}>
              <Text style={s.dangerBtnText}>Delete my account…</Text>
            </TouchableOpacity>
          ) : (
            <View style={s.deleteForm}>
              <Text style={s.deleteWarning}>
                This will permanently delete your account, all tasks, notes, projects, and data.
              </Text>
              <Field label="Confirm with your current password" c={colors}>
                <TextInput
                  style={[s.input, s.inputDanger]}
                  value={deleteConfirmPw}
                  onChangeText={setDeleteConfirmPw}
                  placeholder="Enter password to confirm"
                  placeholderTextColor={colors.placeholder}
                  secureTextEntry
                  autoCapitalize="none"
                />
              </Field>
              <View style={s.deleteButtons}>
                <TouchableOpacity style={s.cancelBtn} onPress={() => { setShowDeleteForm(false); setDeleteConfirmPw(''); }}>
                  <Text style={s.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.deleteConfirmBtn, !deleteConfirmPw && s.btnDisabled]}
                  onPress={handleDeleteAccount}
                  disabled={!deleteConfirmPw || deleteLoading}
                >
                  {deleteLoading
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={s.deleteConfirmBtnText}>Delete permanently</Text>}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </Section>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: c.bg },
    scroll: { paddingBottom: 40 },
    headingRow: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 20 },
    heading: { color: c.tx, fontSize: 26, fontWeight: '800' },
    signedInAs: { color: c.tx3, fontSize: 13, marginTop: 4 },
    signedInName: { color: c.tx2, fontWeight: '600' },

    section: { marginBottom: 24, paddingHorizontal: 20 },
    sectionTitle: { color: c.tx, fontSize: 15, fontWeight: '700', marginBottom: 2 },
    sectionSubtitle: { color: c.tx3, fontSize: 12, marginBottom: 10 },
    sectionCard: { backgroundColor: c.surface, borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: c.border, gap: 0 },

    row: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: 16, paddingVertical: 14,
      borderBottomWidth: 1, borderBottomColor: c.border,
    },
    rowMt: { borderBottomWidth: 0 },
    rowLabel: { color: c.tx2, fontSize: 15 },
    rowValue: { color: c.tx3, fontSize: 14, maxWidth: '60%', textAlign: 'right' },
    rowChevron: { color: c.tx4, fontSize: 20 },
    pending: { color: '#f59e0b', fontWeight: '700' },

    themePicker: { flexDirection: 'row', gap: 6 },
    themeChip: {
      paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20,
      backgroundColor: c.surface2, borderWidth: 1, borderColor: c.border,
    },
    themeChipActive: { backgroundColor: 'rgba(99,102,241,0.15)', borderColor: '#6366f1' },
    themeChipText: { color: c.tx3, fontSize: 13, fontWeight: '600' },
    themeChipTextActive: { color: '#6366f1', fontWeight: '700' },

    field: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
    fieldLabel: { color: c.tx3, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
    input: {
      backgroundColor: c.bg, borderRadius: 8, borderWidth: 1, borderColor: c.border,
      color: c.tx, fontSize: 15, paddingHorizontal: 12, paddingVertical: 10,
    },
    inputDanger: { borderColor: '#7f1d1d' },

    btn: {
      margin: 16, marginTop: 8,
      backgroundColor: '#6366f1', borderRadius: 10, paddingVertical: 12,
      alignItems: 'center',
    },
    btnDisabled: { opacity: 0.4 },
    btnText: { color: '#fff', fontSize: 15, fontWeight: '700' },

    pickerSection: { paddingHorizontal: 16, paddingVertical: 12 },
    pickerRow: { flexDirection: 'row', gap: 8, paddingBottom: 2 },
    pickerChip: {
      paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
      backgroundColor: c.bg, borderWidth: 1, borderColor: c.border,
    },
    pickerChipActive: { backgroundColor: 'rgba(99,102,241,0.2)', borderColor: '#6366f1' },
    pickerChipText: { color: c.tx3, fontSize: 13, fontWeight: '600' },
    pickerChipTextActive: { color: '#a5b4fc' },

    hint: { color: c.tx4, fontSize: 12, paddingHorizontal: 16, paddingBottom: 12 },

    dangerText: { color: '#ef4444', fontSize: 15, fontWeight: '600' },
    dangerBtn: {
      margin: 16, borderWidth: 1.5, borderColor: '#7f1d1d',
      borderRadius: 10, paddingVertical: 12, alignItems: 'center',
    },
    dangerBtnText: { color: '#ef4444', fontSize: 15, fontWeight: '600' },

    deleteForm: { padding: 16, gap: 8 },
    deleteWarning: {
      color: '#f87171', fontSize: 13, lineHeight: 18,
      backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 8,
      padding: 12, marginBottom: 4,
    },
    deleteButtons: { flexDirection: 'row', gap: 10, marginTop: 4 },
    cancelBtn: { flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
    cancelBtnText: { color: c.tx3, fontSize: 14, fontWeight: '600' },
    deleteConfirmBtn: { flex: 1, backgroundColor: '#ef4444', borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
    deleteConfirmBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  });
}
