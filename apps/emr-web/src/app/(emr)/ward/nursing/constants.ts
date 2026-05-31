/**
 * WP-WRD2 / FR-WRD-02 — かつての看護計画・褥瘡DESIGN-R 共有定数。
 *
 * 看護計画・褥瘡DESIGN-R は ClinicalDocument.docType 代替から専用モデル
 * （NursingPlan + NursingPlanItem / PressureUlcer）へ本永続化されたため、
 * docType 文字列定数（NURSING_PLAN_DOCTYPE / PRESSURE_ULCER_DOCTYPE）は不要化。
 * 参照は全て撤去済み。後方互換のためファイルは残置（空モジュール）。
 */
export {};
