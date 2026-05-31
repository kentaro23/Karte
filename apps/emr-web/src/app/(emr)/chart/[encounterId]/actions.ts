'use server';
import { revalidatePath } from 'next/cache';
import { prisma, type JobType } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import {
  planAmendment,
  formatOrderNo,
  buildDoOrder,
  type SoapBlock,
  type SoapKind,
  type OrderType,
} from '@medixus/domain';
import { runPrescriptionChecks } from '@medixus/order-checks';
import { requireSession } from '@/lib/session';

async function sessionForEncounter(encounterId: string, userId: string) {
  const enc = await prisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const existing = await prisma.clinicalSession.findFirst({
    where: { encounterId, recordedDate: { gte: start } },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) return { enc, session: existing };
  const session = await prisma.clinicalSession.create({
    data: {
      encounterId,
      recordedDate: new Date(),
      departmentId: enc.departmentId,
      createdByUserId: userId,
    },
  });
  return { enc, session };
}

export async function saveSoap(encounterId: string, blocks: SoapBlock[]) {
  const s = await requireSession();
  const { enc, session } = await sessionForEncounter(encounterId, s.userId);
  const note = await prisma.clinicalNote.create({
    data: {
      sessionId: session.id,
      encounterId,
      patientId: enc.patientId,
      noteType: 'PROGRESS',
      recordedDate: new Date(),
      authorUserId: s.userId,
      authorJobType: s.jobType as JobType,
      departmentId: enc.departmentId,
      blocks: blocks as object,
      status: 'SAVED',
    },
  });
  const find = (k: string) =>
    blocks.find((b) => b.kind === k)?.spans.map((x) => x.text).join('') ?? '';
  await prisma.clinicalRecord.upsert({
    where: { sessionId: session.id },
    create: {
      sessionId: session.id,
      status: 'draft',
      s: find('S'),
      o: find('O'),
      a: find('A'),
      p: find('P'),
    },
    update: { s: find('S'), o: find('O'), a: find('A'), p: find('P') },
  });
  if (enc.receptionStatus === 'READY' || enc.receptionStatus === 'ARRIVED') {
    await prisma.encounter.update({
      where: { id: encounterId },
      data: { receptionStatus: 'IN_CONSULTATION' },
    });
  }
  await writeAudit({
    actorUserId: s.userId,
    patientId: enc.patientId,
    action: 'CHART_WRITE',
    resource: 'ClinicalNote',
    resourceId: note.id,
  });
  revalidatePath(`/chart/${encounterId}`);
  return { ok: true, noteId: note.id };
}

export async function lockNote(encounterId: string, noteId: string) {
  const s = await requireSession();
  await prisma.clinicalNote.update({
    where: { id: noteId },
    data: { status: 'LOCKED', lockedAt: new Date() },
  });
  await writeAudit({
    actorUserId: s.userId,
    action: 'CHART_WRITE',
    resource: 'ClinicalNote.lock',
    resourceId: noteId,
  });
  revalidatePath(`/chart/${encounterId}`);
  return { ok: true };
}

/** 改版: append a new version, supersede the old one (electronic-preservation真正性). */
export async function amendNote(encounterId: string, noteId: string, blocks: SoapBlock[], reason: string) {
  const s = await requireSession();
  const cur = await prisma.clinicalNote.findUniqueOrThrow({ where: { id: noteId } });
  const plan = planAmendment({
    id: cur.id,
    version: cur.version,
    rootNoteId: cur.rootNoteId,
    status: cur.status,
    lockedAt: cur.lockedAt,
  });
  const created = await prisma.clinicalNote.create({
    data: {
      sessionId: cur.sessionId,
      encounterId: cur.encounterId,
      patientId: cur.patientId,
      noteType: cur.noteType,
      recordedDate: new Date(),
      authorUserId: s.userId,
      authorJobType: s.jobType as JobType,
      departmentId: cur.departmentId,
      blocks: blocks as object,
      version: plan.next.version,
      rootNoteId: plan.next.rootNoteId,
      previousVersionId: cur.id,
      isLatest: true,
      status: 'SAVED',
      amendReason: reason,
    },
  });
  await prisma.clinicalNote.update({
    where: { id: cur.id },
    data: { isLatest: false, status: 'SUPERSEDED', supersededById: created.id },
  });
  await writeAudit({
    actorUserId: s.userId,
    patientId: cur.patientId,
    action: 'CHART_AMEND',
    resource: 'ClinicalNote',
    resourceId: created.id,
    detail: { from: cur.id, version: created.version, reason },
  });
  revalidatePath(`/chart/${encounterId}`);
  return { ok: true, noteId: created.id };
}

export interface RxItemInput {
  drugProductId: string;
  drugName: string;
  dosePerTime: number;
  doseUnit: string;
  timesPerDay: number;
  days: number;
  route: string;
  usage?: string;
}

export interface RxOptions {
  dispenseType?: 'IN_HOUSE' | 'OUT_OF_HOUSE';
  oneDose?: boolean; // 一包化
  genericOk?: boolean; // 後発医薬品への変更可
}

export async function addPrescription(
  encounterId: string,
  items: RxItemInput[],
  opts: RxOptions = {},
) {
  const s = await requireSession();
  const enc = await prisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const seq = (await prisma.order.count({ where: { createdAt: { gte: dayStart } } })) + 1;
  const dispenseType = opts.dispenseType ?? 'IN_HOUSE';
  const order = await prisma.order.create({
    data: {
      orderNo: formatOrderNo(new Date(), seq),
      patientId: enc.patientId,
      encounterId,
      orderType: 'RX',
      classification: dispenseType === 'OUT_OF_HOUSE' ? 'OUTPATIENT_OUT' : 'OUTPATIENT_IN_HOUSE',
      departmentId: enc.departmentId,
      ordererUserId: s.userId,
      status: 'DRAFT',
      detail: {
        items,
        oneDose: opts.oneDose ?? false,
        genericOk: opts.genericOk ?? false,
        dispenseType,
      } as object,
    },
  });
  const rx = await prisma.prescription.create({
    data: {
      orderId: order.id,
      patientId: enc.patientId,
      encounterId,
      status: 'proposed',
      dispenseType,
      issuedByUserId: s.userId,
      items: {
        create: items.map((i) => ({
          drugProductId: i.drugProductId,
          dosePerTime: i.dosePerTime,
          doseUnit: i.doseUnit,
          timesPerDay: i.timesPerDay,
          days: i.days,
          route: i.route,
          comment: i.usage ?? null,
        })),
      },
    },
  });
  await writeAudit({
    actorUserId: s.userId,
    patientId: enc.patientId,
    action: 'ORDER_ISSUE',
    resource: 'Prescription',
    resourceId: rx.id,
  });
  const summary = await runPrescriptionChecks(rx.id);
  await writeAudit({
    actorUserId: s.userId,
    patientId: enc.patientId,
    action: 'ORDER_CHECK',
    resource: 'Prescription',
    resourceId: rx.id,
    result: summary.overall,
    detail: { findings: summary.findings.length },
  });
  revalidatePath(`/chart/${encounterId}`);
  return { prescriptionId: rx.id, ...summary };
}

export async function confirmPrescription(
  encounterId: string,
  prescriptionId: string,
  overrides: { ruleCheckResultId: string; reason: string }[],
) {
  const s = await requireSession();
  const checks = await prisma.ruleCheckResult.findMany({ where: { prescriptionId } });
  const latestRun = checks
    .map((c) => (c.details as { runId?: string })?.runId ?? '')
    .sort()
    .at(-1);
  const blocked = checks.filter(
    (c) => c.result === 'BLOCKED' && ((c.details as { runId?: string })?.runId ?? '') === latestRun,
  );
  const overriddenIds = new Set(overrides.map((o) => o.ruleCheckResultId));
  const missing = blocked.filter((b) => !overriddenIds.has(b.id));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `禁忌・極量超過等のブロック ${missing.length} 件が未解決です。理由を入力して解除してください。`,
    };
  }
  for (const o of overrides) {
    if (!o.reason || o.reason.trim().length < 3) {
      return { ok: false, error: 'オーバーライド理由は必須です（3文字以上）' };
    }
    await prisma.prescriptionOverride.create({
      data: {
        prescriptionId,
        ruleCheckResultId: o.ruleCheckResultId,
        overriddenByUserId: s.userId,
        reason: o.reason,
      },
    });
    await writeAudit({
      actorUserId: s.userId,
      action: 'PRESCRIPTION_OVERRIDE',
      resource: 'RuleCheckResult',
      resourceId: o.ruleCheckResultId,
      detail: { reason: o.reason },
    });
  }
  const rx = await prisma.prescription.update({
    where: { id: prescriptionId },
    data: { status: 'doctor_confirmed', issuedAt: new Date() },
  });
  await prisma.order.update({ where: { id: rx.orderId }, data: { status: 'REQUESTED' } });
  await writeAudit({
    actorUserId: s.userId,
    action: 'ORDER_ISSUE',
    resource: 'Prescription.confirm',
    resourceId: prescriptionId,
  });
  revalidatePath(`/chart/${encounterId}`);
  return { ok: true };
}

