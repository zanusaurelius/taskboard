"use client";
import { useEffect, useState } from "react";
import { useSession, signOut } from "next-auth/react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import NotificationAddOutlinedIcon from "@mui/icons-material/NotificationAddOutlined";
import PasswordField from "./PasswordField";
import PageHeader from "./PageHeader";
import { cardSx, pageBodySx, primaryButtonSx, type } from "@/lib/ui";
import { type Reminder, loadReminders, saveReminders, fireReminder } from "@/lib/useReminders";

const fieldSx = {
  "& .MuiOutlinedInput-root": { borderRadius: 1.5, "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: "var(--accent)" } },
  "& .MuiInputLabel-root.Mui-focused": { color: "var(--accent)" },
};

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mb: 4 }}>
      <Typography sx={{ ...type.sectionTitle, mb: 0.25 }}>{title}</Typography>
      {subtitle && <Typography sx={{ ...type.small, mb: 1.5 }}>{subtitle}</Typography>}
      <Box sx={{ ...cardSx, p: 3 }}>
        {children}
      </Box>
    </Box>
  );
}

export default function SettingsView() {
  const { data: session, update: updateSession } = useSession();
  const username = session?.user?.name ?? "";

  const [goalLimit, setGoalLimit] = useState<number>(() => {
    if (typeof window === "undefined") return 3;
    return parseInt(localStorage.getItem("dailyGoalLimit") ?? "3", 10) || 3;
  });
  const [goalLimitSaved, setGoalLimitSaved] = useState(false);

  const [autoArchiveDays, setAutoArchiveDays] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    return parseInt(localStorage.getItem("autoArchiveDays") ?? "0", 10) || 0;
  });

  const handleAutoArchiveChange = (days: number) => {
    setAutoArchiveDays(days);
    localStorage.setItem("autoArchiveDays", String(days));
  };

  const [weekStartsOn, setWeekStartsOn] = useState<0 | 1 | null>(null);
  const [weekStartMsg, setWeekStartMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  useEffect(() => {
    fetch("/api/settings/week-start")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setWeekStartsOn(d.weekStartsOn === 1 ? 1 : 0); })
      .catch(() => {});
  }, []);

  const handleWeekStartChange = async (value: 0 | 1) => {
    const prev = weekStartsOn;
    setWeekStartsOn(value);
    const res = await fetch("/api/settings/week-start", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ weekStartsOn: value }),
    }).catch(() => null);
    if (res?.ok) {
      window.dispatchEvent(new CustomEvent("habits:changed"));
      setWeekStartMsg({ type: "success", text: "Week start saved." });
    } else {
      setWeekStartsOn(prev);
      setWeekStartMsg({ type: "error", text: "Couldn't save the week start. Check your connection and try again." });
    }
    setTimeout(() => setWeekStartMsg(null), 2500);
  };

  const handleSaveGoalLimit = () => {
    localStorage.setItem("dailyGoalLimit", String(goalLimit));
    window.dispatchEvent(new Event("dailyfocus:refresh"));
    setGoalLimitSaved(true);
    setTimeout(() => setGoalLimitSaved(false), 2000);
  };

  // Change username
  const [newUsername, setNewUsername]         = useState("");
  const [usernameMsg, setUsernameMsg]         = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [usernameLoading, setUsernameLoading] = useState(false);

  // Change password
  const [currentPw, setCurrentPw]     = useState("");
  const [newPw, setNewPw]             = useState("");
  const [confirmPw, setConfirmPw]     = useState("");
  const [passwordMsg, setPasswordMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Delete account
  const [deleteConfirmPw, setDeleteConfirmPw]   = useState("");
  const [deleteConfirmed, setDeleteConfirmed]   = useState(false);
  const [deleteMsg, setDeleteMsg]               = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [deleteLoading, setDeleteLoading]       = useState(false);

  // Reminders
  const [reminders, setReminders] = useState<Reminder[]>(() =>
    typeof window === "undefined" ? [] : loadReminders()
  );
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | "unsupported">(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
    return Notification.permission;
  });
  const [addingReminder, setAddingReminder] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBody, setNewBody] = useState("");
  const [newInterval, setNewInterval] = useState(20);

  const requestPermission = async () => {
    const perm = await Notification.requestPermission();
    setNotifPerm(perm);
  };

  const persistReminders = (updated: Reminder[]) => {
    setReminders(updated);
    saveReminders(updated);
  };

  const handleToggle = (id: string, enabled: boolean) => {
    persistReminders(reminders.map((r) => r.id === id ? { ...r, enabled } : r));
  };

  const handleDelete = (id: string) => {
    persistReminders(reminders.filter((r) => r.id !== id));
  };

  const handleAddReminder = () => {
    if (!newTitle.trim()) return;
    const r: Reminder = {
      id: crypto.randomUUID(),
      title: newTitle.trim(),
      body: newBody.trim(),
      intervalMinutes: newInterval,
      enabled: true,
    };
    persistReminders([...reminders, r]);
    setNewTitle(""); setNewBody(""); setNewInterval(20);
    setAddingReminder(false);
  };

  const handleChangeUsername = async (e: React.FormEvent) => {
    e.preventDefault();
    setUsernameMsg(null);
    setUsernameLoading(true);
    const res = await fetch("/api/auth/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "changeUsername", newUsername }),
    });
    const data = await res.json();
    setUsernameLoading(false);
    if (!res.ok) { setUsernameMsg({ type: "error", text: data.error }); return; }
    setUsernameMsg({ type: "success", text: "Username updated." });
    setNewUsername("");
    await updateSession({ name: data.username });
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordMsg(null);
    if (newPw !== confirmPw) { setPasswordMsg({ type: "error", text: "Passwords don't match." }); return; }
    if (newPw.length < 8)    { setPasswordMsg({ type: "error", text: "Password must be at least 8 characters." }); return; }
    setPasswordLoading(true);
    const res = await fetch("/api/auth/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "changePassword", currentPassword: currentPw, newPassword: newPw }),
    });
    const data = await res.json();
    setPasswordLoading(false);
    if (!res.ok) { setPasswordMsg({ type: "error", text: data.error }); return; }
    setPasswordMsg({ type: "success", text: "Password updated. You will be signed out." });
    setCurrentPw(""); setNewPw(""); setConfirmPw("");
    // Password change invalidates the JWT server-side; sign out so the user re-authenticates cleanly
    setTimeout(() => signOut({ callbackUrl: "/login" }), 1500);
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeleteMsg(null);
    setDeleteLoading(true);
    const res = await fetch("/api/auth/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: deleteConfirmPw }),
    });
    setDeleteLoading(false);
    if (!res.ok) {
      const data = await res.json();
      setDeleteMsg({ type: "error", text: data.error });
      return;
    }
    await signOut({ callbackUrl: "/login" });
  };

  return (
    <Box sx={{ minHeight: "100%", display: "flex", flexDirection: "column", backgroundColor: "var(--bg)" }}>
      <PageHeader title="Settings" privacy={false} />
      <Box sx={{ ...pageBodySx, maxWidth: 640, gap: 0 }}>
        <Typography sx={{ ...type.small, mb: 3 }}>
          Signed in as <strong style={{ color: "var(--tx)" }}>{username}</strong>
        </Typography>

        {/* ── Username ── */}
        <Section title="Username" subtitle="Change how you sign in.">
          <form onSubmit={handleChangeUsername}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {usernameMsg && <Alert severity={usernameMsg.type} sx={{ borderRadius: 1.5 }}>{usernameMsg.text}</Alert>}
              <TextField
                label="New username"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder={username}
                required fullWidth size="small"
                helperText="Letters, numbers, _ and - only"
                sx={fieldSx}
              />
              <Button type="submit" disabled={usernameLoading} sx={saveBtnSx}>
                {usernameLoading ? <CircularProgress size={18} sx={{ color: "#fff" }} /> : "Update username"}
              </Button>
            </Box>
          </form>
        </Section>

        {/* ── Password ── */}
        <Section title="Password" subtitle="You'll need your current password to set a new one.">
          <form onSubmit={handleChangePassword}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {passwordMsg && <Alert severity={passwordMsg.type} sx={{ borderRadius: 1.5 }}>{passwordMsg.text}</Alert>}
              <PasswordField label="Current password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)}
                required fullWidth size="small" autoComplete="current-password" fieldSx={fieldSx} />
              <PasswordField label="New password" value={newPw} onChange={(e) => setNewPw(e.target.value)}
                required fullWidth size="small" autoComplete="new-password" helperText="At least 8 characters" fieldSx={fieldSx} />
              <PasswordField label="Confirm new password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)}
                required fullWidth size="small" autoComplete="new-password" fieldSx={fieldSx} />
              <Button type="submit" disabled={passwordLoading} sx={saveBtnSx}>
                {passwordLoading ? <CircularProgress size={18} sx={{ color: "#fff" }} /> : "Update password"}
              </Button>
            </Box>
          </form>
        </Section>

        {/* ── Session ── */}
        <Section title="Session">
          <Button
            variant="outlined"
            onClick={() => signOut({ callbackUrl: "/login" })}
            sx={{ borderColor: "var(--border)", color: "var(--tx-3)", textTransform: "none", fontWeight: 600, borderRadius: 1.5, "&:hover": { borderColor: "var(--danger-fg)", color: "var(--danger-fg)", backgroundColor: "var(--danger-bg)" } }}
          >
            Sign out
          </Button>
        </Section>

        {/* ── Task Board ── */}
        <Section title="Task Board" subtitle="Automate how completed tasks are managed.">
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <FormControl size="small" sx={{ maxWidth: 220 }}>
              <InputLabel>Auto-archive done tasks</InputLabel>
              <Select
                label="Auto-archive done tasks"
                value={autoArchiveDays}
                onChange={(e) => handleAutoArchiveChange(Number(e.target.value))}
                sx={{ borderRadius: 1.5, "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--border)" }, "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: "var(--accent)" } }}
              >
                <MenuItem value={0}>Off</MenuItem>
                <MenuItem value={1}>After 1 day</MenuItem>
                <MenuItem value={3}>After 3 days</MenuItem>
                <MenuItem value={7}>After 7 days</MenuItem>
                <MenuItem value={30}>After 30 days</MenuItem>
              </Select>
            </FormControl>
            <Typography sx={{ fontSize: "0.8rem", color: "var(--tx-4)" }}>
              Tasks in the Done column are automatically archived after the selected period. Runs each time the board loads.
            </Typography>
          </Box>
        </Section>

        {/* ── Daily Focus ── */}
        <Section title="Daily Focus" subtitle="Customize your daily focus panel.">
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {goalLimitSaved && <Alert severity="success" sx={{ borderRadius: 1.5 }}>Settings saved.</Alert>}
            <FormControl size="small" sx={{ maxWidth: 220 }}>
              <InputLabel>Today&apos;s Top N</InputLabel>
              <Select
                label="Today's Top N"
                value={goalLimit}
                onChange={(e) => setGoalLimit(Number(e.target.value))}
                sx={{ borderRadius: 1.5, "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--border)" }, "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: "var(--accent)" } }}
              >
                {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                  <MenuItem key={n} value={n}>{n} goal{n === 1 ? "" : "s"} per day</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Typography sx={{ fontSize: "0.8rem", color: "var(--tx-4)" }}>
              Sets the number of slots shown in your &ldquo;Today&apos;s Top N&rdquo; section.
            </Typography>
            <Button onClick={handleSaveGoalLimit} sx={saveBtnSx}>
              Save
            </Button>
          </Box>
        </Section>

        {/* ── Habits ── */}
        <Section title="Habits" subtitle="Weekly records count from this day.">
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {weekStartMsg && <Alert severity={weekStartMsg.type} sx={{ borderRadius: 1.5 }}>{weekStartMsg.text}</Alert>}
            <FormControl size="small" sx={{ maxWidth: 220 }}>
              <InputLabel>Week starts on</InputLabel>
              <Select
                label="Week starts on"
                value={weekStartsOn ?? ""}
                disabled={weekStartsOn === null}
                onChange={(e) => handleWeekStartChange(Number(e.target.value) === 1 ? 1 : 0)}
                sx={{ borderRadius: 1.5, "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--border)" }, "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: "var(--accent)" } }}
              >
                <MenuItem value={0}>Sunday</MenuItem>
                <MenuItem value={1}>Monday</MenuItem>
              </Select>
            </FormControl>
          </Box>
        </Section>

        {/* ── Reminders ── */}
        <Section title="Reminders" subtitle="Desktop notifications that fire on a repeating schedule while the app is open.">
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>

            {/* Permission banner */}
            {notifPerm === "unsupported" && (
              <Alert severity="warning" sx={{ borderRadius: 1.5, fontSize: "0.8rem" }}>
                Your browser does not support notifications.
              </Alert>
            )}
            {notifPerm === "denied" && (
              <Alert severity="error" sx={{ borderRadius: 1.5, fontSize: "0.8rem" }}>
                Notifications are blocked. Allow them in your browser site settings, then reload.
              </Alert>
            )}
            {notifPerm === "default" && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 2, p: 1.5, border: "1px dashed var(--border-2)", borderRadius: 1.5 }}>
                <Typography sx={{ fontSize: "0.8rem", color: "var(--tx-3)", flex: 1 }}>
                  Grant notification permission to enable reminders.
                </Typography>
                <Button onClick={requestPermission} size="small" sx={{ ...saveBtnSx, alignSelf: "auto", px: 2, py: 0.6, fontSize: "0.8rem" }}>
                  Allow
                </Button>
              </Box>
            )}

            {/* Reminder list */}
            {reminders.length === 0 && notifPerm !== "unsupported" && (
              <Typography sx={{ fontSize: "0.8rem", color: "var(--tx-4)" }}>No reminders yet. Add one below.</Typography>
            )}
            {reminders.map((r) => (
              <Box key={r.id} sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 1.5, border: "1px solid var(--border)", borderRadius: 1.5, backgroundColor: "var(--surface-2)" }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 600, fontSize: "0.875rem", color: "var(--tx)", lineHeight: 1.3 }}>{r.title}</Typography>
                  {r.body && <Typography sx={{ fontSize: "0.8rem", color: "var(--tx-3)", mt: 0.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.body}</Typography>}
                  <Typography sx={{ fontSize: "0.73rem", color: "var(--tx-4)", mt: 0.25 }}>Every {r.intervalMinutes} min</Typography>
                </Box>
                <IconButton size="small" title="Test" onClick={() => fireReminder(r)} disabled={notifPerm !== "granted"}
                  sx={{ color: "var(--accent)", "&:hover": { backgroundColor: "rgba(99,102,241,0.08)" } }}>
                  <NotificationsNoneIcon sx={{ fontSize: 18 }} />
                </IconButton>
                <FormControlLabel
                  control={<Switch checked={r.enabled} onChange={(e) => handleToggle(r.id, e.target.checked)} size="small"
                    disabled={notifPerm !== "granted"}
                    sx={{ "& .MuiSwitch-switchBase.Mui-checked": { color: "var(--accent)" }, "& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track": { backgroundColor: "#6366f1" } }} />}
                  label="" sx={{ m: 0 }}
                />
                <IconButton size="small" onClick={() => handleDelete(r.id)} sx={{ color: "var(--tx-4)", "&:hover": { color: "var(--danger-fg)", backgroundColor: "rgba(239,68,68,0.08)" } }}>
                  <DeleteOutlineIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Box>
            ))}

            {/* Add form */}
            {addingReminder ? (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, p: 1.5, border: "1px solid var(--border)", borderRadius: 1.5 }}>
                <TextField label="Title" value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Eye Strain Break" size="small" fullWidth required sx={fieldSx} />
                <TextField label="Message (optional)" value={newBody} onChange={(e) => setNewBody(e.target.value)}
                  placeholder="e.g. Look at something 20 feet away for 20 seconds" size="small" fullWidth multiline maxRows={3} sx={fieldSx} />
                <FormControl size="small" sx={{ maxWidth: 200 }}>
                  <InputLabel>Interval</InputLabel>
                  <Select label="Interval" value={newInterval} onChange={(e) => setNewInterval(Number(e.target.value))}
                    sx={{ borderRadius: 1.5, "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--border)" }, "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: "var(--accent)" } }}>
                    {[5, 10, 15, 20, 25, 30, 45, 60, 90, 120].map((m) => (
                      <MenuItem key={m} value={m}>Every {m} min</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Box sx={{ display: "flex", gap: 1 }}>
                  <Button onClick={handleAddReminder} disabled={!newTitle.trim()} sx={{ ...saveBtnSx, alignSelf: "auto" }}>Save</Button>
                  <Button onClick={() => { setAddingReminder(false); setNewTitle(""); setNewBody(""); setNewInterval(20); }}
                    sx={{ color: "var(--tx-3)", textTransform: "none", fontWeight: 600, borderRadius: 1.5 }}>Cancel</Button>
                </Box>
              </Box>
            ) : (
              <Button
                startIcon={<NotificationAddOutlinedIcon />}
                onClick={() => setAddingReminder(true)}
                disabled={notifPerm !== "granted"}
                sx={{ alignSelf: "flex-start", color: "var(--accent)", textTransform: "none", fontWeight: 600, borderRadius: 1.5, fontSize: "0.875rem",
                  "&:hover": { backgroundColor: "rgba(99,102,241,0.08)" },
                  "&:disabled": { opacity: 0.4 } }}
              >
                Add reminder
              </Button>
            )}
          </Box>
        </Section>

        {/* ── Delete account ── */}
        <Section title="Delete account" subtitle="Permanently deletes your account and all data. This cannot be undone.">
          {!deleteConfirmed ? (
            <Button
              variant="outlined"
              onClick={() => setDeleteConfirmed(true)}
              sx={{ borderColor: "var(--danger-line)", color: "var(--danger-fg)", textTransform: "none", fontWeight: 600, borderRadius: 1.5, "&:hover": { borderColor: "var(--danger-fg)", backgroundColor: "var(--danger-bg)" } }}
            >
              Delete my account
            </Button>
          ) : (
            <form onSubmit={handleDeleteAccount}>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <Alert severity="error" sx={{ borderRadius: 1.5, fontSize: "0.8rem" }}>
                  This will permanently delete your account, all tasks, notes, projects, and uploaded images.
                </Alert>
                {deleteMsg && <Alert severity={deleteMsg.type} sx={{ borderRadius: 1.5 }}>{deleteMsg.text}</Alert>}
                <PasswordField
                  label="Confirm with your current password"
                  value={deleteConfirmPw}
                  onChange={(e) => setDeleteConfirmPw(e.target.value)}
                  required fullWidth size="small"
                  autoComplete="current-password"
                  fieldSx={{
                    "& .MuiOutlinedInput-root": { borderRadius: 1.5, "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: "var(--danger-fg)" } },
                    "& .MuiInputLabel-root.Mui-focused": { color: "var(--danger-fg)" },
                  }}
                />
                <Box sx={{ display: "flex", gap: 1.5 }}>
                  <Button
                    variant="outlined"
                    onClick={() => { setDeleteConfirmed(false); setDeleteConfirmPw(""); setDeleteMsg(null); }}
                    sx={{ flex: 1, borderColor: "var(--border)", color: "var(--tx-3)", textTransform: "none", fontWeight: 600, borderRadius: 1.5 }}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={deleteLoading}
                    sx={{ flex: 1, backgroundColor: "#ef4444", color: "#fff", textTransform: "none", fontWeight: 700, borderRadius: 1.5, "&:hover": { backgroundColor: "#dc2626" }, "&:disabled": { opacity: 0.7 } }}
                  >
                    {deleteLoading ? <CircularProgress size={18} sx={{ color: "#fff" }} /> : "Delete permanently"}
                  </Button>
                </Box>
              </Box>
            </form>
          )}
        </Section>
      </Box>
    </Box>
  );
}

const saveBtnSx = { ...primaryButtonSx, alignSelf: "flex-start", px: 2.5, py: 0.75 };
