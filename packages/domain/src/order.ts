/**
 * オーダ共通基盤 — 状態機械 + Doオーダ(前回踏襲) + 指示歴版管理.
 * 別紙1 §5, §6 / 174項 23-101,126-133.
 */
export type OrderStatus =
  | 'DRAFT'
  | 'REQUESTED'
  | 'RECEIVED'
  | 'IN_PROGRESS'
  | 'PARTIALLY_DONE'
  | 'DONE'
  | 'RESULT_ARRIVED'
  | 'APPROVED'
  | 'CANCELLED'
  | 'VOIDED';

export type OrderType =
  | 'RX'
  | 'INJECTION'
  | 'TREATMENT'
  | 'LAB'
  | 'BACTERIOLOGY'
  | 'PATHOLOGY'
  | 'PHYSIOLOGY'
  | 'RADIOLOGY'
  | 'ENDOSCOPY'
  | 'DIALYSIS'
  | 'REHAB'
  | 'GUIDANCE'
  | 'CHEMO'
  | 'SURGERY'
  | 'TRANSFUSION'
  | 'MEAL'
  | 'REFERRAL';

export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  RX: '処方',
  INJECTION: '注射',
  TREATMENT: '処置',
  LAB: '検体検査',
  BACTERIOLOGY: '細菌検査',
  PATHOLOGY: '病理検査',
  PHYSIOLOGY: '生理検査',
  RADIOLOGY: '放射線検査',
  ENDOSCOPY: '内視鏡検査',
  DIALYSIS: '透析',
  REHAB: 'リハビリ',
  GUIDANCE: '指導',
  CHEMO: '化学療法',
  SURGERY: '手術',
  TRANSFUSION: '輸血',
  MEAL: '食事',
  REFERRAL: '紹介',
};

const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT: ['REQUESTED', 'VOIDED'],
  REQUESTED: ['RECEIVED', 'CANCELLED'],
  RECEIVED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['PARTIALLY_DONE', 'DONE', 'CANCELLED'],
  PARTIALLY_DONE: ['DONE'],
  DONE: ['RESULT_ARRIVED', 'APPROVED'],
  RESULT_ARRIVED: ['APPROVED'],
  APPROVED: [],
  CANCELLED: [],
  VOIDED: [],
};

export function canTransitionOrder(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}
export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransitionOrder(from, to)) throw new Error(`不正なオーダ状態遷移: ${from} → ${to}`);
}

/** Doオーダ: clone a prior order's clinical payload, reset lifecycle/version. */
export function buildDoOrder(source: {
  id: string;
  orderType: OrderType;
  departmentId: string;
  detail: unknown;
}): {
  orderType: OrderType;
  departmentId: string;
  detail: unknown;
  doSourceOrderId: string;
  status: 'DRAFT';
  version: 1;
  isLatest: true;
} {
  return {
    orderType: source.orderType,
    departmentId: source.departmentId,
    detail: structuredClone(source.detail),
    doSourceOrderId: source.id,
    status: 'DRAFT',
    version: 1,
    isLatest: true,
  };
}

export function planOrderAmendment(current: { id: string; version: number }): {
  supersede: { id: string; isLatest: false; status: 'VOIDED' };
  next: { version: number; previousVersionId: string; isLatest: true; status: 'DRAFT' };
} {
  return {
    supersede: { id: current.id, isLatest: false, status: 'VOIDED' },
    next: {
      version: current.version + 1,
      previousVersionId: current.id,
      isLatest: true,
      status: 'DRAFT',
    },
  };
}
