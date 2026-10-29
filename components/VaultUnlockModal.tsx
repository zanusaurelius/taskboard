"use client";

import { useEffect, useRef, useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import Divider from "@mui/material/Divider";
import FingerprintIcon from "@mui/icons-material/Fingerprint";
import KeyOutlinedIcon from "@mui/icons-material/KeyOutlined";
import LockOpenOutlinedIcon from "@mui/icons-material/LockOpenOutlined";
import VisibilityOffOutlinedIcon from "@mui/icons-material/VisibilityOffOutlined";
import PasswordField from "./PasswordField";
import { useVault } from "@/lib/vault-context";
import { startAuthentication } from "@simplewebauthn/browser";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** "unlock" = master key only, hidden notes stay hidden; "reveal" = master key + reveal hidden notes */
  mode: "unlock" | "reveal";
  hasWebAuthn: boolean;
}

const fieldSx = {
  "& .MuiOutlinedInput-root": { borderRadius: 1.5, "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: "var(--accent)" } },
  "& .MuiInputLabel-root.Mui-focused": { color: "var(--accent)" },
};

export default function VaultUnlockModal({ open, onClose, onSuccess, mode, hasWebAuthn }: Props) {
  const { unlockWithPassword, unlockWithRecovery, unlockKeyOnly, unlockKeyOnlyWithRecovery, reveal } = useVault();
  const [tab, setTab]             = useState<"password" | "recovery">("password");
  const [password, setPassword]   = useState("");
  const [recovery, setRecovery]   = useState("");
  const [error, setError]         = useState("");
  const [loading, setLoading]     = useState(false);
  const [biometricLoading, setBiometricLoading] = useState(false);
  const openedAtRef = useRef(0);

  useEffect(() => {
    if (open) {
      openedAtRef.current = Date.now();
      setPassword(""); setRecovery(""); setError(""); setTab("password");
    }
  }, [open]);

  const handleClose = (_: unknown, reason?: string) => {
    if (reason === "backdropClick" && Date.now() - openedAtRef.current < 1000) return;
    onClose();
  };

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const ok = await (mode === "unlock" ? unlockKeyOnly(password) : unlockWithPassword(password));
    setLoading(false);
    if (!ok) { setError("Incorrect vault password."); return; }
    onSuccess();
    onClose();
  };

  const handleRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const ok = await (mode === "unlock" ? unlockKeyOnlyWithRecovery(recovery) : unlockWithRecovery(recovery));
    setLoading(false);
    if (!ok) { setError("Invalid recovery code."); return; }
    onSuccess();
    onClose();
  };

  const handleBiometric = async () => {
    setError("");
    setBiometricLoading(true);
    try {
      // Begin
      const beginRes = await fetch("/api/notes/vault/webauthn/authenticate/begin", { method: "POST" });
      if (!beginRes.ok) { setError("Failed to start biometric auth."); return; }
      const options = await beginRes.json();

      // Browser prompts Touch ID / Face ID
      const assertion = await startAuthentication(options);

      // Finish
      const finishRes = await fetch("/api/notes/vault/webauthn/authenticate/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response: assertion }),
      });
      if (!finishRes.ok) { setError("Biometric verification failed."); return; }
      const { token } = await finishRes.json();
      reveal(token);

      if (mode === "unlock") {
        // Biometric proves presence but doesn't give us the master key —
        // fall through to password if master key not in memory
        setError("Biometric confirmed. Enter vault password to decrypt notes.");
        setBiometricLoading(false);
        return;
      }

      onSuccess();
      onClose();
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "NotAllowedError") {
        setError("Biometric cancelled.");
      } else {
        setError("Biometric authentication failed.");
      }
    } finally {
      setBiometricLoading(false);
    }
  };

  const icon = mode === "reveal" ? <VisibilityOffOutlinedIcon sx={{ fontSize: 24, color: "#fff" }} /> : <LockOpenOutlinedIcon sx={{ fontSize: 24, color: "#fff" }} />;
  const title = mode === "reveal" ? "Open Vault" : "Unlock Notes";
  const subtitle = mode === "reveal"
    ? "Authenticate to decrypt notes and reveal hidden notes and folders."
    : "Enter your vault password to read and edit locked notes. Hidden notes stay hidden.";

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="xs" fullWidth slotProps={{ paper: { sx: { borderRadius: 3, p: 1 } } }}>
      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", mb: 3 }}>
          <Box sx={{ width: 48, height: 48, borderRadius: 2, background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)", display: "flex", alignItems: "center", justifyContent: "center", mb: 1.5 }}>
            {icon}
          </Box>
          <Typography sx={{ fontWeight: 800, fontSize: "1.1rem", color: "var(--tx)" }}>{title}</Typography>
          <Typography sx={{ fontSize: "0.8rem", color: "var(--tx-4)", mt: 0.5, textAlign: "center" }}>{subtitle}</Typography>
        </Box>

        {error && <Alert severity="error" sx={{ borderRadius: 1.5, mb: 2, fontSize: "0.8rem" }}>{error}</Alert>}

        {/* Biometric button */}
        {hasWebAuthn && (
          <>
            <Button
              fullWidth
              onClick={handleBiometric}
              disabled={biometricLoading || loading}
              startIcon={biometricLoading ? <CircularProgress size={18} sx={{ color: "var(--accent)" }} /> : <FingerprintIcon />}
              sx={{ mb: 2, borderRadius: 1.5, textTransform: "none", fontWeight: 600, py: 1.1, border: "1.5px solid var(--accent-line)", color: "var(--accent)", backgroundColor: "var(--accent-tint)", "&:hover": { backgroundColor: "var(--accent-tint)" } }}>
              {biometricLoading ? "Waiting for biometric…" : "Use Touch ID / Face ID"}
            </Button>
            <Divider sx={{ mb: 2 }}>
              <Typography sx={{ fontSize: "0.8rem", color: "var(--tx-4)" }}>or use password</Typography>
            </Divider>
          </>
        )}

        {/* Tab toggle */}
        <Box sx={{ display: "flex", gap: 0.5, mb: 2 }}>
          {(["password", "recovery"] as const).map((t) => (
            <Button key={t} size="small" onClick={() => { setTab(t); setError(""); }}
              startIcon={t === "password" ? <LockOpenOutlinedIcon sx={{ fontSize: 15 }} /> : <KeyOutlinedIcon sx={{ fontSize: 15 }} />}
              sx={{
                flex: 1, textTransform: "none", fontWeight: 600, fontSize: "0.8rem", borderRadius: 1.5,
                color: tab === t ? "var(--accent)" : "var(--tx-4)",
                backgroundColor: tab === t ? "var(--accent-tint)" : "transparent",
                "&:hover": { backgroundColor: tab === t ? "var(--accent-tint)" : "var(--surface-hover)" },
              }}>
              {t === "password" ? "Password" : "Recovery code"}
            </Button>
          ))}
        </Box>

        {tab === "password" && (
          <form onSubmit={handlePassword}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <PasswordField label="Vault password" value={password} onChange={(e) => setPassword(e.target.value)}
                required fullWidth size="small" autoComplete="current-password" fieldSx={fieldSx} />
              <Box sx={{ display: "flex", gap: 1.5 }}>
                <Button variant="outlined" onClick={onClose} disabled={loading}
                  sx={{ flex: 1, textTransform: "none", fontWeight: 600, borderRadius: 1.5, borderColor: "var(--border)", color: "var(--tx-3)" }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={loading}
                  sx={{ flex: 1, background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)", color: "#fff", fontWeight: 700, textTransform: "none", borderRadius: 1.5,
                    "&:hover": { background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" } }}>
                  {loading ? <CircularProgress size={18} sx={{ color: "#fff" }} /> : "Unlock"}
                </Button>
              </Box>
            </Box>
          </form>
        )}

        {tab === "recovery" && (
          <form onSubmit={handleRecovery}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <PasswordField label="Recovery code (XXXXXX-XXXXXX-XXXXXX-XXXXXX)" value={recovery} onChange={(e) => setRecovery(e.target.value)}
                required fullWidth size="small" fieldSx={fieldSx} />
              <Box sx={{ display: "flex", gap: 1.5 }}>
                <Button variant="outlined" onClick={onClose} disabled={loading}
                  sx={{ flex: 1, textTransform: "none", fontWeight: 600, borderRadius: 1.5, borderColor: "var(--border)", color: "var(--tx-3)" }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={loading}
                  sx={{ flex: 1, background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)", color: "#fff", fontWeight: 700, textTransform: "none", borderRadius: 1.5,
                    "&:hover": { background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" } }}>
                  {loading ? <CircularProgress size={18} sx={{ color: "#fff" }} /> : "Recover access"}
                </Button>
              </Box>
            </Box>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
