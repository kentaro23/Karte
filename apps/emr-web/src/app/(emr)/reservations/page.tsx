import { prisma } from '@medixus/db';
import { age } from '@medixus/domain';
import { Panel, PanelHeader, Badge, Icon, Button, Field, Input, Select, EmptyState } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import {
  createAppointment,
  createAppointmentForSlot,
  bulkCreateAppointments,
  cancelAppointment,
  arriveAppointment,
  seedSlots,
} from './actions';
import { ReservationCalendar, type SlotCell, type PatientOpt, type DeptOpt } from './calendar-client';

// 受付/カルテ同様、Prisma を読むため明示的に動的化。DB 未接続でもデモが描画される。
export const dynamic = 'force-dynamic';

type ApptRow = {
  id: string;
  scheduledAt: Date;
  patientLabel: string;
  patientNo: string;
  departmentId: string;
  kind: string;
  status: string;
};

// ── デモ（DB未接続）用の決定論サンプル ──────────────────────────────────────
const DEMO_DEPTS: DeptOpt[] = [
  { id: 'demo-dep-1', name: '内科' },
  { id: 'demo-dep-2', name: '小児科' },
  { id: 'demo-dep-3', name: '婦人科' },
];
const DEMO_PATIENTS: PatientOpt[] = [
  { id: 'demo-pat-1', label: '100001 佐藤 太郎' },
  { id: 'demo-pat-2', label: '100002 鈴木 花子' },
  { id: 'demo-pat-3', label: '100003 高橋 次郎' },
];

const TIMES = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '14:00', '14:30', '15:00', '15:30'];

/** 当日から数日分の日付キー（'YYYY-MM-DD'）。 */
function nextDays(n: number): string[] {
  const base = new Date();
  base.setHours(0, 0, 0, 0);
  return Array.from({ length: n }, (_, i) => new Date(base.getTime() + i * 86_400_000).toISOString().slice(0, 10));
}

function fmtKey(d: Date): { day: string; time: string } {
  // ローカル時刻ベースで 'YYYY-MM-DD' / 'HH:mm' を作る。
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return { day, time };
}

/** 当日含む数日分の枠＋予約数から CalendarGrid 用セルを構築（DB無時はデモ枠）。 */
function buildDemoCells(days: string[], firstDeptId: string): SlotCell[] {
  // 内科に当日帯の枠を擬似生成。一部は満枠で「定員超過拒否」UI を体感できるよう booked を載せる。
  const cells: SlotCell[] = [];
  days.forEach((day, di) => {
    TIMES.forEach((time, ti) => {
      const capacity = 2;
      // 適度に予約済を散らす（先頭日の午前を混雑させる）。
      const booked = di === 0 && ti < 3 ? (ti === 0 ? 2 : 1) : ti % 4 === 0 ? 1 : 0;
      cells.push({
        day,
        time,
        slotId: `demo-slot-${di}-${ti}`,
        departmentId: firstDeptId,
        doctorUserId: null,
        capacity,
        booked,
      });
    });
  });
  return cells;
}

