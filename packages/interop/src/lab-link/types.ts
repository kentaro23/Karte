/**
 * IF-EXT-04 外注検査・PACS連携 (G24 / 174:23-56,47-51) — 型定義。
 *
 * 検体検査の外注連携(JAHIS臨床検査データ交換規約 HS012 / JLAC、検査依頼自動連携・
 * 結果取込)。PACS(DICOM HS011 / JJ1017 HS017 / JAHIS放射線 HS016)画像表示・
 * キー画像登録。
 */
import type { Jlac10Code, PatientRef } from '../types.js';

/** 外注検査オーダの1項目 (JLAC紐付け)。 */
export interface LabOrderItem {
  jlac10: Jlac10Code;
  testName: string;
  specimenType?: string;
}

/** 外注検査依頼 (JAHIS HS012 送信) ペイロード。 */
export interface LabOrderOut {
  patientRef: PatientRef;
  orderNo: string;
  orderedDate: string; // ISO 8601
  items: LabOrderItem[];
  /** 検査会社識別子 (約170社)。 */
  laboratoryCode?: string;
}

/** 外注検査結果の1項目 (取込)。 */
export interface LabResultItem {
  jlac10: Jlac10Code;
  testName: string;
  value: string;
  unit?: string;
  /** 基準範囲フラグ。ExamMaster.refLow/refHigh で H/L 判定。 */
  flag?: 'H' | 'L' | 'N';
  refLow?: number;
  refHigh?: number;
}

/** 外注検査結果 (JAHIS HS012 受信) ペイロード。 */
export interface LabResultIn {
  orderNo: string;
  patientRef: PatientRef;
  reportedDate: string;
  results: LabResultItem[];
}

/** PACS 画像参照 (DICOM HS011) 要求。 */
export interface PacsStudyQuery {
  patientRef: PatientRef;
  /** DICOM Study Instance UID。 */
  studyInstanceUid?: string;
  accessionNumber?: string;
  modality?: string; // CT/MR/CR/US 等
}

/** PACS スタディ参照結果 (画像表示用メタ)。 */
export interface PacsStudyRef {
  studyInstanceUid: string;
  modality?: string;
  studyDate?: string;
  /** WADO-RS 等の参照URL (本番化時)。 */
  viewerUrl?: string;
  seriesCount?: number;
}

/** キー画像を診療録/紹介状に登録する要求。 */
export interface KeyImageRef {
  patientRef: PatientRef;
  studyInstanceUid: string;
  sopInstanceUid?: string;
  caption?: string;
}
