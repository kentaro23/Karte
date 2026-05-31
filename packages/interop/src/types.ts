/**
 * packages/interop — 外部連携(interop) 共通型 (第6章 IF-EXT-01〜07).
 *
 * 全外部連携は本パッケージ配下の抽象IFに閉じ込め、サーバーアクションは抽象経由で
 * 呼ぶ (要件定義書 6章 共通方針)。各アダプタは stub→本番化。現段階は status:'STUB'
 * の「コンパイルが通る型安全スタブ」で、後で IOPスクワッドが中身を充実させる。
 *
 * 本ファイルは全アダプタが共有する封筒型(IntegrationResult)と、コード標準
 * (ICD-10対応標準病名 / YJ / HOT / レセ電 / JLAC10/11 / J-FAGY) のキー型を定義する
 * (要件定義書 6.2 コード標準を内部正規化キーに).
 */

/** アダプタの実装ステータス。本番化までは常に 'STUB'。 */
export type AdapterStatus = 'STUB';

/**
 * 全外部連携アダプタの統一返却封筒。
 * 本番接続せず、現段階では status:'STUB' を返す (data/error は将来用)。
 */
export interface IntegrationResult<T> {
  status: AdapterStatus;
  data?: T;
  error?: string;
}

/** status:'STUB' の IntegrationResult を生成する内部ヘルパ。 */
export function stubResult<T>(error = 'not-implemented: STUB adapter'): IntegrationResult<T> {
  return { status: 'STUB', error };
}

/* ── コード標準キー型 (内部正規化キー / 要件定義書 6.2) ─────────────────────── */

/** ICD-10 コード (例 'E11'). 病名=ICD-10対応標準病名マスター(HS005)。 */
export type Icd10Code = string;
/** 病名管理番号 (ICD-10対応標準病名マスター)。 */
export type StandardDiseaseCode = string;
/** YJコード (個別医薬品コード)。銘柄指定不可時は下3桁 zzz=一般名処方相当。 */
export type YjCode = string;
/** 医薬品HOTコード (HS001)。 */
export type HotCode = string;
/** レセ電 医薬品コード。 */
export type ReceiptDrugCode = string;
/** 臨床検査マスター JLAC10/11 (HS014)。 */
export type Jlac10Code = string;
/** J-FAGYコード (アレルゲン)。薬剤アレルギー等/その他アレルギー等の登録に使用。 */
export type JFagyCode = string;

/** 患者の内部ID (Medixus 正規化キー)。 */
export type PatientRef = string;
