/**
 * Curated drug master subset — conservative, textbook-stable facts transcribed
 * from public Japanese package inserts (PMDA 医療用医薬品 添付文書). NOT AI-derived.
 * Every safety row is source=CURATED_SEED, isSeed=true, isProvisional=true (replaced
 * when the official PMDA structured import runs) and carries a sourceCitation.
 * Reviewer (薬剤師) is supplied at load time.
 */
import type { DrugDataSource } from '@medixus/db';
import {
  upsertIngredient,
  upsertDrugProduct,
  linkProductIngredient,
  addContraindication,
  addInteraction,
  addDosage,
  addIndication,
} from './drug-loader.js';
import { COMMON_DRUGS } from './common-drugs.js';
import { INDICATION_BY_ICD10, ICD10_LABEL } from './indications.js';

const SRC: DrugDataSource = 'CURATED_SEED';
const cite = (brand: string) => `PMDA 医療用医薬品 添付文書（${brand}）標準的記載 — 暫定seed`;

const INGREDIENTS = [
  { ingredientCode: 'ING_WARFARIN', ingredientName: 'ワルファリンカリウム', ingredientNameKana: 'ワルファリンカリウム', ingredientNameEn: 'Warfarin potassium' },
  { ingredientCode: 'ING_AMLODIPINE', ingredientName: 'アムロジピンベシル酸塩', ingredientNameKana: 'アムロジピンベシルサンエン', ingredientNameEn: 'Amlodipine besilate' },
  { ingredientCode: 'ING_ACETAMINOPHEN', ingredientName: 'アセトアミノフェン', ingredientNameKana: 'アセトアミノフェン', ingredientNameEn: 'Acetaminophen' },
  { ingredientCode: 'ING_LOXOPROFEN', ingredientName: 'ロキソプロフェンナトリウム水和物', ingredientNameKana: 'ロキソプロフェンナトリウム', ingredientNameEn: 'Loxoprofen sodium' },
  { ingredientCode: 'ING_ASPIRIN', ingredientName: 'アスピリン', ingredientNameKana: 'アスピリン', ingredientNameEn: 'Aspirin' },
  { ingredientCode: 'ING_LANSOPRAZOLE', ingredientName: 'ランソプラゾール', ingredientNameKana: 'ランソプラゾール', ingredientNameEn: 'Lansoprazole' },
  { ingredientCode: 'ING_AMOXICILLIN', ingredientName: 'アモキシシリン水和物', ingredientNameKana: 'アモキシシリン', ingredientNameEn: 'Amoxicillin hydrate' },
  { ingredientCode: 'ING_METFORMIN', ingredientName: 'メトホルミン塩酸塩', ingredientNameKana: 'メトホルミンエンサンエン', ingredientNameEn: 'Metformin hydrochloride' },
  { ingredientCode: 'ING_ROSUVASTATIN', ingredientName: 'ロスバスタチンカルシウム', ingredientNameKana: 'ロスバスタチンカルシウム', ingredientNameEn: 'Rosuvastatin calcium' },
  { ingredientCode: 'ING_LEVOFLOXACIN', ingredientName: 'レボフロキサシン水和物', ingredientNameKana: 'レボフロキサシン', ingredientNameEn: 'Levofloxacin hydrate' },
];

interface SeedProduct {
  receiptCode: string;
  brandName: string;
  brandNameKana: string;
  genericName: string;
  strengthValue: number;
  strengthUnit: string;
  dosageForm: string;
  administrationRoute: string;
  unitCode: string;
  nhiPrice: number;
  isGeneric?: boolean;
  atcCode?: string;
  ingredient: string; // INGREDIENT code
}

