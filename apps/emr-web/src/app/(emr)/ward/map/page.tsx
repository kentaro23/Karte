import { prisma } from '@medixus/db';
import { age } from '@medixus/domain';
import { Panel, PanelHeader, Badge, Icon, EmptyState } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import { getSession } from '@/lib/session';

// 病床マップは在床状況の即時反映が要るため常に動的描画。DB 未接続でもデモが描画される。
export const dynamic = 'force-dynamic';

type Gender = 'MALE' | 'FEMALE' | 'OTHER' | 'UNKNOWN';
type GenderPolicy = 'MALE' | 'FEMALE' | 'MIXED';

type BedView = {
  bedId: string;
  bedCode: string;
  roomCode: string;
  genderPolicy: GenderPolicy;
  occupantName: string | null;
  occupantGender: Gender | null;
  occupantAgeLabel: string | null;
};
type WardView = { id: string; name: string; beds: BedView[] };
type MapData = { wards: WardView[]; occupied: number; total: number; live: boolean };

const POLICY_LABEL: Record<GenderPolicy, string> = { MALE: '男性', FEMALE: '女性', MIXED: '男女可' };

function normGender(g: string): Gender {
  return g === 'MALE' || g === 'FEMALE' || g === 'OTHER' ? g : 'UNKNOWN';
}
function normPolicy(p: string): GenderPolicy {
  return p === 'MALE' || p === 'FEMALE' ? p : 'MIXED';
}

/** 性別ポリシー衝突 — FR-WRD-01（性別ポリシー）。在床患者の性別が病室ポリシーに反するか。 */
function policyConflict(policy: GenderPolicy, gender: Gender | null): boolean {
  if (policy === 'MIXED' || gender === null) return false;
  return policy !== gender;
}

/* ── フロントのみモード用デモデータ ─────────────────────────────────────── */
function demoData(): MapData {
  const wards: WardView[] = [
    {
      id: 'demo-ward-1',
      name: '3階 一般病棟',
      beds: [
        { bedId: 'b1', bedCode: '01', roomCode: '301', genderPolicy: 'MIXED', occupantName: '佐藤 太郎', occupantGender: 'MALE', occupantAgeLabel: '68' },
        { bedId: 'b2', bedCode: '02', roomCode: '301', genderPolicy: 'MIXED', occupantName: null, occupantGender: null, occupantAgeLabel: null },
        { bedId: 'b3', bedCode: '01', roomCode: '302', genderPolicy: 'FEMALE', occupantName: '山田 花子', occupantGender: 'FEMALE', occupantAgeLabel: '41' },
        { bedId: 'b4', bedCode: '02', roomCode: '302', genderPolicy: 'FEMALE', occupantName: null, occupantGender: null, occupantAgeLabel: null },
      ],
    },
    {
      id: 'demo-ward-2',
      name: '4階 地域包括ケア病棟',
      beds: [
        { bedId: 'b5', bedCode: '01', roomCode: '401', genderPolicy: 'MALE', occupantName: null, occupantGender: null, occupantAgeLabel: null },
        { bedId: 'b6', bedCode: '02', roomCode: '401', genderPolicy: 'MALE', occupantName: null, occupantGender: null, occupantAgeLabel: null },
        { bedId: 'b7', bedCode: '01', roomCode: '402', genderPolicy: 'MIXED', occupantName: null, occupantGender: null, occupantAgeLabel: null },
      ],
    },
  ];
  const total = wards.reduce((n, w) => n + w.beds.length, 0);
  const occupied = wards.reduce((n, w) => n + w.beds.filter((b) => b.occupantName).length, 0);
  return { wards, occupied, total, live: false };
}

/**
 * フェイルソフトなデータ取得 — FR-WRD-01 AC(1)。
 * 在床は Encounter.currentBedId（本永続化された割当）を正として bedId 直接マッピングで配置する。
 * currentBedId 未設定の在院（本永続化前データ / デモ）は従来どおり病棟内の在床順カーソルで補完配置する
 * （入退院画面と同一ロジック）。在床/空床・性別ポリシーを描画用に整形し、DB 未接続でもデモへフォールバック。
 */
