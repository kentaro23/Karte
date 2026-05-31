'use server';
import { revalidatePath } from 'next/cache';
import { prisma, type RuleCheckType } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { requireSession } from '@/lib/session';

/**
 * 警告管理（無効化制御）— FR-RXSAFE-05 / ギャップ G13。
 *
 * 処置行為 / 医薬品 / チェック種類 / レベル単位で警告を無効化し、表示先
 * （カルテ / 要確認レセプト一覧）を制御する `RuleSuppression` を作成・削除する。
 *
 * 安全側ガード（業務ルール 別紙・§5 FR-RXSAFE-05）:
 *   - アレルギー（ALLERGY）警告は **抑止不可**。
 *   - 絶対禁忌（CONTRAINDICATION × ABSOLUTE）は **抑止不可**。
 *     UI からは checkType=CONTRAINDICATION かつ「絶対禁忌のみ」を意図した抑止を拒否する。
 *   - いずれの設定変更（作成・削除）も監査に残す（AC(3)）。
 *
 * DB 未接続（フロントのみモード）では prisma が no-op になるため try/catch で
 * フェイルソフトにし、フォーム送信が 500 にならないようにする。
 */

/** 抑止不可のチェック種類（安全側で固定）。 */
export const NON_SUPPRESSIBLE_CHECK_TYPES = ['ALLERGY'] as const;
const VALID_SCOPES = ['PROCEDURE', 'DRUG', 'DRUG_CLASS', 'CHECK_TYPE'] as const;
const VALID_LEVELS = ['WARNING', 'BLOCKED'] as const;
const VALID_SHOW_IN = ['CHART', 'RECEIPT_REVIEW'] as const;
const VALID_CHECK_TYPES: RuleCheckType[] = [
  'CONTRAINDICATION',
  'INTERACTION',
  'DOSE_MAX',
  'DUPLICATE',
  'ALLERGY',
  'DISEASE_CONTRA',
  'PREGNANCY_LACTATION',
  'RENAL',
  'HEPATIC',
  'AGE',
  'INFECTION',
];

export type SuppressionResult = { ok: boolean; error?: string };

/**
 * 抑止設定が安全側ルールに反していないか検証する純関数。
 * ALLERGY を直接対象にする、または絶対禁忌のみを抑止する設定は拒否する。
 */
export function validateSuppression(input: {
  scope: string;
  checkType: string | null;
  targetKey: string;
  absoluteOnly?: boolean;
}): SuppressionResult {
  if (!VALID_SCOPES.includes(input.scope as (typeof VALID_SCOPES)[number])) {
    return { ok: false, error: '抑止対象の種別が不正です。' };
  }
  if (!input.targetKey.trim()) {
    return { ok: false, error: '対象キー（処置コード／医薬品ID／種類など）は必須です。' };
  }
  // ALLERGY は種別単位でもキー単位でも抑止不可。
  if (input.checkType === 'ALLERGY' || input.targetKey.trim().toUpperCase() === 'ALLERGY') {
    return { ok: false, error: 'アレルギー警告は安全上の理由により抑止できません。' };
  }
  // 絶対禁忌（ABSOLUTE）のみを狙った抑止は拒否。
  if (input.checkType === 'CONTRAINDICATION' && input.absoluteOnly) {
    return { ok: false, error: '絶対禁忌（ABSOLUTE）は安全上の理由により抑止できません。' };
  }
  return { ok: true };
}

export async function createSuppression(formData: FormData): Promise<void> {
  const s = await requireSession();

  const scope = String(formData.get('scope') || 'CHECK_TYPE');
  const rawCheckType = String(formData.get('checkType') || '').trim();
  const checkType = rawCheckType && VALID_CHECK_TYPES.includes(rawCheckType as RuleCheckType)
    ? (rawCheckType as RuleCheckType)
    : null;
  const targetKey = String(formData.get('targetKey') || '').trim();
  const minLevelRaw = String(formData.get('minLevel') || 'WARNING');
  const minLevel = VALID_LEVELS.includes(minLevelRaw as (typeof VALID_LEVELS)[number])
    ? minLevelRaw
    : 'WARNING';
  const showInRaw = String(formData.get('showIn') || 'CHART');
  const showIn = VALID_SHOW_IN.includes(showInRaw as (typeof VALID_SHOW_IN)[number])
    ? showInRaw
    : 'CHART';
  const absoluteOnly = String(formData.get('absoluteOnly') || '') === 'on';

  const check = validateSuppression({ scope, checkType, targetKey, absoluteOnly });
  if (!check.ok) {
    // 安全側で拒否したことも監査に残す（変更が試みられた事実）。
    try {
      await writeAudit({
        actorUserId: s.userId,
        action: 'ORDER_CHECK',
        resource: 'RuleSuppression.create.rejected',
        result: 'DENIED',
        detail: { scope, checkType, targetKey, reason: check.error },
      });
    } catch (err) {
      console.error('[settings] reject-audit failed (fail-soft):', err);
    }
    revalidatePath('/admin/settings');
    return;
  }

  try {
    const row = await prisma.ruleSuppression.create({
      data: {
        clinicId: s.clinicId ?? null,
        scope,
        targetKey,
        checkType,
        minLevel,
        showIn,
        createdByUserId: s.userId,
      },
    });
    await writeAudit({
      actorUserId: s.userId,
      action: 'ORDER_CHECK',
      resource: 'RuleSuppression.create',
      resourceId: row.id,
      detail: { scope, checkType, targetKey, minLevel, showIn },
    });
  } catch (err) {
    console.error('[settings] createSuppression failed (fail-soft):', err);
  }
  revalidatePath('/admin/settings');
}

export async function deleteSuppression(formData: FormData): Promise<void> {
  const s = await requireSession();
  const id = String(formData.get('id') || '');
  if (!id) return;
  try {
    // 監査に残せるよう、削除前に内容を取得しておく。
    const before = await prisma.ruleSuppression.findUnique({ where: { id } });
    await prisma.ruleSuppression.delete({ where: { id } });
    await writeAudit({
      actorUserId: s.userId,
      action: 'ORDER_CHECK',
      resource: 'RuleSuppression.delete',
      resourceId: id,
      detail: before
        ? { scope: before.scope, checkType: before.checkType, targetKey: before.targetKey }
        : undefined,
    });
  } catch (err) {
    console.error('[settings] deleteSuppression failed (fail-soft):', err);
  }
  revalidatePath('/admin/settings');
}
