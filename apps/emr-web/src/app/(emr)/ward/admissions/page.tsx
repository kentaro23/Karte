import { prisma } from '@medixus/db';
import { age } from '@medixus/domain';
import { Panel, PanelHeader, Badge, Icon, Button, Field, Select, EmptyState } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import { getSession } from '@/lib/session';
import { admitPatient, dischargePatient } from '../actions';
import {
  AdmissionsClient,
  type Inpatient,
  type WardOpt,
  type DeptOpt,
  type BedSlot,
  type Gender,
  type GenderPolicy,
} from './admissions-client';

// 入退院・転棟は登録後の即時反映が要るため常に動的描画。DB 未接続でもデモが描画される。
export const dynamic = 'force-dynamic';

/* ── 直列化可能な型（フロントのみモードのフォールバックにも使う） ───────── */
type PatientOpt = { id: string; patientNo: string; name: string; dob: Date };
type ActiveRow = {
  encounterId: string;
  patientName: string;
  patientNo: string;
  gender: Gender;
  ageLabel: string;
  wardId: string | null;
  arrivedAt: Date | null;
  departmentId: string;
};

type WardData = {
  patients: PatientOpt[];
  wards: WardOpt[];
  departments: DeptOpt[];
  active: ActiveRow[];
  /** 退院済を含む直近の入院（一覧表示用）。 */
  history: { encounterId: string; patientName: string; patientNo: string; ageLabel: string; arrivedAt: Date | null; wardName: string; discharged: boolean }[];
  live: boolean;
};

const GENDER_LABEL: Record<Gender, string> = { MALE: '男', FEMALE: '女', OTHER: '他', UNKNOWN: '不明' };

function normGender(g: string): Gender {
  return g === 'MALE' || g === 'FEMALE' || g === 'OTHER' ? g : 'UNKNOWN';
}
function normPolicy(p: string): GenderPolicy {
  return p === 'MALE' || p === 'FEMALE' ? p : 'MIXED';
}
function fmtDate(d: Date | null): string {
  if (!d) return '—';
  try {
    return d.toLocaleDateString('ja-JP');
  } catch {
    return '—';
  }
}

/* ── フロントのみモード用デモデータ ─────────────────────────────────────── */
function demoData(): WardData {
  const wards: WardOpt[] = [
    {
      id: 'demo-ward-1',
      name: '3階 一般病棟',
      beds: [
        { bedId: 'b1', bedCode: '01', roomCode: '301', genderPolicy: 'MIXED', occupantGender: 'MALE', occupantName: '佐藤 太郎', occupantEncounterId: 'demo-enc-1' },
        { bedId: 'b2', bedCode: '02', roomCode: '301', genderPolicy: 'MIXED', occupantGender: null, occupantName: null, occupantEncounterId: null },
        { bedId: 'b3', bedCode: '01', roomCode: '302', genderPolicy: 'FEMALE', occupantGender: 'FEMALE', occupantName: '山田 花子', occupantEncounterId: 'demo-enc-2' },
        { bedId: 'b4', bedCode: '02', roomCode: '302', genderPolicy: 'FEMALE', occupantGender: null, occupantName: null, occupantEncounterId: null },
      ],
    },
    {
      id: 'demo-ward-2',
      name: '4階 地域包括ケア病棟',
      beds: [
        { bedId: 'b5', bedCode: '01', roomCode: '401', genderPolicy: 'MALE', occupantGender: null, occupantName: null, occupantEncounterId: null },
        { bedId: 'b6', bedCode: '02', roomCode: '401', genderPolicy: 'MALE', occupantGender: null, occupantName: null, occupantEncounterId: null },
        { bedId: 'b7', bedCode: '01', roomCode: '402', genderPolicy: 'MIXED', occupantGender: null, occupantName: null, occupantEncounterId: null },
      ],
    },
  ];
  const departments: DeptOpt[] = [
    { id: 'demo-dept-1', name: '内科' },
    { id: 'demo-dept-2', name: '外科' },
    { id: 'demo-dept-3', name: '整形外科' },
  ];
  const active: ActiveRow[] = [
    { encounterId: 'demo-enc-1', patientName: '佐藤 太郎', patientNo: '00002', gender: 'MALE', ageLabel: '68歳', wardId: 'demo-ward-1', arrivedAt: new Date('2026-05-28'), departmentId: 'demo-dept-1' },
    { encounterId: 'demo-enc-2', patientName: '山田 花子', patientNo: '00001', gender: 'FEMALE', ageLabel: '41歳', wardId: 'demo-ward-1', arrivedAt: new Date('2026-05-30'), departmentId: 'demo-dept-2' },
  ];
  return {
    patients: [
      { id: 'demo-pat-1', patientNo: '00001', name: '山田 花子', dob: new Date('1984-04-12') },
      { id: 'demo-pat-2', patientNo: '00002', name: '佐藤 太郎', dob: new Date('1957-09-03') },
      { id: 'demo-pat-3', patientNo: '00003', name: '鈴木 一郎', dob: new Date('1972-01-20') },
    ],
    wards,
    departments,
    active,
    history: [
      { encounterId: 'demo-enc-1', patientName: '佐藤 太郎', patientNo: '00002', ageLabel: '68歳', arrivedAt: new Date('2026-05-28'), wardName: '3階 一般病棟', discharged: false },
      { encounterId: 'demo-enc-2', patientName: '山田 花子', patientNo: '00001', ageLabel: '41歳', arrivedAt: new Date('2026-05-30'), wardName: '3階 一般病棟', discharged: false },
      { encounterId: 'demo-enc-0', patientName: '鈴木 一郎', patientNo: '00003', ageLabel: '54歳', arrivedAt: new Date('2026-05-10'), wardName: '3階 一般病棟', discharged: true },
    ],
    live: false,
  };
}

