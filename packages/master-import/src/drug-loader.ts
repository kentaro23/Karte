/**
 * Idempotent loaders. Code/price/name = bulk upsert (full ~20k path = receipt-csv).
 * Safety rows go through assertSafetyProvenance + an append-only DrugSafetyReviewLog.
 */
import { prisma, type DrugTargetKind } from '@medixus/db';
import { assertSafetyProvenance, type SafetyProvenance } from './provenance.js';

export async function upsertIngredient(i: {
  ingredientCode: string;
  ingredientName: string;
  ingredientNameKana?: string;
  ingredientNameEn?: string;
  saltVariantOfId?: string | null;
}): Promise<string> {
  const row = await prisma.drugIngredient.upsert({
    where: { ingredientCode: i.ingredientCode },
    create: i,
    update: {
      ingredientName: i.ingredientName,
      ingredientNameKana: i.ingredientNameKana,
      ingredientNameEn: i.ingredientNameEn,
      saltVariantOfId: i.saltVariantOfId ?? null,
    },
  });
  return row.id;
}

export async function upsertDrugProduct(p: {
  receiptCode: string;
  yjCode?: string;
  hotCode?: string;
  brandName: string;
  brandNameKana?: string;
  genericName?: string;
  strengthValue?: number;
  strengthUnit?: string;
  dosageForm: string;
  administrationRoute: string;
  unitCode?: string;
  nhiPrice?: number;
  isGeneric?: boolean;
  isNarcotic?: boolean;
  atcCode?: string;
  sourceMasterVersion: string;
  provenance: object;
}): Promise<string> {
  const row = await prisma.drugProduct.upsert({
    where: { receiptCode: p.receiptCode },
    create: p,
    update: { brandName: p.brandName, nhiPrice: p.nhiPrice, atcCode: p.atcCode },
  });
  return row.id;
}

export async function linkProductIngredient(
  drugProductId: string,
  ingredientId: string,
  opts: { amountValue?: number; amountUnit?: string; isActive?: boolean } = {},
): Promise<void> {
  await prisma.drugProductIngredient.upsert({
    where: { drugProductId_ingredientId: { drugProductId, ingredientId } },
    create: { drugProductId, ingredientId, ...opts },
    update: opts,
  });
}

async function logSafety(entityTable: string, entityId: string, after: object, prov: SafetyProvenance) {
  await prisma.drugSafetyReviewLog.create({
    data: {
      entityTable,
      entityId,
      action: 'create',
      after,
      reviewedByUserId: prov.reviewedByUserId ?? null,
      sourceCitation: prov.sourceCitation,
    },
  });
}

export async function addContraindication(
  target: { kind: DrugTargetKind; id: string },
  data: {
    severity: 'ABSOLUTE' | 'RELATIVE';
    conditionType:
      | 'DISEASE'
      | 'STATE'
      | 'AGE'
      | 'PREGNANCY'
      | 'LACTATION'
      | 'LAB'
      | 'CO_ADMINISTRATION'
      | 'HYPERSENSITIVITY';
    conditionText: string;
    icd10Codes?: string[];
    ageMinDays?: number;
    ageMaxDays?: number;
    rationale?: string;
  },
  prov: SafetyProvenance,
): Promise<string> {
  assertSafetyProvenance(prov);
  const row = await prisma.drugContraindication.create({
    data: {
      targetKind: target.kind,
      targetId: target.id,
      severity: data.severity,
      conditionType: data.conditionType,
      conditionText: data.conditionText,
      icd10Codes: data.icd10Codes ?? [],
      ageMinDays: data.ageMinDays,
      ageMaxDays: data.ageMaxDays,
      rationale: data.rationale,
      source: prov.source,
      sourceCitation: prov.sourceCitation,
      reviewedByUserId: prov.reviewedByUserId ?? null,
      reviewedAt: prov.reviewedByUserId ? new Date() : null,
      isSeed: prov.isSeed ?? false,
      isProvisional: prov.isProvisional ?? false,
    },
  });
  await logSafety('DrugContraindication', row.id, data, prov);
  return row.id;
}

export async function addInteraction(
  subject: { kind: DrugTargetKind; id: string },
  data: {
    counterpartType: 'DRUG_INGREDIENT' | 'ATC_CLASS' | 'FOOD' | 'DRUG_PRODUCT';
    counterpartRef: object;
    severity: 'CONTRAINDICATED_COMBO' | 'CAUTION_COMBO';
    mechanism?: string;
    clinicalEffect?: string;
    management?: string;
  },
  prov: SafetyProvenance,
): Promise<string> {
  assertSafetyProvenance(prov);
  const row = await prisma.drugInteraction.create({
    data: {
      subjectKind: subject.kind,
      subjectId: subject.id,
      counterpartType: data.counterpartType,
      counterpartRef: data.counterpartRef,
      severity: data.severity,
      mechanism: data.mechanism,
      clinicalEffect: data.clinicalEffect,
      management: data.management,
      source: prov.source,
      sourceCitation: prov.sourceCitation,
      reviewedByUserId: prov.reviewedByUserId ?? null,
      reviewedAt: prov.reviewedByUserId ? new Date() : null,
      isSeed: prov.isSeed ?? false,
      isProvisional: prov.isProvisional ?? false,
    },
  });
  await logSafety('DrugInteraction', row.id, data, prov);
  return row.id;
}

export async function addDosage(
  target: { kind: DrugTargetKind; id: string },
  data: {
    population?: 'ADULT' | 'PEDIATRIC' | 'ELDERLY' | 'NEONATE' | 'PREGNANT';
    route: string;
    usualDoseDaily?: number;
    maxDoseSingle?: number;
    maxDoseDaily?: number;
    dosageText?: string;
  },
  prov: SafetyProvenance,
): Promise<string> {
  assertSafetyProvenance(prov);
  const row = await prisma.drugDosage.create({
    data: {
      targetKind: target.kind,
      targetId: target.id,
      population: data.population ?? 'ADULT',
      route: data.route,
      usualDoseDaily: data.usualDoseDaily,
      maxDoseSingle: data.maxDoseSingle,
      maxDoseDaily: data.maxDoseDaily,
      dosageText: data.dosageText,
      source: prov.source,
      sourceCitation: prov.sourceCitation,
      reviewedByUserId: prov.reviewedByUserId ?? null,
      reviewedAt: prov.reviewedByUserId ? new Date() : null,
      isSeed: prov.isSeed ?? false,
      isProvisional: prov.isProvisional ?? false,
    },
  });
  await logSafety('DrugDosage', row.id, data, prov);
  return row.id;
}

export async function addIndication(
  target: { kind: DrugTargetKind; id: string },
  data: { indicationText: string; icd10Codes?: string[]; isInsuranceApplicable?: boolean },
  prov: SafetyProvenance,
): Promise<string> {
  assertSafetyProvenance(prov);
  const row = await prisma.drugIndication.create({
    data: {
      targetKind: target.kind,
      targetId: target.id,
      indicationText: data.indicationText,
      icd10Codes: data.icd10Codes ?? [],
      isInsuranceApplicable: data.isInsuranceApplicable ?? true,
      source: prov.source,
      sourceCitation: prov.sourceCitation,
      reviewedByUserId: prov.reviewedByUserId ?? null,
      reviewedAt: prov.reviewedByUserId ? new Date() : null,
      isSeed: prov.isSeed ?? false,
      isProvisional: prov.isProvisional ?? false,
    },
  });
  await logSafety('DrugIndication', row.id, data, prov);
  return row.id;
}
