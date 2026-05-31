'use server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { requireSession } from '@/lib/session';

/**
 * 病床コード（"<roomCode>-<bedSubCode>" 形式。例: "301-1"）から bed/room を解決する。
 * 病床マップの選択肢 value（`${roomCode}-${bedCode}`）は seed 上の bed.code と一致するため、
 * まず bed.code 完全一致を試み、外れた場合は room.code + 末尾コードで再解決する。
 * 病床がマスタ化されていない（DB に該当 bed が無い）場合でも所在を残せるよう、
 * 解決できなければ bedId/roomId は null のまま bedCode を BedAssignment に保持する。
 */
async function resolveBed(
  wardId: string,
  bedCode: string,
): Promise<{ bedId: string | null; roomId: string | null; bedCode: string | null }> {
  if (!bedCode) return { bedId: null, roomId: null, bedCode: null };
  try {
    // bed.code（例 "301-1"）が選択肢 value と一致するケースを最優先で解決。
    const bed = await prisma.bed.findFirst({
      where: { code: bedCode, room: { wardId } },
      select: { id: true, roomId: true },
    });
    if (bed) return { bedId: bed.id, roomId: bed.roomId, bedCode };
    // 念のため room.code で部屋だけでも解決（"301-1" → room "301"）。
    const roomCode = bedCode.includes('-') ? bedCode.slice(0, bedCode.lastIndexOf('-')) : bedCode;
    const room = await prisma.room.findFirst({
      where: { code: roomCode, wardId },
      select: { id: true },
    });
    return { bedId: null, roomId: room?.id ?? null, bedCode };
  } catch {
    // 解決に失敗しても所在文字列は残す（追記専用の所在管理を優先）。
    return { bedId: null, roomId: null, bedCode };
  }
}

/**
 * 入院受付 — FR-WRD-01 AC(1)。患者に INPATIENT Encounter を作り病棟（任意で診療科・病床）を割当てる。
 * 本永続化: Encounter 作成後に Admission（status:ADMITTED）と初回 BedAssignment（reason:ADMISSION）を
 * 追記し、Encounter.currentBedId に在床病床をセットする。病床マスタが解決できない場合も
 * BedAssignment.bedCode に生コードを残して所在を保持する（追記専用の真正性を優先）。
 * 監査は action:ADMISSION。DB 未接続（フロントのみモード）でも 500 にしない＝try/catch でフェイルソフト。
 */
export async function admitPatient(formData: FormData) {
  const patientId = String(formData.get('patientId') || '');
  const wardId = String(formData.get('wardId') || '');
  const departmentId = String(formData.get('departmentId') || '');
  const bedCode = String(formData.get('bedCode') || '');
  if (!patientId || !wardId) return;
  try {
    const s = await requireSession();
    const p = await prisma.patient.findUnique({ where: { id: patientId } });
    if (!p) return;
    const dept = departmentId
      ? await prisma.department.findUnique({ where: { id: departmentId } })
      : await prisma.department.findFirst({ where: { clinicId: p.clinicId } });
    const bed = await resolveBed(wardId, bedCode);
    const e = await prisma.encounter.create({
      data: {
        patientId,
        encounterType: 'INPATIENT',
        contactType: 'FACE',
        departmentId: dept?.id ?? 'unknown',
        wardId,
        receptionStatus: 'IN_CONSULTATION',
        arrivedAt: new Date(),
        // 在床病床を即時反映（履歴は BedAssignment）。解決できなければ未割当のまま。
        ...(bed.bedId ? { currentBedId: bed.bedId } : {}),
      },
    });
    // 入院（Admission）本体。Encounter と 1:1（encounterId @unique）。
    try {
      await prisma.admission.create({
        data: {
          encounterId: e.id,
          patientId,
          wardId,
          status: 'ADMITTED',
          admittedByUserId: s.userId,
          ...(bedCode ? { admissionReason: `入院受付（病床: ${bedCode}）` } : {}),
        },
      });
    } catch (err) {
      console.error('[ward] admitPatient: admission create failed (fail-soft):', err);
    }
    // 初回病床割当（追記専用）。reason:ADMISSION。
    try {
      await prisma.bedAssignment.create({
        data: {
          encounterId: e.id,
          patientId,
          wardId,
          roomId: bed.roomId,
          bedId: bed.bedId,
          bedCode: bed.bedCode,
          reason: 'ADMISSION',
          assignedByUserId: s.userId,
        },
      });
    } catch (err) {
      console.error('[ward] admitPatient: bedAssignment create failed (fail-soft):', err);
    }
    await writeAudit({
      actorUserId: s.userId,
      patientId,
      action: 'ADMISSION',
      resource: 'Admission',
      resourceId: e.id,
      detail: { wardId, departmentId: dept?.id ?? null, bedCode: bedCode || null, bedId: bed.bedId },
    });
  } catch (err) {
    console.error('[ward] admitPatient failed (fail-soft):', err);
  }
  revalidatePath('/ward/admissions');
  revalidatePath('/ward/map');
}

