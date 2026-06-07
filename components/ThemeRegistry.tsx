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
  const theme = createTheme({
    typography: { fontFamily: "inherit" },
    palette: isDark
      ? {
          mode: "dark",
          background: { default: "#0f172a", paper: "#1e293b" },
          text: { primary: "#f1f5f9", secondary: "#94a3b8", disabled: "#475569" },
          divider: "#334155",
          primary: { main: "#6366f1" },
        }
      : {
          mode: "light",
          background: { default: "#f1f5f9", paper: "#ffffff" },
          text: { primary: "#1e293b", secondary: "#475569", disabled: "#94a3b8" },
          divider: "#e2e8f0",
          primary: { main: "#6366f1" },
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
