import Link from 'next/link';
import { prisma } from '@medixus/db';
import { age } from '@medixus/domain';
import {
  Panel,
  Badge,
  Icon,
  Button,
  Field,
  Input,
  Select,
  EmptyState,
} from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import { registerReception } from './actions';

// 受付登録は患者検索（cookie/headers セッション）に依存するため動的レンダリング。
export const dynamic = 'force-dynamic';

type Ins = {
  id: string;
  payerType: string;
  payerNo: string | null;
  symbol: string | null;
  number: string | null;
};
type Row = {
  id: string;
  patientNo: string;
  name: string;
  kana: string;
  genderLabel: string;
  age: number;
  isVip: boolean;
  isTemporaryId: boolean;
  sameName: boolean;
  insurances: Ins[];
};

const PAYER_LABEL: Record<string, string> = {
  SOCIAL: '社保',
  NATIONAL: '国保',
  LATE_ELDERLY: '後期高齢',
  SELF_PAY: '自費',
  PUBLIC: '公費',
};

/** FR-RCP-04 受付登録：患者検索 → 受付（Encounter receptionStatus=ARRIVED）→ 受付票(A6)印刷。 */
export default async function ReceptionRegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();

  // DB 未接続（フロントのみ）でも画面が出るよう、取得は fail-soft。
  let departments: { id: string; name: string }[] = [];
  let rows: Row[] = [];
  try {
    departments = await prisma.department.findMany({ select: { id: true, name: true } });
  } catch (err) {
    console.error('[ReceptionRegisterPage] departments fetch failed:', err);
  }

  try {
    const found = await prisma.patient.findMany({
      where: q
        ? {
            OR: [
              { kanaLastName: { contains: q, mode: 'insensitive' } },
              { kanaFirstName: { contains: q, mode: 'insensitive' } },
              { kanjiLastName: { contains: q } },
              { kanjiFirstName: { contains: q } },
              { patientNo: { contains: q } },
            ],
          }
        : {},
      include: { insurances: true },
      orderBy: { createdAt: 'desc' },
      take: q ? 60 : 20,
    });

    // 同姓同名（カナ）検出。
    const nameCount = new Map<string, number>();
    for (const p of found) {
      const k = p.kanaLastName + p.kanaFirstName;
      nameCount.set(k, (nameCount.get(k) ?? 0) + 1);
    }

    const now = Date.now();
    rows = found.map((p) => {
      // include: { insurances: true } で保険行が付与される（デモ proxy では未付与＝[]）。
      const insRaw = p.insurances ?? [];
      const insurances: Ins[] = insRaw
        .filter((i) => {
          // 有効期間外保険は受付選択肢から除外（FR-PAT-04 と整合）。
          if (i.validFrom && new Date(i.validFrom).getTime() > now) return false;
          if (i.validTo && new Date(i.validTo).getTime() < now) return false;
          return true;
        })
        .map((i) => ({
          id: i.id,
          payerType: i.payerType,
          payerNo: i.payerNo,
          symbol: i.symbol,
          number: i.number,
        }));
      return {
        id: p.id,
        patientNo: p.patientNo,
        name: `${p.kanjiLastName} ${p.kanjiFirstName}`,
        kana: `${p.kanaLastName} ${p.kanaFirstName}`,
        genderLabel: p.gender === 'MALE' ? '男' : p.gender === 'FEMALE' ? '女' : '—',
        age: age(p.dateOfBirth),
        isVip: Boolean(p.isVip),
        isTemporaryId: Boolean(p.isTemporaryId),
        sameName: (nameCount.get(p.kanaLastName + p.kanaFirstName) ?? 0) > 1,
        insurances,
      };
    });
  } catch (err) {
    console.error('[ReceptionRegisterPage] patient search failed:', err);
  }

  return (
    <PageBody>
      <PageHeader
        title="受付登録"
        desc="患者を検索して受付します。受付すると外来受診（来院済 / ARRIVED）が作成され、受付票（A6）を印刷できます。（FR-RCP-04）"
        crumbs={['Medixus カルテ', '外来', '受付登録']}
        actions={
          <Link href="/patients/select?tab=reception">
            <Button variant="secondary">
              <Icon name="reception" size={14} /> 受付一覧へ
            </Button>
          </Link>
        }
      />

      <Panel className="mb-4">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <Field label="患者検索（カナ / 漢字氏名 / 患者ID）">
            <Input
              name="q"
              defaultValue={q}
              placeholder="例: ヤマダ / 山田 / 100001（前方・部分一致）"
              className="w-96"
            />
          </Field>
          <Button type="submit" variant="primary">
            <Icon name="search" size={14} /> 検索
          </Button>
          {q && (
            <Link href="/reception/register" className="text-xs text-muted underline">
              クリア
            </Link>
          )}
        </form>
      </Panel>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Icon name="reception" size={36} />}
          title={q ? '該当する患者が見つかりません' : '患者を検索してください'}
          hint={
            q
              ? '別のカナ・漢字氏名・患者IDで再検索してください。'
              : 'カナ氏名・漢字氏名・患者IDで検索すると受付候補が表示されます。'
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => {
            const warn = r.isVip || r.isTemporaryId || r.sameName;
            return (
              <Panel key={r.id} className={warn ? 'border-red-200' : undefined}>
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted">ID {r.patientNo}</span>
                      <span className="text-base font-bold text-ink">{r.name}</span>
                      <span className="text-xs text-muted">{r.kana}</span>
                      <Badge tone="gray">
                        {r.genderLabel} / {r.age}歳
                      </Badge>
                      {r.isTemporaryId && <Badge tone="amber">仮ID</Badge>}
                      {r.isVip && <Badge tone="amber">VIP</Badge>}
                      {r.sameName && <Badge tone="amber">同姓同名</Badge>}
                    </div>
                    {warn && (
                      <p className="mt-1 text-2xs text-alert">
                        ⚠ 患者IDと氏名を必ず確認してください（取り違え防止）。
                      </p>
                    )}
                  </div>

                  <form
                    action={registerReception}
                    className="flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="patientId" value={r.id} />
                    <Field label="初診 / 再診">
                      <Select name="visitType" defaultValue="RETURN">
                        <option value="RETURN">再診</option>
                        <option value="FIRST">初診</option>
                      </Select>
                    </Field>
                    <Field label="診療科">
                      <Select name="departmentId" defaultValue={departments[0]?.id ?? ''}>
                        {departments.length === 0 && <option value="">（診療科未設定）</option>}
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="保険">
                      <Select name="insuranceId" defaultValue={r.insurances[0]?.id ?? ''}>
                        <option value="">（自費 / 未選択）</option>
                        {r.insurances.map((i) => (
                          <option key={i.id} value={i.id}>
                            {PAYER_LABEL[i.payerType] ?? i.payerType}
                            {i.symbol || i.number
                              ? ` ${i.symbol ?? ''}${i.symbol && i.number ? '-' : ''}${i.number ?? ''}`
                              : ''}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="来院方法">
                      <Select name="arrivalMethod" defaultValue="">
                        <option value="">—</option>
                        <option value="WALK_IN">独歩</option>
                        <option value="WHEELCHAIR">車椅子</option>
                        <option value="STRETCHER">ストレッチャー</option>
                        <option value="AMBULANCE">救急搬送</option>
                      </Select>
                    </Field>
                    <Button type="submit" variant="primary">
                      <Icon name="reception" size={14} /> 受付して受付票印刷
                    </Button>
                  </form>
                </div>
              </Panel>
            );
          })}
        </div>
      )}
    </PageBody>
  );
}
