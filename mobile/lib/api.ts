import { getToken, getBaseUrl, clearToken, clearAll } from './storage';

// ── Types ──────────────────────────────────────────────────────────────────────

export type ApiOk<T> = { ok: true; data: T };
export type ApiConflict<T> = { ok: false; conflict: true; serverItem: T };
export type ApiError = { ok: false; conflict: false; status: number; error: string };
export type ApiResult<T> = ApiOk<T> | ApiConflict<T> | ApiError;

export function isOk<T>(r: ApiResult<T>): r is ApiOk<T> {
  return r.ok === true;
}
export function isConflict<T>(r: ApiResult<T>): r is ApiConflict<T> {
  return r.ok === false && (r as ApiConflict<T>).conflict === true;
}
export function isError(r: ApiResult<unknown>): r is ApiError {
  return r.ok === false && !(r as ApiConflict<unknown>).conflict;
}

// ── Core fetch ─────────────────────────────────────────────────────────────────

let _onUnauthorized: (() => void) | null = null;
let _onDbLocked: (() => void) | null = null;

/** Register a callback to fire when any request returns 401. */
export function onUnauthorized(cb: () => void) { _onUnauthorized = cb; }

/** Register a callback to fire when the server DB is locked (423). */
export function onDbLocked(cb: () => void) { _onDbLocked = cb; }

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<ApiResult<T>> {
  const [baseUrl, token] = await Promise.all([getBaseUrl(), getToken()]);
  if (!baseUrl) return { ok: false, conflict: false, status: 0, error: 'Server URL not configured' };

  const headers = new Headers(options.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  try {
    const res = await fetch(`${baseUrl}${path}`, { ...options, headers });

    if (res.status === 401) {
      await clearToken();
      _onUnauthorized?.();
      return { ok: false, conflict: false, status: 401, error: 'Session expired' };
    }

    if (res.status === 423) {
      _onDbLocked?.();
      return { ok: false, conflict: false, status: 423, error: 'Database locked' };
    }

    if (res.status === 204) return { ok: true, data: null as T };

    const text = await res.text();
    const data = text ? JSON.parse(text) : null;

    if (res.status === 409 && data?.conflict) {
      return { ok: false, conflict: true, serverItem: data.serverItem as T };
    }

    if (!res.ok) {
      return { ok: false, conflict: false, status: res.status, error: data?.error ?? 'Request failed' };
    }

    return { ok: true, data: data as T };
  } catch {
    return { ok: false, conflict: false, status: 0, error: 'Network error' };
  }
}

// ── Auth ────────────────────────────────────────────────────────────────────────

import { setToken, setBaseUrl } from './storage';

export async function login(
  baseUrl: string,
  username: string,
  password: string,
): Promise<{ ok: boolean; dbLocked?: boolean; error?: string }> {
  const url = baseUrl.replace(/\/$/, '');
  try {
    const res = await fetch(`${url}/api/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 423 || body.error === 'db_locked') {
        return { ok: false, dbLocked: true };
      }
      return { ok: false, error: body.error ?? 'Login failed' };
    }
    const { token } = await res.json();
    await Promise.all([setBaseUrl(url), setToken(token)]);
    return { ok: true };
  } catch {
    return { ok: false, error: 'Cannot connect to server' };
  }
}

export async function logout(): Promise<void> {
  await clearAll();
}

export async function checkDbStatus(
  baseUrl: string,
): Promise<'unlocked' | 'locked' | 'setup' | 'error'> {
  const url = baseUrl.replace(/\/$/, '');
  try {
    const res = await fetch(`${url}/api/auth/db-status`);
    if (!res.ok) return 'error';
    const { state } = await res.json();
    return state;
  } catch {
    return 'error';
  }
}

export async function unlockDb(
  baseUrl: string,
  passphrase: string,
): Promise<{ ok: boolean; error?: string }> {
  const url = baseUrl.replace(/\/$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await fetch(`${url}/api/auth/db-unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body.error ?? 'Unlock failed' };
    }
    return { ok: true };
  } catch {
    clearTimeout(timer);
    return { ok: false, error: 'Cannot connect to server' };
  }
}

export interface AttachmentMeta {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  createdAt: string;
  uploadId: string | null;
}

export async function listAttachments(noteId?: string, taskId?: string): Promise<AttachmentMeta[]> {
  const query = noteId ? `noteId=${noteId}` : `taskId=${taskId}`;
  const result = await apiFetch<AttachmentMeta[]>(`/api/attachments?${query}`);
  return isOk(result) ? result.data : [];
}

export async function deleteAttachment(id: string): Promise<boolean> {
  const result = await apiFetch(`/api/attachments/${id}`, { method: 'DELETE' });
  return result.ok;
}

