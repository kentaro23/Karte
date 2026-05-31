'use server';
import { revalidatePath } from 'next/cache';
import { prisma, type HomeVisitKind } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { storeRecord, shareToRegionalNetwork } from '@medixus/interop';
import { requireSession } from '@/lib/session';

/**
 * FR-HOM-01 訪問診療・モバイル/オフライン入力 のサーバーアクション群。
 *
 * - 訪問予定（Appointment + Encounter(HOMECARE)）の作成／受付化。
 * - タブレットでオフライン記録した訪問録（localStorage キュー）を復帰後に一括同期。
 * - 多職種連携（ケアマネ/薬局/訪問看護）への共有は interop（SS-MIX2/地域連携）シーム経由。
 *
 * 全アクションは fail-soft：DB 未接続・未マイグレーションでも例外で 500 にせず、
 * try/catch で握りつぶしてデモ描画を維持する（他ルート踏襲）。
 */

/** オフラインで記録され、復帰後に同期されてくる訪問録1件。 */
export type SyncedVisitRecord = {
  /** クライアント側で採番した一意キー（重複同期防止）。 */
  clientId: string;
  patientId: string;
  /** 訪問種別（医師訪問/訪問看護/居宅療養管理指導 等）。 */
  visitKind: string;
  /** 訪問日時 ISO。オフライン端末のローカル時刻。 */
  visitedAt: string;
  /** S/O/A/P を1本にまとめた訪問記録本文。 */
  note: string;
  /** バイタル（任意・自由記述：BP/HR/SpO2/BT 等）。 */
  vitals?: string;
};

export type SyncOutcome = {
  ok: boolean;
  synced: number;
  failed: number;
  /** 同期できた clientId（クライアントはこれをキューから除去する）。 */
  syncedIds: string[];
  message: string;
};

/** 在宅向け診療科（無ければ先頭診療科）を引く。fail-soft。 */
async function resolveHomecareDepartment(): Promise<string | null> {
  try {
    const dep =
      (await prisma.department.findFirst({ where: { name: { contains: '在宅' } } })) ??
      (await prisma.department.findFirst({ orderBy: { code: 'asc' } }));
    return dep?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * UI の訪問種別コード（DOCTOR/NURSE/CARE_GUIDANCE/REHAB …）を
 * Prisma enum HomeVisitKind（DOCTOR/NURSE/HOME_CARE_GUIDANCE/REHAB/PHARMACIST/OTHER）へ写像。
 * 未知値は OTHER に丸める（端末側の語彙ズレに対する後方互換）。
 */
const HOME_VISIT_KIND_MAP: Record<string, HomeVisitKind> = {
  DOCTOR: 'DOCTOR',
  NURSE: 'NURSE',
  CARE_GUIDANCE: 'HOME_CARE_GUIDANCE',
  HOME_CARE_GUIDANCE: 'HOME_CARE_GUIDANCE',
  REHAB: 'REHAB',
  PHARMACIST: 'PHARMACIST',
  OTHER: 'OTHER',
};

function toHomeVisitKind(v: string | null | undefined): HomeVisitKind {
  if (!v) return 'DOCTOR';
  return HOME_VISIT_KIND_MAP[v] ?? 'OTHER';
}

/** Prisma の unique 制約違反（P2002）か判定（clientId 冪等再同期の検出用）。 */
function isUniqueViolation(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2002'
  );
}

/**
 * 訪問予定を作成する。
 * Appointment（種別 HOMECARE）と、それに紐づく Encounter(HOMECARE / 非対面でない実訪問=FACE) を生成。
 * 業務ルール（FR-HOM-01 AC2）：訪問スケジュールとして一覧／カレンダーに載る。
 */
export async function scheduleVisit(formData: FormData) {
  const s = await requireSession();
  const patientId = String(formData.get('patientId') || '');
  const date = String(formData.get('date') || '');
  const time = String(formData.get('time') || '09:00');
  const visitKind = String(formData.get('visitKind') || 'DOCTOR');
  const comment = (formData.get('comment') as string) || null;
  if (!patientId || !date) return;

  const scheduledAt = new Date(`${date}T${time}:00`);
  const departmentId = (await resolveHomecareDepartment()) ?? '';
  if (!departmentId) {
    // 診療科が引けない（DB 未接続）→ デモ。no-op で戻す。
    revalidatePath('/homecare');
    return;
  }

  try {
    const appt = await prisma.appointment.create({
      data: {
        patientId,
        departmentId,
        scheduledAt,
        kind: 'HOMECARE',
        comment: comment ? `[${visitKind}] ${comment}` : `[${visitKind}]`,
        status: 'BOOKED',
      },
    });
    // 訪問の Encounter を予約に紐付けて先行生成（HOMECARE / 実訪問=FACE）。
    const enc = await prisma.encounter.create({
      data: {
        patientId,
        appointmentId: appt.id,
        encounterType: 'HOMECARE',
        visitType: 'RETURN',
        contactType: 'FACE',
        departmentId,
        receptionStatus: 'UNRECEIVED',
      },
    });
    // 任意で HomeVisit を先行生成（予定として確定。本文は訪問先で追記/同期される想定）。
    // 予約由来なので syncState=SYNCED、訪問種別を保持。本永続化の一覧はこのモデルを起点に集約。
    try {
      await prisma.homeVisit.create({
        data: {
          patientId,
          encounterId: enc.id,
          appointmentId: appt.id,
          visitKind: toHomeVisitKind(visitKind),
          visitedAt: scheduledAt,
          note: comment || null,
          syncState: 'SYNCED',
          recordedByUserId: s.userId,
        },
      });
    } catch (e) {
      console.error('[scheduleVisit] homeVisit pre-create (non-fatal):', e);
    }
    await writeAudit({
      actorUserId: s.userId,
      patientId,
      action: 'CHART_WRITE',
      resource: 'Appointment.homecare',
      resourceId: appt.id,
    });
  } catch (err) {
    console.error('[scheduleVisit] failed:', err);
  }
  revalidatePath('/homecare');
}

/**
 * 訪問予定の到着（受付化）。訪問先で「訪問開始」を押した想定。
 * 紐づく Encounter を ARRIVED にし、予約を ARRIVED に更新。
 */
export async function startVisit(formData: FormData) {
  const s = await requireSession();
  const appointmentId = String(formData.get('appointmentId') || '');
  if (!appointmentId) return;
  try {
    const appt = await prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!appt) return;
    const enc = await prisma.encounter
      .findUnique({ where: { appointmentId } })
      .catch(() => null);
    if (enc) {
      await prisma.encounter.update({
        where: { id: enc.id },
        data: { receptionStatus: 'ARRIVED', arrivedAt: new Date() },
      });
    }
    await prisma.appointment.update({ where: { id: appointmentId }, data: { status: 'ARRIVED' } });
    await writeAudit({
      actorUserId: s.userId,
      patientId: appt.patientId,
      action: 'CHART_WRITE',
      resource: 'Encounter.homecare.start',
      resourceId: appointmentId,
    });
  } catch (err) {
    console.error('[startVisit] failed:', err);
  }
  revalidatePath('/homecare');
}

