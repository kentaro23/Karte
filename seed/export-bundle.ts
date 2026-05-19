/**
 * 現在のDBの全薬剤情報を "入れるだけ" バンドル(data/)へ書き出す。
 *   pnpm export:drugs:bundle [outDir=data]
 * 出力: manifest.json ＋ テーブル別CSV（provenance/出典/承認列付き）。
 * これが「全薬剤情報がまとまったもの」の実体。公式マスタ取込後に再exportすれば全件版になる。
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.DATABASE_URL) {
  for (const line of readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/.exec(line);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2];
  }
}
const outDir = path.resolve(root, process.argv[2] ?? 'data');
mkdirSync(outDir, { recursive: true });

const { prisma } = await import('@medixus/db');

const esc = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join(';') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const writeCsv = (name: string, cols: string[], rows: Record<string, unknown>[]) => {
  const body = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  writeFileSync(path.join(outDir, name), body + '\n', 'utf8');
  return rows.length;
};

const ingredients = await prisma.drugIngredient.findMany();
const ingById = new Map(ingredients.map((i) => [i.id, i]));
const ingCodeById = new Map(ingredients.map((i) => [i.id, i.ingredientCode]));
const products = await prisma.drugProduct.findMany({
  include: { ingredients: { include: { ingredient: true } } },
});
const receiptById = new Map(products.map((p) => [p.id, p.receiptCode]));
const targetCode = (kind: string, id: string) =>
  kind === 'INGREDIENT' ? ingCodeById.get(id) ?? id : receiptById.get(id) ?? id;

const counts: Record<string, number> = {};

counts['drug_ingredient.csv'] = writeCsv(
  'drug_ingredient.csv',
  ['ingredientCode', 'ingredientName', 'ingredientNameKana', 'ingredientNameEn'],
  ingredients.map((i) => ({
    ingredientCode: i.ingredientCode,
    ingredientName: i.ingredientName,
    ingredientNameKana: i.ingredientNameKana,
    ingredientNameEn: i.ingredientNameEn,
  })),
);

counts['drug_product.csv'] = writeCsv(
  'drug_product.csv',
  ['receiptCode', 'brandName', 'brandNameKana', 'genericName', 'strengthValue', 'strengthUnit',
   'dosageForm', 'administrationRoute', 'atcCode', 'nhiPrice', 'ingredientCode', 'source', 'provenanceNote'],
  products.map((p) => {
    const ing = p.ingredients.find((x) => x.isActive) ?? p.ingredients[0];
    const prov = (p.provenance as { source?: string; note?: string } | null) ?? {};
    return {
      receiptCode: p.receiptCode,
      brandName: p.brandName,
      brandNameKana: p.brandNameKana,
      genericName: p.genericName,
      strengthValue: p.strengthValue,
      strengthUnit: p.strengthUnit,
      dosageForm: p.dosageForm,
      administrationRoute: p.administrationRoute,
      atcCode: p.atcCode,
      nhiPrice: p.nhiPrice,
      ingredientCode: ing ? ingById.get(ing.ingredientId)?.ingredientCode : '',
      source: prov.source ?? p.sourceMasterVersion,
      provenanceNote: prov.note ?? '',
    };
  }),
);

const ind = await prisma.drugIndication.findMany();
counts['drug_indication.csv'] = writeCsv(
  'drug_indication.csv',
  ['targetType', 'targetCode', 'indicationText', 'icd10', 'isInsuranceApplicable',
   'source', 'sourceCitation', 'isSeed', 'isProvisional', 'reviewedBy'],
  ind.map((r) => ({
    targetType: r.targetKind, targetCode: targetCode(r.targetKind, r.targetId),
    indicationText: r.indicationText, icd10: r.icd10Codes,
    isInsuranceApplicable: r.isInsuranceApplicable, source: r.source,
    sourceCitation: r.sourceCitation, isSeed: r.isSeed, isProvisional: r.isProvisional,
    reviewedBy: r.reviewedByUserId,
  })),
);

const contra = await prisma.drugContraindication.findMany();
counts['drug_contraindication.csv'] = writeCsv(
  'drug_contraindication.csv',
  ['targetType', 'targetCode', 'severity', 'conditionType', 'conditionText', 'icd10',
   'ageMinDays', 'ageMaxDays', 'rationale', 'source', 'sourceCitation', 'isSeed', 'isProvisional', 'reviewedBy'],
  contra.map((r) => ({
    targetType: r.targetKind, targetCode: targetCode(r.targetKind, r.targetId),
    severity: r.severity, conditionType: r.conditionType, conditionText: r.conditionText,
    icd10: r.icd10Codes, ageMinDays: r.ageMinDays, ageMaxDays: r.ageMaxDays, rationale: r.rationale,
    source: r.source, sourceCitation: r.sourceCitation, isSeed: r.isSeed,
    isProvisional: r.isProvisional, reviewedBy: r.reviewedByUserId,
  })),
);

const inter = await prisma.drugInteraction.findMany();
counts['drug_interaction.csv'] = writeCsv(
  'drug_interaction.csv',
  ['subjectType', 'subjectCode', 'counterpartType', 'counterpartRef', 'severity',
   'mechanism', 'clinicalEffect', 'management', 'source', 'sourceCitation', 'isSeed', 'isProvisional', 'reviewedBy'],
  inter.map((r) => ({
    subjectType: r.subjectKind, subjectCode: targetCode(r.subjectKind, r.subjectId),
    counterpartType: r.counterpartType, counterpartRef: r.counterpartRef,
    severity: r.severity, mechanism: r.mechanism, clinicalEffect: r.clinicalEffect,
    management: r.management, source: r.source, sourceCitation: r.sourceCitation,
    isSeed: r.isSeed, isProvisional: r.isProvisional, reviewedBy: r.reviewedByUserId,
  })),
);

const dos = await prisma.drugDosage.findMany();
counts['drug_dosage.csv'] = writeCsv(
  'drug_dosage.csv',
  ['targetType', 'targetCode', 'population', 'route', 'usualDoseDaily', 'maxDoseSingle',
   'maxDoseDaily', 'dosageText', 'source', 'sourceCitation', 'isSeed', 'isProvisional', 'reviewedBy'],
  dos.map((r) => ({
    targetType: r.targetKind, targetCode: targetCode(r.targetKind, r.targetId),
    population: r.population, route: r.route, usualDoseDaily: r.usualDoseDaily,
    maxDoseSingle: r.maxDoseSingle, maxDoseDaily: r.maxDoseDaily, dosageText: r.dosageText,
    source: r.source, sourceCitation: r.sourceCitation, isSeed: r.isSeed,
    isProvisional: r.isProvisional, reviewedBy: r.reviewedByUserId,
  })),
);

const manifest = {
  format: 'medixus-drug-bundle',
  version: 1,
  generatedAt: new Date().toISOString(),
  source: 'curated+common (current DB export)',
  note: '公式レセ電 医薬品マスター / PMDA電子添文 / 商用DB を取込後に再exportすれば全件版になる',
  files: Object.entries(counts).map(([name, rows]) => ({ name, rows })),
};
writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

await prisma.$disconnect();
console.log(`[export] ${outDir}`);
for (const [k, v] of Object.entries(counts)) console.log(`  ${k}: ${v}`);
console.log('  manifest.json');
