"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import PasswordField from "@/components/PasswordField";
import Link from "@mui/material/Link";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await signIn("credentials", { username, password, redirect: false });
      if (!result) {
        setError("Could not reach the server. Check your connection and try again.");
      } else if (result.error) {
        setError("Invalid username or password.");
      } else {
        router.push("/");
        router.refresh();
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "#f1f5f9" }}>
      <Box sx={{ width: "100%", maxWidth: 400, mx: 2 }}>
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", mb: 4 }}>
          <Box sx={{ width: 44, height: 44, borderRadius: 2.5, background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 16px rgba(99,102,241,0.4)", mb: 2 }}>
            <Typography sx={{ color: "#fff", fontSize: "1.3rem", fontWeight: 900, lineHeight: 1 }}>T</Typography>
          </Box>
          <Typography variant="h5" sx={{ fontWeight: 800, color: "#0f172a", letterSpacing: -0.5 }}>Welcome back</Typography>
          <Typography sx={{ color: "#64748b", fontSize: "0.9rem", mt: 0.5 }}>Sign in to your account</Typography>
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
              <PasswordField
                label="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required fullWidth
                autoComplete="current-password"
                size="small" fieldSx={fieldSx}
              />
              <Button type="submit" fullWidth disabled={loading} sx={btnSx}>
                {loading ? <CircularProgress size={22} sx={{ color: "#fff" }} /> : "Sign in"}
              </Button>
            </Box>
          </form>
        </Box>

        <Box sx={{ mt: 3, display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
          <Typography sx={{ fontSize: "0.875rem", color: "#64748b" }}>
            Don&apos;t have an account?{" "}
            <Link href="/register" underline="hover" sx={{ color: "#6366f1", fontWeight: 600 }}>Create one</Link>
          </Typography>
          <Link href="/recover" underline="hover" sx={{ fontSize: "0.8rem", color: "#94a3b8", "&:hover": { color: "#6366f1" } }}>
            Forgot password? Use recovery code
          </Link>
        </Box>
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
