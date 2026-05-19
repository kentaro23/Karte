'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { requireSession } from '@/lib/session';

export async function admitPatient(formData: FormData) {
  const s = await requireSession();
  const patientId = String(formData.get('patientId'));
  const wardId = String(formData.get('wardId'));
  const p = await prisma.patient.findUnique({ where: { id: patientId } });
  if (!p) return;
  const dept = await prisma.department.findFirst({ where: { clinicId: p.clinicId } });
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
  await writeAudit({ actorUserId: s.userId, patientId, action: 'CHART_WRITE', resource: 'Admission', resourceId: e.id });
  revalidatePath('/ward/admissions');
  revalidatePath('/ward/map');
}

export async function dischargePatient(formData: FormData) {
  const s = await requireSession();
  const id = String(formData.get('id'));
  const e = await prisma.encounter.update({
    where: { id },
    data: { receptionStatus: 'BILLING_DONE' },
  });
  await writeAudit({ actorUserId: s.userId, patientId: e.patientId, action: 'CHART_WRITE', resource: 'Discharge', resourceId: id });
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
