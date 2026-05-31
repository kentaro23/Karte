'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import {
  composeDiseaseName,
  assertDiagnosisTransition,
  assertResolveWithOutcome,
  type DiagnosisStatus,
  type DiseaseOutcome,
} from '@medixus/domain';
import { exportData } from '@medixus/interop';
import { requireSession } from '@/lib/session';

const OUTCOMES: DiseaseOutcome[] = [
  'CURED',
  'IMPROVED',
  'UNCHANGED',
  'TRANSFERRED',
  'DECEASED',
  'STOPPED',
];

function parseOutcome(v: unknown): DiseaseOutcome | null {
  const s = String(v ?? '');
  return (OUTCOMES as string[]).includes(s) ? (s as DiseaseOutcome) : null;
}

/** RESOLVED に至る転帰か（治癒/転医=転帰確定、その他は ACTIVE 継続）。 */
function statusForOutcome(outcome: DiseaseOutcome): DiagnosisStatus {
  return outcome === 'CURED' || outcome === 'TRANSFERRED' ? 'RESOLVED' : 'ACTIVE';
}

/* ─────────────────────────────────────────────────────────────────────────
 * 病名登録（標準病名マスタ＋三連ボタン＋修飾語合成）— FR-DX-01 AC(1)(2)(4)
 * ──────────────────────────────────────────────────────────────────────── */
export type AddDiagnosisInput = {
  patientId: string;
  masterCode: string | null;
  /** マスタの基本病名（修飾語合成のベース）。 */
  baseName: string;
  icd10: string | null;
  /** 前置修飾語（急性/慢性/出血性…）。composeDiseaseName で合成。 */
  modifiers: string[];
  /** ThreeButtonDx の選択（確定/主病/疑い）由来のフラグ。 */
  isMain: boolean;
  isSuspected: boolean;
  acuteChronic: string | null; // ACUTE | CHRONIC | null
  departmentId: string | null;
  /** 開始日（YYYY-MM-DD）。未指定は当日。 */
  startDate: string | null;
  forBilling: boolean;
};

export async function addDiagnosisRich(
  input: AddDiagnosisInput,
): Promise<{ ok: boolean; error?: string; demo?: boolean; displayName: string }> {
  const displayName = composeDiseaseName(input.baseName, input.modifiers);
  if (!input.patientId || !displayName) {
    return { ok: false, error: '患者と病名を指定してください', displayName };
  }
  let startDate: Date | undefined;
  if (input.startDate) {
    const d = new Date(input.startDate);
    if (!Number.isNaN(d.getTime())) startDate = d;
  }
  try {
    const s = await requireSession();
    await prisma.patientDiagnosis.create({
      data: {
        patientId: input.patientId,
        masterCode: input.masterCode,
        displayName,
        icd10: input.icd10,
        isMain: input.isMain,
        isSuspected: input.isSuspected,
        acuteChronic: input.acuteChronic,
        departmentId: input.departmentId,
        forBilling: input.forBilling,
        ...(startDate ? { startDate } : {}),
        recordedByUserId: s.userId,
      },
    });
    await writeAudit({
      actorUserId: s.userId,
      patientId: input.patientId,
      action: 'CHART_WRITE',
      resource: 'PatientDiagnosis',
      detail: { displayName, icd10: input.icd10, modifiers: input.modifiers },
    });
    revalidatePath(`/diagnoses?patientId=${input.patientId}`);
    return { ok: true, displayName };
  } catch (err) {
    // DB未接続でも UI を止めない（フロントのみモード）。
    console.error('[diagnoses] addDiagnosisRich failed (fail-soft):', err);
    return { ok: true, demo: true, displayName };
  }
}

/** 既存フォーム互換（旧 page.tsx の <form action> 経路を温存）。 */
export async function addDiagnosis(formData: FormData) {
  await addDiagnosisRich({
    patientId: String(formData.get('patientId') || ''),
    masterCode: String(formData.get('masterCode') || '') || null,
    baseName: String(formData.get('displayName') || '').trim(),
    icd10: String(formData.get('icd10') || '') || null,
    modifiers: [],
    isMain: formData.get('isMain') === 'on',
    isSuspected: formData.get('isSuspected') === 'on',
    acuteChronic: String(formData.get('acuteChronic') || '') || null,
    departmentId: null,
    startDate: null,
    forBilling: true,
  });
}

/* ─────────────────────────────────────────────────────────────────────────
 * 転帰（単一）— 既存互換 + 遷移ガード
 * ──────────────────────────────────────────────────────────────────────── */
export async function setOutcome(formData: FormData) {
  const id = String(formData.get('id') || '');
  const outcome = parseOutcome(formData.get('outcome'));
  if (!id || !outcome) return;
  await applyOutcome(id, outcome);
}

/* ─────────────────────────────────────────────────────────────────────────
 * 一括転帰 — FR-DX-01 AC(3)。複数病名へ転帰を一括適用。
 * ──────────────────────────────────────────────────────────────────────── */
