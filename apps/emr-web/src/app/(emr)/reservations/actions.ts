'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { requireSession } from '@/lib/session';

/** 当日のスタート/エンドから対象 AppointmentSlot を引く（重なりで判定）。 */
async function findSlotAt(departmentId: string, at: Date) {
  try {
    return await prisma.appointmentSlot.findFirst({
      where: { departmentId, startAt: { lte: at }, endAt: { gt: at } },
    });
  } catch {
    return null;
  }
}

/** 指定枠の現予約数（取消・NO_SHOW を除く）。 */
async function countActiveForSlot(slotId: string): Promise<number> {
  try {
    return await prisma.appointment.count({
      where: { slotId, status: { notIn: ['CANCELLED', 'NO_SHOW'] } },
    });
  } catch {
    return 0;
  }
}

/**
 * 既存：フォーム（右ペイン）からの単発予約。枠が存在すれば定員超過を拒否する。
 * 互換のためシグネチャ（FormData → void）は維持。
 */
export async function createAppointment(formData: FormData) {
  const s = await requireSession();
  const patientId = String(formData.get('patientId'));
  const departmentId = String(formData.get('departmentId'));
  const date = String(formData.get('date'));
  const time = String(formData.get('time') || '09:00');
  if (!patientId || !departmentId || !date) return;
  const scheduledAt = new Date(`${date}T${time}:00`);

  // 枠があれば定員チェック（業務ルール：定員超過予約は不可）。
  const slot = await findSlotAt(departmentId, scheduledAt);
  if (slot) {
    const booked = await countActiveForSlot(slot.id);
    if (booked >= slot.capacity) {
      revalidatePath('/reservations');
      return; // 満枠：作成しない
    }
  }

  try {
    const a = await prisma.appointment.create({
      data: {
        patientId,
        departmentId,
        scheduledAt,
        slotId: slot?.id ?? null,
        kind: String(formData.get('kind') || 'CONSULT'),
        comment: (formData.get('comment') as string) || null,
        status: 'BOOKED',
      },
    });
    await writeAudit({ actorUserId: s.userId, patientId, action: 'CHART_WRITE', resource: 'Appointment', resourceId: a.id });
  } catch (err) {
    console.error('[createAppointment] failed:', err);
  }
  revalidatePath('/reservations');
}

/**
 * 空き枠カレンダーのセルクリックからの予約作成。
 * 業務ルール：定員超過は拒否（slot.capacity を厳守）。
 */
export async function createAppointmentForSlot(formData: FormData) {
  const s = await requireSession();
  const patientId = String(formData.get('patientId'));
  const departmentId = String(formData.get('departmentId'));
  const date = String(formData.get('date'));
  const time = String(formData.get('time') || '09:00');
  const slotId = (formData.get('slotId') as string) || '';
  if (!patientId || !departmentId || !date) return;
  const scheduledAt = new Date(`${date}T${time}:00`);

  // 枠 ID 直指定（カレンダー由来）。なければ時刻から引く。
  let slot = slotId
    ? await prisma.appointmentSlot.findUnique({ where: { id: slotId } }).catch(() => null)
    : null;
  if (!slot) slot = await findSlotAt(departmentId, scheduledAt);

  if (slot) {
    const booked = await countActiveForSlot(slot.id);
    if (booked >= slot.capacity) {
      // 定員超過拒否。
      revalidatePath('/reservations');
      return;
    }
  }

  try {
    const a = await prisma.appointment.create({
      data: {
        patientId,
        departmentId,
        scheduledAt,
        slotId: slot?.id ?? null,
        doctorUserId: (formData.get('doctorUserId') as string) || null,
        kind: String(formData.get('kind') || 'CONSULT'),
        comment: (formData.get('comment') as string) || null,
        status: 'BOOKED',
      },
    });
    await writeAudit({ actorUserId: s.userId, patientId, action: 'CHART_WRITE', resource: 'Appointment.slot', resourceId: a.id });
  } catch (err) {
    console.error('[createAppointmentForSlot] failed:', err);
  }
  revalidatePath('/reservations');
}

/**
 * 複数日 一括予約（定期通院・リハ等）。
 * 開始日から intervalDays × count 回を作成。各日の枠定員超過分はスキップ。
 */
