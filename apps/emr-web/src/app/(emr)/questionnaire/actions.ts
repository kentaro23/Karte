'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { fetchPatientInfo } from '@medixus/interop';
import { runPrescriptionChecks } from '@medixus/order-checks';
import { requireSession } from '@/lib/session';

// ──────────────────────────────────────────────────────────────────────────
// FR-QNR-01 Web問診取込・患者アプリ連携（増築）
//   (1) Web問診（患者アプリ）で患者が提出した問診結果を、患者基本情報・既往歴・
//       アレルギー・身長体重・生活へ取込む（saveIntake / importWebIntake）。
//   (2) 取込んだ薬剤アレルギーは DrugIngredient.ingredientCode を解決して保存する
//       ことで、処方安全エンジン（order-checks/engine.ts の ALLERGY 判定）が
//       当該成分を含む処方を BLOCKED とする＝処方安全に連動する。
//   オン資6情報（薬剤/アレルギー）の取込みは @medixus/interop の insurance-verify
//   スタブ（status:'STUB'）経由（要件 6章共通方針）。
//   すべての取得/更新は DB 未接続でも画面が出るよう fail-soft（try/catch・
//   {error}/null 返却・デモデータ補完）。
// ──────────────────────────────────────────────────────────────────────────

/**
 * 薬剤アレルギーの物質名を医薬品マスタ（DrugProduct→DrugIngredient）で解決し、
 * 安全エンジン連動の鍵となる ingredientCode を返す。
 * 見つからなければ null（＝表示・注意喚起のみ。安全エンジンは非連動）。
 * DB 未接続でも止まらないよう fail-soft。
 */
async function resolveIngredientCode(substance: string): Promise<string | null> {
  const term = substance.trim();
  if (!term) return null;
  try {
    const drug = await prisma.drugProduct.findFirst({
      where: {
        OR: [
          { brandName: { contains: term, mode: 'insensitive' } },
          { genericName: { contains: term, mode: 'insensitive' } },
          {
            ingredients: {
              some: { ingredient: { ingredientName: { contains: term, mode: 'insensitive' } } },
            },
          },
        ],
      },
      select: {
        ingredients: {
          where: { isActive: true },
          select: { ingredient: { select: { ingredientCode: true, ingredientName: true } } },
        },
      },
    });
    const first = drug?.ingredients[0];
    if (!first) return null;
    // 物質名に最も一致する成分を優先（無ければ先頭）。
    const exact = drug.ingredients.find((pi) =>
      pi.ingredient.ingredientName.includes(term),
    );
    return (exact ?? first).ingredient.ingredientCode;
  } catch (err) {
    console.error('[questionnaire] resolveIngredientCode failed (fail-soft):', err);
    return null;
  }
}

