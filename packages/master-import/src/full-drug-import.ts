/**
 * 医薬品マスター全量取込 — STUB (MST1 が後で充実させる前提の最小スタブ)。
 *
 * 既存の receipt-csv.ts(レセ電 医薬品マスタ ~2万品目) を土台に、HOT/YJ 突合や
 * 改定差分・版管理を含む「全量取込オーケストレーション」をここへ集約していく。
 * 安全データ(禁忌/相互作用/極量/適応/用法用量)は本経路では一切扱わない
 * (provenance ガード / NFR-AUTH-04)。現段階は ImportRun ライフサイクルだけ確立し、
 * パース/upsert 本体は MST1 実装まで documented no-op とする。
 *
 *   pnpm import:drugs /path/to/y_ALL.csv 2026-04   (本番化後)
 */
import { prisma } from '@medixus/db';

export interface FullDrugImportOptions {
  filePath?: string;
  sourceRelease: string;
}

export interface FullDrugImportResult {
  imported: number;
  skipped: boolean;
  runId: string;
}

/**
 * 医薬品マスタを全量取込する (STUB)。
 * 現段階は常に no-op で ImportRun を SUCCESS 記録し、件数0を返す。
 * 本番化時は receipt-csv の upsertDrugProduct 経路 + HOT/YJ 突合をここで束ねる。
 */
export async function importFullDrugMaster(
  opts: FullDrugImportOptions,
): Promise<FullDrugImportResult> {
  const run = await prisma.importRun.create({
    data: { source: `FULL_DRUG:${opts.sourceRelease}`, status: 'RUNNING' },
  });
  // TODO(MST1): filePath を解析し DrugProduct/DrugIngredient を全量 upsert。
  await prisma.importRun.update({
    where: { id: run.id },
    data: {
      status: 'SUCCESS',
      endedAt: new Date(),
      counts: { imported: 0, note: 'STUB: full-drug-import not implemented (MST1)' },
    },
  });
  return { imported: 0, skipped: true, runId: run.id };
}
