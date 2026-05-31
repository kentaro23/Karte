'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@medixus/db';
import {
  type ReferralStatus,
  assertReferralTransition,
  canTransitionReferral,
} from '@medixus/domain';
import { writeAudit } from '@medixus/audit';
import { requireSession } from '@/lib/session';

const REFERRAL_ORDER: ReferralStatus[] = [
  'DRAFT',
  'PRINTED',
  'SENT',
  'AWAITING_REPLY',
  'REPLY_RECEIVED',
  'CLOSED',
];

/** 監査記録は本番化の核だが、フロントのみ（DB未接続）でも画面操作を完結させるため握りつぶす。 */
async function auditSafe(args: Parameters<typeof writeAudit>[0]): Promise<void> {
  try {
    await writeAudit(args);
  } catch (err) {
    console.error('[referrals] writeAudit failed (non-fatal):', err);
  }
}

export async function createReferral(formData: FormData): Promise<void> {
  const s = await requireSession();
  try {
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
    await auditSafe({
      actorUserId: s.userId,
      action: 'CHART_WRITE',
      resource: 'Referral',
      resourceId: r.id,
    });
  } catch (err) {
    console.error('[referrals] createReferral failed:', err);
  }
  revalidatePath('/referrals');
}

/** 次状態への片方向 1 ステップ遷移（一覧の「次の状態へ →」から）。 */
export async function advanceReferral(formData: FormData): Promise<void> {
  const s = await requireSession();
  const id = String(formData.get('id') || '');
  if (!id) return;
  try {
    const cur = await prisma.referral.findUniqueOrThrow({ where: { id } });
    const idx = REFERRAL_ORDER.indexOf(cur.status as ReferralStatus);
    const next = idx >= 0 ? REFERRAL_ORDER[idx + 1] : undefined;
    if (!next) return;
    assertReferralTransition(cur.status as ReferralStatus, next);
    await prisma.referral.update({ where: { id }, data: { status: next as never } });
    await auditSafe({
      actorUserId: s.userId,
      action: 'CHART_WRITE',
      resource: 'Referral.status',
      resourceId: id,
      detail: { from: cur.status, to: next },
    });
  } catch (err) {
    console.error('[referrals] advanceReferral failed:', err);
  }
  revalidatePath('/referrals');
}

/**
 * 任意の許可済み状態へ遷移（DRAFT→SENT 直送・各段階→CLOSED 等、状態機械が許す近道も可）。
 * 状態機械（assertReferralTransition）に反する遷移は黙って無視する。
 */
export async function setReferralStatus(formData: FormData): Promise<void> {
  const s = await requireSession();
  const id = String(formData.get('id') || '');
  const to = String(formData.get('to') || '') as ReferralStatus;
  if (!id || !to) return;
  try {
    const cur = await prisma.referral.findUniqueOrThrow({ where: { id } });
    const from = cur.status as ReferralStatus;
    if (from === to || !canTransitionReferral(from, to)) return;
    await prisma.referral.update({ where: { id }, data: { status: to as never } });
    await auditSafe({
      actorUserId: s.userId,
      action: 'CHART_WRITE',
      resource: 'Referral.status',
      resourceId: id,
      detail: { from, to },
    });
  } catch (err) {
    console.error('[referrals] setReferralStatus failed:', err);
  }
  revalidatePath('/referrals');
}

/**
 * 返書登録（174項 21）。返書本文を保存し、状態を REPLY_RECEIVED へ進める。
 * 送付前（DRAFT/PRINTED）でも臨時に返書受領できるよう、現状態が AWAITING_REPLY へ
 * 遷移可能ならいったん経由してから REPLY_RECEIVED に上げる。
 */
export async function registerReply(formData: FormData): Promise<void> {
  const s = await requireSession();
  const id = String(formData.get('id') || '');
  const replyText = String(formData.get('replyText') || '').trim();
  if (!id) return;
  try {
    const cur = await prisma.referral.findUniqueOrThrow({ where: { id } });
    const from = cur.status as ReferralStatus;
    // 既に REPLY_RECEIVED/CLOSED でも返書本文の追記は許可（状態は据え置き）。
    const target: ReferralStatus =
      from === 'REPLY_RECEIVED' || from === 'CLOSED'
        ? from
        : canTransitionReferral(from, 'REPLY_RECEIVED')
          ? 'REPLY_RECEIVED'
          : from;
    await prisma.referral.update({
      where: { id },
      data: { replyText: replyText || null, status: target as never },
    });
    await auditSafe({
      actorUserId: s.userId,
      action: 'CHART_WRITE',
      resource: 'Referral.reply',
      resourceId: id,
      detail: { from, to: target, hasReply: Boolean(replyText) },
    });
  } catch (err) {
    console.error('[referrals] registerReply failed:', err);
  }
  revalidatePath('/referrals');
}