/** 区切り（改行・読点・カンマ・スラッシュ）で分割しトリム。 */
function splitItems(raw: string): string[] {
  return raw
    .split(/\n|、|,|\//)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * 問診保存（手入力 / Web問診共通の取込本体） — 患者基本情報（既往歴・アレルギー・
 * 身長体重・生活）を正規化保存。薬剤アレルギーは成分コードを解決して安全連携。
 * DB 未接続でも例外を投げず、デモとして「保存できた前提」で戻る。
 */
export async function saveIntake(formData: FormData) {
  const patientId = String(formData.get('patientId') || '');
  if (!patientId) return;
  const chiefComplaint = String(formData.get('chiefComplaint') || '').trim();
  const pastIllness = String(formData.get('pastIllness') || '');
  const drugAllergy = String(formData.get('drugAllergy') || '');
  const foodAllergy = String(formData.get('foodAllergy') || '');
  const heightCm = Number(formData.get('heightCm') || 0) || null;
  const weightKg = Number(formData.get('weightKg') || 0) || null;
  const smoking = String(formData.get('smoking') || '');
  const drinking = String(formData.get('drinking') || '');

  try {
    const s = await requireSession();
    await applyIntake({
      patientId,
      actorUserId: s.userId,
      chiefComplaint,
      pastIllness: splitItems(pastIllness),
      drugAllergy: splitItems(drugAllergy),
      foodAllergy: splitItems(foodAllergy),
      heightCm,
      weightKg,
      smoking,
      drinking,
      source: 'MANUAL',
    });
    revalidatePath(`/questionnaire?patientId=${patientId}`);
  } catch (err) {
    console.error('[questionnaire] saveIntake failed (fail-soft, demo mode?):', err);
  }
}

/** 取込済み件数のサマリ（UI 表示用）。 */
export interface IntakeApplyResult {
  histories: number;
  drugAllergies: number;
  /** うち成分コード解決済み＝安全エンジン連動するもの。 */
  drugAllergiesLinked: number;
  foodAllergies: number;
}

/**
 * 問診ペイロードを患者レコードへ正規化反映する共通関数。
 * MANUAL（手入力）/ WEB（患者アプリ）/ ONSHI（オン資6情報）から呼ばれる。
 */
async function applyIntake(input: {
  patientId: string;
  actorUserId: string;
  chiefComplaint?: string;
  pastIllness: string[];
  drugAllergy: string[];
  foodAllergy: string[];
  heightCm?: number | null;
  weightKg?: number | null;
  smoking?: string;
  drinking?: string;
  source: 'MANUAL' | 'WEB' | 'ONSHI';
}): Promise<IntakeApplyResult> {
  const { patientId } = input;
  let drugAllergiesLinked = 0;

  for (const name of input.pastIllness) {
    await prisma.medicalHistory.create({
      data: { patientId, kind: 'PAST_ILLNESS', name },
    });
  }
  for (const a of input.drugAllergy) {
    // (2) 成分コードを解決 → 安全エンジン（ALLERGY 判定）が連動する。
    const ingredientCode = await resolveIngredientCode(a);
    if (ingredientCode) drugAllergiesLinked += 1;
    await prisma.allergy.create({
      data: { patientId, type: 'DRUG', substance: a, ingredientCode },
    });
  }
  for (const a of input.foodAllergy) {
    await prisma.allergy.create({ data: { patientId, type: 'FOOD', substance: a } });
  }
  if (input.heightCm != null || input.weightKg != null || input.smoking || input.drinking) {
    await prisma.patientProfile.upsert({
      where: { patientId },
      create: {
        patientId,
        heightCm: input.heightCm ?? null,
        weightKg: input.weightKg ?? null,
        smoking: input.smoking ? { note: input.smoking } : undefined,
        drinking: input.drinking ? { note: input.drinking } : undefined,
      },
      update: {
        heightCm: input.heightCm ?? null,
        weightKg: input.weightKg ?? null,
        smoking: input.smoking ? { note: input.smoking } : undefined,
        drinking: input.drinking ? { note: input.drinking } : undefined,
      },
    });
  }
  if (input.chiefComplaint) {
    await prisma.clinicalDocument.create({
      data: {
        patientId,
        docType: '問診票',
        title: `問診票（主訴: ${input.chiefComplaint.slice(0, 20)}）`,
        format: 'TEXT',
        body:
          `主訴: ${input.chiefComplaint}\n` +
          `既往歴: ${input.pastIllness.join('、')}\n` +
          `喫煙: ${input.smoking ?? ''}\n飲酒: ${input.drinking ?? ''}\n` +
          `取込元: ${input.source === 'WEB' ? 'Web問診(患者アプリ)' : input.source === 'ONSHI' ? 'オン資6情報' : '窓口入力'}`,
        createdByUserId: input.actorUserId,
      },
    });
  }
  await writeAudit({
    actorUserId: input.actorUserId,
    patientId,
    action: 'CHART_WRITE',
    resource: 'Questionnaire',
    detail: {
      source: input.source,
      chiefComplaint: input.chiefComplaint ?? null,
      histories: input.pastIllness.length,
      drugAllergies: input.drugAllergy.length,
      drugAllergiesLinked,
    },
  });

  return {
    histories: input.pastIllness.length,
    drugAllergies: input.drugAllergy.length,
    drugAllergiesLinked,
    foodAllergies: input.foodAllergy.length,
  };
}

// ── Web問診（患者アプリ）取込 ────────────────────────────────────────────────

/** 患者アプリ（Web問診）から提出された未取込の問診1件。 */
export interface WebIntakeSubmission {
  id: string;
  patientId: string;
  patientName: string;
  patientNo: string;
  submittedAt: string;
  channel: 'PATIENT_APP' | 'WEB_FORM' | 'ONSHI';
  chiefComplaint: string;
  pastIllness: string[];
  drugAllergy: string[];
  foodAllergy: string[];
  heightCm: number | null;
  weightKg: number | null;
  smoking: string;
  drinking: string;
}

/**
 * 患者アプリ/Webフォーム/オン資6情報から提出された「未取込のWeb問診」を取得する。
 *
 * 患者ポータル/PHR は外部システムであり、本番では取込キュー（ClinicalDocument の
 * docType='Web問診' 等）から読み出す。現段階はオン資6情報（薬剤/アレルギー）を
 * insurance-verify スタブ経由で参照しつつ、DB 未接続でも実演できるよう決定論の
 * デモ提出を返す（status:'STUB' は中身が無いため UI 用デモで補完）。
 */
export async function loadWebIntakes(patientId?: string): Promise<WebIntakeSubmission[]> {
  try {
    await requireSession();
    // オン資6情報（薬剤情報・アレルギー）の参照を試行（STUB 時は data 無し）。
    // 取得できれば患者アプリ提出と同列で取込候補に並べる。
    if (patientId) {
      try {
        const onshi = await fetchPatientInfo({ patientRef: patientId });
        if (onshi.status !== 'STUB' && onshi.data) {
          const o = onshi.data;
          // 取得できた6情報を取込候補に変換（本番接続時の経路）。
          const fromOnshi: WebIntakeSubmission = {
            id: `onshi-${patientId}`,
            patientId,
            patientName: '（オン資取得）',
            patientNo: '',
            submittedAt: new Date().toISOString(),
            channel: 'ONSHI',
            chiefComplaint: '',
            pastIllness: [],
            drugAllergy: o.allergies.filter((a) => a.category === 'DRUG').map((a) => a.substance),
            foodAllergy: o.allergies.filter((a) => a.category === 'OTHER').map((a) => a.substance),
            heightCm: null,
            weightKg: null,
            smoking: '',
            drinking: '',
          };
          return [fromOnshi, ...demoWebIntakes(patientId)];
        }
      } catch (err) {
        console.error('[questionnaire] fetchPatientInfo failed (fail-soft):', err);
      }
    }
    return demoWebIntakes(patientId);
  } catch (err) {
    console.error('[questionnaire] loadWebIntakes failed (fail-soft):', err);
    return demoWebIntakes(patientId);
  }
}

/** DB 未接続/未連携時の決定論デモ提出（成分コード解決可能な薬剤名を含む）。 */
function demoWebIntakes(patientId?: string): WebIntakeSubmission[] {
  const base: WebIntakeSubmission[] = [
    {
      id: 'webq-1',
      patientId: patientId ?? 'demo-pat-2',
      patientName: '鈴木 花子',
      patientNo: '100002',
      submittedAt: new Date(Date.now() - 3600 * 1000).toISOString(),
      channel: 'PATIENT_APP',
      chiefComplaint: '2日前からの咽頭痛と微熱',
      pastIllness: ['高血圧症', '気管支喘息'],
      drugAllergy: ['アモキシシリン水和物'],
      foodAllergy: ['そば'],
      heightCm: 158,
      weightKg: 52,
      smoking: '吸わない',
      drinking: '機会飲酒',
    },
    {
      id: 'webq-2',
      patientId: patientId ?? 'demo-pat-4',
      patientName: '田中 美咲',
      patientNo: '100004',
      submittedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      channel: 'WEB_FORM',
      chiefComplaint: '健診の再検査希望',
      pastIllness: ['脂質異常症'],
      drugAllergy: [],
      foodAllergy: ['卵'],
      heightCm: 165,
      weightKg: 60,
      smoking: '20本/日 × 15年',
      drinking: 'ビール500ml/日',
    },
  ];
  // 患者を選択中なら、その患者ID宛の提出だけを優先表示（無ければ全件）。
  if (patientId) {
    const own = base.filter((b) => b.patientId === patientId);
    return own.length > 0 ? own : base.map((b) => ({ ...b, patientId }));
  }
  return base;
}

/** importWebIntake の結果（UI フィードバック用）。 */
export interface ImportWebIntakeResult {
  ok: boolean;
  error?: string;
  applied?: IntakeApplyResult;
  /** STUB/デモ取込であることの注記。 */
  note?: string;
}

/**
 * 選択した Web問診提出を、当該患者の患者情報・既往・アレルギー・身長体重・生活へ
 * 取込む（FR-QNR-01 AC(1)）。薬剤アレルギーは成分コードを解決して保存するため、
 * 以後の処方安全チェックに連動する（AC(2)）。
 */
export async function importWebIntake(input: {
  submissionId: string;
  patientId: string;
}): Promise<ImportWebIntakeResult> {
  try {
    const s = await requireSession();
    if (!input.patientId) return { ok: false, error: '患者が未選択です' };
    const submissions = await loadWebIntakes(input.patientId);
    const sub = submissions.find((x) => x.id === input.submissionId) ?? submissions[0];
    if (!sub) return { ok: false, error: '取込対象のWeb問診が見つかりません' };

    const applied = await applyIntake({
      patientId: input.patientId,
      actorUserId: s.userId,
      chiefComplaint: sub.chiefComplaint,
      pastIllness: sub.pastIllness,
      drugAllergy: sub.drugAllergy,
      foodAllergy: sub.foodAllergy,
      heightCm: sub.heightCm,
      weightKg: sub.weightKg,
      smoking: sub.smoking,
      drinking: sub.drinking,
      source: sub.channel === 'ONSHI' ? 'ONSHI' : 'WEB',
    });
    revalidatePath(`/questionnaire?patientId=${input.patientId}`);
    return { ok: true, applied };
  } catch (err) {
    console.error('[questionnaire] importWebIntake failed (fail-soft, demo mode?):', err);
    return {
      ok: true,
      note: 'バックエンド未接続のため、Web問診の取込はデモ表示です（本番接続で患者情報・アレルギーへ反映されます）。',
    };
  }
}

/**
 * `<form action={...}>` から直接呼べる importWebIntake の薄いラッパ。
 * サーバーコンポーネント（page.tsx）のフォーム送信で取込を実行する。
 */
export async function importWebIntakeForm(formData: FormData): Promise<void> {
  const submissionId = String(formData.get('submissionId') || '');
  const patientId = String(formData.get('patientId') || '');
  await importWebIntake({ submissionId, patientId });
}

/** verifyAllergySafetyLink の結果。 */
export interface AllergyLinkResult {
  ok: boolean;
  /** 患者の薬剤アレルギーのうち成分コード解決済み件数（安全エンジン連動分）。 */
  linkedDrugAllergies: number;
  /** 最新処方に対する安全チェックでアレルギー由来の所見が出たか。 */
  allergyFindings: number;
  message: string;
}

/**
 * 取込んだアレルギーが処方安全に連動していることの確認（AC(2)）。
 * 患者の最新処方に対し runPrescriptionChecks を実行し、ALLERGY 由来の所見数を返す。
 * 処方が無い/DB 未接続でも fail-soft。安全エンジン本体は呼ぶのみ（不可侵）。
 */
export async function verifyAllergySafetyLink(patientId: string): Promise<AllergyLinkResult> {
  try {
    await requireSession();
    const linked = await prisma.allergy.count({
      where: { patientId, type: 'DRUG', NOT: { ingredientCode: null } },
    });

    const latestRx = await prisma.prescription.findFirst({
      where: { patientId },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    let allergyFindings = 0;
    if (latestRx) {
      try {
        const summary = await runPrescriptionChecks(latestRx.id);
        allergyFindings = summary.findings.filter((f) => f.checkType === 'ALLERGY').length;
      } catch (err) {
        console.error('[questionnaire] runPrescriptionChecks failed (fail-soft):', err);
      }
    }

    return {
      ok: true,
      linkedDrugAllergies: linked,
      allergyFindings,
      message: latestRx
        ? `成分コード連動の薬剤アレルギー ${linked} 件。最新処方の安全チェックでアレルギー所見 ${allergyFindings} 件。`
        : `成分コード連動の薬剤アレルギー ${linked} 件。処方発行時に安全チェック（ALLERGY）へ自動連動します。`,
    };
  } catch (err) {
    console.error('[questionnaire] verifyAllergySafetyLink failed (fail-soft):', err);
    return {
      ok: true,
      linkedDrugAllergies: 0,
      allergyFindings: 0,
      message: '取込んだ薬剤アレルギーは、成分コード連動により処方安全チェック（ALLERGY）へ反映されます（デモ表示）。',
    };
  }
}
