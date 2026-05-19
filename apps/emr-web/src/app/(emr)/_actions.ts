'use server';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { logout, readToken, switchUser, authenticate } from '@medixus/auth';
import { getSession, SESSION_COOKIE } from '@/lib/session';

export async function logoutAction() {
  const jar = await cookies();
  const tok = jar.get(SESSION_COOKIE)?.value;
  if (tok) {
    const p = readToken(tok);
    if (p) await logout(p.sessionId).catch(() => {});
  }
  jar.delete(SESSION_COOKIE);
  redirect('/login');
}

export async function switchUserAction(_prev: unknown, formData: FormData) {
  const loginId = String(formData.get('loginId') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const hdr = await headers();
  const r = await switchUser({
    loginId,
    password,
    terminalId: hdr.get('x-terminal-id') ?? 'web',
  });
  if (!r.ok) return { error: r.reason };
  const jar = await cookies();
  jar.set(SESSION_COOKIE, r.token, { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 12 * 3600 });
  redirect('/portal');
}

/** Screensaver unlock — re-authenticate the current user (別紙3 #24, 正式手順のみ). */
export async function unlockAction(password: string): Promise<boolean> {
  const s = await getSession();
  if (!s) return false;
  const r = await authenticate({ loginId: s.loginId, password });
  return r.ok;
}
