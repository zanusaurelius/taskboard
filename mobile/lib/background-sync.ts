import { apiFetch, isOk, type UploadFileMeta } from './api';
import { getBaseUrl, getToken } from './storage';
import { getCachedFile } from './file-cache';

/**
 * Downloads and caches every image in the gallery (?all=true skips folder
 * filter). Called on foreground and on first authenticated launch.
 * Runs fully in the background — never throws, never blocks the UI.
 */
export async function syncAllImageFiles(): Promise<void> {
  const [baseUrl, token] = await Promise.all([getBaseUrl(), getToken()]);
  if (!baseUrl || !token) return;

  try {
    const res = await apiFetch<UploadFileMeta[]>('/api/files?all=true');
    if (!isOk(res) || !Array.isArray(res.data)) return;

    for (const file of res.data) {
      if (!file.mimeType.startsWith('image/')) continue;
      await getCachedFile(file.id, file.mimeType, `${baseUrl}/api/files/${file.id}`, token).catch(() => {});
    }
  } catch { /* silent */ }
}
