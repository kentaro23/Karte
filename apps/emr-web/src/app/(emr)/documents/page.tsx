import { prisma } from '@medixus/db';
import { Panel, PanelHeader, Badge, Icon, Button, Field, Input, Select, EmptyState } from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import {
  createDocument,
  createDischargeSummary,
  completeDischargeSummary,
  approveDischargeSummary,
  createScanDocument,
  listDocTemplates,
  type DocTemplateRow,
} from './actions';
import { TemplateMergeClient, type DocPatientOpt } from './template-client';

// 文書は患者コンテキスト依存・登録後の即時反映が要るため動的描画。
// DB 未接続でもデモが描画されるよう全データ取得を fail-soft 化する。
export const dynamic = 'force-dynamic';

/* ── 型（フロントのみモードのフォールバックにも使う） ── */
type DocRow = {
  id: string;
  docType: string;
  title: string;
  format: string;
  templateId: string | null;
  scannedPages: number | null;
  ocrText: string | null;
  patientId: string | null;
  createdAt: Date;
};
type SummaryRow = {
  id: string;
  patientId: string | null;
  status: string;
  approvalStatus: string;
  hospitalCourse: string | null;
};

const FORMAT_LABEL: Record<string, string> = {
  TEXT: 'テキスト',
  WORD: 'docx',
  EXCEL: 'xlsx',
  PDF: 'PDF',
  SCAN_IMAGE: 'スキャン',
};
const FORMAT_TONE: Record<string, 'gray' | 'blue' | 'teal' | 'amber' | 'green'> = {
  TEXT: 'gray',
  WORD: 'blue',
  EXCEL: 'teal',
  PDF: 'amber',
  SCAN_IMAGE: 'green',
};

/* ── フロントのみモード用デモデータ ── */
const DEMO_PATIENTS: DocPatientOpt[] = [
  { id: 'demo-pat-1', patientNo: '000123', name: '山田 花子' },
  { id: 'demo-pat-2', patientNo: '000124', name: '佐藤 太郎' },
];
function demoDocs(): DocRow[] {
  return [
    {
      id: 'demo-doc-1',
      docType: '紹介状',
      title: '診療情報提供書（山田 花子）',
      format: 'WORD',
      templateId: 'demo-tpl-1',
      scannedPages: null,
      ocrText: null,
      patientId: 'demo-pat-1',
      createdAt: new Date(),
    },
    {
      id: 'demo-doc-2',
      docType: 'スキャン文書',
      title: '前医 紹介状（紙）スキャン',
      format: 'SCAN_IMAGE',
      templateId: null,
      scannedPages: 3,
      ocrText: '紹介状 高血圧症 アムロジピン 既往: 脂質異常症',
      patientId: 'demo-pat-1',
      createdAt: new Date(),
    },
  ];
}

async function loadData(q: string): Promise<{
  docs: DocRow[];
  summaries: SummaryRow[];
  patients: DocPatientOpt[];
  patMap: Map<string, string>;
  live: boolean;
}> {
  try {
    const [docsRaw, summariesRaw, patientsRaw] = await Promise.all([
      prisma.clinicalDocument.findMany({ orderBy: { createdAt: 'desc' }, take: 80 }),
      prisma.dischargeSummary.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      prisma.patient.findMany({ orderBy: { createdAt: 'asc' }, take: 40 }),
    ]);
    const patients: DocPatientOpt[] = patientsRaw.map((p) => ({
      id: p.id,
      patientNo: p.patientNo,
      name: `${p.kanjiLastName} ${p.kanjiFirstName}`,
    }));
    if (patientsRaw.length === 0 && docsRaw.length === 0) {
      // 未シード — デモを見せて画面を成立させる。
      return {
        docs: filterDocs(demoDocs(), q),
        summaries: [],
        patients: DEMO_PATIENTS,
        patMap: new Map(DEMO_PATIENTS.map((p) => [p.id, p.name])),
        live: false,
      };
    }
    const patMap = new Map(patients.map((p) => [p.id, p.name]));
    const docs: DocRow[] = docsRaw.map((d) => ({
      id: d.id,
      docType: d.docType,
      title: d.title,
      format: d.format,
      templateId: d.templateId,
      scannedPages: d.scannedPages,
      ocrText: d.ocrText,
      patientId: d.patientId,
      createdAt: d.createdAt,
    }));
    const summaries: SummaryRow[] = summariesRaw.map((sm) => ({
      id: sm.id,
      patientId: sm.patientId,
      status: sm.status,
      approvalStatus: sm.approvalStatus,
      hospitalCourse: sm.hospitalCourse,
    }));
    return { docs: filterDocs(docs, q), summaries, patients, patMap, live: true };
  } catch (err) {
    console.error('[documents] loadData failed; showing demo data:', err);
    return {
      docs: filterDocs(demoDocs(), q),
      summaries: [],
      patients: DEMO_PATIENTS,
      patMap: new Map(DEMO_PATIENTS.map((p) => [p.id, p.name])),
      live: false,
    };
  }
}

