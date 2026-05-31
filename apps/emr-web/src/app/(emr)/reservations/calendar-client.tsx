'use client';
import * as React from 'react';
import {
  CalendarGrid,
  type CalendarSlot,
  type CalendarColumn,
  Modal,
  Field,
  Select,
  Input,
  Button,
  Icon,
  Badge,
} from '@medixus/ui';

// ── 型 ───────────────────────────────────────────────────────────────────────
export type SlotCell = {
  /** 列キー = 'YYYY-MM-DD' */
  day: string;
  /** 行キー = 'HH:mm' */
  time: string;
  slotId: string | null;
  departmentId: string;
  doctorUserId: string | null;
  capacity: number;
  booked: number;
};

export type PatientOpt = { id: string; label: string };
export type DeptOpt = { id: string; name: string };

/**
 * 予約枠カレンダー（client島）。
 * - AppointmentSlot×当日予約数から空き/満枠/枠なしを CalendarGrid で色分け表示。
 * - 空き枠クリックで「予約作成」モーダル → サーバーアクション createAppointmentForSlot。
 *   定員超過はサーバー側で拒否（業務ルール）。
 * - 別パネルで「複数日 一括予約」フォーム（bulkCreateAppointments）も提供。
 * フロントのみモード（DB未接続）でも枠は空配列で描画され、操作UIは出る（no-op）。
 */
export function ReservationCalendar({
  days,
  times,
  cells,
  departments,
  patients,
  createForSlot,
  bulkCreate,
  dbDown,
}: {
  /** 列＝日付（'YYYY-MM-DD' 昇順） */
  days: string[];
  /** 行＝時間枠（'HH:mm'） */
  times: string[];
  cells: SlotCell[];
  departments: DeptOpt[];
  patients: PatientOpt[];
  createForSlot: (formData: FormData) => Promise<void>;
  bulkCreate: (formData: FormData) => Promise<void>;
  dbDown: boolean;
}) {
  const [picked, setPicked] = React.useState<SlotCell | null>(null);

  const cellMap = React.useMemo(() => {
    const m = new Map<string, SlotCell>();
    for (const c of cells) m.set(`${c.day}|${c.time}`, c);
    return m;
  }, [cells]);

  const deptName = React.useMemo(() => new Map(departments.map((d) => [d.id, d.name] as const)), [departments]);

  const columns: CalendarColumn[] = React.useMemo(
    () =>
      days.map((d) => {
        const dt = new Date(`${d}T00:00:00`);
        const wd = ['日', '月', '火', '水', '木', '金', '土'][dt.getDay()] ?? '';
        return { key: d, header: `${dt.getMonth() + 1}/${dt.getDate()}（${wd}）` };
      }),
    [days],
  );

  const slots: CalendarSlot[] = React.useMemo(
    () =>
      cells.map((c) => {
        const full = c.booked >= c.capacity;
        return {
          day: c.day,
          time: c.time,
          state: full ? 'booked' : 'available',
          label: `${c.booked}/${c.capacity}`,
        };
      }),
    [cells],
  );

  const handleSelect = React.useCallback(
    (slot: CalendarSlot) => {
      const c = cellMap.get(`${slot.day}|${slot.time}`);
      if (!c) return;
      if (c.booked >= c.capacity) return; // 満枠は開かない（サーバーでも拒否）
      setPicked(c);
    },
    [cellMap],
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="mb-2 flex items-center gap-3 text-2xs text-muted">
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm bg-accent-100" /> 空き
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm bg-blue-100" /> 満枠
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm bg-soft" /> 枠なし
          </span>
          <span className="ml-auto">セルの数字＝予約数／定員。空き枠クリックで予約作成。</span>
        </div>
        {columns.length === 0 || times.length === 0 ? (
          <div className="rounded border border-dashed border-line px-3 py-6 text-center text-xs text-muted">
            表示できる予約枠がありません。右の「予約枠を作成」で枠を追加するか、一括予約をご利用ください。
          </div>
        ) : (
          <CalendarGrid columns={columns} times={times} slots={slots} onSelect={handleSelect} />
        )}
      </div>

      {/* 空き枠クリック → 予約作成モーダル */}
      <Modal
        open={!!picked}
        onClose={() => setPicked(null)}
        title={
          picked
            ? `予約作成：${picked.day} ${picked.time}（${deptName.get(picked.departmentId) ?? '—'}）`
            : '予約作成'
        }
      >
        {picked && (
          <form action={createForSlot} className="flex flex-col gap-3">
            <input type="hidden" name="slotId" value={picked.slotId ?? ''} />
            <input type="hidden" name="departmentId" value={picked.departmentId} />
            <input type="hidden" name="date" value={picked.day} />
            <input type="hidden" name="time" value={picked.time} />
            {picked.doctorUserId && <input type="hidden" name="doctorUserId" value={picked.doctorUserId} />}
            <div className="flex items-center gap-2 text-2xs text-muted">
              <Badge tone="gray">
                残り {Math.max(0, picked.capacity - picked.booked)} / 定員 {picked.capacity}
              </Badge>
              <span>定員超過は登録できません。</span>
            </div>
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
            <Field label="種別">
              <Select name="kind" defaultValue="CONSULT">
                <option value="CONSULT">診察</option>
                <option value="EXAM">検査</option>
              </Select>
            </Field>
            <Field label="コメント">
              <Input name="comment" placeholder="任意" />
            </Field>
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setPicked(null)}>
                取消
              </Button>
              <Button type="submit" variant="primary" disabled={dbDown}>
                <Icon name="check" size={13} /> この枠で予約
              </Button>
            </div>
            {dbDown && (
              <p className="text-2xs text-warn">デモ表示（DB未接続）のため、実際の登録は行われません。</p>
            )}
          </form>
        )}
      </Modal>

      {/* 複数日 一括予約 */}
      <BulkBooking departments={departments} patients={patients} bulkCreate={bulkCreate} dbDown={dbDown} />
    </div>
  );
}

