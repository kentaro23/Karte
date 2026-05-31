/**
 * 看護計画・褥瘡DESIGN-R の共有定数 — WP-WRD2 / FR-WRD-02。
 *
 * `actions.ts` は 'use server' 指定のため async 関数以外を export できない。
 * UI（page.tsx）と Server Action（actions.ts）の双方が参照する docType 定数は本モジュールに置く。
 * ClinicalDocument.docType の値として保存・絞り込みの両方で同一値を使う。
 */

/** 看護計画（看護診断/目標/介入/評価）の ClinicalDocument.docType。 */
export const NURSING_PLAN_DOCTYPE = '看護計画';

/** 褥瘡 DESIGN-R®2020 評価の ClinicalDocument.docType。 */
export const PRESSURE_ULCER_DOCTYPE = '褥瘡DESIGN-R';
