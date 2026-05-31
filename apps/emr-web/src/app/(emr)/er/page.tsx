'use client';
/**
 * FR-ER-01 救急受付・トリアージ・救急時6情報閲覧（G30 / 174:10-12 / 優先度 Could）。
 *
 *  - 救急受付（registerEmergency）: Encounter(encounterType=EMERGENCY) を生成し、
 *    トリアージ(L1-L5)・搬送方法・主訴・同意区分を記録。身元不明（仮ID）受付も可。
 *  - トリアージ優先表示: 一覧を triageLevel 昇順（L1 最優先）でソートし、L1/L2 を
 *    強調色で表示。容態変化に応じて再トリアージ（retriagePatient）。
 *  - 救急時6情報参照（fetchSixInfo）: オン資/マイナ保険証経由（interop の
 *    insurance-verify fetchPatientInfo スタブ）で 傷病名/感染症/アレルギー/検査/処方 を
 *    最小クリックで参照。意識のない患者向けにマイナ読取トークンでの照会も用意。
 *  - 災害時モード: トリアージ最優先＋簡易受付に絞った表示へ切替（START法相当の運用）。
 *
 * クライアント主導＋サーバアクション取得。DB 未接続でも loadEr が fail-soft で
 * デモ行を返すため画面が描画される（フロントのみモード対応）。
 */
import * as React from 'react';
import {
  Panel,
  PanelHeader,
  Button,
  Badge,
  Icon,
  Select,
  Field,
  EmptyState,
} from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import {
  loadEr,
  registerEmergency,
  retriagePatient,
  fetchSixInfo,
  type ErListData,
  type ErEncounterRow,
  type TriageLevelKey,
  type SixInfoResult,
} from './actions';

// ── トリアージ表示メタ（JTAS/CTAS 5段階相当） ─────────────────────────────
const TRIAGE_KEYS: TriageLevelKey[] = [
  'L1_RESUSCITATION',
  'L2_EMERGENT',
  'L3_URGENT',
  'L4_LESS_URGENT',
  'L5_NON_URGENT',
];
const TRIAGE_LABEL: Record<TriageLevelKey, string> = {
  L1_RESUSCITATION: 'L1 蘇生',
  L2_EMERGENT: 'L2 緊急',
  L3_URGENT: 'L3 準緊急',
  L4_LESS_URGENT: 'L4 低緊急',
  L5_NON_URGENT: 'L5 非緊急',
};
const TRIAGE_TONE: Record<TriageLevelKey, 'red' | 'amber' | 'blue' | 'teal' | 'gray'> = {
  L1_RESUSCITATION: 'red',
  L2_EMERGENT: 'red',
  L3_URGENT: 'amber',
  L4_LESS_URGENT: 'teal',
  L5_NON_URGENT: 'gray',
};
// 目標対応時間（分）— 一覧の優先度説明に用いる運用目安。
const TRIAGE_TARGET_MIN: Record<TriageLevelKey, string> = {
  L1_RESUSCITATION: '即時',
  L2_EMERGENT: '15分以内',
  L3_URGENT: '30分以内',
  L4_LESS_URGENT: '60分以内',
  L5_NON_URGENT: '120分以内',
};
// ソート用の重み（L1 が最優先＝最小値）。未トリアージは末尾。
const TRIAGE_ORDER: Record<TriageLevelKey, number> = {
  L1_RESUSCITATION: 1,
  L2_EMERGENT: 2,
  L3_URGENT: 3,
  L4_LESS_URGENT: 4,
  L5_NON_URGENT: 5,
};

const ARRIVAL_METHODS = [
  '救急車',
  '救急車（ドクターカー）',
  'ドクターヘリ',
  '独歩（walk-in）',
  '車椅子',
  'ストレッチャー',
  '他院から転送',
  '警察搬送',
];

function elapsedMin(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 60000));
}

