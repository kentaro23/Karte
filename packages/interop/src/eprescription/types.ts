/**
 * IF-EXT-03 電子処方箋 (G23) — 型定義。
 *
 * 電子処方箋管理サービス(EPS)へ院外処方箋登録、重複投薬・併用禁忌チェック要求/結果、
 * 調剤結果リスト取得。一般名処方・リフィル。自社決定論安全エンジン(FR-RXSAFE)と
 * 相補(管理サービスの全国横断チェックを併用)。
 *
 * 本ファイルは「型安全スタブ」用の型のみを定義する。本番接続(管理サービスの
 * Web API / HPKIカード署名 / 電子処方箋ID採番)は後で IOPスクワッドが実装する。
 */
import type { HotCode, PatientRef, ReceiptDrugCode, YjCode } from '../types.js';

/**
 * 調剤区分。電子処方箋では院外処方が前提だが、分割調剤/院内の区別を保持する。
 * Prisma `PrescriptionItem.dispenseType` と同じ語彙を共有する。
 */
export type DispenseType = 'OUTPATIENT' | 'INHOUSE' | 'SPLIT';

/** 処方明細1行。一般名処方は YJ 下3桁 zzz 相当(銘柄指定不可)。 */
export interface EPrescriptionLine {
  /** YJコード(個別医薬品コード)。一般名処方時は下3桁 zzz。 */
  yjCode?: YjCode;
  /** HOTコード(HS001)。レセ電/在庫照合の補助キー。 */
  hotCode?: HotCode;
  /** レセ電 医薬品コード(請求連携用)。 */
  receiptDrugCode?: ReceiptDrugCode;
  /** true=一般名処方(銘柄指定不可・後発品変更可)。 */
  isGenericName?: boolean;
  /** 後発品への変更不可(医師指示)。 */
  brandLocked?: boolean;
  drugName: string;
  dosePerTake?: number;
  unit?: string;
  /** 用法(例 '1日3回 毎食後')。 */
  frequency?: string;
  durationDays?: number;
  /** 調剤区分(明細単位の上書き。未指定は要求単位の値を継承)。 */
  dispenseType?: DispenseType;
  /** 一包化指示(Prisma `PrescriptionItem.isOnePackage` 相当)。 */
  isOnePackage?: boolean;
  /** 臨時投与(Prisma `PrescriptionItem.isTemporary` 相当)。 */
  isTemporary?: boolean;
  /** 適応外使用(Prisma `PrescriptionItem.isOffLabel` 相当・コメント必須運用)。 */
  isOffLabel?: boolean;
}

/**
 * リフィル処方情報。
 * リフィル可能回数(最大3回)・調剤間隔の目安を保持する。`refillCount`(EPrescriptionRequest)
 * は後方互換のため残し、詳細はこの構造体で表現する。
 */
export interface RefillInfo {
  /** リフィル可能回数(1〜3)。0/未指定=通常処方。 */
  allowedRefills: number;
  /** 次回調剤可能日の目安(ISO 8601)。 */
  nextDispensableDate?: string;
  /** 調剤間隔(日)。投与日数からの目安。 */
  intervalDays?: number;
}

/** 院外処方箋の登録要求。 */
export interface EPrescriptionRequest {
  patientRef: PatientRef;
  prescriberName: string;
  /** 処方医のHPKI識別子(本番化時の電子署名キー。スタブでは任意)。 */
  prescriberHpkiId?: string;
  /** 医療機関コード(点数表番号+都道府県+医療機関番号)。 */
  facilityCode?: string;
  issuedDate: string; // ISO 8601
  /** 院内/院外の既定調剤区分。明細で上書き可。 */
  dispenseType?: DispenseType;
  lines: EPrescriptionLine[];
  /** リフィル回数 (0=通常)。後方互換のため残置。詳細は `refill`。 */
  refillCount?: number;
  /** リフィル詳細(回数・間隔)。 */
  refill?: RefillInfo;
}

/** 重複投薬・併用禁忌チェックの指摘1件 (全国横断)。 */
export interface EPrescriptionCheckFinding {
  type: 'DUPLICATE' | 'INTERACTION';
  severity: 'CONTRAINDICATED' | 'CAUTION';
  message: string;
  /** 相手薬剤(併用禁忌/重複の対向)。 */
  counterpartDrug?: string;
  /** 指摘元の薬剤(本処方側)。 */
  subjectDrug?: string;
  /** 他院由来の場合の発行施設名。 */
  sourceFacility?: string;
}

/**
 * 全国横断チェックの集約判定。
 * EPS は院外の他院処方も含めて判定するため、自社安全エンジン(FR-RXSAFE)の院内判定と
 * 相補的に扱う。
 */
export type EPrescriptionOverall = 'OK' | 'WARNING' | 'BLOCK';

/** 院外処方箋登録の結果。 */
export interface EPrescriptionResult {
  /** 電子処方箋ID(管理サービス採番)。 */
  prescriptionId?: string;
  /** 引換番号(薬局提示用)。 */
  accessCode?: string; // 引換番号
  /** 全国横断チェックの集約。 */
  overall?: EPrescriptionOverall;
  findings: EPrescriptionCheckFinding[];
  /** 登録受理時刻(ISO 8601)。 */
  registeredAt?: string;
}

/** 調剤結果リストの1件。 */
export interface DispenseResult {
  yjCode?: YjCode;
  drugName: string;
  dispensedQuantity?: number;
  /** 調剤日(ISO 8601)。 */
  dispensedDate?: string;
  pharmacyName?: string;
  /** リフィルの何回目か(1〜)。 */
  refillSequence?: number;
  /** 残リフィル回数。 */
  remainingRefills?: number;
}
