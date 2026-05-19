/**
 * Tamper-evident audit log (別紙3 #25-30, 真正性).
 * The DB trigger (db/triggers.sql) computes the sha256 hash-chain on INSERT and
 * forbids UPDATE/DELETE. This package is the typed write/verify surface.
 */
import { prisma, type AuditAction } from '@medixus/db';

export interface AuditInput {
  actorUserId?: string | null;
  patientId?: string | null;
  action: AuditAction;
  resource?: string | null;
  resourceId?: string | null;
  terminalId?: string | null;
  ip?: string | null;
  result?: string;
  detail?: unknown;
}

export async function writeAudit(input: AuditInput): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      actorUserId: input.actorUserId ?? null,
      patientId: input.patientId ?? null,
      action: input.action,
      resource: input.resource ?? null,
      resourceId: input.resourceId ?? null,
      terminalId: input.terminalId ?? null,
      ip: input.ip ?? null,
      result: input.result ?? 'OK',
      detail: input.detail === undefined ? undefined : (input.detail as object),
    },
  });
}

/**
 * Verify chain linkage: row[n].prevHash === row[n-1].rowHash, head.prevHash null.
 * Detects deletion / reordering. (Content mutation is already blocked by triggers.)
 */
export async function verifyAuditChain(): Promise<{ ok: boolean; brokenAtSeq?: bigint }> {
  const rows = await prisma.auditEvent.findMany({
    orderBy: { seq: 'asc' },
    select: { seq: true, prevHash: true, rowHash: true },
  });
  let prev: string | null = null;
  for (const r of rows) {
    if ((r.prevHash ?? null) !== prev) return { ok: false, brokenAtSeq: r.seq };
    prev = r.rowHash;
  }
  return { ok: true };
}
