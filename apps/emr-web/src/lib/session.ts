import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveSession, type AuthContext } from '@medixus/auth';

export const SESSION_COOKIE = 'mx_session';

export async function getSession(): Promise<AuthContext | null> {
  const jar = await cookies();
  const tok = jar.get(SESSION_COOKIE)?.value;
  if (!tok) return null;
  // resolveSession hits the DB to validate the token. If the DB is
  // unreachable (DATABASE_URL unset, schema unmigrated, network blip,
  // Prisma engine load failure on first request) we must NOT 500 the
  // whole route — treat it as "no session" so the caller redirects to
  // /login. The error page still surfaces the cause for the operator.
  try {
    return await resolveSession(tok);
  } catch (err) {
    console.error('[getSession] resolveSession failed; treating as anonymous:', err);
    return null;
  }
}

export async function requireSession(): Promise<AuthContext> {
  const s = await getSession();
  if (!s) redirect('/login');
  return s;
}
