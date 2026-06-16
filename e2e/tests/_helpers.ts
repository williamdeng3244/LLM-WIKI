import { Page } from '@playwright/test';

export type Role = 'reader' | 'contributor' | 'editor' | 'admin';

export function uniqueEmail(role: string): string {
  return `e2e-${role}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

export function uniquePath(prefix = 'n'): string {
  return `qa-e2e/${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Seed stub-auth identity into localStorage BEFORE the app loads, so every
 * request in this page's context authenticates as `role`. Call before page.goto.
 * Returns the synthetic email used. A fresh context with nothing set auto-
 * resolves the seeded admin (stub mode), so admin flows can skip this.
 */
export async function loginAs(page: Page, role: Role, email?: string): Promise<string> {
  const e = email ?? uniqueEmail(role);
  await page.addInitScript(([em, r]) => {
    localStorage.setItem('wiki:email', em);
    localStorage.setItem('wiki:role', r);
    localStorage.removeItem('wiki:signed-out');
  }, [e, role] as [string, string]);
  return e;
}
