"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
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

export default function RegisterPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [copied, setCopied]     = useState(false);

  const handleDownload = () => {
    if (!recoveryCode) return;
    const content = `Taskboard Recovery Code\n\nUsername: ${username}\nRecovery code: ${recoveryCode}\n\nStore this file somewhere safe and private.\nDo not share it. There is no email reset.`;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "taskboard-recovery-code.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) { setError("Passwords don't match."); return; }
    if (password.length < 8)  { setError("Password must be at least 8 characters."); return; }
    setLoading(true);

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) { setError(data.error || "Registration failed."); setLoading(false); return; }

    // Show recovery code before signing in
    setRecoveryCode(data.recoveryCode);
    setLoading(false);
  };

  const handleContinue = async () => {
    setLoading(true);
    const result = await signIn("credentials", { username, password, redirect: false });
    setLoading(false);
    if (result?.error) {
      setError("Account created but sign-in failed. Please log in.");
      setRecoveryCode(null);
    } else {
      router.push("/");
      router.refresh();
    }
  };

  const handleCopy = () => {
    if (!recoveryCode) return;
    navigator.clipboard.writeText(recoveryCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Recovery code screen ──
  if (recoveryCode) {
    return (
      <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#f1f5f9" }}>
        <Box sx={{ width: "100%", maxWidth: 440, mx: 2 }}>
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", mb: 4 }}>
            <Box sx={{ width: 44, height: 44, borderRadius: 2.5, background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(99,102,241,0.4)", mb: 2 }}>
              <Typography sx={{ color: "#fff", fontSize: "1.3rem", fontWeight: 900, lineHeight: 1 }}>T</Typography>
            </Box>
            <Typography variant="h5" sx={{ fontWeight: 800, color: "#0f172a", letterSpacing: -0.5 }}>Save your recovery code</Typography>
            <Typography sx={{ color: "#64748b", fontSize: "0.9rem", mt: 0.5, textAlign: "center" }}>
              This is shown <strong>once only</strong>. Store it somewhere safe.
            </Typography>
          </Box>

          <Box sx={{ backgroundColor: "#fff", borderRadius: 3, p: 4, boxShadow: "0 1px 3px rgba(0,0,0,0.08), 0 8px 32px rgba(0,0,0,0.06)" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
              <LockIcon sx={{ fontSize: 16, color: "#6366f1" }} />
              <Typography sx={{ fontSize: "0.8rem", fontWeight: 600, color: "#6366f1" }}>Recovery code</Typography>
            </Box>

            <Box sx={{ backgroundColor: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 2, p: 2.5, mb: 2.5, position: "relative" }}>
              <Typography sx={{ fontFamily: "monospace", fontSize: "1.15rem", fontWeight: 700, color: "#0f172a", letterSpacing: 2, textAlign: "center", userSelect: "all" }}>
                {recoveryCode}
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
              If you lose this code and forget your password, your account cannot be recovered. There is no email reset.
            </Alert>

            <Button fullWidth onClick={handleContinue} disabled={loading} sx={btnSx}>
              {loading ? <CircularProgress size={22} sx={{ color: "#fff" }} /> : "I've saved it — continue"}
            </Button>
          </Box>
        </Box>
      </Box>
    );
  }

  // ── Registration form ──
  return (
    <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#f1f5f9" }}>
      <Box sx={{ width: "100%", maxWidth: 400, mx: 2 }}>
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", mb: 4 }}>
          <Box sx={{ width: 44, height: 44, borderRadius: 2.5, background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(99,102,241,0.4)", mb: 2 }}>
            <Typography sx={{ color: "#fff", fontSize: "1.3rem", fontWeight: 900, lineHeight: 1 }}>T</Typography>
          </Box>
          <Typography variant="h5" sx={{ fontWeight: 800, color: "#0f172a", letterSpacing: -0.5 }}>Create your account</Typography>
          <Typography sx={{ color: "#64748b", fontSize: "0.9rem", mt: 0.5 }}>No email required</Typography>
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
                size="small"
                helperText="Letters, numbers, _ and - only"
                sx={fieldSx}
              />
              <PasswordField
                label="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required fullWidth
                autoComplete="new-password"
                size="small"
                helperText="At least 8 characters"
                fieldSx={fieldSx}
              />
              <PasswordField
                label="Confirm password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required fullWidth
                autoComplete="new-password"
                size="small" fieldSx={fieldSx}
              />
              <Button type="submit" fullWidth disabled={loading} sx={btnSx}>
                {loading ? <CircularProgress size={22} sx={{ color: "#fff" }} /> : "Create account"}
              </Button>
            </Box>
          </form>
        </Box>

        <Typography sx={{ textAlign: "center", mt: 3, fontSize: "0.875rem", color: "#64748b" }}>
          Already have an account?{" "}
          <Link href="/login" underline="hover" sx={{ color: "#6366f1", fontWeight: 600 }}>Sign in</Link>
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
