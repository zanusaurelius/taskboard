"use client";
import { useState } from "react";
import { useSession, signOut } from "next-auth/react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Divider from "@mui/material/Divider";
import CircularProgress from "@mui/material/CircularProgress";
import PasswordField from "./PasswordField";

const fieldSx = {
  "& .MuiOutlinedInput-root": { borderRadius: 1.5, "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: "#6366f1" } },
  "& .MuiInputLabel-root.Mui-focused": { color: "#6366f1" },
};

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mb: 4 }}>
      <Typography sx={{ fontWeight: 700, fontSize: "0.95rem", color: "#0f172a", mb: 0.25 }}>{title}</Typography>
      {subtitle && <Typography sx={{ fontSize: "0.8rem", color: "#94a3b8", mb: 2 }}>{subtitle}</Typography>}
      <Box sx={{ backgroundColor: "#fff", borderRadius: 2.5, p: 3, boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
        {children}
      </Box>
    </Box>
  );
}

export default function SettingsView() {
  const { data: session, update: updateSession } = useSession();
  const username = session?.user?.name ?? "";

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
    <Box sx={{ flex: 1, overflowY: "auto", backgroundColor: "#f8fafc" }}>
      <Box sx={{ maxWidth: 520, mx: "auto", px: 4, py: 5 }}>
        <Typography variant="h6" sx={{ fontWeight: 800, color: "#0f172a", mb: 0.5, letterSpacing: -0.3 }}>Settings</Typography>
        <Typography sx={{ fontSize: "0.85rem", color: "#94a3b8", mb: 4 }}>
          Signed in as <strong style={{ color: "#475569" }}>{username}</strong>
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

        <Divider sx={{ mb: 4, borderColor: "#e2e8f0" }} />

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

        <Divider sx={{ mb: 4, borderColor: "#e2e8f0" }} />

        {/* ── Session ── */}
        <Section title="Session">
          <Button
            variant="outlined"
            onClick={() => signOut({ callbackUrl: "/login" })}
            sx={{ borderColor: "#e2e8f0", color: "#64748b", textTransform: "none", fontWeight: 600, borderRadius: 1.5, "&:hover": { borderColor: "#ef4444", color: "#ef4444", backgroundColor: "#fff1f2" } }}
          >
            Sign out
          </Button>
        </Section>

        <Divider sx={{ mb: 4, borderColor: "#e2e8f0" }} />

        {/* ── Delete account ── */}
        <Section title="Delete account" subtitle="Permanently deletes your account and all data. This cannot be undone.">
          {!deleteConfirmed ? (
            <Button
              variant="outlined"
              onClick={() => setDeleteConfirmed(true)}
              sx={{ borderColor: "#fca5a5", color: "#ef4444", textTransform: "none", fontWeight: 600, borderRadius: 1.5, "&:hover": { borderColor: "#ef4444", backgroundColor: "#fff1f2" } }}
            >
              Delete my account
            </Button>
          ) : (
            <form onSubmit={handleDeleteAccount}>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <Alert severity="error" sx={{ borderRadius: 1.5, fontSize: "0.82rem" }}>
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
                    "& .MuiOutlinedInput-root": { borderRadius: 1.5, "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: "#ef4444" } },
                    "& .MuiInputLabel-root.Mui-focused": { color: "#ef4444" },
                  }}
                />
                <Box sx={{ display: "flex", gap: 1.5 }}>
                  <Button
                    variant="outlined"
                    onClick={() => { setDeleteConfirmed(false); setDeleteConfirmPw(""); setDeleteMsg(null); }}
                    sx={{ flex: 1, borderColor: "#e2e8f0", color: "#64748b", textTransform: "none", fontWeight: 600, borderRadius: 1.5 }}
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

const saveBtnSx = {
  alignSelf: "flex-start",
  px: 2.5, py: 0.9,
  background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
  color: "#fff", fontWeight: 700, fontSize: "0.85rem", textTransform: "none", borderRadius: 1.5,
  "&:hover": { background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" },
  "&:disabled": { opacity: 0.7 },
};
