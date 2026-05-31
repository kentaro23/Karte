'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { assertReceptionTransition, type ReceptionStatus } from '@medixus/domain';
import { requireSession } from '@/lib/session';

/* ───────────────────────────────────────────────────────────────────────────
 * 会計確定 — FR-BIL-01 AC(3)。
 * 受付ステータスを CONSULTATION_DONE → BILLING_DONE へ遷移（状態機械ガード）。
 * 請求内訳（自己負担/自費/繰越/調整/入金/差額）は監査に保存する。
 * 保険算定本体はレセコン連携（IF-EXT-01）に委譲し、ここでは内製の点→円・自己負担
 * 計算結果のスナップショットを記録する。
 * ──────────────────────────────────────────────────────────────────────── */
export type FinalizeBillingInput = {
  encounterId: string;
  patientId: string;
  totalPoints: number;
  copayRatio: number;
  copayYen: number;
  selfPayYen: number;
  carryOverYen: number;
  adjustmentYen: number;
  billedYen: number;
  depositYen: number;
  changeYen: number;
};

export async function finalizeBilling(
  input: FinalizeBillingInput,
): Promise<{ ok: boolean; error?: string; demo?: boolean }> {
  if (!input.encounterId) {
    return { ok: false, error: '会計対象が指定されていません' };
  }
  try {
    const s = await requireSession();
    const enc = await prisma.encounter.findUnique({ where: { id: input.encounterId } });
    if (!enc) {
      // DB はあるが対象が無い（デモ encounterId 等）→ fail-soft でデモ成功扱い。
      return { ok: true, demo: true };
    }
    const from = enc.receptionStatus as ReceptionStatus;
    // 既に会計済なら冪等に成功（再発行のため画面は残す）。
    if (from === 'BILLING_DONE') {
      return { ok: true };
    }
    // 状態機械ガード（CONSULTATION_DONE 以外からの確定は弾く）。純関数で先に検証。
    assertReceptionTransition(from, 'BILLING_DONE');

    await prisma.$transaction([
      prisma.encounter.update({
        where: { id: input.encounterId },
        data: { receptionStatus: 'BILLING_DONE' },
      }),
      prisma.encounterStatusTransition.create({
        data: {
          encounterId: input.encounterId,
          fromStatus: from,
          toStatus: 'BILLING_DONE',
          byUserId: s.userId,
          manual: true,
        },
      }),
    ]);

    await writeAudit({
      actorUserId: s.userId,
      patientId: input.patientId || enc.patientId,
      action: 'CHART_WRITE',
      resource: 'Encounter.billing',
      resourceId: input.encounterId,
      detail: {
        event: 'BILLING_DONE',
        totalPoints: input.totalPoints,
        copayRatio: input.copayRatio,
        copayYen: input.copayYen,
        selfPayYen: input.selfPayYen,
        carryOverYen: input.carryOverYen,
        adjustmentYen: input.adjustmentYen,
        billedYen: input.billedYen,
        depositYen: input.depositYen,
        changeYen: input.changeYen,
      },
    });
    revalidatePath('/billing');
    return { ok: true };
  } catch (err) {
    // 状態遷移ガードのエラーはユーザーへ返す。それ以外（DB断）はデモ成功で UI を止めない。
    if (err instanceof Error && err.message.includes('遷移')) {
      return { ok: false, error: '診察終了の会計のみ確定できます（現在の状態では確定できません）。' };
    }
    console.error('[billing] finalizeBilling failed (fail-soft):', err);
    return { ok: true, demo: true };
  }
}

/* ───────────────────────────────────────────────────────────────────────────
 * 発行物の一括発行記録 — FR-BIL-01 AC(2)。
 * 領収書/診療明細書/院外処方箋/薬剤情報提供書/お薬手帳の発行を監査に残す
 * （実体の帳票は /print/* 画面でブラウザ印刷）。ベストエフォート。
 * ──────────────────────────────────────────────────────────────────────── */
export async function recordIssuePrints(
  encounterId: string,
  patientId: string,
  documents: string[],
): Promise<{ ok: boolean; demo?: boolean }> {
  try {
    const s = await requireSession();
    await writeAudit({
      actorUserId: s.userId,
      patientId: patientId || null,
      action: 'PRINT',
      resource: 'Billing.issue',
      resourceId: encounterId || null,
      detail: { documents },
    });
    return { ok: true };
  } catch (err) {
    console.error('[billing] recordIssuePrints failed (fail-soft):', err);
    return { ok: true, demo: true };
  }
}
