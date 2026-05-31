import { prisma } from '@medixus/db';
import { age } from '@medixus/domain';
import { Panel, PanelHeader, Badge, Icon, Button, Field, Input, Select, EmptyState } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import { getSession } from '@/lib/session';
import { mergePatientsForm, unmergePatient, setVip, promoteTemporaryId } from './actions';

// 統合・VIP・仮ID昇格は登録後の即時反映が要るため常に動的描画。
export const dynamic = 'force-dynamic';

/* ── 型（フロントのみモードのフォールバックにも使う） ───────────────────── */
type PatientRow = {
  id: string;
  patientNo: string;
  name: string;
  kana: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER' | 'UNKNOWN';
  dateOfBirth: Date;
  isVip: boolean;
  isTemporaryId: boolean;
  mergedIntoId: string | null;
  /** この患者（＝統合元）が抱える診療録件数（統合先から参照される対象）。 */
  noteCount: number;
  encounterCount: number;
};

const GENDER_LABEL: Record<string, string> = { MALE: '男', FEMALE: '女', OTHER: 'その他', UNKNOWN: '不明' };

function fmtDob(d: Date): string {
  try {
    return d.toLocaleDateString('ja-JP');
  } catch {
    return '—';
  }
}

/* ── フロントのみモード用デモデータ ─────────────────────────────────────── */
function demoPatients(): PatientRow[] {
  return [
    {
      id: 'demo-pat-1',
      patientNo: '00001',
      name: '山田 花子',
      kana: 'ヤマダ ハナコ',
      gender: 'FEMALE',
      dateOfBirth: new Date('1984-04-12'),
      isVip: false,
      isTemporaryId: false,
      mergedIntoId: null,
      noteCount: 8,
      encounterCount: 5,
    },
    {
      id: 'demo-pat-1b',
      patientNo: '00009',
      name: '山田 はな子',
      kana: 'ヤマダ ハナコ',
      gender: 'FEMALE',
      dateOfBirth: new Date('1984-04-12'),
      isVip: false,
      isTemporaryId: false,
      mergedIntoId: 'demo-pat-1', // 重複 → 00001 に統合済み（旧ID）
      noteCount: 2,
      encounterCount: 1,
    },
    {
      id: 'demo-pat-2',
      patientNo: '00002',
      name: '佐藤 太郎',
      kana: 'サトウ タロウ',
      gender: 'MALE',
      dateOfBirth: new Date('1957-09-03'),
      isVip: true,
      isTemporaryId: false,
      mergedIntoId: null,
      noteCount: 12,
      encounterCount: 9,
    },
    {
      id: 'demo-pat-tmp',
      patientNo: 'T-0007',
      name: '（仮）救急 男性',
      kana: 'カリ',
      gender: 'UNKNOWN',
      dateOfBirth: new Date('1970-01-01'),
      isVip: false,
      isTemporaryId: true,
      mergedIntoId: null,
      noteCount: 1,
      encounterCount: 1,
    },
  ];
}

/**
 * フェイルソフトなデータ取得。DB 未接続・未マイグレーション・エンジン読込失敗でも
 * 画面が描画できるよう、例外時はデモのサンプルデータにフォールバックする。
 */
