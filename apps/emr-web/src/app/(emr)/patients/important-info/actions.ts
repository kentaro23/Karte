'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { age } from '@medixus/domain';
import { requireSession } from '@/lib/session';

// ──────────────────────────────────────────────────────────────────────────
// FR-PAT-02 重要情報（アレルギー/感染症/既往/家族歴）登録 — 増築
//   薬剤アレルギー・副作用薬を「医薬品マスタ実検索」で選び、成分コード
//   (Allergy.ingredientCode) を紐付ける。これにより処方安全エンジン
//   (order-checks/engine.ts の ALLERGY 判定) が当該成分処方を BLOCKED とする。
//   すべての取得/更新は DB 未接続でも画面が出るよう fail-soft（try/catch・
//   {error} 返却・デモデータ補完）。
// ──────────────────────────────────────────────────────────────────────────

export interface ImportantPatient {
  id: string;
  patientNo: string;
  name: string;
  kana: string;
  gender: string;
  age: number;
}

export interface AllergyRow {
  id: string;
  type: 'DRUG' | 'FOOD' | 'OTHER';
  substance: string;
  /** 成分コード（DrugIngredient.ingredientCode）。これがあると安全エンジンが連動。 */
  ingredientCode: string | null;
  reaction: string | null;
  severity: string | null;
}
export interface InfectionRow {
  id: string;
  pathogen: string;
  status: string;
}
export interface HistoryRow {
  id: string;
  kind: string;
  name: string;
}
export interface FamilyRow {
  id: string;
  relation: string;
  name: string | null;
  status: string | null;
}

export interface ImportantInfo {
  /** 患者ピッカー用の一覧（先頭が既定選択）。 */
  patients: ImportantPatient[];
  /** 選択中の患者ID（DB 空ならデモ患者ID）。 */
  selectedId: string | null;
  allergies: AllergyRow[];
  infections: InfectionRow[];
  histories: HistoryRow[];
  family: FamilyRow[];
  /** DB 未接続フラグ（画面で注意表示）。 */
  demo: boolean;
}

// フロントのみモード（DB 無）でも画面を出すためのデモデータ。
const DEMO_PATIENTS: ImportantPatient[] = [
  { id: 'demo-pat-1', patientNo: '000123', name: '見本 太郎', kana: 'ミホン タロウ', gender: '男性', age: 58 },
  { id: 'demo-pat-2', patientNo: '000124', name: '標本 花子', kana: 'ヒョウホン ハナコ', gender: '女性', age: 42 },
];
const DEMO_INFO: Omit<ImportantInfo, 'patients' | 'selectedId' | 'demo'> = {
  allergies: [
    {
      id: 'demo-al-1',
      type: 'DRUG',
      substance: 'アモキシシリン水和物',
      ingredientCode: '6131001',
      reaction: '蕁麻疹',
      severity: 'SEVERE',
    },
    { id: 'demo-al-2', type: 'FOOD', substance: '甲殻類', ingredientCode: null, reaction: '口腔内違和感', severity: 'MILD' },
  ],
  infections: [{ id: 'demo-if-1', pathogen: 'HBs抗原', status: '陽性' }],
  histories: [{ id: 'demo-hx-1', kind: 'PAST_ILLNESS', name: '高血圧症' }],
  family: [{ id: 'demo-fm-1', relation: '父', name: null, status: '糖尿病' }],
};

function demoInfo(selectedId: string | null): ImportantInfo {
  return {
    patients: DEMO_PATIENTS,
    selectedId: selectedId ?? DEMO_PATIENTS[0]?.id ?? '',
    ...DEMO_INFO,
    demo: true,
  };
}

/** 患者一覧＋選択患者の重要情報を取得（fail-soft）。 */
export async function loadImportantInfo(patientId?: string): Promise<ImportantInfo> {
  try {
    await requireSession();
    const patients = await prisma.patient.findMany({
      orderBy: { createdAt: 'asc' },
      take: 200,
      select: {
        id: true,
        patientNo: true,
        kanjiLastName: true,
        kanjiFirstName: true,
        kanaLastName: true,
        kanaFirstName: true,
        gender: true,
        dateOfBirth: true,
      },
    });
    if (patients.length === 0) return demoInfo(patientId ?? null);

    const selectedId = patientId && patients.some((p) => p.id === patientId) ? patientId : (patients[0]?.id ?? '');
    const [allergies, infections, histories, family] = await Promise.all([
      prisma.allergy.findMany({ where: { patientId: selectedId }, orderBy: { recordedAt: 'desc' } }),
      prisma.infection.findMany({ where: { patientId: selectedId } }),
      prisma.medicalHistory.findMany({ where: { patientId: selectedId } }),
      prisma.familyMember.findMany({ where: { patientId: selectedId } }),
    ]);

    return {
      patients: patients.map((p) => ({
        id: p.id,
        patientNo: p.patientNo,
        name: `${p.kanjiLastName} ${p.kanjiFirstName}`,
        kana: `${p.kanaLastName} ${p.kanaFirstName}`,
        gender: p.gender === 'MALE' ? '男性' : p.gender === 'FEMALE' ? '女性' : '—',
        age: age(p.dateOfBirth),
      })),
      selectedId,
      allergies: allergies.map((a) => ({
        id: a.id,
        type: a.type,
        substance: a.substance,
        ingredientCode: a.ingredientCode,
        reaction: a.reaction,
        severity: a.severity,
      })),
      infections: infections.map((i) => ({ id: i.id, pathogen: i.pathogen, status: i.status })),
      histories: histories.map((h) => ({ id: h.id, kind: h.kind, name: h.name })),
      family: family.map((f) => ({ id: f.id, relation: f.relation, name: f.name, status: f.status })),
      demo: false,
    };
  } catch (err) {
    console.error('[important-info] loadImportantInfo failed (fail-soft):', err);
    return demoInfo(patientId ?? null);
  }
}

