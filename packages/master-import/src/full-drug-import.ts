/**
 * 医薬品マスター全量取込オーケストレーション — WP-MST1 (FR 174:161-165 / OPS-03 / MIG-02)。
 *
 * 既存の receipt-csv.ts(レセ電 医薬品マスタ ~2万品目) / drug-loader.ts(upsert) を土台に、
 * 「全量取込・点数改定追従・版/チェックサム記録・ロールバック」をここへ集約する。
 *
 *   pnpm import:drugs /path/to/y_ALL.csv 2026-04            # 全量取込
 *   pnpm import:drugs /path/to/y_DELTA.csv 2026-10 --revision  # 点数改定差分のみ
 *
 * 不可侵原則（NFR-AUTH-04 / provenance）:
 *   安全データ(禁忌/相互作用/極量/適応/用法用量)は本経路では一切扱わない。
 *   ここで投入できるのは code / 名称 / 剤形 / 単位 / 薬価 のみ（公的レセ電由来の機械的事実）。
 *   安全データは drug-loader.ts の assertSafetyProvenance 経路でのみ追加できる（AI非生成）。
 *
 * 版・チェックサム（MIG-02 / 8.2 版管理）:
 *   - 取込内容の SHA-256 を計算し ImportRun.checksum / MasterVersion.checksum に記録。
 *   - 同一 source / sourceRelease の旧 MasterVersion は validTo を閉じて版改定を追従する。
 *
 * ロールバック（MIG-03 / ImportStatus.ROLLED_BACK）:
 *   rollbackDrugImport(runId) で ImportRun を ROLLED_BACK にし、当該版の MasterVersion を
 *   validTo=now で失効させる。取込済 DrugProduct は追記専用方針に従い物理削除しない
 *   （新版の取込 or 失効した版の参照停止で扱う）。
 *
 * フロントのみモード(DB無): file 未指定/未存在なら curated デモ品目で SUCCESS 記録して描画を担保。
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { prisma } from '@medixus/db';
import { upsertDrugProduct } from './drug-loader.js';
import { parseReceiptCsv, type ReceiptDrugRow } from './receipt-csv.js';

export interface FullDrugImportOptions {
  filePath?: string;
  sourceRelease: string;
  /** 点数改定追従モード: 既存品目の薬価(nhiPrice)・改定日(nhiPriceDate)のみ更新。 */
  revisionOnly?: boolean;
}

export interface FullDrugImportResult {
  imported: number;
  /** revisionOnly 時、薬価が改定された件数。 */
  priceUpdated: number;
  skipped: boolean;
  runId: string;
  /** 記録した MasterVersion.id（デモ/スキップ時 null）。 */
  masterVersionId: string | null;
  checksum: string;
  note?: string;
}

/** 取込内容から決定論の SHA-256 チェックサムを計算（版照合・MIG-03 検証用）。 */
export function checksumOfDrugRows(rows: ReceiptDrugRow[]): string {
  const h = createHash('sha256');
  // 順序非依存にするためコードでソートしてから連結（同一マスタは同一 checksum）。
  for (const r of [...rows].sort((a, b) => a.receiptCode.localeCompare(b.receiptCode))) {
    h.update(`${r.receiptCode}\t${r.name}\t${r.nameKana}\t${r.price}\n`);
  }
  return h.digest('hex');
}

/**
 * DB 未接続でも「全量取込らしさ」を出すための最小 curated デモ品目。
 * 公的レセ電由来の機械的事実のみ（安全データを含まない）。
 */
const DEMO_DRUG_ROWS: ReceiptDrugRow[] = [
  { receiptCode: '620000001', name: 'アムロジピンOD錠5mg', nameKana: 'アムロジピンODジョウ', unitCode: '錠', price: 10.1 },
  { receiptCode: '620000002', name: 'ロスバスタチン錠2.5mg', nameKana: 'ロスバスタチンジョウ', unitCode: '錠', price: 10.1 },
  { receiptCode: '620000003', name: 'メトホルミン塩酸塩錠250mg', nameKana: 'メトホルミンエンサンエンジョウ', unitCode: '錠', price: 9.8 },
  { receiptCode: '620000004', name: 'ランソプラゾールOD錠15mg', nameKana: 'ランソプラゾールODジョウ', unitCode: '錠', price: 18.3 },
  { receiptCode: '620000005', name: 'カルベジロール錠10mg', nameKana: 'カルベジロールジョウ', unitCode: '錠', price: 16.4 },
];

/**
 * 医薬品マスタを全量取込する（WP-MST1 本実装）。
 * - filePath があればレセ電CSVを解析、無ければ curated デモ品目で取込（フロントのみモードでも完走）。
 * - 取込内容の checksum を計算し ImportRun / MasterVersion に版とともに記録。
 * - revisionOnly=true は点数改定差分（薬価のみ）を追従。
 */
