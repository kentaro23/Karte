/**
 * 臨床検査マスター取込 — STUB (MST1 が後で充実させる前提の最小スタブ)。
 *
 * ExamMaster(code/name/JLAC10/11・基準範囲 refLow/refHigh・検体区分) を公的/標準
 * マスタから全量取込する経路。JLAC10/11(HS014) 紐付けを正規化キーにする
 * (要件定義書 6.2 / G24)。現段階は ImportRun ライフサイクルだけ確立し、
 * パース/upsert 本体は MST1 実装まで documented no-op とする。
 *
 *   pnpm import:exams /path/to/jlac.csv 2026-04   (本番化後)
 */
import { prisma } from '@medixus/db';

export interface ExamImportOptions {
  filePath?: string;
  sourceRelease: string;
}

export interface ExamImportResult {
  imported: number;
  skipped: boolean;
  runId: string;
}

/**
 * 臨床検査マスタを取込む (STUB)。
 * 現段階は常に no-op で ImportRun を SUCCESS 記録し、件数0を返す。
 * 本番化時は ExamMaster を JLAC10/11 紐付きで upsert する。
 */
export async function importExamMaster(
  opts: ExamImportOptions,
): Promise<ExamImportResult> {
  const run = await prisma.importRun.create({
    data: { source: `EXAM:${opts.sourceRelease}`, status: 'RUNNING' },
  });
  // TODO(MST1): filePath を解析し ExamMaster(JLAC10/11・refLow/refHigh) を upsert。
  await prisma.importRun.update({
    where: { id: run.id },
    data: {
      status: 'SUCCESS',
      endedAt: new Date(),
      counts: { imported: 0, note: 'STUB: exam-import not implemented (MST1)' },
    },
  });
  return { imported: 0, skipped: true, runId: run.id };
}
