/**
 * 安全データ薬剤師レビューの共有定数／型 — FR-RXSAFE-06 / ギャップ G13b。
 *
 * `actions.ts` は 'use server' 指定のため async 関数以外（値）を export できない。
 * UI（page.tsx）と Server Action（actions.ts）の双方が参照する対象テーブル定義は本モジュールに置く。
 */

/** 薬剤師レビュー昇格の対象テーブル（安全データ4種）。 */
export const SAFETY_ENTITY_TABLES = [
  'DrugIndication',
  'DrugDosage',
  'DrugContraindication',
  'DrugInteraction',
] as const;

export type SafetyEntityTable = (typeof SAFETY_ENTITY_TABLES)[number];
