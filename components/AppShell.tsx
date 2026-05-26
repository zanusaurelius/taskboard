"use client";
import { useEffect, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import Avatar from "@mui/material/Avatar";
import CircularProgress from "@mui/material/CircularProgress";
import DashboardIcon from "@mui/icons-material/Dashboard";
import NoteAltOutlinedIcon from "@mui/icons-material/NoteAltOutlined";
import AutoStoriesOutlinedIcon from "@mui/icons-material/AutoStoriesOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import LogoutIcon from "@mui/icons-material/Logout";
import WifiOffIcon from "@mui/icons-material/WifiOff";
import SyncIcon from "@mui/icons-material/Sync";
import TaskBoard from "./TaskBoard";
import NotesView from "./NotesView";
import JournalView from "./JournalView";
import SettingsView from "./SettingsView";
import VaultSetupModal from "./VaultSetupModal";
import VaultUnlockModal from "./VaultUnlockModal";
import E2EMigration from "./E2EMigration";
import { useReminders } from "@/lib/useReminders";
import { useOnlineSync } from "@/lib/useOnlineSync";
import { VaultProvider, useVault } from "@/lib/vault-context";
import { useTaskBoardStore } from "@/lib/store";

type View = "board" | "notes" | "journal" | "settings";
type VaultState = "loading" | "not-setup" | "locked" | "unlocked";

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}

function NavItem({ icon, label, active, onClick }: NavItemProps) {
  return (
    <Tooltip title={label} placement="right" arrow>
      <Box
        onClick={onClick}
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 0.5,
          px: 1,
          py: 1.25,
          borderRadius: 2,
          cursor: "pointer",
          backgroundColor: active ? "rgba(99,102,241,0.18)" : "transparent",
          color: active ? "#a5b4fc" : "rgba(255,255,255,0.45)",
          transition: "background-color 0.15s, color 0.15s",
          "&:hover": {
            backgroundColor: active ? "rgba(99,102,241,0.22)" : "rgba(255,255,255,0.07)",
            color: active ? "#a5b4fc" : "rgba(255,255,255,0.75)",
          },
          userSelect: "none",
        }}
      >
        <Box sx={{ fontSize: 0 }}>{icon}</Box>
        <Typography sx={{ fontSize: "0.62rem", fontWeight: 600, letterSpacing: 0.3, lineHeight: 1 }}>
          {label}
        </Typography>
      </Box>
    </Tooltip>
  );
}

// ── Inner shell (has access to vault context) ─────────────────────────────────

