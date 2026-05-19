'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { requireSession } from '@/lib/session';

/** Open an existing encounter's chart: audit + exclusive-lock + selection log. */
export async function openChart(encounterId: string) {
  const s = await requireSession();
  const hdr = await headers();
  const terminalId = hdr.get('x-terminal-id') ?? 'web';

  const enc = await prisma.encounter.findUnique({
    where: { id: encounterId },
    select: { id: true, patientId: true },
  });
  if (!enc) throw new Error('受診が見つかりません');

  // 排他制御 — record who holds the write intent (別紙1 §2.9(6))
  const existing = await prisma.chartLock.findUnique({
    where: { resourceType_resourceId: { resourceType: 'encounter', resourceId: encounterId } },
  });
  if (existing && existing.lockedByUserId !== s.userId) {
    // other terminal in use — Phase 1: allow open (read), surface via audit
    await writeAudit({
      actorUserId: s.userId,
      patientId: enc.patientId,
      action: 'CHART_OPEN',
      resource: 'encounter',
      resourceId: encounterId,
      terminalId,
      result: `other-terminal-in-use:${existing.lockedByName}`,
    });
  } else {
    await prisma.chartLock.upsert({
      where: { resourceType_resourceId: { resourceType: 'encounter', resourceId: encounterId } },
      create: {
        resourceType: 'encounter',
        resourceId: encounterId,
        lockedByUserId: s.userId,
        lockedByName: s.name,
        terminalId,
      },
      update: { lockedByUserId: s.userId, lockedByName: s.name, terminalId, heartbeatAt: new Date() },
    });
  }

  await prisma.patientSelectionLog.create({ data: { userId: s.userId, patientId: enc.patientId } });
  await writeAudit({
    actorUserId: s.userId,
    patientId: enc.patientId,
    action: 'PATIENT_SELECT',
    resource: 'encounter',
    resourceId: encounterId,
    terminalId,
  });
  redirect(`/chart/${encounterId}`);
}

/** Open a patient from kana/ID search: create a same-day outpatient encounter. */
export async function openPatient(formData: FormData) {
  const s = await requireSession();
  const patientId = String(formData.get('patientId'));
  const visitType = String(formData.get('visitType') || 'RETURN') as 'FIRST' | 'RETURN';
  const patient = await prisma.patient.findUnique({ where: { id: patientId } });
  if (!patient) throw new Error('患者が見つかりません');
  const dept = await prisma.department.findFirst({ where: { clinicId: patient.clinicId } });
  const enc = await prisma.encounter.create({
    data: {
      patientId,
      encounterType: 'OUTPATIENT',
      visitType,
      contactType: 'FACE',
      departmentId: dept?.id ?? 'unknown',
      receptionStatus: 'IN_CONSULTATION',
      arrivedAt: new Date(),
    },
  });
  await writeAudit({
    actorUserId: s.userId,
    patientId,
    action: 'PATIENT_SELECT',
    resource: 'patient',
    resourceId: patientId,
  });
  redirect(`/chart/${enc.id}`);
}
