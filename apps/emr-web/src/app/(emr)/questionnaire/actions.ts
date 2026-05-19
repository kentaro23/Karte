'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { requireSession } from '@/lib/session';

/** 問診保存 — 患者基本情報（既往歴・アレルギー・身長体重・生活）を正規化保存。 */
export async function saveIntake(formData: FormData) {
  const s = await requireSession();
  const patientId = String(formData.get('patientId'));
  if (!patientId) return;
  const chiefComplaint = String(formData.get('chiefComplaint') || '').trim();
  const pastIllness = String(formData.get('pastIllness') || '');
  const drugAllergy = String(formData.get('drugAllergy') || '');
  const foodAllergy = String(formData.get('foodAllergy') || '');
  const heightCm = Number(formData.get('heightCm') || 0) || null;
  const weightKg = Number(formData.get('weightKg') || 0) || null;
  const smoking = String(formData.get('smoking') || '');
  const drinking = String(formData.get('drinking') || '');

  for (const line of pastIllness.split(/\n|、|,/).map((x) => x.trim()).filter(Boolean)) {
    await prisma.medicalHistory.create({
      data: { patientId, kind: 'PAST_ILLNESS', name: line },
    });
  }
  for (const a of drugAllergy.split(/、|,/).map((x) => x.trim()).filter(Boolean)) {
    await prisma.allergy.create({ data: { patientId, type: 'DRUG', substance: a } });
  }
  for (const a of foodAllergy.split(/、|,/).map((x) => x.trim()).filter(Boolean)) {
    await prisma.allergy.create({ data: { patientId, type: 'FOOD', substance: a } });
  }
  await prisma.patientProfile.upsert({
    where: { patientId },
    create: { patientId, heightCm, weightKg, smoking: smoking ? { note: smoking } : undefined, drinking: drinking ? { note: drinking } : undefined },
    update: { heightCm, weightKg, smoking: smoking ? { note: smoking } : undefined, drinking: drinking ? { note: drinking } : undefined },
  });
  if (chiefComplaint) {
    await prisma.clinicalDocument.create({
      data: {
        patientId,
        docType: '問診票',
        title: `問診票（主訴: ${chiefComplaint.slice(0, 20)}）`,
        format: 'TEXT',
        body: `主訴: ${chiefComplaint}\n既往歴: ${pastIllness}\n喫煙: ${smoking}\n飲酒: ${drinking}`,
        createdByUserId: s.userId,
      },
    });
  }
  await writeAudit({
    actorUserId: s.userId,
    patientId,
    action: 'CHART_WRITE',
    resource: 'Questionnaire',
    detail: { chiefComplaint },
  });
  revalidatePath(`/questionnaire?patientId=${patientId}`);
}
