import Link from 'next/link';
import { prisma } from '@medixus/db';
import { age } from '@medixus/domain';
import { Panel, PanelHeader, Badge, Icon, Button, Field, Input, Select, EmptyState } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import { getSession } from '@/lib/session';
import { addInsuranceForm, updateValidity, expireInsurance } from './actions';

// 保険・公費は患者コンテキストに依存し、登録後の即時反映が要るため常に動的描画。
export const dynamic = 'force-dynamic';

/* ── 型（フロントのみモードのフォールバックにも使う） ───────────────────── */
type PatientOpt = {
  id: string;
  patientNo: string;
  name: string;
  dateOfBirth: Date;
};
type InsuranceRow = {
  id: string;
  payerType: string;
  payerNo: string | null;
  symbol: string | null;
  number: string | null;
  branchNo: string | null;
  public1: { payer: string | null; recipient: string | null };
  public2: { payer: string | null; recipient: string | null };
  public3: { payer: string | null; recipient: string | null };
  workersComp: boolean;
  specialNote: string | null;
  symptomDetail: string | null;
  remarksComment: string | null;
  validFrom: Date | null;
  validTo: Date | null;
};

const PAYER_LABEL: Record<string, string> = {
  SOCIAL: '社保（健保）',
  NATIONAL: '国保',
  LATE_ELDERLY: '後期高齢',
  SELF_PAY: '自費',
  PUBLIC: '公費単独',
};
const PAYER_TONE: Record<string, 'blue' | 'teal' | 'amber' | 'gray' | 'green'> = {
  SOCIAL: 'blue',
  NATIONAL: 'teal',
  LATE_ELDERLY: 'amber',
  SELF_PAY: 'gray',
  PUBLIC: 'green',
};

/**
 * 有効期間判定 — FR-PAT-04 AC(2)。validFrom <= on <= validTo を満たすもののみ会計対象。
 * validFrom 未設定は「開始制限なし」、validTo 未設定は「無期限有効」とみなす。
 */
function isActiveOn(validFrom: Date | null, validTo: Date | null, on = new Date()): boolean {
  const d = on.getTime();
  if (validFrom && validFrom.getTime() > d) return false;
  if (validTo && validTo.getTime() < d) return false;
  return true;
}

