/**
 * 適応症（病名）チェック (pure, deterministic). 別紙1 §6.1 / 174項 59-61.
 *
 * 各処方薬の添付文書上の適応症 (DrugIndication.icd10Codes / indicationText) と
 * 患者の有効病名 (PatientDiagnosis: status ACTIVE) を突合し、適応症が患者病名に
 * 紐づいていない (=適応症未付与) ものを DISEASE_CONTRA の WARNING で返す。
 *
 * Deterministic & provenance-strict:
 *   - 判定は import/verified 済みの DrugIndication 行 (source ∈ DrugDataSource、
 *     AIメンバー無し) のみから導出し、各 finding に sourceCitation を記録する。
 *   - 適応症データ未整備の薬剤は「安全」とみなさず WARNING を出し人が確認する
 *     (患者安全 — 極量チェックと同じ思想。沈黙の PASS を作らない)。
 *   - AI 由来データは一切使用しない (設計書 AI責任境界)。既存の禁忌チェックの
 *     provenance 方式 ({ sourceCitation, source, isProvisional }) に倣う。
 *
 * 入力は engine 側で Prisma 行を整形して渡す純粋型。
 */
import type { Finding } from '@medixus/rule-engine';

/** 1適応症行 (DrugIndication を整形したもの). */
export interface IndicationRow {
  /** 添付文書 適応症テキスト (DrugIndication.indicationText) */
  indicationText: string;
  /** 適応 ICD-10 コード群 (DrugIndication.icd10Codes) */
  icd10Codes: string[];
  /** provenance — DrugIndication.sourceCitation */
  sourceCitation: string;
  /** provenance — DrugIndication.source (DrugDataSource) */
  source: string;
  /** provenance — DrugIndication.isProvisional */
  isProvisional: boolean;
}

/** 適応症突合の対象となる処方薬1件. */
export interface RxItemForDiseaseContra {
  itemId: string;
  drugName: string;
  /** この薬剤に紐づく有効な適応症行 (validTo=null) */
  indications: IndicationRow[];
}

/** 患者の有効病名1件 (PatientDiagnosis を整形したもの). */
export interface PatientDiagnosisForContra {
  /** PatientDiagnosis.icd10 */
  icd10: string | null;
  /** PatientDiagnosis.displayName (表示・突合補助) */
  displayName: string;
  /** PatientDiagnosis.isSuspected (疑い病名) */
  isSuspected: boolean;
}

/** ICD-10 を大文字化し前後空白を除去 (突合用正規化). */
function normIcd(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * 処方薬と患者有効病名を突合し、適応症未付与を DISEASE_CONTRA WARNING で返す。
 * 純粋関数 (DB/AI 非依存)。
 */
export function checkDiseaseIndication(
  items: RxItemForDiseaseContra[],
  patientDiagnoses: PatientDiagnosisForContra[],
): Finding[] {
  const out: Finding[] = [];

  // 患者の有効病名 ICD-10 集合 (疑い病名も適応根拠になり得るため含める。
  // 突合可能なコードのみを対象化)。
  const patientIcd = new Set(
    patientDiagnoses
      .map((d) => d.icd10)
      .filter((c): c is string => Boolean(c && c.trim()))
      .map(normIcd),
  );

  for (const it of items) {
    // 適応症データ未整備 → 沈黙の PASS を作らず WARNING (人が確認)。
    if (it.indications.length === 0) {
      out.push({
        checkType: 'DISEASE_CONTRA',
        result: 'WARNING',
        message: `${it.drugName}: 適応症データ未整備のため病名突合不可（医師・薬剤師確認要）`,
        details: {
          itemId: it.itemId,
          reason: 'NO_INDICATION_DATA',
          indicationDataPresent: false,
        },
      });
      continue;
    }

    // 適応 ICD-10 を持つ行に限り突合する (コード未整備行はテキスト適応のみで
    // 自動判定不能 → その薬剤を「適応あり」と誤判定しない)。
    const codedIndications = it.indications.filter((ind) => ind.icd10Codes.length > 0);

    if (codedIndications.length === 0) {
      // ICD-10 コード付き適応症が1つも無い → 自動突合不可 (WARNING)。
      const first = it.indications[0]!;
      out.push({
        checkType: 'DISEASE_CONTRA',
        result: 'WARNING',
        message: `${it.drugName}: 適応症にICD-10コード未整備のため病名突合不可（医師・薬剤師確認要）`,
        details: {
          itemId: it.itemId,
          reason: 'INDICATION_HAS_NO_ICD10',
          indicationDataPresent: true,
          sourceCitation: first.sourceCitation,
          source: first.source,
          isProvisional: first.isProvisional,
        },
      });
      continue;
    }

    // いずれかの適応症 ICD-10 が患者有効病名に一致すれば適応あり (PASS = finding 無し)。
    const matched = codedIndications.find((ind) =>
      ind.icd10Codes.some((c) => patientIcd.has(normIcd(c))),
    );
    if (matched) continue;

    // 適応症未付与: 患者の有効病名に該当する適応症が存在しない → WARNING。
    const cited = codedIndications[0]!;
    const allIndicationIcd = [
      ...new Set(codedIndications.flatMap((ind) => ind.icd10Codes.map(normIcd))),
    ];
    out.push({
      checkType: 'DISEASE_CONTRA',
      result: 'WARNING',
      message: `${it.drugName}: 適応症に該当する有効病名が未付与（適応外/病名要確認）`,
      details: {
        itemId: it.itemId,
        reason: 'INDICATION_NOT_DIAGNOSED',
        indicationDataPresent: true,
        indicationIcd10: allIndicationIcd,
        patientDiagnosisIcd10: [...patientIcd],
        sourceCitation: cited.sourceCitation,
        source: cited.source,
        isProvisional: cited.isProvisional,
      },
    });
  }

  return out;
}