const PRODUCTS: SeedProduct[] = [
  { receiptCode: '610406001', brandName: 'ワーファリン錠1mg', brandNameKana: 'ワーファリンジョウ', genericName: 'ワルファリンカリウム錠', strengthValue: 1, strengthUnit: 'mg', dosageForm: '錠', administrationRoute: '内服', unitCode: '錠', nhiPrice: 9.8, atcCode: 'B01AA03', ingredient: 'ING_WARFARIN' },
  { receiptCode: '610463001', brandName: 'アムロジン錠5mg', brandNameKana: 'アムロジンジョウ', genericName: 'アムロジピンベシル酸塩錠', strengthValue: 5, strengthUnit: 'mg', dosageForm: '錠', administrationRoute: '内服', unitCode: '錠', nhiPrice: 14.5, atcCode: 'C08CA01', ingredient: 'ING_AMLODIPINE' },
  { receiptCode: '620098701', brandName: 'ノルバスク錠5mg', brandNameKana: 'ノルバスクジョウ', genericName: 'アムロジピンベシル酸塩錠', strengthValue: 5, strengthUnit: 'mg', dosageForm: '錠', administrationRoute: '内服', unitCode: '錠', nhiPrice: 14.5, atcCode: 'C08CA01', ingredient: 'ING_AMLODIPINE' },
  { receiptCode: '620004532', brandName: 'カロナール錠500', brandNameKana: 'カロナールジョウ', genericName: 'アセトアミノフェン錠', strengthValue: 500, strengthUnit: 'mg', dosageForm: '錠', administrationRoute: '内服', unitCode: '錠', nhiPrice: 7.9, atcCode: 'N02BE01', ingredient: 'ING_ACETAMINOPHEN' },
  { receiptCode: '620098001', brandName: 'ロキソニン錠60mg', brandNameKana: 'ロキソニンジョウ', genericName: 'ロキソプロフェンNa錠', strengthValue: 60, strengthUnit: 'mg', dosageForm: '錠', administrationRoute: '内服', unitCode: '錠', nhiPrice: 10.1, atcCode: 'M01AE', ingredient: 'ING_LOXOPROFEN' },
  { receiptCode: '610463111', brandName: 'バイアスピリン錠100mg', brandNameKana: 'バイアスピリンジョウ', genericName: 'アスピリン腸溶錠', strengthValue: 100, strengthUnit: 'mg', dosageForm: '錠', administrationRoute: '内服', unitCode: '錠', nhiPrice: 5.7, atcCode: 'B01AC06', ingredient: 'ING_ASPIRIN' },
  { receiptCode: '620004021', brandName: 'タケプロンOD錠15', brandNameKana: 'タケプロンODジョウ', genericName: 'ランソプラゾールOD錠', strengthValue: 15, strengthUnit: 'mg', dosageForm: '口腔内崩壊錠', administrationRoute: '内服', unitCode: '錠', nhiPrice: 23.9, atcCode: 'A02BC03', ingredient: 'ING_LANSOPRAZOLE' },
  { receiptCode: '610406777', brandName: 'サワシリンカプセル250', brandNameKana: 'サワシリンカプセル', genericName: 'アモキシシリンカプセル', strengthValue: 250, strengthUnit: 'mg', dosageForm: 'カプセル', administrationRoute: '内服', unitCode: 'カプセル', nhiPrice: 9.4, atcCode: 'J01CA04', ingredient: 'ING_AMOXICILLIN' },
  { receiptCode: '622260101', brandName: 'メトグルコ錠250mg', brandNameKana: 'メトグルコジョウ', genericName: 'メトホルミン塩酸塩錠', strengthValue: 250, strengthUnit: 'mg', dosageForm: '錠', administrationRoute: '内服', unitCode: '錠', nhiPrice: 10.1, atcCode: 'A10BA02', ingredient: 'ING_METFORMIN' },
  { receiptCode: '621984501', brandName: 'クレストール錠2.5mg', brandNameKana: 'クレストールジョウ', genericName: 'ロスバスタチン錠', strengthValue: 2.5, strengthUnit: 'mg', dosageForm: '錠', administrationRoute: '内服', unitCode: '錠', nhiPrice: 27.5, atcCode: 'C10AA07', ingredient: 'ING_ROSUVASTATIN' },
];

export interface CuratedResult {
  productIdByBrand: Record<string, string>;
  ingredientIdByCode: Record<string, string>;
  counts: { ingredients: number; products: number; safety: number; indications?: number };
}

