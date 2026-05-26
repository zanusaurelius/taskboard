"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import PasswordField from "@/components/PasswordField";

type DbState = "setup" | "locked" | "unlocked" | "loading";

export default function UnlockPage() {
  const router = useRouter();
  const [dbState, setDbState]       = useState<DbState>("loading");
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm]       = useState("");
  const [error, setError]           = useState("");
  const [loading, setLoading]       = useState(false);
  const [retryKey, setRetryKey]     = useState(0);

  useEffect(() => {
    setDbState("loading");
    setError("");
    fetch("/api/auth/db-status")
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((d) => {
        setDbState(d.state as DbState);
      })
      .catch(() => setError("Could not reach the server."));
  }, [router, retryKey]);

  const isSetup = dbState === "setup";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/db-unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase, confirm: isSetup ? confirm : undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
      } else {
        router.replace("/");
        router.refresh();
      }
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  if (dbState === "loading") {
    return (
      <Box sx={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2, backgroundColor: "#f1f5f9" }}>
        {error ? (
          <>
            <Alert severity="error" sx={{ maxWidth: 400, width: "100%", mx: 2, borderRadius: 2 }}>{error}</Alert>
            <Button onClick={() => setRetryKey((k) => k + 1)} sx={{ color: "#6366f1", textTransform: "none", fontWeight: 600 }}>
              Retry
            </Button>
          </>
        ) : (
          <CircularProgress sx={{ color: "#6366f1" }} />
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#f1f5f9" }}>
      <Box sx={{ width: "100%", maxWidth: 400, mx: 2 }}>
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", mb: 4 }}>
          <Box sx={{ width: 44, height: 44, borderRadius: 2.5, background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(99,102,241,0.4)", mb: 2 }}>
            <LockOutlinedIcon sx={{ color: "#fff", fontSize: "1.5rem" }} />
          </Box>
          <Typography variant="h5" sx={{ fontWeight: 800, color: "#0f172a", letterSpacing: -0.5 }}>
            {isSetup ? "Set database passphrase" : dbState === "unlocked" ? "Resume session" : "Unlock database"}
          </Typography>
          <Typography sx={{ color: "#64748b", fontSize: "0.9rem", mt: 0.5, textAlign: "center" }}>
            {isSetup
              ? "Choose a passphrase to encrypt your data at rest."
              : dbState === "unlocked"
              ? "Your session expired. Re-enter your passphrase to continue."
              : "Enter your passphrase to unlock the database."}
          </Typography>
        </Box>

        <Box sx={{ backgroundColor: "#fff", borderRadius: 3, p: 4, boxShadow: "0 1px 3px rgba(0,0,0,0.08), 0 8px 32px rgba(0,0,0,0.06)" }}>
          {error && <Alert severity="error" sx={{ mb: 2.5, borderRadius: 2 }}>{error}</Alert>}
          <form onSubmit={handleSubmit}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
              <PasswordField
                label="Passphrase"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                required autoFocus fullWidth
                autoComplete={isSetup ? "new-password" : "current-password"}
                size="small" fieldSx={fieldSx}
              />
              {isSetup && (
                <PasswordField
                  label="Confirm passphrase"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required fullWidth
                  autoComplete="new-password"
                  size="small" fieldSx={fieldSx}
                />
              )}
              <Button type="submit" fullWidth disabled={loading} sx={btnSx}>
                {loading
                  ? <CircularProgress size={22} sx={{ color: "#fff" }} />
                  : isSetup ? "Encrypt & unlock" : dbState === "unlocked" ? "Continue" : "Unlock"}
              </Button>
            </Box>
          </form>
        </Box>

        {isSetup && (
          <Box sx={{ mt: 3, px: 1 }}>
            <Typography sx={{ fontSize: "0.8rem", color: "#94a3b8", textAlign: "center", lineHeight: 1.6 }}>
              This passphrase encrypts your database with ChaCha20-Poly1305. It is never stored — you must enter it each time the server restarts.
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}

const fieldSx = {
  "& .MuiOutlinedInput-root": { borderRadius: 1.5, "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: "#6366f1" } },
  "& .MuiInputLabel-root.Mui-focused": { color: "#6366f1" },
};
const btnSx = {
  mt: 0.5, py: 1.25,
  background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
  color: "#fff", fontWeight: 700, fontSize: "0.95rem", textTransform: "none", borderRadius: 2,
  "&:hover": { background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" },
  "&:disabled": { opacity: 0.7 },
};
