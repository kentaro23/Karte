'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { requireSession } from '@/lib/session';

/**
 * FR-RCP-04 受付登録 — 患者検索→受付。
 * 来院した患者の外来 `Encounter` を `receptionStatus=ARRIVED` で生成し、
 * 受付番号を採番して受付票印刷（A6）へ遷移する。
 *
 * フロントのみ（DATABASE_URL 未設定）でも動くよう、Prisma はデモプロキシが
 * サンプルデータ／擬似 id を返す前提（try/catch でフェイルソフト）。
 */
export async function registerReception(formData: FormData) {
  const s = await requireSession();
  const hdr = await headers();
  const terminalId = hdr.get('x-terminal-id') ?? 'web';

  const patientId = String(formData.get('patientId') || '').trim();
  if (!patientId) throw new Error('患者を選択してください');

  const visitType = (String(formData.get('visitType') || 'RETURN') === 'FIRST'
    ? 'FIRST'
    : 'RETURN') as 'FIRST' | 'RETURN';
  const departmentIdInput = String(formData.get('departmentId') || '').trim();
  const insuranceId = String(formData.get('insuranceId') || '').trim() || null;
  const arrivalMethod = String(formData.get('arrivalMethod') || '').trim() || null;

  let encounterId = '';
  try {
    const patient = await prisma.patient.findUnique({ where: { id: patientId } });
    if (!patient) throw new Error('患者が見つかりません');

    // 診療科: フォーム選択を優先、未指定なら当該クリニックの先頭科。
    const dept =
      (departmentIdInput
        ? await prisma.department.findUnique({ where: { id: departmentIdInput } })
        : null) ?? (await prisma.department.findFirst({ where: { clinicId: patient.clinicId } }));

    // 受付番号: 本日の外来受付の最大 receptionNo + 1（簡易採番）。
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    let receptionNo = 1;
    try {
      const last = await prisma.encounter.findFirst({
        where: {
          encounterType: 'OUTPATIENT',
          createdAt: { gte: startOfDay },
          receptionNo: { not: null },
        },
        orderBy: { receptionNo: 'desc' },
        select: { receptionNo: true },
      });
      if (last?.receptionNo != null) receptionNo = last.receptionNo + 1;
    } catch {
      // 採番取得に失敗しても受付自体は通す。
    }

    const enc = await prisma.encounter.create({
      data: {
        patientId,
        encounterType: 'OUTPATIENT',
        visitType,
        contactType: 'FACE',
        departmentId: dept?.id ?? 'unknown',
        insuranceId,
        receptionNo,
        receptionStatus: 'ARRIVED',
        arrivalMethod,
        isTemporaryId: patient.isTemporaryId ?? false,
        arrivedAt: new Date(),
        openedByUserId: s.userId,
      },
    });
    encounterId = enc.id;

    // 受付＝来院確定の状態遷移として履歴に残す（UNRECEIVED→ARRIVED）。
    try {
      await prisma.encounterStatusTransition.create({
        data: {
          encounterId: enc.id,
          fromStatus: 'UNRECEIVED',
          toStatus: 'ARRIVED',
          byUserId: s.userId,
          manual: true,
        },
      });
    } catch {
      // 履歴記録の失敗は受付完了を妨げない。
    }

    await writeAudit({
      actorUserId: s.userId,
      patientId,
      action: 'PATIENT_SELECT',
      resource: 'Encounter',
      resourceId: enc.id,
      terminalId,
      detail: { reception: true, receptionNo, visitType },
    });
  } catch (err) {
    // フロントのみモード等で DB 未接続でも遷移できるよう、id が取れていれば続行。
    console.error('[registerReception] failed:', err);
    if (!encounterId) throw err;
  }

  // 受付票（A6）印刷ページへ。新規受付の id で開く。
  redirect(`/print/reception/${encounterId}`);
}
