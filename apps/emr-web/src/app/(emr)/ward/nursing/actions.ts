'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { requireSession } from '@/lib/session';

/**
 * WP-WRD2 看護計画・褥瘡DESIGN-R の保存（FR-WRD-02）。
 *
 * 看護記録の追記（addNursing）は ward/actions.ts（WRD1所有）に既存。ここでは
 * 看護計画（看護診断/目標/介入/評価）と褥瘡DESIGN-R評価を、いずれも
 * ClinicalDocument に docType を分けて「追記専用」で残す。改訂は前版を消さず
 * 新しい行を積む（電子保存の三原則・真正性）。
 *
 * 監査記録は本番化の核だが、フロントのみ（DB未接続）でも操作を完結させるため
 * 失敗を握りつぶす（discharge-summary と同方針）。
 */
async function auditSafe(args: Parameters<typeof writeAudit>[0]): Promise<void> {
  try {
    await writeAudit(args);
  } catch (err) {
    console.error('[ward/nursing] writeAudit failed (non-fatal):', err);
  }
}

export const NURSING_PLAN_DOCTYPE = '看護計画';
export const PRESSURE_ULCER_DOCTYPE = '褥瘡DESIGN-R';

/** 看護計画（看護診断→期待される成果→看護介入→評価）を追記保存。 */
export async function addNursingPlan(formData: FormData): Promise<void> {
  const s = await requireSession();
  const patientId = String(formData.get('patientId') || '').trim();
  if (!patientId) return;
  const dx = String(formData.get('diagnosis') || '').trim();
  const goal = String(formData.get('goal') || '').trim();
  const intervention = String(formData.get('intervention') || '').trim();
  const evaluation = String(formData.get('evaluation') || '').trim();
  if (!dx && !goal && !intervention && !evaluation) return;

  const body = [
    dx && `【看護診断/問題】\n${dx}`,
    goal && `【期待される成果（目標）】\n${goal}`,
    intervention && `【看護介入（O-T-E）】\n${intervention}`,
    evaluation && `【評価】\n${evaluation}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const doc = await prisma.clinicalDocument.create({
      data: {
        patientId,
        docType: NURSING_PLAN_DOCTYPE,
        title: `看護計画 ${new Date().toLocaleDateString('ja-JP')}`,
        format: 'TEXT',
        body,
        createdByUserId: s.userId,
      },
    });
    await auditSafe({
      actorUserId: s.userId,
      patientId,
      action: 'CHART_WRITE',
      resource: NURSING_PLAN_DOCTYPE,
      resourceId: doc.id,
    });
  } catch (err) {
    console.error('[ward/nursing] addNursingPlan failed:', err);
  }
  revalidatePath('/ward/nursing');
}

/**
 * 褥瘡 DESIGN-R®2020 の評価を追記保存。各項目の重症度コードと合計点を本文に残す。
 * 合計＝Depth 以外の 6 項目の合計（Depth は重症度判定に含めない通則に倣う）。
 */
export async function addPressureUlcerScore(formData: FormData): Promise<void> {
  const s = await requireSession();
  const patientId = String(formData.get('patientId') || '').trim();
  if (!patientId) return;

  const get = (k: string) => String(formData.get(k) || '').trim();
  const site = get('site');
  const items: { key: string; label: string; code: string; score: number }[] = [
    { key: 'depth', label: 'Depth 深さ', code: get('depth'), score: Number(get('depthScore') || 0) },
    { key: 'exudate', label: 'Exudate 滲出液', code: get('exudate'), score: Number(get('exudateScore') || 0) },
    { key: 'size', label: 'Size 大きさ', code: get('size'), score: Number(get('sizeScore') || 0) },
    { key: 'inflammation', label: 'Inflammation 炎症/感染', code: get('inflammation'), score: Number(get('inflammationScore') || 0) },
    { key: 'granulation', label: 'Granulation 肉芽組織', code: get('granulation'), score: Number(get('granulationScore') || 0) },
    { key: 'necrotic', label: 'Necrotic tissue 壊死組織', code: get('necrotic'), score: Number(get('necroticScore') || 0) },
    { key: 'pocket', label: 'Pocket ポケット', code: get('pocket'), score: Number(get('pocketScore') || 0) },
  ];
  // Depth は合計（重症度）に含めない（DESIGN-R 通則）。
  const total = items
    .filter((it) => it.key !== 'depth')
    .reduce((sum, it) => sum + (Number.isFinite(it.score) ? it.score : 0), 0);

  const body = [
    site && `部位: ${site}`,
    `合計（Depth除く）: ${total} 点`,
    '',
    ...items.map((it) => `${it.label}: ${it.code || '—'}（${Number.isFinite(it.score) ? it.score : 0}）`),
  ]
    .filter((l) => l !== undefined)
    .join('\n');

  try {
    const doc = await prisma.clinicalDocument.create({
      data: {
        patientId,
        docType: PRESSURE_ULCER_DOCTYPE,
        title: `褥瘡DESIGN-R ${new Date().toLocaleDateString('ja-JP')}（${total}点）`,
        format: 'TEXT',
        body,
        createdByUserId: s.userId,
      },
    });
    await auditSafe({
      actorUserId: s.userId,
      patientId,
      action: 'CHART_WRITE',
      resource: PRESSURE_ULCER_DOCTYPE,
      resourceId: doc.id,
    });
  } catch (err) {
    console.error('[ward/nursing] addPressureUlcerScore failed:', err);
  }
  revalidatePath('/ward/nursing');
}
