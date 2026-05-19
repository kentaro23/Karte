/**
 * 診察ステータス 状態機械 — 別紙1 §2.1(17), §2.7(6).
 * Framework-free. Source of truth for valid transitions; mirrors the DB enum.
 */
export type ReceptionStatus =
  | 'UNRECEIVED'
  | 'ARRIVED'
  | 'QUESTIONNAIRE_IN_PROGRESS'
  | 'QUESTIONNAIRE_DONE'
  | 'READY'
  | 'IN_CONSULTATION'
  | 'SUSPENDED'
  | 'CONSULTATION_DONE'
  | 'BILLING_DONE'
  | 'CANCELLED'
  | 'NO_SHOW';

export const RECEPTION_STATUS_LABEL: Record<ReceptionStatus, string> = {
  UNRECEIVED: '未受付',
  ARRIVED: '来院済',
  QUESTIONNAIRE_IN_PROGRESS: '問診中',
  QUESTIONNAIRE_DONE: '問診済',
  READY: '到着済',
  IN_CONSULTATION: '診察中',
  SUSPENDED: '診察一時中断',
  CONSULTATION_DONE: '診察終了',
  BILLING_DONE: '会計済',
  CANCELLED: 'キャンセル',
  NO_SHOW: '来院なし',
};

const TRANSITIONS: Record<ReceptionStatus, ReceptionStatus[]> = {
  UNRECEIVED: ['ARRIVED', 'CANCELLED', 'NO_SHOW'],
  ARRIVED: ['QUESTIONNAIRE_IN_PROGRESS', 'READY', 'CANCELLED'],
  QUESTIONNAIRE_IN_PROGRESS: ['QUESTIONNAIRE_DONE', 'READY'],
  QUESTIONNAIRE_DONE: ['READY'],
  READY: ['IN_CONSULTATION'],
  IN_CONSULTATION: ['SUSPENDED', 'CONSULTATION_DONE'],
  SUSPENDED: ['IN_CONSULTATION', 'CONSULTATION_DONE'],
  CONSULTATION_DONE: ['BILLING_DONE'],
  BILLING_DONE: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function canTransitionReception(from: ReceptionStatus, to: ReceptionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertReceptionTransition(from: ReceptionStatus, to: ReceptionStatus): void {
  if (!canTransitionReception(from, to)) {
    throw new Error(`不正な診察ステータス遷移: ${from} → ${to}`);
  }
}

/** 経過時間色分け — 別紙1 §2.1(8). Returns a severity bucket by minutes waited. */
export type WaitSeverity = 'normal' | 'attention' | 'overdue';
export function waitSeverity(minutes: number, thresholds = { attention: 30, overdue: 60 }): WaitSeverity {
  if (minutes >= thresholds.overdue) return 'overdue';
  if (minutes >= thresholds.attention) return 'attention';
  return 'normal';
}