/**
 * 転棟／転科／転室 — FR-WRD-01 AC(2)。在院 Encounter の病棟・診療科（任意で病床）を付け替える。
 * 本永続化: 当該 Encounter の releasedAt IS NULL な BedAssignment を releasedAt=now() でクローズし、
 * 新しい BedAssignment（追記専用）を INSERT する（reason: 病棟変更=WARD_TRANSFER / 科変更=DEPARTMENT_TRANSFER /
 * 病床のみ=ROOM_TRANSFER、note=移動理由）。Encounter.currentBedId も付け替える。監査は action:TRANSFER。
 * 転棟・転科・転室のいずれか1つ以上が指定されている必要がある（移動記録＝法定の所在管理）。
 */
export async function transferPatient(formData: FormData) {
  const id = String(formData.get('id') || '');
  const toWardId = String(formData.get('toWardId') || '');
  const toDepartmentId = String(formData.get('toDepartmentId') || '');
  const toBedCode = String(formData.get('toBedCode') || '');
  const reason = String(formData.get('reason') || '').trim();
  if (!id) return;
  try {
    const s = await requireSession();
    const before = await prisma.encounter.findUnique({ where: { id } });
    if (!before) return;
    const data: { wardId?: string; departmentId?: string; currentBedId?: string | null } = {};
    const wardChanged = !!toWardId && toWardId !== before.wardId;
    const deptChanged = !!toDepartmentId && toDepartmentId !== before.departmentId;
    if (wardChanged) data.wardId = toWardId;
    if (deptChanged) data.departmentId = toDepartmentId;

    // 移動先病床の解決（病棟が変わるならその病棟内で、変わらないなら現病棟内で）。
    const effectiveWardId = data.wardId ?? before.wardId ?? toWardId;
    const bed = await resolveBed(effectiveWardId, toBedCode);
    const bedChanged = !!bed.bedId && bed.bedId !== before.currentBedId;
    // 病棟が変われば旧病床は無効 → 解決できた病床（無ければ null）で必ず付け替える。
    // 同一病棟で病床指定があれば、その病床（解決できれば）で付け替える。
    if (wardChanged) data.currentBedId = bed.bedId;
    else if (bedChanged) data.currentBedId = bed.bedId;

    // 移動理由の判定（病棟 > 科 > 室 の優先順。BedMoveReason enum）。
    const moveReason = wardChanged
      ? 'WARD_TRANSFER'
      : deptChanged
        ? 'DEPARTMENT_TRANSFER'
        : 'ROOM_TRANSFER';

    // 病棟・診療科・病床いずれも変わらなければ Encounter 更新は不要（移動記録のみ残す）。
    const e =
      Object.keys(data).length > 0
        ? await prisma.encounter.update({ where: { id }, data })
        : before;

    // 直近の有効な BedAssignment（releasedAt 未設定）をクローズ → 新規 INSERT（追記専用・訂正は新規行）。
    try {
      await prisma.bedAssignment.updateMany({
        where: { encounterId: id, releasedAt: null },
        data: { releasedAt: new Date() },
      });
      await prisma.bedAssignment.create({
        data: {
          encounterId: id,
          patientId: e.patientId,
          wardId: effectiveWardId,
          roomId: bed.roomId,
          bedId: bed.bedId,
          bedCode: bed.bedCode,
          reason: moveReason,
          note: reason || null,
          assignedByUserId: s.userId,
        },
      });
    } catch (err) {
      console.error('[ward] transferPatient: bedAssignment move failed (fail-soft):', err);
    }

    await writeAudit({
      actorUserId: s.userId,
      patientId: e.patientId,
      action: 'TRANSFER',
      resource: 'Transfer',
      resourceId: id,
      detail: {
        fromWardId: before.wardId ?? null,
        toWardId: data.wardId ?? before.wardId ?? null,
        fromDepartmentId: before.departmentId ?? null,
        toDepartmentId: data.departmentId ?? before.departmentId ?? null,
        fromBedId: before.currentBedId ?? null,
        toBedId: bed.bedId,
        toBedCode: toBedCode || null,
        reason: reason || null,
        kind: moveReason,
      },
    });
  } catch (err) {
    console.error('[ward] transferPatient failed (fail-soft):', err);
  }
  revalidatePath('/ward/admissions');
  revalidatePath('/ward/map');
}

