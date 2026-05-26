"use client";
import { useState, useRef } from "react";
import { useEditor, EditorContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import UnderlineExt from "@tiptap/extension-underline";
import { ResizableImage } from "./ResizableImage";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import FormatBoldIcon from "@mui/icons-material/FormatBold";
import FormatItalicIcon from "@mui/icons-material/FormatItalic";
import FormatUnderlinedIcon from "@mui/icons-material/FormatUnderlined";
import FormatListBulletedIcon from "@mui/icons-material/FormatListBulleted";
import FormatListNumberedIcon from "@mui/icons-material/FormatListNumbered";
import ImageIcon from "@mui/icons-material/Image";
import CodeIcon from "@mui/icons-material/Code";

interface Props {
  value: string;
  onChange: (html: string) => void;
  minHeight?: number;
}

async function uploadImage(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Upload failed");
  }
  const { url } = await res.json();
  return url;
}

// Insert image immediately with a local object URL, then swap to the real URL
// after the upload completes. This prevents the async gap that wipes images on typing.
async function insertImageWithUpload(editor: Editor, file: File) {
  const localUrl = URL.createObjectURL(file);

  // Insert synchronously — user can type immediately, image stays in place
  editor.chain().focus().setImage({ src: localUrl }).run();

  try {
    const realUrl = await uploadImage(file);

    // Swap the local URL out for the real one
    const { state, dispatch } = editor.view;
    const tr = state.tr;
    let found = false;
    state.doc.nodesBetween(0, state.doc.content.size, (node, pos) => {
      if (node.type.name === "image" && node.attrs.src === localUrl && !found) {
        tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: realUrl });
        found = true;
      }
    });
    if (found) dispatch(tr);
  } catch {
    // Upload failed — remove the optimistically-inserted image so the editor
    // doesn't end up with a broken src
    const { state, dispatch } = editor.view;
    const tr = state.tr;
    state.doc.nodesBetween(0, state.doc.content.size, (node, pos) => {
      if (node.type.name === "image" && node.attrs.src === localUrl) {
        tr.delete(pos, pos + node.nodeSize);
        return false;
      }
    });
    dispatch(tr);
  } finally {
    URL.revokeObjectURL(localUrl);
  }
}

