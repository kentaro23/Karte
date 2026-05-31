/**
 * 紹介状 状態機械 — 別紙1 §紹介状 / 174項 117,166-168.
 * Framework-free. Mirrors the Prisma enum ReferralStatus.
 * 下書き→印刷→送付→返信待ち→返信受領→クローズ の片方向ライフサイクル。
 */
export type ReferralStatus =
  | 'DRAFT'
  | 'PRINTED'
  | 'SENT'
  | 'AWAITING_REPLY'
  | 'REPLY_RECEIVED'
  | 'CLOSED';

export const REFERRAL_STATUS_LABEL: Record<ReferralStatus, string> = {
  DRAFT: '下書き',
  PRINTED: '印刷済',
  SENT: '送付済',
  AWAITING_REPLY: '返信待ち',
  REPLY_RECEIVED: '返信受領',
  CLOSED: 'クローズ',
};

const REFERRAL_TRANSITIONS: Record<ReferralStatus, ReferralStatus[]> = {
  DRAFT: ['PRINTED', 'SENT', 'CLOSED'],
  PRINTED: ['SENT', 'CLOSED'],
  SENT: ['AWAITING_REPLY', 'REPLY_RECEIVED', 'CLOSED'],
  AWAITING_REPLY: ['REPLY_RECEIVED', 'CLOSED'],
  REPLY_RECEIVED: ['CLOSED'],
  CLOSED: [],
};

export function canTransitionReferral(from: ReferralStatus, to: ReferralStatus): boolean {
  return REFERRAL_TRANSITIONS[from].includes(to);
}

export function assertReferralTransition(from: ReferralStatus, to: ReferralStatus): void {
  if (!canTransitionReferral(from, to)) {
    throw new Error(`不正な紹介状ステータス遷移: ${from} → ${to}`);
  }
}
