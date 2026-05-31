import { prisma } from '@medixus/db';
import { blocksToPlainText, type SoapBlock } from '@medixus/domain';
import { Panel, PanelHeader, Badge, Icon, Button, Field, Input, Select, EmptyState } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import { getSession } from '@/lib/session';
import {
  approveCountersign,
  rejectCountersign,
  createSticky,
  deleteSticky,
} from './actions';

/* ── 型（フロントのみモードのフォールバックにも使う） ───────────────────── */
type CountersignRow = {
  id: string;
  status: 'UNAPPROVED' | 'APPROVED' | 'REJECTED';
  superviseDoctorId: string;
  approvedAt: Date | null;
  approvedByUserId: string | null;
  comment: string | null;
  noteText: string;
  noteType: string;
  recordedDate: Date | null;
  authorUserId: string;
  patientName: string;
};
type StickyRow = {
  id: string;
  title: string;
  body: string;
  color: string;
  scope: 'PRIVATE' | 'CLINIC_WIDE';
  patientId: string | null;
  patientName: string | null;
  createdByUserId: string;
  createdAt: Date | null;
};
type PatientOpt = { id: string; patientNo: string; name: string };

const CS_STATUS_LABEL: Record<CountersignRow['status'], string> = {
  UNAPPROVED: '未承認',
  APPROVED: '承認済',
  REJECTED: '却下',
};
const CS_STATUS_TONE: Record<CountersignRow['status'], 'amber' | 'green' | 'red'> = {
  UNAPPROVED: 'amber',
  APPROVED: 'green',
  REJECTED: 'red',
};
const NOTE_TYPE_LABEL: Record<string, string> = {
  PROGRESS: '経過記録',
  NURSING: '看護記録',
  NUTRITION: '栄養記録',
  REPORT: 'レポート',
  REHAB: 'リハ記録',
  ER: '救急記録',
  ASSESSMENT: '初期評価',
  SYMPTOM_DETAIL: '症状詳記',
};

/* ── フロントのみモード用デモデータ ─────────────────────────────────────── */
function demoCountersigns(): CountersignRow[] {
  return [
    {
      id: 'demo-cs-1',
      status: 'UNAPPROVED',
      superviseDoctorId: 'demo-staff-1',
      approvedAt: null,
      approvedByUserId: null,
      comment: null,
      noteType: 'PROGRESS',
      recordedDate: new Date('2026-05-30T09:20:00'),
      authorUserId: 'demo-resident-1',
      patientName: '山田 花子',
      noteText:
        '【S】咳・鼻汁が続く。発熱2日目。\n【O】体温37.8℃、咽頭発赤(+)、呼吸音清。SpO2 98%。\n【A】急性上気道炎。細菌感染示唆所見なし。\n【P】対症療法。水分・安静指導。増悪時再診。',
    },
    {
      id: 'demo-cs-2',
      status: 'UNAPPROVED',
      superviseDoctorId: 'demo-staff-1',
      approvedAt: null,
      approvedByUserId: null,
      comment: null,
      noteType: 'PROGRESS',
      recordedDate: new Date('2026-05-30T10:05:00'),
      authorUserId: 'demo-resident-2',
      patientName: '佐藤 太郎',
      noteText:
        '【S】低血糖症状なし。食事・運動療法 継続中。\n【O】HbA1c 7.2%、随時血糖 156mg/dL、体重 68kg。\n【A】2型糖尿病。血糖コントロール やや不良。\n【P】メトホルミン増量を検討。栄養指導依頼。',
    },
    {
      id: 'demo-cs-3',
      status: 'APPROVED',
      superviseDoctorId: 'demo-staff-1',
      approvedAt: new Date('2026-05-29T15:40:00'),
      approvedByUserId: 'demo-staff-1',
      comment: '記載問題なし。',
      noteType: 'PROGRESS',
      recordedDate: new Date('2026-05-29T14:10:00'),
      authorUserId: 'demo-resident-1',
      patientName: '鈴木 一郎',
      noteText:
        '【S】胸痛・呼吸困難なし。\n【O】血圧 128/76mmHg、脈 72/分。浮腫なし。\n【A】本態性高血圧、コントロール良好。\n【P】同処方継続。家庭血圧記録。1ヶ月後再診。',
    },
  ];
}
function demoStickies(): StickyRow[] {
  return [
    {
      id: 'demo-sticky-1',
      title: '抗凝固薬あり',
      body: 'ワーファリン内服中。観血的処置前に必ず確認。',
      color: '#ffe0e0',
      scope: 'CLINIC_WIDE',
      patientId: 'demo-pat-1',
      patientName: '山田 花子',
      createdByUserId: 'demo-staff-1',
      createdAt: new Date('2026-05-20T11:00:00'),
    },
    {
      id: 'demo-sticky-2',
      title: '次回採血',
      body: 'HbA1c・腎機能フォロー。空腹時で。',
      color: '#fff7df',
      scope: 'PRIVATE',
      patientId: 'demo-pat-2',
      patientName: '佐藤 太郎',
      createdByUserId: 'demo-staff-1',
      createdAt: new Date('2026-05-28T09:30:00'),
    },
    {
      id: 'demo-sticky-3',
      title: '院内連絡：外来混雑',
      body: '本日午後は予防接種枠を15分前倒しで運用します。',
      color: '#e0f0ff',
      scope: 'CLINIC_WIDE',
      patientId: null,
      patientName: null,
      createdByUserId: 'demo-staff-1',
      createdAt: new Date('2026-05-31T08:00:00'),
    },
  ];
}
function demoPatients(): PatientOpt[] {
  return [
    { id: 'demo-pat-1', patientNo: '00001', name: '山田 花子' },
    { id: 'demo-pat-2', patientNo: '00002', name: '佐藤 太郎' },
    { id: 'demo-pat-3', patientNo: '00003', name: '鈴木 一郎' },
  ];
}

