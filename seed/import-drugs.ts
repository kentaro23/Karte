/**
 * 保険収載 全医薬品マスタ 取込ランナー。
 *   pnpm import:drugs /path/to/y_ZZZ.zip          （厚労省/支払基金 医薬品マスター）
 *   pnpm import:drugs /path/to/y.csv
 * scripts/import-drugs.sh が zip展開＋Shift_JIS→UTF-8変換して本ランナーへ渡す。
 * importReceiptDrugMaster は MHLW_RECEIPT provenance で全件 upsert（安全データは付与しない）。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.DATABASE_URL) {
  for (const line of readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/.exec(line);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2];
  }
}

const csvPath = process.argv[2];
const release = process.argv[3] ?? new Date().toISOString().slice(0, 7);
if (!csvPath) {
  console.error('usage: import-drugs.ts <utf8-csv-path> [release]');
  process.exit(1);
}

const { importReceiptDrugMaster } = await import('@medixus/master-import');
const { prisma } = await import('@medixus/db');

console.log(`[import] receipt 医薬品マスター ← ${csvPath} (release ${release})`);
const r = await importReceiptDrugMaster({ filePath: csvPath, sourceRelease: release });
const total = await prisma.drugProduct.count();
await prisma.$disconnect();
console.log(`[import] done: imported=${r.imported} skipped=${r.skipped} / DrugProduct総数=${total}`);
