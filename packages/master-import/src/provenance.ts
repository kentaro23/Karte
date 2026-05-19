/**
 * PROVENANCE GUARD — patient-safety boundary (defense atop the DB enum).
 *
 * Drug efficacy / 禁忌 / 相互作用 / 極量 / 適応 / 用法用量 MUST originate from a
 * public authoritative master or pharmacist-verified package-insert transcription.
 * `DrugDataSource` (in the Prisma schema) has NO `AI`/`LLM` member, so the DB
 * physically cannot store an AI-sourced safety fact. This guard fails fast with a
 * clear message and adds the "verified rows require a reviewer + citation" rule.
 */
import type { DrugDataSource } from '@medixus/db';

export const ALLOWED_SOURCES: readonly DrugDataSource[] = [
  'MHLW_RECEIPT',
  'MEDIS',
  'PMDA_PI_STRUCTURED',
  'PMDA_PI_XML',
  'PHARMACIST_VERIFIED',
  'CURATED_SEED',
];

export interface SafetyProvenance {
  source: DrugDataSource;
  sourceCitation: string;
  reviewedByUserId?: string | null;
  isSeed?: boolean;
  isProvisional?: boolean;
}

export class ProvenanceViolation extends Error {
  constructor(msg: string) {
    super(`[provenance] ${msg} — 安全データはAI生成不可。公的マスタ/添付文書出典のみ。`);
    this.name = 'ProvenanceViolation';
  }
}

export function assertSafetyProvenance(p: SafetyProvenance): void {
  if (!ALLOWED_SOURCES.includes(p.source)) {
    throw new ProvenanceViolation(`不正なsource: ${String(p.source)}`);
  }
  if (!p.sourceCitation || p.sourceCitation.trim().length < 4) {
    throw new ProvenanceViolation('sourceCitation（出典）が必須です');
  }
  if (
    (p.source === 'PHARMACIST_VERIFIED' || p.source === 'CURATED_SEED') &&
    !p.reviewedByUserId
  ) {
    throw new ProvenanceViolation(
      `${p.source} は薬剤師レビュー(reviewedByUserId)が必須です`,
    );
  }
}
