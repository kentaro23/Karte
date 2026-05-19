import { notFound } from 'next/navigation';
import { prisma } from '@medixus/db';
import { age, emptySoap, type SoapBlock } from '@medixus/domain';
import { PatientBar, type PatientBarData } from '@medixus/ui';
import { requireSession } from '@/lib/session';
import { ChartWorkspace } from './workspace';

export default async function ChartPage({
  params,
}: {
  params: Promise<{ encounterId: string }>;
}) {
  await requireSession();
  const { encounterId } = await params;

  const enc = await prisma.encounter.findUnique({
    where: { id: encounterId },
    include: {
      patient: { include: { allergies: true, infections: true, profile: true } },
    },
  });
  if (!enc) notFound();

  const dept = await prisma.department.findUnique({ where: { id: enc.departmentId } });
  const ward = enc.wardId ? await prisma.ward.findUnique({ where: { id: enc.wardId } }) : null;

  const notes = await prisma.clinicalNote.findMany({
    where: { encounterId },
    orderBy: [{ createdAt: 'desc' }],
  });
  const latest = notes.find((n) => n.isLatest && n.noteType === 'PROGRESS');

  const drugs = await prisma.drugProduct.findMany({
    orderBy: { brandName: 'asc' },
    take: 30000,
    select: {
      id: true,
      brandName: true,
      genericName: true,
      strengthUnit: true,
      administrationRoute: true,
    },
  });

  // ── 病名(ICD10) → 適応薬リコメンド ──
  const activeDx = await prisma.patientDiagnosis.findMany({
    where: { patientId: enc.patient.id, status: 'ACTIVE' },
    orderBy: [{ isMain: 'desc' }, { startDate: 'desc' }],
    select: {
      id: true,
      displayName: true,
      icd10: true,
      isMain: true,
      isSuspected: true,
      masterCode: true,
    },
  });
  const icd10s = [...new Set(activeDx.map((d) => d.icd10).filter((x): x is string => !!x))];
  const icd10ToDx = new Map(activeDx.filter((d) => d.icd10).map((d) => [d.icd10!, d.displayName]));
  let recommended: { id: string; dx: string }[] = [];
  if (icd10s.length) {
    const inds = await prisma.drugIndication.findMany({
      where: { validTo: null, icd10Codes: { hasSome: icd10s } },
      select: { targetKind: true, targetId: true, icd10Codes: true },
    });
    const ingIds = inds.filter((i) => i.targetKind === 'INGREDIENT').map((i) => i.targetId);
    const ingReason = new Map<string, string>();
    for (const i of inds)
      if (i.targetKind === 'INGREDIENT')
        ingReason.set(
          i.targetId,
          icd10ToDx.get(i.icd10Codes.find((c) => icd10s.includes(c)) ?? '') ?? '適応',
        );
    const links = ingIds.length
      ? await prisma.drugProductIngredient.findMany({
          where: { ingredientId: { in: ingIds } },
          select: { drugProductId: true, ingredientId: true },
        })
      : [];
    const seen = new Map<string, string>();
    for (const l of links)
      if (!seen.has(l.drugProductId))
        seen.set(l.drugProductId, ingReason.get(l.ingredientId) ?? '適応');
    for (const i of inds)
      if (i.targetKind === 'PRODUCT' && !seen.has(i.targetId))
        seen.set(i.targetId, '適応');
    recommended = [...seen.entries()].map(([id, dx]) => ({ id, dx }));
  }

  const prescriptions = await prisma.prescription.findMany({
    where: { encounterId },
    orderBy: { createdAt: 'desc' },
    include: {
      items: { include: { drug: { select: { brandName: true } } } },
      checks: { orderBy: { createdAt: 'desc' } },
      overrides: true,
    },
  });

  const p = enc.patient;
  const bar: PatientBarData = {
    patientId: p.id,
    patientNo: p.patientNo,
    name: `${p.kanjiLastName} ${p.kanjiFirstName}`,
    kana: `${p.kanaLastName} ${p.kanaFirstName}`,
    gender: p.gender === 'MALE' ? '男性' : p.gender === 'FEMALE' ? '女性' : '—',
    age: age(p.dateOfBirth),
    inout: enc.encounterType === 'INPATIENT' ? '入院' : '外来',
    ward: ward?.name ?? null,
    mode: 'カルテ記述',
    allergies: p.allergies.map((a) => a.substance),
    infections: p.infections.map((i) => `${i.pathogen}(${i.status})`),
    isVip: p.isVip,
  };

  const initialBlocks: SoapBlock[] =
    (latest?.blocks as unknown as SoapBlock[] | undefined) ?? emptySoap();

  return (
    <div>
      <PatientBar p={bar} />
      <ChartWorkspace
        encounterId={encounterId}
        patientId={enc.patient.id}
        deptName={dept?.name ?? '—'}
        latestNote={
          latest
            ? { id: latest.id, version: latest.version, status: latest.status }
            : null
        }
        initialBlocks={initialBlocks}
        history={notes.map((n) => ({
          id: n.id,
          version: n.version,
          status: n.status,
          isLatest: n.isLatest,
          noteType: n.noteType,
          recordedDate: n.recordedDate.toISOString(),
          amendReason: n.amendReason,
          blocks: n.blocks as unknown as SoapBlock[],
        }))}
        drugs={drugs}
        recommended={recommended}
        diagnoses={activeDx.map((d) => ({
          id: d.id,
          displayName: d.displayName,
          icd10: d.icd10,
          isMain: d.isMain,
          isSuspected: d.isSuspected,
          fromMaster: !!d.masterCode,
        }))}
        prescriptions={prescriptions.map((rx) => ({
          id: rx.id,
          status: rx.status,
          items: rx.items.map((it) => ({
            drugName: it.drug.brandName,
            dosePerTime: it.dosePerTime,
            doseUnit: it.doseUnit,
            timesPerDay: it.timesPerDay,
            days: it.days,
          })),
          checks: rx.checks.map((c) => ({
            id: c.id,
            checkType: c.checkType,
            result: c.result,
            severityNote: c.severityNote,
            runId: (c.details as { runId?: string })?.runId ?? '',
          })),
          overrides: rx.overrides.map((o) => o.ruleCheckResultId),
        }))}
      />
    </div>
  );
}
