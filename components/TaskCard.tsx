"use client";
import { useMemo } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import AddTaskIcon from "@mui/icons-material/AddTask";
import Tooltip from "@mui/material/Tooltip";
import IconButton from "@mui/material/IconButton";
import dayjs from "dayjs";
import { Task } from "@/lib/types";

function descriptionPreview(html: string | null | undefined): string {
  if (!html) return "";
  const plain = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ").trim();
  return plain.length > 200 ? plain.slice(0, 200) + "…" : plain;
}

const PRIORITY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  high:   { bg: "#fff1f2", text: "#e11d48", border: "#fecdd3" },
  medium: { bg: "#fffbeb", text: "#d97706", border: "#fde68a" },
  low:    { bg: "#f0fdf4", text: "#16a34a", border: "#bbf7d0" },
};

const PROJECT_COLORS = [
  "#f59e0b", "#10b981", "#3b82f6", "#ec4899",
  "#8b5cf6", "#0ea5e9", "#14b8a6", "#f43f5e", "#84cc16", "#6366f1",
];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(31, h) + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}
function projectColor(id: string) {
  return PROJECT_COLORS[hashId(id) % PROJECT_COLORS.length];
}

interface Props {
  task: Task;
  onClick: () => void;
  onAddToFocus?: () => void;
  privacyMode?: boolean;
}

export default function TaskCard({ task, onClick, onAddToFocus, privacyMode }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  const style = { transform: CSS.Transform.toString(transform), transition };
  const pColor = task.project?.color ?? projectColor(task.projectId);
  const descPreview = useMemo(() => descriptionPreview(task.description), [task.description]);
  const isOverdue = !task.archived && !!task.dueDate && dayjs(task.dueDate).isBefore(dayjs(), "day");
  const hasImage = task.description?.includes("<img");

  // Sensitive tasks: blank card when privacy mode is on. When the vault is unlocked,
  // privacyMode is set to false by the TaskBoard, so locked tasks become visible.
  const isRedacted = task.sensitive && !!privacyMode;

  if (isRedacted) {
    return (
      <Box
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        sx={{
          backgroundColor: "var(--border)",
          borderRadius: 2,
          mb: 1.25,
          height: 52,
          cursor: isDragging ? "grabbing" : "default",
          boxShadow: isDragging
            ? "0 12px 32px rgba(0,0,0,0.16)"
            : "0 1px 3px rgba(0,0,0,0.06)",
          border: "1px solid var(--border-2)",
          opacity: isDragging ? 0.5 : 1,
          userSelect: "none",
        }}
      />
    );
  }

  return (
    <Box
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      sx={{
        backgroundColor: isDragging ? "var(--surface-2)" : "var(--surface)",
        borderRadius: 2,
        p: 2,
        mb: 1.25,
        cursor: isDragging ? "grabbing" : "pointer",
        boxShadow: isDragging
          ? "0 12px 32px rgba(0,0,0,0.16)"
          : "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
        border: task.archived ? "1.5px dashed var(--border-2)" : "1px solid var(--border)",
        opacity: isDragging ? 0.5 : task.archived ? 0.6 : 1,
        "&:hover": {
          boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
          transform: isDragging ? undefined : "translateY(-1px)",
          "& .pin-btn": { opacity: 1 },
        },
        transition: "box-shadow 0.15s ease, transform 0.15s ease",
        userSelect: "none",
      }}
    >
      {/* Project label */}
      {task.project && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 1 }}>
          <Box sx={{ width: 3, height: 14, borderRadius: 2, backgroundColor: pColor, flexShrink: 0 }} />
          <Typography sx={{
            color: pColor,
            fontWeight: 700,
            fontSize: "0.7rem",
            textTransform: "uppercase",
            letterSpacing: 0.6,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {task.project.name}
          </Typography>
        </Box>
      )}

      {/* Title row */}
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.5, mb: (task.priority || task.dueDate) ? 1.25 : 0 }}>
        <Tooltip
          title={descPreview || ""}
          placement="right"
          disableFocusListener
          disableTouchListener
          enterDelay={600}
          slotProps={{ tooltip: { sx: { maxWidth: 280, fontSize: "0.78rem", lineHeight: 1.5, whiteSpace: "pre-wrap" } } }}
        >
          <Typography sx={{ fontWeight: 500, fontSize: "0.9rem", lineHeight: 1.5, color: "var(--tx)", flex: 1 }}>
            {task.title}
          </Typography>
        </Tooltip>
        {onAddToFocus && (
          <Tooltip title="Add to today's focus" placement="top">
            <IconButton
              size="small"
              className="pin-btn"
              onClick={(e) => { e.stopPropagation(); onAddToFocus(); }}
              sx={{
                p: 0.3, opacity: 0, flexShrink: 0, mt: "-2px",
                color: "var(--tx-4)", transition: "opacity 0.15s, color 0.15s",
                "&:hover": { color: "#6366f1", backgroundColor: "transparent" },
              }}
            >
              <AddTaskIcon sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Meta row */}
      {(task.priority || task.dueDate || hasImage) && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
          {task.priority && (
            <Chip
              label={task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
              size="small"
              sx={{
                height: 22,
                fontSize: "0.7rem",
                fontWeight: 700,
                backgroundColor: PRIORITY_COLORS[task.priority].bg,
                color: PRIORITY_COLORS[task.priority].text,
                border: `1px solid ${PRIORITY_COLORS[task.priority].border}`,
                "& .MuiChip-label": { px: 1 },
              }}
            />
          )}
          {task.dueDate && (
            <Box sx={{
              display: "flex", alignItems: "center", gap: 0.5,
              color: isOverdue ? "#e11d48" : "#64748b",
            }}>
              <CalendarTodayIcon sx={{ fontSize: 12 }} />
              <Typography sx={{
                fontSize: "0.75rem",
                fontWeight: isOverdue ? 700 : 400,
                color: isOverdue ? "#e11d48" : "#64748b",
              }}>
                {dayjs(task.dueDate).format("MMM D")}
              </Typography>
            </Box>
          )}
          {hasImage && (
            <ImageOutlinedIcon sx={{ fontSize: 14, color: "var(--tx-4)", ml: "auto" }} />
          )}
        </Box>
      )}
    </Box>
  );
}
