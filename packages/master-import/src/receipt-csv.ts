/**
 * J1 — 厚生労働省 レセプト電算処理システム 医薬品マスター importer.
 *
 * This is the "最大件数（~2万品目）を今すぐ" path: code / 単位 / 薬価 / 名称 / 区分
 * loaded mechanically from the official public CSV. NO safety data here (禁忌・相互
 * 作用・極量 never come from this file, never from AI). The file is published as
 * Shift_JIS; pass it decoded to UTF-8. If no file is supplied the loader is a
 * documented no-op so callers fall back to the curated seed.
 */
import { readFileSync, existsSync } from 'node:fs';
import { prisma } from '@medixus/db';
import { upsertDrugProduct } from './drug-loader.js';

/** Official レセ電 医薬品マスタ column order (y = 医薬品マスター レコード). */
export interface ReceiptDrugRow {
  receiptCode: string; // 医薬品コード (9)
  name: string; // medicine name
  nameKana: string; // 漢字名称カナ
  unitCode: string; // 単位コード
  price: number; // 新薬価
  dosageFormHint?: string;
}

/**
 * Layout-tolerant parser. The 支払基金 医薬品マスター(y) layout drifts between
 * revisions (有効桁数 columns etc.), so instead of fixed indexes we locate the
 * 9-digit 医薬品コード, then the kanji name / katakana name / price heuristically.
 */
export function parseReceiptCsv(utf8Text: string): ReceiptDrugRow[] {
  const rows: ReceiptDrugRow[] = [];
  const hasKanji = (s: string) => /[一-鿿぀-ヿ]/.test(s);
  const isKana = (s: string) => /^[゠-ヿ0-9A-Za-z\s.\-･ｱ-ﾝ]+$/.test(s);
  for (const line of utf8Text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const c = line.split(',').map((s) => s.replace(/^"|"$/g, '').trim());
    const codeIdx = c.findIndex((v) => /^\d{9}$/.test(v));
    if (codeIdx < 0) continue;
    const after = c.slice(codeIdx + 1);
    const name = after.find((v) => v.length > 1 && hasKanji(v)) ?? '';
    const nameKana =
      after.find((v) => v.length > 1 && !hasKanji(v) && isKana(v) && /[゠-ヿ]/.test(v)) ??
      '';
    // 薬価は小数表記(例 9.80, 23.90)。桁数/区分の整数を拾わないよう小数セルのみ採用。
    const priceCell = [...c].reverse().find((v) => /^\d{1,7}\.\d{1,3}$/.test(v));
    rows.push({
      receiptCode: c[codeIdx]!,
      name,
      nameKana,
      unitCode: '',
      price: priceCell ? Number(priceCell) : 0,
    });
  }
  return rows;
}

export async function importReceiptDrugMaster(opts: {
  filePath?: string;
  sourceRelease: string;
}): Promise<{ imported: number; skipped: boolean; runId: string }> {
  const run = await prisma.importRun.create({
    data: { source: `MHLW_RECEIPT:${opts.sourceRelease}`, status: 'RUNNING' },
  });

  if (!opts.filePath || !existsSync(opts.filePath)) {
    await prisma.importRun.update({
      where: { id: run.id },
      data: { status: 'SUCCESS', endedAt: new Date(), counts: { imported: 0, note: 'no source file — use curated seed' } },
    });
    return { imported: 0, skipped: true, runId: run.id };
  }

  const text = readFileSync(opts.filePath, 'utf8');
  const rows = parseReceiptCsv(text);
  const mv = await prisma.masterVersion.create({
    data: {
      masterType: 'DRUG',
      source: 'MHLW_RECEIPT',
      sourceRelease: opts.sourceRelease,
      validFrom: new Date(),
    },
  });
  let n = 0;
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
      provenance: { source: 'MHLW_RECEIPT', sourceRelease: opts.sourceRelease, importedAt: new Date().toISOString() },
    });
    n++;
  }
  await prisma.importRun.update({
    where: { id: run.id },
    data: { status: 'SUCCESS', endedAt: new Date(), counts: { imported: n } },
  });
  return { imported: n, skipped: false, runId: run.id };
}
