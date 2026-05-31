'use server';
import { revalidatePath } from 'next/cache';
import { prisma, type JobType } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { requireSession } from '@/lib/session';

/**
 * シェーマ（手描き＋人体図ライブラリ）— FR-CHT-04 / 174項 17。
 * 人体図ライブラリ(public/schema-library)を背景に手描き注釈し、
 * NoteAttachment(kind=SCHEMA, libraryRef=図ID) としてカルテ記載に添付する。
 *
 * DB未接続(フロントのみモード)でも画面が出るよう、全アクションは
 * try/catch で fail-soft・null安全に倒す。
 */

export interface SchemaPatientOption {
  encounterId: string;
  patientId: string;
  patientNo: string;
  name: string;
  deptName: string;
}

/** 受付中の患者(=添付先カルテ候補)を取得。DB無のときは空配列で画面を成立させる。 */
export async function listSchemaTargets(): Promise<SchemaPatientOption[]> {
  try {
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const today = await prisma.encounter.findMany({
      where: { createdAt: { gte: dayStart } },
      orderBy: { createdAt: 'desc' },
      take: 40,
      include: { patient: true },
    });
    // 当日受付が無ければ直近の受診で代替(デモ/検証用に画面を空にしない)。
    const rows =
      today.length > 0
        ? today
        : await prisma.encounter.findMany({
            orderBy: { createdAt: 'desc' },
            take: 40,
            include: { patient: true },
          });
    // Encounter に department リレーションが無いため id→名称を別引きで解決。
    const deptIds = [...new Set(rows.map((e) => e.departmentId))];
    const depts = deptIds.length
      ? await prisma.department.findMany({
          where: { id: { in: deptIds } },
          select: { id: true, name: true },
        })
      : [];
    const deptName = new Map(depts.map((d) => [d.id, d.name]));
    return rows.map((e) => ({
      encounterId: e.id,
      patientId: e.patientId,
      patientNo: e.patient.patientNo,
      name: `${e.patient.kanjiLastName} ${e.patient.kanjiFirstName}`,
      deptName: deptName.get(e.departmentId) ?? '—',
    }));
  } catch (err) {
    console.error('[schema] listSchemaTargets failed; returning empty:', err);
    return [];
  }
}

export interface SchemaAttachmentRow {
  id: string;
  libraryRef: string | null;
  caption: string | null;
  strokes: string | null;
  noteVersion: number;
  recordedDate: string;
}

/** 指定患者に紐づく保存済シェーマ一覧（版管理に追随＝最新ノート優先で新しい順）。 */
export async function listPatientSchemas(patientId: string): Promise<SchemaAttachmentRow[]> {
  if (!patientId) return [];
  try {
    const attachments = await prisma.noteAttachment.findMany({
      where: { kind: 'SCHEMA', note: { patientId } },
      orderBy: { id: 'desc' },
      take: 30,
      include: { note: { select: { version: true, recordedDate: true } } },
    });
    return attachments.map((a) => ({
      id: a.id,
      libraryRef: a.libraryRef,
      caption: a.caption,
      strokes: a.refId,
      noteVersion: a.note.version,
      recordedDate: a.note.recordedDate.toISOString(),
    }));
  } catch (err) {
    console.error('[schema] listPatientSchemas failed; returning empty:', err);
    return [];
  }
}

/** 添付先となる当日のPROGRESSノートを取得 or 生成（chart/[encounterId] と同方針）。 */
async function ensureProgressNote(encounterId: string, userId: string, jobType: string) {
  const enc = await prisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
  const existing = await prisma.clinicalNote.findFirst({
    where: { encounterId, noteType: 'PROGRESS', isLatest: true },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) return existing;

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const session =
    (await prisma.clinicalSession.findFirst({
      where: { encounterId, recordedDate: { gte: dayStart } },
      orderBy: { createdAt: 'desc' },
    })) ??
    (await prisma.clinicalSession.create({
      data: {
        encounterId,
        recordedDate: new Date(),
        departmentId: enc.departmentId,
        createdByUserId: userId,
      },
    }));

  return prisma.clinicalNote.create({
    data: {
      sessionId: session.id,
      encounterId,
      patientId: enc.patientId,
      noteType: 'PROGRESS',
      recordedDate: new Date(),
      authorUserId: userId,
      authorJobType: jobType as JobType,
      departmentId: enc.departmentId,
      blocks: [
        { kind: 'O', spans: [{ text: '［シェーマ］所見図に注釈（別添）。' }] },
      ] as object,
      status: 'SAVED',
    },
  });
}

export interface SaveSchemaInput {
  encounterId: string;
  /** public/schema-library 内の図ID（人体図ライブラリ参照）。手描きのみは null 可。 */
  libraryRef: string | null;
  /** SchemaCanvas の onChange が返す SchemaStroke[] のJSON文字列。 */
  strokes: string;
  caption?: string;
}

/**
 * 手描き注釈付き人体図をカルテ記載に添付保存する。
 * 完了条件: 人体図検索→注釈保存（NoteAttachment kind=SCHEMA）。
 */
export async function saveSchema(input: SaveSchemaInput) {
  const s = await requireSession();
  if (!input.encounterId) {
    return { ok: false as const, error: '添付先の患者（受診）を選択してください' };
  }
  // 注釈も背景も無い空シェーマは保存しない。
  let hasStrokes = false;
  try {
    const parsed = JSON.parse(input.strokes || '[]');
    hasStrokes = Array.isArray(parsed) && parsed.length > 0;
  } catch {
    hasStrokes = false;
  }
  if (!hasStrokes && !input.libraryRef) {
    return { ok: false as const, error: '人体図を選ぶか、注釈を描いてから保存してください' };
  }

  try {
    const note = await ensureProgressNote(input.encounterId, s.userId, s.jobType);
    const sortOrder = await prisma.noteAttachment.count({ where: { noteId: note.id } });
    const attachment = await prisma.noteAttachment.create({
      data: {
        noteId: note.id,
        kind: 'SCHEMA',
        libraryRef: input.libraryRef ?? null,
        // 注釈ストロークJSONを格納（NoteAttachment に専用本文列が無いため refId を利用）。
        refId: input.strokes || '[]',
        caption: input.caption?.trim() || null,
        sortOrder,
      },
    });
    const enc = await prisma.encounter.findUnique({
      where: { id: input.encounterId },
      select: { patientId: true },
    });
    await writeAudit({
      actorUserId: s.userId,
      patientId: enc?.patientId ?? null,
      action: 'CHART_WRITE',
      resource: 'NoteAttachment.schema',
      resourceId: attachment.id,
      detail: { noteId: note.id, libraryRef: input.libraryRef ?? null },
    });
    revalidatePath('/chart/schema');
    revalidatePath(`/chart/${input.encounterId}`);
    return { ok: true as const, attachmentId: attachment.id, noteId: note.id };
  } catch (err) {
    console.error('[schema] saveSchema failed:', err);
    return { ok: false as const, error: '保存に失敗しました（DB未接続の可能性）' };
  }
}
