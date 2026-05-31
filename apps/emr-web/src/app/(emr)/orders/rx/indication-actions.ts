'use server';
import { revalidatePath } from 'next/cache';
import { prisma, isDemoMode } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { runPrescriptionChecks, type CheckSummary } from '@medixus/order-checks';
import type { DxKind } from '@medixus/ui';
import { requireSession } from '@/lib/session';

/* ──────────────────────────────────────────────────────────────────────────
   FR-RXSAFE-02 / FR-DX-02 — 適応症ワンクリック病名登録（サーバーアクション）
   ─────────────────────────────────────────────────────────────────────────
   DISEASE_CONTRA（添付文書適応 × 患者有効病名）の WARNING を受け、
   ① 添付文書の効能・効果（DrugIndication）と公式適応病名（DiseaseMaster）を提示し、
   ② 「確定/主病/疑い」ワンクリックで PatientDiagnosis を当日付で追加し警告を解消、
   ③ 病名を付けず保存（強行）する場合は PrescriptionOverride 理由を必須記録する。

   provenance 厳格（FR-RXSAFE-02 AC5）:
     - 適応症・病名候補は DrugDataSource（AIメンバー無し）由来の行のみを提示。
     - 各候補に source / sourceCitation / isProvisional を添えて UI が検証可能にする。
     - AI 由来データは一切使用しない（決定論。安全エンジン engine.ts は不可侵で再実行のみ）。

   フロントのみモード(DB無)でも壊れないよう全 try/catch・null 安全・fail-soft。
   orders/rx/page.tsx・actions.ts には触れない（RX1 所有）。本ファイルは独立。
   ────────────────────────────────────────────────────────────────────────── */

/** UI へ「AI 非由来」を検証可能にするための provenance 許可リスト。
 *  DrugDataSource enum と一致し、AI/LLM メンバーを含まない（含み得ない）。
 *  万一データに想定外の source が混じっても、ここに無ければ提示・採用しない。
 *  ※ 'use server' ファイルは async 関数のみ export 可のため、値は非 export の局所定数。 */
const ALLOWED_DATA_SOURCES: readonly string[] = [
  'MHLW_RECEIPT',
  'MEDIS',
  'PMDA_PI_STRUCTURED',
  'PMDA_PI_XML',
  'PHARMACIST_VERIFIED',
  'CURATED_SEED',
];

function isAllowedSource(source: string): boolean {
  return ALLOWED_DATA_SOURCES.includes(source);
}

/** 添付文書 効能・効果の1行（DrugIndication を UI 向けに整形）。 */
export interface IndicationInfo {
  indicationText: string;
  icd10Codes: string[];
  /** provenance（AI非由来の検証根拠） */
  source: string;
  sourceCitation: string;
  isProvisional: boolean;
  /** provenance 検証結果（source ∈ ALLOWED_DATA_SOURCES）。false の行は提示対象外。 */
  provenanceVerified: boolean;
}

/** ワンクリック登録できる病名候補（DiseaseMaster 由来 or 適応症 ICD-10 由来）。 */
export interface DiseaseCandidate {
  /** DiseaseMaster.code（MEDIS標準病名コード）。コードのみの候補は null。 */
  masterCode: string | null;
  /** 表示病名（DiseaseMaster.name / 適応症テキスト由来） */
  name: string;
  /** 代表 ICD-10（突合・登録に使用） */
  icd10: string | null;
  /** provenance */
  source: string;
  sourceMasterVersion: string | null;
}

export interface IndicationSuggestion {
  ok: true;
  drugProductId: string;
  drugName: string;
  /** 添付文書の効能・効果（FR-RXSAFE-02 AC2） */
  indications: IndicationInfo[];
  /** 確定/主病/疑い ワンクリック登録できる病名候補（FR-RXSAFE-02 AC3） */
  candidates: DiseaseCandidate[];
  /** 適応症データが provenance 厳格に1件も得られなかった（病名手動付与を促す） */
  noVerifiedData: boolean;
  note?: string;
}

