"use client";
import createCache from "@emotion/cache";
import { useServerInsertedHTML } from "next/navigation";
import { CacheProvider } from "@emotion/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { useState } from "react";
import { ThemeContextProvider, useAppTheme } from "@/lib/theme-context";

function MuiThemeApplier({ children }: { children: React.ReactNode }) {
  const { isDark } = useAppTheme();
  // Component defaults so dialogs, menus, inputs and buttons match lib/ui.ts everywhere
  // without per-page styling. Colours come from the CSS tokens in app/globals.css.
  const theme = createTheme({
    typography: { fontFamily: "inherit", button: { textTransform: "none", fontWeight: 600 } },
    shape: { borderRadius: 8 },
    palette: isDark
      ? {
          mode: "dark",
          background: { default: "#0f172a", paper: "#1e293b" },
          text: { primary: "#f1f5f9", secondary: "#cbd5e1", disabled: "#7c8aa0" },
          divider: "#334155",
          primary: { main: "#818cf8" },
        }
      : {
          mode: "light",
          background: { default: "#f1f5f9", paper: "#ffffff" },
          text: { primary: "#1e293b", secondary: "#475569", disabled: "#7b8799" },
          divider: "#e2e8f0",
          primary: { main: "#6366f1" },
        },
    components: {
      MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
      MuiDialog: {
        styleOverrides: {
          paper: {
            backgroundColor: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 12, boxShadow: "var(--shadow-pop)",
          },
        },
      },
      MuiDialogTitle: { styleOverrides: { root: { fontSize: "1.05rem", fontWeight: 700, color: "var(--tx)" } } },
      MuiMenu: { styleOverrides: { paper: { backgroundColor: "var(--surface)", border: "1px solid var(--border)", boxShadow: "var(--shadow-pop)" } } },
      MuiPopover: { styleOverrides: { paper: { backgroundColor: "var(--surface)", border: "1px solid var(--border)" } } },
      MuiTooltip: { styleOverrides: { tooltip: { fontSize: "0.75rem", backgroundColor: "#0f172a", border: "1px solid #334155" } } },
      MuiOutlinedInput: {
        styleOverrides: {
          root: {
            borderRadius: 8, backgroundColor: "var(--surface)",
            "& .MuiOutlinedInput-notchedOutline": { borderColor: "var(--border)" },
            "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: "var(--border-2)" },
            "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: "var(--accent)", borderWidth: 1.5 },
          },
        },
      },
      MuiInputLabel: { styleOverrides: { root: { color: "var(--tx-3)", "&.Mui-focused": { color: "var(--accent)" } } } },
      MuiChip: { styleOverrides: { root: { fontWeight: 600, borderRadius: 999 } } },
      MuiSwitch: {
        styleOverrides: {
          switchBase: { "&.Mui-checked": { color: "var(--accent)" }, "&.Mui-checked + .MuiSwitch-track": { backgroundColor: "var(--accent)", opacity: 0.6 } },
        },
      },
      MuiCheckbox: { styleOverrides: { root: { color: "var(--tx-4)", "&.Mui-checked": { color: "var(--accent)" } } } },
    },
  });
  return <ThemeProvider theme={theme}>{children}</ThemeProvider>;
}

export default function ThemeRegistry({ nonce, children }: { nonce?: string; children: React.ReactNode }) {
  const [{ cache, flush }] = useState(() => {
    const cache = createCache({ key: "mui", nonce });
    cache.compat = true;
    const prevInsert = cache.insert;
    let inserted: string[] = [];
    cache.insert = (...args: Parameters<typeof prevInsert>) => {
      const serialized = args[1];
      if (cache.inserted[serialized.name] === undefined) inserted.push(serialized.name);
      return prevInsert(...args);
    };
    const flush = () => { const prev = inserted; inserted = []; return prev; };
    return { cache, flush };
  });

  useServerInsertedHTML(() => {
    const names = flush();
    if (names.length === 0) return null;
    let styles = "";
    for (const name of names) styles += cache.inserted[name];
    return <style data-emotion={`${cache.key} ${names.join(" ")}`} dangerouslySetInnerHTML={{ __html: styles }} />;
  });

  return (
    <CacheProvider value={cache}>
      <ThemeContextProvider>
        <MuiThemeApplier>
          <CssBaseline />
          {children}
        </MuiThemeApplier>
      </ThemeContextProvider>
    </CacheProvider>
  );
}