/**
 * フェイルソフトなデータ取得 — FR-WRD-01。
 * 在床は Encounter.currentBedId（本永続化された割当）を正として bedId 直接マッピングで配置し、
 * currentBedId 未設定の在院（本永続化前データ / デモ）は病棟内の在床順カーソルで補完する。
 * 病床マップ（map/page.tsx）と同じ配置ロジックを共有することで両画面の整合を保つ。
 * DB 未接続・未マイグレーション・エンジン読込失敗でも画面が成立するようデモへフォールバックする。
 */
async function loadData(): Promise<WardData> {
  try {
    const [encounters, patientRows, wardRows, deptRows] = await Promise.all([
      prisma.encounter.findMany({
        where: { encounterType: 'INPATIENT' },
        orderBy: { createdAt: 'asc' },
        include: { patient: true },
        take: 200,
      }),
      prisma.patient.findMany({ orderBy: { createdAt: 'asc' }, take: 80 }),
      prisma.ward.findMany({ include: { rooms: { include: { beds: true } } } }),
      prisma.department.findMany({ orderBy: { code: 'asc' } }),
    ]);

    // 未シードならデモを見せて画面を成立させる。
    if (patientRows.length === 0 && wardRows.length === 0) return demoData();

    const activeEnc = encounters.filter(
      (e) => e.receptionStatus !== 'BILLING_DONE' && e.receptionStatus !== 'CANCELLED',
    );

    // 正の所在: currentBedId で bedId → 在院 を直接マッピング。
    const directByBed = new Map<string, (typeof activeEnc)[number]>();
    for (const e of activeEnc) {
      if (e.currentBedId) directByBed.set(e.currentBedId, e);
    }
    const placedEncIds = new Set([...directByBed.values()].map((e) => e.id));

    // 病棟ごとに encounterId → bedLabel と bedId → 在床 を導出（currentBedId 優先、残りは在床順カーソル）。
    const bedLabelByEnc = new Map<string, { roomCode: string; bedCode: string }>();
    const occupantByBed = new Map<string, { encounterId: string; gender: Gender; name: string }>();
    for (const w of wardRows) {
      const fallbackPatients = activeEnc.filter((e) => e.wardId === w.id && !placedEncIds.has(e.id));
      const allBeds = w.rooms.flatMap((r) => r.beds.map((b) => ({ room: r, bed: b })));
      let cursor = 0;
      for (const { room, bed } of allBeds) {
        const direct = directByBed.get(bed.id) ?? null;
        const occ = direct ?? (cursor < fallbackPatients.length ? fallbackPatients[cursor++] : null);
        if (occ) {
          const label = { roomCode: room.code, bedCode: bed.code.split('-').pop() ?? bed.code };
          bedLabelByEnc.set(occ.id, label);
          occupantByBed.set(bed.id, {
            encounterId: occ.id,
            gender: normGender(occ.patient.gender),
            name: `${occ.patient.kanjiLastName} ${occ.patient.kanjiFirstName}`,
          });
        }
      }
    }

    const wards: WardOpt[] = wardRows.map((w) => ({
      id: w.id,
      name: w.name,
      beds: w.rooms.flatMap<BedSlot>((r) =>
        r.beds.map((b) => {
          const occ = occupantByBed.get(b.id) ?? null;
          return {
            bedId: b.id,
            bedCode: b.code.split('-').pop() ?? b.code,
            roomCode: r.code,
            genderPolicy: normPolicy(r.genderPolicy),
            occupantGender: occ?.gender ?? null,
            occupantName: occ?.name ?? null,
            occupantEncounterId: occ?.encounterId ?? null,
          };
        }),
      ),
    }));

    const wardNameById = new Map(wardRows.map((w) => [w.id, w.name]));
    const active: ActiveRow[] = activeEnc.map((e) => ({
      encounterId: e.id,
      patientName: `${e.patient.kanjiLastName} ${e.patient.kanjiFirstName}`,
      patientNo: e.patient.patientNo,
      gender: normGender(e.patient.gender),
      ageLabel: `${age(e.patient.dateOfBirth)}歳`,
      wardId: e.wardId,
      arrivedAt: e.arrivedAt,
      departmentId: e.departmentId,
    }));

    const history = encounters
      .slice()
      .reverse()
      .slice(0, 60)
      .map((e) => ({
        encounterId: e.id,
        patientName: `${e.patient.kanjiLastName} ${e.patient.kanjiFirstName}`,
        patientNo: e.patient.patientNo,
        ageLabel: `${age(e.patient.dateOfBirth)}歳`,
        arrivedAt: e.arrivedAt,
        wardName: (e.wardId && wardNameById.get(e.wardId)) || '—',
        discharged: e.receptionStatus === 'BILLING_DONE',
      }));

    return {
      patients: patientRows.map((p) => ({
        id: p.id,
        patientNo: p.patientNo,
        name: `${p.kanjiLastName} ${p.kanjiFirstName}`,
        dob: p.dateOfBirth,
      })),
      wards,
      departments: deptRows.map((d) => ({ id: d.id, name: d.name })),
      active,
      history,
      live: true,
    };
  } catch (err) {
    console.error('[ward] admissions loadData failed; showing demo data:', err);
    return demoData();
  }
}

