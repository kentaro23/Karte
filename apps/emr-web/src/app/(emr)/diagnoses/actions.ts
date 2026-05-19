'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { requireSession } from '@/lib/session';

export async function addDiagnosis(formData: FormData) {
  const s = await requireSession();
  const patientId = String(formData.get('patientId'));
  const masterCode = String(formData.get('masterCode') || '') || null;
  const displayName = String(formData.get('displayName') || '').trim();
  const icd10 = String(formData.get('icd10') || '') || null;
  if (!patientId || !displayName) return;
  await prisma.patientDiagnosis.create({
    data: {
      patientId,
      masterCode,
      displayName,
      icd10,
      isMain: formData.get('isMain') === 'on',
      isSuspected: formData.get('isSuspected') === 'on',
      acuteChronic: String(formData.get('acuteChronic') || '') || null,
      recordedByUserId: s.userId,
    },
  });
  await writeAudit({
    actorUserId: s.userId,
    patientId,
    action: 'CHART_WRITE',
    resource: 'PatientDiagnosis',
    detail: { displayName, icd10 },
  });
  revalidatePath(`/diagnoses?patientId=${patientId}`);
}

export async function setOutcome(formData: FormData) {
  const s = await requireSession();
  const id = String(formData.get('id'));
  const outcome = String(formData.get('outcome')) as
    | 'CURED'
    | 'IMPROVED'
    | 'UNCHANGED'
    | 'TRANSFERRED'
    | 'DECEASED'
    | 'STOPPED';
  const d = await prisma.patientDiagnosis.update({
    where: { id },
    data: {
      outcome,
      outcomeDate: new Date(),
      status: outcome === 'CURED' || outcome === 'TRANSFERRED' ? 'RESOLVED' : 'ACTIVE',
    },
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
}
