export interface Project {
  id: string;
  name: string;
  archived: boolean;
}

export interface Folder {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  starred: boolean;
  folderId: string | null;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Task {
  id: string;
  title: string;
  description?: string | null;
  stage: "todo" | "in_progress" | "blocked" | "done";
  priority?: "low" | "medium" | "high" | null;
  dueDate?: string | null;
  position: number;
  archived: boolean;
  projectId: string;
  project?: Project;
}