export default async function AdmissionsPage() {
  await getSession(); // フェイルソフト（DB 到達不可時 null）。
  const { patients, wards, departments, active, history, live } = await loadData();

  // bedLabel を active 行へ畳み込む（client 島の現在地表示用）。
  const bedLabelByEnc = new Map<string, string>();
  for (const w of wards) {
    for (const b of w.beds) {
      if (b.occupantEncounterId) bedLabelByEnc.set(b.occupantEncounterId, `${b.roomCode}-${b.bedCode}`);
    }
  }
  const wardNameById = new Map(wards.map((w) => [w.id, w.name]));
  const deptNameById = new Map(departments.map((d) => [d.id, d.name]));

  const inpatients: Inpatient[] = active.map((a) => ({
    encounterId: a.encounterId,
    patientName: a.patientName,
    gender: a.gender,
    ageLabel: a.ageLabel,
    wardId: a.wardId,
    wardName: (a.wardId && wardNameById.get(a.wardId)) || '—',
    departmentId: a.departmentId,
    departmentName: deptNameById.get(a.departmentId) || '—',
    bedLabel: bedLabelByEnc.get(a.encounterId) ?? null,
  }));

  return (
    <PageBody>
      <PageHeader
        title="入退院管理"
        desc="入院受付（病棟・診療科・病床割当）・在院患者・転棟／転科・病床移動シミュレーション・退院確定（FR-WRD-01）"
        crumbs={['Medixus カルテ', '病棟', '入退院']}
        actions={
          <span className="flex items-center gap-2">
            <Badge tone="amber">在院 {active.length}</Badge>
            {!live && <Badge tone="gray">サンプル表示</Badge>}
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          {/* ── 在院患者（転棟/転科のトリガ） ── */}
          <Panel pad={false}>
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="text-sm font-bold">在院患者</span>
              <span className="text-2xs text-muted">病床割当は現在割当（BedAssignment）を正に表示・未割当は在床順で補完（病床マップと整合）</span>
            </div>
            {inpatients.length === 0 ? (
              <EmptyState title="在院患者はいません" hint="右の入院受付から病棟・病床を割当てると一覧と病床マップに反映されます" icon={<Icon name="ward" size={30} />} />
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-soft text-2xs uppercase text-muted">
                    <th className="px-3 py-2 text-left">患者</th>
                    <th className="px-3 py-2 text-left">病棟・病床</th>
                    <th className="px-3 py-2 text-left">診療科</th>
                    <th className="px-3 py-2 text-left">状態</th>
                    <th className="px-3 py-2 text-left">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {inpatients.map((p, i) => (
                    <tr key={p.encounterId} className={`border-t border-line ${i % 2 ? 'bg-soft/40' : ''}`}>
                      <td className="px-3 py-2">
                        <span className="font-semibold text-ink">{p.patientName}</span>
                        <span className="ml-1 text-2xs text-muted">
                          （{GENDER_LABEL[p.gender]}・{p.ageLabel}）
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {p.wardName}
                        {p.bedLabel ? <span className="ml-1 font-mono text-2xs text-muted">{p.bedLabel}</span> : null}
                      </td>
                      <td className="px-3 py-2 text-xs">{p.departmentName}</td>
                      <td className="px-3 py-2">
                        <Badge tone="green">在院</Badge>
                      </td>
                      <td className="px-3 py-2">
                        <form action={dischargePatient}>
                          <input type="hidden" name="id" value={p.encounterId} />
                          <Button size="sm" variant="secondary" type="submit">
                            退院確定
                          </Button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {/* 転棟/転科・病床移動シミュレーション（client 島） */}
            <div className="border-t border-line bg-soft/40 px-4 py-2.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-2xs font-bold uppercase tracking-wider text-muted">
                <Icon name="switch" size={13} /> 転棟 / 転科 / 病床移動シミュレーション
              </div>
              <AdmissionsClient inpatients={inpatients} wards={wards} departments={departments} live={live} />
            </div>
          </Panel>

          {/* ── 入院履歴（退院済を含む） ── */}
          <Panel pad={false}>
            <div className="border-b border-line px-4 py-2.5 text-sm font-bold">入院履歴（直近）</div>
            {history.length === 0 ? (
              <EmptyState title="入院履歴はありません" />
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-soft text-2xs uppercase text-muted">
                    <th className="px-3 py-2 text-left">患者</th>
                    <th className="px-3 py-2 text-left">入院日</th>
                    <th className="px-3 py-2 text-left">病棟</th>
                    <th className="px-3 py-2 text-left">状態</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h, i) => (
                    <tr key={h.encounterId} className={`border-t border-line ${i % 2 ? 'bg-soft/40' : ''}`}>
                      <td className="px-3 py-2">
                        <span className="font-mono text-2xs text-muted">{h.patientNo}</span> {h.patientName}（{h.ageLabel}）
                      </td>
                      <td className="px-3 py-2 text-xs">{fmtDate(h.arrivedAt)}</td>
                      <td className="px-3 py-2 text-xs">{h.wardName}</td>
                      <td className="px-3 py-2">
                        {h.discharged ? <Badge tone="gray">退院済</Badge> : <Badge tone="green">在院</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>
        </div>

        {/* ── 入院受付（病棟・診療科・病床割当） ── */}
        <Panel>
          <PanelHeader title="入院受付" icon={<Icon name="plus" size={15} />} />
          <form action={admitPatient} className="flex flex-col gap-3">
            <Field label="患者" required>
              <Select name="patientId" required defaultValue="">
                <option value="" disabled>
                  選択
                </option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.patientNo} {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="病棟" required>
              <Select name="wardId" required defaultValue={wards[0]?.id ?? ''}>
                {wards.length === 0 && <option value="">（病棟未登録）</option>}
                {wards.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="診療科" hint="未選択時はクリニックの先頭診療科を割当">
              <Select name="departmentId" defaultValue="">
                <option value="">自動（先頭診療科）</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="病床（任意）" hint="選択した病床に割当（BedAssignment へ記録）。未選択は空床順で補完表示">
              <Select name="bedCode" defaultValue="">
                <option value="">自動（空床順）</option>
                {wards.flatMap((w) =>
                  w.beds
                    .filter((b) => b.occupantEncounterId === null)
                    .map((b) => (
                      <option key={b.bedId} value={`${b.roomCode}-${b.bedCode}`}>
                        {w.name} {b.roomCode}-{b.bedCode}（{b.genderPolicy === 'MIXED' ? '男女可' : b.genderPolicy === 'MALE' ? '男性' : '女性'}）
                      </option>
                    )),
                )}
              </Select>
            </Field>
            <Button type="submit" variant="primary">
              <Icon name="plus" size={14} /> 入院受付
            </Button>
            {!live && (
              <p className="text-2xs text-muted/80">
                ※ バックエンド未接続のためデモ表示です（操作は可能）。受付すると INPATIENT Encounter
                が作成され、病棟・診療科・病床割当が病床マップに反映され、監査ログに記録されます。
              </p>
            )}
            <p className="text-2xs text-muted/70">
              ※ 入院診療計画書・クリティカルパス・持参薬は経過表/看護（FR-WRD-02）側で扱います。
            </p>
          </form>
        </Panel>
      </div>
    </PageBody>
  );
}
