/**
 * 薬剤データ "入れるだけ" バンドル — 取込側。
 *
 * `data/` に manifest.json ＋ テーブル別CSV を置き、1コマンドで全実装:
 *   pnpm import:drugs:bundle [dir=data]
 *
 * 不変条件（患者安全）:
 *  - 安全データ(禁忌/相互/極量/適応)は source ∈ DrugDataSource（AI不在）。
 *  - CURATED_SEED / PHARMACIST_VERIFIED は reviewedBy 必須・sourceCitation 必須。
 *  - 冪等（自然キーで upsert / 既存安全行があれば再作成しない）。
 *  - 公的層(コード/薬価/名称)は無加工で投入、安全層と分離。
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { prisma, type DrugDataSource, type DrugTargetKind } from '@medixus/db';
import {
  upsertIngredient,
  upsertDrugProduct,
  linkProductIngredient,
  addContraindication,
  addInteraction,
  addDosage,
  addIndication,
} from './drug-loader.js';

/** minimal RFC4180-ish CSV parser (UTF-8, quoted fields, embedded comma/newline) */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let i = 0;
  let q = false;
  const t = text.replace(/^﻿/, '');
  while (i < t.length) {
    const ch = t[i]!;
    if (q) {
      if (ch === '"') {
        if (t[i + 1] === '"') { field += '"'; i += 2; continue; }
        q = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { q = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.length && !(r.length === 1 && r[0] === ''));
  if (nonEmpty.length === 0) return [];
  const header = nonEmpty[0]!.map((h) => h.trim());
  return nonEmpty.slice(1).map((r) => {
    const o: Record<string, string> = {};
    header.forEach((h, idx) => (o[h] = (r[idx] ?? '').trim()));
    return o;
  });
}

const REQUIRED: Record<string, string[]> = {
  'drug_ingredient.csv': ['ingredientCode', 'ingredientName'],
  'drug_product.csv': ['receiptCode', 'brandName', 'dosageForm', 'administrationRoute', 'ingredientCode'],
  'drug_indication.csv': ['targetType', 'targetCode', 'indicationText', 'source', 'sourceCitation'],
  'drug_contraindication.csv': ['targetType', 'targetCode', 'severity', 'conditionType', 'conditionText', 'source', 'sourceCitation'],
  'drug_interaction.csv': ['subjectType', 'subjectCode', 'counterpartType', 'counterpartRef', 'severity', 'source', 'sourceCitation'],
  'drug_dosage.csv': ['targetType', 'targetCode', 'route', 'source', 'sourceCitation'],
};

function read(dir: string, name: string): Record<string, string>[] {
  const p = path.join(dir, name);
  if (!existsSync(p)) return [];
  const rows = parseCsv(readFileSync(p, 'utf8'));
  if (rows.length) {
    const have = Object.keys(rows[0]!);
    const miss = (REQUIRED[name] ?? []).filter((c) => !have.includes(c));
    if (miss.length) throw new Error(`${name}: 必須列が不足: ${miss.join(', ')}`);
  }
  return rows;
}

const num = (v?: string) => (v && v.trim() !== '' ? Number(v) : undefined);
const truthy = (v?: string) => v === 'true' || v === '1' || v === 'TRUE';

export interface BundleResult {
  ingredients: number;
  products: number;
  indications: number;
  contraindications: number;
  interactions: number;
  dosages: number;
  skippedSafety: number;
  errors: string[];
}

export async function importBundle(dir: string): Promise<BundleResult> {
  if (!existsSync(dir)) throw new Error(`バンドルが見つかりません: ${dir}`);
  const res: BundleResult = {
    ingredients: 0, products: 0, indications: 0, contraindications: 0,
    interactions: 0, dosages: 0, skippedSafety: 0, errors: [],
  };

  const run = await prisma.importRun.create({
    data: { source: `BUNDLE:${path.basename(dir)}`, status: 'RUNNING' },
  });

  // 1) ingredients
  const ingCodeToId = new Map<string, string>();
  for (const r of read(dir, 'drug_ingredient.csv')) {
    const id = await upsertIngredient({
      ingredientCode: r.ingredientCode!,
      ingredientName: r.ingredientName!,
      ingredientNameKana: r.ingredientNameKana || undefined,
      ingredientNameEn: r.ingredientNameEn || undefined,
    });
    ingCodeToId.set(r.ingredientCode!, id);
    res.ingredients++;
  }

  // 2) products (+ link to its ingredient)
  const receiptToId = new Map<string, string>();
  for (const r of read(dir, 'drug_product.csv')) {
    let ingId = ingCodeToId.get(r.ingredientCode!);
    if (!ingId) {
      ingId = await upsertIngredient({
        ingredientCode: r.ingredientCode!,
        ingredientName: r.genericName || r.brandName!,
      });
      ingCodeToId.set(r.ingredientCode!, ingId);
    }
    const pid = await upsertDrugProduct({
      receiptCode: r.receiptCode!,
      brandName: r.brandName!,
      brandNameKana: r.brandNameKana || undefined,
      genericName: r.genericName || undefined,
      strengthValue: num(r.strengthValue),
      strengthUnit: r.strengthUnit || undefined,
      dosageForm: r.dosageForm!,
      administrationRoute: r.administrationRoute!,
      unitCode: r.strengthUnit || undefined,
      nhiPrice: num(r.nhiPrice),
      atcCode: r.atcCode || undefined,
      sourceMasterVersion: r.source || 'BUNDLE',
      provenance: { source: r.source || 'BUNDLE', note: r.provenanceNote || 'bundle import' },
    });
    receiptToId.set(r.receiptCode!, pid);
    await linkProductIngredient(pid, ingId, {
      amountValue: num(r.strengthValue),
      amountUnit: r.strengthUnit || undefined,
      isActive: true,
    });
    res.products++;
  }

  const resolveTarget = (
    type: string,
    code: string,
  ): { kind: DrugTargetKind; id: string } | null => {
    if (type === 'INGREDIENT') {
      const id = ingCodeToId.get(code);
      return id ? { kind: 'INGREDIENT', id } : null;
    }
    const id = receiptToId.get(code);
    return id ? { kind: 'PRODUCT', id } : null;
  };
  const prov = (r: Record<string, string>) => ({
    source: r.source as DrugDataSource,
    sourceCitation: r.sourceCitation!,
    reviewedByUserId: r.reviewedBy || undefined,
    isSeed: truthy(r.isSeed),
    isProvisional: r.isProvisional ? truthy(r.isProvisional) : true,
  });
  const guarded = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      res.skippedSafety++;
      res.errors.push(`${label}: ${(e as Error).message}`);
    }
  };

  // 3) indications
  for (const r of read(dir, 'drug_indication.csv')) {
    const tgt = resolveTarget(r.targetType!, r.targetCode!);
    if (!tgt) { res.skippedSafety++; continue; }
    await guarded(`indication ${r.targetCode}`, async () => {
      await addIndication(
        tgt,
        {
          indicationText: r.indicationText!,
          icd10Codes: r.icd10 ? r.icd10.split(/[;|]/).map((s) => s.trim()).filter(Boolean) : [],
          isInsuranceApplicable: r.isInsuranceApplicable ? truthy(r.isInsuranceApplicable) : true,
        },
        prov(r),
      );
      res.indications++;
    });
  }

  // 4) contraindications
  for (const r of read(dir, 'drug_contraindication.csv')) {
    const tgt = resolveTarget(r.targetType!, r.targetCode!);
    if (!tgt) { res.skippedSafety++; continue; }
    await guarded(`contra ${r.targetCode}`, async () => {
      await addContraindication(
        tgt,
        {
          severity: (r.severity as 'ABSOLUTE' | 'RELATIVE') ?? 'RELATIVE',
          conditionType: r.conditionType as never,
          conditionText: r.conditionText!,
          icd10Codes: r.icd10 ? r.icd10.split(/[;|]/).map((s) => s.trim()).filter(Boolean) : [],
          ageMinDays: num(r.ageMinDays),
          ageMaxDays: num(r.ageMaxDays),
          rationale: r.rationale || undefined,
        },
        prov(r),
      );
      res.contraindications++;
    });
  }

  // 5) interactions
  for (const r of read(dir, 'drug_interaction.csv')) {
    const tgt = resolveTarget(r.subjectType!, r.subjectCode!);
    if (!tgt) { res.skippedSafety++; continue; }
    await guarded(`interaction ${r.subjectCode}`, async () => {
      let counterpartRef: object = {};
      try { counterpartRef = JSON.parse(r.counterpartRef || '{}'); } catch { counterpartRef = { raw: r.counterpartRef }; }
      await addInteraction(
        tgt,
        {
          counterpartType: r.counterpartType as never,
          counterpartRef,
          severity: (r.severity as 'CONTRAINDICATED_COMBO' | 'CAUTION_COMBO') ?? 'CAUTION_COMBO',
          mechanism: r.mechanism || undefined,
          clinicalEffect: r.clinicalEffect || undefined,
          management: r.management || undefined,
        },
        prov(r),
      );
      res.interactions++;
    });
  }

  // 6) dosages
  for (const r of read(dir, 'drug_dosage.csv')) {
    const tgt = resolveTarget(r.targetType!, r.targetCode!);
    if (!tgt) { res.skippedSafety++; continue; }
    await guarded(`dosage ${r.targetCode}`, async () => {
      await addDosage(
        tgt,
        {
          population: (r.population as never) || 'ADULT',
          route: r.route!,
          usualDoseDaily: num(r.usualDoseDaily),
          maxDoseSingle: num(r.maxDoseSingle),
          maxDoseDaily: num(r.maxDoseDaily),
          dosageText: r.dosageText || undefined,
        },
        prov(r),
      );
      res.dosages++;
    });
  }

  await prisma.importRun.update({
    where: { id: run.id },
    data: { status: 'SUCCESS', endedAt: new Date(), counts: res as object },
  });
  return res;
}