function fmtDate(d: Date | null): string {
  if (!d) return '—';
  try {
    return d.toLocaleDateString('ja-JP');
  } catch {
    return '—';
  }
}
function ymd(d: Date | null): string {
  if (!d) return '';
  try {
    return d.toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

/* ── フロントのみモード用デモデータ ─────────────────────────────────────── */
function demoPatients(): PatientOpt[] {
  return [
    { id: 'demo-pat-1', patientNo: '00001', name: '山田 花子', dateOfBirth: new Date('1984-04-12') },
    { id: 'demo-pat-2', patientNo: '00002', name: '佐藤 太郎', dateOfBirth: new Date('1957-09-03') },
    { id: 'demo-pat-3', patientNo: '00003', name: '鈴木 一郎', dateOfBirth: new Date('1972-01-20') },
  ];
}
function demoInsurances(): InsuranceRow[] {
  return [
    {
      id: 'demo-ins-1',
      payerType: 'SOCIAL',
      payerNo: '06270017',
      symbol: '12',
      number: '3456',
      branchNo: '01',
      public1: { payer: '54137018', recipient: '0000001' }, // 公費（特定疾患 例）
      public2: { payer: null, recipient: null },
      public3: { payer: null, recipient: null },
      workersComp: false,
      specialNote: '長２',
      symptomDetail: '高血圧症にて長期療養中。家庭血圧 記録継続。',
      remarksComment: '主保険＋特定疾患公費併用。',
      validFrom: new Date('2024-04-01'),
      validTo: null,
    },
    {
      id: 'demo-ins-2',
      payerType: 'NATIONAL',
      payerNo: '67270010',
      symbol: '国保',
      number: '998877',
      branchNo: null,
      public1: { payer: null, recipient: null },
      public2: { payer: null, recipient: null },
      public3: { payer: null, recipient: null },
      workersComp: false,
      specialNote: null,
      symptomDetail: null,
      remarksComment: '前職退職に伴い切替前の旧保険（期限切れ）。',
      validFrom: new Date('2022-04-01'),
      validTo: new Date('2024-03-31'), // 期間外 → 会計から除外
    },
  ];
}

/**
 * フェイルソフトなデータ取得。DB 未接続・未マイグレーション・エンジン読込失敗でも
 * 画面が描画できるよう、例外時はデモのサンプルデータにフォールバックする。
 */
async function loadData(patientId: string | undefined): Promise<{
  patients: PatientOpt[];
  patient: PatientOpt | null;
  insurances: InsuranceRow[];
  live: boolean;
}> {
  try {
    const patients = await prisma.patient.findMany({
      orderBy: { createdAt: 'asc' },
      take: 40,
      select: { id: true, patientNo: true, kanjiLastName: true, kanjiFirstName: true, dateOfBirth: true },
    });
    const opts: PatientOpt[] = patients.map((p) => ({
      id: p.id,
      patientNo: p.patientNo,
      name: `${p.kanjiLastName} ${p.kanjiFirstName}`,
      dateOfBirth: p.dateOfBirth,
    }));

    if (opts.length === 0) {
      // 未シード — デモを見せて画面を成立させる。
      const demoPats = demoPatients();
      const sel = patientId ? demoPats.find((p) => p.id === patientId) ?? null : null;
      return { patients: demoPats, patient: sel, insurances: sel ? demoInsurances() : [], live: false };
    }

    let patient: PatientOpt | null = null;
    let insurances: InsuranceRow[] = [];
    if (patientId) {
      patient = opts.find((p) => p.id === patientId) ?? null;
      if (patient) {
        const rows = await prisma.insurance.findMany({
          where: { patientId: patient.id },
          orderBy: [{ validTo: 'desc' }],
        });
        insurances = rows.map((r) => ({
          id: r.id,
          payerType: r.payerType,
          payerNo: r.payerNo,
          symbol: r.symbol,
          number: r.number,
          branchNo: r.branchNo,
          public1: { payer: r.publicPayerNo1, recipient: r.publicRecipientNo1 },
          public2: { payer: r.publicPayerNo2, recipient: r.publicRecipientNo2 },
          public3: { payer: r.publicPayerNo3, recipient: r.publicRecipientNo3 },
          workersComp: r.workersComp,
          specialNote: r.specialNote,
          symptomDetail: r.symptomDetail,
          remarksComment: r.remarksComment,
          validFrom: r.validFrom,
          validTo: r.validTo,
        }));
      }
    }
    return { patients: opts, patient, insurances, live: true };
  } catch (err) {
    console.error('[insurance] loadData failed; showing demo data:', err);
    const demoPats = demoPatients();
    const sel = patientId ? demoPats.find((p) => p.id === patientId) ?? null : null;
    return { patients: demoPats, patient: sel, insurances: sel ? demoInsurances() : [], live: false };
  }
}

export default async function PatientInsurancePage({
  searchParams,
}: {
  searchParams: Promise<{ patientId?: string }>;
}) {
  await getSession(); // フェイルソフト（DB 到達不可時 null）。
  const sp = await searchParams;
  const { patients, patient, insurances, live } = await loadData(sp.patientId);

  const active = insurances.filter((i) => isActiveOn(i.validFrom, i.validTo));
  const inactive = insurances.filter((i) => !isActiveOn(i.validFrom, i.validTo));
  const publicCount = (i: InsuranceRow) =>
    [i.public1, i.public2, i.public3].filter((p) => p.payer || p.recipient).length;

  return (
    <PageBody>
      <PageHeader
        title="保険・公費"
        desc="医療保険（保険者番号/記号/番号/枝番/有効期間）複数・公費1-3・労災自賠・特記事項・症状詳記・摘要欄コメントを登録。会計・レセプト・FHIR文書の保険情報源（FR-PAT-04）"
        crumbs={['Medixus カルテ', '患者管理', '保険・公費']}
        actions={
          <span className="flex items-center gap-2">
            {patient && <Badge tone="green">会計対象 {active.length}</Badge>}
            {!live && <Badge tone="gray">サンプル表示</Badge>}
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr]">
        {/* ── 患者選択 ── */}
        <Panel>
          <PanelHeader title="患者選択" icon={<Icon name="patients" size={15} />} />
          {patients.length === 0 ? (
            <p className="px-1 py-3 text-2xs text-muted">患者がいません（バックエンド未接続）</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {patients.map((p) => (
                <li key={p.id}>
                  <Link
                    href={`/patients/insurance?patientId=${p.id}`}
                    className={`block rounded px-2 py-1.5 text-xs hover:bg-soft ${
                      patient?.id === p.id ? 'bg-accent-50 font-semibold text-accent-700' : ''
                    }`}
                  >
                    <span className="font-mono text-2xs text-muted">{p.patientNo}</span> {p.name}（
                    {age(p.dateOfBirth)}）
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {!patient ? (
          <Panel>
            <EmptyState
              title="患者を選択してください"
              hint="左の一覧から患者を選ぶと保険・公費の登録／有効期間管理ができます"
              icon={<Icon name="billing" size={32} />}
            />
          </Panel>
        ) : (
          <div className="flex flex-col gap-4">
            {/* ── 登録済み保険（会計対象／対象外） ── */}
            <Panel pad={false}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                <span className="flex items-center gap-2 text-sm font-bold">
                  <Icon name="billing" size={15} />
                  {patient.name}（ID {patient.patientNo}・{age(patient.dateOfBirth)}歳）の保険
                  <Badge tone="gray">{insurances.length}件</Badge>
                </span>
                <span className="text-2xs text-muted">
                  有効期間外（validTo 経過）の保険は会計選択肢から自動除外されます
                </span>
              </div>

              {insurances.length === 0 ? (
                <EmptyState
                  title="登録済みの保険はありません"
                  hint="下のフォームから医療保険・公費（最大3）・労災自賠を登録できます"
                />
              ) : (
                <ul className="flex flex-col divide-y divide-line">
                  {insurances.map((i) => {
                    const activeNow = isActiveOn(i.validFrom, i.validTo);
                    return (
                      <li key={i.id} className={`px-4 py-3 ${activeNow ? '' : 'bg-soft/40 text-muted'}`}>
                        <div className="mb-1.5 flex flex-wrap items-center gap-2">
                          <Badge tone={PAYER_TONE[i.payerType] ?? 'gray'}>
                            {PAYER_LABEL[i.payerType] ?? i.payerType}
                          </Badge>
                          {activeNow ? (
                            <Badge tone="green">会計対象</Badge>
                          ) : (
                            <Badge tone="red" title="有効期間外のため会計から除外">
                              期間外（会計除外）
                            </Badge>
                          )}
                          {publicCount(i) > 0 && <Badge tone="teal">公費 {publicCount(i)}</Badge>}
                          {i.workersComp && <Badge tone="amber">労災・自賠</Badge>}
                          {i.specialNote && <Badge tone="blue">特記 {i.specialNote}</Badge>}
                        </div>

                        <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 text-xs sm:grid-cols-2">
                          <div>
                            <span className="text-muted">保険者番号 </span>
                            <span className="font-mono">{i.payerNo ?? '—'}</span>
                          </div>
                          <div>
                            <span className="text-muted">記号・番号・枝番 </span>
                            <span className="font-mono">
                              {(i.symbol ?? '—')}・{i.number ?? '—'}
                              {i.branchNo ? `・枝${i.branchNo}` : ''}
                            </span>
                          </div>
                          {[i.public1, i.public2, i.public3].map((p, idx) =>
                            p.payer || p.recipient ? (
                              <div key={idx}>
                                <span className="text-muted">公費{idx + 1} </span>
                                <span className="font-mono">
                                  負{p.payer ?? '—'} / 受{p.recipient ?? '—'}
                                </span>
                              </div>
                            ) : null,
                          )}
                          <div>
                            <span className="text-muted">有効期間 </span>
                            <span className="font-mono">
                              {fmtDate(i.validFrom)} 〜 {fmtDate(i.validTo)}
                            </span>
                          </div>
                        </div>

                        {i.symptomDetail && (
                          <p className="mt-1 whitespace-pre-wrap text-2xs text-ink/80">
                            <span className="font-semibold text-muted">症状詳記：</span>
                            {i.symptomDetail}
                          </p>
                        )}
                        {i.remarksComment && (
                          <p className="mt-0.5 whitespace-pre-wrap text-2xs text-ink/80">
                            <span className="font-semibold text-muted">摘要：</span>
                            {i.remarksComment}
                          </p>
                        )}

                        {/* 有効期間の修正・即時失効（物理削除はしない＝会計除外のみ） */}
                        <div className="mt-2 flex flex-wrap items-end gap-2">
                          <form action={updateValidity} className="flex flex-wrap items-end gap-2">
                            <input type="hidden" name="id" value={i.id} />
                            <input type="hidden" name="patientId" value={patient.id} />
                            <label className="text-2xs text-muted">
                              開始
                              <Input
                                type="date"
                                name="validFrom"
                                defaultValue={ymd(i.validFrom)}
                                className="!ml-1 !w-36 !py-1 text-2xs"
                              />
                            </label>
                            <label className="text-2xs text-muted">
                              終了
                              <Input
                                type="date"
                                name="validTo"
                                defaultValue={ymd(i.validTo)}
                                className="!ml-1 !w-36 !py-1 text-2xs"
                              />
                            </label>
                            <Button size="sm" variant="ghost" type="submit">
                              <Icon name="check" size={13} /> 期間更新
                            </Button>
                          </form>
                          {activeNow && (
                            <form action={expireInsurance}>
                              <input type="hidden" name="id" value={i.id} />
                              <input type="hidden" name="patientId" value={patient.id} />
                              <Button size="sm" variant="danger" type="submit" title="本日付で失効（会計除外）">
                                <Icon name="x" size={13} /> 失効
                              </Button>
                            </form>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {inactive.length > 0 && (
                <p className="border-t border-line bg-soft px-4 py-1.5 text-2xs text-muted">
                  期間外 {inactive.length} 件は履歴として保持（物理削除なし）。会計・レセプトの保険選択肢には現れません。
                </p>
              )}
            </Panel>

            {/* ── 拡張保険 登録フォーム ── */}
            <Panel>
              <PanelHeader
                title="保険・公費を登録"
                desc="医療保険＋公費1-3＋労災自賠を1件として登録。複数保険は繰り返し登録できます（FR-PAT-04 AC(1)）"
                icon={<Icon name="plus" size={15} />}
              />
              <form action={addInsuranceForm} className="flex flex-col gap-3">
                <input type="hidden" name="patientId" value={patient.id} />

                {/* 医療保険 本体 */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="保険種別" required>
                    <Select name="payerType" defaultValue="SOCIAL">
                      <option value="SOCIAL">社保（健保）</option>
                      <option value="NATIONAL">国保</option>
                      <option value="LATE_ELDERLY">後期高齢</option>
                      <option value="PUBLIC">公費単独</option>
                      <option value="SELF_PAY">自費</option>
                    </Select>
                  </Field>
                  <Field label="保険者番号">
                    <Input name="payerNo" inputMode="numeric" placeholder="例：06270017" />
                  </Field>
                  <Field label="被保険者 枝番（2桁）" hint="マイナ保険証 個人単位被保険者番号">
                    <Input name="branchNo" inputMode="numeric" placeholder="例：01" />
                  </Field>
                  <Field label="記号">
                    <Input name="symbol" placeholder="例：12" />
                  </Field>
                  <Field label="番号">
                    <Input name="number" placeholder="例：3456" />
                  </Field>
                  <div className="flex items-end">
                    <label className="flex items-center gap-1.5 text-xs text-ink">
                      <input type="checkbox" name="workersComp" />
                      労災・自賠（公費とは別枠）
                    </label>
                  </div>
                </div>

                {/* 公費 1-3 */}
                <div className="rounded border border-line bg-soft/40 p-3">
                  <div className="mb-2 text-2xs font-bold uppercase tracking-wider text-muted">
                    公費（負担者番号 / 受給者番号 を最大3つ）
                  </div>
                  <div className="flex flex-col gap-2">
                    {[1, 2, 3].map((n) => (
                      <div key={n} className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_1fr_1fr]">
                        <span className="flex items-center text-xs font-semibold text-muted">公費{n}</span>
                        <Input name={`publicPayerNo${n}`} inputMode="numeric" placeholder={`負担者番号${n}`} />
                        <Input name={`publicRecipientNo${n}`} inputMode="numeric" placeholder={`受給者番号${n}`} />
                      </div>
                    ))}
                  </div>
                </div>

                {/* 有効期間 */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="有効期間 開始" hint="未設定は開始制限なし">
                    <Input type="date" name="validFrom" />
                  </Field>
                  <Field label="有効期間 終了" hint="未設定は無期限。過去日にすると会計から除外">
                    <Input type="date" name="validTo" />
                  </Field>
                </div>

                {/* 特記・症状詳記・摘要 */}
                <Field label="特記事項" hint="レセプト特記事項欄（例：長２・公・afなど）">
                  <Input name="specialNote" placeholder="例：長２" />
                </Field>
                <Field label="症状詳記" hint="レセプト症状詳記（高額・長期療養等の説明）">
                  <textarea
                    name="symptomDetail"
                    rows={2}
                    placeholder="症状・経過の詳記（レセプト添付）"
                    className="rounded border border-line px-2.5 py-1.5 text-sm"
                  />
                </Field>
                <Field label="摘要欄コメント" hint="レセプト摘要欄に記載するコメント">
                  <textarea
                    name="remarksComment"
                    rows={2}
                    placeholder="摘要欄コメント"
                    className="rounded border border-line px-2.5 py-1.5 text-sm"
                  />
                </Field>

                <div className="flex items-center gap-3">
                  <Button type="submit" variant="primary">
                    <Icon name="plus" size={14} /> 保険を登録
                  </Button>
                  <span className="text-2xs text-muted">
                    オンライン資格確認（IF-EXT-02）は連携アダプタ STUB です。本番接続で記号番号からリアルタイム取得されます。
                  </span>
                </div>
              </form>

              {!live && (
                <p className="mt-3 text-2xs leading-relaxed text-muted">
                  バックエンド未接続のため、登録はデモ表示になります（画面操作は可能）。登録すると拡張 Insurance
                  （枝番・公費1-3・特記・症状詳記・摘要）として保存され、会計・レセプト・FHIR文書の保険情報源になります。
                </p>
              )}
            </Panel>
          </div>
        )}
      </div>
    </PageBody>
  );
}