export default function RichTextEditor({ value, onChange, minHeight = 130 }: Props) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Keep a stable ref to the editor for use inside editorProps callbacks
  const editorRef = useRef<Editor | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      UnderlineExt,
      ResizableImage,
    ],
    content: value || "",
    onCreate: ({ editor }) => { editorRef.current = editor; },
    onUpdate: ({ editor }) => {
      editorRef.current = editor;
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: { class: "rte-content" },

      handleDrop: (_view, event, _slice, moved) => {
        if (moved) return false; // let Tiptap handle text node reordering
        const files = Array.from(event.dataTransfer?.files ?? []).filter((f) =>
          f.type.startsWith("image/")
        );
        if (files.length === 0 || !editorRef.current) return false;
        event.preventDefault();
        files.forEach((file) => insertImageWithUpload(editorRef.current!, file));
        return true;
      },

      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) =>
          f.type.startsWith("image/")
        );
        if (files.length === 0 || !editorRef.current) return false;
        event.preventDefault();
        files.forEach((file) => insertImageWithUpload(editorRef.current!, file));
        return true;
      },
    },
  });

  if (!editor) return null;

  const btnSx = (active: boolean) => ({
    p: 0.6, borderRadius: 1,
    color: active ? "#6366f1" : "#64748b",
    backgroundColor: active ? "#eef0ff" : "transparent",
    "&:hover": { backgroundColor: active ? "#e0e4ff" : "#f1f5f9" },
  });

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editorRef.current) return;
    e.target.value = "";
    await insertImageWithUpload(editorRef.current, file);
  };

  return (
    <Box
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragOver(false);
      }}
      onDrop={() => setIsDragOver(false)}
      sx={{
        border: isDragOver ? "2px dashed #6366f1" : "1px solid #e2e8f0",
        borderRadius: 2,
        overflow: "hidden",
        backgroundColor: isDragOver ? "#f5f6ff" : "transparent",
        transition: "border-color 0.15s, box-shadow 0.15s, background-color 0.15s",
        "&:focus-within": {
          borderColor: "#6366f1",
          boxShadow: "0 0 0 2px rgba(99,102,241,0.15)",
        },
      }}
    >
      {/* Toolbar */}
      <Box sx={{
        display: "flex", alignItems: "center", gap: 0.25,
        px: 1.25, py: 0.75,
        borderBottom: "1px solid #f1f5f9",
        backgroundColor: "#fafafa",
        flexWrap: "wrap",
      }}>
        <Tooltip title="Bold (⌘B)" placement="top">
          <IconButton size="small" onClick={() => editor.chain().focus().toggleBold().run()} sx={btnSx(editor.isActive("bold"))}>
            <FormatBoldIcon sx={{ fontSize: 19 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Italic (⌘I)" placement="top">
          <IconButton size="small" onClick={() => editor.chain().focus().toggleItalic().run()} sx={btnSx(editor.isActive("italic"))}>
            <FormatItalicIcon sx={{ fontSize: 19 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Underline (⌘U)" placement="top">
          <IconButton size="small" onClick={() => editor.chain().focus().toggleUnderline().run()} sx={btnSx(editor.isActive("underline"))}>
            <FormatUnderlinedIcon sx={{ fontSize: 19 }} />
          </IconButton>
        </Tooltip>

        <Divider orientation="vertical" flexItem sx={{ mx: 0.75, borderColor: "#e2e8f0" }} />

        <Tooltip title="Bullet list" placement="top">
          <IconButton size="small" onClick={() => editor.chain().focus().toggleBulletList().run()} sx={btnSx(editor.isActive("bulletList"))}>
            <FormatListBulletedIcon sx={{ fontSize: 19 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Numbered list" placement="top">
          <IconButton size="small" onClick={() => editor.chain().focus().toggleOrderedList().run()} sx={btnSx(editor.isActive("orderedList"))}>
            <FormatListNumberedIcon sx={{ fontSize: 19 }} />
          </IconButton>
        </Tooltip>

        <Divider orientation="vertical" flexItem sx={{ mx: 0.75, borderColor: "#e2e8f0" }} />

        <Tooltip title="Code" placement="top">
          <IconButton size="small" onClick={() => editor.chain().focus().toggleCode().run()} sx={btnSx(editor.isActive("code"))}>
            <CodeIcon sx={{ fontSize: 19 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Upload image" placement="top">
          <IconButton size="small" onClick={() => fileRef.current?.click()} sx={btnSx(false)}>
            <ImageIcon sx={{ fontSize: 19 }} />
          </IconButton>
        </Tooltip>
        <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFileInput} />
      </Box>

      {/* Editor area */}
      <Box
        onClick={() => editor.commands.focus()}
        sx={{
          px: 2, py: 1.5,
          minHeight,
          cursor: "text",
          position: "relative",
          "& .rte-content": {
            outline: "none",
            minHeight,
            fontSize: "0.9rem",
            lineHeight: 1.65,
            color: "#1e293b",
          },
          "& .rte-content p": { margin: "0 0 0.4em" },
          "& .rte-content p:last-child": { marginBottom: 0 },
          "& .rte-content ul, & .rte-content ol": { paddingLeft: "1.5em", margin: "0 0 0.4em" },
          "& .rte-content li": { marginBottom: "0.2em" },
          "& .rte-content strong": { fontWeight: 700 },
          "& .rte-content em": { fontStyle: "italic" },
          "& .rte-content u": { textDecoration: "underline" },
          "& .rte-content code": {
            backgroundColor: "#f1f5f9",
            borderRadius: "4px",
            padding: "0 4px",
            fontFamily: "monospace",
            fontSize: "0.85em",
          },
          "& .rte-content img": {
            maxHeight: "200px",
            maxWidth: "100%",
            width: "auto",
            height: "auto",
            borderRadius: "8px",
            display: "block",
            margin: "8px 0",
          },
          "& .rte-content h1": { fontSize: "1.5em", fontWeight: 700, margin: "0.5em 0 0.3em" },
          "& .rte-content h2": { fontSize: "1.25em", fontWeight: 700, margin: "0.5em 0 0.3em" },
          "& .rte-content h3": { fontSize: "1.1em", fontWeight: 600, margin: "0.5em 0 0.3em" },
          "& .rte-content blockquote": {
            borderLeft: "3px solid #e2e8f0",
            paddingLeft: "1em",
            color: "#64748b",
            margin: "0.5em 0",
          },
        }}
      >
        <EditorContent editor={editor} />

        {isDragOver && (
          <Box sx={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            pointerEvents: "none",
            backgroundColor: "rgba(238,240,255,0.6)",
          }}>
            <Typography sx={{ color: "#6366f1", fontWeight: 700, fontSize: "0.95rem" }}>
              Drop image here
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
