/**
 * IF-EXT-01 レセコン/ORCA連携 (G21 / 174:64,102) — 型定義。
 *
 * 標準型レセコン(WebORCAクラウド/共通算定モジュール)へ、患者基本・保険・病名・
 * 診療行為・処方/検査の算定情報を連携(WebAPI)。中途終了データ登録。マスタ初回
 * 取込(ORCA→Medixus)。算定はレセコンに委譲し、Medixus は診療情報・オーダ・病名・
 * 中途終了データの連携に徹する (要件定義書 6.1)。
 */
import type {
  Icd10Code,
  PatientRef,
  ReceiptDrugCode,
  StandardDiseaseCode,
  YjCode,
} from '../types.js';

/** 患者基本情報の連携ペイロード。 */
export interface ReceiptPatientPayload {
  patientRef: PatientRef;
  familyName: string;
  givenName: string;
  kana?: string;
  birthDate: string; // ISO 8601 (YYYY-MM-DD)
  sex: 'M' | 'F' | 'U';
}

/** 保険・公費情報の連携ペイロード。 */
export interface ReceiptInsurancePayload {
  payerType: string; // 社保/国保/後期/公費 等
  payerNo?: string;
  insurerNo?: string;
  symbol?: string; // 記号
  number?: string; // 番号
  branchNo?: string; // 枝番
  validFrom?: string;
  validTo?: string;
}

/** 病名連携 (主病/疑い/転帰) ペイロード。 */
export interface ReceiptDiagnosisPayload {
  standardDiseaseCode: StandardDiseaseCode;
  icd10?: Icd10Code;
  name: string;
  isMain?: boolean;
  isSuspected?: boolean;
  startDate?: string;
  outcome?: string;
}

/** 診療行為・処方・検査の算定対象明細。 */
export interface ReceiptOrderLine {
  category: 'RX' | 'INJECTION' | 'PROCEDURE' | 'EXAM' | 'OTHER';
  receiptCode?: ReceiptDrugCode;
  yjCode?: YjCode;
  name: string;
  quantity?: number;
  unit?: string;
}

/**
 * カルテ確定時にレセコンへ送る算定情報の集約ペイロード。
 * カルテ確定でオーダ・病名を自動連携(設定でON/OFF)。
 */
export interface ReceiptClaimPayload {
  patient: ReceiptPatientPayload;
  insurances: ReceiptInsurancePayload[];
  diagnoses: ReceiptDiagnosisPayload[];
  orders: ReceiptOrderLine[];
  encounterDate: string;
  departmentCode?: string;
  /** 中途終了データとして登録する場合 true。 */
  interim?: boolean;
}

/** レセコンからの点数/算定結果。 */
export interface ReceiptClaimResult {
  acceptedNo?: string;
  totalPoints?: number;
  lines?: { name: string; points: number }[];
}

/** レセコン点数マスタ取込 (ORCA→Medixus) 結果。 */
export interface ReceiptMasterImportResult {
  masterType: 'PROCEDURE' | 'DRUG' | 'DEVICE' | 'OTHER';
  importedCount: number;
  sourceRelease?: string;
}
