'use server';
import { revalidatePath } from 'next/cache';
import { prisma, type JobType } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { requireSession } from '@/lib/session';
import { JOB_TYPES } from './constants';

/**
 * 利用者管理 — FR-SEC-06（維持） / 174:169。
 *
 * 利用者の登録 / 変更 / 無効化（再有効化）・役割（`JobType`）・状態・
 * 最終ログイン・パスワード更新履歴を扱う。`StaffUser` / `StaffCredential`
 * に対する管理操作のサーバーアクション。
 *
 * AC（§5 FR-SEC-06）:
 *   (1) 全ロールの利用者を登録・無効化できる。
 *   (2) ログイン / 更新履歴が確認できる（page.tsx で `AuthSession`・
 *       `StaffCredential` を読み出して提示）。
 *
 * 監査（別紙3 #25-30）: 登録 / 無効化 / 再有効化 / ロック解除 /
 * パスワード初期化はすべて `writeAudit` で記録する。
 * `AuditAction` enum には利用者管理専用値が無いため、利用者に関する
 * 操作として `USER_SWITCH` を用い、`resource` に具体的な操作種別
 * （StaffUser.create 等）を載せて識別可能にする（settings.ts が
 * RuleSuppression に対し ORDER_CHECK を流用する方針に倣う）。
 *
 * DB 未接続（フロントのみモード）では prisma が到達不可になるため、
 * すべて try/catch でフェイルソフトにし、フォーム送信が 500 に
 * ならないようにする。
 */

// 職種リスト（JOB_TYPES）は './constants' に移設。
// ('use server' ファイルでは async 関数以外を export できないため。)
const VALID_JOB_TYPES = JOB_TYPES.map((j) => j.value);

export type UserActionResult = { ok: boolean; error?: string };

/**
 * 入力検証（純関数）。
 * 'use server' ファイル内では非 export（本ファイルの createUser からのみ使用）。
 */
function validateNewUser(input: {
  staffNo: string;
  loginId: string;
  name: string;
  jobType: string;
}): UserActionResult {
  if (!input.staffNo.trim()) return { ok: false, error: '職員番号は必須です。' };
  if (!input.loginId.trim()) return { ok: false, error: 'ログインIDは必須です。' };
  if (!input.name.trim()) return { ok: false, error: '氏名は必須です。' };
  if (!VALID_JOB_TYPES.includes(input.jobType as JobType)) {
    return { ok: false, error: '職種の指定が不正です。' };
  }
  return { ok: true };
}

/** 利用者を登録する（全ロール対応）。AC(1)。 */
export async function createUser(formData: FormData): Promise<void> {
  const s = await requireSession();

  const staffNo = String(formData.get('staffNo') || '').trim();
  const loginId = String(formData.get('loginId') || '').trim();
  const name = String(formData.get('name') || '').trim();
  const nameKana = String(formData.get('nameKana') || '').trim();
  const jobTypeRaw = String(formData.get('jobType') || '').trim();

  const check = validateNewUser({ staffNo, loginId, name, jobType: jobTypeRaw });
  if (!check.ok) {
    revalidatePath('/admin/users');
    return;
  }
  const jobType = jobTypeRaw as JobType;

  try {
    const row = await prisma.staffUser.create({
      data: {
        clinicId: s.clinicId ?? 'demo-clinic',
        staffNo,
        loginId,
        name,
        nameKana: nameKana || name,
        jobType,
        isActive: true,
      },
    });
    await writeAudit({
      actorUserId: s.userId,
      action: 'USER_SWITCH',
      resource: 'StaffUser.create',
      resourceId: row.id,
      detail: { staffNo, loginId, jobType },
    });
  } catch (err) {
    console.error('[admin/users] createUser failed (fail-soft):', err);
  }
  revalidatePath('/admin/users');
}

/** 利用者の有効/無効を切り替える（無効化＝アカウント停止）。AC(1)。 */
export async function setUserActive(formData: FormData): Promise<void> {
  const s = await requireSession();
  const id = String(formData.get('id') || '');
  const active = String(formData.get('active') || '') === 'true';
  if (!id) return;
  try {
    await prisma.staffUser.update({ where: { id }, data: { isActive: active } });
    await writeAudit({
      actorUserId: s.userId,
      action: 'USER_SWITCH',
      resource: active ? 'StaffUser.enable' : 'StaffUser.disable',
      resourceId: id,
      detail: { isActive: active },
    });
  } catch (err) {
    console.error('[admin/users] setUserActive failed (fail-soft):', err);
  }
  revalidatePath('/admin/users');
}

/**
 * アカウントロックを解除する（失敗回数リセット）。
 * リトライロック（5回失敗）後の復旧導線。
 */
export async function unlockUser(formData: FormData): Promise<void> {
  const s = await requireSession();
  const id = String(formData.get('id') || '');
  if (!id) return;
  try {
    await prisma.staffCredential.update({
      where: { userId: id },
      data: { lockedAt: null, failedAttempts: 0 },
    });
    await writeAudit({
      actorUserId: s.userId,
      action: 'USER_SWITCH',
      resource: 'StaffCredential.unlock',
      resourceId: id,
    });
  } catch (err) {
    console.error('[admin/users] unlockUser failed (fail-soft):', err);
  }
  revalidatePath('/admin/users');
}

/**
 * パスワードを初期化する（次回ログイン時に変更を強制）。
 * 平文・ハッシュは扱わず、`mustChange` を立て、パスワード更新履歴の
 * 起点（`validFrom` / `updatedAt`）を更新する。実際の再設定は本人が
 * 認証フローで行う（別紙1 §1.1）。
 */
export async function resetPassword(formData: FormData): Promise<void> {
  const s = await requireSession();
  const id = String(formData.get('id') || '');
  if (!id) return;
  try {
    await prisma.staffCredential.update({
      where: { userId: id },
      data: { mustChange: true, validFrom: new Date() },
    });
    await writeAudit({
      actorUserId: s.userId,
      action: 'USER_SWITCH',
      resource: 'StaffCredential.resetPassword',
      resourceId: id,
      detail: { mustChange: true },
    });
  } catch (err) {
    console.error('[admin/users] resetPassword failed (fail-soft):', err);
  }
  revalidatePath('/admin/users');
}
