'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { requireSession } from '@/lib/session';

export async function createAppointment(formData: FormData) {
  const s = await requireSession();
  const patientId = String(formData.get('patientId'));
  const departmentId = String(formData.get('departmentId'));
  const date = String(formData.get('date'));
  const time = String(formData.get('time') || '09:00');
  if (!patientId || !departmentId || !date) return;
  const scheduledAt = new Date(`${date}T${time}:00`);
  const a = await prisma.appointment.create({
    data: { patientId, departmentId, scheduledAt, kind: String(formData.get('kind') || 'CONSULT'), status: 'BOOKED' },
  });
  await writeAudit({ actorUserId: s.userId, patientId, action: 'CHART_WRITE', resource: 'Appointment', resourceId: a.id });
  revalidatePath('/reservations');
}

export async function cancelAppointment(formData: FormData) {
  const s = await requireSession();
  const id = String(formData.get('id'));
  const a = await prisma.appointment.update({ where: { id }, data: { status: 'CANCELLED' } });
  await writeAudit({ actorUserId: s.userId, patientId: a.patientId, action: 'CHART_WRITE', resource: 'Appointment.cancel', resourceId: id });
  revalidatePath('/reservations');
}