/** スキャン保管の検索（FR-DOC-03 AC(1)）— タイトル/種別/OCRテキストの部分一致。 */
function filterDocs(docs: DocRow[], q: string): DocRow[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return docs;
  return docs.filter((d) =>
    [d.title, d.docType, d.ocrText ?? '', d.format].some((s) => s.toLowerCase().includes(needle)),
  );
}

export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q ?? '';

  const { docs, summaries, patients, patMap, live } = await loadData(q);

  // 差込テンプレ一覧（独立 fail-soft）。
  let templates: DocTemplateRow[] = [];
  let templatesLive = live;
  try {
    const res = await listDocTemplates();
    templates = res.templates;
    templatesLive = res.live;
  } catch (err) {
    console.error('[documents] listDocTemplates failed:', err);
    templatesLive = false;
  }

  const scanDocs = docs.filter((d) => d.format === 'SCAN_IMAGE');
  const generatedDocs = docs.filter((d) => d.templateId);

  return (
    <PageBody>
      <PageHeader
        title="文書管理"
        desc="差込テンプレ（docx/xlsx）自動生成・院内文書・同意書・退院サマリ・紙文書スキャン保管/検索（174項 117,166-168 / FR-DOC-01,03）"
        crumbs={['Medixus カルテ', '診療', '文書管理']}
        actions={
          <span className="flex items-center gap-2">
            <Badge tone="blue">テンプレ {templates.length}</Badge>
            <Badge tone="green">スキャン {scanDocs.length}</Badge>
            {!live && <Badge tone="gray">サンプル表示</Badge>}
          </span>
        }
      />

      {/* ── FR-DOC-01 差込テンプレート文書 ── */}
      <Panel className="mb-4">
        <PanelHeader
          title="差込テンプレート文書（docx / xlsx）"
          desc="医療機関がテンプレを登録し、患者・保険・病名・投薬・検査・バイタルを自動差込（FR-DOC-01）"
          icon={<Icon name="template" size={15} />}
        />
        <TemplateMergeClient templates={templates} patients={patients} live={templatesLive} />
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-4">
          {/* ── 文書一覧（検索＝スキャン保管検索 FR-DOC-03） ── */}
          <Panel pad={false}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <span className="flex items-center gap-2 text-sm font-bold">
                <Icon name="sticky" size={15} /> 文書一覧
                <Badge tone="gray">{docs.length} 件</Badge>
                {generatedDocs.length > 0 && <Badge tone="blue">差込生成 {generatedDocs.length}</Badge>}
              </span>
              {/* 検索（タイトル/種別/OCRテキスト）— GET なので JS 不要・常に動く。 */}
              <form className="flex items-center gap-1.5">
                <Input name="q" defaultValue={q} placeholder="タイトル・種別・OCR本文で検索" className="!w-56 !py-1 text-xs" />
                <Button size="sm" variant="secondary" type="submit">
                  <Icon name="search" size={13} /> 検索
                </Button>
              </form>
            </div>
            {docs.length === 0 ? (
              <EmptyState title={q ? '該当する文書はありません' : '文書はありません'} />
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-soft text-2xs uppercase text-muted">
                    <th className="px-3 py-1.5 text-left">種別</th>
                    <th className="px-3 py-1.5 text-left">タイトル</th>
                    <th className="px-3 py-1.5 text-left">形式</th>
                    <th className="px-3 py-1.5 text-left">患者</th>
                    <th className="px-3 py-1.5 text-left">作成</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={d.id} className="border-t border-line align-top">
                      <td className="px-3 py-1.5">
                        <Badge tone="blue">{d.docType}</Badge>
                      </td>
                      <td className="px-3 py-1.5">
                        <div className="font-medium">{d.title}</div>
                        {d.templateId && (
                          <div className="text-2xs text-muted">
                            <Icon name="template" size={11} /> テンプレ差込生成
                          </div>
                        )}
                        {d.format === 'SCAN_IMAGE' && (
                          <div className="text-2xs text-muted">
                            {d.scannedPages ? `${d.scannedPages}ページ` : ''}
                            {d.ocrText ? `・OCR: ${d.ocrText.slice(0, 40)}${d.ocrText.length > 40 ? '…' : ''}` : ''}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-1.5">
                        <Badge tone={FORMAT_TONE[d.format] ?? 'gray'}>{FORMAT_LABEL[d.format] ?? d.format}</Badge>
                      </td>
                      <td className="px-3 py-1.5 text-2xs text-muted">
                        {d.patientId ? patMap.get(d.patientId) ?? `#${d.patientId.slice(0, 6)}` : '—'}
                      </td>
                      <td className="px-3 py-1.5 text-2xs text-muted">
                        {d.createdAt.toLocaleString('ja-JP')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Panel>

          {/* ── FR-DOC-03 スキャン文書保管 ── */}
          <Panel>
            <PanelHeader
              title="紙文書スキャン保管"
              desc="紙文書のスキャン（ページ数・OCRテキスト）を患者に紐付け保管。上の検索で本文検索できます（FR-DOC-03）"
              icon={<Icon name="print" size={15} />}
            />
            <form action={createScanDocument} className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Field label="タイトル" required>
                <Input name="title" required placeholder="例：前医 紹介状（紙）" />
              </Field>
              <Field label="患者（任意）">
                <Select name="patientId" defaultValue="">
                  <option value="">（患者未指定）</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.patientNo} {p.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="文書種別">
                <Select name="docType" defaultValue="スキャン文書">
                  <option>スキャン文書</option>
                  <option>紹介状</option>
                  <option>同意書</option>
                  <option>検査結果（紙）</option>
                  <option>診断書（紙）</option>
                </Select>
              </Field>
              <Field label="ページ数">
                <Input name="scannedPages" inputMode="numeric" placeholder="例：3" />
              </Field>
              <Field label="保管先URL（任意）">
                <Input name="storageUrl" placeholder="スキャン画像/PDF の保管URL" />
              </Field>
              <Field label="OCRテキスト（検索用）" hint="OCR抽出文を入れると本文検索の対象になります">
                <textarea
                  name="ocrText"
                  rows={2}
                  placeholder="OCRで抽出した本文（任意）"
                  className="rounded border border-line px-2.5 py-1.5 text-sm"
                />
              </Field>
              <div className="sm:col-span-2">
                <Button type="submit" variant="primary">
                  <Icon name="plus" size={14} /> スキャン文書を保管
                </Button>
              </div>
            </form>
          </Panel>

          {/* ── 退院サマリ（既存） ── */}
          <Panel>
            <PanelHeader title="退院サマリ" icon={<Icon name="chart" size={15} />} />
            {summaries.length === 0 ? (
              <EmptyState title="退院サマリはありません（右で作成）" />
            ) : (
              <ul className="divide-y divide-line text-sm">
                {summaries.map((sm) => {
                  const name = sm.patientId ? patMap.get(sm.patientId) : undefined;
                  return (
                    <li key={sm.id} className="py-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{name ?? `#${sm.id.slice(0, 8)}`}</span>
                        <span className="flex gap-2">
                          <Badge tone={sm.status === 'COMPLETED' ? 'green' : 'amber'}>
                            {sm.status === 'COMPLETED' ? '作成済' : '作成中'}
                          </Badge>
                          <Badge tone={sm.approvalStatus === 'APPROVED' ? 'green' : 'gray'}>
                            {sm.approvalStatus === 'APPROVED' ? '承認済' : '未承認'}
                          </Badge>
                        </span>
                      </div>
                      {sm.hospitalCourse && (
                        <p className="mt-0.5 line-clamp-2 text-2xs text-muted">経過: {sm.hospitalCourse}</p>
                      )}
                      <div className="mt-1 flex gap-2">
                        {sm.status !== 'COMPLETED' && (
                          <form action={completeDischargeSummary}>
                            <input type="hidden" name="id" value={sm.id} />
                            <Button size="sm" variant="ghost" type="submit">
                              作成完了
                            </Button>
                          </form>
                        )}
                        {sm.status === 'COMPLETED' && sm.approvalStatus !== 'APPROVED' && (
                          <form action={approveDischargeSummary}>
                            <input type="hidden" name="id" value={sm.id} />
                            <Button size="sm" variant="secondary" type="submit">
                              承認
                            </Button>
                          </form>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          {/* ── 退院サマリ作成（既存） ── */}
          <Panel>
            <PanelHeader title="退院サマリ作成" icon={<Icon name="plus" size={15} />} />
            <form action={createDischargeSummary} className="flex flex-col gap-2">
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
              {(
                [
                  ['admissionCourse', '入院までの経過'],
                  ['presentIllness', '現症・主病名'],
                  ['hospitalCourse', '入院後経過・治療'],
                  ['dischargePlan', '退院時方針・処方・申し送り'],
                ] as const
              ).map(([name, label]) => (
                <Field key={name} label={label}>
                  <textarea
                    name={name}
                    rows={2}
                    className="rounded border border-line px-2.5 py-1.5 text-sm"
                  />
                </Field>
              ))}
              <Button type="submit" variant="primary">
                退院サマリを作成（作成中）
              </Button>
            </form>
          </Panel>
        </div>

        {/* ── 新規 院内文書（既存） ── */}
        <Panel>
          <PanelHeader title="新規 院内文書" icon={<Icon name="plus" size={15} />} />
          <form action={createDocument} className="flex flex-col gap-3">
            <Field label="文書種別">
              <Select name="docType" defaultValue="院内文書">
                <option>院内文書</option>
                <option>同意書</option>
                <option>説明書</option>
                <option>診断書</option>
                <option>スキャン文書</option>
              </Select>
            </Field>
            <Field label="患者（任意）">
              <Select name="patientId" defaultValue="">
                <option value="">（患者未指定）</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.patientNo} {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="タイトル" required>
              <Input name="title" required />
            </Field>
            <Field label="本文">
              <textarea
                name="body"
                rows={5}
                className="rounded border border-line px-2.5 py-1.5 text-sm"
              />
            </Field>
            <Button type="submit" variant="primary">
              文書を保存
            </Button>
          </form>
        </Panel>
      </div>
    </PageBody>
  );
}
