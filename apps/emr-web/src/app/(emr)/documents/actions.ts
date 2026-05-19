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