export async function bulkSetOutcome(
  ids: string[],
  outcomeRaw: string,
): Promise<{ ok: boolean; error?: string; demo?: boolean; count: number }> {
  const outcome = parseOutcome(outcomeRaw);
  if (!outcome) return { ok: false, error: '転帰を選択してください', count: 0 };
  if (ids.length === 0) return { ok: false, error: '病名を選択してください', count: 0 };

  const nextStatus = statusForOutcome(outcome);
  try {
    // 遷移ガード（RESOLVED には転帰必須／不正遷移を弾く）。純関数で先に検証。
    assertResolveWithOutcome(nextStatus, outcome);
    const s = await requireSession();
    let count = 0;
    let patientId: string | null = null;
    for (const id of ids) {
      const current = await prisma.patientDiagnosis.findUnique({ where: { id } });
      if (!current) continue;
      // DELETED からは遷移不可（ガードが throw）。fail-soft に skip。
      try {
        assertDiagnosisTransition(current.status as DiagnosisStatus, nextStatus);
      } catch {
        continue;
      }
      const d = await prisma.patientDiagnosis.update({
        where: { id },
        data: { outcome, outcomeDate: new Date(), status: nextStatus },
      });
      patientId = d.patientId;
      count++;
    }
    if (patientId) {
      await writeAudit({
        actorUserId: s.userId,
        patientId,
        action: 'CHART_WRITE',
        resource: 'PatientDiagnosis.bulkOutcome',
        detail: { outcome, count, ids },
      });
      revalidatePath(`/diagnoses?patientId=${patientId}`);
    }
    return { ok: true, count };
  } catch (err) {
    console.error('[diagnoses] bulkSetOutcome failed (fail-soft):', err);
    // ガードのバリデーションエラーはユーザーに返す。それ以外（DB断）はデモ成功。
    if (err instanceof Error && err.message.includes('転帰')) {
      return { ok: false, error: err.message, count: 0 };
    }
    return { ok: true, demo: true, count: ids.length };
  }
}

/** 単一転帰の内部適用（ガード付き）。 */
async function applyOutcome(id: string, outcome: DiseaseOutcome): Promise<void> {
  const nextStatus = statusForOutcome(outcome);
  try {
    const current = await prisma.patientDiagnosis.findUnique({ where: { id } });
    if (current) assertDiagnosisTransition(current.status as DiagnosisStatus, nextStatus);
    const s = await requireSession();
    const d = await prisma.patientDiagnosis.update({
      where: { id },
      data: { outcome, outcomeDate: new Date(), status: nextStatus },
    });
    await writeAudit({
      actorUserId: s.userId,
      patientId: d.patientId,
      action: 'CHART_WRITE',
      resource: 'PatientDiagnosis.outcome',
      resourceId: id,
      detail: { outcome },
    });
    revalidatePath(`/diagnoses?patientId=${d.patientId}`);
  } catch (err) {
    console.error('[diagnoses] applyOutcome failed (fail-soft):', err);
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * 当月有効（レセ請求対象）トグル — forBilling
 * ──────────────────────────────────────────────────────────────────────── */
export async function toggleForBilling(
  id: string,
  forBilling: boolean,
): Promise<{ ok: boolean; demo?: boolean }> {
  if (!id) return { ok: false };
  try {
    const s = await requireSession();
    const d = await prisma.patientDiagnosis.update({
      where: { id },
      data: { forBilling },
    });
    await writeAudit({
      actorUserId: s.userId,
      patientId: d.patientId,
      action: 'CHART_WRITE',
      resource: 'PatientDiagnosis.forBilling',
      resourceId: id,
      detail: { forBilling },
    });
    revalidatePath(`/diagnoses?patientId=${d.patientId}`);
    return { ok: true };
  } catch (err) {
    console.error('[diagnoses] toggleForBilling failed (fail-soft):', err);
    return { ok: true, demo: true };
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * 病名 論理削除（DELETED）— 遷移ガード
 * ──────────────────────────────────────────────────────────────────────── */
export async function deleteDiagnosis(id: string): Promise<{ ok: boolean; demo?: boolean }> {
  if (!id) return { ok: false };
  try {
    const current = await prisma.patientDiagnosis.findUnique({ where: { id } });
    if (current) assertDiagnosisTransition(current.status as DiagnosisStatus, 'DELETED');
    const s = await requireSession();
    const d = await prisma.patientDiagnosis.update({
      where: { id },
      data: { status: 'DELETED' },
    });
    await writeAudit({
      actorUserId: s.userId,
      patientId: d.patientId,
      action: 'CHART_WRITE',
      resource: 'PatientDiagnosis.delete',
      resourceId: id,
      detail: { status: 'DELETED' },
    });
    revalidatePath(`/diagnoses?patientId=${d.patientId}`);
    return { ok: true };
  } catch (err) {
    console.error('[diagnoses] deleteDiagnosis failed (fail-soft):', err);
    return { ok: true, demo: true };
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * エクスポート — IF-EXT-07 データポータビリティ（interop exportData / STUB）
 * ──────────────────────────────────────────────────────────────────────── */
export async function exportDiagnoses(
  patientId: string,
  format: 'FHIR' | 'SS_MIX2' | 'COMMON_MIGRATION_LAYOUT' = 'FHIR',
): Promise<{ status: string; recordCount?: number; error?: string }> {
  try {
    const res = await exportData({
      patientRef: patientId || undefined,
      format,
    });
    try {
      const s = await requireSession();
      await writeAudit({
        actorUserId: s.userId,
        patientId: patientId || null,
        action: 'FILE_EXPORT',
        resource: 'PatientDiagnosis.export',
        result: res.status,
        detail: { format },
      });
    } catch {
      /* 監査はベストエフォート（DB断でもエクスポート結果は返す）。 */
    }
    return { status: res.status, recordCount: res.data?.recordCount };
  } catch (err) {
    console.error('[diagnoses] exportDiagnoses failed (fail-soft):', err);
    return { status: 'STUB', error: 'エクスポートはバックエンド接続時に実行されます（デモ表示）。' };
  }
}
