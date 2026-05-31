'use server';
import { revalidatePath } from 'next/cache';
import { isDemoMode } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import {
  importFullDrugMaster,
  rollbackDrugImport,
  importExamMaster,
  rollbackExamImport,
  importDiseaseMaster,
} from '@medixus/master-import';
import { requireSession } from '@/lib/session';

/* ──────────────────────────────────────────────────────────────────────────
   マスタ管理 — 取込実行 / 版・チェックサム記録 / ロールバック（WP-MST1）
   対象FR 174:161-165 / OPS-03 / MIG-02 / MIG-03。

   - 取込本体は @medixus/master-import に集約済（医薬品全量・点数改定追従・検査JLAC・病名）。
   - 取込実行・ロールバックを AuditEvent(MASTER_IMPORT) で記録（追記専用・ハッシュ連鎖）。
   - フロントのみモード(DB無)でも壊れないよう全 try/catch・fail-soft。
     デモ時はマスタ取込ライブラリが curated 行で SUCCESS を返すため、画面で結果提示できる。
   ────────────────────────────────────────────────────────────────────────── */

export interface ImportActionResult {
  ok: boolean;
  error?: string;
  /** 取込件数（医薬品/検査/病名）。 */
  imported?: number;
  /** 点数改定追従モードで薬価が更新された件数。 */
  priceUpdated?: number;
  runId?: string;
  masterVersionId?: string | null;
  checksum?: string;
  note?: string;
}

async function auditImport(
  resource: string,
  resourceId: string | null,
  result: string,
  detail: unknown,
): Promise<void> {
  // 監査は best-effort（DB未接続でも取込結果提示は阻害しない）。
  try {
    const s = await requireSession();
    await writeAudit({
      actorUserId: s.userId,
      action: 'MASTER_IMPORT',
      resource,
      resourceId,
      result,
      detail,
    });
  } catch (err) {
    console.error('[master.auditImport] failed (fail-soft):', err);
  }
}

/**
 * MIG-02 / OPS-03: 医薬品マスタ全量取込（レセ電 ~2万品目）。
 * filePath はサーバ上の絶対パス（運用バッチ）。未指定はライブラリ側で curated デモ取込。
 */
export async function runFullDrugImport(formData: FormData): Promise<ImportActionResult> {
  const sourceRelease = String(formData.get('sourceRelease') || '').trim() || defaultRelease();
  const filePath = String(formData.get('filePath') || '').trim() || undefined;
  const revisionOnly = String(formData.get('revisionOnly') || '') === 'on';
  try {
    const res = await importFullDrugMaster({ sourceRelease, filePath, revisionOnly });
    await auditImport('DrugMaster', res.runId, res.skipped ? 'SKIPPED' : 'OK', {
      sourceRelease,
      mode: revisionOnly ? 'REVISION' : 'FULL',
      imported: res.imported,
      priceUpdated: res.priceUpdated,
      masterVersionId: res.masterVersionId,
      checksum: res.checksum,
      demo: isDemoMode,
    });
    revalidatePath('/master');
    return {
      ok: !res.skipped || isDemoMode,
      imported: res.imported,
      priceUpdated: res.priceUpdated,
      runId: res.runId,
      masterVersionId: res.masterVersionId,
      checksum: res.checksum,
      note: res.note,
    };
  } catch (err) {
    console.error('[runFullDrugImport] failed (fail-soft):', err);
    return { ok: false, error: '医薬品マスタ取込に失敗しました（DB未接続の可能性）' };
  }
}

/** MIG-02: 検査マスタ取込（JLAC10/11 紐付け）。 */
export async function runExamImport(formData: FormData): Promise<ImportActionResult> {
  const sourceRelease = String(formData.get('sourceRelease') || '').trim() || defaultRelease();
  const filePath = String(formData.get('filePath') || '').trim() || undefined;
  try {
    const res = await importExamMaster({ sourceRelease, filePath });
    await auditImport('ExamMaster', res.runId, res.skipped ? 'SKIPPED' : 'OK', {
      sourceRelease,
      imported: res.imported,
      masterVersionId: res.masterVersionId,
      checksum: res.checksum,
      demo: isDemoMode,
    });
    revalidatePath('/master');
    return {
      ok: !res.skipped || isDemoMode,
      imported: res.imported,
      runId: res.runId,
      masterVersionId: res.masterVersionId,
      checksum: res.checksum,
      note: res.note,
    };
  } catch (err) {
    console.error('[runExamImport] failed (fail-soft):', err);
    return { ok: false, error: '検査マスタ取込に失敗しました（DB未接続の可能性）' };
  }
}

/** MIG-02: 病名マスタ取込（MEDIS ICD-10対応標準病名）。filePath 未指定時はライブラリが no-op skip。 */
export async function runDiseaseImport(formData: FormData): Promise<ImportActionResult> {
  const sourceRelease = String(formData.get('sourceRelease') || '').trim() || defaultRelease();
  const filePath = String(formData.get('filePath') || '').trim() || undefined;
  try {
    const res = await importDiseaseMaster({ sourceRelease, filePath });
    await auditImport('DiseaseMaster', res.runId, res.skipped ? 'SKIPPED' : 'OK', {
      sourceRelease,
      imported: res.imported,
      demo: isDemoMode,
    });
    revalidatePath('/master');
    return {
      ok: !res.skipped || isDemoMode,
      imported: res.imported,
      runId: res.runId,
      note: res.skipped
        ? 'ソースファイル未指定のため病名は取込されませんでした（MEDIS ZIP/CSV を指定してください）。'
        : undefined,
    };
  } catch (err) {
    console.error('[runDiseaseImport] failed (fail-soft):', err);
    return { ok: false, error: '病名マスタ取込に失敗しました（DB未接続の可能性）' };
  }
}

/** MIG-03: 取込のロールバック。kind=drug|exam で対象マスタを切替。 */
export async function rollbackImport(formData: FormData): Promise<ImportActionResult> {
  const runId = String(formData.get('runId') || '').trim();
  const kind = String(formData.get('kind') || 'drug').trim();
  if (!runId) return { ok: false, error: 'runId が必要です' };
  if (isDemoMode) {
    await auditImport(kind === 'exam' ? 'ExamMaster' : 'DrugMaster', runId, 'ROLLED_BACK', { demo: true });
    return { ok: true, note: '取込をロールバックしました（デモ表示）。当該版を失効扱いにします。' };
  }
  try {
    const res =
      kind === 'exam' ? await rollbackExamImport(runId) : await rollbackDrugImport(runId);
    await auditImport(kind === 'exam' ? 'ExamMaster' : 'DrugMaster', runId, res.ok ? 'ROLLED_BACK' : 'FAILED', {
      rolledBackVersions: res.rolledBackVersions,
      error: res.error,
    });
    revalidatePath('/master');
    return {
      ok: res.ok,
      error: res.error,
      note: res.ok
        ? `取込をロールバックしました（失効版 ${res.rolledBackVersions} 件）。`
        : undefined,
    };
  } catch (err) {
    console.error('[rollbackImport] failed (fail-soft):', err);
    return { ok: false, error: 'ロールバックに失敗しました（DB未接続の可能性）' };
  }
}

/** 既定の取込リリース表記（当年の点数改定 4月起点を初期値に）。 */
function defaultRelease(): string {
  const now = new Date();
  const y = now.getFullYear();
  // 4月改定基準: 4月以降は当年-04、1〜3月は前年-04 を既定とする。
  return now.getMonth() + 1 >= 4 ? `${y}-04` : `${y - 1}-04`;
}
