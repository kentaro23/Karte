/**
 * IF-EXT-02 オンライン資格確認/マイナ保険証 (G22 / 174:8) — 型定義。
 *
 * 資格確認要求/結果、薬剤情報・特定健診等情報・6情報一覧の閲覧要求/結果。
 * 受付時に保険資格をリアルタイム確認する (要件定義書 IF-EXT-02)。
 *
 * 院内ゲートウェイ前提:
 *   本連携は「オンライン資格確認等システム」(支払基金/国保中央会) と、医療機関内に
 *   設置する『院内ゲートウェイ端末』『資格確認端末(顔認証付きカードリーダ等)』を経由
 *   する。マイナ保険証(個人番号カード)の券面/電子証明書の読取と本人同意取得は資格確認
 *   端末側で完結し、Medixus にはトークン化された読取結果のみが渡る前提。閉域網(医療機関
 *   等向け中間サーバ/オンライン資格確認用回線)を介すため、本パッケージのスタブが本番
 *   アダプタに置き換わる際は『院内ゲートウェイのエンドポイント/証明書/同意区分』を実装
 *   時に注入する (要件定義書 6.2 / IF-EXT-02 業務ルール: 院内ゲートウェイ/資格確認端末が
 *   前提の部分は明示)。
 */
import type {
  Icd10Code,
  Jlac10Code,
  JFagyCode,
  PatientRef,
  StandardDiseaseCode,
  YjCode,
} from '../types.js';

/**
 * オン資の閲覧サービス区分。
 * マイナ保険証の本人同意は閲覧サービスごとに取得される (資格確認端末側で取得)。
 */
export type OnshiInfoService =
  | 'MEDICATION' // 薬剤情報
  | 'CHECKUP' // 特定健診等情報
  | 'DIAGNOSIS' // 6情報: 傷病名
  | 'INFECTION' // 6情報: 感染症
  | 'ALLERGY' // 6情報: 薬剤アレルギー等/その他アレルギー等
  | 'LAB' // 6情報: 検査
  | 'PRESCRIPTION'; // 6情報: 処方

/** 資格確認要求。マイナ保険証(個人番号カード)読取 or 記号番号で照会。 */
export interface InsuranceVerifyRequest {
  patientRef?: PatientRef;
  /**
   * マイナ保険証読取トークン (資格確認端末が発行)。
   * 院内ゲートウェイ経由で取得済みのトークンを渡す前提 (券面読取・本人同意は端末側で完結)。
   */
  mynaCardToken?: string;
  insurerNo?: string;
  symbol?: string;
  number?: string;
  confirmationDate?: string; // ISO 8601
}

/** 一部負担金の負担割合区分 (高齢受給者証/限度額適用認定の付随情報)。 */
export type CopaymentRatio = 1 | 2 | 3;

/** 資格確認結果 (リアルタイム取得)。AC(1) 「保険証確認」で資格がリアルタイム取得される。 */
export interface InsuranceVerifyResult {
  eligible: boolean;
  insurerNo?: string;
  insuredName?: string;
  /** 被保険者氏名カナ (資格確認結果の照合用)。 */
  insuredNameKana?: string;
  symbol?: string;
  number?: string;
  branchNo?: string;
  validFrom?: string;
  validTo?: string;
  /** 一部負担金の負担割合 (1/2/3割)。 */
  copaymentRatio?: CopaymentRatio;
  /** 公費・限度額適用認定など付随情報。 */
  copaymentCategory?: string;
  /** 限度額適用認定証の所得区分 (取得できた場合)。 */
  incomeCategory?: string;
  /** 資格無効/期限切れ等のときの理由 (eligible=false の補足)。 */
  ineligibleReason?: string;
}

/** オン資経由 薬剤情報の1件。 */
export interface OnshiMedicationInfo {
  yjCode?: YjCode;
  name: string;
  dispensedDate?: string;
  facilityName?: string;
  /** 用法・用量 (取得できた場合の参考表示)。 */
  usage?: string;
}

/** オン資経由 特定健診情報の1件 (JLAC10/11)。 */
export interface OnshiCheckupInfo {
  jlac10?: Jlac10Code;
  itemName: string;
  value?: string;
  unit?: string;
  examDate?: string;
  /** 基準値外フラグ (取得できた場合)。 */
  outOfRange?: boolean;
}

/** 6情報のうちアレルギー(薬剤/その他)1件 (J-FAGY)。救急時参照にも使用。 */
export interface OnshiAllergyInfo {
  jFagy?: JFagyCode;
  category: 'DRUG' | 'OTHER';
  substance: string;
  reaction?: string;
}

/** 6情報のうち傷病名1件 (Condition相当 / ICD-10対応標準病名)。 */
export interface OnshiDiagnosisInfo {
  standardDiseaseCode?: StandardDiseaseCode;
  icd10?: Icd10Code;
  name: string;
  /** 主病/疑い等の区分 (取得できた場合)。 */
  category?: string;
  startDate?: string;
}

/** 6情報のうち感染症1件 (Observation相当 / 梅毒・HBs・HCV・HIV 等)。 */
export interface OnshiInfectionInfo {
  jlac10?: Jlac10Code;
  itemName: string;
  result?: string;
  examDate?: string;
}

/** 6情報のうち検査1件 (Observation相当 / 生活習慣病4疾患＋救急有用 計43項目)。 */
export interface OnshiLabInfo {
  jlac10?: Jlac10Code;
  itemName: string;
  value?: string;
  unit?: string;
  refLow?: string;
  refHigh?: string;
  examDate?: string;
}

/** 6情報のうち処方1件 (MedicationRequest相当 / YJコード、一般名は下3桁zzz)。 */
export interface OnshiPrescriptionInfo {
  yjCode?: YjCode;
  name: string;
  usage?: string;
  prescribedDate?: string;
  facilityName?: string;
}

/**
 * 薬剤情報・特定健診・6情報一覧の閲覧結果。
 * AC(2) オン資経由で薬剤情報/6情報を参照できる。
 *
 * 6情報(傷病名/感染症/薬剤アレルギー等/その他アレルギー等/検査/処方)を正式名称で保持。
 * 既存フィールド(medications/checkups/allergies)は後方互換のため維持し、傷病名・感染症・
 * 検査・処方を追加 (要件定義書 IF-EXT-02 説明: 薬剤情報・特定健診等情報・6情報一覧)。
 */
export interface OnshiPatientInfoResult {
  /** 薬剤情報 (オン資 薬剤情報閲覧)。 */
  medications: OnshiMedicationInfo[];
  /** 特定健診等情報。 */
  checkups: OnshiCheckupInfo[];
  /** 6情報: 薬剤アレルギー等/その他アレルギー等。 */
  allergies: OnshiAllergyInfo[];
  /** 6情報: 傷病名。 */
  diagnoses?: OnshiDiagnosisInfo[];
  /** 6情報: 感染症。 */
  infections?: OnshiInfectionInfo[];
  /** 6情報: 検査。 */
  labs?: OnshiLabInfo[];
  /** 6情報: 処方。 */
  prescriptions?: OnshiPrescriptionInfo[];
  /** 本人同意が得られ実際に取得できたサービス区分 (院内ゲートウェイ/資格確認端末で取得)。 */
  consentedServices?: OnshiInfoService[];
}
