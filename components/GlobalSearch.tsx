"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Dialog from "@mui/material/Dialog";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import CircularProgress from "@mui/material/CircularProgress";
import InputAdornment from "@mui/material/InputAdornment";
import SearchIcon from "@mui/icons-material/Search";
import { useVault } from "@/lib/vault-context";
import type { Task, Note, UploadFile } from "@/lib/types";

interface DailyReflection {
  id: string;
  date: string;
  note: string | null;
  encNote: string | null;
  gratitude: string | null;
  encGratitude: string | null;
  body: string | null;
  encBody: string | null;
}

interface GlobalSearchProps {
  open: boolean;
  onClose: () => void;
  onNavigate: (view: "board" | "notes" | "journal" | "files") => void;
}

interface SearchResults {
  tasks: Task[];
  notes: Note[];
  journal: DailyReflection[];
  files: UploadFile[];
}

function snippet(text: string | null | undefined, query: string, maxLen = 100): string {
  if (!text) return "";
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, maxLen);
  const start = Math.max(0, idx - 30);
  const end = Math.min(text.length, idx + query.length + 60);
  return (start > 0 ? "…" : "") + text.slice(start, end) + (end < text.length ? "…" : "");
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export default function GlobalSearch({ open, onClose, onNavigate }: GlobalSearchProps) {
  const { decrypt } = useVault();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResults | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchGenRef = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state when dialog closes
  useEffect(() => {
    if (!open) {
      searchGenRef.current++;
      setQuery("");
      setResults(null);
      setLoading(false);
    }
  }, [open]);

  const runSearch = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    // Generation counter: if a newer search starts before this one finishes, discard results.
    const gen = ++searchGenRef.current;
    setLoading(true);
    try {
      const [tasksRes, notesRes, journalRes, filesRes] = await Promise.all([
        fetch("/api/tasks").catch(() => null),
        fetch("/api/notes").catch(() => null),
        fetch("/api/daily-reflections").catch(() => null),
        fetch("/api/files?all=true").catch(() => null),
      ]);

      const [rawTasks, rawNotes, rawJournal, rawFiles] = await Promise.all([
        tasksRes?.ok ? tasksRes.json() : [],
        notesRes?.ok ? notesRes.json() : [],
        journalRes?.ok ? journalRes.json() : [],
        filesRes?.ok ? filesRes.json() : [],
      ]);

      if (gen !== searchGenRef.current) return; // superseded by a newer search

      const lower = q.toLowerCase();

      // Decrypt and filter tasks
      const tasks: Task[] = [];
      for (const t of rawTasks as Task[]) {
        let title = t.title;
        if (t.encTitle) {
          try { title = (await decrypt(JSON.parse(t.encTitle))) ?? t.title; } catch { /* ignore */ }
        }
        let desc = stripHtml(t.description);
        if (t.encDescription) {
          try { desc = stripHtml((await decrypt(JSON.parse(t.encDescription))) ?? desc); } catch { /* ignore */ }
        }
        if (title.toLowerCase().includes(lower) || desc.toLowerCase().includes(lower)) {
          tasks.push({ ...t, title, description: desc });
        }
      }

      // Decrypt and filter notes (skip trashed)
      const notes: Note[] = [];
      for (const n of rawNotes as Note[]) {
        if (n.deletedAt) continue;
        let title = n.title;
        if (n.encTitle) {
          try { title = (await decrypt(JSON.parse(n.encTitle))) ?? n.title; } catch { /* ignore */ }
        }
        let content = stripHtml(n.content);
        if (n.encContent) {
          try { content = stripHtml((await decrypt(JSON.parse(n.encContent))) ?? n.content); } catch { /* ignore */ }
        }
        if (title.toLowerCase().includes(lower) || content.toLowerCase().includes(lower)) {
          notes.push({ ...n, title, content });
        }
      }

      // Decrypt and filter journal entries
      const journal: DailyReflection[] = [];
      for (const e of rawJournal as DailyReflection[]) {
        let note = e.note ?? "";
        if (e.encNote) {
          try { note = (await decrypt(JSON.parse(e.encNote))) ?? note; } catch { /* ignore */ }
        }
        let gratitude = e.gratitude ?? "";
        if (e.encGratitude) {
          try { gratitude = (await decrypt(JSON.parse(e.encGratitude))) ?? gratitude; } catch { /* ignore */ }
        }
        let body = e.body ?? "";
        if (e.encBody) {
          try { body = (await decrypt(JSON.parse(e.encBody))) ?? body; } catch { /* ignore */ }
        }
        if (
          note.toLowerCase().includes(lower) ||
          gratitude.toLowerCase().includes(lower) ||
          body.toLowerCase().includes(lower)
        ) {
          journal.push({ ...e, note, gratitude, body });
        }
      }

      // Filter files by original name
      const files: UploadFile[] = (rawFiles as UploadFile[]).filter((f) =>
        f.originalName.toLowerCase().includes(lower)
      );

      if (gen !== searchGenRef.current) return; // superseded while decrypting
      setResults({ tasks, notes, journal, files });
    } catch {
      if (gen === searchGenRef.current) setResults({ tasks: [], notes: [], journal: [], files: [] });
    } finally {
      if (gen === searchGenRef.current) setLoading(false);
    }
  }, [decrypt]);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => runSearch(value), 300);
  }, [runSearch]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    }
  };

  const totalResults = results ? results.tasks.length + results.notes.length + results.journal.length + results.files.length : 0;
  const hasQuery = query.length >= 2;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            backgroundColor: "#1e293b",
            borderRadius: "12px",
            boxShadow: "0 25px 50px rgba(0,0,0,0.4)",
            overflow: "hidden",
          },
        },
        backdrop: {
          sx: { backgroundColor: "rgba(0,0,0,0.6)" },
        },
      }}
    >
      {/* Search input */}
      <Box sx={{ px: 2, pt: 2, pb: 1 }}>
        <TextField
          inputRef={inputRef}
          autoFocus
          fullWidth
          size="small"
          placeholder="Search tasks, notes, journal, files…"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  {loading
                    ? <CircularProgress size={16} sx={{ color: "#6366f1" }} />
                    : <SearchIcon sx={{ color: "rgba(255,255,255,0.35)", fontSize: 20 }} />}
                </InputAdornment>
              ),
            },
          }}
          sx={{
            "& .MuiOutlinedInput-root": {
              backgroundColor: "rgba(255,255,255,0.06)",
              color: "#f1f5f9",
              borderRadius: 2,
              "& fieldset": { border: "1px solid rgba(255,255,255,0.1)" },
              "&:hover fieldset": { border: "1px solid rgba(99,102,241,0.4)" },
              "&.Mui-focused fieldset": { border: "1px solid rgba(99,102,241,0.7)" },
            },
            "& input::placeholder": { color: "rgba(255,255,255,0.3)", opacity: 1 },
          }}
        />
      </Box>

      {/* Body */}
      <Box sx={{ px: 1, pb: 2, maxHeight: 420, overflowY: "auto" }}>
        {/* Empty state — no query yet */}
        {!hasQuery && (
          <Box sx={{ textAlign: "center", py: 4, px: 2 }}>
            <Typography sx={{ color: "rgba(255,255,255,0.3)", fontSize: "0.85rem" }}>
              Search tasks, notes, journal, and files
            </Typography>
          </Box>
        )}

        {/* No results */}
        {hasQuery && !loading && results && totalResults === 0 && (
          <Box sx={{ textAlign: "center", py: 4, px: 2 }}>
            <Typography sx={{ color: "rgba(255,255,255,0.3)", fontSize: "0.85rem" }}>
              No results for &ldquo;{query}&rdquo;
            </Typography>
          </Box>
        )}

        {/* Results */}
        {results && totalResults > 0 && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5, mt: 0.5 }}>
            {/* Tasks section */}
            {results.tasks.length > 0 && (
              <Box>
                <Typography sx={{
                  fontSize: "0.65rem", fontWeight: 700, letterSpacing: 1,
                  color: "rgba(255,255,255,0.3)", textTransform: "uppercase",
                  px: 2, py: 0.75,
                }}>
                  Tasks
                </Typography>
                {results.tasks.map((task) => (
                  <ResultRow
                    key={task.id}
                    title={task.title}
                    meta={task.stage.replace("_", " ")}
                    snippetText={snippet(task.description, query)}
                    onClick={() => { onNavigate("board"); onClose(); }}
                  />
                ))}
              </Box>
            )}

            {/* Notes section */}
            {results.notes.length > 0 && (
              <Box>
                <Typography sx={{
                  fontSize: "0.65rem", fontWeight: 700, letterSpacing: 1,
                  color: "rgba(255,255,255,0.3)", textTransform: "uppercase",
                  px: 2, py: 0.75,
                }}>
                  Notes
                </Typography>
                {results.notes.map((note) => (
                  <ResultRow
                    key={note.id}
                    title={note.title || "Untitled"}
                    meta={formatDate(note.updatedAt)}
                    snippetText={snippet(note.content, query)}
                    onClick={() => { onNavigate("notes"); onClose(); }}
                  />
                ))}
              </Box>
            )}

            {/* Journal section */}
            {results.journal.length > 0 && (
              <Box>
                <Typography sx={{
                  fontSize: "0.65rem", fontWeight: 700, letterSpacing: 1,
                  color: "rgba(255,255,255,0.3)", textTransform: "uppercase",
                  px: 2, py: 0.75,
                }}>
                  Journal
                </Typography>
                {results.journal.map((entry) => {
                  const combinedText = [entry.note, entry.gratitude, entry.body].filter(Boolean).join(" ");
                  return (
                    <ResultRow
                      key={entry.id}
                      title={formatDate(entry.date)}
                      meta={entry.date}
                      snippetText={snippet(combinedText, query)}
                      onClick={() => { onNavigate("journal"); onClose(); }}
                    />
                  );
                })}
              </Box>
            )}

            {/* Files section */}
            {results.files.length > 0 && (
              <Box>
                <Typography sx={{
                  fontSize: "0.65rem", fontWeight: 700, letterSpacing: 1,
                  color: "rgba(255,255,255,0.3)", textTransform: "uppercase",
                  px: 2, py: 0.75,
                }}>
                  Files
                </Typography>
                {results.files.map((file) => (
                  <ResultRow
                    key={file.id}
                    title={file.originalName}
                    meta={file.mimeType.split("/")[1]?.toUpperCase() ?? "FILE"}
                    snippetText={file.fileFolderId ? "In a folder" : ""}
                    onClick={() => {
                      if (file.fileFolderId) {
                        window.dispatchEvent(new CustomEvent("files:openFolder", { detail: { folderId: file.fileFolderId } }));
                      }
                      onNavigate("files");
                      onClose();
                    }}
                  />
                ))}
              </Box>
            )}
          </Box>
        )}
      </Box>
    </Dialog>
  );
}

interface ResultRowProps {
  title: string;
  meta: string;
  snippetText: string;
  onClick: () => void;
}

function ResultRow({ title, meta, snippetText, onClick }: ResultRowProps) {
  return (
    <Box
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}
      tabIndex={0}
      role="button"
      sx={{
        borderRadius: 1.5,
        px: 2,
        py: 1.25,
        cursor: "pointer",
        "&:hover": { backgroundColor: "rgba(99,102,241,0.1)" },
        "&:focus-visible": { outline: "2px solid rgba(99,102,241,0.6)", outlineOffset: "-2px" },
        transition: "background-color 0.1s",
      }}
    >
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1 }}>
        <Typography sx={{ fontSize: "0.875rem", fontWeight: 600, color: "#f1f5f9", lineHeight: 1.4 }}>
          {title}
        </Typography>
        <Typography sx={{ fontSize: "0.7rem", color: "rgba(255,255,255,0.35)", flexShrink: 0 }}>
          {meta}
        </Typography>
      </Box>
      {snippetText && (
        <Typography sx={{ fontSize: "0.78rem", color: "rgba(255,255,255,0.45)", mt: 0.25, lineHeight: 1.4 }}>
          {snippetText}
        </Typography>
      )}
    </Box>
  );
}
