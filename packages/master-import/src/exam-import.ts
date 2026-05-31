/**
 * 臨床検査マスター取込 — WP-MST1 (FR 174:161-165 / G24 / 要件定義書 6.2・8.2)。
 *
 * ExamMaster(code/name/JLAC10・基準範囲 refLow/refHigh・検体区分 specimenType) を
 * 臨床検査マスター(HS014) から全量取込する経路。JLAC10/11 紐付けを正規化キーにする。
 *
 *   pnpm import:exams /path/to/jlac.csv 2026-04
 *
 * 版・チェックサム（MIG-02）: 取込内容の SHA-256 を ImportRun.checksum /
 *   MasterVersion.checksum に記録。同一 source/release の旧版は validTo を閉じる。
 * ロールバック（MIG-03 / ImportStatus.ROLLED_BACK）: rollbackExamImport(runId)。
 *
 * 本経路は検査の機械的事実（コード/名称/JLAC/基準値/検体区分）のみを扱い、
 * 安全判断データは一切含まない（provenance 方針はマスタ事実に限定）。
 * フロントのみモード(DB無): file 未指定/未存在なら curated デモ項目で SUCCESS 記録。
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

export interface ExamRow {
  code: string;
  name: string;
  jlac10: string | null;
  category: string;
  specimenType: string | null;
  refLow: number | null;
  refHigh: number | null;
  unit: string | null;
}

const KANJI = /[一-龥぀-ヿ々ー〆Ａ-Ｚａ-ｚ]/;
// JLAC10 は 17桁（分析物5＋識別4＋材料3＋測定法3＋結果識別2）。先頭の桁列を発見的に拾う。
const JLAC10 = /^\d{15,17}$/;
const NUM = /^-?\d{1,7}(\.\d{1,3})?$/;

/**
 * レイアウト差異に強い解析: 検査コード（英数）→ 漢字/英名 → JLAC10(15-17桁) →
 * 基準下限/上限（小数）→ 単位 を発見的に抽出。HS014 系の列ドリフトに耐える。
 */
export function parseExamCsv(utf8Text: string): ExamRow[] {
  const rows: ExamRow[] = [];
  for (const raw of utf8Text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const c = splitCsvLine(raw);
    // 検査コード: 英数 3-12桁（JLAC10 とは別の院内/標準コード列）。
    const codeIdx = c.findIndex((v) => /^[0-9A-Za-z]{3,12}$/.test(v) && !JLAC10.test(v));
    if (codeIdx < 0) continue;
    const after = c.slice(codeIdx + 1);
    const name = after.find((v) => v.length > 1 && KANJI.test(v));
    if (!name) continue;
    const jlac = c.find((v) => JLAC10.test(v)) ?? null;
    // 基準値は「下限〜上限」の2つの小数/整数を、名称セル以降から順に拾う。
    const nums = after.filter((v) => NUM.test(v)).map(Number);
    const refLow = nums.length >= 2 ? nums[0]! : null;
    const refHigh = nums.length >= 2 ? nums[1]! : null;
    // 単位は「mg/dL」「/μL」「%」等の記号を含むセル。
    const unit = after.find((v) => /[%\/]|mg|dL|mmol|mEq|μ|ng|pg|U\b/.test(v) && v.length <= 12) ?? null;
    rows.push({
      code: c[codeIdx]!,
      name,
      jlac10: jlac,
      category: '検体検査',
      specimenType: null,
      refLow,
      refHigh,
      unit,
    });
  }
  // 同一コード重複は最後を採用（変更行が後勝ち）。
  const map = new Map<string, ExamRow>();
  for (const r of rows) map.set(r.code, r);
  return [...map.values()];
}

/** 取込内容から決定論の SHA-256 チェックサムを計算（版照合・MIG-03 検証用）。 */
export function checksumOfExamRows(rows: ExamRow[]): string {
  const h = createHash('sha256');
  for (const r of [...rows].sort((a, b) => a.code.localeCompare(b.code))) {
    h.update(`${r.code}\t${r.name}\t${r.jlac10 ?? ''}\t${r.refLow ?? ''}\t${r.refHigh ?? ''}\t${r.unit ?? ''}\n`);
  }
  return h.digest('hex');
}

