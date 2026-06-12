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
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          backgroundColor: "#0f172a",
          position: "relative",
        }}
      >
        {/* Decorative kanban — top-right */}
        <div style={{ display: "flex", position: "absolute", top: "40px", right: "60px", gap: "14px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", width: "70px", height: "5px", backgroundColor: "#6366f1", borderRadius: "3px", opacity: 0.5 }} />
            <div style={{ display: "flex", width: "70px", height: "30px", backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "5px" }} />
            <div style={{ display: "flex", width: "70px", height: "34px", backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "5px" }} />
            <div style={{ display: "flex", width: "70px", height: "30px", backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "5px" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", width: "70px", height: "5px", backgroundColor: "#6366f1", borderRadius: "3px", opacity: 0.7 }} />
            <div style={{ display: "flex", width: "70px", height: "34px", backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "5px" }} />
            <div style={{ display: "flex", width: "70px", height: "30px", backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "5px" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", width: "70px", height: "5px", backgroundColor: "#6366f1", borderRadius: "3px", opacity: 0.9 }} />
            <div style={{ display: "flex", width: "70px", height: "30px", backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "5px" }} />
            <div style={{ display: "flex", width: "70px", height: "34px", backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "5px" }} />
            <div style={{ display: "flex", width: "70px", height: "38px", backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "5px" }} />
            <div style={{ display: "flex", width: "70px", height: "30px", backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "5px" }} />
          </div>
        </div>
        {/* Decorative kanban — bottom-left */}
        <div style={{ display: "flex", position: "absolute", bottom: "40px", left: "60px", gap: "14px", opacity: 0.4 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", width: "60px", height: "5px", backgroundColor: "#6366f1", borderRadius: "3px" }} />
            <div style={{ display: "flex", width: "60px", height: "28px", backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "5px" }} />
            <div style={{ display: "flex", width: "60px", height: "28px", backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "5px" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", width: "60px", height: "5px", backgroundColor: "#6366f1", borderRadius: "3px" }} />
            <div style={{ display: "flex", width: "60px", height: "28px", backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "5px" }} />
          </div>
        </div>

        {/* Accent bar */}
        <div style={{ display: "flex", width: "56px", height: "5px", backgroundColor: "#6366f1", borderRadius: "3px", marginBottom: "40px" }} />

        {/* App name */}
        <div style={{ display: "flex", justifyContent: "center", fontSize: "96px", fontWeight: 800, color: "#ffffff", letterSpacing: "-4px", marginBottom: "24px", lineHeight: 1 }}>
          Taskboard
        </div>

        {/* Tagline */}
        <div style={{ display: "flex", justifyContent: "center", fontSize: "32px", color: "#64748b", fontWeight: 400 }}>
          Tasks, notes, and journal — all in one
        </div>

        {/* Feature badges */}
        <div style={{ display: "flex", marginTop: "52px", gap: "12px" }}>
          {["Kanban", "Notes", "Journal", "Files", "E2E Encrypted"].map((label) => (
            <div key={label} style={{ display: "flex", backgroundColor: "#1e293b", border: "1px solid #334155", borderRadius: "8px", padding: "10px 18px" }}>
              <span style={{ color: "#94a3b8", fontSize: "17px" }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size }
  );
}