/* ── 病名（診断名）: カルテから 選択 / 自由記述 ── */

export async function searchDiseases(q: string) {
  const term = q.trim();
  if (term.length < 1) return [];
  const rows = await prisma.diseaseMaster.findMany({
    where: {
      OR: [{ name: { contains: term } }, { code: { contains: term } }],
    },
    take: 40,
    orderBy: { name: 'asc' },
    select: { code: true, name: true, icd10: true },
  });
  return rows.map((r) => ({ code: r.code, name: r.name, icd10: r.icd10[0] ?? '' }));
}

export async function addChartDiagnosis(
  encounterId: string,
  input: {
    masterCode?: string | null;
    displayName: string;
    icd10?: string | null;
    isMain?: boolean;
    isSuspected?: boolean;
  },
) {
  const s = await requireSession();
  const name = input.displayName.trim();
  if (!name) return { ok: false, error: '病名を入力してください' };
  const enc = await prisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
  const dx = await prisma.patientDiagnosis.create({
    data: {
      patientId: enc.patientId,
      encounterId,
      masterCode: input.masterCode ?? null,
      displayName: name,
      icd10: input.icd10 || null,
      departmentId: enc.departmentId,
      isMain: input.isMain ?? false,
      isSuspected: input.isSuspected ?? false,
      status: 'ACTIVE',
      recordedByUserId: s.userId,
    },
  });
  await writeAudit({
    actorUserId: s.userId,
    patientId: enc.patientId,
    action: 'CHART_WRITE',
    resource: 'PatientDiagnosis',
    resourceId: dx.id,
    detail: { name, icd10: input.icd10 ?? null, source: input.masterCode ? 'master' : 'free-text' },
  });
  revalidatePath(`/chart/${encounterId}`);
  return { ok: true };
}

