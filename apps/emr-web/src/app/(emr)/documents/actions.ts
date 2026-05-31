'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { requireSession } from '@/lib/session';
import {
  applyMerge,
  buildMergeMap,
  extractPlaceholders,
  type MergeSource,
  type MergeDiagnosis,
  type MergeMedication,
  type MergeLab,
} from '@/lib/doc-merge';

export async function createDocument(formData: FormData) {
  const s = await requireSession();
  const d = await prisma.clinicalDocument.create({
    data: {
      patientId: String(formData.get('patientId') || '') || null,
      docType: String(formData.get('docType') || '院内文書'),
      title: String(formData.get('title') || '').trim(),
      format: 'TEXT',
      body: String(formData.get('body') || ''),
      createdByUserId: s.userId,
    },
  });
  await writeAudit({ actorUserId: s.userId, action: 'CHART_WRITE', resource: 'ClinicalDocument', resourceId: d.id });
  revalidatePath('/documents');
}

/* ── 退院サマリ（DischargeSummary） ── */

export async function createDischargeSummary(formData: FormData) {
  const s = await requireSession();
  const patientId = String(formData.get('patientId') || '');
  if (!patientId) return;
  const d = await prisma.dischargeSummary.create({
    data: {
      patientId,
      status: 'DRAFT',
      authorUserId: s.userId,
      admissionCourse: String(formData.get('admissionCourse') || ''),
      presentIllness: String(formData.get('presentIllness') || ''),
      hospitalCourse: String(formData.get('hospitalCourse') || ''),
      dischargePlan: String(formData.get('dischargePlan') || ''),
    },
  });
  await writeAudit({
    actorUserId: s.userId,
    patientId,
    action: 'CHART_WRITE',
    resource: 'DischargeSummary',
    resourceId: d.id,
  });
  revalidatePath('/documents');
}

export async function completeDischargeSummary(formData: FormData) {
  const s = await requireSession();
  const id = String(formData.get('id'));
  const d = await prisma.dischargeSummary.update({
    where: { id },
    data: { status: 'COMPLETED' },
  });
  await writeAudit({
    actorUserId: s.userId,
    patientId: d.patientId,
    action: 'CHART_WRITE',
    resource: 'DischargeSummary.complete',
    resourceId: id,
  });
  revalidatePath('/documents');
}

export async function approveDischargeSummary(formData: FormData) {
  const s = await requireSession();
  const id = String(formData.get('id'));
  const d = await prisma.dischargeSummary.update({
    where: { id },
    data: { approvalStatus: 'APPROVED', approverUserId: s.userId, approvedAt: new Date() },
  });
  await writeAudit({
    actorUserId: s.userId,
    patientId: d.patientId,
    action: 'COUNTERSIGN',
    resource: 'DischargeSummary.approve',
    resourceId: id,
  });
  revalidatePath('/documents');
}

/* ─────────────────────────────────────────────────────────────────────────
 * FR-DOC-01 差込テンプレート文書（docx/xlsx）
 * ・医療機関が docx/xlsx テンプレを登録（プレースホルダ {{key}}）
 * ・単一データソース（患者/保険/病名/投薬/検査/プロファイル）から自動差込
 * ・生成文書は ClinicalDocument(templateId, format=WORD/EXCEL) として保管
 * すべて fail-soft（DB 未接続でも画面操作が壊れない＝フロントのみモード）。
 * ───────────────────────────────────────────────────────────────────────── */

const DOC_TEMPLATE_MARK = 'DOC_MERGE';
const DOC_CATEGORY_PREFIX = '差込テンプレ';

export type DocTemplateFormat = 'WORD' | 'EXCEL';

export interface DocTemplateRow {
  id: string;
  name: string;
  docType: string;
  format: DocTemplateFormat;
  body: string;
  placeholders: string[];
  createdAt: string;
}

interface DocTemplateLayout {
  kind: typeof DOC_TEMPLATE_MARK;
  format: DocTemplateFormat;
  docType: string;
  body: string;
}

