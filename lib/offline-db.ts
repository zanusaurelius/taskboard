import type { Note } from "./types";

const DB_NAME = "taskboard-offline";
const DB_VERSION = 1;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("notes")) {
        db.createObjectStore("notes", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("write-queue")) {
        const qs = db.createObjectStore("write-queue", { keyPath: "id" });
        qs.createIndex("seq", "seq");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function run<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ── Notes cache ──────────────────────────────────────────────────────────────

export async function getCachedNotes(): Promise<Note[]> {
  const db = await openDB();
  const tx = db.transaction("notes", "readonly");
  return run(tx.objectStore("notes").getAll());
}

export async function setCachedNotes(notes: Note[]): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("notes", "readwrite");
    const store = tx.objectStore("notes");
    store.clear();
    for (const note of notes) store.put(note);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function upsertCachedNote(note: Note): Promise<void> {
  const db = await openDB();
  const tx = db.transaction("notes", "readwrite");
  await run(tx.objectStore("notes").put(note));
}

export async function removeCachedNote(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction("notes", "readwrite");
  await run(tx.objectStore("notes").delete(id) as IDBRequest<undefined>);
}

// ── Write queue ───────────────────────────────────────────────────────────────

export type QueuedOp =
  | { id: string; seq: number; type: "create-note"; tempId: string; fields: Record<string, unknown> }
  | { id: string; seq: number; type: "update-note"; noteId: string; fields: Record<string, unknown> }
  | { id: string; seq: number; type: "delete-note"; noteId: string };

export type QueuedOpInput =
  | { type: "create-note"; tempId: string; fields: Record<string, unknown> }
  | { type: "update-note"; noteId: string; fields: Record<string, unknown> }
  | { type: "delete-note"; noteId: string };

let _seq = 0;
function nextSeq() {
  _seq = Math.max(_seq + 1, Date.now());
  return _seq;
}

export async function enqueueOp(op: QueuedOpInput): Promise<void> {
  const db = await openDB();
  const id = `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const full = { ...op, id, seq: nextSeq() };
  const tx = db.transaction("write-queue", "readwrite");
  await run(tx.objectStore("write-queue").add(full));
}

export async function getQueue(): Promise<QueuedOp[]> {
  const db = await openDB();
  const tx = db.transaction("write-queue", "readonly");
  return new Promise((resolve, reject) => {
    const req = tx.objectStore("write-queue").index("seq").getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function removeOp(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction("write-queue", "readwrite");
  await run(tx.objectStore("write-queue").delete(id) as IDBRequest<undefined>);
}

export async function getQueueLength(): Promise<number> {
  const db = await openDB();
  const tx = db.transaction("write-queue", "readonly");
  return new Promise((resolve, reject) => {
    const req = tx.objectStore("write-queue").count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