export async function bulkCreateAppointments(formData: FormData) {
  const s = await requireSession();
  const patientId = String(formData.get('patientId'));
  const departmentId = String(formData.get('departmentId'));
  const startDate = String(formData.get('startDate'));
  const time = String(formData.get('time') || '09:00');
  const kind = String(formData.get('kind') || 'CONSULT');
  const intervalDays = Math.min(90, Math.max(1, Number(formData.get('intervalDays') || 7)));
  const count = Math.min(26, Math.max(1, Number(formData.get('count') || 4)));
  if (!patientId || !departmentId || !startDate) return;

  const base = new Date(`${startDate}T${time}:00`);
  let created = 0;
  for (let i = 0; i < count; i++) {
    const at = new Date(base.getTime() + i * intervalDays * 86_400_000);
    const slot = await findSlotAt(departmentId, at);
    if (slot) {
      const booked = await countActiveForSlot(slot.id);
      if (booked >= slot.capacity) continue; // 満枠日はスキップ
    }
    try {
      await prisma.appointment.create({
        data: {
          patientId,
          departmentId,
          scheduledAt: at,
          slotId: slot?.id ?? null,
          kind,
          status: 'BOOKED',
        },
      });
      created++;
    } catch (err) {
      console.error('[bulkCreateAppointments] one failed:', err);
    }
  }
  if (created > 0) {
    await writeAudit({
      actorUserId: s.userId,
      patientId,
      action: 'CHART_WRITE',
      resource: 'Appointment.bulk',
      resourceId: `${departmentId}:${startDate}:x${created}`,
    });
  }
  revalidatePath('/reservations');
}

export async function cancelAppointment(formData: FormData) {
  const s = await requireSession();
  const id = String(formData.get('id'));
  try {
    const a = await prisma.appointment.update({ where: { id }, data: { status: 'CANCELLED' } });
    await writeAudit({ actorUserId: s.userId, patientId: a.patientId, action: 'CHART_WRITE', resource: 'Appointment.cancel', resourceId: id });
  } catch (err) {
    console.error('[cancelAppointment] failed:', err);
  }
  revalidatePath('/reservations');
}

/**
 * 予約からの受付：Encounter を生成し appointmentId を紐付け、予約を ARRIVED に。
 * 業務ルール（FR-APT-01 AC3）：予約患者を受付すると当該予約が ARRIVED になり受付一覧に出る。
 */
export async function arriveAppointment(formData: FormData) {
  const s = await requireSession();
  const id = String(formData.get('id'));
  if (!id) return;
  try {
    const appt = await prisma.appointment.findUnique({ where: { id }, include: { patient: true } });
    if (!appt) return;

    // 二重受付ガード：既に紐付く Encounter があれば再生成しない。
    const existing = await prisma.encounter.findUnique({ where: { appointmentId: id } }).catch(() => null);
    if (!existing) {
      await prisma.encounter.create({
        data: {
          patientId: appt.patientId,
          appointmentId: id,
          encounterType: 'OUTPATIENT',
          visitType: 'RETURN',
          contactType: 'FACE',
          departmentId: appt.departmentId,
          receptionStatus: 'ARRIVED',
          arrivedAt: new Date(),
        },
      });
    }
    await prisma.appointment.update({ where: { id }, data: { status: 'ARRIVED' } });
    await writeAudit({
      actorUserId: s.userId,
      patientId: appt.patientId,
      action: 'CHART_WRITE',
      resource: 'Appointment.arrive',
      resourceId: id,
    });
  } catch (err) {
    console.error('[arriveAppointment] failed:', err);
  }
  revalidatePath('/reservations');
}

/** デモ/初期投入用：診療科に当日の予約枠（定員つき）を一括生成。 */
export async function seedSlots(formData: FormData) {
  const s = await requireSession();
  const departmentId = String(formData.get('departmentId'));
  const date = String(formData.get('date'));
  const capacity = Math.min(20, Math.max(1, Number(formData.get('capacity') || 2)));
  const startHour = Math.min(20, Math.max(0, Number(formData.get('startHour') || 9)));
  const endHour = Math.min(22, Math.max(startHour + 1, Number(formData.get('endHour') || 12)));
  if (!departmentId || !date) return;
  try {
    for (let h = startHour; h < endHour; h++) {
      for (const m of [0, 30]) {
        const startAt = new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`);
        const endAt = new Date(startAt.getTime() + 30 * 60 * 1000);
        // 既存枠の重複生成を避ける。
        const dup = await prisma.appointmentSlot
          .findFirst({ where: { departmentId, startAt } })
          .catch(() => null);
        if (dup) continue;
        await prisma.appointmentSlot.create({ data: { departmentId, startAt, endAt, capacity } });
      }
    }
    await writeAudit({
      actorUserId: s.userId,
      action: 'CHART_WRITE',
      resource: 'AppointmentSlot.seed',
      resourceId: `${departmentId}:${date}`,
    });
  } catch (err) {
    console.error('[seedSlots] failed:', err);
  }
  revalidatePath('/reservations');
}