function AppShellInner() {
  const { data: session } = useSession();
  const router = useRouter();
  const { masterKey } = useVault();
  const setMasterKey = useTaskBoardStore((s) => s.setMasterKey);
  const [view, setView] = useState<View>(() => {
    if (typeof window === "undefined") return "board";
    const saved = localStorage.getItem("currentView");
    return (saved === "board" || saved === "notes" || saved === "journal" || saved === "settings") ? saved : "board";
  });
  useReminders();
  const { isOnline, pendingCount, syncing } = useOnlineSync();

  // Vault gate state
  const [vaultState, setVaultState] = useState<VaultState>("loading");
  const [hasWebAuthn, setHasWebAuthn] = useState(false);
  const [migrationDone, setMigrationDone] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // Check db unlock state
  useEffect(() => {
    fetch("/api/auth/db-status")
      .then((r) => r.json())
      .then((d) => { if (d.state !== "unlocked") router.push("/unlock"); })
      .catch(() => {});
  }, [router]);

  // Check vault setup state on mount
  useEffect(() => {
    fetch("/api/notes/vault")
      .then((r) => r.json())
      .then((d) => {
        if (!d.exists) {
          setVaultState("not-setup");
        } else {
          try {
            const creds = JSON.parse(d.webAuthnCredentials ?? "[]");
            setHasWebAuthn(Array.isArray(creds) && creds.length > 0);
          } catch { /* ignore */ }
          setVaultState("locked");
        }
      })
      .catch(() => setVaultState("locked"));
  }, []);

  // When vault key becomes available, push it into the store to decrypt loaded data
  useEffect(() => {
    if (masterKey) {
      setMasterKey(masterKey);
      if (vaultState === "locked") setVaultState("unlocked");
    }
  }, [masterKey, setMasterKey, vaultState]);

  const [pendingNoteTask, setPendingNoteTask] = useState<{ title: string; description: string } | null>(null);
  const navigate = (v: View) => { setView(v); localStorage.setItem("currentView", v); };
  const handleCreateTaskFromNote = (title: string, description: string) => {
    setPendingNoteTask({ title, description });
    navigate("board");
  };

  const username = session?.user?.name ?? "";
  const initials = username.slice(0, 2).toUpperCase() || "?";

  // ── Vault gate ──────────────────────────────────────────────────────────────

  if (vaultState === "loading") {
    return (
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", backgroundColor: "#0f172a" }}>
        <CircularProgress sx={{ color: "#6366f1" }} />
      </Box>
    );
  }

  if (vaultState === "not-setup") {
    return (
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", backgroundColor: "#0f172a" }}>
        <VaultSetupModal
          open
          onClose={() => {}}
          onSuccess={() => setVaultState("locked")}
        />
      </Box>
    );
  }

  if (vaultState === "locked") {
    return (
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", backgroundColor: "#0f172a" }}>
        <VaultUnlockModal
          open
          onClose={() => {}}
          onSuccess={() => setVaultState("unlocked")}
          mode="unlock"
          hasWebAuthn={hasWebAuthn}
        />
      </Box>
    );
  }

  // Migration check — runs once after first unlock, before showing app
  if (!migrationDone) {
    return (
      <E2EMigration onComplete={() => setMigrationDone(true)} />
    );
  }

  // ── Full app ────────────────────────────────────────────────────────────────

  return (
    <Box sx={{ display: "flex", height: "100vh", overflow: "hidden", backgroundColor: "#f1f5f9" }}>

      {/* ── Sidebar (hidden on mobile, replaced by bottom nav) ── */}
      <Box sx={{
        width: 68,
        flexShrink: 0,
        height: "100vh",
        backgroundColor: "#0f172a",
        display: { xs: "none", sm: "flex" },
        flexDirection: "column",
        alignItems: "center",
        py: 2,
        gap: 0.5,
        borderRight: "1px solid rgba(255,255,255,0.06)",
        overflowY: "auto",
      }}>
        <Box sx={{
          width: 36, height: 36, borderRadius: 2,
          background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 2px 12px rgba(99,102,241,0.5)",
          mb: 2, flexShrink: 0,
        }}>
          <Typography sx={{ color: "#fff", fontSize: "1.1rem", fontWeight: 900, lineHeight: 1 }}>T</Typography>
        </Box>

        <NavItem icon={<DashboardIcon sx={{ fontSize: 22 }} />} label="Board" active={view === "board"} onClick={() => navigate("board")} />
        <NavItem icon={<NoteAltOutlinedIcon sx={{ fontSize: 22 }} />} label="Notes" active={view === "notes"} onClick={() => navigate("notes")} />
        <NavItem icon={<AutoStoriesOutlinedIcon sx={{ fontSize: 22 }} />} label="Journal" active={view === "journal"} onClick={() => navigate("journal")} />
        <NavItem icon={<SettingsOutlinedIcon sx={{ fontSize: 22 }} />} label="Settings" active={view === "settings"} onClick={() => navigate("settings")} />

        <Box sx={{ flex: 1 }} />

        {session?.user && (
          <Tooltip title="Settings" placement="right" arrow>
            <Avatar onClick={() => navigate("settings")} sx={{ width: 32, height: 32, fontSize: "0.75rem", fontWeight: 700, bgcolor: view === "settings" ? "#6366f1" : "#334155", color: view === "settings" ? "#fff" : "#94a3b8", mb: 0.5, cursor: "pointer", transition: "background-color 0.15s", "&:hover": { bgcolor: "#6366f1", color: "#fff" } }}>
              {initials}
            </Avatar>
          </Tooltip>
        )}

        <Tooltip title="Sign out" placement="right" arrow>
          <Box
            onClick={() => signOut({ callbackUrl: "/login" })}
            sx={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5,
              px: 1, py: 1, borderRadius: 2, cursor: "pointer",
              color: "rgba(255,255,255,0.35)",
              transition: "color 0.15s, background-color 0.15s",
              "&:hover": { color: "#f87171", backgroundColor: "rgba(239,68,68,0.1)" },
              userSelect: "none",
            }}
          >
            <LogoutIcon sx={{ fontSize: 18 }} />
            <Typography sx={{ fontSize: "0.58rem", fontWeight: 600, letterSpacing: 0.3, lineHeight: 1 }}>Out</Typography>
          </Box>
        </Tooltip>
      </Box>

      {/* ── Main content ── */}
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {(!isOnline || syncing || pendingCount > 0) && (
          <Box sx={{
            display: "flex", alignItems: "center", gap: 1,
            px: 2, py: 0.6,
            backgroundColor: syncing ? "#1e3a5f" : "#7c3200",
            color: "#fff",
            fontSize: "0.75rem",
            fontWeight: 500,
            flexShrink: 0,
          }}>
            {syncing
              ? <SyncIcon sx={{ fontSize: 14 }} />
              : <WifiOffIcon sx={{ fontSize: 14 }} />}
            {syncing
              ? "Syncing changes..."
              : pendingCount > 0
                ? `Offline — ${pendingCount} change${pendingCount === 1 ? "" : "s"} pending`
                : "Offline"}
          </Box>
        )}

        <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
          {view === "board" && (
            <TaskBoard
              pendingNoteTask={pendingNoteTask}
              onClearPendingNoteTask={() => setPendingNoteTask(null)}
            />
          )}
          {view === "notes" && (
            <NotesView onCreateTask={handleCreateTaskFromNote} />
          )}
          {view === "journal" && <JournalView />}
          {view === "settings" && <SettingsView />}
        </Box>

        <Box sx={{
          display: { xs: "flex", sm: "none" },
          height: "60px",
          flexShrink: 0,
          backgroundColor: "#0f172a",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          alignItems: "center",
          justifyContent: "space-around",
          px: 0.5,
        }}>
          <NavItem icon={<DashboardIcon sx={{ fontSize: 22 }} />} label="Board" active={view === "board"} onClick={() => navigate("board")} />
          <NavItem icon={<NoteAltOutlinedIcon sx={{ fontSize: 22 }} />} label="Notes" active={view === "notes"} onClick={() => navigate("notes")} />
          <NavItem icon={<AutoStoriesOutlinedIcon sx={{ fontSize: 22 }} />} label="Journal" active={view === "journal"} onClick={() => navigate("journal")} />
          <NavItem icon={<SettingsOutlinedIcon sx={{ fontSize: 22 }} />} label="Settings" active={view === "settings"} onClick={() => navigate("settings")} />
        </Box>
      </Box>
    </Box>
  );
}

// ── AppShell: wraps everything in VaultProvider ───────────────────────────────

export default function AppShell() {
  return (
    <VaultProvider>
      <AppShellInner />
    </VaultProvider>
  );
}
