import { create } from "zustand";
import { Task, Project, Note, Folder } from "./types";
import {
  getCachedNotes, setCachedNotes, upsertCachedNote, removeCachedNote, enqueueOp,
} from "./offline-db";
import { encryptContent, decryptContent } from "./vault-crypto";

// ── Encryption helpers ────────────────────────────────────────────────────────

async function encField(text: string | null | undefined, key: Uint8Array): Promise<string | null> {
  if (!text) return null;
  return JSON.stringify(await encryptContent(text, key));
}

async function decField(enc: string | null | undefined, key: Uint8Array): Promise<string | null> {
  if (!enc) return null;
  try { return await decryptContent(JSON.parse(enc), key); } catch { return null; }
}

async function decryptTask(t: Task, key: Uint8Array): Promise<Task> {
  return {
    ...t,
    title: t.encTitle ? ((await decField(t.encTitle, key)) ?? t.title) : t.title,
    description: t.encDescription ? ((await decField(t.encDescription, key)) ?? t.description) : t.description,
  };
}

async function decryptProject(p: Project, key: Uint8Array): Promise<Project> {
  return {
    ...p,
    name: p.encName ? ((await decField(p.encName, key)) ?? p.name) : p.name,
  };
}

async function decryptFolder(f: Folder, key: Uint8Array): Promise<Folder> {
  return {
    ...f,
    name: f.encName ? ((await decField(f.encName, key)) ?? f.name) : f.name,
  };
}

// ── Store interface ───────────────────────────────────────────────────────────

interface TaskBoardStore {
  masterKey: Uint8Array | null;
  setMasterKey: (key: Uint8Array | null) => Promise<void>;

