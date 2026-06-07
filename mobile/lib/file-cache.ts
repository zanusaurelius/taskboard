import * as FileSystem from 'expo-file-system/legacy';

const CACHE_DIR = `${FileSystem.cacheDirectory}taskboard-files/`;

// Deduplicates concurrent downloads for the same file
const inProgress = new Map<string, Promise<string>>();

function extFromMime(mimeType: string): string {
  const map: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif',
    'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif',
    'video/mp4': 'mp4', 'video/quicktime': 'mov',
    'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
    'application/pdf': 'pdf',
  };
  return map[mimeType] ?? 'bin';
}

async function ensureCacheDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
}

function downloadToCache(url: string, token: string | null, destPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.responseType = 'blob';
    xhr.open('GET', url);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const reader = new FileReader();
        reader.onloadend = async () => {
          try {
            if (typeof reader.result !== 'string') { reject(new Error('read failed')); return; }
            const base64 = reader.result.split(',')[1];
            await FileSystem.writeAsStringAsync(destPath, base64, {
              encoding: FileSystem.EncodingType.Base64,
            });
            resolve(destPath);
          } catch (e) { reject(e); }
        };
        reader.onerror = () => reject(new Error('FileReader error'));
        reader.readAsDataURL(xhr.response as Blob);
      } else {
        reject(new Error(`Server error ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error('Network error'));
    xhr.send();
  });
}

/**
 * Returns a local file:// URI for the given file, downloading and caching it on
 * first access. Subsequent calls return immediately from disk (works offline).
 * Uses XHR so the request goes through OkHttp, which respects the Orbot proxy.
 */
export async function getCachedFile(
  cacheKey: string,
  mimeType: string,
  url: string,
  token: string | null,
): Promise<string> {
  await ensureCacheDir();
  const cachePath = `${CACHE_DIR}${cacheKey}.${extFromMime(mimeType)}`;

  const info = await FileSystem.getInfoAsync(cachePath);
  if (info.exists) return cachePath;

  const existing = inProgress.get(cacheKey);
  if (existing) return existing;

  const promise = downloadToCache(url, token, cachePath)
    .finally(() => inProgress.delete(cacheKey));
  inProgress.set(cacheKey, promise);
  return promise;
}

export async function clearFileCache(): Promise<void> {
  await FileSystem.deleteAsync(CACHE_DIR, { idempotent: true });
}
