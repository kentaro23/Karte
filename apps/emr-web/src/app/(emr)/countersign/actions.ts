'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { requireSession } from '@/lib/session';

/**
 * 研修医記載への指導医カウンターサイン — FR-CHT-06。
 * 承認すると Countersign.status=APPROVED となり、承認者(approvedByUserId)・
 * 承認日時(approvedAt) が記録され、未承認バッジが消える（業務ルール 別紙3 #60-61）。
 *
 * いずれの操作も DB 未接続（フロントのみモード）では prisma が no-op となるため、
 * 念のため try/catch でフェイルソフトにし、フォーム送信が 500 にならないようにする。
 */
export async function approveCountersign(formData: FormData) {
  const s = await requireSession();
  const id = String(formData.get('id') || '');
  const comment = String(formData.get('comment') || '').trim() || null;
  if (!id) return;
  try {
    const c = await prisma.countersign.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedByUserId: s.userId,
        approvedAt: new Date(),
        comment,
      },
    });
    await writeAudit({
      actorUserId: s.userId,
      action: 'COUNTERSIGN',
      resource: 'Countersign.approve',
      resourceId: id,
      detail: { noteId: c.noteId, status: 'APPROVED' },
    });
  } catch (err) {
    console.error('[countersign] approve failed (fail-soft):', err);
  }
  revalidatePath('/countersign');
}

export async function rejectCountersign(formData: FormData) {
  const s = await requireSession();
  const id = String(formData.get('id') || '');
  const comment = String(formData.get('comment') || '').trim() || null;
  if (!id) return;
  try {
    const c = await prisma.countersign.update({
      where: { id },
      data: {
        status: 'REJECTED',
        approvedByUserId: s.userId,
        approvedAt: new Date(),
        comment,
      },
    });
    await writeAudit({
      actorUserId: s.userId,
      action: 'COUNTERSIGN',
      resource: 'Countersign.reject',
      resourceId: id,
      detail: { noteId: c.noteId, status: 'REJECTED' },
    });
  } catch (err) {
    console.error('[countersign] reject failed (fail-soft):', err);
  }
  revalidatePath('/countersign');
}

/**
 * 付箋（患者/個人/院内）の作成。scope=CLINIC_WIDE が院内付箋、PRIVATE が個人付箋。
 * patientId に紐づく付箋は患者付箋として患者カルテに表示される。
 */
export async function createSticky(formData: FormData) {
  const s = await requireSession();
  const title = String(formData.get('title') || '').trim();
  const body = String(formData.get('body') || '').trim();
  const scope = String(formData.get('scope') || 'PRIVATE') === 'CLINIC_WIDE' ? 'CLINIC_WIDE' : 'PRIVATE';
  const patientId = String(formData.get('patientId') || '') || null;
  const color = String(formData.get('color') || '') || '#fff7df';
  if (!title && !body) return;
  try {
    const sticky = await prisma.sticky.create({
      data: {
        patientId: patientId ?? '',
        title: title || '（無題）',
        body,
        color,
        scope,
        createdByUserId: s.userId,
      },
    });
    await writeAudit({
      actorUserId: s.userId,
      patientId,
      action: 'CHART_WRITE',
      resource: 'Sticky.create',
      resourceId: sticky.id,
      detail: { scope, title },
    });
  } catch (err) {
    console.error('[countersign] createSticky failed (fail-soft):', err);
  }
  revalidatePath('/countersign');
}

export async function deleteSticky(formData: FormData) {
  const s = await requireSession();
  const id = String(formData.get('id') || '');
  if (!id) return;
  try {
    await prisma.sticky.delete({ where: { id } });
    await writeAudit({
      actorUserId: s.userId,
      action: 'CHART_WRITE',
      resource: 'Sticky.delete',
      resourceId: id,
    });
  } catch (err) {
    console.error('[countersign] deleteSticky failed (fail-soft):', err);
  }
  revalidatePath('/countersign');
}
