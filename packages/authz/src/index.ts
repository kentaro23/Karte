/**
 * 認可 — ①職種×機能マトリクス → ②利用者個別オーバーライド → ③患者単位ACL + VIP.
 * 別紙3 #35-55, 別紙1 §1.1(4), §2.9(9).
 */
import { prisma, type JobType } from '@medixus/db';

export type Resource =
  | 'chart'
  | 'order'
  | 'prescription'
  | 'patient'
  | 'reception'
  | 'master'
  | 'audit';
export type Action = 'view' | 'write' | 'amend' | 'issue' | 'admin';

/** Default job-type permission matrix (seeded into RolePermission). */
export const DEFAULT_MATRIX: Record<JobType, Partial<Record<Resource, Action[]>>> = {
  DOCTOR: {
    chart: ['view', 'write', 'amend'],
    order: ['view', 'issue'],
    prescription: ['view', 'issue'],
    patient: ['view', 'write'],
    reception: ['view'],
  },
  RESIDENT: {
    chart: ['view', 'write'],
    order: ['view', 'issue'],
    prescription: ['view', 'issue'],
    patient: ['view'],
    reception: ['view'],
  },
  NURSE: {
    chart: ['view', 'write'],
    order: ['view'],
    patient: ['view', 'write'],
    reception: ['view', 'write'],
  },
  PHARMACIST: { chart: ['view'], prescription: ['view'], order: ['view'], patient: ['view'] },
  CLERK: { reception: ['view', 'write'], patient: ['view', 'write'], chart: ['view'] },
  TECHNOLOGIST: { order: ['view'], chart: ['view'], patient: ['view'] },
  THERAPIST: { chart: ['view', 'write'], order: ['view'], patient: ['view'] },
  DIETITIAN: { chart: ['view', 'write'], order: ['view'], patient: ['view'] },
  MANAGER: { chart: ['view'], patient: ['view'], reception: ['view'], audit: ['view'] },
  ADMIN: {
    chart: ['view'],
    order: ['view'],
    prescription: ['view'],
    patient: ['view', 'write'],
    reception: ['view', 'write'],
    master: ['view', 'write', 'admin'],
    audit: ['view', 'admin'],
  },
};

export interface PrincipalCtx {
  userId: string;
  jobType: JobType;
}

/** ① + ② : job-type matrix then per-user override. */
export async function can(ctx: PrincipalCtx, resource: Resource, action: Action): Promise<boolean> {
  const override = await prisma.userPermission.findUnique({
    where: { userId_resource_action: { userId: ctx.userId, resource, action } },
  });
  if (override) return override.allow;
  const roleRow = await prisma.rolePermission.findUnique({
    where: { jobType_resource_action: { jobType: ctx.jobType, resource, action } },
  });
  if (roleRow) return roleRow.allow;
  // fall back to compiled default matrix
  return (DEFAULT_MATRIX[ctx.jobType]?.[resource] ?? []).includes(action);
}

export async function assertCan(
  ctx: PrincipalCtx,
  resource: Resource,
  action: Action,
): Promise<void> {
  if (!(await can(ctx, resource, action)))
    throw new Error(`権限がありません: ${resource}.${action} (${ctx.jobType})`);
}

export type PatientAccessDecision = {
  level: 'NO_ACCESS' | 'PASSWORD_REQUIRED' | 'VIEW_ONLY' | 'VIEW_AND_WRITE';
  needsVipPassword: boolean;
  isRestricted: boolean;
};

/** ③ per-patient ACL overlay + VIP break-glass (別紙3 #50-55, 別紙1 §2.9(9)). */
export async function patientAccess(
  ctx: PrincipalCtx,
  patientId: string,
): Promise<PatientAccessDecision> {
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: { isVip: true },
  });
  const acls = await prisma.patientAccessControl.findMany({ where: { patientId } });
  const applicable = acls.filter((a) => a.jobType === null || a.jobType === ctx.jobType);
  // most restrictive wins
  const order = ['NO_ACCESS', 'PASSWORD_REQUIRED', 'VIEW_ONLY', 'VIEW_AND_WRITE'] as const;
  let level: PatientAccessDecision['level'] = 'VIEW_AND_WRITE';
  for (const a of applicable) {
    if (order.indexOf(a.level) < order.indexOf(level)) level = a.level;
  }
  return {
    level,
    isRestricted: applicable.some((a) => a.level !== 'VIEW_AND_WRITE'),
    needsVipPassword: Boolean(patient?.isVip),
  };
}