/** マスタ実検索の候補（成分コード付き）。 */
export interface DrugAllergyCandidate {
  productId: string;
  receiptCode: string;
  brandName: string;
  genericName: string | null;
  /** 当該製剤の有効成分（成分コード＋成分名）。アレルギー紐付けの本体。 */
  ingredients: { code: string; name: string }[];
}

/**
 * 医薬品マスタ（DrugProduct）をキーワード実検索し、各製剤の有効成分
 * （DrugIngredient.ingredientCode / ingredientName）を返す（FR-PAT-02 増築）。
 * DB 未接続でも画面が止まらないよう fail-soft（[] / デモ候補）。
 */
export async function searchDrugForAllergy(q: string): Promise<DrugAllergyCandidate[]> {
  const term = (q ?? '').trim();
  if (!term) return [];
  try {
    const drugs = await prisma.drugProduct.findMany({
      where: {
        OR: [
          { brandName: { contains: term, mode: 'insensitive' } },
          { brandNameKana: { contains: term, mode: 'insensitive' } },
          { genericName: { contains: term, mode: 'insensitive' } },
        ],
      },
      orderBy: { brandName: 'asc' },
      take: 40,
      select: {
        id: true,
        receiptCode: true,
        brandName: true,
        genericName: true,
        ingredients: {
          where: { isActive: true },
          select: { ingredient: { select: { ingredientCode: true, ingredientName: true } } },
        },
      },
    });
    if (drugs.length === 0) return demoDrugCandidates(term);
    return drugs.map((d) => ({
      productId: d.id,
      receiptCode: d.receiptCode,
      brandName: d.brandName,
      genericName: d.genericName,
      ingredients: d.ingredients.map((pi) => ({
        code: pi.ingredient.ingredientCode,
        name: pi.ingredient.ingredientName,
      })),
    }));
  } catch (err) {
    console.error('[important-info] searchDrugForAllergy failed (fail-soft):', err);
    return demoDrugCandidates(term);
  }
}

// DB 未接続時の最小デモ候補（成分コードを持つ＝安全エンジン連動を実演できる）。
function demoDrugCandidates(term: string): DrugAllergyCandidate[] {
  const all: DrugAllergyCandidate[] = [
    {
      productId: 'demo-d1',
      receiptCode: '610406001',
      brandName: 'サワシリンカプセル250',
      genericName: 'アモキシシリン水和物',
      ingredients: [{ code: '6131001', name: 'アモキシシリン水和物' }],
    },
    {
      productId: 'demo-d2',
      receiptCode: '620098001',
      brandName: 'メイアクトMS錠100mg',
      genericName: 'セフジトレンピボキシル',
      ingredients: [{ code: '6132012', name: 'セフジトレンピボキシル' }],
    },
    {
      productId: 'demo-d3',
      receiptCode: '610463001',
      brandName: 'カロナール錠500',
      genericName: 'アセトアミノフェン',
      ingredients: [{ code: '1141007', name: 'アセトアミノフェン' }],
    },
  ];
  const t = term.toLowerCase();
  return all.filter(
    (d) =>
      d.brandName.toLowerCase().includes(t) ||
      (d.genericName ?? '').toLowerCase().includes(t) ||
      d.ingredients.some((g) => g.name.toLowerCase().includes(t)),
  );
}

export interface AddDrugAllergyInput {
  patientId: string;
  /** 表示用物質名（製剤名 or 成分名）。 */
  substance: string;
  /** 成分コード（DrugIngredient.ingredientCode）。安全エンジン連動の鍵。 */
  ingredientCode: string;
  reaction?: string;
  severity?: string;
}

/**
 * 成分コード付き薬剤アレルギーを登録（FR-PAT-02 AC(1)(2)）。
 * type='DRUG' + ingredientCode を保存することで、当該成分を含む処方が
 * 処方安全チェック（ALLERGY）で BLOCKED 判定される。
 */
