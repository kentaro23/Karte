'use client';
import * as React from 'react';
import { Panel, PanelHeader, Badge, Icon, Button, Field, Input, Select } from '@medixus/ui';
import {
  buildMergeMap,
  applyMerge,
  MERGE_VARIABLE_KEYS,
  type MergeSource,
} from '@/lib/doc-merge';
import {
  createDocTemplate,
  deleteDocTemplate,
  generateFromTemplate,
  type DocTemplateRow,
  type GenerateResult,
} from './actions';

export interface DocPatientOpt {
  id: string;
  patientNo: string;
  name: string;
}

/** DB 未接続でも和暦/枝番/バイタルの差込を提示するための決定論サンプルソース。 */
const DEMO_SOURCE: MergeSource = {
  patient: {
    patientNo: '000123',
    kanjiLastName: '山田',
    kanjiFirstName: '花子',
    kanaLastName: 'ヤマダ',
    kanaFirstName: 'ハナコ',
    dateOfBirth: new Date('1984-04-12'),
    gender: 'FEMALE',
    phone: '03-1234-5678',
    address: { postalCode: '160-0022', prefecture: '東京都', city: '新宿区', line: '新宿1-2-3 メディカルビル4F' },
  },
  facility: {
    name: 'Medixus 内科クリニック',
    kind: 'CLINIC',
    address: '東京都新宿区新宿1-2-3',
    phone: '03-1234-5678',
    director: '院長 大原 健太郎',
    doctorName: '研修 太郎',
    departmentName: '内科',
  },
  diagnoses: [
    { displayName: '高血圧症', isMain: true, outcome: null, startDate: new Date('2023-06-01') },
    { displayName: '2型糖尿病', isMain: false, outcome: null, startDate: new Date('2024-01-15') },
    { displayName: '感冒', isMain: false, isSuspected: true, outcome: null },
  ],
  medications: [
    { name: 'アムロジピンOD錠5mg', dosage: '1回1錠 1日1回 朝食後 30日分' },
    { name: 'メトホルミン塩酸塩錠250mg', dosage: '1回1錠 1日2回 朝夕食後 30日分' },
  ],
  labs: [
    { name: 'HbA1c', value: 7.2, unit: '%', flag: 'H' },
    { name: 'LDL-C', value: 142, unit: 'mg/dL', flag: 'H' },
    { name: 'eGFR', value: 68, unit: 'mL/min/1.73m²', flag: 'N' },
  ],
  insurance: {
    payerType: 'SOCIAL',
    payerNo: '06270017',
    symbol: '12',
    number: '3456',
    branchNo: '01',
    public1: { payer: '54137018', recipient: '0000001' },
    workersComp: false,
    specialNote: '長２',
  },
  vitals: { heightCm: 158, weightKg: 56, systolic: 138, diastolic: 84, pulse: 72, temperature: 36.6, spo2: 98 },
  issuedOn: new Date(),
};

/** 差込テンプレ未登録時に提示するサンプル本文（{{key}} を含む）。 */
const SAMPLE_TEMPLATE_BODY = `診療情報提供書

{{作成日和暦}}（{{作成日西暦}}）

紹介先 御机下

患者氏名： {{患者氏名}}（{{患者カナ}}） 様
ローマ字： {{患者ローマ字}}
生年月日： {{生年月日和暦}}（{{生年月日西暦}}） {{年齢}}歳 {{性別}}
住所　　： 〒{{郵便番号}} {{患者住所}}
保険　　： 保険者番号 {{保険者番号}} ／ {{記号番号枝番}}
公費　　： 負担者 {{公費負担者番号1}} ／ 受給者 {{公費受給者番号1}}

【傷病名（未転帰）】
{{未転帰傷病名}}

【現在の処方】
{{直近投薬}}

【直近の検査所見】
{{直近検査}}

【バイタル】
身長 {{身長}} ／ 体重 {{体重}} ／ BMI {{BMI}}
血圧 {{血圧}} ／ 脈拍 {{脈拍}} ／ 体温 {{体温}} ／ SpO2 {{SpO2}}

────────────────
{{医療機関名}}（{{医療機関種別}}）
{{医療機関住所}}　TEL {{医療機関電話}}
担当医： {{医師名}}　／　管理者： {{管理者名}}`;

