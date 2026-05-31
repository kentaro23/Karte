/**
 * @medixus/interop — 外部連携(interop) seam (要件定義書 第6章 IF-EXT-01〜07).
 *
 * 全外部連携は本パッケージ配下の抽象IFに閉じ込め、サーバーアクションは抽象経由で
 * 呼ぶ。各アダプタは現段階 status:'STUB' の型安全スタブで、後で IOPスクワッドが
 * 本番化する。
 *
 *   IF-EXT-01 レセコン/ORCA連携          → ./recept
 *   IF-EXT-02 オンライン資格確認/マイナ保険証 → ./insurance-verify
 *   IF-EXT-03 電子処方箋                  → ./eprescription
 *   IF-EXT-04 外注検査・PACS連携           → ./lab-link
 *   IF-EXT-05 電子カルテ情報共有(3文書6情報・FHIR) → ./fhir
 *   IF-EXT-06 SS-MIX2・地域連携            → ./ssmix2
 *   IF-EXT-07 データポータビリティ(エクスポート) → ./export
 */
export * from './types.js';
export * from './recept/index.js';
export * from './insurance-verify/index.js';
export * from './eprescription/index.js';
export * from './lab-link/index.js';
export * from './fhir/index.js';
export * from './ssmix2/index.js';
export * from './export/index.js';