async function loadData(): Promise<MapData> {
  try {
    const [wardRows, encounters] = await Promise.all([
      prisma.ward.findMany({ include: { rooms: { include: { beds: true } } } }),
      prisma.encounter.findMany({
        where: { encounterType: 'INPATIENT', receptionStatus: { notIn: ['BILLING_DONE', 'CANCELLED'] } },
        include: { patient: true },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    if (wardRows.length === 0) return demoData();

    // 正の所在: currentBedId で bedId → 在院 を直接マッピング。
    const occByBedId = new Map<string, (typeof encounters)[number]>();
    for (const e of encounters) {
      if (e.currentBedId) occByBedId.set(e.currentBedId, e);
    }
    const placedEncIds = new Set([...occByBedId.values()].map((e) => e.id));

    let occupied = 0;
    let total = 0;
    const wards: WardView[] = wardRows.map((w) => {
      // currentBedId で配置済みの在院を除いた残りを、従来の在床順カーソルで補完する。
      const fallbackPatients = encounters.filter((e) => e.wardId === w.id && !placedEncIds.has(e.id));
      const allBeds = w.rooms.flatMap((r) => r.beds.map((b) => ({ room: r, bed: b })));
      total += allBeds.length;
      let cursor = 0;
      const beds: BedView[] = allBeds.map(({ room, bed }) => {
        // この病床に currentBedId 一致の在院がいれば最優先。なければカーソル補完。
        const direct = occByBedId.get(bed.id) ?? null;
        const occ = direct ?? (cursor < fallbackPatients.length ? fallbackPatients[cursor++] : null);
        if (occ) occupied += 1;
        return {
          bedId: bed.id,
          bedCode: bed.code.split('-').pop() ?? bed.code,
          roomCode: room.code,
          genderPolicy: normPolicy(room.genderPolicy),
          occupantName: occ ? `${occ.patient.kanjiLastName} ${occ.patient.kanjiFirstName}` : null,
          occupantGender: occ ? normGender(occ.patient.gender) : null,
          occupantAgeLabel: occ ? String(age(occ.patient.dateOfBirth)) : null,
        };
      });
      return { id: w.id, name: w.name, beds };
    });

    return { wards, occupied, total, live: true };
  } catch (err) {
    console.error('[ward] map loadData failed; showing demo data:', err);
    return demoData();
  }
}

export default async function WardMapPage() {
  await getSession(); // フェイルソフト（DB 到達不可時 null）。
  const { wards, occupied, total, live } = await loadData();

  return (
    <PageBody>
      <PageHeader
        title="病床マップ"
        desc="病棟・病室・病床の在床/空床・性別ポリシー（男女可/男性/女性）。性別ポリシー違反は警告表示（FR-WRD-01）"
        crumbs={['Medixus カルテ', '病棟', '病床マップ']}
        actions={
          <span className="flex items-center gap-2">
            <Badge tone="amber">在床 {occupied}</Badge>
            <Badge tone="gray">空床 {Math.max(0, total - occupied)}</Badge>
            {!live && <Badge tone="gray">サンプル表示</Badge>}
          </span>
        }
      />

      {wards.length === 0 ? (
        <Panel>
          <EmptyState title="病棟が登録されていません" hint="マスタで病棟・病室・病床を登録すると病床マップに表示されます" icon={<Icon name="bed" size={32} />} />
        </Panel>
      ) : (
        wards.map((w) => {
          const wardOccupied = w.beds.filter((b) => b.occupantName).length;
          const conflicts = w.beds.filter((b) => policyConflict(b.genderPolicy, b.occupantGender)).length;
          return (
            <Panel key={w.id} className="mb-4">
              <PanelHeader
                title={w.name}
                icon={<Icon name="bed" size={15} />}
                actions={
                  <span className="flex items-center gap-2 text-2xs text-muted">
                    {conflicts > 0 && (
                      <Badge tone="amber" title="性別ポリシーに反する在床があります">
                        <Icon name="warning" size={11} /> ポリシー違反 {conflicts}
                      </Badge>
                    )}
                    <span>
                      {w.beds.length} 床中 {wardOccupied} 在床
                    </span>
                  </span>
                }
              />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {w.beds.map((b) => {
                  const occ = !!b.occupantName;
                  const female = b.occupantGender === 'FEMALE';
                  const conflict = policyConflict(b.genderPolicy, b.occupantGender);
                  return (
                    <div
                      key={b.bedId}
                      className={`rounded-card border p-3 text-xs ${
                        conflict
                          ? 'border-amber-400 bg-amber-50'
                          : occ
                            ? female
                              ? 'border-pink-300 bg-pink-50'
                              : 'border-blue-200 bg-blue-50'
                            : 'border-dashed border-line bg-soft'
                      }`}
                    >
                      <div className="mb-1 flex items-center justify-between">
                        <span className="font-mono text-2xs text-muted">
                          {b.roomCode}-{b.bedCode}
                        </span>
                        {occ ? (
                          <Badge tone={conflict ? 'amber' : female ? 'red' : 'blue'}>在床</Badge>
                        ) : (
                          <Badge tone="gray">空床</Badge>
                        )}
                      </div>
                      {occ ? (
                        <div>
                          <div className="font-semibold text-ink">{b.occupantName}</div>
                          <div className="text-2xs text-muted">
                            {b.occupantGender === 'FEMALE' ? '女' : b.occupantGender === 'MALE' ? '男' : '—'} ・{' '}
                            {b.occupantAgeLabel}歳
                          </div>
                        </div>
                      ) : (
                        <div className="text-2xs text-muted">空き</div>
                      )}
                      <div className="mt-1 flex items-center justify-between border-t border-line/60 pt-1">
                        <span className="text-2xs text-muted">{POLICY_LABEL[b.genderPolicy]}</span>
                        {conflict && (
                          <span className="text-2xs font-semibold text-warn" title="在床患者が病室の性別ポリシーに反します">
                            ⚠ 違反
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Panel>
          );
        })
      )}

      <p className="text-2xs text-muted">
        ※ 在床は各在院の現在割当病床（Encounter.currentBed / BedAssignment）を正として表示します。
        割当未設定の在院は病棟内の在床順で補完表示します（入退院画面と整合）。
        転棟・転科・転室は入退院画面の「病床移動シミュレーション」で試算→確定できます。
      </p>
    </PageBody>
  );
}
