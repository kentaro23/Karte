/**
 * App-layer append-only guard (defense-in-depth; db/triggers.sql is the hard guarantee).
 *
 * Regulatory basis: 電子保存の三原則 (真正性). Clinical records, orders, audit and
 * drug-safety rows must never be physically mutated/deleted. Corrections are made by
 * superseding (new version row) — only a small set of transition columns may change.
 */
type Policy = {
  /** columns allowed to change on update; [] = no update at all */
  allowUpdate: string[];
  /** deletes are never allowed for protected models */
};

const POLICIES: Record<string, Policy> = {
  // version-chain: only the supersede/lock transition may change
  ClinicalNote: { allowUpdate: ['isLatest', 'status', 'supersededById', 'lockedAt'] },
  Order: { allowUpdate: ['isLatest', 'status', 'supersededById'] },
  // safety rows: only validTo (supersede close-out) may change
  DrugIndication: { allowUpdate: ['validTo'] },
  DrugDosage: { allowUpdate: ['validTo'] },
  DrugContraindication: { allowUpdate: ['validTo'] },
  DrugInteraction: { allowUpdate: ['validTo'] },
  // strictly immutable
  AuditEvent: { allowUpdate: [] },
  DrugSafetyReviewLog: { allowUpdate: [] },
  RuleCheckResult: { allowUpdate: [] },
  PrescriptionOverride: { allowUpdate: [] },
  EncounterStatusTransition: { allowUpdate: [] },
};

export class AppendOnlyViolation extends Error {
  constructor(model: string, op: string, detail?: string) {
    super(
      `[append-only] ${op} on "${model}" is forbidden (電子保存の三原則・真正性)` +
        (detail ? `: ${detail}` : '') +
        '. Correct records by superseding (new version), not by mutation.',
    );
    this.name = 'AppendOnlyViolation';
  }
}

export function appendOnlyExtension() {
  return {
    name: 'medixus-append-only',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: any) {
          const policy = model ? POLICIES[model] : undefined;
          if (policy) {
            if (operation === 'delete' || operation === 'deleteMany') {
              throw new AppendOnlyViolation(model, operation);
            }
            if (operation === 'update' || operation === 'updateMany' || operation === 'upsert') {
              const data = (args?.data ?? args?.update ?? {}) as Record<string, unknown>;
              const changed = Object.keys(data);
              const illegal = changed.filter((k) => !policy.allowUpdate.includes(k));
              if (illegal.length > 0) {
                throw new AppendOnlyViolation(
                  model,
                  operation,
                  `attempted to change immutable field(s): ${illegal.join(', ')}`,
                );
              }
            }
          }
          return query(args);
        },
      },
    },
  };
}
