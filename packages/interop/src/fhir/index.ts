/**
 * IF-EXT-05 電子カルテ情報共有サービス (3文書6情報・HL7 FHIR) — barrel + 連携アダプタ (STUB)。
 *
 * resources.ts(リソース型) と jpcore-mapping.ts(内部→FHIR 純変換) を re-export し、
 * 加えて電子カルテ情報共有サービスへの登録/閲覧アダプタ(STUB)を提供する。
 */
import { stubResult, type IntegrationResult } from '../types.js';
import {
  buildDocumentBundle,
  toFhirBundle,
  type DocumentMeta,
  type SixInfoSource,
} from './jpcore-mapping.js';
import type { FhirBundle } from './resources.js';

export * from './resources.js';
export * from './jpcore-mapping.js';

/** 3文書6情報の FHIR 出力封筒。生成済み Bundle を保持する。 */
export interface FhirBundleOut {
  /** 文書種別 (健診結果報告書/診療情報提供書/退院時サマリー/6情報)。 */
  documentType: 'CHECKUP' | 'REFERRAL' | 'DISCHARGE_SUMMARY' | 'SIX_INFO';
  bundle: FhirBundle;
}

/** 内部データ(6情報)を FHIR Bundle (collection) に正規化して出力封筒を作る(純変換)。 */
export function buildSixInfoBundle(src: SixInfoSource): FhirBundleOut {
  return { documentType: 'SIX_INFO', bundle: toFhirBundle(src) };
}

/**
 * 健康診断結果報告書 (HS037) を FHIR document Bundle で生成する(純変換)。
 * 検査(6情報)を本文に束ね、Composition ヘッダを付与する。
 */
export function buildCheckupDocument(src: SixInfoSource, meta: DocumentMeta = {}): FhirBundleOut {
  return {
    documentType: 'CHECKUP',
    bundle: buildDocumentBundle({ kind: 'CHECKUP', six: src, ...meta }),
  };
}

/**
 * 診療情報提供書 (紹介状 / HS038) を FHIR document Bundle で生成する(純変換)。
 * 紹介先(recipientOrgName)・本文・6情報を束ねる (FR-DOC-02 出力源)。
 */
export function buildReferralDocument(src: SixInfoSource, meta: DocumentMeta = {}): FhirBundleOut {
  return {
    documentType: 'REFERRAL',
    bundle: buildDocumentBundle({ kind: 'REFERRAL', six: src, ...meta }),
  };
}

/**
 * 退院時サマリー (HS039) を FHIR document Bundle で生成する(純変換)。
 * 退院時の病名・処方・検査(6情報)を束ねる (FR-DOC-02 出力源)。
 */
export function buildDischargeSummaryDocument(
  src: SixInfoSource,
  meta: DocumentMeta = {},
): FhirBundleOut {
  return {
    documentType: 'DISCHARGE_SUMMARY',
    bundle: buildDocumentBundle({ kind: 'DISCHARGE_SUMMARY', six: src, ...meta }),
  };
}

/** 生成した FHIR Bundle を電子カルテ情報共有サービスへ登録する (STUB)。 */
export async function registerBundle(
  _out: FhirBundleOut,
): Promise<IntegrationResult<{ documentId: string }>> {
  return stubResult<{ documentId: string }>();
}

/** 他院由来の 3文書6情報 を閲覧取得する (STUB)。 */
export async function fetchBundle(
  _patientRef: string,
): Promise<IntegrationResult<FhirBundleOut>> {
  return stubResult<FhirBundleOut>();
}
