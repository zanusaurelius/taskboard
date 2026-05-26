"use client";

import { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DownloadIcon from "@mui/icons-material/Download";
import LockOutlinedIcon from "@mui/icons-material/LockOutlined";
import PasswordField from "./PasswordField";
import {
  generateMasterKey, generateSalt, generateRecoveryCode,
  deriveKey, encryptMasterKey, computeVerifier, toBase64,
} from "@/lib/vault-crypto";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const fieldSx = {
  "& .MuiOutlinedInput-root": { borderRadius: 1.5, "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: "#6366f1" } },
  "& .MuiInputLabel-root.Mui-focused": { color: "#6366f1" },
};

export default function VaultSetupModal({ open, onClose, onSuccess }: Props) {
  const [step, setStep] = useState<"password" | "recovery" | "done">("password");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm)  { setError("Passwords don't match."); return; }
    setLoading(true);
    try {
      const masterKey  = generateMasterKey();
      const salt       = generateSalt();
      const bakSalt    = generateSalt();
      const code       = generateRecoveryCode();
      const pwKey      = await deriveKey(password, salt);
      const bakKey     = await deriveKey(code.replace(/[-\s]/g, ""), bakSalt);
      const encMK      = await encryptMasterKey(masterKey, pwKey);
      const encMKBak   = await encryptMasterKey(masterKey, bakKey);
      const verifier   = await computeVerifier(masterKey);

      const res = await fetch("/api/notes/vault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          encryptedMasterKey: encMK,
          masterKeySalt: toBase64(salt),
          encryptedMasterKeyBak: encMKBak,
          backupKeySalt: toBase64(bakSalt),
          verifier,
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setError(d.error ?? "Failed to create vault."); return; }
      setRecoveryCode(code);
      setStep("recovery");
    } catch (e) {
      console.error("Vault setup error:", e);
      setError("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(recoveryCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const content = `Taskboard Vault Recovery Code\n\nRecovery code: ${recoveryCode}\n\nStore this file somewhere safe and private.\nThis is the only way to recover your vault if you forget your vault password.`;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "taskboard-vault-recovery-code.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFinish = () => {
    setStep("done");
    onSuccess();
    onClose();
  };

  return (
    <Dialog open={open} onClose={step === "password" ? onClose : undefined} maxWidth="xs" fullWidth
      slotProps={{ paper: { sx: { borderRadius: 3, p: 1 } } }}>
      <DialogContent>

        {/* Header */}
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", mb: 3 }}>
          <Box sx={{ width: 48, height: 48, borderRadius: 2, background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)", display: "flex", alignItems: "center", justifyContent: "center", mb: 1.5 }}>
            <LockOutlinedIcon sx={{ color: "#fff", fontSize: 24 }} />
          </Box>
          <Typography sx={{ fontWeight: 800, fontSize: "1.1rem", color: "#0f172a" }}>
            {step === "password" ? "Create Notes Vault" : "Save Your Recovery Code"}
          </Typography>
          <Typography sx={{ fontSize: "0.8rem", color: "#94a3b8", mt: 0.5, textAlign: "center" }}>
            {step === "password"
              ? "Set a vault password to lock and hide notes. Separate from your account password."
              : "This is the only way to recover your vault if you forget your password. Store it safely."}
          </Typography>
        </Box>

        {/* Step: password */}
        {step === "password" && (
          <form onSubmit={handleSetPassword}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {error && <Alert severity="error" sx={{ borderRadius: 1.5 }}>{error}</Alert>}
              <PasswordField label="Vault password" value={password} onChange={(e) => setPassword(e.target.value)}
                required fullWidth size="small" autoComplete="new-password"
                helperText="At least 8 characters. Different from your account password." fieldSx={fieldSx} />
              <PasswordField label="Confirm vault password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                required fullWidth size="small" autoComplete="new-password" fieldSx={fieldSx} />
              <Box sx={{ display: "flex", gap: 1.5, mt: 1 }}>
                <Button variant="outlined" onClick={onClose} disabled={loading}
                  sx={{ flex: 1, textTransform: "none", fontWeight: 600, borderRadius: 1.5, borderColor: "#e2e8f0", color: "#64748b" }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={loading}
                  sx={{ flex: 1, background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)", color: "#fff", fontWeight: 700, textTransform: "none", borderRadius: 1.5,
                    "&:hover": { background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" } }}>
                  {loading ? <CircularProgress size={18} sx={{ color: "#fff" }} /> : "Create vault"}
                </Button>
              </Box>
            </Box>
          </form>
        )}

        {/* Step: recovery code */}
        {step === "recovery" && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Alert severity="warning" sx={{ borderRadius: 1.5, fontSize: "0.8rem" }}>
              This code is shown <strong>once</strong>. Write it down or save it in a password manager.
            </Alert>
            <Box sx={{ backgroundColor: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 2, p: 2.5, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <Typography sx={{ fontFamily: "monospace", fontSize: "1rem", fontWeight: 700, color: "#1e293b", letterSpacing: 2 }}>
                {recoveryCode}
              </Typography>
              <Box sx={{ display: "flex", gap: 0.5 }}>
                <Tooltip title={copied ? "Copied!" : "Copy"} placement="top">
                  <IconButton size="small" onClick={handleCopy} sx={{ color: copied ? "#22c55e" : "#94a3b8" }}>
                    <ContentCopyIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Download as text file" placement="top">
                  <IconButton size="small" onClick={handleDownload} sx={{ color: "#94a3b8" }}>
                    <DownloadIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
            <Typography sx={{ fontSize: "0.78rem", color: "#94a3b8" }}>
              Format: 4 groups of 6 characters. Hyphen-separated.
            </Typography>
            <Button onClick={handleFinish}
              sx={{ background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)", color: "#fff", fontWeight: 700, textTransform: "none", borderRadius: 1.5,
                "&:hover": { background: "linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)" } }}>
              I&apos;ve saved my recovery code
            </Button>
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
}