export async function removeDiagnosis(encounterId: string, id: string) {
  const s = await requireSession();
  const dx = await prisma.patientDiagnosis.update({
    where: { id },
    data: { status: 'DELETED' },
  });
  await writeAudit({
    actorUserId: s.userId,
    patientId: dx.patientId,
    action: 'CHART_WRITE',
    resource: 'PatientDiagnosis.delete',
    resourceId: id,
  });
  revalidatePath(`/chart/${encounterId}`);
  return { ok: true };
}

/* ── 過去カルテ参照・セクションDo（FR-CHT-05） ── */

/**
 * 前回SOAPのセクションを当日カルテへコピーした事実を監査に残す（出所トレース）。
 * 実際の本文反映はエディタ側の blocks へ行い `saveSoap` で永続化する。
 */
export async function traceSectionDo(
  encounterId: string,
  source: { noteId: string | null; date: string; kind: SoapKind },
) {
  try {
    const s = await requireSession();
    const enc = await prisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
    await writeAudit({
      actorUserId: s.userId,
      patientId: enc.patientId,
      action: 'CHART_WRITE',
      resource: 'ClinicalNote.sectionDo',
      resourceId: source.noteId ?? encounterId,
      detail: { kind: source.kind, fromNoteId: source.noteId, fromDate: source.date },
    });
    return { ok: true };
  } catch (err) {
    console.error('[traceSectionDo] failed:', err);
    return { ok: false };
  }
}

/**
 * 前回オーダをDoで当日に複製（buildDoOrder で内容コピー、新規DRAFTオーダとして起票）。
 * 出所は `doSourceOrderId` に保持しトレース可能にする。
 */
export async function doOrderSection(encounterId: string, sourceOrderId: string) {
  try {
    const s = await requireSession();
    const enc = await prisma.encounter.findUniqueOrThrow({ where: { id: encounterId } });
    const src = await prisma.order.findUniqueOrThrow({ where: { id: sourceOrderId } });
    const cloned = buildDoOrder({
      id: src.id,
      orderType: src.orderType as OrderType,
      departmentId: enc.departmentId,
      detail: src.detail,
    });
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const seq = (await prisma.order.count({ where: { createdAt: { gte: dayStart } } })) + 1;
    const order = await prisma.order.create({
      data: {
        orderNo: formatOrderNo(new Date(), seq),
        patientId: enc.patientId,
        encounterId,
        orderType: cloned.orderType,
        classification: src.classification,
        departmentId: cloned.departmentId,
        ordererUserId: s.userId,
        status: cloned.status,
        detail: cloned.detail as object,
        doSourceOrderId: cloned.doSourceOrderId,
        version: cloned.version,
        isLatest: cloned.isLatest,
      },
    });
    await writeAudit({
      actorUserId: s.userId,
      patientId: enc.patientId,
      action: 'ORDER_ISSUE',
      resource: 'Order.do',
      resourceId: order.id,
      detail: { doSourceOrderId: sourceOrderId, orderType: cloned.orderType },
    });
    revalidatePath(`/chart/${encounterId}`);
    return { ok: true, orderId: order.id, orderNo: order.orderNo };
  } catch (err) {
    console.error('[doOrderSection] failed:', err);
    return { ok: false, error: 'Doオーダの起票に失敗しました' };
  }
}
