/**
 * オーダ detail JSON の型付け — FR-ORDER-* / 別紙1 §5,§6 / 174項 23-101.
 * Order テーブルは単一テーブル＋detail JSON（order.ts 参照）。
 * OrderType ごとの detail スキーマをローカルに最小定義し、ナローイング用の
 * 判別共用体＋ヘルパを提供する。prisma 型に依存しない純ロジック/型。
 */
import type { OrderType } from './order.js';

/** 処方 detail（RP 単位の行リスト）— RX. */
export interface RxDetail {
  kind: 'RX';
  rp: RxLine[];
  /** 院内処方 / 院外処方。 */
  dispenseType?: 'IN_HOUSE' | 'OUTSIDE';
}
export interface RxLine {
  drugCode?: string;
  drugName: string;
  dose?: number;
  doseUnit?: string;
  usageCode?: string;
  usageText?: string;
  days?: number;
  amountPerDay?: number;
}

/** 注射 detail — INJECTION. */
export interface InjectionDetail {
  kind: 'INJECTION';
  route?: string; // IV | IM | SC | DIV ...
  items: InjectionItem[];
}
export interface InjectionItem {
  drugCode?: string;
  drugName: string;
  dose?: number;
  doseUnit?: string;
}

/** 検査 detail（検体/生理/細菌/病理 等の検査系）— LAB ほか. */
export interface ExamDetail {
  kind: 'EXAM';
  items: ExamItem[];
  specimen?: string;
}
export interface ExamItem {
  examMasterId?: string;
  examName: string;
  points?: number;
}

/** 処置 detail — TREATMENT/PROCEDURE 系. */
export interface ProcedureDetail {
  kind: 'PROCEDURE';
  procedureCode?: string;
  procedureName: string;
  points?: number;
  site?: string;
}

/** 画像（放射線/内視鏡）detail — IMAGE 系. */
export interface ImageDetail {
  kind: 'IMAGE';
  modality?: string; // CR | CT | MRI | US | ES ...
  bodyPart?: string;
  contrast?: boolean;
  points?: number;
}

/** OrderType → detail kind のマッピング（単一テーブルの detail 判別）。 */
export type OrderDetailKind = OrderDetail['kind'];

/** 全 detail の判別共用体。`kind` で型を絞り込む。 */
export type OrderDetail =
  | RxDetail
  | InjectionDetail
  | ExamDetail
  | ProcedureDetail
  | ImageDetail;

export function isRxDetail(d: OrderDetail): d is RxDetail {
  return d.kind === 'RX';
}
export function isInjectionDetail(d: OrderDetail): d is InjectionDetail {
  return d.kind === 'INJECTION';
}
export function isExamDetail(d: OrderDetail): d is ExamDetail {
  return d.kind === 'EXAM';
}
export function isProcedureDetail(d: OrderDetail): d is ProcedureDetail {
  return d.kind === 'PROCEDURE';
}
export function isImageDetail(d: OrderDetail): d is ImageDetail {
  return d.kind === 'IMAGE';
}

/**
 * OrderType を detail kind へ写像する（保存・読込時のスキーマ判定）。
 * 未割当の OrderType は null（detail 構造を持たない／別管理）。
 */
export function detailKindForOrderType(orderType: OrderType): OrderDetailKind | null {
  switch (orderType) {
    case 'RX':
      return 'RX';
    case 'INJECTION':
    case 'TRANSFUSION':
    case 'CHEMO':
      return 'INJECTION';
    case 'LAB':
    case 'BACTERIOLOGY':
    case 'PATHOLOGY':
    case 'PHYSIOLOGY':
      return 'EXAM';
    case 'TREATMENT':
    case 'SURGERY':
    case 'REHAB':
    case 'DIALYSIS':
      return 'PROCEDURE';
    case 'RADIOLOGY':
    case 'ENDOSCOPY':
      return 'IMAGE';
    default:
      return null;
  }
}

/**
 * 未知の JSON が期待した kind の detail か検証して絞り込むナローイングヘルパ。
 * kind 不一致時は Error。サーバアクションで detail を読む際の入口検証に使う。
 */
export function assertOrderDetail<K extends OrderDetailKind>(
  detail: unknown,
  kind: K,
): Extract<OrderDetail, { kind: K }> {
  if (
    typeof detail === 'object' &&
    detail !== null &&
    (detail as { kind?: unknown }).kind === kind
  ) {
    return detail as Extract<OrderDetail, { kind: K }>;
  }
  throw new Error(`オーダ detail の種別が不正です（期待: ${kind}）`);
}
