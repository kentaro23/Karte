'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { requireSession } from '@/lib/session';

/** 監査記録は本番化の核だが、フロントのみ（DB未接続）でも操作を完結させるため握りつぶす。 */
async function auditSafe(args: Parameters<typeof writeAudit>[0]): Promise<void> {
  try {
    await writeAudit(args);
  } catch (err) {
    console.error('[discharge-summary] writeAudit failed (non-fatal):', err);
  }
}

export async function createDischargeSummary(formData: FormData): Promise<void> {
  const s = await requireSession();
  const patientId = String(formData.get('patientId') || '').trim();
  if (!patientId) return;
  try {
    const d = await prisma.dischargeSummary.create({
      data: {
        patientId,
        admissionRef: String(formData.get('admissionRef') || '') || null,
        authorUserId: s.userId,
        admissionCourse: String(formData.get('admissionCourse') || '') || null,
        presentIllness: String(formData.get('presentIllness') || '') || null,
        hospitalCourse: String(formData.get('hospitalCourse') || '') || null,
        dischargePlan: String(formData.get('dischargePlan') || '') || null,
      },
    });
    await auditSafe({
      actorUserId: s.userId,
      action: 'CHART_WRITE',
      resource: 'DischargeSummary',
      resourceId: d.id,
    });
  } catch (err) {
    console.error('[discharge-summary] createDischargeSummary failed:', err);
  }
  revalidatePath('/discharge-summary');
}

/** 起草（DRAFT）→ 記載完了（COMPLETED）。承認はこの後、指導医/上級医が行う。 */
export async function completeDischargeSummary(formData: FormData): Promise<void> {
  const s = await requireSession();
  const id = String(formData.get('id') || '');
  if (!id) return;
  try {
    const cur = await prisma.dischargeSummary.findUniqueOrThrow({ where: { id } });
    if (cur.status === 'COMPLETED') return;
    await prisma.dischargeSummary.update({
      where: { id },
      data: { status: 'COMPLETED' as never },
    });
    await auditSafe({
      actorUserId: s.userId,
      action: 'CHART_WRITE',
      resource: 'DischargeSummary.status',
      resourceId: id,
      detail: { from: cur.status, to: 'COMPLETED' },
    });
  } catch (err) {
    console.error('[discharge-summary] completeDischargeSummary failed:', err);
  }
  revalidatePath('/discharge-summary');
}

/** 承認フロー：UNAPPROVED → APPROVED（承認者・承認日時を記録）。 */
export async function approveDischargeSummary(formData: FormData): Promise<void> {
  const s = await requireSession();
  const id = String(formData.get('id') || '');
  if (!id) return;
  try {
    const cur = await prisma.dischargeSummary.findUniqueOrThrow({ where: { id } });
    if (cur.approvalStatus === 'APPROVED') return;
    await prisma.dischargeSummary.update({
      where: { id },
      data: {
        approvalStatus: 'APPROVED',
        approverUserId: s.userId,
        approvedAt: new Date(),
        // 承認時にまだ起草中なら記載完了扱いに引き上げる。
        status: 'COMPLETED' as never,
      },
    });
    await auditSafe({
      actorUserId: s.userId,
      action: 'CHART_WRITE',
      resource: 'DischargeSummary.approval',
      resourceId: id,
      detail: { from: cur.approvalStatus, to: 'APPROVED', approver: s.userId },
    });
  } catch (err) {
    console.error('[discharge-summary] approveDischargeSummary failed:', err);
  }
  revalidatePath('/discharge-summary');
}

/** 承認の差し戻し（APPROVED → UNAPPROVED）。承認者・承認日時をクリア。 */
export async function unapproveDischargeSummary(formData: FormData): Promise<void> {
  const s = await requireSession();
  const id = String(formData.get('id') || '');
  if (!id) return;
  try {
    const cur = await prisma.dischargeSummary.findUniqueOrThrow({ where: { id } });
    if (cur.approvalStatus !== 'APPROVED') return;
    await prisma.dischargeSummary.update({
      where: { id },
      data: { approvalStatus: 'UNAPPROVED', approverUserId: null, approvedAt: null },
    });
    await auditSafe({
      actorUserId: s.userId,
      action: 'CHART_WRITE',
      resource: 'DischargeSummary.approval',
      resourceId: id,
      detail: { from: 'APPROVED', to: 'UNAPPROVED' },
    });
  } catch (err) {
    console.error('[discharge-summary] unapproveDischargeSummary failed:', err);
  }
  revalidatePath('/discharge-summary');
}
