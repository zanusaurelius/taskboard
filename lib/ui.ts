// Shared styles so every page looks like the same app. Colours come from the theme tokens in
// app/globals.css; sizes come from the type scale below. Prefer these over one-off sx values.

/** The five text sizes. Every piece of text in the app should use one of them. */
export const type = {
  pageTitle: { fontSize: "1.25rem", fontWeight: 700, letterSpacing: "-0.01em", color: "var(--tx)" },
  sectionTitle: { fontSize: "0.95rem", fontWeight: 700, color: "var(--tx)" },
  body: { fontSize: "0.875rem", color: "var(--tx-2)" },
  small: { fontSize: "0.8rem", color: "var(--tx-3)" },
  label: {
    fontSize: "0.7rem", fontWeight: 700, color: "var(--tx-3)",
    textTransform: "uppercase" as const, letterSpacing: "0.08em",
  },
} as const;

/** The one panel style: content sits on these cards, cards sit on --bg. */
export const cardSx = {
  backgroundColor: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 3,
  boxShadow: "var(--shadow-card)",
} as const;

/** Page body: the same background, width and padding on every scrolling page. */
export const pageBodySx = {
  maxWidth: 1100, mx: "auto", width: "100%",
  px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 3 },
  display: "flex", flexDirection: "column", gap: 3,
} as const;

export const primaryButtonSx = {
  textTransform: "none", fontWeight: 600, fontSize: "0.875rem", borderRadius: 2,
  px: { xs: 1.25, sm: 2 }, minWidth: 0, boxShadow: "none",
  backgroundColor: "var(--accent)", color: "var(--on-accent)",
  "&:hover": { backgroundColor: "var(--accent-hover)", boxShadow: "none" },
  "&.Mui-disabled": { backgroundColor: "var(--accent)", color: "var(--on-accent)", opacity: 0.45 },
} as const;

export const secondaryButtonSx = {
  textTransform: "none", fontWeight: 600, fontSize: "0.875rem", borderRadius: 2,
  px: { xs: 1.25, sm: 2 }, minWidth: 0,
  border: "1px solid var(--border-2)", color: "var(--tx-2)", backgroundColor: "transparent",
  "&:hover": { backgroundColor: "var(--surface-hover)", borderColor: "var(--tx-4)" },
} as const;

export const iconButtonSx = {
  color: "var(--tx-3)", border: "1px solid var(--border)", borderRadius: 2, p: 0.75,
  "&:hover": { backgroundColor: "var(--surface-hover)", color: "var(--tx)", borderColor: "var(--border-2)" },
} as const;

export const textButtonSx = {
  textTransform: "none", fontWeight: 600, fontSize: "0.8rem", color: "var(--tx-3)", minWidth: 0,
  "&:hover": { color: "var(--accent)", backgroundColor: "transparent" },
} as const;
