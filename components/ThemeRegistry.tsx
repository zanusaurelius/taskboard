"use client";
import createCache from "@emotion/cache";
import { useServerInsertedHTML } from "next/navigation";
import { CacheProvider } from "@emotion/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { useState } from "react";

const theme = createTheme({
  typography: { fontFamily: "inherit" },
  palette: { background: { default: "#f8fafc" } },
});

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
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </CacheProvider>
  );
}
