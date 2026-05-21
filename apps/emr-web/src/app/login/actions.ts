'use server';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { authenticate } from '@medixus/auth';
import { isDemoMode } from '@medixus/db';
import { SESSION_COOKIE } from '@/lib/session';

export async function loginAction(_prev: unknown, formData: FormData) {
  // Frontend-only demo: accept any credentials, drop a marker cookie and
  // jump straight into the EMR. (getSession() returns the auto-doctor.)
  if (isDemoMode) {
    const jar = await cookies();
    jar.set(SESSION_COOKIE, 'demo', {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 12 * 3600,
    });
    redirect('/patients/select');
  }

  const loginId = String(formData.get('loginId') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const hdr = await headers();
  const r = await authenticate({
    loginId,
    password,
    terminalId: hdr.get('x-terminal-id') ?? 'web',
    ip: hdr.get('x-forwarded-for') ?? undefined,
  });
  if (!r.ok) {
    return { error: r.reason, terminate: r.terminate };
  }
  const jar = await cookies();
  jar.set(SESSION_COOKIE, r.token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 12 * 3600,
  });
  redirect('/patients/select');
}
