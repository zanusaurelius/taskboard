"use client";
import { ThemeProvider, createTheme } from "@mui/material/styles";

// The auth pages (login / register / recover / unlock) are always light by design —
// they hardcode light backgrounds and dark text. Force a light MUI theme for the whole
// group so input text, labels, etc. stay legible even when the user's app theme (or OS)
// is dark. Without this, dark mode sets MUI text.primary to near-white (#f1f5f9), which
// renders the masked password dots invisibly on the white input field.
const lightAuthTheme = createTheme({
  typography: { fontFamily: "inherit" },
  palette: {
    mode: "light",
    background: { default: "#f1f5f9", paper: "#ffffff" },
    text: { primary: "#1e293b", secondary: "#475569", disabled: "#94a3b8" },
    divider: "#e2e8f0",
    primary: { main: "#6366f1" },
  },
});

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <ThemeProvider theme={lightAuthTheme}>{children}</ThemeProvider>;
}
