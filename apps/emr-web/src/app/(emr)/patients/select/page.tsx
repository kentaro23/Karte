import { prisma } from '@medixus/db';
import { age, type ReceptionStatus } from '@medixus/domain';
import type { ReceptionRow } from '@medixus/ui';
import { requireSession } from '@/lib/session';
import { SelectClient, type KanaRow, type WardRow, type ApptRow, type ErRow } from './select-client';

const TERMINAL: ReceptionStatus[] = ['BILLING_DONE', 'CANCELLED', 'NO_SHOW'];

export default async function PatientSelectPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string }>;
}) {
  const s = await requireSession();
  const sp = await searchParams;
  const tab = sp.tab ?? 'reception';
  const q = (sp.q ?? '').trim();

  const [encs, depts, allPatients, recentLogs] = await Promise.all([
    prisma.encounter.findMany({
      where: { receptionStatus: { notIn: TERMINAL } },
      include: { patient: { include: { allergies: true, infections: true } } },
      orderBy: { createdAt: 'asc' },
      take: 300,
    }),
    prisma.department.findMany(),
    prisma.patient.findMany({ select: { kanaLastName: true, kanaFirstName: true } }),
    prisma.patientSelectionLog.findMany({
      where: { userId: s.userId },
      orderBy: { selectedAt: 'desc' },
      take: 15,
    }),
  ]);
  const deptName = new Map(depts.map((d) => [d.id, d.name] as const));
  const nameCount = new Map<string, number>();
  for (const p of allPatients)
    nameCount.set(
      p.kanaLastName + p.kanaFirstName,
      (nameCount.get(p.kanaLastName + p.kanaFirstName) ?? 0) + 1,
    );

  const toReceptionRow = (e: (typeof encs)[number]): ReceptionRow => ({
    encounterId: e.id,
    receptionNo: e.receptionNo,
    patientNo: e.patient.patientNo,
    name: `${e.patient.kanjiLastName} ${e.patient.kanjiFirstName}`,
    kana: `${e.patient.kanaLastName} ${e.patient.kanaFirstName}`,
    gender: e.patient.gender === 'MALE' ? '男' : e.patient.gender === 'FEMALE' ? '女' : '—',
    age: age(e.patient.dateOfBirth),
    deptName: deptName.get(e.departmentId) ?? '—',
    status: e.receptionStatus as ReceptionStatus,
    arrivedAt: e.arrivedAt ? e.arrivedAt.toISOString() : null,
    visitType: e.visitType === 'FIRST' ? '初診' : e.visitType === 'RETURN' ? '再診' : null,
  });

  const reception = encs.filter((e) => e.encounterType === 'OUTPATIENT').map(toReceptionRow);
  const er: ErRow[] = encs
    .filter((e) => e.encounterType === 'EMERGENCY')
    .map((e) => ({
      encounterId: e.id,
      patientNo: e.patient.patientNo,
      name: `${e.patient.kanjiLastName} ${e.patient.kanjiFirstName}`,
      age: age(e.patient.dateOfBirth),
      triage: e.triageLevel ?? null,
      arrivalMethod: e.arrivalMethod ?? null,
      isTemporaryId: e.patient.isTemporaryId,
      status: e.receptionStatus as ReceptionStatus,
    }));
  const ward: WardRow[] = encs
    .filter((e) => e.encounterType === 'INPATIENT')
    .map((e) => ({
      encounterId: e.id,
      patientNo: e.patient.patientNo,
      name: `${e.patient.kanjiLastName} ${e.patient.kanjiFirstName}`,
      kana: `${e.patient.kanaLastName} ${e.patient.kanaFirstName}`,
      age: age(e.patient.dateOfBirth),
      ward: e.wardId ? '3階病棟' : '—',
      dept: deptName.get(e.departmentId) ?? '—',
      status: e.receptionStatus as ReceptionStatus,
    }));

  // assignment = reception grouped by department
  const assignment = depts.map((d) => ({
    deptId: d.id,
    deptName: d.name,
    rows: reception.filter((r) => r.deptName === d.name),
  }));

  let appts: ApptRow[] = [];
  if (tab === 'appointments' || tab === 'reception') {
    const a = await prisma.appointment.findMany({
      orderBy: { scheduledAt: 'asc' },
      take: 100,
      include: { patient: true },
    });
    appts = a.map((x) => ({
      id: x.id,
      patientId: x.patientId,
      patientNo: x.patient.patientNo,
      name: `${x.patient.kanjiLastName} ${x.patient.kanjiFirstName}`,
      kana: `${x.patient.kanaLastName} ${x.patient.kanaFirstName}`,
      age: age(x.patient.dateOfBirth),
      scheduledAt: x.scheduledAt.toISOString(),
      dept: deptName.get(x.departmentId) ?? '—',
      status: x.status,
    }));
  }

  let kana: KanaRow[] = [];
  if (tab === 'kana' && q) {
    const found = await prisma.patient.findMany({
      where: {
        OR: [
          { kanaLastName: { contains: q, mode: 'insensitive' } },
          { kanaFirstName: { contains: q, mode: 'insensitive' } },
          { kanjiLastName: { contains: q } },
          { kanjiFirstName: { contains: q } },
          { patientNo: { contains: q } },
        ],
      },
      include: { allergies: true, infections: true, family: true },
      take: 60,
    });
    kana = found.map((p) => ({
      id: p.id,
      patientNo: p.patientNo,
      name: `${p.kanjiLastName} ${p.kanjiFirstName}`,
      kana: `${p.kanaLastName} ${p.kanaFirstName}`,
      gender: p.gender === 'MALE' ? '男' : p.gender === 'FEMALE' ? '女' : '—',
      age: age(p.dateOfBirth),
      sameName: (nameCount.get(p.kanaLastName + p.kanaFirstName) ?? 0) > 1,
      isVip: p.isVip,
      isTemporaryId: p.isTemporaryId,
      hasRelated: p.family.length > 0,
      allergies: p.allergies.map((a) => a.substance),
      infections: p.infections.map((i) => i.pathogen),
    }));
  }

  const recentPatients = await prisma.patient.findMany({
    where: { id: { in: [...new Set(recentLogs.map((l) => l.patientId))] } },
    include: { allergies: true, infections: true, family: true },
  });
  const rpMap = new Map(recentPatients.map((p) => [p.id, p]));
  const recent: KanaRow[] = recentLogs
    .map((l) => rpMap.get(l.patientId))
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .map((p) => ({
      id: p.id,
      patientNo: p.patientNo,
      name: `${p.kanjiLastName} ${p.kanjiFirstName}`,
      kana: `${p.kanaLastName} ${p.kanaFirstName}`,
      gender: p.gender === 'MALE' ? '男' : p.gender === 'FEMALE' ? '女' : '—',
      age: age(p.dateOfBirth),
      sameName: (nameCount.get(p.kanaLastName + p.kanaFirstName) ?? 0) > 1,
      isVip: p.isVip,
      isTemporaryId: p.isTemporaryId,
      hasRelated: p.family.length > 0,
      allergies: p.allergies.map((a) => a.substance),
      infections: p.infections.map((i) => i.pathogen),
    }));

  return (
    <SelectClient
      tab={tab}
      q={q}
      reception={reception}
      appointments={appts}
      kana={kana}
      ward={ward}
      er={er}
      assignment={assignment}
      recent={recent}
    />
  );
}
