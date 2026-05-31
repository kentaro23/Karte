'use server';
import { revalidatePath } from 'next/cache';
import { prisma, type Prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { requireSession } from '@/lib/session';
import { SAFETY_ENTITY_TABLES, type SafetyEntityTable } from './constants';

/**
 * 安全データ 薬剤師レビュー昇格 — FR-RXSAFE-06 / ギャップ G13b。
 *
 * 取込／暫定（`isProvisional` または source≠PHARMACIST_VERIFIED）の医薬品安全データを
 * 薬剤師（PHARMACIST）がレビューして承認すると、`source` が **PHARMACIST_VERIFIED** に
 * 昇格する（AC(1)）。差分はすべて追記専用ログ `DrugSafetyReviewLog` に before/after＋
 * 出典＋理由付きで記録され、全変更が追跡できる（AC(2)・業務ルール）。
 *
 * 対象テーブル: DrugIndication / DrugDosage / DrugContraindication / DrugInteraction。
 * いずれも `source: DrugDataSource`・`isProvisional`・`reviewedByUserId`・`reviewedAt` を持つ。
 *
 * DB 未接続（フロントのみモード）では prisma が no-op になるため try/catch で
 * フェイルソフトにする。
 */

// 対象テーブル定義（SAFETY_ENTITY_TABLES / SafetyEntityTable）は './constants' に移設。
// ('use server' ファイルでは async 関数以外の値を export できないため。)

function isSafetyTable(t: string): t is SafetyEntityTable {
  return (SAFETY_ENTITY_TABLES as readonly string[]).includes(t);
}

/** Date 等を含む行を Json フィールドに格納できる形へ正規化する。 */
function toJson(row: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(row ?? {})) as Prisma.InputJsonValue;
}

const PROMOTE_DATA = {
  source: 'PHARMACIST_VERIFIED' as const,
  isProvisional: false,
};

/**
 * テーブル別に findUnique→update を行い [before, after] を返す。
 * 各 delegate は型が異なるため明示 switch（dynamic index を避け型安全に）。
 */
async function promoteRow(
  table: SafetyEntityTable,
  id: string,
  reviewedByUserId: string,
): Promise<[Record<string, unknown> | null, Record<string, unknown>]> {
  const reviewedAt = new Date();
  switch (table) {
    case 'DrugIndication': {
      const before = await prisma.drugIndication.findUnique({ where: { id } });
      const after = await prisma.drugIndication.update({
        where: { id },
        data: { ...PROMOTE_DATA, reviewedByUserId, reviewedAt },
      });
      return [before, after];
    }
    case 'DrugDosage': {
      const before = await prisma.drugDosage.findUnique({ where: { id } });
      const after = await prisma.drugDosage.update({
        where: { id },
        data: { ...PROMOTE_DATA, reviewedByUserId, reviewedAt },
      });
      return [before, after];
    }
    case 'DrugContraindication': {
      const before = await prisma.drugContraindication.findUnique({ where: { id } });
      const after = await prisma.drugContraindication.update({
        where: { id },
        data: { ...PROMOTE_DATA, reviewedByUserId, reviewedAt },
      });
      return [before, after];
    }
    case 'DrugInteraction': {
      const before = await prisma.drugInteraction.findUnique({ where: { id } });
      const after = await prisma.drugInteraction.update({
        where: { id },
        data: { ...PROMOTE_DATA, reviewedByUserId, reviewedAt },
      });
      return [before, after];
    }
  }
}

/**
 * 暫定安全データを PHARMACIST_VERIFIED へ昇格する（薬剤師レビュー）。
 * 昇格 update に続けて追記専用ログに before/after＋出典＋理由を残す。
 */
export async function promoteSafetyData(formData: FormData): Promise<void> {
  const s = await requireSession();
  const entityTable = String(formData.get('entityTable') || '');
  const id = String(formData.get('id') || '');
  const reason = String(formData.get('reason') || '').trim() || null;
  if (!id || !isSafetyTable(entityTable)) return;

  // 薬剤師（PHARMACIST）のみが昇格できる業務ルール。デモ／DB未接続では
  // jobType が取れないこともあるため、jobType が明示的に PHARMACIST/ADMIN 以外の
  // ときだけ拒否する（フェイルソフト）。
  if (s.jobType && s.jobType !== 'PHARMACIST' && s.jobType !== 'ADMIN') {
    try {
      await writeAudit({
        actorUserId: s.userId,
        action: 'ORDER_CHECK',
        resource: `${entityTable}.promote.rejected`,
        resourceId: id,
        result: 'DENIED',
        detail: { reason: 'PHARMACIST 権限が必要です', jobType: s.jobType },
      });
    } catch (err) {
      console.error('[safety-review] reject-audit failed (fail-soft):', err);
    }
    revalidatePath('/safety-review');
    return;
  }

  try {
    const [before, after] = await promoteRow(entityTable, id, s.userId);
    const sourceCitation =
      (before?.sourceCitation as string | undefined) ?? '薬剤師レビュー昇格';

    // 追記専用の安全データレビュー証跡（真正性）。before/after＋出典＋理由。
    await prisma.drugSafetyReviewLog.create({
      data: {
        entityTable,
        entityId: id,
        action: 'supersede',
        before: toJson(before),
        after: toJson(after),
        reviewedByUserId: s.userId,
        reason,
        sourceCitation,
      },
    });

    await writeAudit({
      actorUserId: s.userId,
      action: 'ORDER_CHECK',
      resource: `${entityTable}.promote`,
      resourceId: id,
      detail: {
        from: (before?.source as string | undefined) ?? null,
        to: 'PHARMACIST_VERIFIED',
        reason,
      },
    });
  } catch (err) {
    console.error('[safety-review] promoteSafetyData failed (fail-soft):', err);
  }
  revalidatePath('/safety-review');
}
