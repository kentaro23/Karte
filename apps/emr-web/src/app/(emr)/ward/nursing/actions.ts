'use server';
import { revalidatePath } from 'next/cache';
import { prisma, type NursingPlanItemKind, type PressureUlcerDepth } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { requireSession } from '@/lib/session';

/**
 * WP-WRD2 看護計画・褥瘡DESIGN-R の保存（FR-WRD-02）。
 *
 * 看護記録の追記（addNursing）は ward/actions.ts（WRD1所有）に既存。ここでは
 * 看護計画（看護診断/目標/介入/評価）と褥瘡DESIGN-R評価を、専用の本永続化モデルへ残す:
 *   - 看護計画 → NursingPlan + NursingPlanItem（各入力を kind 付き行に分解）
 *   - 褥瘡DESIGN-R → PressureUlcer（各項目点 + 深さ + 合計）
 * いずれも改訂は前版を消さず新しい行を積む（電子保存の三原則・真正性）。
 * PressureUlcer は db 層で append-only（UPDATE/DELETE 禁止）。看護計画も立案ごとに
 * 新規 plan を作成して履歴を保全する。
 *
 * 監査記録は本番化の核だが、フロントのみ（DB未接続）でも操作を完結させるため
 * 失敗を握りつぶす（discharge-summary と同方針）。全 DB 書込も try/catch で
 * fail-soft（DB無/dbDownモードでも画面が出る）。
 */
async function auditSafe(args: Parameters<typeof writeAudit>[0]): Promise<void> {
  try {
    await writeAudit(args);
  } catch (err) {
    console.error('[ward/nursing] writeAudit failed (non-fatal):', err);
  }
}

/** 看護計画（看護診断→期待される成果→看護介入O/T/E→評価）を NursingPlan として立案保存。 */
export async function addNursingPlan(formData: FormData): Promise<void> {
  const s = await requireSession();
  const patientId = String(formData.get('patientId') || '').trim();
  if (!patientId) return;
  const dx = String(formData.get('diagnosis') || '').trim();
  const goal = String(formData.get('goal') || '').trim();
  const intervention = String(formData.get('intervention') || '').trim();
  const evaluation = String(formData.get('evaluation') || '').trim();
  if (!dx && !goal && !intervention && !evaluation) return;

  // 各入力を kind 付きの計画項目へ。介入欄は O-T-E を一括入力する UI のため、
  // 観察計画 (INTERVENTION_O) に格納する（T/E は将来の分割入力に備え kind を用意済み）。
  const items: { kind: NursingPlanItemKind; content: string; sortOrder: number }[] = [];
  let sortOrder = 0;
  if (dx) items.push({ kind: 'DIAGNOSIS', content: dx, sortOrder: sortOrder++ });
  if (goal) items.push({ kind: 'GOAL', content: goal, sortOrder: sortOrder++ });
  if (intervention) items.push({ kind: 'INTERVENTION_O', content: intervention, sortOrder: sortOrder++ });
  if (evaluation) items.push({ kind: 'EVALUATION', content: evaluation, sortOrder: sortOrder++ });

  try {
    const plan = await prisma.nursingPlan.create({
      data: {
        patientId,
        title: dx || `看護計画 ${new Date().toLocaleDateString('ja-JP')}`,
        // 評価まで入力されていれば評価済として記録（評価日も付与）。
        status: evaluation ? 'REVISED' : 'ACTIVE',
        evaluatedOn: evaluation ? new Date() : null,
        authorUserId: s.userId,
        items: { create: items },
      },
    });
    await auditSafe({
      actorUserId: s.userId,
      patientId,
      action: 'CHART_WRITE',
      resource: 'NursingPlan',
      resourceId: plan.id,
    });
  } catch (err) {
    console.error('[ward/nursing] addNursingPlan failed:', err);
  }
  revalidatePath('/ward/nursing');
}

/** DESIGN-R の深さコード（d0〜D5 / DTI / U）を PressureUlcerDepth enum へ写す。 */
function mapDepth(code: string): PressureUlcerDepth {
  const c = code.trim().toUpperCase();
  switch (c) {
    case 'D0':
      return 'D0';
    case 'D1':
      return 'D1';
    case 'D2':
      return 'D2';
    case 'D3':
      return 'D3';
    case 'D4':
      return 'D4';
    case 'D5':
      return 'D5';
    case 'DTI':
    case 'DDTI':
      return 'DDTI';
    case 'U':
    case 'DU':
    default:
      return 'DU'; // 深さ判定不能（スキーマ既定）
  }
}

/**
 * 褥瘡 DESIGN-R®2020 の評価を PressureUlcer として追記保存（append-only）。
 * 各項目の点数と深さコードを専用カラムに残す。合計 (totalScore)＝Depth 以外の
 * 6 項目の合計（Depth は重症度判定に含めない通則）。訂正は新規行（UPDATE しない）。
 */
export async function addPressureUlcerScore(formData: FormData): Promise<void> {
  const s = await requireSession();
  const patientId = String(formData.get('patientId') || '').trim();
  if (!patientId) return;

  const get = (k: string) => String(formData.get(k) || '').trim();
  const num = (k: string) => {
    const v = Number(get(k));
    return Number.isFinite(v) ? v : 0;
  };
  const site = get('site');

  const depthScore = num('depthScore');
  const exudateScore = num('exudateScore');
  const sizeScore = num('sizeScore');
  const inflammationScore = num('inflammationScore');
  const granulationScore = num('granulationScore');
  const necroticScore = num('necroticScore');
  const pocketScore = num('pocketScore');
  // Depth は合計（重症度）に含めない（DESIGN-R 通則）。
  const totalScore =
    exudateScore + sizeScore + inflammationScore + granulationScore + necroticScore + pocketScore;

  try {
    const pu = await prisma.pressureUlcer.create({
      data: {
        patientId,
        site: site || null,
        depth: mapDepth(get('depth')),
        depthScore,
        exudateScore,
        sizeScore,
        inflammationScore,
        granulationScore,
        necroticScore,
        pocketScore,
        totalScore,
        assessedOn: new Date(),
        assessedByUserId: s.userId,
      },
    });
    await auditSafe({
      actorUserId: s.userId,
      patientId,
      action: 'CHART_WRITE',
      resource: 'PressureUlcer',
      resourceId: pu.id,
    });
  } catch (err) {
    console.error('[ward/nursing] addPressureUlcerScore failed:', err);
  }
  revalidatePath('/ward/nursing');
}
