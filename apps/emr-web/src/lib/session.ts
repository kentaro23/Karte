import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveSession, type AuthContext } from '@medixus/auth';
import { isDemoMode } from '@medixus/db';

export const SESSION_COOKIE = 'mx_session';

/** Auto-logged-in identity used by every route while DATABASE_URL is unset. */
export const DEMO_SESSION: AuthContext = {
  userId: 'demo-staff-1',
  sessionId: 'demo-session',
  loginId: 'doctor',
  name: '研修 太郎',
  jobType: 'DOCTOR',
  clinicId: 'demo-clinic',
};

export async function getSession(): Promise<AuthContext | null> {
  // Frontend-only demo mode — auto-authenticate so the UI is fully clickable
  // without any backend.
  if (isDemoMode) return { ...DEMO_SESSION };

  const jar = await cookies();
  const tok = jar.get(SESSION_COOKIE)?.value;
  if (!tok) return null;
  // resolveSession hits the DB to validate the token. If the DB is
  // unreachable (schema unmigrated, network blip, Prisma engine load
  // failure on first request) we must NOT 500 the whole route — treat
  // it as "no session" so the caller redirects to /login.
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