export async function cancelVisit(formData: FormData) {
  const s = await requireSession();
  const appointmentId = String(formData.get('appointmentId') || '');
  if (!appointmentId) return;
  try {
    const appt = await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: 'CANCELLED' },
    });
    await writeAudit({
      actorUserId: s.userId,
      patientId: appt.patientId,
      action: 'CHART_WRITE',
      resource: 'Appointment.homecare.cancel',
      resourceId: appointmentId,
    });
  } catch (err) {
    console.error('[cancelVisit] failed:', err);
  }
  revalidatePath('/homecare');
}

/**
 * FR-HOM-01 AC1：オフライン記録の復帰後同期。
 * タブレットが localStorage に貯めた訪問録（複数件）を一括登録する。
 * 1件ずつ HOMECARE Encounter（非来院=訪問録）を確定し、note(SOAP本文)/vitals を
 * HomeVisit（追記専用・syncState=OFFLINE_QUEUED）へ本永続化する。成功 clientId を返す。
 * 冪等：HomeVisit.clientId の一意制約（再同期は既存検出 or P2002 を success 扱い）。
 * 1件失敗しても残りは続行（部分成功）。
 */
export async function syncOfflineRecords(records: SyncedVisitRecord[]): Promise<SyncOutcome> {
  if (!Array.isArray(records) || records.length === 0) {
    return { ok: true, synced: 0, failed: 0, syncedIds: [], message: '同期対象はありません。' };
  }
  let s: Awaited<ReturnType<typeof requireSession>>;
  try {
    s = await requireSession();
  } catch (err) {
    console.error('[syncOfflineRecords] no session:', err);
    return {
      ok: false,
      synced: 0,
      failed: records.length,
      syncedIds: [],
      message: 'セッションが無効です。再ログイン後に同期してください。',
    };
  }

  const departmentId = (await resolveHomecareDepartment()) ?? '';
  if (!departmentId) {
    // DB 未接続（フロントのみモード）：同期を成立させずクライアント側にキューを残す。
    return {
      ok: false,
      synced: 0,
      failed: records.length,
      syncedIds: [],
      message: 'デモ表示（DB未接続）のため実同期は行われません。キューは端末に保持されます。',
    };
  }

  const syncedIds: string[] = [];
  let failed = 0;
  for (const r of records) {
    if (!r?.clientId || !r?.patientId) {
      failed++;
      continue;
    }
    try {
      const visitedAt = new Date(r.visitedAt);
      const at = isNaN(visitedAt.getTime()) ? new Date() : visitedAt;

      // 端末由来の冪等同期：clientId 既存（P2002）なら HomeVisit を作らず既存扱い。
      // 追記専用モデルのため訂正は新規 INSERT（update しない）。
      const existing = await prisma.homeVisit
        .findUnique({ where: { clientId: r.clientId } })
        .catch(() => null);
      if (existing) {
        // 再同期：サーバ側に確定済み。端末キューから除去させる（成功扱い）。
        syncedIds.push(r.clientId);
        continue;
      }

      // 訪問録は HOMECARE の Encounter（非来院＝訪問録）として確定し、HomeVisit に本永続化。
      const enc = await prisma.encounter.create({
        data: {
          patientId: r.patientId,
          encounterType: 'HOMECARE',
          visitType: 'RETURN',
          contactType: 'FACE',
          departmentId,
          receptionStatus: 'CONSULTATION_DONE',
          arrivedAt: at,
        },
      });

      // 本永続化：note(SOAP本文)/vitals を HomeVisit へ昇格（旧実装は監査 detail / SS-MIX2 退避のみ）。
      // syncState=OFFLINE_QUEUED で「後追い同期由来」を明示。clientId 一意制約で冪等。
      try {
        await prisma.homeVisit.create({
          data: {
            patientId: r.patientId,
            encounterId: enc.id,
            visitKind: toHomeVisitKind(r.visitKind),
            visitedAt: at,
            note: r.note || null,
            vitals: r.vitals || null,
            syncState: 'OFFLINE_QUEUED',
            clientId: r.clientId,
            recordedByUserId: s.userId,
          },
        });
      } catch (e) {
        // 競合（多重タブ/二重送信）で clientId が同時 INSERT された場合は既存扱い＝成功。
        if (isUniqueViolation(e)) {
          syncedIds.push(r.clientId);
          continue;
        }
        throw e;
      }

      // 監査：本永続化（HomeVisit）への CHART_WRITE。本文は HomeVisit.note が一次ソース。
      await writeAudit({
        actorUserId: s.userId,
        patientId: r.patientId,
        action: 'CHART_WRITE',
        resource: `HomeVisit.offlineSync(${r.visitKind})`,
        resourceId: enc.id,
      });
      // 多職種連携：SS-MIX2/地域連携シームへ蓄積（STUB）。失敗は同期成否に影響させない。
      try {
        await storeRecord({
          patientRef: r.patientId,
          dataType: 'DIAGNOSIS',
          observedAt: at.toISOString(),
          payload: { kind: r.visitKind, note: r.note, vitals: r.vitals ?? null },
        });
      } catch (e) {
        console.error('[syncOfflineRecords] ssmix2 store (non-fatal):', e);
      }
      syncedIds.push(r.clientId);
    } catch (err) {
      console.error('[syncOfflineRecords] one record failed:', err);
      failed++;
    }
  }

  revalidatePath('/homecare');
  const synced = syncedIds.length;
  return {
    ok: failed === 0,
    synced,
    failed,
    syncedIds,
    message:
      failed === 0
        ? `${synced} 件をサーバーへ同期しました。`
        : `${synced} 件を同期、${failed} 件は失敗（端末に保持）しました。`,
  };
}

/**
 * 多職種連携：訪問看護指示書／居宅療養管理指導の共有を地域連携基盤へ依頼（STUB）。
 * ケアマネ/薬局/訪問看護への配信シームを叩いたことを監査に残す（本番化は IOP）。
 */
export async function shareCareDocument(formData: FormData): Promise<void> {
  const s = await requireSession();
  const patientId = String(formData.get('patientId') || '');
  const docType = String(formData.get('docType') || 'VISITING_NURSE_INSTRUCTION');
  if (!patientId) return;
  try {
    const res = await shareToRegionalNetwork(patientId);
    await writeAudit({
      actorUserId: s.userId,
      patientId,
      action: 'FILE_EXPORT',
      resource: `Homecare.share(${docType}:${res.status})`,
      resourceId: patientId,
    });
  } catch (err) {
    console.error('[shareCareDocument] failed:', err);
  }
  revalidatePath('/homecare');
}
