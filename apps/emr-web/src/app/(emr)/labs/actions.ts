'use server';
import { revalidatePath } from 'next/cache';
import { prisma, type JobType } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import {
  judgeLabFlag,
  emptySoap,
  planAmendment,
  type SoapBlock,
} from '@medixus/domain';
import { requireSession } from '@/lib/session';

/**
 * FR-LAB-01 検査結果 — 手入力での結果登録（取込は IF-EXT-04 連携で別途）。
 * 値・単位・基準値を受け、ExamMaster.refLow/refHigh（あれば優先）で H/L 判定して格納する。
 * 確定結果は追記専用（LabResult は append-only 運用）。
 */
export async function addLabResult(formData: FormData) {
  const s = await requireSession();
  const patientId = String(formData.get('patientId') || '');
  const examCode = String(formData.get('examCode') || '').trim();
  const examName = String(formData.get('examName') || '').trim();
  const rawValue = String(formData.get('value') || '').trim();
  const valueText = String(formData.get('valueText') || '').trim() || null;
  const unitInput = String(formData.get('unit') || '').trim() || null;
  const refLowInput = parseNum(formData.get('refLow'));
  const refHighInput = parseNum(formData.get('refHigh'));
  const collectedAtStr = String(formData.get('collectedAt') || '').trim();
  if (!patientId || (!examCode && !examName)) return;

  const value = parseNum(rawValue);

  try {
    // ExamMaster 紐付け（コード一致を優先）。基準値・単位はマスタ値を既定にする。
    const master = examCode
      ? await prisma.examMaster.findUnique({ where: { code: examCode } })
      : await prisma.examMaster.findFirst({ where: { name: examName } });

    const refLow = refLowInput ?? master?.refLow ?? null;
    const refHigh = refHighInput ?? master?.refHigh ?? null;
    const unit = unitInput ?? master?.unit ?? null;
    const flag = judgeLabFlag(value, refLow, refHigh);

    const created = await prisma.labResult.create({
      data: {
        patientId,
        examMasterId: master?.id ?? null,
        value: value ?? null,
        valueText,
        unit,
        refLow,
        refHigh,
        flag: flag ?? null,
        collectedAt: collectedAtStr ? new Date(collectedAtStr) : new Date(),
        resultedAt: new Date(),
        status: 'FINAL',
        provenance: { source: 'MANUAL_ENTRY', enteredByUserId: s.userId, examName: master?.name ?? examName },
      },
    });
    await writeAudit({
      actorUserId: s.userId,
      patientId,
      action: 'CHART_WRITE',
      resource: 'LabResult',
      resourceId: created.id,
      detail: { examName: master?.name ?? examName, value, flag },
    });
    revalidatePath(`/labs?patientId=${patientId}`);
  } catch (err) {
    // DB 未接続でもフォームは壊さない（フロントのみモード）。
    console.error('[labs.addLabResult] failed:', err);
  }
}

/**
 * 検査結果のO欄転記（AC(3)）— 整形済みの検査所見を当該患者の「当日の進行中エンカウンタ」
 * の最新カルテ O 欄へ追記する。対象がなければ静かに失敗（フロントのみモードでも安全）。
 * カルテ本体の電子保存原則に従い、新版を作らず当日 EDITING/SAVED の記載へ追記する想定。
 */