function asDocLayout(layout: unknown): DocTemplateLayout | null {
  if (!layout || typeof layout !== 'object') return null;
  const l = layout as Record<string, unknown>;
  if (l.kind !== DOC_TEMPLATE_MARK) return null;
  const format = l.format === 'EXCEL' ? 'EXCEL' : 'WORD';
  return {
    kind: DOC_TEMPLATE_MARK,
    format,
    docType: typeof l.docType === 'string' ? l.docType : '院内文書',
    body: typeof l.body === 'string' ? l.body : '',
  };
}

/** 登録済み差込テンプレ一覧（DB 無時は空配列を返し、画面側がサンプルを描く）。 */
export async function listDocTemplates(): Promise<{ templates: DocTemplateRow[]; live: boolean }> {
  try {
    const raw = await prisma.template.findMany({
      where: { category: { startsWith: DOC_CATEGORY_PREFIX } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    const templates: DocTemplateRow[] = [];
    for (const t of raw) {
      const l = asDocLayout(t.layout);
      if (!l) continue; // 差込テンプレ以外は無視（カルテひな形と混在しない）
      templates.push({
        id: t.id,
        name: t.name,
        docType: l.docType,
        format: l.format,
        body: l.body,
        placeholders: extractPlaceholders(l.body),
        createdAt: t.createdAt.toISOString(),
      });
    }
    return { templates, live: true };
  } catch (err) {
    console.error('[documents.listDocTemplates] DB read failed; front-only mode:', err);
    return { templates: [], live: false };
  }
}

/** docx/xlsx テンプレを登録。本文はプレースホルダ {{key}} を含むテキスト（抽出済）。 */
export async function createDocTemplate(formData: FormData) {
  const s = await requireSession();
  const name = String(formData.get('name') || '').trim();
  const docType = String(formData.get('docType') || '院内文書').trim() || '院内文書';
  const format: DocTemplateFormat = String(formData.get('format') || 'WORD') === 'EXCEL' ? 'EXCEL' : 'WORD';
  const body = String(formData.get('body') || '');
  if (!name) return;
  const layout: DocTemplateLayout = { kind: DOC_TEMPLATE_MARK, format, docType, body };
  try {
    const t = await prisma.template.create({
      data: {
        scope: 'COMMON',
        category: `${DOC_CATEGORY_PREFIX}/${docType}`,
        name,
        layout: layout as unknown as object,
      },
    });
    await writeAudit({
      actorUserId: s.userId,
      action: 'CHART_WRITE',
      resource: 'Template.docMerge',
      resourceId: t.id,
      detail: { name, format, docType },
    });
    revalidatePath('/documents');
  } catch (err) {
    console.error('[documents.createDocTemplate] failed (front-only mode):', err);
  }
}

export async function deleteDocTemplate(formData: FormData) {
  const s = await requireSession();
  const id = String(formData.get('id') || '');
  if (!id) return;
  try {
    await prisma.template.delete({ where: { id } });
    await writeAudit({ actorUserId: s.userId, action: 'CHART_WRITE', resource: 'Template.docMerge.delete', resourceId: id });
    revalidatePath('/documents');
  } catch (err) {
    console.error('[documents.deleteDocTemplate] failed:', err);
  }
}

/**
 * 単一データソースから患者の差込ソースを構築（FR-DOC-01 業務ルール: 二重入力ゼロ）。
 * 患者基本 / 住所(プロファイル customFields) / 医療機関 / 未転帰病名 / 直近投薬・検査 /
 * 保険一式(枝番・公費) / バイタル を 1 患者分まとめて取得。DB 無時は null を返す。
 */
async function buildMergeSourceForPatient(patientId: string): Promise<MergeSource | null> {
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    include: { clinic: true, profile: true },
  });
  if (!patient) return null;

  // 住所・電話・英字氏名は PatientProfile.customFields(JSON) に格納される想定（任意）。
  const custom = (patient.profile?.customFields ?? {}) as Record<string, unknown>;
  const cf = (k: string): string | undefined => {
    const v = custom[k];
    return typeof v === 'string' && v.trim() ? v : undefined;
  };

  // 未転帰傷病名（ACTIVE & outcome 未確定）。
  const diagnoses = await prisma.patientDiagnosis.findMany({
    where: { patientId, status: 'ACTIVE', outcome: null },
    orderBy: [{ isMain: 'desc' }, { startDate: 'desc' }],
    take: 20,
  });

  // 直近投薬（最新処方の品目）。
  const meds: MergeMedication[] = [];
  try {
    const rxItems = await prisma.prescriptionItem.findMany({
      where: { prescription: { patientId } },
      include: { drug: true, prescription: true },
      orderBy: { prescription: { createdAt: 'desc' } },
      take: 10,
    });
    for (const it of rxItems) {
      meds.push({
        name: it.drug?.brandName ?? '薬剤',
        dosage: `1回${it.dosePerTime}${it.doseUnit} 1日${it.timesPerDay}回 ${it.days}日分`,
        date: it.prescription?.createdAt ?? null,
      });
    }
  } catch (err) {
    console.error('[documents] medication fetch failed:', err);
  }

  // 直近検査（H/L 判定付き、新しい順）。
  const labs: MergeLab[] = [];
  try {
    const rows = await prisma.labResult.findMany({
      where: { patientId },
      include: { examMaster: true },
      orderBy: [{ collectedAt: 'desc' }],
      take: 15,
    });
    for (const r of rows) {
      labs.push({
        name: r.examMaster?.name ?? '検査',
        value: r.value ?? r.valueText ?? null,
        unit: r.unit ?? r.examMaster?.unit ?? null,
        flag: r.flag ?? null,
        date: r.collectedAt ?? null,
      });
    }
  } catch (err) {
    console.error('[documents] lab fetch failed:', err);
  }

  // 保険一式（有効なものを優先：validTo 未経過 → 最新）。
  const insRow = await prisma.insurance.findFirst({
    where: { patientId },
    orderBy: [{ validTo: 'desc' }, { validFrom: 'desc' }],
  });

  const dxMapped: MergeDiagnosis[] = diagnoses.map((d) => ({
    displayName: d.displayName,
    isMain: d.isMain,
    isSuspected: d.isSuspected,
    startDate: d.startDate,
    outcome: d.outcome,
  }));

  const src: MergeSource = {
    patient: {
      patientNo: patient.patientNo,
      kanjiLastName: patient.kanjiLastName,
      kanjiFirstName: patient.kanjiFirstName,
      kanaLastName: patient.kanaLastName,
      kanaFirstName: patient.kanaFirstName,
      romanLastName: cf('romanLastName'),
      romanFirstName: cf('romanFirstName'),
      dateOfBirth: patient.dateOfBirth,
      gender: patient.gender,
      phone: cf('phone'),
      address: {
        postalCode: cf('postalCode'),
        prefecture: cf('prefecture'),
        city: cf('city'),
        line: cf('addressLine'),
      },
    },
    facility: {
      name: patient.clinic?.name ?? null,
      kind: patient.clinic?.kind ?? null,
      address: cf('facilityAddress') ?? null,
      phone: cf('facilityPhone') ?? null,
      director: cf('facilityDirector') ?? null,
      doctorName: cf('doctorName') ?? null,
    },
    diagnoses: dxMapped,
    medications: meds,
    labs,
    insurance: insRow
      ? {
          payerType: insRow.payerType,
          payerNo: insRow.payerNo,
          symbol: insRow.symbol,
          number: insRow.number,
          branchNo: insRow.branchNo,
          public1: { payer: insRow.publicPayerNo1, recipient: insRow.publicRecipientNo1 },
          public2: { payer: insRow.publicPayerNo2, recipient: insRow.publicRecipientNo2 },
          public3: { payer: insRow.publicPayerNo3, recipient: insRow.publicRecipientNo3 },
          workersComp: insRow.workersComp,
          specialNote: insRow.specialNote,
        }
      : null,
    vitals: {
      heightCm: patient.profile?.heightCm ?? null,
      weightKg: patient.profile?.weightKg ?? null,
      // バイタル(血圧/脈拍/体温/SpO2)は customFields に最新値が入る運用（任意）。
      systolic: numCf(custom, 'systolic'),
      diastolic: numCf(custom, 'diastolic'),
      pulse: numCf(custom, 'pulse'),
      temperature: numCf(custom, 'temperature'),
      spo2: numCf(custom, 'spo2'),
    },
    issuedOn: new Date(),
  };
  return src;
}

function numCf(custom: Record<string, unknown>, k: string): number | null {
  const v = custom[k];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export interface GenerateResult {
  ok: boolean;
  documentId?: string;
  output?: string;
  unresolved?: string[];
  error?: string;
}

/**
 * テンプレ差込生成（AC(1)(2)）。指定テンプレを患者の単一データソースで差込み、
 * 生成文書を ClinicalDocument(templateId, format=WORD/EXCEL) として保管する。
 * フロントのみモードでは保管は省略し、差込結果テキストだけ返す（プレビュー可）。
 */
export async function generateFromTemplate(input: {
  templateId: string;
  patientId: string;
}): Promise<GenerateResult> {
  const s = await requireSession();
  const { templateId, patientId } = input;
  if (!templateId || !patientId) return { ok: false, error: 'テンプレと患者を選択してください' };

  try {
    const tpl = await prisma.template.findUnique({ where: { id: templateId } });
    const layout = tpl ? asDocLayout(tpl.layout) : null;
    if (!tpl || !layout) return { ok: false, error: 'テンプレが見つかりません（DB未接続の可能性）' };

    const src = await buildMergeSourceForPatient(patientId);
    if (!src) return { ok: false, error: '患者データを取得できません（DB未接続の可能性）' };

    const map = buildMergeMap(src);
    const merged = applyMerge(layout.body, map);

    const doc = await prisma.clinicalDocument.create({
      data: {
        patientId,
        docType: layout.docType,
        templateId: tpl.id,
        title: `${tpl.name}（${src.patient?.kanjiLastName ?? ''} ${src.patient?.kanjiFirstName ?? ''}）`.trim(),
        format: layout.format,
        body: merged.output,
        createdByUserId: s.userId,
      },
    });
    await writeAudit({
      actorUserId: s.userId,
      patientId,
      action: 'CHART_WRITE',
      resource: 'ClinicalDocument.fromTemplate',
      resourceId: doc.id,
      detail: { templateId, format: layout.format, unresolved: merged.unresolved.length },
    });
    revalidatePath('/documents');
    return { ok: true, documentId: doc.id, output: merged.output, unresolved: merged.unresolved };
  } catch (err) {
    console.error('[documents.generateFromTemplate] failed:', err);
    return { ok: false, error: '差込生成に失敗しました（DB未接続の可能性）。プレビューは画面で確認できます。' };
  }
}

/**
 * フロントのみモード用の差込プレビュー — DB を使わず、画面が渡したサンプルソースで
 * テンプレ本文を差込んで返す（保管しない）。DB 未接続でも和暦/枝番/バイタルの差込を提示。
 */
export async function previewMerge(input: {
  templateBody: string;
  source: MergeSource;
}): Promise<{ output: string; unresolved: string[] }> {
  const map = buildMergeMap(input.source);
  const merged = applyMerge(input.templateBody, map);
  return { output: merged.output, unresolved: merged.unresolved };
}

/* ─────────────────────────────────────────────────────────────────────────
 * FR-DOC-03 スキャン文書保管
 * ・紙文書のスキャン保管（ページ数・OCRテキスト）を患者に紐付け、検索可能にする。
 * ───────────────────────────────────────────────────────────────────────── */

export async function createScanDocument(formData: FormData) {
  const s = await requireSession();
  const patientId = String(formData.get('patientId') || '') || null;
  const title = String(formData.get('title') || '').trim();
  const docType = String(formData.get('docType') || 'スキャン文書').trim() || 'スキャン文書';
  const storageUrl = String(formData.get('storageUrl') || '').trim() || null;
  const ocrText = String(formData.get('ocrText') || '').trim() || null;
  const pagesRaw = String(formData.get('scannedPages') || '').trim();
  const scannedPages = pagesRaw ? Math.max(1, parseInt(pagesRaw, 10) || 1) : null;
  if (!title) return;
  try {
    const d = await prisma.clinicalDocument.create({
      data: {
        patientId,
        docType,
        title,
        format: 'SCAN_IMAGE',
        storageUrl,
        scannedPages,
        ocrText,
        createdByUserId: s.userId,
      },
    });
    await writeAudit({
      actorUserId: s.userId,
      patientId: patientId ?? undefined,
      action: 'CHART_WRITE',
      resource: 'ClinicalDocument.scan',
      resourceId: d.id,
      detail: { title, scannedPages },
    });
    revalidatePath('/documents');
  } catch (err) {
    console.error('[documents.createScanDocument] failed (front-only mode):', err);
  }
}
