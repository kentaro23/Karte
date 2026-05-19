/**
 * 傷病名マスター取込（厚労省/支払基金 基本マスター s / b）。
 *
 *   pnpm import:diseases /path/to/R06_s.zip 2026-05
 *   pnpm import:diseases /path/to/b_20260101.txt 2026-01
 *
 * レイアウト差異に強い解析: 7桁の傷病名コード → 漢字名 → ICD10 を発見的に抽出。
 * provenance=MHLW_RECEIPT（同じ基本マスター系）。冪等(code upsert)。
 */
import { readFileSync, existsSync } from 'node:fs';
import { prisma } from '@medixus/db';

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (q) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else q = false;
      } else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export interface DiseaseRow {
  code: string;
  name: string;
  icd10: string;
}

const KANJI = /[一-龥぀-ヿ々ー〆]/;
const ICD10 = /^[A-Z][0-9]{2}\.?[0-9A-Z]?$/;

export function parseDiseaseCsv(utf8Text: string): DiseaseRow[] {
  const rows: DiseaseRow[] = [];
  for (const raw of utf8Text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const c = splitCsvLine(raw);
    const codeIdx = c.findIndex((v) => /^\d{7}$/.test(v));
    if (codeIdx < 0) continue;
    const after = c.slice(codeIdx + 1);
    const name = after.find((v) => v.length > 1 && KANJI.test(v));
    if (!name) continue;
    const icdCell = c.find((v) => ICD10.test(v));
    rows.push({ code: c[codeIdx]!, name, icd10: icdCell ? icdCell.replace('.', '') : '' });
  }
  // 同一コード重複は最後を採用（変更行が後勝ち）
  const map = new Map<string, DiseaseRow>();
  for (const r of rows) map.set(r.code, r);
  return [...map.values()];
}

export async function importDiseaseMaster(opts: {
  filePath?: string;
  sourceRelease: string;
}): Promise<{ imported: number; skipped: boolean; runId: string }> {
  const run = await prisma.importRun.create({
    data: { source: `MHLW_DISEASE:${opts.sourceRelease}`, status: 'RUNNING' },
  });
  if (!opts.filePath || !existsSync(opts.filePath)) {
    await prisma.importRun.update({
      where: { id: run.id },
      data: { status: 'SUCCESS', endedAt: new Date(), counts: { imported: 0, note: 'no file' } },
    });
    return { imported: 0, skipped: true, runId: run.id };
  }
  const rows = parseDiseaseCsv(readFileSync(opts.filePath, 'utf8'));
  const mv = await prisma.masterVersion.create({
    data: { masterType: 'DISEASE', source: 'MHLW_RECEIPT', sourceRelease: opts.sourceRelease, validFrom: new Date() },
  });
  let n = 0;
  // batched upsert
  for (const r of rows) {
    await prisma.diseaseMaster.upsert({
      where: { code: r.code },
      create: {
        code: r.code,
        name: r.name,
        icd10: r.icd10 ? [r.icd10] : [],
        source: 'MHLW_RECEIPT',
        sourceMasterVersion: mv.id,
      },
      update: { name: r.name, icd10: r.icd10 ? [r.icd10] : [] },
    });
    n++;
  }
  await prisma.importRun.update({
    where: { id: run.id },
    data: { status: 'SUCCESS', endedAt: new Date(), counts: { imported: n } },
  });
  return { imported: n, skipped: false, runId: run.id };
}
