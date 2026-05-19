'use server';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { authenticate } from '@medixus/auth';
import { SESSION_COOKIE } from '@/lib/session';

export async function loginAction(_prev: unknown, formData: FormData) {
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
