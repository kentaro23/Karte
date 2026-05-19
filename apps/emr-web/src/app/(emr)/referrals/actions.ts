'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { requireSession } from '@/lib/session';

export async function createReferral(formData: FormData) {
  const s = await requireSession();
  const r = await prisma.referral.create({
    data: {
      patientId: String(formData.get('patientId') || '') || null,
      direction: 'OUTBOUND',
      partnerFacility: String(formData.get('partnerFacility') || '').trim(),
      partnerDoctor: String(formData.get('partnerDoctor') || '') || null,
      purpose: String(formData.get('purpose') || '').trim(),
      chiefComplaint: String(formData.get('chiefComplaint') || '') || null,
      diseaseState: String(formData.get('diseaseState') || '') || null,
      createdByUserId: s.userId,
    },
  });
  await writeAudit({ actorUserId: s.userId, action: 'CHART_WRITE', resource: 'Referral', resourceId: r.id });
  revalidatePath('/referrals');
}

const NEXT: Record<string, string> = {
  DRAFT: 'PRINTED',
  PRINTED: 'SENT',
  SENT: 'AWAITING_REPLY',
  AWAITING_REPLY: 'REPLY_RECEIVED',
  REPLY_RECEIVED: 'CLOSED',
};

export async function advanceReferral(formData: FormData) {
  const s = await requireSession();
  const id = String(formData.get('id'));
  const cur = await prisma.referral.findUniqueOrThrow({ where: { id } });
  const next = NEXT[cur.status];
  if (!next) return;
  await prisma.referral.update({ where: { id }, data: { status: next as never } });
  await writeAudit({
    actorUserId: s.userId,
    action: 'CHART_WRITE',
    resource: 'Referral.status',
    resourceId: id,
    detail: { from: cur.status, to: next },
  });
  revalidatePath('/referrals');
}