/** 同一患者・同一曜日帯を複数日にまとめて予約（定期通院・リハ等）。 */
function BulkBooking({
  departments,
  patients,
  bulkCreate,
  dbDown,
}: {
  departments: DeptOpt[];
  patients: PatientOpt[];
  bulkCreate: (formData: FormData) => Promise<void>;
  dbDown: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="rounded border border-line bg-soft/40 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wide text-muted">
        <Icon name="calendar" size={13} /> 複数日 一括予約
      </div>
      <form action={bulkCreate} className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
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
          <Select name="departmentId" required defaultValue={departments[0]?.id ?? ''}>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="種別">
          <Select name="kind" defaultValue="CONSULT">
            <option value="CONSULT">診察</option>
            <option value="EXAM">検査</option>
          </Select>
        </Field>
        <Field label="開始日" required>
          <Input name="startDate" type="date" required defaultValue={today} />
        </Field>
        <Field label="時刻">
          <Input name="time" type="time" defaultValue="09:00" />
        </Field>
        <Field label="間隔（日）">
          <Input name="intervalDays" type="number" min={1} max={90} defaultValue={7} />
        </Field>
        <Field label="回数">
          <Input name="count" type="number" min={1} max={26} defaultValue={4} />
        </Field>
        <div className="flex items-end sm:col-span-2 lg:col-span-1">
          <Button type="submit" variant="secondary" disabled={dbDown}>
            <Icon name="plus" size={13} /> 一括予約を作成
          </Button>
        </div>
      </form>
      <p className="mt-1.5 text-2xs text-muted/70">
        開始日から「間隔（日）×回数」で連続予約を作成します（例：週1回×4回）。各日の枠定員を超える日はスキップします。
      </p>
    </div>
  );
}