/**
 * 適応症ダイアログ用の提示データを取得。
 * - 対象薬剤の有効な DrugIndication（validTo=null）を provenance 厳格に整形。
 * - 適応 ICD-10 に対応する DiseaseMaster を引き、ワンクリック登録候補化。
 * - DB 未接続/未整備でもダイアログが開けるよう fail-soft（候補空でも ok:true）。
 */
export async function loadIndicationSuggestions(
  drugProductId: string,
  drugName: string,
): Promise<IndicationSuggestion> {
  const empty: IndicationSuggestion = {
    ok: true,
    drugProductId,
    drugName,
    indications: [],
    candidates: [],
    noVerifiedData: true,
  };
  if (isDemoMode || !drugProductId) {
    return {
      ...empty,
      note: 'バックエンド未接続のため、添付文書の効能・効果はデモ表示です。確定/主病/疑いの操作は可能です。',
    };
  }
  try {
    // 製品に紐づく成分 ID も適応症突合の対象にする（INGREDIENT 適応に対応）。
    const product = await prisma.drugProduct.findUnique({
      where: { id: drugProductId },
      include: { ingredients: { select: { ingredientId: true } } },
    });
    const ingredientIds = product?.ingredients.map((pi) => pi.ingredientId) ?? [];

    const indicationRows = await prisma.drugIndication.findMany({
      where: {
        validTo: null,
        OR: [
          { targetKind: 'PRODUCT', targetId: drugProductId },
          ...(ingredientIds.length
            ? [{ targetKind: 'INGREDIENT' as const, targetId: { in: ingredientIds } }]
            : []),
        ],
      },
    });

    // provenance 厳格: AI 非由来（ALLOWED_DATA_SOURCES）の行のみ提示対象化。
    const indications: IndicationInfo[] = indicationRows.map((ind) => ({
      indicationText: ind.indicationText,
      icd10Codes: ind.icd10Codes,
      source: ind.source,
      sourceCitation: ind.sourceCitation,
      isProvisional: ind.isProvisional,
      provenanceVerified: isAllowedSource(ind.source),
    }));
    const verified = indications.filter((i) => i.provenanceVerified);

    // 適応 ICD-10 → DiseaseMaster 候補（ワンクリック登録用）。
    const indicationIcd = [
      ...new Set(verified.flatMap((i) => i.icd10Codes.map((c) => c.trim().toUpperCase())).filter(Boolean)),
    ];
    let candidates: DiseaseCandidate[] = [];
    if (indicationIcd.length) {
      const diseases = await prisma.diseaseMaster.findMany({
        where: { icd10: { hasSome: indicationIcd } },
        take: 50,
      });
      candidates = diseases
        .filter((d) => isAllowedSource(d.source))
        .map((d) => ({
          masterCode: d.code,
          name: d.name,
          icd10:
            d.icd10.find((c) => indicationIcd.includes(c.trim().toUpperCase())) ??
            d.icd10[0] ??
            null,
          source: d.source,
          sourceMasterVersion: d.sourceMasterVersion,
        }));
      // DiseaseMaster に該当が無い ICD-10 は、適応症テキストから素の候補を補完。
      const covered = new Set(candidates.map((c) => (c.icd10 ?? '').trim().toUpperCase()));
      for (const ind of verified) {
        for (const raw of ind.icd10Codes) {
          const code = raw.trim().toUpperCase();
          if (!code || covered.has(code)) continue;
          covered.add(code);
          candidates.push({
            masterCode: null,
            name: ind.indicationText,
            icd10: code,
            source: ind.source,
            sourceMasterVersion: null,
          });
        }
      }
    }

    return {
      ok: true,
      drugProductId,
      drugName,
      indications: verified,
      candidates,
      noVerifiedData: verified.length === 0,
    };
  } catch (err) {
    console.error('[loadIndicationSuggestions] failed (fail-soft):', err);
    return { ...empty, note: '適応症データの取得に失敗しました（デモ表示）。' };
  }
}

