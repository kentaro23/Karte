/**
 * 処方安全チェック エンジン — 禁忌 / 相互作用 / 重複 / 極量 / アレルギー
 * (＋妊婦授乳・年齢). 別紙1 §6.1 / 174項 59-61.
 *
 * Deterministic: every judgement is derived ONLY from imported/verified safety
 * rows (DrugContraindication/Interaction/Dosage/Indication) whose
 * `source ∈ DrugDataSource` (no AI member). Each finding records the row's
 * `sourceCitation` for 真正性.
 * DISEASE_CONTRA (適応症 = 病名×添付文書) is derived from DrugIndication.icd10Codes
 * × PatientDiagnosis (有効病名) — deterministic, never guessed (see disease-contra.ts).
 */
import { prisma } from '@medixus/db';
import { age, ageInDays } from '@medixus/domain';
import { aggregate, type Finding, type RuleResult } from '@medixus/rule-engine';
import { evaluateDose } from './dose.js';
import {
  checkDiseaseIndication,
  type IndicationRow,
  type PatientDiagnosisForContra,
  type RxItemForDiseaseContra,
} from './disease-contra.js';
import { findDuplicates, type RxItemForDup } from './duplicate.js';

const sev = (s: 'ABSOLUTE' | 'RELATIVE'): RuleResult => (s === 'ABSOLUTE' ? 'BLOCKED' : 'WARNING');

export interface CheckSummary {
  overall: RuleResult;
  findings: Finding[];
  persistedIds: string[];
  /**
   * 適応症(DISEASE_CONTRA)チェックの結果のみを抽出した後方互換フィールド。
   * これらの finding は `findings` にも含まれ、persist / aggregate 対象。
   */
  diseaseContra: Finding[];
}