/**
 * フェイルソフトなデータ取得。DB 未接続・未マイグレーション・エンジン読込失敗でも
 * 画面が描画できるよう、例外時はデモのサンプルデータにフォールバックする。
 */
async function loadData(): Promise<{
  countersigns: CountersignRow[];
  stickies: StickyRow[];
  patients: PatientOpt[];
  live: boolean;
}> {
  try {
    const [notes, stickies, patients] = await Promise.all([
      prisma.clinicalNote.findMany({
        where: { authorJobType: 'RESIDENT', isLatest: true },
        orderBy: { recordedDate: 'desc' },
        take: 50,
        include: { countersign: true, patient: true },
      }),
      prisma.sticky.findMany({ orderBy: { createdAt: 'desc' }, take: 60 }),
      prisma.patient.findMany({ orderBy: { createdAt: 'asc' }, take: 40 }),
    ]);

    const patMap = new Map(patients.map((p) => [p.id, p]));
    const patName = (id: string | null | undefined) => {
      if (!id) return null;
      const p = patMap.get(id);
      return p ? `${p.kanjiLastName} ${p.kanjiFirstName}` : null;
    };

    // 研修医記載のうち Countersign を持つものを承認対象として並べる。
    const countersigns: CountersignRow[] = notes
      .filter((n) => n.countersign)
      .map((n) => {
        const c = n.countersign!;
        let noteText = '';
        try {
          noteText = blocksToPlainText((n.blocks as unknown as SoapBlock[]) ?? []);
        } catch {
          noteText = '';
        }
        return {
          id: c.id,
          status: c.status as CountersignRow['status'],
          superviseDoctorId: c.superviseDoctorId,
          approvedAt: c.approvedAt,
          approvedByUserId: c.approvedByUserId,
          comment: c.comment,
          noteType: n.noteType,
          recordedDate: n.recordedDate,
          authorUserId: n.authorUserId,
          patientName: patName(n.patientId) ?? '（患者不明）',
          noteText,
        };
      });

    const stickyRows: StickyRow[] = stickies.map((s) => ({
      id: s.id,
      title: s.title,
      body: s.body,
      color: s.color,
      scope: s.scope as StickyRow['scope'],
      patientId: s.patientId || null,
      patientName: patName(s.patientId),
      createdByUserId: s.createdByUserId,
      createdAt: s.createdAt,
    }));

    const patientOpts: PatientOpt[] = patients.map((p) => ({
      id: p.id,
      patientNo: p.patientNo,
      name: `${p.kanjiLastName} ${p.kanjiFirstName}`,
    }));

    // 完全に空（未シード）の場合はデモを見せて画面を成立させる。
    if (countersigns.length === 0 && stickyRows.length === 0 && patientOpts.length === 0) {
      return {
        countersigns: demoCountersigns(),
        stickies: demoStickies(),
        patients: demoPatients(),
        live: false,
      };
    }
    return {
      countersigns,
      stickies: stickyRows,
      patients: patientOpts.length ? patientOpts : demoPatients(),
      live: true,
    };
  } catch (err) {
    console.error('[countersign] loadData failed; showing demo data:', err);
    return {
      countersigns: demoCountersigns(),
      stickies: demoStickies(),
      patients: demoPatients(),
      live: false,
    };
  }
}

