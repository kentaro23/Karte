/**
 * 利用者認証 — 別紙1 §1, 別紙3 #10-24/#71-74, 174項 169-173.
 * ID/password check, password validity window, retry-lockout (auto-terminate),
 * signed session, 利用者変更(ログオフせず切替), screensaver policy.
 */
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { verifyPassword } from './password.js';
import { makeToken, readToken } from './token.js';

export * from './password.js';
export * from './token.js';
export * from './totp.js';

const MAX_RETRY = 5;
const SESSION_HOURS = 12;

export interface AuthContext {
  userId: string;
  sessionId: string;
  loginId: string;
  name: string;
  jobType: string;
  clinicId: string;
}

export type AuthResult =
  | { ok: true; token: string; ctx: AuthContext; prevLoginAt: Date | null }
  | { ok: false; reason: string; terminate: boolean };

export async function authenticate(args: {
  loginId: string;
  password: string;
  terminalId?: string;
  ip?: string;
}): Promise<AuthResult> {
  const { loginId, password } = args;
  const user = await prisma.staffUser.findUnique({
    where: { loginId },
    include: { credential: true },
  });

  const fail = async (reason: string, terminate = false) => {
    await prisma.loginAttempt.create({
      data: { identifier: loginId, userId: user?.id ?? null, success: false, ip: args.ip, terminalId: args.terminalId },
    });
    await writeAudit({
      actorUserId: user?.id ?? null,
      action: 'LOGIN_FAILURE',
      terminalId: args.terminalId,
      ip: args.ip,
      result: reason,
      detail: { loginId },
    });
    return { ok: false as const, reason, terminate };
  };

  if (!user || !user.credential || !user.isActive) return fail('IDまたはパスワードが正しくありません');

  const cred = user.credential;
  if (cred.lockedAt) return fail('アカウントがロックされています。管理者に連絡してください', true);

  const now = new Date();
  if (cred.validFrom > now) return fail('利用開始日前です');
  if (cred.validTo && cred.validTo < now) return fail('利用終了日を過ぎています');
  if (cred.expiresAt && cred.expiresAt < now)
    return fail('パスワードの有効期限が切れています。パスワードを変更してください');

  if (!verifyPassword(password, cred.passwordHash)) {
    const attempts = cred.failedAttempts + 1;
    const lock = attempts >= MAX_RETRY;
    await prisma.staffCredential.update({
      where: { userId: user.id },
      data: { failedAttempts: attempts, lockedAt: lock ? now : null },
    });
    if (lock)
      return fail(`認証に${MAX_RETRY}回失敗しました。システムを終了します`, true);
    return fail(`IDまたはパスワードが正しくありません（残り${MAX_RETRY - attempts}回）`);
  }

  // success — reset counter, capture previous-login info (別紙3 #71)
  const prior = await prisma.authSession.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, terminalId: true },
  });
  await prisma.staffCredential.update({
    where: { userId: user.id },
    data: { failedAttempts: 0 },
  });
  const expiresAt = new Date(now.getTime() + SESSION_HOURS * 3600_000);
  const session = await prisma.authSession.create({
    data: {
      userId: user.id,
      terminalId: args.terminalId,
      prevLoginAt: prior?.createdAt ?? null,
      prevTerminal: prior?.terminalId ?? null,
      expiresAt,
    },
  });
  await prisma.loginAttempt.create({
    data: { identifier: loginId, userId: user.id, success: true, ip: args.ip, terminalId: args.terminalId },
  });
  await writeAudit({
    actorUserId: user.id,
    action: 'LOGIN_SUCCESS',
    terminalId: args.terminalId,
    ip: args.ip,
  });
  return {
    ok: true,
    token: makeToken(session.id, user.id, expiresAt),
    prevLoginAt: prior?.createdAt ?? null,
    ctx: {
      userId: user.id,
      sessionId: session.id,
      loginId: user.loginId,
      name: user.name,
      jobType: user.jobType,
      clinicId: user.clinicId,
    },
  };
}

export async function resolveSession(token: string | undefined): Promise<AuthContext | null> {
  if (!token) return null;
  const parsed = readToken(token);
  if (!parsed) return null;
  const session = await prisma.authSession.findUnique({
    where: { id: parsed.sessionId },
    include: { user: true },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  await prisma.authSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  return {
    userId: session.userId,
    sessionId: session.id,
    loginId: session.user.loginId,
    name: session.user.name,
    jobType: session.user.jobType,
    clinicId: session.user.clinicId,
  };
}

export async function logout(sessionId: string): Promise<void> {
  await prisma.authSession.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
}

/** 利用者変更: authenticate another user WITHOUT revoking the current session. */
export async function switchUser(args: {
  loginId: string;
  password: string;
  terminalId?: string;
  ip?: string;
}): Promise<AuthResult> {
  const r = await authenticate(args);
  if (r.ok)
    await writeAudit({ actorUserId: r.ctx.userId, action: 'USER_SWITCH', terminalId: args.terminalId });
  return r;
}

/** スクリーンセーバ ポリシー — 別紙3 #15-24. Pure helper for the client/timer. */
export interface ScreensaverPolicy {
  idleSeconds: number;
  afterAction: 'logoff' | 'terminate';
  showUserName: boolean;
}
export const DEFAULT_SCREENSAVER: ScreensaverPolicy = {
  idleSeconds: 300,
  afterAction: 'logoff',
  showUserName: true,
};