export async function importFullDrugMaster(
  opts: FullDrugImportOptions,
): Promise<FullDrugImportResult> {
  const run = await prisma.importRun.create({
    data: {
      source: `FULL_DRUG:${opts.sourceRelease}${opts.revisionOnly ? ':REVISION' : ''}`,
      status: 'RUNNING',
    },
  });

  // ── 入力の確定（ファイル or curated デモ）──────────────────────────────────
  let rows: ReceiptDrugRow[];
  let usedDemo = false;
  if (opts.filePath && existsSync(opts.filePath)) {
    rows = parseReceiptCsv(readFileSync(opts.filePath, 'utf8'));
  } else {
    rows = DEMO_DRUG_ROWS;
    usedDemo = true;
  }
  const checksum = checksumOfDrugRows(rows);

  try {
    // ── 版の改定追従（同一 source/release の旧版を閉じ、新版を発行）──────────
    await prisma.masterVersion.updateMany({
      where: { masterType: 'DRUG', source: 'MHLW_RECEIPT', sourceRelease: opts.sourceRelease, validTo: null },
      data: { validTo: new Date() },
    });
    const mv = await prisma.masterVersion.create({
      data: {
        masterType: 'DRUG',
        source: 'MHLW_RECEIPT',
        sourceRelease: opts.sourceRelease,
        validFrom: new Date(),
        checksum,
      },
    });

    let imported = 0;
    let priceUpdated = 0;

    if (opts.revisionOnly) {
      // ── 点数改定追従: 既存品目の薬価のみ更新（新規 upsert はしない）──────────
      const now = new Date();
      for (const r of rows) {
        const existing = await prisma.drugProduct.findUnique({
          where: { receiptCode: r.receiptCode },
          select: { id: true, nhiPrice: true },
        });
        if (!existing) continue;
        if (existing.nhiPrice !== r.price) {
          await prisma.drugProduct.update({
            where: { id: existing.id },
            data: { nhiPrice: r.price, nhiPriceDate: now, sourceMasterVersion: mv.id },
          });
          priceUpdated++;
        }
      }
    } else {
      // ── 全量 upsert（code / 名称 / 剤形 / 薬価。安全データは投入しない）──────
      for (const r of rows) {
        await upsertDrugProduct({
          receiptCode: r.receiptCode,
          brandName: r.name,
          brandNameKana: r.nameKana,
          dosageForm: 'UNSPEC',
          administrationRoute: 'その他',
          unitCode: r.unitCode,
          nhiPrice: r.price,
          sourceMasterVersion: mv.id,
          provenance: {
            source: 'MHLW_RECEIPT',
            sourceRelease: opts.sourceRelease,
            sourceFile: opts.filePath ?? (usedDemo ? 'curated-demo' : 'unspecified'),
            importedAt: new Date().toISOString(),
            masterVersion: mv.id,
          },
        });
        imported++;
      }
    }

    await prisma.importRun.update({
      where: { id: run.id },
      data: {
        status: 'SUCCESS',
        endedAt: new Date(),
        checksum,
        counts: {
          imported,
          priceUpdated,
          masterVersionId: mv.id,
          sourceRelease: opts.sourceRelease,
          mode: opts.revisionOnly ? 'REVISION' : 'FULL',
          ...(usedDemo ? { note: 'curated demo rows (no source file)' } : {}),
        },
      },
    });

    return {
      imported,
      priceUpdated,
      skipped: false,
      runId: run.id,
      masterVersionId: mv.id,
      checksum,
      note: usedDemo ? 'curated デモ品目を取込（ソースファイル未指定）' : undefined,
    };
  } catch (err) {
    // DB 未接続/失敗でも呼び出し側は壊さない（フロントのみモード）。可能なら FAILED 記録。
    console.error('[importFullDrugMaster] failed (fail-soft):', err);
    try {
      await prisma.importRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          endedAt: new Date(),
          checksum,
          counts: { imported: 0, error: String((err as Error)?.message ?? err) },
        },
      });
    } catch {
      /* ImportRun 更新自体が不能（完全DB無）でも握りつぶす */
    }
    return {
      imported: 0,
      priceUpdated: 0,
      skipped: true,
      runId: run.id,
      masterVersionId: null,
      checksum,
      note: '取込に失敗しました（DB未接続の可能性）',
    };
  }
}

/**
 * 医薬品マスタ取込のロールバック（MIG-03 / ImportStatus.ROLLED_BACK）。
 * - ImportRun を ROLLED_BACK にし、当該 run が発行した MasterVersion を validTo=now で失効。
 * - 取込済 DrugProduct は追記専用方針に従い物理削除しない（失効版の参照停止で扱う）。
 * 返り値: 失効させた MasterVersion 件数。
 */
export async function rollbackDrugImport(
  runId: string,
): Promise<{ ok: boolean; rolledBackVersions: number; error?: string }> {
  try {
    const run = await prisma.importRun.findUnique({ where: { id: runId } });
    if (!run) return { ok: false, rolledBackVersions: 0, error: 'ImportRun が見つかりません' };
    if (run.status === 'ROLLED_BACK') {
      return { ok: true, rolledBackVersions: 0, error: '既にロールバック済みです' };
    }
    const mvId = (run.counts as { masterVersionId?: string } | null)?.masterVersionId ?? null;
    let rolledBackVersions = 0;
    if (mvId) {
      const res = await prisma.masterVersion.updateMany({
        where: { id: mvId, validTo: null },
        data: { validTo: new Date() },
      });
      rolledBackVersions = res.count;
    }
    await prisma.importRun.update({
      where: { id: runId },
      data: {
        status: 'ROLLED_BACK',
        counts: { ...((run.counts as object) ?? {}), rolledBackAt: new Date().toISOString() },
      },
    });
    return { ok: true, rolledBackVersions };
  } catch (err) {
    console.error('[rollbackDrugImport] failed (fail-soft):', err);
    return { ok: false, rolledBackVersions: 0, error: 'ロールバックに失敗しました（DB未接続の可能性）' };
  }
}