export async function runPrescriptionChecks(prescriptionId: string): Promise<CheckSummary> {
  const rx = await prisma.prescription.findUnique({
    where: { id: prescriptionId },
    include: {
      order: true,
      items: {
        include: {
          drug: { include: { ingredients: { include: { ingredient: true } } } },
        },
      },
    },
  });
  if (!rx) throw new Error('処方が見つかりません');

  const patient = await prisma.patient.findUnique({
    where: { id: rx.patientId },
    include: { allergies: true, profile: true },
  });
  if (!patient) throw new Error('患者が見つかりません');

  const pAge = age(patient.dateOfBirth);
  const pAgeDays = ageInDays(patient.dateOfBirth);
  const pregnant = patient.profile?.isPregnant ?? false;
  const lactating = patient.profile?.isLactating ?? false;

  // ---- shape each prescription item ----
  type Shaped = {
    itemId: string;
    productId: string;
    drugName: string;
    atcCode: string | null;
    ingredientIds: string[];
    ingredientCodes: string[];
    rootIds: string[];
    prescribedSingle: number;
    timesPerDay: number;
  };
  const items: Shaped[] = rx.items.map((it) => {
    const ings = it.drug.ingredients.map((pi) => pi.ingredient);
    return {
      itemId: it.id,
      productId: it.drugProductId,
      drugName: it.drug.brandName,
      atcCode: it.drug.atcCode ?? null,
      ingredientIds: ings.map((g) => g.id),
      ingredientCodes: ings.map((g) => g.ingredientCode),
      rootIds: ings.map((g) => g.saltVariantOfId ?? g.id),
      prescribedSingle: it.dosePerTime,
      timesPerDay: it.timesPerDay,
    };
  });

  const productIds = items.map((i) => i.productId);
  const ingredientIds = [...new Set(items.flatMap((i) => i.ingredientIds))];

  const [contra, inter, dosage, indication, patientDx] = await Promise.all([
    prisma.drugContraindication.findMany({
      where: {
        validTo: null,
        OR: [
          { targetKind: 'PRODUCT', targetId: { in: productIds } },
          { targetKind: 'INGREDIENT', targetId: { in: ingredientIds } },
        ],
      },
    }),
    prisma.drugInteraction.findMany({
      where: {
        validTo: null,
        OR: [
          { subjectKind: 'PRODUCT', subjectId: { in: productIds } },
          { subjectKind: 'INGREDIENT', subjectId: { in: ingredientIds } },
        ],
      },
    }),
    prisma.drugDosage.findMany({
      where: {
        validTo: null,
        OR: [
          { targetKind: 'PRODUCT', targetId: { in: productIds } },
          { targetKind: 'INGREDIENT', targetId: { in: ingredientIds } },
        ],
      },
    }),
    prisma.drugIndication.findMany({
      where: {
        validTo: null,
        OR: [
          { targetKind: 'PRODUCT', targetId: { in: productIds } },
          { targetKind: 'INGREDIENT', targetId: { in: ingredientIds } },
        ],
      },
    }),
    // 患者の有効病名 (適応症突合用). 取消(DELETED)・治癒(RESOLVED)は除外。
    prisma.patientDiagnosis.findMany({
      where: { patientId: rx.patientId, status: 'ACTIVE' },
    }),
  ]);

  const findings: Finding[] = [];
  const matchTarget = (kind: string, id: string, it: Shaped) =>
    (kind === 'PRODUCT' && id === it.productId) ||
    (kind === 'INGREDIENT' && it.ingredientIds.includes(id));

  // ---- ① アレルギー (薬剤) ----
  const drugAllergyCodes = new Set(
    patient.allergies.filter((a) => a.type === 'DRUG' && a.ingredientCode).map((a) => a.ingredientCode!),
  );
  for (const it of items) {
    const hit = it.ingredientCodes.filter((c) => drugAllergyCodes.has(c));
    if (hit.length) {
      findings.push({
        checkType: 'ALLERGY',
        result: 'BLOCKED',
        message: `${it.drugName}: 患者の薬剤アレルギー成分に一致 (${hit.join(', ')})`,
        details: { itemId: it.itemId, ingredientCodes: hit, source: 'patient.allergies' },
      });
    }
  }

  // ---- ② 禁忌 (妊婦/授乳/年齢) ----
  for (const c of contra) {
    const it = items.find((x) => matchTarget(c.targetKind, c.targetId, x));
    if (!it) continue;
    const cite = { sourceCitation: c.sourceCitation, source: c.source, isProvisional: c.isProvisional };
    if (c.conditionType === 'PREGNANCY' && pregnant) {
      findings.push({ checkType: 'PREGNANCY_LACTATION', result: sev(c.severity), message: `${it.drugName}: 妊婦禁忌 — ${c.conditionText}`, details: { itemId: it.itemId, ...cite } });
    } else if (c.conditionType === 'LACTATION' && lactating) {
      findings.push({ checkType: 'PREGNANCY_LACTATION', result: sev(c.severity), message: `${it.drugName}: 授乳婦禁忌 — ${c.conditionText}`, details: { itemId: it.itemId, ...cite } });
    } else if (c.conditionType === 'AGE') {
      const lo = c.ageMinDays ?? -1;
      const hi = c.ageMaxDays ?? Number.MAX_SAFE_INTEGER;
      if (pAgeDays >= lo && pAgeDays <= hi) {
        findings.push({ checkType: 'AGE', result: sev(c.severity), message: `${it.drugName}: 年齢禁忌(${pAge}歳) — ${c.conditionText}`, details: { itemId: it.itemId, ageDays: pAgeDays, ...cite } });
      }
    }
    // DISEASE / STATE / LAB / HYPERSENSITIVITY → Phase 2 (病名・検査値突合). Not guessed.
  }

  // ---- ③ 相互作用 (処方内ペア + 食品) ----
  for (const ix of inter) {
    const subj = items.find((x) => matchTarget(ix.subjectKind, ix.subjectId, x));
    if (!subj) continue;
    const ref = (ix.counterpartRef ?? {}) as { ingredientCodes?: string[]; atc?: string[]; productIds?: string[]; food?: string };
    const cite = { sourceCitation: ix.sourceCitation, mechanism: ix.mechanism, management: ix.management };
    const res: RuleResult = ix.severity === 'CONTRAINDICATED_COMBO' ? 'BLOCKED' : 'WARNING';
    if (ix.counterpartType === 'FOOD') {
      findings.push({ checkType: 'INTERACTION', result: res === 'BLOCKED' ? 'WARNING' : res, message: `${subj.drugName}: 食品相互作用 (${ref.food ?? '該当食品'})`, details: { itemId: subj.itemId, ...cite } });
      continue;
    }
    const other = items.find(
      (o) =>
        o.itemId !== subj.itemId &&
        ((ix.counterpartType === 'DRUG_INGREDIENT' && o.ingredientCodes.some((c) => ref.ingredientCodes?.includes(c))) ||
          (ix.counterpartType === 'ATC_CLASS' && o.atcCode && ref.atc?.includes(o.atcCode)) ||
          (ix.counterpartType === 'DRUG_PRODUCT' && ref.productIds?.includes(o.productId))),
    );
    if (other) {
      findings.push({
        checkType: 'INTERACTION',
        result: res,
        message: `${subj.drugName} × ${other.drugName}: ${ix.severity === 'CONTRAINDICATED_COMBO' ? '併用禁忌' : '併用注意'}`,
        details: { itemIds: [subj.itemId, other.itemId], clinicalEffect: ix.clinicalEffect, ...cite },
      });
    }
  }

  // ---- ④ 重複 ----
  const dupInput: RxItemForDup[] = items.map((i) => ({
    itemId: i.itemId,
    drugName: i.drugName,
    ingredientRootIds: i.rootIds,
    atcCode: i.atcCode,
  }));
  for (const d of findDuplicates(dupInput)) {
    findings.push({
      checkType: 'DUPLICATE',
      result: 'WARNING',
      message: d.message,
      details: { kind: d.kind, itemIds: d.itemIds, key: d.key },
    });
  }

  // ---- ⑤ 極量 ----
  for (const it of items) {
    const d =
      dosage.find((x) => x.targetKind === 'PRODUCT' && x.targetId === it.productId) ??
      dosage.find((x) => x.targetKind === 'INGREDIENT' && it.ingredientIds.includes(x.targetId));
    const e = evaluateDose({
      prescribedSingle: it.prescribedSingle,
      timesPerDay: it.timesPerDay,
      maxDoseSingle: d?.maxDoseSingle ?? null,
      maxDoseDaily: d?.maxDoseDaily ?? null,
      usualDoseDaily: d?.usualDoseDaily ?? null,
    });
    if (e.result !== 'PASS') {
      findings.push({
        checkType: 'DOSE_MAX',
        result: e.result,
        message: `${it.drugName}: ${e.message}`,
        details: { itemId: it.itemId, sourceCitation: d?.sourceCitation ?? null, dosageDataPresent: Boolean(d) },
      });
    }
  }

  // ---- ⑥ 適応症 (DISEASE_CONTRA: 添付文書適応 × 有効病名) ----
  // 各処方薬に紐づく適応症行を整形 (provenance を保持)。
  const dxInput: PatientDiagnosisForContra[] = patientDx.map((d) => ({
    icd10: d.icd10 ?? null,
    displayName: d.displayName,
    isSuspected: d.isSuspected,
  }));
  const diseaseInput: RxItemForDiseaseContra[] = items.map((it) => {
    const inds: IndicationRow[] = indication
      .filter((ind) => matchTarget(ind.targetKind, ind.targetId, it))
      .map((ind) => ({
        indicationText: ind.indicationText,
        icd10Codes: ind.icd10Codes,
        sourceCitation: ind.sourceCitation,
        source: ind.source,
        isProvisional: ind.isProvisional,
      }));
    return { itemId: it.itemId, drugName: it.drugName, indications: inds };
  });
  const diseaseContra = checkDiseaseIndication(diseaseInput, dxInput);
  findings.push(...diseaseContra);

  // ---- persist (immutable RuleCheckResult rows) ----
  const masterVersion = rx.items[0]?.drug.sourceMasterVersion ?? 'unknown';
  const runId = `run_${Date.now()}`;
  const persistedIds: string[] = [];
  for (const f of findings) {
    const row = await prisma.ruleCheckResult.create({
      data: {
        prescriptionId,
        orderId: rx.orderId,
        checkType: f.checkType,
        result: f.result,
        checkedBy: 'STATIC_DB',
        severityNote: f.message,
        details: { ...f.details, runId } as object,
        masterVersion,
      },
    });
    persistedIds.push(row.id);
  }

  const agg = aggregate(findings);
  await prisma.prescription.update({
    where: { id: prescriptionId },
    data: { status: 'rule_checked' },
  });

  return { overall: agg.overall, findings, persistedIds, diseaseContra };
}
