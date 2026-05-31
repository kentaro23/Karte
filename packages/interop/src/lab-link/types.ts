/**
 * IF-EXT-04 外注検査・PACS連携 (G24 / 174:23-56,47-51) — 型定義。
 *
 * 検体検査の外注連携(JAHIS臨床検査データ交換規約 HS012 / JLAC、検査依頼自動連携・
 * 結果取込)。PACS(DICOM HS011 / JJ1017 HS017 / JAHIS放射線 HS016)画像表示・
 * キー画像登録。
 *
 * 本ファイルは「型安全スタブ」用の型のみを定義する。本番接続(検査会社の HS012
 * メッセージ送受信 / PACS の WADO-RS 等)は後で IOPスクワッドが実装する。
 */
import type { Jlac10Code, PatientRef } from '../types.js';

/** 検査の臨床的優先度。緊急検査は外注でも at-once 区分で送る。 */
export type LabPriority = 'ROUTINE' | 'URGENT' | 'STAT';

/** 外注検査オーダの1項目 (JLAC紐付け)。 */
export interface LabOrderItem {
  /** 臨床検査マスター JLAC10/11 (HS014)。 */
  jlac10: Jlac10Code;
  testName: string;
  /** 検体種別(血清/全血/尿 等)。 */
  specimenType?: string;
  /** 項目単位の優先度(未指定はオーダ単位を継承)。 */
  priority?: LabPriority;
}

/** 外注検査依頼 (JAHIS HS012 送信) ペイロード。 */
export interface LabOrderOut {
  patientRef: PatientRef;
  orderNo: string;
  orderedDate: string; // ISO 8601
  items: LabOrderItem[];
  /** 検査会社識別子 (約170社)。 */
  laboratoryCode?: string;
  /** オーダ単位の優先度。 */
  priority?: LabPriority;
  /** 依頼元の医療機関コード/診療科(検体ラベル/結果突合用)。 */
  facilityCode?: string;
  departmentCode?: string;
}

/** 外注検査結果1項目の確定区分(JAHIS HS012 の結果状態)。 */
export type LabResultStatus = 'FINAL' | 'PRELIMINARY' | 'CORRECTED' | 'PENDING';

/** 外注検査結果の1項目 (取込)。 */
export interface LabResultItem {
  jlac10: Jlac10Code;
  testName: string;
  value: string;
  unit?: string;
  /**
   * 基準範囲フラグ。ExamMaster.refLow/refHigh で H/L 判定。
   * 取込後は @medixus/domain `judgeLabFlag(value,refLow,refHigh)` で再判定可能。
   */
  flag?: 'H' | 'L' | 'N';
  refLow?: number;
  refHigh?: number;
  /** 結果の確定状態(速報/確定/訂正)。 */
  status?: LabResultStatus;
  /** 検査会社のコメント(測定不能・再検依頼 等)。 */
  comment?: string;
}

/** 外注検査結果 (JAHIS HS012 受信) ペイロード。 */
export interface LabResultIn {
  orderNo: string;
  patientRef: PatientRef;
  reportedDate: string;
  results: LabResultItem[];
  /** ペイロード全体の確定状態(部分速報の判別用)。 */
  status?: LabResultStatus;
  laboratoryCode?: string;
}

/** PACS 画像参照 (DICOM HS011) 要求。 */
export interface PacsStudyQuery {
  patientRef: PatientRef;
  /** DICOM Study Instance UID。 */
  studyInstanceUid?: string;
  accessionNumber?: string;
  modality?: string; // CT/MR/CR/US 等
  /** 検査日範囲(ISO 8601, 期間絞り込み)。 */
  studyDateFrom?: string;
  studyDateTo?: string;
}

/** PACS スタディ参照結果 (画像表示用メタ)。 */
export interface PacsStudyRef {
  studyInstanceUid: string;
  modality?: string;
  studyDate?: string;
  /** スタディ記述(JJ1017 由来の検査名称 等)。 */
  description?: string;
  accessionNumber?: string;
  /** WADO-RS 等の参照URL (本番化時)。 */
  viewerUrl?: string;
  seriesCount?: number;
  imageCount?: number;
}

/** キー画像の登録先(診療録 or 紹介状)。 */
export type KeyImageTarget = 'CLINICAL_NOTE' | 'REFERRAL';

/** キー画像を診療録/紹介状に登録する要求。 */
export interface KeyImageRef {
  patientRef: PatientRef;
  studyInstanceUid: string;
  /** 対象画像の SOP Instance UID(キー画像)。 */
  sopInstanceUid?: string;
  /** シリーズ UID(必要時)。 */
  seriesInstanceUid?: string;
  caption?: string;
  /** 登録先(診療録/紹介状)。未指定は診療録。 */
  target?: KeyImageTarget;
  /** 登録先のエンティティID(NoteAttachment/Referral の紐付け先)。 */
  targetId?: string;
}
