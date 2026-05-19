/** Stateless signed session token (HMAC-SHA256). Paired with a DB AuthSession row. */
import { createHmac, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.AUTH_SECRET ?? 'dev-only-medixus-karte-secret-change-me';

function sign(payload: string): string {
  return createHmac('sha256', SECRET).update(payload).digest('base64url');
}

export function makeToken(sessionId: string, userId: string, expiresAt: Date): string {
  const payload = `${sessionId}.${userId}.${expiresAt.getTime()}`;
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
}

export function readToken(
  token: string,
): { sessionId: string; userId: string; expiresAt: Date } | null {
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let payload: string;
  try {
    payload = Buffer.from(body, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [sessionId, userId, exp] = payload.split('.');
  if (!sessionId || !userId || !exp) return null;
  const expiresAt = new Date(Number(exp));
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) return null;
  return { sessionId, userId, expiresAt };
}
