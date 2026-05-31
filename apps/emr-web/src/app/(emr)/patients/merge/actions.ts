'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { requireSession } from '@/lib/session';

/**
 * FR-PAT-05 患者ID統合・VIP・仮ID（増築・UI完成）— サーバーアクション。
 *
 * - 統合：重複患者を物理削除せず、旧患者に Patient.mergedIntoId を設定して論理統合する。
 *   参照は統合先（生存ID）に解決される。AuditEvent(PATIENT_MERGE) を必ず残す（業務ルール）。
 * - VIP：isVip を設定（パスワードゲートは FR-PAT-01 側。ここでは VIP 区分の設定のみ）。
 * - 仮ID昇格：isTemporaryId=false にして本IDへ昇格。氏名/生年月日/性別の補完も可。
 *
 * いずれも DB 未接続（フロントのみモード）では try/catch でフェイルソフトにし、
 * フォーム送信が 500 にならないようにする（既存 diagnoses/countersign パターン踏襲）。
 */

/**
 * 重複患者を論理統合する — FR-PAT-05 AC(1)(2)。
 * sourceId（統合される旧ID）に mergedIntoId=targetId を設定。物理 DELETE は行わない。
 * 統合先＝targetId（生存ID）。自己統合・統合先が更に統合済みのケースは拒否/解決する。
 */
export async function mergePatients(
  input: { sourceId: string; targetId: string },
): Promise<{ ok: boolean; error?: string; demo?: boolean }> {
  const { sourceId, targetId } = input;
  if (!sourceId || !targetId) return { ok: false, error: '統合元・統合先の患者を指定してください' };
  if (sourceId === targetId) return { ok: false, error: '同一患者は統合できません' };

  try {
    const s = await requireSession();
    const [source, target] = await Promise.all([
      prisma.patient.findUnique({ where: { id: sourceId } }),
      prisma.patient.findUnique({ where: { id: targetId } }),
    ]);
    if (!source) return { ok: false, error: '統合元の患者が見つかりません' };
    if (!target) return { ok: false, error: '統合先の患者が見つかりません' };
    if (source.mergedIntoId) {
      return { ok: false, error: 'この患者は既に統合済みです' };
    }
    // 統合先が更に統合されている場合は最終的な生存IDへ付け替える（チェーン解決）。
    let resolvedTargetId = targetId;
    if (target.mergedIntoId) {
      const seen = new Set<string>([targetId]);
      let cur = target.mergedIntoId;
      // 無限ループ防止（最大10ホップ）。
      for (let i = 0; i < 10 && cur && !seen.has(cur); i++) {
        seen.add(cur);
        const nx = await prisma.patient.findUnique({
          where: { id: cur },
          select: { mergedIntoId: true },
        });
        if (!nx?.mergedIntoId) break;
        cur = nx.mergedIntoId;
      }
      resolvedTargetId = cur ?? targetId;
      if (resolvedTargetId === sourceId) {
        return { ok: false, error: '循環統合になるため実行できません' };
      }
    }

    await prisma.patient.update({
      where: { id: sourceId },
      data: { mergedIntoId: resolvedTargetId },
    });
    await writeAudit({
      actorUserId: s.userId,
      patientId: sourceId,
      action: 'PATIENT_MERGE',
      resource: 'Patient.merge',
      resourceId: sourceId,
      detail: {
        sourcePatientNo: source.patientNo,
        targetPatientNo: target.patientNo,
        mergedIntoId: resolvedTargetId,
        physicalDelete: false,
      },
    });
    revalidatePath('/patients/merge');
    return { ok: true };
  } catch (err) {
    console.error('[merge] mergePatients failed (fail-soft):', err);
    return { ok: true, demo: true };
  }
}

/** FormData 経路（プログレッシブ拡張）。 */
export async function mergePatientsForm(formData: FormData) {
  await mergePatients({
    sourceId: String(formData.get('sourceId') || ''),
    targetId: String(formData.get('targetId') || ''),
  });
}

