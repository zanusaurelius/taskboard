"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import PasswordField from "@/components/PasswordField";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import Link from "@mui/material/Link";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import CheckIcon from "@mui/icons-material/Check";
import LockIcon from "@mui/icons-material/Lock";
import DownloadIcon from "@mui/icons-material/Download";

export default function RecoverPage() {
  const router = useRouter();
  const [username, setUsername]         = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPassword, setNewPassword]   = useState("");
  const [confirm, setConfirm]           = useState("");
  const [error, setError]               = useState("");
  const [loading, setLoading]           = useState(false);
  const [newCode, setNewCode]           = useState<string | null>(null);
  const [copied, setCopied]             = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (newPassword !== confirm) { setError("Passwords don't match."); return; }
    if (newPassword.length < 8)  { setError("Password must be at least 8 characters."); return; }
    setLoading(true);

    const res = await fetch("/api/auth/recover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, recoveryCode, newPassword }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { setError(data.error || "Recovery failed."); return; }
    setNewCode(data.newRecoveryCode);
  };

  const handleCopy = () => {
    if (!newCode) return;
    navigator.clipboard.writeText(newCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!newCode) return;
    const content = `Taskboard Recovery Code\n\nUsername: ${username}\nRecovery code: ${newCode}\n\nStore this file somewhere safe and private.\nDo not share it. There is no email reset.`;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "taskboard-recovery-code.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  // After recovery: show the new recovery code (rotated — old one is now invalid)
  if (newCode) {
    return (
      <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#f1f5f9" }}>
        <Box sx={{ width: "100%", maxWidth: 440, mx: 2 }}>
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", mb: 4 }}>
            <Box sx={{ width: 44, height: 44, borderRadius: 2.5, background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(99,102,241,0.4)", mb: 2 }}>
              <Typography sx={{ color: "#fff", fontSize: "1.3rem", fontWeight: 900, lineHeight: 1 }}>T</Typography>
            </Box>
            <Typography variant="h5" sx={{ fontWeight: 800, color: "#0f172a", letterSpacing: -0.5 }}>Save your new recovery code</Typography>
            <Typography sx={{ color: "#64748b", fontSize: "0.9rem", mt: 0.5, textAlign: "center" }}>
              Your old code is now invalid. This new code is shown <strong>once only</strong>.
            </Typography>
          </Box>

          <Box sx={{ backgroundColor: "#fff", borderRadius: 3, p: 4, boxShadow: "0 1px 3px rgba(0,0,0,0.08), 0 8px 32px rgba(0,0,0,0.06)" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
              <LockIcon sx={{ fontSize: 16, color: "#6366f1" }} />
              <Typography sx={{ fontSize: "0.8rem", fontWeight: 600, color: "#6366f1" }}>New recovery code</Typography>
            </Box>

            <Box sx={{ backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 2, p: 2.5, mb: 2.5 }}>
              <Typography sx={{ fontFamily: "monospace", fontSize: "1.15rem", fontWeight: 700, color: "#0f172a", letterSpacing: 2, textAlign: "center", userSelect: "all" }}>
                {newCode}
              </Typography>
            </Box>

            <Box sx={{ display: "flex", gap: 1.5, mb: 3 }}>
              <Button fullWidth variant="outlined" startIcon={copied ? <CheckIcon /> : <ContentCopyIcon />} onClick={handleCopy}
                sx={{ borderColor: "#e2e8f0", color: copied ? "#10b981" : "#64748b", borderRadius: 1.5, textTransform: "none", fontWeight: 600, "&:hover": { borderColor: "#6366f1", color: "#6366f1", backgroundColor: "#eef0ff" } }}>
                {copied ? "Copied!" : "Copy"}
              </Button>
              <Button fullWidth variant="outlined" startIcon={<DownloadIcon />} onClick={handleDownload}
                sx={{ borderColor: "#e2e8f0", color: "#64748b", borderRadius: 1.5, textTransform: "none", fontWeight: 600, "&:hover": { borderColor: "#6366f1", color: "#6366f1", backgroundColor: "#eef0ff" } }}>
                Download
              </Button>
            </Box>

            <Alert severity="warning" sx={{ mb: 3, borderRadius: 2, fontSize: "0.82rem" }}>
              Save this code now. Your previous recovery code has been invalidated.
            </Alert>

            <Button fullWidth onClick={() => router.push("/login")} sx={btnSx}>
              Continue to sign in
            </Button>
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#f1f5f9" }}>
      <Box sx={{ width: "100%", maxWidth: 400, mx: 2 }}>
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", mb: 4 }}>
          <Box sx={{ width: 44, height: 44, borderRadius: 2.5, background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(99,102,241,0.4)", mb: 2 }}>
            <Typography sx={{ color: "#fff", fontSize: "1.3rem", fontWeight: 900, lineHeight: 1 }}>T</Typography>
          </Box>
          <Typography variant="h5" sx={{ fontWeight: 800, color: "#0f172a", letterSpacing: -0.5 }}>Account recovery</Typography>
          <Typography sx={{ color: "#64748b", fontSize: "0.9rem", mt: 0.5 }}>Reset your password with your recovery code</Typography>
        </Box>

        <Box sx={{ backgroundColor: "#fff", borderRadius: 3, p: 4, boxShadow: "0 1px 3px rgba(0,0,0,0.08), 0 8px 32px rgba(0,0,0,0.06)" }}>
          {error && <Alert severity="error" sx={{ mb: 2.5, borderRadius: 2 }}>{error}</Alert>}
          <form onSubmit={handleSubmit}>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
              <TextField
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required autoFocus fullWidth
                autoComplete="username"
                size="small" sx={fieldSx}
              />
              <TextField
                label="Recovery code"
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value)}
                required fullWidth
                placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX"
                size="small"
                slotProps={{ input: { style: { fontFamily: "monospace", letterSpacing: 1 } } }}
                sx={fieldSx}
              />
              <PasswordField
                label="New password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required fullWidth
                autoComplete="new-password"
                size="small"
                helperText="At least 8 characters"
                fieldSx={fieldSx}
              />
              <PasswordField
                label="Confirm new password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required fullWidth
                autoComplete="new-password"
                size="small" fieldSx={fieldSx}
              />
              <Button type="submit" fullWidth disabled={loading} sx={btnSx}>
                {loading ? <CircularProgress size={22} sx={{ color: "#fff" }} /> : "Reset password"}
              </Button>
            </Box>
          </form>
        </Box>

        <Typography sx={{ textAlign: "center", mt: 3, fontSize: "0.875rem", color: "#64748b" }}>
          <Link href="/login" underline="hover" sx={{ color: "#6366f1", fontWeight: 600 }}>Back to sign in</Link>
        </Typography>
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
