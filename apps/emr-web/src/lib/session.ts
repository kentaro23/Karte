import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveSession, type AuthContext } from '@medixus/auth';

export const SESSION_COOKIE = 'mx_session';

export async function getSession(): Promise<AuthContext | null> {
  const jar = await cookies();
  return resolveSession(jar.get(SESSION_COOKIE)?.value);
}

export async function requireSession(): Promise<AuthContext> {
  const s = await getSession();
  if (!s) redirect('/login');
  return s;
}
