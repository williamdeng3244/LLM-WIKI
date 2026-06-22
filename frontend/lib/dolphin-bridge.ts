/**
 * Dolphin 父页面 iframe 嵌入鉴权桥接。
 * 与 dolphin-front Agent/Artifact/dolphin-bridge.ts 使用同一 postMessage 协议。
 */
import { api, type Role, type User } from '@/lib/api';

export const DOLPHIN_AUTH = 'DOLPHIN_AUTH';
export const DOLPHIN_AUTH_REQUEST = 'DOLPHIN_AUTH_REQUEST';

export type DolphinEmbedUser = {
  id: string;
  username: string;
  email?: string;
  name?: string;
  role?: 'admin' | 'member';
};

export type DolphinAuthPayload = {
  type: typeof DOLPHIN_AUTH;
  user: DolphinEmbedUser;
  parentOrigin: string;
  publicBaseUrl?: string;
};

const DOLPHIN_PARENT_KEY = 'wiki:dolphin-parent';

export function isWikiEmbedded(): boolean {
  return typeof window !== 'undefined' && window.self !== window.top;
}

function mapWikiRole(role?: DolphinEmbedUser['role']): Role {
  return role === 'admin' ? 'admin' : 'contributor';
}

function resolveEmail(user: DolphinEmbedUser): string {
  if (user.email?.includes('@')) return user.email;
  if (user.username.includes('@')) return user.username;
  return `${user.username}@dolphin.local`;
}

function resolveDisplayName(user: DolphinEmbedUser): string {
  return user.name || user.username;
}

/** 将 Dolphin 用户映射为 Wiki stub/dev-login 身份并写入 localStorage。 */
export async function applyDolphinAuth(payload: DolphinAuthPayload): Promise<User> {
  const email = resolveEmail(payload.user);
  const name = resolveDisplayName(payload.user);
  const role = mapWikiRole(payload.user.role);

  localStorage.removeItem('wiki:signed-out');
  localStorage.setItem(DOLPHIN_PARENT_KEY, payload.parentOrigin);

  const { token, user } = await api.devLogin(email, name, role);
  localStorage.setItem('wiki:jwt', token);
  localStorage.setItem('wiki:email', email);
  localStorage.setItem('wiki:role', role);
  localStorage.setItem('wiki:displayName', user.name || name);
  return user;
}

export function getStoredDisplayName(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('wiki:displayName');
}

/** 向 Dolphin 父页请求登录信息。 */
export function requestParentAuth(): void {
  if (!isWikiEmbedded() || typeof window === 'undefined') return;
  const parentOrigin = localStorage.getItem(DOLPHIN_PARENT_KEY) || '*';
  window.parent.postMessage({ type: DOLPHIN_AUTH_REQUEST }, parentOrigin);
}

export function listenForDolphinAuth(
  onAuth: (user: User) => void,
  onError?: (error: unknown) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const handler = (event: MessageEvent) => {
    const data = event.data as DolphinAuthPayload | undefined;
    if (!data || data.type !== DOLPHIN_AUTH) return;

    if (data.parentOrigin && event.origin !== data.parentOrigin) return;

    void applyDolphinAuth(data)
      .then(onAuth)
      .catch((error) => onError?.(error));
  };

  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
