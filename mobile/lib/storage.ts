import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'taskboard_token';
const BASE_URL_KEY = 'taskboard_base_url';
const VAULT_KEY_KEY = 'taskboard_vault_key'; // base64 master key, held in memory ideally

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  return SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  return SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function getBaseUrl(): Promise<string> {
  return (await SecureStore.getItemAsync(BASE_URL_KEY)) ?? '';
}

export async function setBaseUrl(url: string): Promise<void> {
  return SecureStore.setItemAsync(BASE_URL_KEY, url.replace(/\/$/, ''));
}

// Vault master key — stored in secure enclave, wiped on logout
export async function getVaultKey(): Promise<string | null> {
  return SecureStore.getItemAsync(VAULT_KEY_KEY);
}

export async function setVaultKey(keyBase64: string): Promise<void> {
  return SecureStore.setItemAsync(VAULT_KEY_KEY, keyBase64);
}

export async function clearVaultKey(): Promise<void> {
  return SecureStore.deleteItemAsync(VAULT_KEY_KEY);
}

export async function clearAll(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(TOKEN_KEY),
    SecureStore.deleteItemAsync(BASE_URL_KEY),
    SecureStore.deleteItemAsync(VAULT_KEY_KEY),
  ]);
}