/**
 * 退院確定 — FR-WRD-01。本永続化: Admission を status:DISCHARGED / dischargedAt にし、
 * 当該 Encounter の有効な BedAssignment を releasedAt=now() でクローズ、Encounter.currentBedId を NULL にする。
 * receptionStatus も BILLING_DONE に進め在院一覧から外す。監査は action:DISCHARGE。
 */
export async function dischargePatient(formData: FormData) {
  const id = String(formData.get('id') || '');
  const reason = String(formData.get('reason') || '').trim();
  if (!id) return;
  try {
    const s = await requireSession();
    const e = await prisma.encounter.update({
      where: { id },
      data: { receptionStatus: 'BILLING_DONE', currentBedId: null },
    });
    // Admission を退院に更新（更新可モデル）。存在しない（旧データ）でも落とさない。
    try {
      await prisma.admission.updateMany({
        where: { encounterId: id, status: 'ADMITTED' },
        data: {
          status: 'DISCHARGED',
          dischargedAt: new Date(),
          ...(reason ? { dischargeReason: reason } : {}),
        },
      });
    } catch (err) {
      console.error('[ward] dischargePatient: admission update failed (fail-soft):', err);
    }
    // 有効な病床割当をクローズ（追記専用 → releasedAt のみ update 可）。
    try {
      await prisma.bedAssignment.updateMany({
        where: { encounterId: id, releasedAt: null },
        data: { releasedAt: new Date() },
      });
    } catch (err) {
      console.error('[ward] dischargePatient: bedAssignment release failed (fail-soft):', err);
    }
    await writeAudit({
      actorUserId: s.userId,
      patientId: e.patientId,
      action: 'DISCHARGE',
      resource: 'Discharge',
      resourceId: id,
      detail: { wardId: e.wardId ?? null, reason: reason || null },
    });
  } catch (err) {
    console.error('[ward] dischargePatient failed (fail-soft):', err);
  }
  revalidatePath('/ward/admissions');
  revalidatePath('/ward/map');
}

async function record(formData: FormData, docType: string, path: string) {
  const s = await requireSession();
  const patientId = String(formData.get('patientId'));
  const title = String(formData.get('title') || docType);
  const body = String(formData.get('body') || '');
  if (!patientId) return;
  await prisma.clinicalDocument.create({
    data: { patientId, docType, title, format: 'TEXT', body, createdByUserId: s.userId },
  });
  await writeAudit({ actorUserId: s.userId, patientId, action: 'CHART_WRITE', resource: docType });
  revalidatePath(`${path}?patientId=${patientId}`);
}

export async function addProgress(formData: FormData) {
  const temp = formData.get('temp');
  const bp = formData.get('bp');
  const pulse = formData.get('pulse');
  const spo2 = formData.get('spo2');
  formData.set('title', `経過記録 ${new Date().toLocaleString('ja-JP')}`);
  formData.set('body', `体温${temp}℃ / 血圧${bp} / 脈${pulse} / SpO2 ${spo2}% / 記録: ${formData.get('note') || ''}`);
  await record(formData, '経過記録', '/ward/progress');
}

export async function addNursing(formData: FormData) {
  formData.set('title', `看護記録 ${new Date().toLocaleString('ja-JP')}`);
  await record(formData, '看護記録', '/ward/nursing');
}
