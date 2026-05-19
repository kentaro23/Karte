'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { requireSession } from '@/lib/session';

export async function createDocument(formData: FormData) {
  const s = await requireSession();
  const d = await prisma.clinicalDocument.create({
    data: {
      patientId: String(formData.get('patientId') || '') || null,
      docType: String(formData.get('docType') || '院内文書'),
      title: String(formData.get('title') || '').trim(),
      format: 'TEXT',
      body: String(formData.get('body') || ''),
      createdByUserId: s.userId,
    },
  });
  await writeAudit({ actorUserId: s.userId, action: 'CHART_WRITE', resource: 'ClinicalDocument', resourceId: d.id });
  revalidatePath('/documents');
}

/* ── 退院サマリ（DischargeSummary） ── */

export async function createDischargeSummary(formData: FormData) {
  const s = await requireSession();
  const patientId = String(formData.get('patientId') || '');
  if (!patientId) return;
  const d = await prisma.dischargeSummary.create({
    data: {
      patientId,
      status: 'DRAFT',
      authorUserId: s.userId,
      admissionCourse: String(formData.get('admissionCourse') || ''),
      presentIllness: String(formData.get('presentIllness') || ''),
      hospitalCourse: String(formData.get('hospitalCourse') || ''),
      dischargePlan: String(formData.get('dischargePlan') || ''),
    },
  });
  await writeAudit({
    actorUserId: s.userId,
    patientId,
    action: 'CHART_WRITE',
    resource: 'DischargeSummary',
    resourceId: d.id,
  });
  revalidatePath('/documents');
}

export async function completeDischargeSummary(formData: FormData) {
  const s = await requireSession();
  const id = String(formData.get('id'));
  const d = await prisma.dischargeSummary.update({
    where: { id },
    data: { status: 'COMPLETED' },
  });
  await writeAudit({
    actorUserId: s.userId,
    patientId: d.patientId,
    action: 'CHART_WRITE',
    resource: 'DischargeSummary.complete',
    resourceId: id,
  });
  revalidatePath('/documents');
}

export async function approveDischargeSummary(formData: FormData) {
  const s = await requireSession();
  const id = String(formData.get('id'));
  const d = await prisma.dischargeSummary.update({
    where: { id },
    data: { approvalStatus: 'APPROVED', approverUserId: s.userId, approvedAt: new Date() },
  });
  await writeAudit({
    actorUserId: s.userId,
    patientId: d.patientId,
    action: 'COUNTERSIGN',
    resource: 'DischargeSummary.approve',
    resourceId: id,
  });
  revalidatePath('/documents');
}
