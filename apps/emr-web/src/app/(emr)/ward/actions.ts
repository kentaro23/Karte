'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { requireSession } from '@/lib/session';

/**
 * 入院受付 — FR-WRD-01 AC(1)。患者に INPATIENT Encounter を作り病棟（任意で診療科・病床）を割当てる。
 * Encounter には bedId カラムが無い（基盤確定）ため、割当病床コードは監査 detail に残し、
 * 病床マップ側で在床順に割付け表示する（トレーサブルかつ既存マップ挙動と整合）。
 * DB 未接続（フロントのみモード）でも 500 にしない＝try/catch でフェイルソフト。
 */
export async function admitPatient(formData: FormData) {
  const patientId = String(formData.get('patientId') || '');
  const wardId = String(formData.get('wardId') || '');
  const departmentId = String(formData.get('departmentId') || '');
  const bedCode = String(formData.get('bedCode') || '');
  if (!patientId || !wardId) return;
  try {
    const s = await requireSession();
    const p = await prisma.patient.findUnique({ where: { id: patientId } });
    if (!p) return;
    const dept = departmentId
      ? await prisma.department.findUnique({ where: { id: departmentId } })
      : await prisma.department.findFirst({ where: { clinicId: p.clinicId } });
    const e = await prisma.encounter.create({
      data: {
        patientId,
        encounterType: 'INPATIENT',
        contactType: 'FACE',
        departmentId: dept?.id ?? 'unknown',
        wardId,
        receptionStatus: 'IN_CONSULTATION',
        arrivedAt: new Date(),
      },
    });
    await writeAudit({
      actorUserId: s.userId,
      patientId,
      action: 'CHART_WRITE',
      resource: 'Admission',
      resourceId: e.id,
      detail: { wardId, departmentId: dept?.id ?? null, bedCode: bedCode || null },
    });
  } catch (err) {
    console.error('[ward] admitPatient failed (fail-soft):', err);
  }
  revalidatePath('/ward/admissions');
  revalidatePath('/ward/map');
}

/**
 * 転棟／転科 — FR-WRD-01 AC(2)。在院 Encounter の病棟・診療科（任意で病床）を付け替え、
 * 変更前後を監査 detail に必ず残す（移動記録＝法定の所在管理）。
 * 転棟・転科・転室のいずれか1つ以上が指定されている必要がある。
 */
export async function transferPatient(formData: FormData) {
  const id = String(formData.get('id') || '');
  const toWardId = String(formData.get('toWardId') || '');
  const toDepartmentId = String(formData.get('toDepartmentId') || '');
  const toBedCode = String(formData.get('toBedCode') || '');
  const reason = String(formData.get('reason') || '').trim();
  if (!id) return;
  try {
    const s = await requireSession();
    const before = await prisma.encounter.findUnique({ where: { id } });
    if (!before) return;
    const data: { wardId?: string; departmentId?: string } = {};
    if (toWardId && toWardId !== before.wardId) data.wardId = toWardId;
    if (toDepartmentId && toDepartmentId !== before.departmentId) data.departmentId = toDepartmentId;
    // 病棟・診療科いずれも変わらず病床だけの転室なら Encounter 更新は不要だが、移動記録は残す。
    const e = Object.keys(data).length > 0
      ? await prisma.encounter.update({ where: { id }, data })
      : before;
    await writeAudit({
      actorUserId: s.userId,
      patientId: e.patientId,
      action: 'CHART_WRITE',
      resource: 'Transfer',
      resourceId: id,
      detail: {
        fromWardId: before.wardId ?? null,
        toWardId: data.wardId ?? before.wardId ?? null,
        fromDepartmentId: before.departmentId ?? null,
        toDepartmentId: data.departmentId ?? before.departmentId ?? null,
        toBedCode: toBedCode || null,
        reason: reason || null,
        kind:
          data.wardId && data.departmentId
            ? 'WARD_AND_DEPT'
            : data.wardId
              ? 'WARD'
              : data.departmentId
                ? 'DEPT'
                : 'BED',
      },
    });
  } catch (err) {
    console.error('[ward] transferPatient failed (fail-soft):', err);
  }
  revalidatePath('/ward/admissions');
  revalidatePath('/ward/map');
}

export async function dischargePatient(formData: FormData) {
  const id = String(formData.get('id') || '');
  if (!id) return;
  try {
    const s = await requireSession();
    const e = await prisma.encounter.update({
      where: { id },
      data: { receptionStatus: 'BILLING_DONE' },
    });
    await writeAudit({
      actorUserId: s.userId,
      patientId: e.patientId,
      action: 'CHART_WRITE',
      resource: 'Discharge',
      resourceId: id,
    });
  } catch (err) {
    console.error('[ward] dischargePatient failed (fail-soft):', err);
  }
  revalidatePath('/ward/admissions');
  revalidatePath('/ward/map');
}

async function record(formData: FormData, docType: string, path: string) {
  const s = await requireSession();
  const patientId = String(formData.get('patientId'));
  const title = String(formData.get('title') || docType);
  const body = String(formData.get('body') || '');
  if (!patientId) return;
  await prisma.clinicalDocument.create({
    data: { patientId, docType, title, format: 'TEXT', body, createdByUserId: s.userId },
  });
  await writeAudit({ actorUserId: s.userId, patientId, action: 'CHART_WRITE', resource: docType });
  revalidatePath(`${path}?patientId=${patientId}`);
}

export async function addProgress(formData: FormData) {
  const temp = formData.get('temp');
  const bp = formData.get('bp');
  const pulse = formData.get('pulse');
  const spo2 = formData.get('spo2');
  formData.set('title', `経過記録 ${new Date().toLocaleString('ja-JP')}`);
  formData.set('body', `体温${temp}℃ / 血圧${bp} / 脈${pulse} / SpO2 ${spo2}% / 記録: ${formData.get('note') || ''}`);
  await record(formData, '経過記録', '/ward/progress');
}

export async function addNursing(formData: FormData) {
  formData.set('title', `看護記録 ${new Date().toLocaleString('ja-JP')}`);
  await record(formData, '看護記録', '/ward/nursing');
}
