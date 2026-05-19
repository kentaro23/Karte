/**
 * Deterministic rule runtime. There is intentionally NO LLM/AI path here:
 * judgements are derived only from imported/verified data (設計書 AI責任境界).
 */
export type RuleResult = 'PASS' | 'WARNING' | 'BLOCKED';

export type RuleCheckType =
  | 'CONTRAINDICATION'
  | 'INTERACTION'
  | 'DOSE_MAX'
  | 'DUPLICATE'
  | 'ALLERGY'
  | 'DISEASE_CONTRA'
  | 'PREGNANCY_LACTATION'
  | 'RENAL'
  | 'HEPATIC'
  | 'AGE'
  | 'INFECTION';

export interface Finding {
  checkType: RuleCheckType;
  result: RuleResult;
  /** short human message (Japanese) */
  message: string;
  /** structured evidence + source citation (provenance) for真正性 */
  details: Record<string, unknown>;
}

/** UI behaviour per severity — 別紙1 §6.1 / 174項 59-61. */
export function uiBehavior(result: RuleResult): {
  blocksIssue: boolean;
  requiresReason: boolean;
  badge: 'red' | 'amber' | 'green';
} {
  switch (result) {
    case 'BLOCKED':
      return { blocksIssue: true, requiresReason: true, badge: 'red' };
    case 'WARNING':
      return { blocksIssue: false, requiresReason: true, badge: 'amber' };
    default:
      return { blocksIssue: false, requiresReason: false, badge: 'green' };
  }
}

export function aggregate(findings: Finding[]): {
  overall: RuleResult;
  blocked: Finding[];
  warnings: Finding[];
} {
  const blocked = findings.filter((f) => f.result === 'BLOCKED');
  const warnings = findings.filter((f) => f.result === 'WARNING');
  return {
    overall: blocked.length ? 'BLOCKED' : warnings.length ? 'WARNING' : 'PASS',
    blocked,
    warnings,
  };
}

/** A blocked finding may only be overridden with an explicit recorded reason. */
export function canIssueWithOverride(
  findings: Finding[],
  overriddenIds: Set<string>,
  idOf: (f: Finding, i: number) => string,
): boolean {
  return findings.every((f, i) =>
    f.result === 'BLOCKED' ? overriddenIds.has(idOf(f, i)) : true,
  );
}