export async function uploadImage(uri: string, mimeType: string): Promise<string | null> {
  const [baseUrl, token] = await Promise.all([getBaseUrl(), getToken()]);
  if (!baseUrl) return null;

  const ext = mimeType.split('/')[1] ?? 'jpg';
  const formData = new FormData();
  formData.append('file', { uri, type: mimeType, name: `upload.${ext}` } as unknown as Blob);

  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  try {
    const res = await fetch(`${baseUrl}/api/upload`, { method: 'POST', body: formData, headers });
    if (!res.ok) return null;
    const { url } = await res.json() as { url: string };
    return url;
  } catch {
    return null;
  }
}

// ── Files ─────────────────────────────────────────────────────────────────────

export interface UploadFileMeta {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  thumbnail: string | null;
  fileFolderId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FileFolderMeta {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  _count: { uploads: number; children: number };
}

export async function listFiles(folderId?: string | null): Promise<UploadFileMeta[]> {
  const qs = folderId ? `?folderId=${folderId}` : '';
  const result = await apiFetch<UploadFileMeta[]>(`/api/files${qs}`);
  return isOk(result) ? result.data : [];
}

export async function deleteFile(id: string): Promise<boolean> {
  const result = await apiFetch(`/api/files/${id}`, { method: 'DELETE' });
  return result.ok;
}

export type UploadResult = UploadFileMeta | { error: string };
export function uploadOk(r: UploadResult): r is UploadFileMeta { return !('error' in r); }

export async function uploadFile(
  uri: string,
  name: string,
  mimeType: string,
  folderId?: string | null,
): Promise<UploadResult> {
  const [baseUrl, token] = await Promise.all([getBaseUrl(), getToken()]);
  if (!baseUrl) return { error: 'Server URL not configured' };

  // Use XMLHttpRequest instead of fetch. Expo SDK 56 introduced a new "winter"
  // fetch that doesn't understand RN's {uri,type,name} blob format for FormData
  // parts and throws "Unsupported FormDataPart implementation". XHR bypasses it
  // and goes directly to RN's native NetworkingModule which handles uri parts.
  const formData = new FormData();
  formData.append('file', { uri, type: mimeType, name } as unknown as Blob);
  if (folderId) formData.append('folderId', folderId);

  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${baseUrl}/api/files`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch { resolve({ error: 'Invalid server response' }); }
      } else {
        try {
          const body = JSON.parse(xhr.responseText);
          const msg = body?.error ?? `Server error ${xhr.status}`;
          console.error(`[uploadFile] ${xhr.status}:`, msg);
          resolve({ error: msg });
        } catch {
          resolve({ error: `Server error ${xhr.status}` });
        }
      }
    };
    xhr.onerror = () => {
      console.error('[uploadFile] XHR network error');
      resolve({ error: 'Network error — could not reach server' });
    };
    xhr.send(formData);
  });
}

export function fileUrl(id: string, baseUrl: string, token: string | null): string {
  return `${baseUrl}/api/files/${id}${token ? `?token=${token}` : ''}`;
}

export function fileThumbnailUrl(id: string, baseUrl: string, token: string | null): string {
  return `${baseUrl}/api/files/${id}/thumbnail${token ? `?token=${token}` : ''}`;
}

export async function listFileFolders(parentId?: string | null): Promise<FileFolderMeta[]> {
  const qs = parentId ? `?parentId=${parentId}` : '';
  const result = await apiFetch<FileFolderMeta[]>(`/api/file-folders${qs}`);
  return isOk(result) ? result.data : [];
}

export async function createFileFolder(name: string, parentId?: string | null): Promise<FileFolderMeta | null> {
  const result = await apiFetch<FileFolderMeta>('/api/file-folders', {
    method: 'POST',
    body: JSON.stringify({ name, parentId: parentId ?? null }),
  });
  return isOk(result) ? result.data : null;
}

export async function renameFileFolder(id: string, name: string): Promise<boolean> {
  const result = await apiFetch(`/api/file-folders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
  return result.ok;
}

export async function deleteFileFolder(id: string): Promise<boolean> {
  const result = await apiFetch(`/api/file-folders/${id}`, { method: 'DELETE' });
  return result.ok;
}

export async function renameFile(id: string, originalName: string): Promise<boolean> {
  const result = await apiFetch(`/api/files/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ originalName }),
  });
  return result.ok;
}

export async function moveFile(id: string, folderId: string | null): Promise<boolean> {
  const result = await apiFetch(`/api/files/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ folderId }),
  });
  return result.ok;
}

export async function moveFolderTo(id: string, parentId: string | null): Promise<boolean> {
  const result = await apiFetch(`/api/file-folders/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ parentId }),
  });
  return result.ok;
}

export async function linkFileAsAttachment(
  uploadId: string,
  noteId?: string,
  taskId?: string,
): Promise<AttachmentMeta | null> {
  const result = await apiFetch<AttachmentMeta>('/api/attachments', {
    method: 'POST',
    body: JSON.stringify({ uploadId, noteId, taskId }),
  });
  return isOk(result) ? result.data : null;
}