export default async function ReservationsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const days = nextDays(5);
  const firstDay = days[0] ?? today;
  const lastDay = days[days.length - 1] ?? today;
  const rangeStart = new Date(`${firstDay}T00:00:00`);
  const rangeEnd = new Date(`${lastDay}T23:59:59`);

  let dbDown = false;

  // 診療科・患者（フォーム用）。
  let departments: DeptOpt[] = DEMO_DEPTS;
  let patients: PatientOpt[] = DEMO_PATIENTS;
  try {
    const [depts, ps] = await Promise.all([
      prisma.department.findMany(),
      prisma.patient.findMany({ orderBy: { createdAt: 'asc' }, take: 80 }),
    ]);
    if (depts.length > 0) departments = depts.map((d) => ({ id: d.id, name: d.name }));
    if (ps.length > 0)
      patients = ps.map((p) => ({
        id: p.id,
        label: `${p.patientNo} ${p.kanjiLastName} ${p.kanjiFirstName}`,
      }));
  } catch (err) {
    console.error('[ReservationsPage] dept/patient load failed, demo fallback:', err);
    dbDown = true;
  }
  const deptName = new Map(departments.map((d) => [d.id, d.name] as const));
  const firstDeptId = departments[0]?.id ?? 'demo-dep-1';

  // 予約一覧。
  let appts: ApptRow[] = [];
  try {
    const rows = await prisma.appointment.findMany({
      orderBy: { scheduledAt: 'asc' },
      take: 120,
      include: { patient: true },
    });
    appts = rows.map((a) => ({
      id: a.id,
      scheduledAt: a.scheduledAt,
      patientLabel: `${a.patient.kanjiLastName} ${a.patient.kanjiFirstName}（${age(a.patient.dateOfBirth)}）`,
      patientNo: a.patient.patientNo,
      departmentId: a.departmentId,
      kind: a.kind,
      status: a.status,
    }));
  } catch (err) {
    console.error('[ReservationsPage] appointment list failed, demo fallback:', err);
    dbDown = true;
  }

  // 予約枠カレンダー用セル（枠×予約数）。DB無 or 枠未登録ならデモ枠を提示。
  let cells: SlotCell[] = [];
  try {
    const slots = await prisma.appointmentSlot.findMany({
      where: { startAt: { gte: rangeStart, lte: rangeEnd } },
      orderBy: { startAt: 'asc' },
      take: 1000,
    });
    if (slots.length > 0) {
      const slotIds = slots.map((s) => s.id);
      // 取消/NO_SHOW を除く予約を枠ごとに集計（groupBy の型摩擦回避のため JS 集計）。
      const booked = await prisma.appointment.findMany({
        where: { slotId: { in: slotIds }, status: { notIn: ['CANCELLED', 'NO_SHOW'] } },
        select: { slotId: true },
        take: 5000,
      });
      const countMap = new Map<string, number>();
      for (const b of booked) if (b.slotId) countMap.set(b.slotId, (countMap.get(b.slotId) ?? 0) + 1);
      cells = slots.map((s) => {
        const { day, time } = fmtKey(s.startAt);
        return {
          day,
          time,
          slotId: s.id,
          departmentId: s.departmentId,
          doctorUserId: s.doctorUserId ?? null,
          capacity: s.capacity,
          booked: countMap.get(s.id) ?? 0,
        };
      });
    }
  } catch (err) {
    console.error('[ReservationsPage] slot load failed, demo fallback:', err);
    dbDown = true;
  }
  // 実枠が無ければデモ枠（DB接続済でも未投入なら操作体感のため提示）。
  const usingDemoSlots = cells.length === 0;
  if (usingDemoSlots) cells = buildDemoCells(days, firstDeptId);

  // カレンダーの行は実際に存在する時間帯のみ（デモ時は TIMES）。
  const gridTimes = usingDemoSlots
    ? TIMES
    : [...new Set(cells.map((c) => c.time))].sort();
  const gridDays = days;

  return (
    <PageBody>
      <PageHeader
        title="予約管理"
        desc="予約枠カレンダー・空き枠予約・複数日一括予約・予約↔受付連携（FR-APT-01 / 174項 1,3-4）"
        crumbs={['Medixus カルテ', '外来', '予約管理']}
      />
      {dbDown && (
        <div className="mb-3 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-2xs text-warn">
          デモ表示（DB未接続）：予約の作成・受付・取消は無効です。カレンダー／定員超過拒否／一括予約のUIを提示します。
        </div>
      )}
      {!dbDown && usingDemoSlots && (
        <div className="mb-3 rounded border border-line bg-soft px-3 py-1.5 text-2xs text-muted">
          予約枠（AppointmentSlot）が未登録のためサンプル枠を表示しています。下の「予約枠を作成」で当日枠を投入できます。
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_340px]">
        {/* 左：カレンダー＋一括予約＋一覧 */}
        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader
              title="予約枠カレンダー"
              desc="空き枠（緑）をクリックして予約を作成。定員超過は登録できません。"
              icon={<Icon name="calendar" size={15} />}
            />
            <ReservationCalendar
              days={gridDays}
              times={gridTimes}
              cells={cells}
              departments={departments}
              patients={patients}
              createForSlot={createAppointmentForSlot}
              bulkCreate={bulkCreateAppointments}
              dbDown={dbDown}
            />
          </Panel>

          <Panel pad={false}>
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="text-sm font-bold">予約一覧</span>
              <Badge tone="gray">{appts.length} 件</Badge>
            </div>
            {appts.length === 0 ? (
              <EmptyState title="予約はありません" icon={<Icon name="calendar" size={30} />} />
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-soft text-2xs uppercase text-muted">
                    <th className="px-3 py-2 text-left">予約日時</th>
                    <th className="px-3 py-2 text-left">患者</th>
                    <th className="px-3 py-2 text-left">診療科</th>
                    <th className="px-3 py-2 text-left">種別</th>
                    <th className="px-3 py-2 text-left">状態</th>
                    <th className="px-3 py-2 text-left">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {appts.map((a, i) => (
                    <tr key={a.id} className={i % 2 ? 'bg-soft/40' : ''}>
                      <td className="px-3 py-2 whitespace-nowrap">{a.scheduledAt.toLocaleString('ja-JP')}</td>
                      <td className="px-3 py-2">
                        <span className="font-mono text-2xs text-muted">{a.patientNo}</span> {a.patientLabel}
                      </td>
                      <td className="px-3 py-2">{deptName.get(a.departmentId) ?? '—'}</td>
                      <td className="px-3 py-2 text-xs">{a.kind === 'EXAM' ? '検査' : '診察'}</td>
                      <td className="px-3 py-2">
                        <Badge
                          tone={
                            a.status === 'CANCELLED' || a.status === 'NO_SHOW'
                              ? 'red'
                              : a.status === 'ARRIVED'
                                ? 'green'
                                : 'blue'
                          }
                        >
                          {a.status}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          {a.status !== 'CANCELLED' && a.status !== 'ARRIVED' && a.status !== 'NO_SHOW' && (
                            <form action={arriveAppointment}>
                              <input type="hidden" name="id" value={a.id} />
                              <Button size="sm" variant="primary" type="submit" disabled={dbDown}>
                                受付
                              </Button>
                            </form>
                          )}
                          {a.status !== 'CANCELLED' && (
                            <form action={cancelAppointment}>
                              <input type="hidden" name="id" value={a.id} />
                              <Button size="sm" variant="danger" type="submit" disabled={dbDown}>
                                取消
                              </Button>
                            </form>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        {/* 右：新規予約フォーム＋予約枠作成 */}
        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader title="新規予約" icon={<Icon name="plus" size={15} />} />
            <form action={createAppointment} className="flex flex-col gap-3">
              <Field label="患者" required>
                <Select name="patientId" required defaultValue="">
                  <option value="" disabled>
                    選択
                  </option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="診療科" required>
                <Select name="departmentId" required defaultValue={firstDeptId}>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="予約日" required>
                  <Input name="date" type="date" required defaultValue={today} />
                </Field>
                <Field label="時刻">
                  <Input name="time" type="time" defaultValue="09:00" />
                </Field>
              </div>
              <Field label="種別">
                <Select name="kind" defaultValue="CONSULT">
                  <option value="CONSULT">診察</option>
                  <option value="EXAM">検査</option>
                </Select>
              </Field>
              <Field label="コメント">
                <Input name="comment" placeholder="任意" />
              </Field>
              <Button type="submit" variant="primary" disabled={dbDown}>
                予約を登録
              </Button>
              <p className="text-2xs text-muted/70">
                時刻に該当する予約枠があれば定員チェックの対象になります（定員超過は登録不可）。
              </p>
            </form>
          </Panel>

          <Panel>
            <PanelHeader title="予約枠を作成" icon={<Icon name="calendar" size={15} />} />
            <form action={seedSlots} className="flex flex-col gap-3">
              <Field label="診療科" required>
                <Select name="departmentId" required defaultValue={firstDeptId}>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="対象日" required>
                <Input name="date" type="date" required defaultValue={today} />
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="開始時">
                  <Input name="startHour" type="number" min={0} max={20} defaultValue={9} />
                </Field>
                <Field label="終了時">
                  <Input name="endHour" type="number" min={1} max={22} defaultValue={12} />
                </Field>
                <Field label="定員">
                  <Input name="capacity" type="number" min={1} max={20} defaultValue={2} />
                </Field>
              </div>
              <Button type="submit" variant="secondary" disabled={dbDown}>
                <Icon name="plus" size={13} /> 30分枠を一括生成
              </Button>
              <p className="text-2xs text-muted/70">
                指定時間帯に 30 分刻みの予約枠（定員つき）を生成します。生成後カレンダーに反映されます。
              </p>
            </form>
          </Panel>
        </div>
      </div>
    </PageBody>
  );
}