/**
 * 統合を解除する（誤統合の是正）。mergedIntoId を null に戻す。物理操作なし。
 */
export async function unmergePatient(formData: FormData) {
  const s = await requireSession();
  const sourceId = String(formData.get('sourceId') || '');
  if (!sourceId) return;
  try {
    const p = await prisma.patient.update({
      where: { id: sourceId },
      data: { mergedIntoId: null },
    });
    await writeAudit({
      actorUserId: s.userId,
      patientId: sourceId,
      action: 'PATIENT_MERGE',
      resource: 'Patient.unmerge',
      resourceId: sourceId,
      detail: { patientNo: p.patientNo, mergedIntoId: null },
    });
  } catch (err) {
    console.error('[merge] unmergePatient failed (fail-soft):', err);
  }
  revalidatePath('/patients/merge');
}

/** VIP 区分の設定／解除 — FR-PAT-05（VIP 設定）。パスワードゲートは FR-PAT-01 側。 */
export async function setVip(formData: FormData) {
  const s = await requireSession();
  const id = String(formData.get('patientId') || '');
  const isVip = String(formData.get('isVip') || '') === 'on';
  if (!id) return;
  try {
    const p = await prisma.patient.update({
      where: { id },
      data: { isVip },
    });
    await writeAudit({
      actorUserId: s.userId,
      patientId: id,
      action: 'RESTRICTED_ACCESS',
      resource: 'Patient.setVip',
      resourceId: id,
      detail: { isVip, patientNo: p.patientNo },
    });
  } catch (err) {
    console.error('[merge] setVip failed (fail-soft):', err);
  }
  revalidatePath('/patients/merge');
}

/**
 * 仮ID → 本ID 昇格 — FR-PAT-05（仮ID→本ID昇格）。
 * isTemporaryId=false にし、必要なら氏名/生年月日/性別を確定値で補完する。
 */
export async function promoteTemporaryId(formData: FormData) {
  const s = await requireSession();
  const id = String(formData.get('patientId') || '');
  if (!id) return;
  const kanjiLastName = String(formData.get('kanjiLastName') || '').trim();
  const kanjiFirstName = String(formData.get('kanjiFirstName') || '').trim();
  const kanaLastName = String(formData.get('kanaLastName') || '').trim();
  const kanaFirstName = String(formData.get('kanaFirstName') || '').trim();
  const dob = String(formData.get('dateOfBirth') || '').trim();
  const genderRaw = String(formData.get('gender') || '').trim();

  const data: {
    isTemporaryId: boolean;
    kanjiLastName?: string;
    kanjiFirstName?: string;
    kanaLastName?: string;
    kanaFirstName?: string;
    dateOfBirth?: Date;
    gender?: 'MALE' | 'FEMALE' | 'OTHER' | 'UNKNOWN';
  } = { isTemporaryId: false };
  if (kanjiLastName) data.kanjiLastName = kanjiLastName;
  if (kanjiFirstName) data.kanjiFirstName = kanjiFirstName;
  if (kanaLastName) data.kanaLastName = kanaLastName;
  if (kanaFirstName) data.kanaFirstName = kanaFirstName;
  if (dob) {
    const d = new Date(dob);
    if (!Number.isNaN(d.getTime())) data.dateOfBirth = d;
  }
  if (['MALE', 'FEMALE', 'OTHER', 'UNKNOWN'].includes(genderRaw)) {
    data.gender = genderRaw as 'MALE' | 'FEMALE' | 'OTHER' | 'UNKNOWN';
  }

  try {
    const p = await prisma.patient.update({ where: { id }, data });
    await writeAudit({
      actorUserId: s.userId,
      patientId: id,
      action: 'CHART_WRITE',
      resource: 'Patient.promoteTemporaryId',
      resourceId: id,
      detail: { patientNo: p.patientNo, isTemporaryId: false },
    });
  } catch (err) {
    console.error('[merge] promoteTemporaryId failed (fail-soft):', err);
  }
  revalidatePath('/patients/merge');
}
