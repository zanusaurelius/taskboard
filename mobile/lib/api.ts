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

    if (res.status === 409) {
      const body = await res.json().catch(() => ({}));
      if (body.conflict) {
        return { ok: false, conflict: true, serverItem: body.serverItem as T };
      }
    }

    if (res.status === 204) return { ok: true, data: null as T };

    const text = await res.text();
    const data = text ? JSON.parse(text) : null;

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
  try {
    const res = await fetch(`${url}/api/auth/db-unlock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ passphrase }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: body.error ?? 'Unlock failed' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Cannot connect to server' };
  }
}
