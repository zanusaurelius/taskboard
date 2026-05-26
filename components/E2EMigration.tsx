"use client";
import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import LinearProgress from "@mui/material/LinearProgress";
import CircularProgress from "@mui/material/CircularProgress";
import { useVault } from "@/lib/vault-context";

interface Props {
  onComplete: () => void;
}

interface MigrationResult {
  total: number;
  migrated: number;
  errors: number;
}

async function encField(
  text: string,
  encrypt: (p: string) => Promise<unknown>
): Promise<string | null> {
  const blob = await encrypt(text);
  if (!blob) return null;
  return JSON.stringify(blob);
}

export default function E2EMigration({ onComplete }: Props) {
  const vault = useVault();
  const ran = useRef(false);
  const [phase, setPhase] = useState("Checking for unencrypted data…");
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    runMigration();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runMigration() {
    if (!vault.masterKey) {
      onComplete();
      return;
    }

    const enc = (text: string) => vault.encrypt(text);

    const result: MigrationResult = { total: 0, migrated: 0, errors: 0 };

    // ── collect all migrations ─────────────────────────────────────────────────

    type MigJob = () => Promise<void>;
    const jobs: MigJob[] = [];

    // Tasks
    try {
      const res = await fetch("/api/tasks?includeArchived=true");
      if (res.ok) {
        const tasks = await res.json();
        for (const t of tasks) {
          if (t.encTitle || (!t.title?.trim() && !t.description?.trim())) continue;
          jobs.push(async () => {
            const body: Record<string, unknown> = {};
            if (t.title?.trim()) {
              const encTitle = await encField(t.title, enc);
              if (encTitle) { body.encTitle = encTitle; body.title = ""; }
            }
            if (t.description?.trim()) {
              const encDescription = await encField(t.description, enc);
              if (encDescription) { body.encDescription = encDescription; body.description = ""; }
            }
            if (Object.keys(body).length) {
              await fetch(`/api/tasks/${t.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              });
            }
          });
        }
      }
    } catch { /* ignore */ }

    // Projects
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const projects = await res.json();
        for (const p of projects) {
          if (p.encName || !p.name?.trim()) continue;
          jobs.push(async () => {
            const encName = await encField(p.name, enc);
            if (!encName) return;
            await fetch(`/api/projects/${p.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ encName, name: "" }),
            });
          });
        }
      }
    } catch { /* ignore */ }

    // Folders
    try {
      const res = await fetch("/api/folders");
      if (res.ok) {
        const folders = await res.json();
        for (const f of folders) {
          if (f.encName || !f.name?.trim()) continue;
          jobs.push(async () => {
            const encName = await encField(f.name, enc);
            if (!encName) return;
            await fetch(`/api/folders/${f.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ encName, name: "" }),
            });
          });
        }
      }
    } catch { /* ignore */ }

    // Notes
    try {
      const res = await fetch("/api/notes");
      if (res.ok) {
        const notes = await res.json();
        for (const n of notes) {
          if (n.encTitle || (!n.title?.trim() && !n.content?.trim())) continue;
          jobs.push(async () => {
            const body: Record<string, unknown> = {};
            if (n.title?.trim()) {
              const encTitle = await encField(n.title, enc);
              if (encTitle) { body.encTitle = encTitle; body.title = ""; }
            }
            if (n.content?.trim()) {
              const encContent = await encField(n.content, enc);
              if (encContent) { body.encContent = encContent; body.content = ""; }
            }
            if (Object.keys(body).length) {
              await fetch(`/api/notes/${n.id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              });
            }
          });
        }
      }
    } catch { /* ignore */ }

    // Daily goals (all dates)
    try {
      const res = await fetch("/api/daily-goals?all=true");
      if (res.ok) {
        const goals = await res.json();
        for (const g of goals) {
          if (g.encText || !g.text?.trim()) continue;
          jobs.push(async () => {
            const encText = await encField(g.text, enc);
            if (!encText) return;
            await fetch(`/api/daily-goals/${g.id}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ encText, text: "" }),
            });
          });
        }
      }
    } catch { /* ignore */ }

    // Habits
    try {
      const res = await fetch("/api/habits");
      if (res.ok) {
        const habits = await res.json();
        for (const h of habits) {
          if (h.encText || !h.text?.trim()) continue;
          jobs.push(async () => {
            const encText = await encField(h.text, enc);
            if (!encText) return;
            await fetch(`/api/habits/${h.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ encText, text: "" }),
            });
          });
        }
      }
    } catch { /* ignore */ }

    // Daily reflections
    try {
      const res = await fetch("/api/daily-reflections");
      if (res.ok) {
        const reflections = await res.json();
        for (const r of reflections) {
          if (r.encNote || r.encGratitude || r.encBody) continue;
          if (!r.note?.trim() && !r.gratitude?.trim() && !r.body?.trim()) continue;
          jobs.push(async () => {
            const body: Record<string, unknown> = { date: r.date };
            if (r.note?.trim()) {
              const encNote = await encField(r.note, enc);
              if (encNote) { body.encNote = encNote; body.note = ""; }
            }
            if (r.gratitude?.trim()) {
              const encGratitude = await encField(r.gratitude, enc);
              if (encGratitude) { body.encGratitude = encGratitude; body.gratitude = ""; }
            }
            if (r.body?.trim()) {
              const encBody = await encField(r.body, enc);
              if (encBody) { body.encBody = encBody; body.body = ""; }
            }
            if (Object.keys(body).length > 1) {
              await fetch("/api/daily-reflections", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
              });
            }
          });
        }
      }
    } catch { /* ignore */ }

    result.total = jobs.length;

    if (result.total === 0) {
      onComplete();
      return;
    }

    setPhase(`Encrypting ${result.total} item${result.total === 1 ? "" : "s"}…`);

    // ── run jobs sequentially with progress ───────────────────────────────────

    for (let i = 0; i < jobs.length; i++) {
      try {
        await jobs[i]();
        result.migrated++;
      } catch {
        result.errors++;
      }
      setProgress(Math.round(((i + 1) / jobs.length) * 100));
    }

    setPhase(
      result.errors > 0
        ? `Encrypted ${result.migrated} item${result.migrated === 1 ? "" : "s"} (${result.errors} failed — will retry next login)`
        : `Encrypted ${result.migrated} item${result.migrated === 1 ? "" : "s"} successfully`
    );
    setDone(true);

    setTimeout(() => onComplete(), 1200);
  }

  return (
    <Box sx={{
      display: "flex", alignItems: "center", justifyContent: "center",
      height: "100vh", backgroundColor: "#0f172a",
    }}>
      <Box sx={{
        backgroundColor: "#1e293b",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 3,
        p: 4,
        width: 360,
        display: "flex",
        flexDirection: "column",
        gap: 2.5,
        alignItems: "center",
      }}>
        {done
          ? <Box sx={{ width: 40, height: 40, borderRadius: "50%", backgroundColor: "rgba(34,197,94,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Typography sx={{ color: "#22c55e", fontSize: "1.25rem" }}>✓</Typography>
            </Box>
          : <CircularProgress size={40} thickness={3} sx={{ color: "#6366f1" }} />
        }
        <Typography sx={{ color: "#f1f5f9", fontWeight: 700, fontSize: "1rem", textAlign: "center" }}>
          Securing your data
        </Typography>
        <Typography sx={{ color: "#94a3b8", fontSize: "0.82rem", textAlign: "center", lineHeight: 1.6 }}>
          {phase}
        </Typography>
        {progress > 0 && (
          <Box sx={{ width: "100%" }}>
            <LinearProgress
              variant="determinate"
              value={progress}
              sx={{
                borderRadius: 1,
                height: 6,
                backgroundColor: "rgba(255,255,255,0.08)",
                "& .MuiLinearProgress-bar": { backgroundColor: "#6366f1", borderRadius: 1 },
              }}
            />
            <Typography sx={{ color: "#64748b", fontSize: "0.72rem", mt: 0.75, textAlign: "right" }}>
              {progress}%
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
