"use client";
import { useState } from "react";
import { signOut, useSession } from "next-auth/react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import Avatar from "@mui/material/Avatar";
import DashboardIcon from "@mui/icons-material/Dashboard";
import NoteAltOutlinedIcon from "@mui/icons-material/NoteAltOutlined";
import SettingsOutlinedIcon from "@mui/icons-material/SettingsOutlined";
import LogoutIcon from "@mui/icons-material/Logout";
import TaskBoard from "./TaskBoard";
import NotesView from "./NotesView";
import SettingsView from "./SettingsView";

type View = "board" | "notes" | "settings";

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

export default function AppShell() {
  const { data: session } = useSession();
  const [view, setView] = useState<View>("board");
  const [pendingNoteTask, setPendingNoteTask] = useState<{ title: string; description: string } | null>(null);

  const handleCreateTaskFromNote = (title: string, description: string) => {
    setPendingNoteTask({ title, description });
    setView("board");
  };

  const username = session?.user?.name ?? "";
  const initials = username.slice(0, 2).toUpperCase() || "?";

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", backgroundColor: "#f1f5f9" }}>

      {/* ── Sidebar ── */}
      <Box sx={{
        width: 68,
        flexShrink: 0,
        backgroundColor: "#0f172a",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        py: 2,
        gap: 0.5,
        borderRight: "1px solid rgba(255,255,255,0.06)",
      }}>
        {/* Logo */}
        <Box sx={{
          width: 36, height: 36, borderRadius: 2,
          background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 2px 12px rgba(99,102,241,0.5)",
          mb: 2, flexShrink: 0,
        }}>
          <Typography sx={{ color: "#fff", fontSize: "1.1rem", fontWeight: 900, lineHeight: 1 }}>T</Typography>
        </Box>

        <NavItem icon={<DashboardIcon sx={{ fontSize: 22 }} />} label="Board" active={view === "board"} onClick={() => setView("board")} />
        <NavItem icon={<NoteAltOutlinedIcon sx={{ fontSize: 22 }} />} label="Notes" active={view === "notes"} onClick={() => setView("notes")} />
        <NavItem icon={<SettingsOutlinedIcon sx={{ fontSize: 22 }} />} label="Settings" active={view === "settings"} onClick={() => setView("settings")} />

        {/* Spacer */}
        <Box sx={{ flex: 1 }} />

        {/* User avatar */}
        {session?.user && (
          <Tooltip title={username} placement="right" arrow>
            <Avatar sx={{ width: 32, height: 32, fontSize: "0.75rem", fontWeight: 700, bgcolor: "#334155", color: "#94a3b8", mb: 0.5, cursor: "default" }}>
              {initials}
            </Avatar>
          </Tooltip>
        )}

        {/* Sign out */}
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
        {view === "board" && (
          <TaskBoard
            pendingNoteTask={pendingNoteTask}
            onClearPendingNoteTask={() => setPendingNoteTask(null)}
          />
        )}
        {view === "notes" && (
          <NotesView onCreateTask={handleCreateTaskFromNote} />
        )}
        {view === "settings" && <SettingsView />}
      </Box>
    </Box>
  );
}
