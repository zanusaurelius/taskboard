import { create } from "zustand";
import { Task, Project, Note, Folder } from "./types";

interface TaskBoardStore {
  tasks: Task[];
  projects: Project[];
  notes: Note[];
  fetchAll: (includeArchivedTasks?: boolean, includeArchivedProjects?: boolean) => Promise<void>;
  createTask: (fields: Partial<Task>) => Promise<Task>;
  updateTask: (id: string, fields: Partial<Task>) => Promise<Task>;
  deleteTask: (id: string) => Promise<void>;
  createProject: (name: string) => Promise<Project>;
  updateProject: (id: string, fields: Partial<Project>) => Promise<Project>;
  deleteProject: (id: string) => Promise<void>;
  permanentDeleteProject: (id: string) => Promise<void>;
  archiveAllDone: () => Promise<void>;
  folders: Folder[];
  fetchFolders: () => Promise<void>;
  createFolder: (name: string) => Promise<Folder>;
  updateFolder: (id: string, name: string) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  fetchNotes: () => Promise<void>;
  createNote: () => Promise<Note>;
  duplicateNote: (id: string) => Promise<Note>;
  updateNote: (id: string, fields: Partial<Note>) => Promise<void>;
  deleteNote: (id: string) => Promise<void>;
}

export const useTaskBoardStore = create<TaskBoardStore>((set, get) => ({
  tasks: [],
  projects: [],
  notes: [],
  folders: [],

  fetchFolders: async () => {
    const res = await fetch("/api/folders");
    set({ folders: await res.json() });
  },

  createFolder: async (name) => {
    const res = await fetch("/api/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const folder = await res.json();
    set((s) => ({ folders: [...s.folders, folder].sort((a, b) => a.name.localeCompare(b.name)) }));
    return folder;
  },

  updateFolder: async (id, name) => {
    const res = await fetch(`/api/folders/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const folder = await res.json();
    set((s) => ({
      folders: s.folders.map((f) => f.id === id ? folder : f).sort((a, b) => a.name.localeCompare(b.name)),
    }));
  },

  deleteFolder: async (id) => {
    await fetch(`/api/folders/${id}`, { method: "DELETE" });
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
    const [tasks, projects] = await Promise.all([tasksRes.json(), projectsRes.json()]);
    set({ tasks, projects });
  },

  createTask: async (fields) => {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const task = await res.json();
    set((s) => ({ tasks: [...s.tasks, task] }));
    return task;
  },

  updateTask: async (id, fields) => {
    const res = await fetch(`/api/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const task = await res.json();
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? task : t)) }));
    return task;
  },

  deleteTask: async (id) => {
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
  },

  createProject: async (name) => {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const project = await res.json();
    set((s) => ({ projects: [...s.projects, project].sort((a, b) => a.name.localeCompare(b.name)) }));
    return project;
  },

  updateProject: async (id, fields) => {
    const res = await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const project = await res.json();
    set((s) => ({
      projects: s.projects
        .map((p) => (p.id === id ? project : p))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));
    return project;
  },

  deleteProject: async (id) => {
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    set((s) => ({ projects: s.projects.map((p) => (p.id === id ? { ...p, archived: true } : p)) }));
  },

  permanentDeleteProject: async (id) => {
    await fetch(`/api/projects/${id}?permanent=true`, { method: "DELETE" });
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      tasks: s.tasks.filter((t) => t.projectId !== id),
    }));
  },

  archiveAllDone: async () => {
    const doneTasks = get().tasks.filter((t) => t.stage === "done" && !t.archived);
    await Promise.all(
      doneTasks.map((t) =>
        fetch(`/api/tasks/${t.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ archived: true }),
        })
      )
    );
    set((s) => ({
      tasks: s.tasks.map((t) =>
        t.stage === "done" && !t.archived ? { ...t, archived: true } : t
      ),
    }));
  },

  fetchNotes: async () => {
    const res = await fetch("/api/notes");
    const notes = await res.json();
    set({ notes });
  },

  duplicateNote: async (id) => {
    const src = get().notes.find((n) => n.id === id);
    if (!src) throw new Error("Note not found");
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: src.title ? `${src.title} (copy)` : "", content: src.content, folderId: src.folderId }),
    });
    if (!res.ok) throw new Error("Failed to duplicate note");
    const note = await res.json();
    set((s) => ({ notes: [note, ...s.notes] }));
    return note;
  },

  createNote: async () => {
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "", content: "" }),
    });
    if (!res.ok) throw new Error(`Failed to create note: ${res.status}`);
    const note = await res.json();
    set((s) => ({ notes: [note, ...s.notes] }));
    return note;
  },

  updateNote: async (id, fields) => {
    const res = await fetch(`/api/notes/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const note = await res.json();
    set((s) => ({
      notes: s.notes
        .map((n) => (n.id === id ? note : n))
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    }));
  },

  deleteNote: async (id) => {
    await fetch(`/api/notes/${id}`, { method: "DELETE" });
    set((s) => ({ notes: s.notes.filter((n) => n.id !== id) }));
  },
}));
