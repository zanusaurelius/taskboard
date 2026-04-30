"use client";
import { useState, useRef, useCallback } from "react";
import { NodeViewWrapper, ReactNodeViewRenderer, ReactNodeViewProps } from "@tiptap/react";
import Image from "@tiptap/extension-image";

function ResizableImageView({ node, updateAttributes, selected }: ReactNodeViewProps) {
  const attrs = node.attrs as { src?: string; alt?: string; width?: number | null };
  const [hovered, setHovered] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const resizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const onResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = true;
    startX.current = e.clientX;
    startWidth.current = imgRef.current?.offsetWidth ?? (attrs.width ?? 300);

    const onMove = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const newWidth = Math.max(80, Math.round(startWidth.current + ev.clientX - startX.current));
      updateAttributes({ width: newWidth });
    };
    const onUp = () => {
      resizing.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, [node.attrs.width, updateAttributes]);

  const showHandle = selected || hovered;

  return (
    <NodeViewWrapper
      as="span"
      style={{ display: "inline-block", position: "relative", verticalAlign: "bottom", margin: "4px 0" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <img
        ref={imgRef}
        src={attrs.src}
        alt={attrs.alt ?? ""}
        draggable={false}
        style={{
          width: attrs.width ? `${attrs.width}px` : "auto",
          maxWidth: "100%",
          maxHeight: attrs.width ? "none" : "200px",
          height: "auto",
          display: "block",
          borderRadius: "8px",
          outline: selected ? "2px solid #6366f1" : hovered ? "2px solid #c7d2fe" : "none",
          outlineOffset: "2px",
          cursor: "default",
          userSelect: "none",
        }}
      />
      {showHandle && (
        <span
          title="Drag to resize"
          onMouseDown={onResizeStart}
          style={{
            position: "absolute",
            bottom: 6,
            right: 6,
            width: 14,
            height: 14,
            background: "#6366f1",
            borderRadius: "3px",
            cursor: "se-resize",
            boxShadow: "0 1px 4px rgba(0,0,0,0.35)",
            display: "block",
          }}
        />
      )}
    </NodeViewWrapper>
  );
}

export const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (el) => {
          const w = el.style.width || el.getAttribute("width");
          return w ? parseInt(w as string) : null;
        },
        renderHTML: (attrs) => (attrs.width ? { style: `width: ${attrs.width}px` } : {}),
      },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
}).configure({ inline: true, allowBase64: true });
