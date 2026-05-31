'use server';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { authenticate, verifyTotp } from '@medixus/auth';
import { isDemoMode, prisma } from '@medixus/db';
import { SESSION_COOKIE } from '@/lib/session';

/**
 * Login action state (FR-SEC-01 / FR-SEC-02 — 174項 171-173).
 *
 * - `error`     : 認証失敗メッセージ（リトライ残数 / ロック含む）
 * - `locked`    : リトライロック等でセッション終了が必要（terminate）
 * - `needTotp`  : パスワードは正しいが TOTP 二要素コード入力が必要
 * - `prevLoginAt` / `prevTerminal` : 前回ログインの日時・端末（参考表示）
 * - `loginId` / `password` : TOTP 入力フェーズで前段の資格情報を保持して再送する
 */
export interface LoginState {
  error?: string;
  locked?: boolean;
  needTotp?: boolean;
  prevLoginAt?: string | null;
  prevTerminal?: string | null;
  loginId?: string;
  password?: string;
}

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 12 * 3600,
};

/**
 * Look up a confirmed TOTP factor for the user. Fail-soft: any DB error is
 * treated as "no second factor" so a transient failure can never lock a user
 * out of an otherwise-valid (password) login.
 */
async function getConfirmedTotpSecret(userId: string): Promise<string | null> {
  try {
    const factor = await prisma.mfaFactor.findFirst({
      where: { userId, type: 'TOTP', confirmed: true },
      select: { secret: true },
      orderBy: { createdAt: 'desc' },
    });
    return factor?.secret ?? null;
  } catch (err) {
    console.error('[loginAction] TOTP factor lookup failed; skipping 2FA:', err);
    return null;
  }
}

export async function loginAction(
  _prev: LoginState | null,
  formData: FormData,
): Promise<LoginState> {
  // Frontend-only demo: accept any credentials, drop a marker cookie and
  // jump straight into the EMR. (getSession() returns the auto-doctor.)
  if (isDemoMode) {
    const jar = await cookies();
    jar.set(SESSION_COOKIE, 'demo', COOKIE_OPTS);
    redirect('/patients/select');
  }

  const loginId = String(formData.get('loginId') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const totpCode = String(formData.get('totp') ?? '').trim();
  const hdr = await headers();
  const terminalId = hdr.get('x-terminal-id') ?? 'web';
  const ip = hdr.get('x-forwarded-for') ?? undefined;

  // Phase 1 — password / validity / retry-lockout (handled inside authenticate).
  const r = await authenticate({ loginId, password, terminalId, ip });
  if (!r.ok) {
    return { error: r.reason, locked: r.terminate };
  }

  // Phase 2 — second factor (FR-SEC-02). authenticate() validates the password
  // only; TOTP must be enforced here before we hand out a session cookie.
  const secret = await getConfirmedTotpSecret(r.ctx.userId);
  if (secret) {
    if (!totpCode) {
      // Prompt for the code. Carry credentials forward so the next submit can
      // re-run phase 1 + 2 in one shot. No cookie is set yet.
      return {
        needTotp: true,
        loginId,
        password,
        prevLoginAt: r.prevLoginAt ? r.prevLoginAt.toISOString() : null,
        prevTerminal: null,
      };
    }
    if (!verifyTotp(secret, totpCode)) {
      return {
        needTotp: true,
        loginId,
        password,
        error: '認証コードが正しくありません。認証アプリの6桁コードを確認してください',
      };
    }
  }

  // All factors satisfied — issue the signed session and enter the EMR.
  const jar = await cookies();
  jar.set(SESSION_COOKIE, r.token, COOKIE_OPTS);
  // Surface the previous-login info so the destination can display it
  // (FR-SEC-01 AC2). Non-httpOnly, short-lived, read once by the UI.
  if (r.prevLoginAt) {
    jar.set('mx_prev_login', r.prevLoginAt.toISOString(), {
      sameSite: 'lax',
      path: '/',
      maxAge: 300,
    });
  }
  redirect('/patients/select');
}