async function loadData(): Promise<{ patients: PatientRow[]; live: boolean }> {
  try {
    const patients = await prisma.patient.findMany({
      orderBy: { createdAt: 'asc' },
      take: 80,
      select: {
        id: true,
        patientNo: true,
        kanjiLastName: true,
        kanjiFirstName: true,
        kanaLastName: true,
        kanaFirstName: true,
        gender: true,
        dateOfBirth: true,
        isVip: true,
        isTemporaryId: true,
        mergedIntoId: true,
        _count: { select: { notes: true, encounters: true } },
      },
    });
    if (patients.length === 0) return { patients: demoPatients(), live: false };
    const rows: PatientRow[] = patients.map((p) => ({
      id: p.id,
      patientNo: p.patientNo,
      name: `${p.kanjiLastName} ${p.kanjiFirstName}`,
      kana: `${p.kanaLastName} ${p.kanaFirstName}`,
      gender: p.gender,
      dateOfBirth: p.dateOfBirth,
      isVip: p.isVip,
      isTemporaryId: p.isTemporaryId,
      mergedIntoId: p.mergedIntoId,
      noteCount: p._count.notes,
      encounterCount: p._count.encounters,
    }));
    return { patients: rows, live: true };
  } catch (err) {
    console.error('[merge] loadData failed; showing demo data:', err);
    return { patients: demoPatients(), live: false };
  }
}

