'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { formatOrderNo, assertOrderTransition, type OrderType } from '@medixus/domain';
import { requireSession } from '@/lib/session';

/** Generic order creation for non-Rx types (Rx uses the safety-checked chart flow). */
export async function createOrder(formData: FormData) {
  const s = await requireSession();
  const patientId = String(formData.get('patientId'));
  const orderType = String(formData.get('orderType')) as OrderType;
  const itemName = String(formData.get('itemName') || '').trim();
  const qty = Number(formData.get('qty') || 1);
  const note = String(formData.get('note') || '');
  const urgent = formData.get('urgent') === 'on';
  if (!patientId || !orderType || !itemName) return { error: '必須項目が未入力です' };

  const patient = await prisma.patient.findUnique({ where: { id: patientId } });
  if (!patient) return { error: '患者が見つかりません' };
  const dept = await prisma.department.findFirst({ where: { clinicId: patient.clinicId } });

  // an encounter to attach to (reuse latest open, else create outpatient)
  let enc = await prisma.encounter.findFirst({
    where: { patientId, receptionStatus: { notIn: ['BILLING_DONE', 'CANCELLED', 'NO_SHOW'] } },
    orderBy: { createdAt: 'desc' },
  });
  if (!enc) {
    enc = await prisma.encounter.create({
      data: {
        patientId,
        encounterType: 'OUTPATIENT',
        visitType: 'RETURN',
        contactType: 'FACE',
        departmentId: dept?.id ?? 'unknown',
        receptionStatus: 'IN_CONSULTATION',
        arrivedAt: new Date(),
      },
    });
  }

  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const seq = (await prisma.order.count({ where: { createdAt: { gte: dayStart } } })) + 1;

  const order = await prisma.order.create({
    data: {
      orderNo: formatOrderNo(new Date(), seq),
      patientId,
      encounterId: enc.id,
      orderType,
      departmentId: enc.departmentId,
      ordererUserId: s.userId,
      status: 'DRAFT',
      isUrgent: urgent,
      detail: { itemName, qty, note } as object,
    },
  });
  // DRAFT → REQUESTED (state machine guarded)
  assertOrderTransition('DRAFT', 'REQUESTED');
  await prisma.order.update({ where: { id: order.id }, data: { status: 'REQUESTED' } });
  await writeAudit({
    actorUserId: s.userId,
    patientId,
    action: 'ORDER_ISSUE',
    resource: `Order:${orderType}`,
    resourceId: order.id,
    detail: { itemName, qty },
  });
  revalidatePath('/orders');
  return { ok: true };
}

export async function receiveOrder(formData: FormData) {
  const s = await requireSession();
  const id = String(formData.get('id'));
  const o = await prisma.order.findUniqueOrThrow({ where: { id } });
  assertOrderTransition(o.status as never, 'RECEIVED');
  await prisma.order.update({ where: { id }, data: { status: 'RECEIVED' } });
  await prisma.orderReception.create({ data: { orderId: id, receivedByUserId: s.userId } });
  await writeAudit({ actorUserId: s.userId, action: 'ORDER_ISSUE', resource: 'Order.receive', resourceId: id });
  revalidatePath('/orders');
}