  tasks: Task[];
  projects: Project[];
  notes: Note[];
  trashNotes: Note[];
  fetchAll: (includeArchivedTasks?: boolean, includeArchivedProjects?: boolean) => Promise<void>;
  createTask: (fields: Partial<Task>) => Promise<Task>;
  updateTask: (id: string, fields: Partial<Task>) => Promise<Task>;
  deleteTask: (id: string) => Promise<void>;
  createProject: (name: string, color?: string | null) => Promise<Project>;
  updateProject: (id: string, fields: Partial<Project>) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;
  permanentDeleteProject: (id: string) => Promise<void>;
  archiveAllDone: () => Promise<void>;
  folders: Folder[];
  fetchFolders: (revealToken?: string) => Promise<void>;
  createFolder: (name: string) => Promise<Folder>;
  updateFolder: (id: string, name: string) => Promise<void>;
  patchFolder: (id: string, fields: Partial<Pick<Folder, "name" | "pinned" | "hidden" | "locked">>) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  fetchNotes: (revealToken?: string) => Promise<void>;
  fetchTrash: () => Promise<void>;
  createNote: () => Promise<Note>;
  duplicateNote: (id: string) => Promise<Note>;
  updateNote: (id: string, fields: Partial<Note>, revealToken?: string) => Promise<void>;
  deleteNote: (id: string) => Promise<boolean>;
  restoreNote: (id: string) => Promise<void>;
  permanentDeleteNote: (id: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
}

export const useTaskBoardStore = create<TaskBoardStore>((set, get) => ({
  masterKey: null,
  tasks: [],
  projects: [],
  notes: [],
  trashNotes: [],
  folders: [],

  setMasterKey: async (key) => {
    set({ masterKey: key });
    if (!key) {
      // Vault locked — redact locked tasks in-memory (mirrors what the server returns)
      set((s) => ({
        tasks: s.tasks.map((t) =>
          t.locked ? { ...t, title: "", description: null } : t,
        ),
      }));
      return;
    }
    const { tasks, projects, folders } = get();
    const [decTasks, decProjects, decFolders] = await Promise.all([
      Promise.all(tasks.map((t) => decryptTask(t, key))),
      Promise.all(projects.map((p) => decryptProject(p, key))),
      Promise.all(folders.map((f) => decryptFolder(f, key))),
    ]);
    set({
      tasks: decTasks,
      projects: decProjects.sort((a, b) => a.name.localeCompare(b.name)),
      folders: decFolders.sort((a, b) => a.name.localeCompare(b.name)),
    });
  },

  fetchFolders: async (revealToken?: string) => {
    const res = await fetch("/api/folders", {
      headers: revealToken ? { "x-reveal-token": revealToken } : {},
    });
    if (!res.ok) return;
    let folders: Folder[] = await res.json();
    const { masterKey } = get();
    if (masterKey) {
      folders = await Promise.all(folders.map((f) => decryptFolder(f, masterKey)));
    }
    set({ folders: folders.sort((a, b) => a.name.localeCompare(b.name)) });
  },

  createFolder: async (name) => {
    const { masterKey } = get();
    const body: Record<string, unknown> = {};
    if (masterKey) {
      body.encName = await encField(name, masterKey);
      body.name = "";
    } else {
      body.name = name;
    }
    const res = await fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to create folder (${res.status})`);
    const raw: Folder = await res.json();
    const folder = masterKey ? await decryptFolder(raw, masterKey) : raw;
    set((s) => ({ folders: [...s.folders, folder].sort((a, b) => a.name.localeCompare(b.name)) }));
    return folder;
  },

  updateFolder: async (id, name) => {
    const { masterKey } = get();
    const body: Record<string, unknown> = {};
    if (masterKey) {
      body.encName = await encField(name, masterKey);
      body.name = "";
    } else {
      body.name = name;
    }
    const res = await fetch(`/api/folders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to update folder (${res.status})`);
    const raw: Folder = await res.json();
    const folder = masterKey ? await decryptFolder(raw, masterKey) : raw;
    set((s) => ({
      folders: s.folders.map((f) => f.id === id ? folder : f).sort((a, b) => a.name.localeCompare(b.name)),
    }));
  },

  patchFolder: async (id, fields) => {
    const { masterKey } = get();
    const body: Record<string, unknown> = { ...fields };
    if (masterKey && typeof fields.name === "string") {
      body.encName = await encField(fields.name, masterKey);
      body.name = "";
    }
    const res = await fetch(`/api/folders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to patch folder (${res.status})`);
    const raw: Folder = await res.json();
    const folder = masterKey ? await decryptFolder(raw, masterKey) : raw;
    set((s) => ({
      folders: s.folders.map((f) => f.id === id ? folder : f).sort((a, b) => a.name.localeCompare(b.name)),
    }));
  },

  deleteFolder: async (id) => {
    const res = await fetch(`/api/folders/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`Failed to delete folder (${res.status})`);
    set((s) => ({
      folders: s.folders.filter((f) => f.id !== id),
      notes: s.notes.map((n) => n.folderId === id ? { ...n, folderId: null } : n),
    }));
  },

  fetchAll: async (includeArchivedTasks = false, includeArchivedProjects = false) => {
    const [tasksRes, projectsRes] = await Promise.all([
      fetch(`/api/tasks${includeArchivedTasks ? "?includeArchived=true" : ""}`),
      fetch(`/api/projects${includeArchivedProjects ? "?includeArchived=true" : ""}`),
    ]);
    if (!tasksRes.ok || !projectsRes.ok) return;
    let [tasks, projects]: [Task[], Project[]] = await Promise.all([tasksRes.json(), projectsRes.json()]);
    const { masterKey } = get();
    if (masterKey) {
      [tasks, projects] = await Promise.all([
        Promise.all(tasks.map((t) => decryptTask(t, masterKey))),
        Promise.all(projects.map((p) => decryptProject(p, masterKey))),
      ]);
    }
    set({ tasks, projects: projects.sort((a, b) => a.name.localeCompare(b.name)) });
  },

  createTask: async (fields) => {
    const { masterKey } = get();
    const body: Record<string, unknown> = { ...fields };
    if (masterKey && fields.sensitive) {
      if (fields.title) {
        body.encTitle = await encField(fields.title, masterKey);
        body.title = "";
      }
      if (fields.description) {
        body.encDescription = await encField(fields.description, masterKey);
        body.description = null;
      }
      body.locked = true;
    }
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to create task (${res.status})`);
    const raw: Task = await res.json();
    const task = masterKey ? await decryptTask(raw, masterKey) : raw;
    set((s) => ({ tasks: [...s.tasks, task] }));
    return task;
  },

  updateTask: async (id, fields) => {
    const { masterKey } = get();
    const body: Record<string, unknown> = { ...fields };
    if (fields.sensitive === false) {
      // Removing vault protection: clear encryption regardless of vault state
      body.locked = false;
      body.encTitle = null;
      body.encDescription = null;
    } else if (masterKey && fields.sensitive) {
      // Sensitive task with vault unlocked: encrypt content and lock
      if (typeof fields.title === "string") {
        body.encTitle = await encField(fields.title, masterKey);
        body.title = "";
      }
      if (fields.description !== undefined && fields.description !== null) {
        body.encDescription = await encField(fields.description, masterKey);
        body.description = null;
      }
      body.locked = true;
    }
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to update task (${res.status})`);
    const raw: Task = await res.json();
    const task = masterKey ? await decryptTask(raw, masterKey) : raw;
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? task : t)) }));
    return task;
  },

  deleteTask: async (id) => {
    const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`Failed to delete task (${res.status})`);
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
  },

  createProject: async (name, color) => {
    const { masterKey } = get();
    const body: Record<string, unknown> = { color: color ?? null };
    if (masterKey) {
      body.encName = await encField(name, masterKey);
      body.name = "";
    } else {
      body.name = name;
    }
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to create project (${res.status})`);
    const raw: Project = await res.json();
    const project = masterKey ? await decryptProject(raw, masterKey) : raw;
    set((s) => ({ projects: [...s.projects, project].sort((a, b) => a.name.localeCompare(b.name)) }));
    return project;
  },

  updateProject: async (id, fields) => {
    const { masterKey } = get();
    const body: Record<string, unknown> = { ...fields };
    if (masterKey && typeof fields.name === "string" && fields.name) {
      body.encName = await encField(fields.name, masterKey);
      body.name = "";
    }
    const res = await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to update project (${res.status})`);
    const raw: Project = await res.json();
    const project = masterKey ? await decryptProject(raw, masterKey) : raw;
    set((s) => ({
      projects: s.projects
        .map((p) => (p.id === id ? project : p))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));
    return project;
  },

  deleteProject: async (id) => {
    const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(`Failed to delete project (${res.status})`);
    set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, archived: true } : p)) }));
  },

  permanentDeleteProject: async (id) => {
    const res = await fetch(`/api/projects/${id}?permanent=true`, { method: "DELETE" });
    if (!res.ok) throw new Error(`Failed to permanently delete project (${res.status})`);
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      tasks: s.tasks.filter((t) => t.projectId !== id),
    }));
  },

  archiveAllDone: async () => {
    const doneTasks = get().tasks.filter((t) => t.stage === "done" && !t.archived);
    const results = await Promise.all(
      doneTasks.map((t) =>
        fetch(`/api/tasks/${t.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived: true }),
        }).then((res) => ({ id: t.id, ok: res.ok }))
      )
    );
    const archivedIds = new Set(results.filter((r) => r.ok).map((r) => r.id));
    if (archivedIds.size > 0) {
      set((s) => ({
        tasks: s.tasks.map((t) => archivedIds.has(t.id) ? { ...t, archived: true } : t),
      }));
    }
  },

  fetchNotes: async (revealToken?: string) => {
    const headers: HeadersInit = revealToken ? { "x-reveal-token": revealToken } : {};
    try {
      const res = await fetch("/api/notes", { headers });
      if (!res.ok) throw new Error("fetch failed");
      const notes = await res.json();
      set({ notes });
      setCachedNotes(notes).catch(() => {});
    } catch {
      const cached = await getCachedNotes().catch(() => [] as Note[]);
      if (cached.length > 0) set({ notes: cached });
    }
  },

  fetchTrash: async () => {
    const res = await fetch("/api/notes/trash");
    if (!res.ok) return;
    const trashNotes = await res.json();
    set({ trashNotes });
  },

  duplicateNote: async (id) => {
    const { masterKey } = get();
    const src = get().notes.find((n) => n.id === id);
    if (!src) throw new Error("Note not found");

    // src.title is the in-memory decrypted title (or empty if encrypted + locked)
    // src.encTitle holds the blob — re-encrypt for the copy
    const body: Record<string, unknown> = { folderId: src.folderId, projectId: src.projectId };
    if (masterKey && (src.encTitle || src.encContent)) {
      const plainTitle = src.title || (src.encTitle ? (await decField(src.encTitle, masterKey) ?? "") : "");
      const plainContent = src.content || (src.encContent ? (await decField(src.encContent, masterKey) ?? "") : "");
      body.encTitle = await encField(plainTitle ? `${plainTitle} (copy)` : "", masterKey);
      body.encContent = await encField(plainContent, masterKey);
      body.title = "";
      body.content = "";
    } else {
      body.title = src.title ? `${src.title} (copy)` : "";
      body.content = src.content;
    }

    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Failed to duplicate note");
    const note: Note = await res.json();
    set((s) => ({ notes: [note, ...s.notes] }));
    return note;
  },

  createNote: async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const now = new Date().toISOString();
      const tempNote: Note = {
        id: tempId, title: "", content: "",
        pinned: false, starred: false, hidden: false, locked: false,
        hint: null, encContent: null, encTitle: null,
        folderId: null, projectId: null,
        createdAt: now, updatedAt: now, deletedAt: null,
      };
      set((s) => ({ notes: [tempNote, ...s.notes] }));
      upsertCachedNote(tempNote).catch(() => {});
      await enqueueOp({ type: "create-note", tempId, fields: { title: "", content: "" } });
      return tempNote;
    }
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "", content: "" }),
    });
    if (!res.ok) throw new Error(`Failed to create note: ${res.status}`);
    const note: Note = await res.json();
    set((s) => ({ notes: [note, ...s.notes] }));
    upsertCachedNote(note).catch(() => {});
    return note;
  },

  updateNote: async (id, fields, revealToken?: string) => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const now = new Date().toISOString();
      set((s) => ({
        notes: s.notes.map((n) => n.id === id ? { ...n, ...fields, updatedAt: now } : n),
      }));
      const updated = get().notes.find((n) => n.id === id);
      if (updated) upsertCachedNote(updated).catch(() => {});
      await enqueueOp({ type: "update-note", noteId: id, fields: fields as Record<string, unknown> });
      return;
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (revealToken) headers["x-reveal-token"] = revealToken;
    const res = await fetch(`/api/notes/${id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify(fields),
    });
    if (!res.ok) {
      let message = `Failed to update note (${res.status})`;
      try { const err = await res.json(); if (err.error) message = err.error; } catch {}
      throw new Error(message);
    }
    const note: Note = await res.json();
    set((s) => ({
      notes: s.notes.map((n) => (n.id === id ? note : n)),
    }));
    upsertCachedNote(note).catch(() => {});
  },

  deleteNote: async (id) => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
      removeCachedNote(id).catch(() => {});
      await enqueueOp({ type: "delete-note", noteId: id });
      return true;
    }
    const res = await fetch(`/api/notes/${id}`, { method: "DELETE" });
    if (res.status === 200) {
      const trashed = await res.json();
      set((s) => ({
        notes: s.notes.filter((n) => n.id !== id),
        trashNotes: [trashed, ...s.trashNotes],
      }));
      removeCachedNote(id).catch(() => {});
      return true;
    }
    set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
    removeCachedNote(id).catch(() => {});
    return false;
  },

  restoreNote: async (id) => {
    const res = await fetch(`/api/notes/${id}/restore`, { method: "POST" });
    if (!res.ok) throw new Error(`Failed to restore note (${res.status})`);
    const note: Note = await res.json();
    set((s) => ({
      trashNotes: s.trashNotes.filter((n) => n.id !== id),
      notes: [note, ...s.notes],
    }));
  },

  permanentDeleteNote: async (id) => {
    await fetch(`/api/notes/${id}?permanent=true`, { method: "DELETE" });
    set((s) => ({ trashNotes: s.trashNotes.filter((n) => n.id !== id) }));
  },

  emptyTrash: async () => {
    await fetch("/api/notes/trash", { method: "DELETE" });
    set({ trashNotes: [] });
  },
}));