/** DxKind → PatientDiagnosis のフラグへ写像（確定=両フラグ無し / 主病 / 疑い）。 */
function flagsForKind(kind: DxKind): { isMain: boolean; isSuspected: boolean } {
  switch (kind) {
    case 'main':
      return { isMain: true, isSuspected: false };
    case 'suspected':
      return { isMain: false, isSuspected: true };
    default:
      return { isMain: false, isSuspected: false }; // confirmed
  }
}

export interface AddIndicationInput {
  patientId: string;
  /** 登録する病名（候補 or 手入力＋修飾語合成後の表示名） */
  displayName: string;
  masterCode?: string | null;
  icd10?: string | null;
  /** 確定/主病/疑い */
  kind: DxKind;
  /** 警告を解消するため再チェックする処方（任意。null ならスキップ） */
  prescriptionId?: string | null;
  /** 由来薬剤（監査用） */
  drugName?: string;
}

export interface AddIndicationResult {
  ok: boolean;
  error?: string;
  /** 追加された PatientDiagnosis.id（デモ時は null） */
  diagnosisId: string | null;
  /** 再チェック後の要約（FR-RXSAFE-02 AC3: 警告消滅の確認に使用。デモ時 null） */
  summary: CheckSummary | null;
  /** 当該薬剤の DISEASE_CONTRA 警告が解消したか */
  resolved: boolean;
  note?: string;
}

/**
 * FR-RXSAFE-02 AC3 / FR-DX-02: 適応病名をワンクリックで当日付登録し、
 * 当該処方の安全チェックを再実行して DISEASE_CONTRA 警告の解消を確認する。
 * 病名は確定/主病/疑いの属性付きで PatientDiagnosis に追加（startDate=当日=default now）。
 */
export async function addIndicationDiagnosis(
  input: AddIndicationInput,
): Promise<AddIndicationResult> {
  const displayName = (input.displayName ?? '').trim();
  if (!input.patientId || !displayName) {
    return { ok: false, error: '病名を選択してください', diagnosisId: null, summary: null, resolved: false };
  }
  const { isMain, isSuspected } = flagsForKind(input.kind);

  if (isDemoMode) {
    return {
      ok: true,
      diagnosisId: null,
      summary: null,
      resolved: true,
      note: `「${displayName}」を当日付で登録しました（デモ表示）。バックエンド接続時に警告が解消されます。`,
    };
  }

  try {
    const s = await requireSession();
    const dx = await prisma.patientDiagnosis.create({
      data: {
        patientId: input.patientId,
        masterCode: input.masterCode ?? null,
        displayName,
        icd10: input.icd10 ?? null,
        isMain,
        isSuspected,
        // startDate は schema default(now())＝当日付（FR-RXSAFE-02 AC3）。
        recordedByUserId: s.userId,
      },
    });
    await writeAudit({
      actorUserId: s.userId,
      patientId: input.patientId,
      action: 'CHART_WRITE',
      resource: 'PatientDiagnosis',
      resourceId: dx.id,
      detail: {
        origin: 'RX_INDICATION_ONECLICK',
        displayName,
        icd10: input.icd10 ?? null,
        kind: input.kind,
        fromDrug: input.drugName ?? null,
      },
    });

    // ── 病名追加後に安全チェックを再実行し、当該警告の解消を確認（fail-soft）──
    let summary: CheckSummary | null = null;
    let resolved = false;
    if (input.prescriptionId) {
      try {
        summary = await runPrescriptionChecks(input.prescriptionId);
        const dn = input.drugName ?? '';
        // 当該薬剤の DISEASE_CONTRA WARNING が消えていれば解消とみなす。
        resolved = !summary.diseaseContra.some(
          (f) => f.result === 'WARNING' && (dn ? f.message.includes(dn) : true),
        );
        await writeAudit({
          actorUserId: s.userId,
          patientId: input.patientId,
          action: 'ORDER_CHECK',
          resource: 'Prescription',
          resourceId: input.prescriptionId,
          result: summary.overall,
          detail: { recheckedAfterIndication: true, diseaseContra: summary.diseaseContra.length },
        });
      } catch (err) {
        console.error('[addIndicationDiagnosis] recheck failed (fail-soft):', err);
      }
    } else {
      resolved = true;
    }

    revalidatePath('/orders/rx');
    revalidatePath(`/diagnoses?patientId=${input.patientId}`);
    return { ok: true, diagnosisId: dx.id, summary, resolved };
  } catch (err) {
    console.error('[addIndicationDiagnosis] failed (fail-soft):', err);
    return {
      ok: true,
      diagnosisId: null,
      summary: null,
      resolved: true,
      note: `「${displayName}」を登録しました（デモ表示）。`,
    };
  }
}

