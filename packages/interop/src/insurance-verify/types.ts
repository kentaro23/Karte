/**
 * IF-EXT-02 オンライン資格確認/マイナ保険証 (G22 / 174:8) — 型定義。
 *
 * 資格確認要求/結果、薬剤情報・特定健診等情報・6情報一覧の閲覧要求/結果。
 * 受付時に保険資格をリアルタイム確認。院内ゲートウェイ/資格確認端末が前提の部分が
 * あり、本番化時に明示する (要件定義書 IF-EXT-02)。
 */
import type { Jlac10Code, JFagyCode, PatientRef, YjCode } from '../types.js';

/** 資格確認要求。マイナ保険証(個人番号カード)読取 or 記号番号で照会。 */
export interface InsuranceVerifyRequest {
  patientRef?: PatientRef;
  /** マイナ保険証読取トークン (資格確認端末が発行)。 */
  mynaCardToken?: string;
  insurerNo?: string;
  symbol?: string;
  number?: string;
  confirmationDate?: string; // ISO 8601
}

/** 資格確認結果 (リアルタイム取得)。 */
export interface InsuranceVerifyResult {
  eligible: boolean;
  insurerNo?: string;
  insuredName?: string;
  symbol?: string;
  number?: string;
  branchNo?: string;
  validFrom?: string;
  validTo?: string;
  /** 公費・限度額適用認定など付随情報。 */
  copaymentCategory?: string;
}

/** オン資経由 薬剤情報の1件。 */
export interface OnshiMedicationInfo {
  yjCode?: YjCode;
  name: string;
  dispensedDate?: string;
  facilityName?: string;
}

/** オン資経由 特定健診情報の1件 (JLAC10/11)。 */
export interface OnshiCheckupInfo {
  jlac10?: Jlac10Code;
  itemName: string;
  value?: string;
  unit?: string;
  examDate?: string;
}

/** 6情報のうちアレルギー(薬剤/その他)1件 (J-FAGY)。救急時参照にも使用。 */
export interface OnshiAllergyInfo {
  jFagy?: JFagyCode;
  category: 'DRUG' | 'OTHER';
  substance: string;
  reaction?: string;
}

/** 薬剤情報・特定健診・6情報一覧の閲覧結果。 */
export interface OnshiPatientInfoResult {
  medications: OnshiMedicationInfo[];
  checkups: OnshiCheckupInfo[];
  allergies: OnshiAllergyInfo[];
}