export async function transcribeLabsToNote(patientId: string, oText: string) {
  const s = await requireSession();
  const text = (oText || '').trim();
  if (!patientId || !text) return { ok: false, error: '転記内容がありません' };

  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    // 当日の進行中（受付/診察中）エンカウンタを優先。
    const enc = await prisma.encounter.findFirst({
      where: { patientId, receptionStatus: { in: ['IN_CONSULTATION', 'ARRIVED', 'READY'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!enc) {
      return { ok: false, error: '転記先の診察（本日の受付・診察中）が見つかりません。カルテ画面のO欄へコピー転記してください。' };
    }

    const latest = await prisma.clinicalNote.findFirst({
      where: { encounterId: enc.id, isLatest: true, noteType: 'PROGRESS' },
      orderBy: { createdAt: 'desc' },
    });

    const blocks: SoapBlock[] = latest
      ? (latest.blocks as unknown as SoapBlock[])
      : emptySoap();
    const next = appendToO(blocks, text);

    let noteId: string;
    if (latest) {
      // 既存の最新版があれば新版を追記（append-only 真正性: 旧版は SUPERSEDED で保持）。
      // content UPDATE はトリガで禁止のため必ず新規 INSERT + メタ更新で行う。
      const plan = planAmendment({
        id: latest.id,
        version: latest.version,
        rootNoteId: latest.rootNoteId,
        status: latest.status,
        lockedAt: latest.lockedAt,
      });
      const note = await prisma.clinicalNote.create({
        data: {
          sessionId: latest.sessionId,
          encounterId: enc.id,
          patientId,
          noteType: 'PROGRESS',
          recordedDate: new Date(),
          authorUserId: s.userId,
          authorJobType: s.jobType as JobType,
          departmentId: enc.departmentId,
          blocks: next as object,
          status: 'SAVED',
          version: plan.next.version,
          rootNoteId: plan.next.rootNoteId,
          previousVersionId: latest.id,
          amendReason: '検査結果のO欄転記',
        },
      });
      await prisma.clinicalNote.update({
        where: { id: latest.id },
        data: { isLatest: false, status: 'SUPERSEDED', supersededById: note.id },
      });
      noteId = note.id;
    } else {
      // 当日記載がまだ無ければセッションを用意して新規記載を起票。
      const session = await sessionForEncounter(enc.id, enc.departmentId, s.userId, start);
      const note = await prisma.clinicalNote.create({
        data: {
          sessionId: session.id,
          encounterId: enc.id,
          patientId,
          noteType: 'PROGRESS',
          recordedDate: new Date(),
          authorUserId: s.userId,
          authorJobType: s.jobType as JobType,
          departmentId: enc.departmentId,
          blocks: next as object,
          status: 'SAVED',
        },
      });
      noteId = note.id;
    }

    await writeAudit({
      actorUserId: s.userId,
      patientId,
      action: 'CHART_WRITE',
      resource: 'ClinicalNote.labTranscribe',
      resourceId: noteId,
      detail: { encounterId: enc.id },
    });
    revalidatePath(`/labs?patientId=${patientId}`);
    revalidatePath(`/chart/${enc.id}`);
    return { ok: true };
  } catch (err) {
    console.error('[labs.transcribeLabsToNote] failed:', err);
    return { ok: false, error: 'O欄転記に失敗しました（DB未接続の可能性）。カルテ画面でコピー転記してください。' };
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function parseNum(v: FormDataEntryValue | string | null): number | null {
  if (v === null || v === undefined) return null;
  const str = typeof v === 'string' ? v : String(v);
  if (str.trim() === '') return null;
  const n = Number(str);
  return Number.isFinite(n) ? n : null;
}

async function sessionForEncounter(
  encounterId: string,
  departmentId: string,
  userId: string,
  dayStart: Date,
) {
  const existing = await prisma.clinicalSession.findFirst({
    where: { encounterId, recordedDate: { gte: dayStart } },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) return existing;
  return prisma.clinicalSession.create({
    data: { encounterId, recordedDate: new Date(), departmentId, createdByUserId: userId },
  });
}

/** O ブロックへ1行追記（無ければ新設）。他ブロックは温存。 */
function appendToO(blocks: SoapBlock[], text: string): SoapBlock[] {
  const has = blocks.some((b) => b.kind === 'O');
  const apply = (cur: string) => (cur.trim() ? `${cur}\n${text}` : text);
  const next = blocks.map((b) =>
    b.kind === 'O' ? { kind: 'O' as const, spans: [{ text: apply(b.spans.map((s) => s.text).join('')) }] } : b,
  );
  return has ? next : [...next, { kind: 'O', spans: [{ text }] }];
}