export async function loadCuratedDrugMaster(reviewerUserId: string): Promise<CuratedResult> {
  const ingredientIdByCode: Record<string, string> = {};
  for (const ing of INGREDIENTS) {
    ingredientIdByCode[ing.ingredientCode] = await upsertIngredient(ing);
  }

  const productIdByBrand: Record<string, string> = {};
  for (const p of PRODUCTS) {
    const id = await upsertDrugProduct({
      receiptCode: p.receiptCode,
      brandName: p.brandName,
      brandNameKana: p.brandNameKana,
      genericName: p.genericName,
      strengthValue: p.strengthValue,
      strengthUnit: p.strengthUnit,
      dosageForm: p.dosageForm,
      administrationRoute: p.administrationRoute,
      unitCode: p.unitCode,
      nhiPrice: p.nhiPrice,
      isGeneric: p.isGeneric ?? false,
      atcCode: p.atcCode,
      sourceMasterVersion: 'CURATED_SEED:2026.05',
      provenance: { source: 'CURATED_SEED', note: 'subset pending official MHLW receipt import' },
    });
    productIdByBrand[p.brandName] = id;
    await linkProductIngredient(id, ingredientIdByCode[p.ingredient]!, {
      amountValue: p.strengthValue,
      amountUnit: p.strengthUnit,
      isActive: true,
    });
  }

  const prov = (brand: string) => ({
    source: SRC,
    sourceCitation: cite(brand),
    reviewedByUserId: reviewerUserId,
    isSeed: true,
    isProvisional: true,
  });
  let safety = 0;

  // Warfarin — pregnancy absolute contraindication (催奇形性・出血)
  await addContraindication(
    { kind: 'INGREDIENT', id: ingredientIdByCode['ING_WARFARIN']! },
    { severity: 'ABSOLUTE', conditionType: 'PREGNANCY', conditionText: '妊婦又は妊娠している可能性のある女性：催奇形性及び胎児・新生児の出血', rationale: '胎盤通過・催奇形性' },
    prov('ワーファリン'),
  );
  safety++;
  // Warfarin × NSAID(loxoprofen) — bleeding potentiation (併用注意)
  await addInteraction(
    { kind: 'INGREDIENT', id: ingredientIdByCode['ING_WARFARIN']! },
    { counterpartType: 'DRUG_INGREDIENT', counterpartRef: { ingredientCodes: ['ING_LOXOPROFEN', 'ING_ASPIRIN'] }, severity: 'CAUTION_COMBO', mechanism: '血小板凝集抑制・抗凝血作用増強', clinicalEffect: '出血傾向の増強', management: 'PT-INRをモニタし減量を考慮' },
    prov('ワーファリン'),
  );
  safety++;
  // Warfarin × vitamin-K foods — efficacy reduction (併用注意 / 食品)
  await addInteraction(
    { kind: 'INGREDIENT', id: ingredientIdByCode['ING_WARFARIN']! },
    { counterpartType: 'FOOD', counterpartRef: { food: '納豆・クロレラ・青汁（ビタミンK含有食品）' }, severity: 'CAUTION_COMBO', mechanism: 'ビタミンK摂取', clinicalEffect: '抗凝血作用の減弱', management: '当該食品の摂取を避ける' },
    prov('ワーファリン'),
  );
  safety++;
  // Aspirin — pediatric Reye caution (年齢, relative)
  await addContraindication(
    { kind: 'INGREDIENT', id: ingredientIdByCode['ING_ASPIRIN']! },
    { severity: 'RELATIVE', conditionType: 'AGE', conditionText: '小児（特に水痘・インフルエンザ）：ライ症候群', ageMaxDays: 15 * 365, rationale: 'ライ症候群との関連' },
    prov('バイアスピリン'),
  );
  safety++;
  // Acetaminophen — adult dose ceiling (極量) — standard JP package insert
  await addDosage(
    { kind: 'INGREDIENT', id: ingredientIdByCode['ING_ACETAMINOPHEN']! },
    { population: 'ADULT', route: '内服', usualDoseDaily: 1500, maxDoseSingle: 1000, maxDoseDaily: 4000, dosageText: '1回300〜1000mg、投与間隔4〜6時間以上、1日総量4000mgを限度' },
    prov('カロナール'),
  );
  safety++;
  // Loxoprofen — usual/max daily (極量)
  await addDosage(
    { kind: 'INGREDIENT', id: ingredientIdByCode['ING_LOXOPROFEN']! },
    { population: 'ADULT', route: '内服', usualDoseDaily: 180, maxDoseSingle: 60, maxDoseDaily: 180, dosageText: '1回60mg 1日3回（頓用は1回60〜120mg）' },
    prov('ロキソニン'),
  );
  safety++;
  // Amlodipine — max daily (極量)
  await addDosage(
    { kind: 'INGREDIENT', id: ingredientIdByCode['ING_AMLODIPINE']! },
    { population: 'ADULT', route: '内服', usualDoseDaily: 5, maxDoseSingle: 10, maxDoseDaily: 10, dosageText: '1日1回2.5〜5mg、効果不十分時1日1回10mgまで' },
    prov('アムロジン'),
  );
  safety++;
  // Metformin × alcohol — lactic acidosis caution (食品)
  await addInteraction(
    { kind: 'INGREDIENT', id: ingredientIdByCode['ING_METFORMIN']! },
    { counterpartType: 'FOOD', counterpartRef: { food: '過度のアルコール摂取' }, severity: 'CAUTION_COMBO', mechanism: '肝での乳酸代謝障害', clinicalEffect: '乳酸アシドーシスのリスク', management: '過度の飲酒を避ける' },
    prov('メトグルコ'),
  );
  safety++;
  // Indications (適応＝現在適応) — a few, insurance-applicable
  await addIndication(
    { kind: 'INGREDIENT', id: ingredientIdByCode['ING_ACETAMINOPHEN']! },
    { indicationText: '各種疾患及び症状における鎮痛、急性上気道炎の解熱・鎮痛', isInsuranceApplicable: true },
    prov('カロナール'),
  );
  safety++;
  await addIndication(
    { kind: 'INGREDIENT', id: ingredientIdByCode['ING_AMOXICILLIN']! },
    { indicationText: '感受性菌による各種感染症（咽頭・喉頭炎、扁桃炎、肺炎 等）', isInsuranceApplicable: true },
    prov('サワシリン'),
  );
  safety++;
  await addIndication(
    { kind: 'INGREDIENT', id: ingredientIdByCode['ING_AMLODIPINE']! },
    { indicationText: '高血圧症、狭心症', isInsuranceApplicable: true },
    prov('アムロジン'),
  );
  safety++;

  // ── 頻用医薬品の拡充（コード/名称/剤形のみ・安全データ未付与＝処方時 要確認WARNING）──
  let extra = 0;
  for (const d of COMMON_DRUGS) {
    if (ingredientIdByCode[d.ingredientCode] === undefined) {
      ingredientIdByCode[d.ingredientCode] = await upsertIngredient({
        ingredientCode: d.ingredientCode,
        ingredientName: d.ingredientName,
        ingredientNameKana: d.brandNameKana,
      });
    }
    const pid = await upsertDrugProduct({
      receiptCode: d.receiptCode,
      brandName: d.brandName,
      brandNameKana: d.brandNameKana,
      genericName: d.genericName,
      strengthValue: d.strengthValue,
      strengthUnit: d.strengthUnit,
      dosageForm: d.dosageForm,
      administrationRoute: d.route,
      unitCode: d.strengthUnit,
      atcCode: d.atcCode,
      sourceMasterVersion: 'CURATED_SEED:common:2026.05',
      provenance: { source: 'CURATED_SEED', note: 'common-drugs subset; replace via importReceiptDrugMaster' },
    });
    if (productIdByBrand[d.brandName] === undefined) productIdByBrand[d.brandName] = pid;
    await linkProductIngredient(pid, ingredientIdByCode[d.ingredientCode]!, {
      amountValue: d.strengthValue,
      amountUnit: d.strengthUnit,
      isActive: true,
    });
    extra++;
  }

  // ── 適応（ICD10→成分）シード（病名→適応薬リコメンドの根拠）──
  let indications = 0;
  for (const [icd10, ingCodes] of Object.entries(INDICATION_BY_ICD10)) {
    for (const code of ingCodes) {
      const id = ingredientIdByCode[code];
      if (!id) continue;
      await addIndication(
        { kind: 'INGREDIENT', id },
        {
          indicationText: `${ICD10_LABEL[icd10] ?? icd10} の適応`,
          icd10Codes: [icd10],
          isInsuranceApplicable: true,
        },
        {
          source: SRC,
          sourceCitation: `添付文書 効能・効果（${ICD10_LABEL[icd10] ?? icd10}）標準的記載 — 暫定seed`,
          reviewedByUserId: reviewerUserId,
          isSeed: true,
          isProvisional: true,
        },
      );
      indications++;
    }
  }

  return {
    productIdByBrand,
    ingredientIdByCode,
    counts: {
      ingredients: Object.keys(ingredientIdByCode).length,
      products: PRODUCTS.length + extra,
      safety,
      indications,
    },
  };
}