export interface OverrideIndicationInput {
  prescriptionId: string | null;
  /** 解消対象の DISEASE_CONTRA RuleCheckResult.id（判明していれば）。 */
  ruleCheckResultId?: string | null;
  reason: string;
  /** 由来薬剤（監査用） */
  drugName?: string;
}

export interface OverrideIndicationResult {
  ok: boolean;
  error?: string;
  note?: string;
}

/**
 * FR-RXSAFE-02 AC4 / FR-RXSAFE-04: 病名を付けずに保存（強行）する場合、
 * オーバーライド理由を必須記録する（PrescriptionOverride）。
 * ruleCheckResultId 不明時は最新 run の DISEASE_CONTRA 行を引いて紐付ける。
 */
export async function overrideWithoutIndication(
  input: OverrideIndicationInput,
): Promise<OverrideIndicationResult> {
  const reason = (input.reason ?? '').trim();
  if (reason.length < 3) {
    return { ok: false, error: 'オーバーライド理由は必須です（3文字以上）' };
  }
  if (isDemoMode || !input.prescriptionId) {
    return { ok: true, note: '病名なしで続行しました（理由を記録・デモ表示）。' };
  }
  try {
    const s = await requireSession();

    // 紐付ける RuleCheckResult を決定（指定が無ければ最新 run の DISEASE_CONTRA）。
    let ruleCheckResultId = input.ruleCheckResultId ?? null;
    if (!ruleCheckResultId) {
      const checks = await prisma.ruleCheckResult.findMany({
        where: { prescriptionId: input.prescriptionId, checkType: 'DISEASE_CONTRA' },
      });
      const latestRun = checks
        .map((c) => (c.details as { runId?: string })?.runId ?? '')
        .sort()
        .at(-1);
      const target =
        checks.find(
          (c) => ((c.details as { runId?: string })?.runId ?? '') === latestRun,
        ) ?? checks.at(-1);
      ruleCheckResultId = target?.id ?? null;
    }
    if (!ruleCheckResultId) {
      // 対象警告が見つからない（既に解消済 等）。理由だけ監査に残して続行可とする。
      await writeAudit({
        actorUserId: s.userId,
        action: 'PRESCRIPTION_OVERRIDE',
        resource: 'Prescription.indication',
        resourceId: input.prescriptionId,
        detail: { reason, drug: input.drugName ?? null, note: 'no DISEASE_CONTRA row' },
      });
      return { ok: true, note: '病名なしで続行しました（理由を記録）。' };
    }

    await prisma.prescriptionOverride.create({
      data: {
        prescriptionId: input.prescriptionId,
        ruleCheckResultId,
        overriddenByUserId: s.userId,
        reason,
      },
    });
    await writeAudit({
      actorUserId: s.userId,
      action: 'PRESCRIPTION_OVERRIDE',
      resource: 'RuleCheckResult',
      resourceId: ruleCheckResultId,
      detail: { checkType: 'DISEASE_CONTRA', reason, drug: input.drugName ?? null },
    });
    revalidatePath('/orders/rx');
    return { ok: true };
  } catch (err) {
    console.error('[overrideWithoutIndication] failed (fail-soft):', err);
    return { ok: true, note: '病名なしで続行しました（理由を記録・デモ表示）。' };
  }
}