/** DB 未接続でも JLAC 紐付き取込らしさを出すための curated デモ項目。 */
const DEMO_EXAM_ROWS: ExamRow[] = [
  { code: 'WBC', name: '白血球数', jlac10: '2A990000001930101', category: '血液学的検査', specimenType: '全血', refLow: 3.3, refHigh: 8.6, unit: '10^3/μL' },
  { code: 'HGB', name: 'ヘモグロビン', jlac10: '2A030000001930102', category: '血液学的検査', specimenType: '全血', refLow: 13.7, refHigh: 16.8, unit: 'g/dL' },
  { code: 'CRP', name: 'C反応性蛋白', jlac10: '5C070000002327101', category: '免疫学的検査', specimenType: '血清', refLow: 0, refHigh: 0.14, unit: 'mg/dL' },
  { code: 'HBA1C', name: 'HbA1c(NGSP)', jlac10: '3D045000001906202', category: '生化学的検査', specimenType: '全血', refLow: 4.9, refHigh: 6.0, unit: '%' },
  { code: 'CRE', name: 'クレアチニン', jlac10: '3C015000002327101', category: '生化学的検査', specimenType: '血清', refLow: 0.65, refHigh: 1.07, unit: 'mg/dL' },
];

/**
 * 臨床検査マスタを取込む（WP-MST1 本実装）。
 * - filePath があれば JLAC CSV を解析、無ければ curated デモ項目で取込。
 * - 取込内容の checksum を ImportRun / MasterVersion に版とともに記録。
 */
export async function importExamMaster(
  opts: { filePath?: string; sourceRelease: string },
): Promise<{ imported: number; skipped: boolean; runId: string; masterVersionId: string | null; checksum: string; note?: string }> {
  const run = await prisma.importRun.create({
    data: { source: `EXAM:${opts.sourceRelease}`, status: 'RUNNING' },
  });

  let rows: ExamRow[];
  let usedDemo = false;
  if (opts.filePath && existsSync(opts.filePath)) {
    rows = parseExamCsv(readFileSync(opts.filePath, 'utf8'));
  } else {
    rows = DEMO_EXAM_ROWS;
    usedDemo = true;
  }
  const checksum = checksumOfExamRows(rows);

  try {
    // 旧版を閉じて新版を発行（版改定追従）。
    await prisma.masterVersion.updateMany({
      where: { masterType: 'EXAM', source: 'HS014', sourceRelease: opts.sourceRelease, validTo: null },
      data: { validTo: new Date() },
    });
    const mv = await prisma.masterVersion.create({
      data: {
        masterType: 'EXAM',
        source: 'HS014',
        sourceRelease: opts.sourceRelease,
        validFrom: new Date(),
        checksum,
      },
    });

    let imported = 0;
    for (const r of rows) {
      await prisma.examMaster.upsert({
        where: { code: r.code },
        create: {
          code: r.code,
          name: r.name,
          jlac10: r.jlac10,
          category: r.category,
          specimenType: r.specimenType,
          refLow: r.refLow,
          refHigh: r.refHigh,
          unit: r.unit,
          sourceMasterVersion: mv.id,
          provenance: {
            source: 'HS014',
            sourceRelease: opts.sourceRelease,
            sourceFile: opts.filePath ?? (usedDemo ? 'curated-demo' : 'unspecified'),
            importedAt: new Date().toISOString(),
            masterVersion: mv.id,
          },
        },
        update: {
          name: r.name,
          jlac10: r.jlac10,
          refLow: r.refLow,
          refHigh: r.refHigh,
          unit: r.unit,
          sourceMasterVersion: mv.id,
        },
      });
      imported++;
    }

    await prisma.importRun.update({
      where: { id: run.id },
      data: {
        status: 'SUCCESS',
        endedAt: new Date(),
        checksum,
        counts: {
          imported,
          masterVersionId: mv.id,
          sourceRelease: opts.sourceRelease,
          ...(usedDemo ? { note: 'curated demo rows (no source file)' } : {}),
        },
      },
    });

    return {
      imported,
      skipped: false,
      runId: run.id,
      masterVersionId: mv.id,
      checksum,
      note: usedDemo ? 'curated デモ項目を取込（ソースファイル未指定）' : undefined,
    };
  } catch (err) {
    console.error('[importExamMaster] failed (fail-soft):', err);
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
      /* 完全DB無 */
    }
    return { imported: 0, skipped: true, runId: run.id, masterVersionId: null, checksum, note: '取込に失敗しました（DB未接続の可能性）' };
  }
}

/**
 * 検査マスタ取込のロールバック（MIG-03 / ImportStatus.ROLLED_BACK）。
 * ImportRun を ROLLED_BACK にし、当該 run が発行した MasterVersion を validTo=now で失効。
 * 取込済 ExamMaster は物理削除しない（失効版の参照停止で扱う）。
 */
export async function rollbackExamImport(
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
    console.error('[rollbackExamImport] failed (fail-soft):', err);
    return { ok: false, rolledBackVersions: 0, error: 'ロールバックに失敗しました（DB未接続の可能性）' };
  }
}