export default function ErPage() {
  const [data, setData] = React.useState<ErListData>({
    rows: [],
    patientOptions: [],
    deptOptions: [],
    live: false,
  });
  const [loading, setLoading] = React.useState(true);
  const [pending, start] = React.useTransition();

  // 災害時モード（START 法相当の簡易運用へ切替）。
  const [disaster, setDisaster] = React.useState(false);

  // 受付フォーム
  const [fPatient, setFPatient] = React.useState('');
  const [fTriage, setFTriage] = React.useState<TriageLevelKey>('L3_URGENT');
  const [fArrival, setFArrival] = React.useState<string>('救急車');
  const [fDept, setFDept] = React.useState('');
  const [fComplaint, setFComplaint] = React.useState('');
  const [fConsent, setFConsent] = React.useState('NORMAL');

  // 救急時6情報ビューア
  const [sixFor, setSixFor] = React.useState<ErEncounterRow | null>(null);
  const [six, setSix] = React.useState<SixInfoResult | null>(null);
  const [sixLoading, setSixLoading] = React.useState(false);

  const [toast, setToast] = React.useState<string | null>(null);
  const flash = React.useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2400);
  }, []);

  const reload = React.useCallback(() => {
    start(async () => {
      const d = await loadEr();
      setData(d);
      setLoading(false);
    });
  }, []);

  React.useEffect(() => {
    reload();
  }, [reload]);

  // 受付登録 → サーバアクションへ FormData を渡し、完了後に一覧を再読込。
  const submitRegister = (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    fd.set('patientId', fPatient);
    fd.set('triageLevel', fTriage);
    fd.set('arrivalMethod', fArrival);
    fd.set('departmentId', fDept);
    fd.set('chiefComplaint', fComplaint);
    fd.set('consentType', fConsent);
    start(async () => {
      await registerEmergency(fd);
      flash('救急受付を登録しました。トリアージ順に優先表示されます。');
      setFComplaint('');
      reload();
    });
  };

  // 再トリアージ（容態変化）。
  const retriage = (row: ErEncounterRow, level: TriageLevelKey) => {
    if (row.encounterId.startsWith('demo-')) {
      // 楽観反映のみ（DB 未接続デモ）。
      setData((prev) => ({
        ...prev,
        rows: prev.rows.map((r) =>
          r.encounterId === row.encounterId ? { ...r, triageLevel: level } : r,
        ),
      }));
      flash('デモ行を再トリアージしました（DB 未接続）。');
      return;
    }
    const fd = new FormData();
    fd.set('encounterId', row.encounterId);
    fd.set('triageLevel', level);
    start(async () => {
      await retriagePatient(fd);
      flash(`再トリアージ：${TRIAGE_LABEL[level]}`);
      reload();
    });
  };

  // 救急時6情報を参照（オン資/マイナ経由）。
  const viewSixInfo = (row: ErEncounterRow) => {
    setSixFor(row);
    setSix(null);
    setSixLoading(true);
    const fd = new FormData();
    if (row.patientId) fd.set('patientId', row.patientId);
    // 身元不明患者はマイナ保険証読取トークンで照会する想定（意識障害対応）。
    if (!row.patientId) fd.set('mynaCardToken', 'emergency-myna-read');
    start(async () => {
      try {
        const res = await fetchSixInfo(fd);
        setSix(res);
      } finally {
        setSixLoading(false);
      }
    });
  };

  // トリアージ順（L1 最優先）→ 同レベルは到着の早い順。
  const sortedRows = React.useMemo(() => {
    const rows = [...data.rows];
    rows.sort((a, b) => {
      const oa = a.triageLevel ? TRIAGE_ORDER[a.triageLevel] : 99;
      const ob = b.triageLevel ? TRIAGE_ORDER[b.triageLevel] : 99;
      if (oa !== ob) return oa - ob;
      const ta = a.arrivedAt ? Date.parse(a.arrivedAt) : Number.MAX_SAFE_INTEGER;
      const tb = b.arrivedAt ? Date.parse(b.arrivedAt) : Number.MAX_SAFE_INTEGER;
      return ta - tb;
    });
    return rows;
  }, [data.rows]);

  const waitingCount = sortedRows.length;
  const criticalCount = sortedRows.filter(
    (r) => r.triageLevel === 'L1_RESUSCITATION' || r.triageLevel === 'L2_EMERGENT',
  ).length;

  return (
    <PageBody>
      <PageHeader
        title="救急受付・トリアージ"
        desc="救急受付（Encounter EMERGENCY）・トリアージ(L1-L5)・搬送方法・救急時6情報参照（オン資/マイナ経由）。FR-ER-01 / 174項 10-12"
        crumbs={['Medixus カルテ', '救急', '救急受付・トリアージ']}
        actions={
          <span className="flex items-center gap-2">
            {criticalCount > 0 && (
              <Badge tone="red" title="L1 蘇生 / L2 緊急 の患者数">
                要緊急対応 {criticalCount}
              </Badge>
            )}
            <Badge tone={disaster ? 'red' : 'gray'}>
              {disaster ? '災害時モード ON' : '通常モード'}
            </Badge>
            <Button
              size="sm"
              variant={disaster ? 'primary' : 'ghost'}
              onClick={() => {
                setDisaster((v) => !v);
                flash(
                  disaster
                    ? '通常モードに戻しました。'
                    : '災害時モード：トリアージ最優先・簡易受付に切替えました。',
                );
              }}
            >
              <Icon name="warning" size={14} /> 災害時モード
            </Button>
            {!data.live && <Badge tone="gray">サンプル表示</Badge>}
          </span>
        }
      />

      {disaster && (
        <div className="mb-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800">
          <span className="font-semibold">災害時モード</span>
          ：多数傷病者発生時の運用。トリアージ（START 法相当）を最優先し、受付は氏名・トリアージ区分の最小入力で受け付けます。身元不明患者は仮 ID（患者未指定）のまま受付し、後で本 ID に統合してください。
        </div>
      )}

      {toast && (
        <div className="mb-3 rounded border border-line bg-ink/90 px-3 py-1.5 text-xs text-white">
          {toast}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        {/* ── 救急患者一覧（トリアージ優先表示） ───────────────────────────── */}
        <Panel>
          <PanelHeader
            title="救急患者一覧（トリアージ優先）"
            icon={<Icon name="warning" size={15} />}
            actions={
              <span className="flex items-center gap-2">
                <Badge tone="gray">{waitingCount} 名</Badge>
                <Button size="sm" variant="ghost" onClick={reload} disabled={pending}>
                  <Icon name="refresh" size={13} /> 更新
                </Button>
              </span>
            }
          />
          {loading ? (
            <div className="px-3 py-6 text-sm text-muted">読み込み中…</div>
          ) : sortedRows.length === 0 ? (
            <EmptyState
              title="救急受付中の患者はいません"
              hint="右の「救急受付」からトリアージ区分・搬送方法を指定して受付します"
              icon={<Icon name="warning" size={28} />}
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {sortedRows.map((r, idx) => {
                const tone = r.triageLevel ? TRIAGE_TONE[r.triageLevel] : 'gray';
                const critical =
                  r.triageLevel === 'L1_RESUSCITATION' ||
                  r.triageLevel === 'L2_EMERGENT';
                const mins = elapsedMin(r.arrivedAt);
                return (
                  <li
                    key={r.encounterId}
                    className={
                      'rounded border p-3 ' +
                      (critical
                        ? 'border-red-300 bg-red-50'
                        : 'border-line bg-white')
                    }
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex h-6 min-w-6 items-center justify-center rounded bg-ink/80 px-1.5 text-2xs font-bold text-white">
                          {idx + 1}
                        </span>
                        <Badge tone={tone}>
                          {r.triageLevel ? TRIAGE_LABEL[r.triageLevel] : '未トリアージ'}
                        </Badge>
                        <span className="text-sm font-semibold text-ink">{r.name}</span>
                        {r.patientNo && (
                          <span className="text-2xs text-muted">ID {r.patientNo}</span>
                        )}
                        {r.age != null && (
                          <span className="text-2xs text-muted">{r.age}歳</span>
                        )}
                        {!r.patientId && (
                          <Badge tone="amber" title="身元不明（仮ID）">
                            身元不明
                          </Badge>
                        )}
                      </span>
                      <span className="text-2xs text-muted">
                        {r.triageLevel && (
                          <>目標 {TRIAGE_TARGET_MIN[r.triageLevel]}　</>
                        )}
                        待ち {mins != null ? `${mins}分` : '—'}
                      </span>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted">
                      <span>搬送：{r.arrivalMethod ?? '—'}</span>
                      <span>受付No {r.receptionNo ?? '—'}</span>
                    </div>

                    {r.chiefComplaint && (
                      <div className="mt-1 text-2xs text-ink">
                        <span className="text-muted">主訴：</span>
                        {r.chiefComplaint}
                      </div>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
                      {/* 救急時6情報参照（最小クリック） */}
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => viewSixInfo(r)}
                        disabled={pending}
                      >
                        <Icon name="search" size={13} /> 救急時6情報
                      </Button>
                      {/* 再トリアージ */}
                      <span className="flex items-center gap-1">
                        <span className="text-2xs text-muted">再トリアージ</span>
                        <Select
                          value={r.triageLevel ?? ''}
                          onChange={(e) =>
                            retriage(r, e.target.value as TriageLevelKey)
                          }
                        >
                          <option value="" disabled>
                            区分
                          </option>
                          {TRIAGE_KEYS.map((k) => (
                            <option key={k} value={k}>
                              {TRIAGE_LABEL[k]}
                            </option>
                          ))}
                        </Select>
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        {/* ── 救急受付フォーム ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">
          <Panel>
            <PanelHeader title="救急受付" icon={<Icon name="plus" size={15} />} />
            <form onSubmit={submitRegister} className="flex flex-col gap-3">
              <Field
                label={disaster ? '患者（身元不明可・任意）' : '患者（身元不明時は未選択）'}
              >
                <Select
                  value={fPatient}
                  onChange={(e) => setFPatient(e.target.value)}
                >
                  <option value="">（未選択＝身元不明・仮ID）</option>
                  {data.patientOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="トリアージ区分" required>
                <Select
                  value={fTriage}
                  onChange={(e) => setFTriage(e.target.value as TriageLevelKey)}
                  required
                >
                  {TRIAGE_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {TRIAGE_LABEL[k]}（目標 {TRIAGE_TARGET_MIN[k]}）
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="搬送方法">
                <Select
                  value={fArrival}
                  onChange={(e) => setFArrival(e.target.value)}
                >
                  {ARRIVAL_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>

              {!disaster && (
                <>
                  <Field label="診療科">
                    <Select
                      value={fDept}
                      onChange={(e) => setFDept(e.target.value)}
                    >
                      <option value="">（救急科に自動割当）</option>
                      {data.deptOptions.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  <Field label="主訴・観察所見">
                    <textarea
                      value={fComplaint}
                      onChange={(e) => setFComplaint(e.target.value)}
                      rows={2}
                      className="rounded border border-line px-2.5 py-1.5 text-sm"
                      placeholder="例）胸痛・冷汗・意識レベル JCS 1"
                    />
                  </Field>

                  <Field label="同意区分（意識障害時）">
                    <Select
                      value={fConsent}
                      onChange={(e) => setFConsent(e.target.value)}
                    >
                      <option value="NORMAL">通常（本人同意）</option>
                      <option value="IMPLIED">黙示の同意（意識障害・緊急避難）</option>
                      <option value="FAMILY">家族・付添者の同意</option>
                    </Select>
                  </Field>
                </>
              )}

              <Button type="submit" variant="primary" disabled={pending}>
                救急受付を登録
              </Button>
              <p className="text-2xs text-muted">
                受付すると Encounter（救急・ARRIVED）が起票され、トリアージ順に優先表示されます。
              </p>
            </form>
          </Panel>

          {/* ── 救急時6情報ビューア（オン資/マイナ経由） ───────────────────── */}
          <Panel>
            <PanelHeader
              title="救急時6情報"
              icon={<Icon name="referral" size={15} />}
              actions={
                six ? (
                  <Badge tone={six.live ? 'green' : 'gray'}>
                    {six.live ? 'オン資取得' : `スタブ(${six.status})`}
                  </Badge>
                ) : undefined
              }
            />
            {!sixFor ? (
              <EmptyState
                title="救急時6情報は未参照です"
                hint="一覧の「救急時6情報」を押すと、オン資/マイナ保険証経由で 傷病名・感染症・アレルギー・検査・処方 を参照します"
                icon={<Icon name="search" size={26} />}
              />
            ) : (
              <div className="flex flex-col gap-2">
                <div className="rounded border border-line bg-soft px-2.5 py-1.5 text-2xs text-muted">
                  対象：<span className="font-semibold text-ink">{sixFor.name}</span>
                  {sixFor.patientNo ? `（ID ${sixFor.patientNo}）` : '（身元不明・マイナ照会）'}
                </div>

                {sixLoading ? (
                  <div className="px-1 py-3 text-sm text-muted">オン資へ照会中…</div>
                ) : six ? (
                  <SixInfoView six={six} />
                ) : (
                  <div className="px-1 py-3 text-sm text-muted">参照に失敗しました。</div>
                )}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </PageBody>
  );
}

/** 救急時6情報の内訳表示（薬剤情報・特定健診・アレルギー）。 */
function SixInfoView({ six }: { six: SixInfoResult }) {
  const { data } = six;
  return (
    <div className="flex flex-col gap-3">
      {!six.live && (
        <div className="rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-2xs text-amber-800">
          オン資未接続のためサンプルの6情報を表示しています（interop insurance-verify
          スタブ）。本番接続で実データに切替わります。
        </div>
      )}

      <InfoGroup
        title="アレルギー（薬剤・その他）"
        icon="warning"
        tone="red"
        empty="登録なし"
        items={data.allergies.map((a, i) => ({
          key: `al-${i}`,
          main: a.substance,
          sub: `${a.category === 'DRUG' ? '薬剤' : 'その他'}${a.reaction ? ` / ${a.reaction}` : ''}`,
        }))}
      />

      <InfoGroup
        title="処方（直近・他院含む）"
        icon="rx"
        tone="blue"
        empty="処方情報なし"
        items={data.medications.map((m, i) => ({
          key: `md-${i}`,
          main: m.name,
          sub: [m.facilityName, m.dispensedDate].filter(Boolean).join(' / ') || undefined,
        }))}
      />

      <InfoGroup
        title="検査（特定健診等）"
        icon="lab"
        tone="teal"
        empty="検査情報なし"
        items={data.checkups.map((c, i) => ({
          key: `ck-${i}`,
          main: `${c.itemName}${c.value ? `：${c.value}${c.unit ?? ''}` : ''}`,
          sub: c.examDate ?? undefined,
        }))}
      />

      <p className="text-2xs text-muted">
        ※ 傷病名・感染症は本接続時にオン資 6情報（Condition / Observation）として併せて参照できます。
      </p>
    </div>
  );
}

function InfoGroup({
  title,
  icon,
  tone,
  items,
  empty,
}: {
  title: string;
  icon: React.ComponentProps<typeof Icon>['name'];
  tone: 'red' | 'blue' | 'teal';
  items: { key: string; main: string; sub?: string }[];
  empty: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <Icon name={icon} size={13} />
        <span className="text-2xs font-semibold text-ink">{title}</span>
        <Badge tone={tone}>{items.length}</Badge>
      </div>
      {items.length === 0 ? (
        <div className="px-1 text-2xs text-muted">{empty}</div>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((it) => (
            <li
              key={it.key}
              className="rounded border border-line px-2 py-1 text-2xs"
            >
              <div className="font-medium text-ink">{it.main}</div>
              {it.sub && <div className="text-muted">{it.sub}</div>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
