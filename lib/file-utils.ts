import { join } from "path";
import { mkdir } from "fs/promises";
import { existsSync } from "fs";

export const UPLOAD_DIR = join(process.cwd(), "data", "uploads");
export const THUMB_DIR = join(process.cwd(), "data", "thumbnails");

export async function ensureFileDirs() {
  if (!existsSync(UPLOAD_DIR)) await mkdir(UPLOAD_DIR, { recursive: true });
  if (!existsSync(THUMB_DIR)) await mkdir(THUMB_DIR, { recursive: true });
}

export type FileKind = "image" | "video" | "audio" | "document" | "archive" | "text";

interface AllowedType {
  mime: string;
  kind: FileKind;
  magic?: (b: Buffer) => boolean;
}

// ftyp container check (MP4, MOV, HEIC, M4A all use ISO Base Media File Format)
const isFtyp = (b: Buffer) => b.length > 11 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70;

// Text content heuristic: fewer than 5% non-printable bytes
function isLikelyText(b: Buffer): boolean {
  const sample = b.slice(0, Math.min(512, b.length));
  if (sample.length === 0) return true;
  let nonPrintable = 0;
  for (const byte of sample) {
    if (byte !== 9 && byte !== 10 && byte !== 13 && (byte < 32 || byte === 127)) nonPrintable++;
  }
  return nonPrintable / sample.length < 0.05;
}

const ALLOWED: Record<string, AllowedType> = {
  // Images
  jpg:  { mime: "image/jpeg",    kind: "image",    magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  jpeg: { mime: "image/jpeg",    kind: "image",    magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  png:  { mime: "image/png",     kind: "image",    magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  gif:  { mime: "image/gif",     kind: "image",    magic: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  webp: { mime: "image/webp",    kind: "image",    magic: (b) => b.length > 11 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
  heic: { mime: "image/heic",    kind: "image",    magic: isFtyp },
  heif: { mime: "image/heif",    kind: "image",    magic: isFtyp },
  // Video
  mp4:  { mime: "video/mp4",     kind: "video",    magic: isFtyp },
  mov:  { mime: "video/quicktime", kind: "video",  magic: isFtyp },
  m4v:  { mime: "video/mp4",     kind: "video",    magic: isFtyp },
  // Audio
  mp3:  { mime: "audio/mpeg",    kind: "audio",    magic: (b) => (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) || (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) },
  m4a:  { mime: "audio/mp4",     kind: "audio",    magic: isFtyp },
  // Documents
  pdf:  { mime: "application/pdf", kind: "document", magic: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  docx: { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", kind: "document", magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  xlsx: { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",       kind: "document", magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  pptx: { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", kind: "document", magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  odt:  { mime: "application/vnd.oasis.opendocument.text",        kind: "document", magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  ods:  { mime: "application/vnd.oasis.opendocument.spreadsheet", kind: "document", magic: (b) => b[0] === 0x50 && b[1] === 0x4b },
  txt:  { mime: "text/plain",    kind: "text", magic: isLikelyText },
  md:   { mime: "text/markdown", kind: "text", magic: isLikelyText },
  // Archives
  zip:  { mime: "application/zip", kind: "archive", magic: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04 },
};

export interface DetectedFile {
  mime: string;
  ext: string;
  kind: FileKind;
}

export function detectFileType(buffer: Buffer, originalName: string): DetectedFile | null {
  const ext = originalName.split(".").pop()?.toLowerCase() ?? "";
  const extType = ALLOWED[ext];

  // Fast path: extension is known and magic bytes confirm it.
  if (extType && (!extType.magic || extType.magic(buffer))) {
    return { mime: extType.mime, ext, kind: extType.kind };
  }

  // Fallback: extension unknown or magic mismatch (e.g. iOS transcodes HEIC → JPEG
  // but keeps the original .heic filename).  Scan all non-text binary magic checks.
  for (const [k, type] of Object.entries(ALLOWED)) {
    if (type.kind !== "text" && type.magic && type.magic(buffer)) {
      return { mime: type.mime, ext: k, kind: type.kind };
    }
  }

  return null;
}

export function isImage(mimeType: string) {
  return mimeType.startsWith("image/");
}

export function kindFromMime(mimeType: string): FileKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType === "text/plain" || mimeType === "text/markdown") return "text";
  if (mimeType === "application/zip") return "archive";
  return "document";
}
