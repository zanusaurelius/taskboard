import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Taskboard — Tasks, notes, and journal all in one";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "100%",
          height: "100%",
          backgroundColor: "#0f172a",
          padding: "80px 90px",
          position: "relative",
        }}
      >
        {/* Decorative kanban columns top-right */}
        <div style={{ display: "flex", position: "absolute", top: "50px", right: "80px", gap: "16px" }}>
          {[
            { h: 160, items: 3 },
            { h: 120, items: 2 },
            { h: 200, items: 4 },
          ].map((col, i) => (
            <div key={i} style={{ display: "flex", flexDirection: "column", width: "80px", gap: "8px" }}>
              <div style={{ display: "flex", width: "80px", height: "6px", backgroundColor: "#6366f1", borderRadius: "3px", opacity: 0.5 + i * 0.2 }} />
              {Array.from({ length: col.items }).map((_, j) => (
                <div key={j} style={{ display: "flex", width: "80px", height: `${32 + j * 4}px`, backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "6px" }} />
              ))}
            </div>
          ))}
        </div>

        {/* Accent bar */}
        <div style={{ display: "flex", width: "56px", height: "5px", backgroundColor: "#6366f1", borderRadius: "3px", marginBottom: "48px" }} />

        {/* App name */}
        <div style={{ display: "flex", fontSize: "88px", fontWeight: 800, color: "#ffffff", letterSpacing: "-3px", marginBottom: "28px", lineHeight: 1 }}>
          Taskboard
        </div>

        {/* Tagline */}
        <div style={{ display: "flex", fontSize: "34px", color: "#64748b", fontWeight: 400, letterSpacing: "-0.5px" }}>
          Tasks, notes, and journal — all in one
        </div>

        {/* Bottom feature badges */}
        <div style={{ display: "flex", marginTop: "auto", gap: "14px" }}>
          {["Kanban", "Notes", "Journal", "Files", "E2E Encrypted"].map((label) => (
            <div key={label} style={{ display: "flex", backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "8px", padding: "8px 16px" }}>
              <span style={{ color: "#94a3b8", fontSize: "17px" }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size }
  );
}
