// Shared types — mirrors the web app's lib/types.ts

export interface Project {
  id: string;
  name: string;
  encName: string | null;
  color: string | null;
  archived: boolean;
  updatedAt: string;
}

export interface Folder {
  id: string;
  name: string;
  encName: string | null;
  pinned: boolean;
  hidden: boolean;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  starred: boolean;
  hidden: boolean;
  locked: boolean;
  hint: string | null;
  encContent: string | null;
  encTitle: string | null;
  folderId: string | null;
  projectId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Task {
  id: string;
  title: string;
  encTitle: string | null;
  description?: string | null;
  encDescription: string | null;
  stage: 'todo' | 'in_progress' | 'blocked' | 'done';
  priority?: 'low' | 'medium' | 'high' | null;
  dueDate?: string | null;
  position: number;
  archived: boolean;
  sensitive: boolean;
  locked: boolean;
  projectId: string;
  project?: Project;
  doneAt?: string | null;
  updatedAt: string;
}

export interface DailyGoal {
  id: string;
  text: string;
  encText: string | null;
  taskId: string | null;
  date: string;
  completed: boolean;
  position: number;
  updatedAt: string;
}

export interface Habit {
  id: string;
  text: string;
  encText: string | null;
  position: number;
  completedToday: boolean;
  updatedAt: string;
}

export interface DailyReflection {
  id: string;
  date: string;
  note: string | null;
  encNote: string | null;
  gratitude: string | null;
  encGratitude: string | null;
  body: string | null;
  encBody: string | null;
  updatedAt: string;
}

export interface UploadFileMeta {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  thumbnail: string | null;
  fileFolderId: string | null;
  createdAt: string;
  updatedAt: string;
  attachments: { noteId: string | null; taskId: string | null }[];
}

export interface VaultConfig {
  exists: boolean;
  encryptedMasterKey: string;
  masterKeySalt: string;
  encryptedMasterKeyBak: string;
  backupKeySalt: string;
  verifier: string;
}