function fmt(d: Date | null): string {
  if (!d) return '—';
  try {
    return d.toLocaleString('ja-JP');
  } catch {
    return '—';
  }
}

export default async function CountersignPage() {
  // セッション取得はフェイルソフト（getSession は DB 到達不可時 null を返す設計）。
  await getSession();
  const { countersigns, stickies, patients, live } = await loadData();

  const pending = countersigns.filter((c) => c.status === 'UNAPPROVED');
  const resolved = countersigns.filter((c) => c.status !== 'UNAPPROVED');

  const patientStickies = stickies.filter((s) => s.patientId);
  const myPrivateStickies = stickies.filter((s) => s.scope === 'PRIVATE' && !s.patientId);
  const clinicStickies = stickies.filter((s) => s.scope === 'CLINIC_WIDE' && !s.patientId);

  return (
    <PageBody>
      <PageHeader
        title="付箋・カウンターサイン"
        desc="患者/個人/院内付箋と、研修医記載への指導医カウンターサイン（承認/却下・未承認バッジ）（別紙3 #60-61）"
        crumbs={['Medixus カルテ', '診療', '付箋・カウンターサイン']}
        actions={
          <span className="flex items-center gap-2">
            {pending.length > 0 && (
              <Badge tone="amber" title="未承認の研修医記載">
                未承認 {pending.length}
              </Badge>
            )}
            {!live && <Badge tone="gray">サンプル表示</Badge>}
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        {/* ── 指導医カウンターサイン ── */}
        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader
              title="研修医記載 — カウンターサイン待ち"
              icon={<Icon name="check" size={15} />}
              actions={<Badge tone={pending.length ? 'amber' : 'gray'}>{pending.length} 件</Badge>}
            />
            {pending.length === 0 ? (
              <EmptyState
                title="未承認の研修医記載はありません"
                hint="研修医（RESIDENT）の記載が登録されるとここに承認待ちとして表示されます"
                icon={<Icon name="check" size={28} />}
              />
            ) : (
              <ul className="flex flex-col gap-3">
                {pending.map((c) => (
                  <li
                    key={c.id}
                    className="rounded border border-amber-300 bg-amber-50/40 p-3"
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2 text-sm font-semibold text-ink">
                        {c.patientName}
                        <Badge tone="blue">{NOTE_TYPE_LABEL[c.noteType] ?? c.noteType}</Badge>
                        <Badge tone={CS_STATUS_TONE[c.status]}>{CS_STATUS_LABEL[c.status]}</Badge>
                      </span>
                      <span className="text-2xs text-muted">
                        研修医記載 {fmt(c.recordedDate)}
                      </span>
                    </div>
                    <pre className="mb-2 whitespace-pre-wrap rounded border border-line bg-white px-2.5 py-2 font-sans text-xs leading-relaxed text-ink">
                      {c.noteText || '（記載なし）'}
                    </pre>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <form
                        action={approveCountersign}
                        className="flex flex-1 items-end gap-2"
                      >
                        <input type="hidden" name="id" value={c.id} />
                        <label className="flex-1 text-2xs text-muted">
                          コメント（任意）
                          <input
                            name="comment"
                            placeholder="承認コメント"
                            className="mt-0.5 w-full rounded border border-line px-2 py-1 text-xs text-ink"
                          />
                        </label>
                        <Button size="sm" variant="primary" type="submit">
                          承認
                        </Button>
                      </form>
                      <form action={rejectCountersign} className="flex items-end gap-2">
                        <input type="hidden" name="id" value={c.id} />
                        <input
                          name="comment"
                          placeholder="却下理由"
                          className="w-40 rounded border border-line px-2 py-1 text-xs text-ink"
                        />
                        <Button size="sm" variant="danger" type="submit">
                          却下
                        </Button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel>
            <PanelHeader
              title="承認・却下 履歴"
              icon={<Icon name="check" size={15} />}
              actions={<Badge tone="gray">{resolved.length} 件</Badge>}
            />
            {resolved.length === 0 ? (
              <EmptyState title="承認・却下済みの記載はありません" />
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-soft text-2xs uppercase text-muted">
                    <th className="px-2 py-1.5 text-left">患者</th>
                    <th className="px-2 py-1.5 text-left">種別</th>
                    <th className="px-2 py-1.5 text-left">状態</th>
                    <th className="px-2 py-1.5 text-left">承認者</th>
                    <th className="px-2 py-1.5 text-left">承認日時</th>
                    <th className="px-2 py-1.5 text-left">コメント</th>
                  </tr>
                </thead>
                <tbody>
                  {resolved.map((c) => (
                    <tr key={c.id} className="border-t border-line align-top">
                      <td className="px-2 py-1.5">{c.patientName}</td>
                      <td className="px-2 py-1.5 text-xs">
                        {NOTE_TYPE_LABEL[c.noteType] ?? c.noteType}
                      </td>
                      <td className="px-2 py-1.5">
                        <Badge tone={CS_STATUS_TONE[c.status]}>{CS_STATUS_LABEL[c.status]}</Badge>
                      </td>
                      <td className="px-2 py-1.5 text-xs">{c.approvedByUserId ?? '—'}</td>
                      <td className="px-2 py-1.5 text-2xs text-muted">{fmt(c.approvedAt)}</td>
                      <td className="px-2 py-1.5 text-xs text-muted">{c.comment ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        {/* ── 付箋（患者/個人/院内） ── */}
        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader title="付箋を作成" icon={<Icon name="plus" size={15} />} />
            <form action={createSticky} className="flex flex-col gap-2.5">
              <Field label="種別">
                <Select name="scope" defaultValue="PRIVATE">
                  <option value="PRIVATE">個人付箋</option>
                  <option value="CLINIC_WIDE">院内付箋</option>
                </Select>
              </Field>
              <Field label="患者（任意・患者付箋にする場合）">
                <Select name="patientId" defaultValue="">
                  <option value="">（患者に紐付けない）</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.patientNo} {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="タイトル">
                <Input name="title" placeholder="例：抗凝固薬あり" />
              </Field>
              <Field label="本文">
                <textarea
                  name="body"
                  rows={3}
                  placeholder="付箋の内容"
                  className="rounded border border-line px-2.5 py-1.5 text-sm"
                />
              </Field>
              <Field label="色">
                <Select name="color" defaultValue="#fff7df">
                  <option value="#fff7df">イエロー</option>
                  <option value="#ffe0e0">レッド（注意）</option>
                  <option value="#e0f0ff">ブルー（連絡）</option>
                  <option value="#e6ffe6">グリーン</option>
                </Select>
              </Field>
              <Button type="submit" variant="primary">
                付箋を貼る
              </Button>
            </form>
          </Panel>

          <StickyColumn
            title="患者付箋"
            icon="patients"
            items={patientStickies}
            showPatient
          />
          <StickyColumn title="個人付箋" icon="sticky" items={myPrivateStickies} />
          <StickyColumn title="院内付箋" icon="board" items={clinicStickies} />
        </div>
      </div>
    </PageBody>
  );
}

function StickyColumn({
  title,
  icon,
  items,
  showPatient = false,
}: {
  title: string;
  icon: 'patients' | 'sticky' | 'board';
  items: StickyRow[];
  showPatient?: boolean;
}) {
  return (
    <Panel>
      <PanelHeader
        title={title}
        icon={<Icon name={icon} size={15} />}
        actions={<Badge tone="gray">{items.length} 件</Badge>}
      />
      {items.length === 0 ? (
        <EmptyState title="付箋はありません" />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((s) => (
            <li
              key={s.id}
              className="rounded border border-line p-2.5"
              style={{ background: s.color }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-ink">{s.title}</div>
                  {showPatient && s.patientName && (
                    <div className="text-2xs text-muted">{s.patientName}</div>
                  )}
                  {s.body && (
                    <p className="mt-0.5 whitespace-pre-wrap text-2xs leading-relaxed text-ink/80">
                      {s.body}
                    </p>
                  )}
                  <div className="mt-1 text-2xs text-muted">{fmt(s.createdAt)}</div>
                </div>
                <form action={deleteSticky}>
                  <input type="hidden" name="id" value={s.id} />
                  <Button size="sm" variant="ghost" type="submit" title="削除">
                    <Icon name="x" size={13} />
                  </Button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
