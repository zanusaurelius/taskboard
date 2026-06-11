"use client";
import { useEffect, useRef, useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import Dialog from "@mui/material/Dialog";
import Avatar from "@mui/material/Avatar";
import CircularProgress from "@mui/material/CircularProgress";
import DashboardIcon from "@mui/icons-material/Dashboard";
import NoteAltOutlinedIcon from "@mui/icons-material/NoteAltOutlined";
import AutoStoriesOutlinedIcon from "@mui/icons-material/AutoStoriesOutlined";
import PermMediaOutlinedIcon from "@mui/icons-material/PermMediaOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import LogoutIcon from "@mui/icons-material/Logout";
import WifiOffIcon from "@mui/icons-material/WifiOff";
import SyncIcon from "@mui/icons-material/Sync";
import LightModeIcon from "@mui/icons-material/LightMode";
import DarkModeIcon from "@mui/icons-material/DarkMode";
import SettingsBrightnessIcon from "@mui/icons-material/SettingsBrightness";
import TaskBoard from "./TaskBoard";
import NotesView from "./NotesView";
import JournalView from "./JournalView";
import FilesView from "./FilesView";
import SettingsView from "./SettingsView";
import VaultSetupModal from "./VaultSetupModal";
import VaultUnlockModal from "./VaultUnlockModal";
import E2EMigration from "./E2EMigration";
import E2EReversal from "./E2EReversal";
import GlobalSearch from "./GlobalSearch";
import { useReminders } from "@/lib/useReminders";
import { useOnlineSync } from "@/lib/useOnlineSync";
import { VaultProvider, useVault } from "@/lib/vault-context";
import { useTaskBoardStore } from "@/lib/store";
import { useAppTheme, type ThemeMode } from "@/lib/theme-context";

type View = "board" | "notes" | "journal" | "files" | "settings";
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
  const { masterKey, isUnlocked: vaultIsUnlocked, lockVault, hideVault } = useVault();
  const setMasterKey = useTaskBoardStore((s) => s.setMasterKey);
  const [view, setView] = useState<View>(() => {
    if (typeof window === "undefined") return "board";
    const saved = localStorage.getItem("currentView");
    return (saved === "board" || saved === "notes" || saved === "journal" || saved === "files" || saved === "settings") ? saved : "board";
  });
  useReminders();
  const { isOnline, pendingCount, syncing, syncError } = useOnlineSync();

  // Vault gate state
  const [vaultState, setVaultState] = useState<VaultState>("loading");
  const [hasWebAuthn, setHasWebAuthn] = useState(false);
  const [migrationDone, setMigrationDone] = useState(() =>
    typeof window !== "undefined" && !!localStorage.getItem("e2e_migration_v1")
  );
  // Initialize from localStorage so E2EReversal never mounts again after it's run once.
  const [reversalDone, setReversalDone] = useState(() =>
    typeof window !== "undefined" && !!localStorage.getItem("e2e_reversal_v2")
  );

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // Check db unlock state once on mount
  useEffect(() => {
    fetch("/api/auth/db-status")
      .then((r) => r.json())
      .then((d) => { if (d.state !== "unlocked") router.push("/unlock"); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check vault setup state on mount — just gather hasWebAuthn for Notes section use.
  useEffect(() => {
    fetch("/api/notes/vault")
      .then((r) => r.json())
      .then((d) => {
        if (d.exists) {
          try {
            const creds = JSON.parse(d.webAuthnCredentials ?? "[]");
            setHasWebAuthn(Array.isArray(creds) && creds.length > 0);
          } catch { /* ignore */ }
        }
        setVaultState("unlocked");
      })
      .catch(() => setVaultState("unlocked"));
  }, []);

  // Sync vault master key into the store (both when set and when cleared)
  const prevMasterKeyRef = useRef<Uint8Array | null>(null);
  useEffect(() => {
    const prev = prevMasterKeyRef.current;
    prevMasterKeyRef.current = masterKey;
    if (masterKey) {
      setMasterKey(masterKey);
      if (vaultState === "locked") setVaultState("unlocked");
    } else if (prev !== null) {
      // Vault just locked — redact locked tasks in the store
      setMasterKey(null);
    }
  }, [masterKey, setMasterKey, vaultState]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Keep a ref so the keyboard handler always sees the current view without re-registering
  const viewRef = useRef(view);
  useEffect(() => { viewRef.current = view; }, [view]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Cmd/Ctrl combos
      if (e.metaKey || e.ctrlKey) {
        if (e.key === "k") { e.preventDefault(); setSearchOpen(true); }
        return;
      }
      // Single-key shortcuts — ignore when typing in an input/textarea/editor
      const tag = (e.target as HTMLElement)?.tagName;
      const isEditable = (e.target as HTMLElement)?.isContentEditable;
      if (tag === "INPUT" || tag === "TEXTAREA" || isEditable) return;

      switch (e.key) {
        case "c": {
          // Context-aware create
          const v = viewRef.current;
          if (v === "board")   window.dispatchEvent(new CustomEvent("taskboard:newtask"));
          else if (v === "notes")   window.dispatchEvent(new CustomEvent("notes:newnote"));
          else if (v === "journal") window.dispatchEvent(new CustomEvent("journal:newentry"));
          break;
        }
        case "b": navigate("board"); break;
        case "n": navigate("notes"); break;
        case "j": navigate("journal"); break;
        case "f": navigate("files"); break;
        case "s": navigate("settings"); break;
        case "/": e.preventDefault(); setSearchOpen(true); break;
        case "?": setShortcutsOpen((v) => !v); break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Open global search via custom event
  useEffect(() => {
    const handler = () => setSearchOpen(true);
    window.addEventListener("globalsearch:open", handler);
    return () => window.removeEventListener("globalsearch:open", handler);
  }, []);

  const [pendingNoteTask, setPendingNoteTask] = useState<{ title: string; description: string } | null>(null);
  const navigate = (v: View) => {
    if (v !== view) {
      lockVault();
      hideVault();
    }
    setView(v);
    localStorage.setItem("currentView", v);
  };
  const handleCreateTaskFromNote = (title: string, description: string) => {
    setPendingNoteTask({ title, description });
    navigate("board");
  };

  const { mode: themeMode, setMode: setThemeMode } = useAppTheme();

  const themeIcon = themeMode === "dark" ? <DarkModeIcon sx={{ fontSize: 16 }} />
    : themeMode === "light" ? <LightModeIcon sx={{ fontSize: 16 }} />
    : <SettingsBrightnessIcon sx={{ fontSize: 16 }} />;
  const nextThemeMode: Record<ThemeMode, ThemeMode> = { light: "dark", dark: "system", system: "light" };
  const themeModeLabel: Record<ThemeMode, string> = { light: "Light", dark: "Dark", system: "Auto" };

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

  // Migration check — runs once after first unlock, before showing app
  if (!migrationDone) {
    return (
      <E2EMigration onComplete={() => { localStorage.setItem("e2e_migration_v1", "1"); setMigrationDone(true); }} />
    );
  }

  // ── Full app ────────────────────────────────────────────────────────────────

  return (
    <Box sx={{ display: "flex", height: "100vh", overflow: "hidden", backgroundColor: "var(--bg)" }}>
      {/* Silent background reversal — decrypts all non-vault data once after vault unlocks */}
      {!reversalDone && <E2EReversal onComplete={(didRun) => { setReversalDone(true); if (didRun) window.location.reload(); }} />}

      <GlobalSearch
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onNavigate={(view) => { navigate(view); setSearchOpen(false); }}
      />

      <KeyboardShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

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
        <NavItem icon={<PermMediaOutlinedIcon sx={{ fontSize: 22 }} />} label="Files" active={view === "files"} onClick={() => navigate("files")} />
        <NavItem icon={<SettingsOutlinedIcon sx={{ fontSize: 22 }} />} label="Settings" active={view === "settings"} onClick={() => navigate("settings")} />

        <Box sx={{ flex: 1 }} />

        <Tooltip title={`Theme: ${themeModeLabel[themeMode]} (click to change)`} placement="right" arrow>
          <Box
            onClick={() => setThemeMode(nextThemeMode[themeMode])}
            sx={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5,
              px: 1, py: 0.75, borderRadius: 2, cursor: "pointer", mb: 0.5,
              color: "rgba(255,255,255,0.45)",
              transition: "color 0.15s, background-color 0.15s",
              "&:hover": { color: "rgba(255,255,255,0.85)", backgroundColor: "rgba(255,255,255,0.07)" },
              userSelect: "none",
            }}
          >
            {themeIcon}
            <Typography sx={{ fontSize: "0.58rem", fontWeight: 600, letterSpacing: 0.3, lineHeight: 1 }}>
              {themeModeLabel[themeMode]}
            </Typography>
          </Box>
        </Tooltip>

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

        {(!isOnline || syncing || pendingCount > 0 || syncError) && (
          <Box sx={{
            display: "flex", alignItems: "center", gap: 1,
            px: 2, py: 0.6,
            backgroundColor: syncError ? "#7f1d1d" : syncing ? "#1e3a5f" : "#7c3200",
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
              : syncError
                ? `Sync failed — ${pendingCount} change${pendingCount === 1 ? "" : "s"} could not be saved`
                : pendingCount > 0
                  ? `Offline — ${pendingCount} change${pendingCount === 1 ? "" : "s"} pending`
                  : "Offline"}
          </Box>
        )}

        <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", pb: { xs: "60px", sm: 0 } }}>
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
          {view === "files" && <FilesView />}
          {view === "settings" && <SettingsView />}
        </Box>

        <Box sx={{
          display: { xs: "flex", sm: "none" },
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          height: "60px",
          zIndex: 100,
          backgroundColor: "#0f172a",
          borderTop: "1px solid rgba(255,255,255,0.08)",
          alignItems: "center",
          justifyContent: "space-around",
          px: 0.5,
        }}>
          <NavItem icon={<DashboardIcon sx={{ fontSize: 22 }} />} label="Board" active={view === "board"} onClick={() => navigate("board")} />
          <NavItem icon={<NoteAltOutlinedIcon sx={{ fontSize: 22 }} />} label="Notes" active={view === "notes"} onClick={() => navigate("notes")} />
          <NavItem icon={<AutoStoriesOutlinedIcon sx={{ fontSize: 22 }} />} label="Journal" active={view === "journal"} onClick={() => navigate("journal")} />
          <NavItem icon={<PermMediaOutlinedIcon sx={{ fontSize: 22 }} />} label="Files" active={view === "files"} onClick={() => navigate("files")} />
          <NavItem icon={<SettingsOutlinedIcon sx={{ fontSize: 22 }} />} label="Settings" active={view === "settings"} onClick={() => navigate("settings")} />
        </Box>
      </Box>
    </Box>
  );
}

// ── Keyboard shortcuts reference modal ───────────────────────────────────────

const SHORTCUTS = [
  { group: "Create", items: [
    { key: "C", description: "New task (on Board)" },
    { key: "C", description: "New note (on Notes)" },
    { key: "C", description: "New entry (on Journal)" },
  ]},
  { group: "Navigate", items: [
    { key: "B", description: "Go to Board" },
    { key: "N", description: "Go to Notes" },
    { key: "J", description: "Go to Journal" },
    { key: "F", description: "Go to Files" },
    { key: "S", description: "Go to Settings" },
  ]},
  { group: "Search", items: [
    { key: "/", description: "Search everything" },
    { key: "⌘K", description: "Search everything" },
  ]},
  { group: "Other", items: [
    { key: "?", description: "Toggle this reference" },
  ]},
];

function KeyboardShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth
      slotProps={{ paper: { sx: { backgroundColor: "#1e293b", borderRadius: 3, border: "1px solid #334155" } } }}>
      <Box sx={{ px: 3, py: 3 }}>
        <Typography sx={{ fontWeight: 700, fontSize: "0.95rem", color: "#f1f5f9", mb: 2.5 }}>
          Keyboard Shortcuts
        </Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {SHORTCUTS.map(({ group, items }) => (
            <Box key={group}>
              <Typography sx={{ fontSize: "0.65rem", fontWeight: 800, color: "#475569", textTransform: "uppercase", letterSpacing: 1, mb: 0.75 }}>
                {group}
              </Typography>
              {items.map(({ key, description }, i) => (
                <Box key={i} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", py: 0.6 }}>
                  <Typography sx={{ fontSize: "0.875rem", color: "#94a3b8" }}>{description}</Typography>
                  <Box sx={{
                    px: 1.25, py: 0.35, ml: 2, flexShrink: 0,
                    backgroundColor: "#0f172a", border: "1px solid #475569",
                    borderRadius: 1, fontFamily: "monospace",
                    fontSize: "0.8rem", fontWeight: 600, color: "#e2e8f0",
                    letterSpacing: 0.3,
                  }}>
                    {key}
                  </Box>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
        <Typography sx={{ fontSize: "0.72rem", color: "#475569", mt: 2.5, lineHeight: 1.5 }}>
          Single-key shortcuts only fire when you&apos;re not typing in a field.
        </Typography>
      </Box>
    </Dialog>
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