export function TemplateMergeClient({
  templates,
  patients,
  live,
}: {
  templates: DocTemplateRow[];
  patients: DocPatientOpt[];
  live: boolean;
}) {
  const hasTemplates = templates.length > 0;
  const [selectedId, setSelectedId] = React.useState<string>(hasTemplates ? templates[0]!.id : '');
  const [patientId, setPatientId] = React.useState<string>('');
  const [result, setResult] = React.useState<GenerateResult | null>(null);
  const [pending, startTransition] = React.useTransition();

  const selected = templates.find((t) => t.id === selectedId) ?? null;
  // 登録テンプレが無い時はサンプル本文でプレビューだけ提示。
  const previewBody = selected?.body ?? SAMPLE_TEMPLATE_BODY;

  // クライアント側プレビュー（DB 不要・サンプルソースで {{key}} を解決）。
  const demoMap = React.useMemo(() => buildMergeMap(DEMO_SOURCE), []);
  const demoPreview = React.useMemo(() => applyMerge(previewBody, demoMap), [previewBody, demoMap]);

  const onGenerate = () => {
    if (!selected || !patientId) return;
    setResult(null);
    startTransition(async () => {
      const r = await generateFromTemplate({ templateId: selected.id, patientId });
      setResult(r);
    });
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-4">
        {/* ── 登録済みテンプレ ── */}
        <Panel pad={false}>
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="flex items-center gap-2 text-sm font-bold">
              <Icon name="template" size={15} /> 差込テンプレート
              <Badge tone="gray">{templates.length}件</Badge>
            </span>
            {!live && <Badge tone="amber">サンプル表示（DB未接続）</Badge>}
          </div>
          {!hasTemplates ? (
            <p className="px-4 py-3 text-2xs text-muted">
              登録済みテンプレはありません。右のフォームで docx/xlsx テンプレ（プレースホルダ {'{{key}}'}）を登録してください。
              下のプレビューはサンプル本文での差込結果です。
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-line">
              {templates.map((t) => (
                <li
                  key={t.id}
                  className={`flex items-center justify-between gap-2 px-4 py-2 text-sm ${
                    selectedId === t.id ? 'bg-accent-50' : ''
                  }`}
                >
                  <button type="button" className="flex flex-1 items-center gap-2 text-left" onClick={() => setSelectedId(t.id)}>
                    <Badge tone={t.format === 'EXCEL' ? 'teal' : 'blue'}>{t.format === 'EXCEL' ? 'xlsx' : 'docx'}</Badge>
                    <span className="font-medium">{t.name}</span>
                    <span className="text-2xs text-muted">{t.docType}</span>
                    <span className="text-2xs text-muted">差込 {t.placeholders.length}</span>
                  </button>
                  <form action={deleteDocTemplate}>
                    <input type="hidden" name="id" value={t.id} />
                    <Button size="sm" variant="ghost" type="submit" title="テンプレを削除">
                      <Icon name="x" size={13} />
                    </Button>
                  </form>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* ── 差込生成 ── */}
        <Panel>
          <PanelHeader
            title="テンプレ差込生成"
            desc="テンプレと患者を選ぶと、患者・保険・病名・投薬・検査・バイタルの単一データソースから自動差込（二重入力ゼロ）"
            icon={<Icon name="sticky" size={15} />}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="テンプレ">
              <Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} disabled={!hasTemplates}>
                {!hasTemplates && <option value="">（未登録）</option>}
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}（{t.format === 'EXCEL' ? 'xlsx' : 'docx'}）
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="患者">
              <Select value={patientId} onChange={(e) => setPatientId(e.target.value)}>
                <option value="">選択</option>
                {patients.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.patientNo} {p.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={onGenerate} disabled={!selected || !patientId || pending}>
              <Icon name="check" size={14} /> {pending ? '生成中…' : '差込生成して保管'}
            </Button>
            <span className="text-2xs text-muted">
              生成文書は ClinicalDocument（templateId 付き）として保管され、下の「文書一覧」で検索できます。
            </span>
          </div>

          {result && (
            <div className="mt-3">
              {result.ok ? (
                <div className="rounded border border-accent-200 bg-accent-50 px-3 py-2 text-xs">
                  <p className="font-semibold text-accent-700">
                    <Icon name="check" size={13} /> 差込生成・保管しました
                    {result.unresolved && result.unresolved.length > 0 && (
                      <span className="ml-2 font-normal text-warn">
                        （空欄 {result.unresolved.length} 件：{result.unresolved.slice(0, 6).join('、')}）
                      </span>
                    )}
                  </p>
                  {result.output && (
                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded border border-line bg-white p-2 text-2xs text-ink">
                      {result.output}
                    </pre>
                  )}
                </div>
              ) : (
                <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-warn">
                  {result.error ?? '差込生成に失敗しました'}（下のサンプルプレビューで差込結果の体裁を確認できます）
                </div>
              )}
            </div>
          )}
        </Panel>

        {/* ── プレビュー（クライアント差込・DB不要） ── */}
        <Panel>
          <PanelHeader
            title={selected ? `${selected.name} プレビュー（サンプル患者で差込）` : 'サンプル差込プレビュー'}
            desc="和暦・ローマ字・保険枝番・公費・バイタルが差し込まれた結果（AC(2)）。実患者の生成は上のボタンから。"
            icon={<Icon name="search" size={15} />}
          />
          {demoPreview.unresolved.length > 0 && (
            <p className="mb-1.5 text-2xs text-muted">
              未解決 {demoPreview.unresolved.length} 件：{demoPreview.unresolved.slice(0, 8).join('、')}
            </p>
          )}
          <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded border border-line bg-soft/40 p-3 text-xs leading-relaxed text-ink">
            {demoPreview.output}
          </pre>
        </Panel>
      </div>

      {/* ── 右カラム：テンプレ登録＋変数チートシート ── */}
      <div className="flex flex-col gap-4">
        <Panel>
          <PanelHeader title="テンプレ登録（docx / xlsx）" icon={<Icon name="plus" size={15} />} />
          <form action={createDocTemplate} className="flex flex-col gap-2.5">
            <Field label="テンプレ名" required>
              <Input name="name" required placeholder="例：診療情報提供書" />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="形式">
                <Select name="format" defaultValue="WORD">
                  <option value="WORD">docx（文書）</option>
                  <option value="EXCEL">xlsx（帳票）</option>
                </Select>
              </Field>
              <Field label="文書種別">
                <Select name="docType" defaultValue="紹介状">
                  <option>紹介状</option>
                  <option>診断書</option>
                  <option>同意書</option>
                  <option>説明書</option>
                  <option>院内文書</option>
                </Select>
              </Field>
            </div>
            <Field label="本文（プレースホルダ {{変数}}）" hint="docx/xlsx から抽出したテキストを貼付。{{患者氏名}} のように記入">
              <textarea
                name="body"
                rows={8}
                defaultValue={SAMPLE_TEMPLATE_BODY}
                className="rounded border border-line px-2.5 py-1.5 font-mono text-2xs leading-relaxed"
              />
            </Field>
            <Button type="submit" variant="secondary">
              <Icon name="plus" size={13} /> テンプレを登録
            </Button>
            {!live && (
              <p className="text-2xs leading-relaxed text-muted">
                DB 未接続のため登録はデモ表示です（画面操作可）。登録すると Template（layout=docx/xlsx 本文）として保存され、差込生成に使えます。
              </p>
            )}
          </form>
        </Panel>

        <Panel>
          <PanelHeader title="差込変数 一覧" icon={<Icon name="template" size={15} />} />
          <div className="flex flex-col gap-2.5">
            {MERGE_VARIABLE_KEYS.map((g) => (
              <div key={g.group}>
                <p className="mb-1 text-2xs font-bold uppercase tracking-wider text-muted">{g.group}</p>
                <div className="flex flex-wrap gap-1">
                  {g.keys.map((k) => (
                    <code key={k} className="rounded border border-line bg-soft px-1 py-0.5 text-2xs text-ink">{`{{${k}}}`}</code>
                  ))}
                </div>
              </div>
            ))}
            <p className="mt-1 text-2xs leading-relaxed text-muted">
              いずれも単一データソース（患者／保険／病名／投薬／検査／プロファイル）から取得されます（UX-3 二重入力ゼロ）。
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}
