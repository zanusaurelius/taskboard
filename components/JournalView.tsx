"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import InputBase from "@mui/material/InputBase";
import CircularProgress from "@mui/material/CircularProgress";
import useMediaQuery from "@mui/material/useMediaQuery";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import SearchIcon from "@mui/icons-material/Search";
import AutoStoriesOutlinedIcon from "@mui/icons-material/AutoStoriesOutlined";
import { useVault } from "@/lib/vault-context";

interface Reflection {
  id: string;
  date: string;
  note: string | null;
  encNote: string | null;
  gratitude: string | null;
  encGratitude: string | null;
  body: string | null;
  encBody: string | null;
}

const localDateStr = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayStr = () => localDateStr(new Date());

const formatDayFull = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

const formatDayShort = (iso: string) =>
  new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });

const monthKey = (iso: string) => iso.slice(0, 7);
const monthLabel = (key: string) =>
  new Date(key + "-01T12:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });

function entryMatchesSearch(e: Reflection, q: string): boolean {
  const lq = q.toLowerCase();
  return (
    (e.note ?? "").toLowerCase().includes(lq) ||
    (e.gratitude ?? "").toLowerCase().includes(lq) ||
    (e.body ?? "").toLowerCase().includes(lq)
  );
}

const inputFieldSx = {
  "& .MuiOutlinedInput-root": {
    borderRadius: 2, fontSize: "0.9rem", backgroundColor: "#f8fafc",
    "& fieldset": { borderColor: "#e2e8f0" },
    "&:hover fieldset": { borderColor: "#cbd5e1" },
    "&.Mui-focused fieldset": { borderColor: "#6366f1", borderWidth: 1.5 },
  },
  "& textarea": { lineHeight: 1.6 },
};

const labelSx = {
  fontSize: "0.68rem", fontWeight: 800, color: "#94a3b8",
  textTransform: "uppercase" as const, letterSpacing: 1.1, mb: 0.75,
};

const viewAllSx = {
  fontSize: "0.7rem", fontWeight: 600, color: "#818cf8",
  cursor: "pointer", ml: 1, userSelect: "none" as const,
  "&:hover": { color: "#6366f1", textDecoration: "underline" },
};

export default function JournalView() {
  const vault = useVault();
  const isMobile = useMediaQuery("(max-width: 599px)");
  const [mobilePanel, setMobilePanel] = useState<"list" | "detail">("list");

  const [today] = useState(todayStr);
  const [entries, setEntries] = useState<Reflection[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [search, setSearch] = useState("");

  // Editing state for the selected entry
  const [editNote, setEditNote] = useState("");
  const [editGratitude, setEditGratitude] = useState("");
  const [editBody, setEditBody] = useState("");
  const [saved, setSaved] = useState(false);
  const [focusField, setFocusField] = useState<"note" | "gratitude" | "body" | null>(null);

  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gratTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks which date's data is currently loaded into the edit fields.
  // Lets us skip the reset when `entries` changes due to an autosave (selectedDate didn't change).
  const lastLoadedDateRef = useRef<string>("");

  const fetchEntries = useCallback(async () => {
    const res = await fetch("/api/daily-reflections");
    if (res.ok) {
      const raw: Reflection[] = await res.json();
      const data = await Promise.all(raw.map(async (e) => ({
        ...e,
        note: e.encNote ? (await vault.decrypt(JSON.parse(e.encNote)) ?? e.note) : e.note,
        gratitude: e.encGratitude ? (await vault.decrypt(JSON.parse(e.encGratitude)) ?? e.gratitude) : e.gratitude,
        body: e.encBody ? (await vault.decrypt(JSON.parse(e.encBody)) ?? e.body) : e.body,
      })));
      setEntries(data);
      // Seed editing state for today
      const todayEntry = data.find((e) => e.date === today);
      setEditNote(todayEntry?.note ?? "");
      setEditGratitude(todayEntry?.gratitude ?? "");
      setEditBody(todayEntry?.body ?? "");
    }
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, vault.decrypt, vault.masterKey]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  // C shortcut → jump to today's entry
  useEffect(() => {
    const handler = () => { setSelectedDate(today); setMobilePanel("detail"); };
    window.addEventListener("journal:newentry", handler);
    return () => window.removeEventListener("journal:newentry", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today]);

  // Load editing fields when the selected date changes.
  // `entries` is included so this re-runs on initial data load, but the ref
  // guard prevents saves (which also update `entries`) from clobbering in-flight typing.
  useEffect(() => {
    if (lastLoadedDateRef.current === selectedDate) return;
    lastLoadedDateRef.current = selectedDate;
    const entry = entries.find((e) => e.date === selectedDate);
    setEditNote(entry?.note ?? "");
    setEditGratitude(entry?.gratitude ?? "");
    setEditBody(entry?.body ?? "");
  }, [selectedDate, entries]);

  const flashSaved = useCallback(() => {
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2000);
  }, []);

  const save = useCallback(async (note: string, gratitude: string, body: string) => {
    const rawEncNote = note.trim() ? await vault.encrypt(note) : null;
    const rawEncGratitude = gratitude.trim() ? await vault.encrypt(gratitude) : null;
    const rawEncBody = body.trim() ? await vault.encrypt(body) : null;
    // If vault is active but encryption returned null (vault locked mid-edit), abort rather
    // than saving plaintext and silently de-encrypting the entry on the server.
    if (vault.masterKey) {
      if (note.trim() && !rawEncNote) return;
      if (gratitude.trim() && !rawEncGratitude) return;
      if (body.trim() && !rawEncBody) return;
    }
    const encNote = rawEncNote ? JSON.stringify(rawEncNote) : null;
    const encGratitude = rawEncGratitude ? JSON.stringify(rawEncGratitude) : null;
    const encBody = rawEncBody ? JSON.stringify(rawEncBody) : null;
    await fetch("/api/daily-reflections", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date: selectedDate,
        note: encNote ? "" : note,
        gratitude: encGratitude ? "" : gratitude,
        body: encBody ? "" : body,
        encNote,
        encGratitude,
        encBody,
      }),
    });
    flashSaved();
    setEntries((prev) => {
      const exists = prev.find((e) => e.date === selectedDate);
      const payload: Reflection = {
        id: exists?.id ?? "",
        date: selectedDate,
        note: note.trim() || null,
        encNote: encNote ?? null,
        gratitude: gratitude.trim() || null,
        encGratitude: encGratitude ?? null,
        body: body.trim() || null,
        encBody: encBody ?? null,
      };
      if (!note.trim() && !gratitude.trim() && !body.trim()) {
        return prev.filter((e) => e.date !== selectedDate);
      }
      if (exists) return prev.map((e) => e.date === selectedDate ? { ...e, ...payload } : e);
      return [payload, ...prev].sort((a, b) => b.date.localeCompare(a.date));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, flashSaved, vault.encrypt, vault.masterKey]);

  const handleNote = (v: string) => {
    setEditNote(v);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => save(v, editGratitude, editBody), 800);
  };
  const handleNoteBlur = () => { if (noteTimer.current) clearTimeout(noteTimer.current); save(editNote, editGratitude, editBody); };

  const handleGrat = (v: string) => {
    setEditGratitude(v);
    if (gratTimer.current) clearTimeout(gratTimer.current);
    gratTimer.current = setTimeout(() => save(editNote, v, editBody), 800);
  };
  const handleGratBlur = () => { if (gratTimer.current) clearTimeout(gratTimer.current); save(editNote, editGratitude, editBody); };

  const handleBody = (v: string) => {
    setEditBody(v);
    if (bodyTimer.current) clearTimeout(bodyTimer.current);
    bodyTimer.current = setTimeout(() => save(editNote, editGratitude, v), 800);
  };
  const handleBodyBlur = () => { if (bodyTimer.current) clearTimeout(bodyTimer.current); save(editNote, editGratitude, editBody); };

  // Build left panel list
  const filtered = search.trim()
    ? entries.filter((e) => entryMatchesSearch(e, search.trim()))
    : entries;

  // Group past entries by month (exclude today if not in search mode)
  const pastEntries = filtered.filter((e) => e.date !== today);
  const grouped: Record<string, Reflection[]> = {};
  for (const e of pastEntries) {
    const k = monthKey(e.date);
    if (!grouped[k]) grouped[k] = [];
    grouped[k].push(e);
  }
  const months = Object.keys(grouped).sort((a, b) => b.localeCompare(a));
  const showTodayInList = !search.trim() || filtered.some((e) => e.date === today);

  const isToday = selectedDate === today;

  return (
    <Box sx={{ display: "flex", height: "100%", overflow: "hidden" }}>

      {/* ── Left panel ── */}
      <Box sx={{
        width: { xs: "100%", sm: 260 }, flexShrink: 0,
        borderRight: "1px solid #e2e8f0",
        display: isMobile && mobilePanel === "detail" ? "none" : "flex",
        flexDirection: "column",
        backgroundColor: "#f8fafc",
      }}>
        {/* Search */}
        <Box sx={{ px: 1.5, pt: 1.5, pb: 1 }}>
          <Box sx={{
            display: "flex", alignItems: "center", gap: 1,
            backgroundColor: "#fff", borderRadius: 2,
            border: "1px solid #e2e8f0", px: 1.25, py: 0.6,
          }}>
            <SearchIcon sx={{ fontSize: 16, color: "#94a3b8", flexShrink: 0 }} />
            <InputBase
              placeholder="Search journal…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ fontSize: "0.82rem", flex: 1, color: "#334155" }}
            />
          </Box>
        </Box>

        {/* Entry list */}
        <Box sx={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", pt: 4 }}>
              <CircularProgress size={22} sx={{ color: "#6366f1" }} />
            </Box>
          ) : (
            <>
              {/* Today */}
              {showTodayInList && (
                <Box
                  onClick={() => { setSelectedDate(today); if (isMobile) setMobilePanel("detail"); }}
                  sx={{
                    px: 2, py: 1.25, cursor: "pointer",
                    backgroundColor: selectedDate === today ? "rgba(99,102,241,0.08)" : "transparent",
                    borderLeft: selectedDate === today ? "3px solid #6366f1" : "3px solid transparent",
                    "&:hover": { backgroundColor: selectedDate === today ? "rgba(99,102,241,0.08)" : "rgba(0,0,0,0.03)" },
                  }}
                >
                  <Typography sx={{ fontSize: "0.82rem", fontWeight: 700, color: selectedDate === today ? "#6366f1" : "#1e293b" }}>
                    Today
                  </Typography>
                  <Typography sx={{ fontSize: "0.72rem", color: "#94a3b8", mt: 0.1 }}>
                    {formatDayShort(today)}
                  </Typography>
                </Box>
              )}

              {/* Past entries grouped by month */}
              {months.map((month) => (
                <Box key={month}>
                  <Typography sx={{
                    fontSize: "0.65rem", fontWeight: 800, color: "#94a3b8",
                    textTransform: "uppercase", letterSpacing: 1,
                    px: 2, pt: 1.5, pb: 0.5,
                  }}>
                    {monthLabel(month)}
                  </Typography>
                  {grouped[month].map((entry) => (
                    <Box
                      key={entry.date}
                      onClick={() => { setSelectedDate(entry.date); if (isMobile) setMobilePanel("detail"); }}
                      sx={{
                        px: 2, py: 1, cursor: "pointer",
                        backgroundColor: selectedDate === entry.date ? "rgba(99,102,241,0.08)" : "transparent",
                        borderLeft: selectedDate === entry.date ? "3px solid #6366f1" : "3px solid transparent",
                        "&:hover": { backgroundColor: selectedDate === entry.date ? "rgba(99,102,241,0.08)" : "rgba(0,0,0,0.03)" },
                      }}
                    >
                      <Typography sx={{ fontSize: "0.82rem", fontWeight: 600, color: selectedDate === entry.date ? "#6366f1" : "#334155" }}>
                        {formatDayShort(entry.date)}
                      </Typography>
                      {(entry.note || entry.gratitude || entry.body) && (
                        <Typography sx={{
                          fontSize: "0.72rem", color: "#94a3b8", mt: 0.1,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>
                          {entry.body ?? entry.note ?? entry.gratitude}
                        </Typography>
                      )}
                    </Box>
                  ))}
                </Box>
              ))}

              {!loading && months.length === 0 && !showTodayInList && (
                <Typography sx={{ fontSize: "0.82rem", color: "#94a3b8", px: 2, pt: 3, textAlign: "center" }}>
                  No entries match your search.
                </Typography>
              )}
            </>
          )}
        </Box>
      </Box>

      {/* ── Right panel ── */}
      <Box sx={{ flex: 1, overflowY: "auto", display: isMobile && mobilePanel === "list" ? "none" : "flex", flexDirection: "column" }}>
        {isMobile && (
          <Box sx={{ px: 1.5, py: 0.75, borderBottom: "1px solid #e2e8f0", display: "flex", alignItems: "center", gap: 0.5, backgroundColor: "#f8fafc", flexShrink: 0 }}>
            <IconButton size="small" onClick={() => setMobilePanel("list")} sx={{ color: "#475569" }}>
              <ArrowBackIcon sx={{ fontSize: 20 }} />
            </IconButton>
            <Typography sx={{ fontSize: "0.85rem", fontWeight: 600, color: "#334155" }}>Journal</Typography>
          </Box>
        )}
        {!loading && focusField === null && (
          <Box sx={{ maxWidth: 860, px: { xs: 2, sm: 4 }, py: { xs: 2, sm: 4 }, display: "flex", flexDirection: "column", gap: 3 }}>

            {/* Date header */}
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <Box>
                <Typography sx={{ fontWeight: 800, fontSize: "1.25rem", color: "#1e293b", lineHeight: 1.2 }}>
                  {isToday ? "Today" : formatDayShort(selectedDate)}
                </Typography>
                <Typography sx={{ fontSize: "0.8rem", color: "#94a3b8", mt: 0.25 }}>
                  {formatDayFull(selectedDate)}
                </Typography>
              </Box>
              {saved && (
                <Typography sx={{ fontSize: "0.75rem", fontWeight: 600, color: "#22c55e" }}>
                  Saved
                </Typography>
              )}
            </Box>

            {/* Better tomorrow */}
            <Box>
              <Box sx={{ display: "flex", alignItems: "center", mb: 0.75 }}>
                <Typography sx={{ ...labelSx, mb: 0 }}>One thing to do better tomorrow</Typography>
                <Box component="span" sx={viewAllSx} onClick={() => setFocusField("note")}>View all →</Box>
              </Box>
              <TextField
                fullWidth multiline minRows={1} maxRows={4}
                placeholder="Write one thing you can improve tomorrow…"
                value={editNote}
                onChange={(e) => handleNote(e.target.value)}
                onBlur={handleNoteBlur}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.target as HTMLElement).blur(); } }}
                slotProps={{ htmlInput: { maxLength: 500 } }}
                sx={inputFieldSx}
              />
            </Box>

            {/* Grateful for */}
            <Box>
              <Box sx={{ display: "flex", alignItems: "center", mb: 0.75 }}>
                <Typography sx={{ ...labelSx, mb: 0 }}>One thing I&apos;m grateful for</Typography>
                <Box component="span" sx={viewAllSx} onClick={() => setFocusField("gratitude")}>View all →</Box>
              </Box>
              <TextField
                fullWidth multiline minRows={1} maxRows={4}
                placeholder="Write one thing you're grateful for today…"
                value={editGratitude}
                onChange={(e) => handleGrat(e.target.value)}
                onBlur={handleGratBlur}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.target as HTMLElement).blur(); } }}
                slotProps={{ htmlInput: { maxLength: 500 } }}
                sx={inputFieldSx}
              />
            </Box>

            {/* Free-write journal */}
            <Box sx={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <Box sx={{ display: "flex", alignItems: "center", mb: 0.75 }}>
                <Typography sx={{ ...labelSx, mb: 0 }}>Journal</Typography>
                <Box component="span" sx={viewAllSx} onClick={() => setFocusField("body")}>View all →</Box>
              </Box>
              <TextField
                fullWidth multiline minRows={12}
                placeholder="Write anything on your mind…"
                value={editBody}
                onChange={(e) => handleBody(e.target.value)}
                onBlur={handleBodyBlur}
                slotProps={{ htmlInput: { maxLength: 10000 } }}
                sx={{
                  flex: 1,
                  "& .MuiOutlinedInput-root": {
                    borderRadius: 2, fontSize: "0.95rem", backgroundColor: "#fff",
                    alignItems: "flex-start",
                    "& fieldset": { borderColor: "#e2e8f0" },
                    "&:hover fieldset": { borderColor: "#cbd5e1" },
                    "&.Mui-focused fieldset": { borderColor: "#6366f1", borderWidth: 1.5 },
                  },
                  "& textarea": { lineHeight: 1.8, py: 1.5, px: 0.5 },
                }}
              />
            </Box>

          </Box>
        )}

        {/* ── Stream view ── */}
        {!loading && focusField !== null && (() => {
          const fieldLabel =
            focusField === "note" ? "One thing to do better tomorrow" :
            focusField === "gratitude" ? "One thing I'm grateful for" :
            "Journal";
          const streamItems = entries
            .filter((e) => !!(focusField === "note" ? e.note : focusField === "gratitude" ? e.gratitude : e.body)?.trim())
            .sort((a, b) => b.date.localeCompare(a.date));
          return (
            <Box sx={{ maxWidth: 860, px: { xs: 2, sm: 4 }, py: { xs: 2, sm: 4 }, display: "flex", flexDirection: "column", gap: 2 }}>
              {/* Back button */}
              <Box
                sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, cursor: "pointer", width: "fit-content" }}
                onClick={() => setFocusField(null)}
              >
                <Typography sx={{ fontSize: "0.82rem", fontWeight: 600, color: "#6366f1", "&:hover": { textDecoration: "underline" } }}>
                  ← Back to entry
                </Typography>
              </Box>

              {/* Heading */}
              <Typography sx={{ fontWeight: 800, fontSize: "1.15rem", color: "#1e293b", lineHeight: 1.3 }}>
                {fieldLabel} — all entries
              </Typography>

              {/* Items */}
              {streamItems.length === 0 ? (
                <Typography sx={{ fontSize: "0.88rem", color: "#94a3b8", mt: 1 }}>
                  No entries yet for this field.
                </Typography>
              ) : (
                <Box sx={{ display: "flex", flexDirection: "column" }}>
                  {streamItems.map((entry, idx) => {
                    const content = (focusField === "note" ? entry.note : focusField === "gratitude" ? entry.gratitude : entry.body) ?? "";
                    return (
                      <Box key={entry.date}>
                        <Box
                          sx={{
                            py: 2, px: 2, backgroundColor: "#f8fafc", borderRadius: 2,
                            cursor: "pointer",
                            "&:hover": { backgroundColor: "rgba(99,102,241,0.05)" },
                          }}
                          onClick={() => { setSelectedDate(entry.date); setFocusField(null); if (isMobile) setMobilePanel("detail"); }}
                        >
                          <Typography sx={{ fontWeight: 700, fontSize: "0.95rem", color: "#1e293b", mb: 0.5 }}>
                            {formatDayFull(entry.date)}
                          </Typography>
                          <Typography sx={{ fontSize: "0.9rem", color: "#475569", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                            {content}
                          </Typography>
                        </Box>
                        {idx < streamItems.length - 1 && (
                          <Box sx={{ borderBottom: "1px solid #e2e8f0", mx: 2 }} />
                        )}
                      </Box>
                    );
                  })}
                </Box>
              )}
            </Box>
          );
        })()}

        {/* Empty state when nothing selected */}
        {!loading && !selectedDate && (
          <Box sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#94a3b8" }}>
            <AutoStoriesOutlinedIcon sx={{ fontSize: 48, mb: 1.5, opacity: 0.4 }} />
            <Typography sx={{ fontSize: "0.875rem" }}>Select a day to view your entry</Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
