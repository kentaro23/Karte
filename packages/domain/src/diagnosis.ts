/**
 * 病名・転帰 ドメイン — FR-DX-01 / 別紙1 §病名 / 174項 19.
 * Framework-free. Mirrors the Prisma enums DiagnosisStatus / DiseaseOutcome.
 * 病名は論理削除（DELETED）。確定/疑い・主病は別フィールド。
 */
export type DiagnosisStatus = 'ACTIVE' | 'RESOLVED' | 'DELETED';

export type DiseaseOutcome =
  | 'CURED'
  | 'IMPROVED'
  | 'UNCHANGED'
  | 'TRANSFERRED'
  | 'DECEASED'
  | 'STOPPED';

export const DIAGNOSIS_STATUS_LABEL: Record<DiagnosisStatus, string> = {
  ACTIVE: '有効',
  RESOLVED: '転帰',
  DELETED: '削除',
};

export const DISEASE_OUTCOME_LABEL: Record<DiseaseOutcome, string> = {
  CURED: '治癒',
  IMPROVED: '軽快',
  UNCHANGED: '不変',
  TRANSFERRED: '転医',
  DECEASED: '死亡',
  STOPPED: '中止',
};

const DIAGNOSIS_TRANSITIONS: Record<DiagnosisStatus, DiagnosisStatus[]> = {
  ACTIVE: ['RESOLVED', 'DELETED'],
  RESOLVED: ['ACTIVE', 'DELETED'],
  DELETED: [],
};

export function canTransitionDiagnosis(from: DiagnosisStatus, to: DiagnosisStatus): boolean {
  return DIAGNOSIS_TRANSITIONS[from].includes(to);
}

export function assertDiagnosisTransition(from: DiagnosisStatus, to: DiagnosisStatus): void {
  if (!canTransitionDiagnosis(from, to)) {
    throw new Error(`不正な病名ステータス遷移: ${from} → ${to}`);
  }
}

/**
 * RESOLVED へ遷移するときは転帰区分が必須（DELETED/ACTIVE は不要）.
 * 一括転帰の入力検証に使う。
 */
export function assertResolveWithOutcome(
  to: DiagnosisStatus,
  outcome: DiseaseOutcome | null | undefined,
): void {
  if (to === 'RESOLVED' && (outcome === null || outcome === undefined)) {
    throw new Error('転帰（治癒・軽快 等）を選択してください');
  }
}

/**
 * レセ病名 修飾語合成 — 別紙1 §病名(修飾語プリ合成).
 * 接頭辞修飾語（急性/慢性/出血性/術後…）を基本病名の前に連結し、
 * 重複・空白を除去して正規化した病名文字列を返す純関数。
 * 例: composeDiseaseName('胃潰瘍', ['急性', '出血性']) => '急性出血性胃潰瘍'
 */
export function composeDiseaseName(base: string, modifiers: readonly string[] = []): string {
  const trimmedBase = base.trim();
  const seen = new Set<string>();
  const prefix = modifiers
    .map((m) => m.trim())
    .filter((m) => {
      if (m.length === 0) return false;
      if (seen.has(m)) return false;
      seen.add(m);
      return true;
    })
    .join('');
  return `${prefix}${trimmedBase}`;
}