export default async function PatientMergePage() {
  await getSession(); // フェイルソフト（DB 到達不可時 null）。
  const { patients, live } = await loadData();

  const byId = new Map<string, PatientRow>(patients.map((p) => [p.id, p] as const));
  const survivors = patients.filter((p) => !p.mergedIntoId); // 生存ID（統合先候補）
  const merged = patients.filter((p) => p.mergedIntoId); // 統合済み（旧ID）
  const temporaries = patients.filter((p) => p.isTemporaryId && !p.mergedIntoId);

  /** 旧ID → 生存IDへの解決（チェーンを辿る）。統合先から旧診療録を参照する根拠。 */
  function resolve(id: string): PatientRow | null {
    const seen = new Set<string>();
    let cur: string | null = id;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const p = byId.get(cur);
      if (!p) return null;
      if (!p.mergedIntoId) return p;
      cur = p.mergedIntoId;
    }
    return byId.get(id) ?? null;
  }

  // 統合先ごとに「自身＋統合された旧ID」の診療録が合算で参照できることを可視化。
  const mergedByTarget = new Map<string, PatientRow[]>();
  for (const m of merged) {
    const tgt = resolve(m.id);
    if (!tgt) continue;
    const list = mergedByTarget.get(tgt.id) ?? [];
    list.push(m);
    mergedByTarget.set(tgt.id, list);
  }

  return (
    <PageBody>
      <PageHeader
        title="患者ID統合・VIP・仮ID"
        desc="重複患者の論理統合（物理削除なし・参照は統合先に解決）／VIP設定／仮ID→本ID昇格。統合は AuditEvent(PATIENT_MERGE) を残す（FR-PAT-05）"
        crumbs={['Medixus カルテ', '患者管理', 'ID統合・VIP・仮ID']}
        actions={
          <span className="flex items-center gap-2">
            <Badge tone="gray">統合済 {merged.length}</Badge>
            {!live && <Badge tone="gray">サンプル表示</Badge>}
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ── 患者ID統合 ── */}
        <Panel>
          <PanelHeader
            title="患者ID統合（論理）"
            desc="重複患者の旧IDに mergedIntoId を設定し、物理削除せず統合先へ参照解決します（FR-PAT-05 AC(1)(2)）"
            icon={<Icon name="switch" size={15} />}
          />
          <form action={mergePatientsForm} className="flex flex-col gap-3">
            <Field label="統合元（旧ID・残すが参照は統合先へ）" required>
              <Select name="sourceId" defaultValue="">
                <option value="">選択してください</option>
                {survivors.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.patientNo} {p.name}（{age(p.dateOfBirth)}・診療録{p.noteCount}）
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="統合先（生存ID・以後の正本）" required>
              <Select name="targetId" defaultValue="">
                <option value="">選択してください</option>
                {survivors.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.patientNo} {p.name}（{age(p.dateOfBirth)}）
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex items-center gap-3">
              <Button type="submit" variant="primary">
                <Icon name="switch" size={14} /> 統合する（論理）
              </Button>
              <span className="text-2xs text-muted">
                物理削除は行いません。旧IDの診療録・オーダ・会計は統合先から参照可能になります。
              </span>
            </div>
          </form>

          {/* 統合済み一覧（統合先から旧ID診療録が参照できることを可視化） */}
          <div className="mt-4 border-t border-line pt-3">
            <div className="mb-1.5 text-2xs font-bold uppercase tracking-wider text-muted">
              統合済み（旧ID → 統合先）
            </div>
            {merged.length === 0 ? (
              <p className="py-2 text-2xs text-muted">統合済みの患者はありません。</p>
            ) : (
              <ul className="flex flex-col gap-1.5">
                {merged.map((m) => {
                  const tgt = resolve(m.id);
                  return (
                    <li
                      key={m.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded border border-line bg-soft/40 px-2.5 py-1.5 text-xs"
                    >
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-2xs text-muted line-through">{m.patientNo}</span>
                        <span className="text-muted">{m.name}</span>
                        <Icon name="chevron" size={12} />
                        <span className="font-mono text-2xs text-accent-700">{tgt?.patientNo ?? '—'}</span>
                        <span className="font-semibold text-ink">{tgt?.name ?? '—'}</span>
                        <Badge tone="blue" title="旧IDの診療録は統合先から参照可能">
                          診療録 {m.noteCount}・受診 {m.encounterCount} を継承
                        </Badge>
                      </span>
                      <form action={unmergePatient}>
                        <input type="hidden" name="sourceId" value={m.id} />
                        <Button size="sm" variant="ghost" type="submit" title="誤統合の是正（統合解除）">
                          解除
                        </Button>
                      </form>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Panel>

        {/* ── 統合先から見た診療録（AC(1) の根拠表示） ── */}
        <Panel>
          <PanelHeader
            title="統合先から参照できる診療録"
            desc="統合先患者は、自身＋統合された旧IDの診療録を合算で参照できます（物理削除なし）"
            icon={<Icon name="chart" size={15} />}
          />
          {mergedByTarget.size === 0 ? (
            <EmptyState
              title="統合された患者はまだありません"
              hint="左で患者を統合すると、ここに統合先から見える旧ID診療録の継承が表示されます"
              icon={<Icon name="chart" size={28} />}
            />
          ) : (
            <ul className="flex flex-col gap-2.5">
              {[...mergedByTarget.entries()].map(([targetId, sources]) => {
                const tgt = byId.get(targetId);
                const inheritedNotes = sources.reduce((a, b) => a + b.noteCount, 0);
                const inheritedEnc = sources.reduce((a, b) => a + b.encounterCount, 0);
                const ownNotes = tgt?.noteCount ?? 0;
                const ownEnc = tgt?.encounterCount ?? 0;
                return (
                  <li key={targetId} className="rounded border border-line p-2.5">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="font-mono text-2xs text-accent-700">{tgt?.patientNo ?? '—'}</span>
                      <span className="text-sm font-semibold text-ink">{tgt?.name ?? '（統合先不明）'}</span>
                      {tgt?.isVip && <Badge tone="amber">VIP</Badge>}
                      <Badge tone="green">
                        診療録 計 {ownNotes + inheritedNotes}（自 {ownNotes}＋継承 {inheritedNotes}）
                      </Badge>
                      <Badge tone="blue">受診 計 {ownEnc + inheritedEnc}</Badge>
                    </div>
                    <ul className="flex flex-col gap-0.5 pl-1 text-2xs text-muted">
                      {sources.map((src) => (
                        <li key={src.id} className="flex items-center gap-1.5">
                          <Icon name="chevron" size={11} />
                          旧ID <span className="font-mono line-through">{src.patientNo}</span> {src.name} の
                          診療録 {src.noteCount}・受診 {src.encounterCount} 件を参照
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {/* ── VIP設定 ── */}
        <Panel>
          <PanelHeader
            title="VIP 設定"
            desc="VIP 区分を設定。患者選択時のパスワードゲートは患者選択（FR-PAT-01）で発火します"
            icon={<Icon name="lock" size={15} />}
          />
          {survivors.length === 0 ? (
            <EmptyState title="対象患者がいません" />
          ) : (
            <ul className="flex flex-col gap-1">
              {survivors.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded border border-line px-2.5 py-1.5 text-xs"
                >
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-2xs text-muted">{p.patientNo}</span>
                    <span className="font-medium text-ink">{p.name}</span>
                    <span className="text-2xs text-muted">
                      {GENDER_LABEL[p.gender]}・{age(p.dateOfBirth)}
                    </span>
                    {p.isVip && <Badge tone="amber">VIP</Badge>}
                  </span>
                  <form action={setVip}>
                    <input type="hidden" name="patientId" value={p.id} />
                    {/* チェックボックス名は isVip。チェック時 on＝VIP化、未チェック＝解除。 */}
                    <input type="hidden" name="isVip" value={p.isVip ? '' : 'on'} />
                    <Button
                      size="sm"
                      variant={p.isVip ? 'danger' : 'secondary'}
                      type="submit"
                      title={p.isVip ? 'VIP 解除' : 'VIP に設定'}
                    >
                      <Icon name="lock" size={12} /> {p.isVip ? 'VIP 解除' : 'VIP 設定'}
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* ── 仮ID昇格 ── */}
        <Panel>
          <PanelHeader
            title="仮ID → 本ID 昇格"
            desc="救急等で発番した仮ID（isTemporaryId）を、氏名・生年月日・性別を確定して本IDへ昇格します"
            icon={<Icon name="users" size={15} />}
          />
          {temporaries.length === 0 ? (
            <EmptyState title="仮IDの患者はいません" hint="救急受付などで発番された仮ID患者がここに表示されます" />
          ) : (
            <ul className="flex flex-col gap-3">
              {temporaries.map((p) => (
                <li key={p.id} className="rounded border border-amber-300 bg-amber-50/40 p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs">
                    <Badge tone="amber">仮ID</Badge>
                    <span className="font-mono text-2xs text-muted">{p.patientNo}</span>
                    <span className="font-medium text-ink">{p.name}</span>
                  </div>
                  <form action={promoteTemporaryId} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <input type="hidden" name="patientId" value={p.id} />
                    <Field label="姓（漢字）">
                      <Input name="kanjiLastName" placeholder="確定する姓" />
                    </Field>
                    <Field label="名（漢字）">
                      <Input name="kanjiFirstName" placeholder="確定する名" />
                    </Field>
                    <Field label="姓（カナ）">
                      <Input name="kanaLastName" placeholder="セイ" />
                    </Field>
                    <Field label="名（カナ）">
                      <Input name="kanaFirstName" placeholder="メイ" />
                    </Field>
                    <Field label="生年月日">
                      <Input type="date" name="dateOfBirth" defaultValue={p.dateOfBirth.toISOString().slice(0, 10)} />
                    </Field>
                    <Field label="性別">
                      <Select name="gender" defaultValue={p.gender}>
                        <option value="MALE">男</option>
                        <option value="FEMALE">女</option>
                        <option value="OTHER">その他</option>
                        <option value="UNKNOWN">不明</option>
                      </Select>
                    </Field>
                    <div className="sm:col-span-2">
                      <Button type="submit" variant="primary">
                        <Icon name="check" size={14} /> 本IDへ昇格
                      </Button>
                    </div>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {!live && (
        <Panel className="mt-4">
          <p className="text-2xs leading-relaxed text-muted">
            バックエンド未接続のため、統合・VIP・昇格はデモ表示になります（画面操作は可能）。統合は物理削除を行わず
            Patient.mergedIntoId を設定し、旧IDの診療録・受診は統合先から参照できます。各操作は
            AuditEvent（PATIENT_MERGE 等）に記録されます。
          </p>
        </Panel>
      )}
    </PageBody>
  );
}