export async function addDrugAllergy(input: AddDrugAllergyInput) {
  try {
    const s = await requireSession();
    const substance = input.substance.trim();
    const ingredientCode = input.ingredientCode.trim();
    if (!input.patientId) return { error: '患者が未選択です' };
    if (!ingredientCode) return { error: '成分コードが未指定です（医薬品マスタから選択してください）' };
    if (!substance) return { error: '物質名が未入力です' };

    const created = await prisma.allergy.create({
      data: {
        patientId: input.patientId,
        type: 'DRUG',
        substance,
        ingredientCode,
        reaction: input.reaction?.trim() || null,
        severity: input.severity?.trim() || null,
      },
    });
    await writeAudit({
      actorUserId: s.userId,
      patientId: input.patientId,
      action: 'CHART_WRITE',
      resource: 'Allergy',
      resourceId: created.id,
      detail: { type: 'DRUG', substance, ingredientCode },
    });
    revalidatePath('/patients/important-info');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'アレルギー登録に失敗しました' };
  }
}

/** 食物/その他アレルギーを登録（成分コードなし＝表示・注意喚起用）。 */
export async function addNonDrugAllergy(input: {
  patientId: string;
  type: 'FOOD' | 'OTHER';
  substance: string;
  reaction?: string;
  severity?: string;
}) {
  try {
    const s = await requireSession();
    const substance = input.substance.trim();
    if (!input.patientId) return { error: '患者が未選択です' };
    if (!substance) return { error: '物質名が未入力です' };
    const created = await prisma.allergy.create({
      data: {
        patientId: input.patientId,
        type: input.type,
        substance,
        reaction: input.reaction?.trim() || null,
        severity: input.severity?.trim() || null,
      },
    });
    await writeAudit({
      actorUserId: s.userId,
      patientId: input.patientId,
      action: 'CHART_WRITE',
      resource: 'Allergy',
      resourceId: created.id,
      detail: { type: input.type, substance },
    });
    revalidatePath('/patients/important-info');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'アレルギー登録に失敗しました' };
  }
}

/** 感染症を登録。 */
export async function addInfection(input: { patientId: string; pathogen: string; status: string }) {
  try {
    const s = await requireSession();
    const pathogen = input.pathogen.trim();
    if (!input.patientId) return { error: '患者が未選択です' };
    if (!pathogen) return { error: '病原体が未入力です' };
    const created = await prisma.infection.create({
      data: { patientId: input.patientId, pathogen, status: input.status.trim() || '不明' },
    });
    await writeAudit({
      actorUserId: s.userId,
      patientId: input.patientId,
      action: 'CHART_WRITE',
      resource: 'Infection',
      resourceId: created.id,
      detail: { pathogen },
    });
    revalidatePath('/patients/important-info');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : '感染症登録に失敗しました' };
  }
}

/** 既往歴/手術歴等を登録。 */
export async function addHistory(input: { patientId: string; kind: string; name: string }) {
  try {
    const s = await requireSession();
    const name = input.name.trim();
    if (!input.patientId) return { error: '患者が未選択です' };
    if (!name) return { error: '内容が未入力です' };
    const created = await prisma.medicalHistory.create({
      data: { patientId: input.patientId, kind: input.kind || 'PAST_ILLNESS', name },
    });
    await writeAudit({
      actorUserId: s.userId,
      patientId: input.patientId,
      action: 'CHART_WRITE',
      resource: 'MedicalHistory',
      resourceId: created.id,
      detail: { kind: input.kind, name },
    });
    revalidatePath('/patients/important-info');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : '既往歴登録に失敗しました' };
  }
}

/** 家族歴を登録。 */
export async function addFamily(input: { patientId: string; relation: string; status: string }) {
  try {
    const s = await requireSession();
    if (!input.patientId) return { error: '患者が未選択です' };
    if (!input.relation.trim()) return { error: '続柄が未入力です' };
    const created = await prisma.familyMember.create({
      data: {
        patientId: input.patientId,
        relation: input.relation.trim(),
        status: input.status.trim() || null,
      },
    });
    await writeAudit({
      actorUserId: s.userId,
      patientId: input.patientId,
      action: 'CHART_WRITE',
      resource: 'FamilyMember',
      resourceId: created.id,
      detail: { relation: input.relation },
    });
    revalidatePath('/patients/important-info');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : '家族歴登録に失敗しました' };
  }
}

/** 重要情報の1件削除（Allergy/Infection/MedicalHistory/FamilyMember は追記専用対象外）。 */
export async function removeImportantItem(
  kind: 'allergy' | 'infection' | 'history' | 'family',
  id: string,
) {
  try {
    const s = await requireSession();
    if (!id) return { error: 'IDが未指定です' };
    if (kind === 'allergy') await prisma.allergy.delete({ where: { id } });
    else if (kind === 'infection') await prisma.infection.delete({ where: { id } });
    else if (kind === 'history') await prisma.medicalHistory.delete({ where: { id } });
    else await prisma.familyMember.delete({ where: { id } });
    await writeAudit({
      actorUserId: s.userId,
      action: 'CHART_WRITE',
      resource: `ImportantInfo.${kind}.delete`,
      resourceId: id,
    });
    revalidatePath('/patients/important-info');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : '削除に失敗しました' };
  }
}
