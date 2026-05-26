import { getQueue, removeOp, upsertCachedNote, removeCachedNote } from "./offline-db";
import { useTaskBoardStore } from "./store";
import type { Note } from "./types";

export type SyncResult = { synced: number; errors: number };

export async function flushWriteQueue(): Promise<SyncResult> {
  const ops = await getQueue();
  if (ops.length === 0) return { synced: 0, errors: 0 };

  const idMap = new Map<string, string>(); // tempId → realId
  let synced = 0;
  let errors = 0;

  for (const op of ops) {
    try {
      if (op.type === "create-note") {
        const res = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(op.fields),
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const note: Note = await res.json();
        idMap.set(op.tempId, note.id);
        useTaskBoardStore.setState((s) => ({
          notes: s.notes.map((n) => (n.id === op.tempId ? note : n)),
        }));
        await upsertCachedNote(note);
        await removeCachedNote(op.tempId);
      } else if (op.type === "update-note") {
        const realId = idMap.get(op.noteId) ?? op.noteId;
        const res = await fetch(`/api/notes/${realId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(op.fields),
        });
        if (!res.ok) throw new Error(`${res.status}`);
        const note: Note = await res.json();
        useTaskBoardStore.setState((s) => ({
          notes: s.notes.map((n) => (n.id === realId ? note : n)),
        }));
        await upsertCachedNote(note);
      } else if (op.type === "delete-note") {
        const isTemp = op.noteId.startsWith("temp_");
        if (isTemp && !idMap.has(op.noteId)) {
          // Create never flushed successfully — skip the delete too
        } else {
          const realId = idMap.get(op.noteId) ?? op.noteId;
          const res = await fetch(`/api/notes/${realId}`, { method: "DELETE" });
          if (!res.ok && res.status !== 404) throw new Error(`${res.status}`);
          await removeCachedNote(realId);
        }
      }
      await removeOp(op.id);
      synced++;
    } catch (e) {
      console.error("[sync] op failed:", op.type, e);
      errors++;
      // Continue with remaining ops rather than halting the whole queue
    }
  }

  return { synced, errors };
}
