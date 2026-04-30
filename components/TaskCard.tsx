"use client";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Chip from "@mui/material/Chip";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";
import ImageOutlinedIcon from "@mui/icons-material/ImageOutlined";
import dayjs from "dayjs";
import { Task } from "@/lib/types";

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
}

export default function TaskCard({ task, onClick }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: task.id });

  const style = { transform: CSS.Transform.toString(transform), transition };
  const pColor = projectColor(task.projectId);
  const isOverdue = !task.archived && !!task.dueDate && dayjs(task.dueDate).isBefore(dayjs(), "day");
  const hasImage = task.description?.includes("<img");

  return (
    <Box
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      sx={{
        backgroundColor: isDragging ? "#f8fafc" : "#fff",
        borderRadius: 2,
        p: 2,
        mb: 1.25,
        cursor: isDragging ? "grabbing" : "pointer",
        boxShadow: isDragging
          ? "0 12px 32px rgba(0,0,0,0.16)"
          : "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
        border: task.archived ? "1.5px dashed #cbd5e1" : "1px solid rgba(0,0,0,0.04)",
        opacity: isDragging ? 0.5 : task.archived ? 0.6 : 1,
        "&:hover": {
          boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
          transform: isDragging ? undefined : "translateY(-1px)",
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

      {/* Title */}
      <Typography sx={{
        fontWeight: 500,
        fontSize: "0.9rem",
        lineHeight: 1.5,
        color: "#1e293b",
        mb: (task.priority || task.dueDate) ? 1.25 : 0,
      }}>
        {task.title}
      </Typography>

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
            <ImageOutlinedIcon sx={{ fontSize: 14, color: "#94a3b8", ml: "auto" }} />
          )}
        </Box>
      )}
    </Box>
  );
}
