'use client';
import * as React from 'react';
import Link from 'next/link';
import {
  Panel,
  PanelHeader,
  Button,
  Badge,
  Icon,
  Input,
  EmptyState,
  SchemaCanvas,
} from '@medixus/ui';
import { PageBody, PageHeader } from '@/components/page';
import {
  listSchemaTargets,
  listPatientSchemas,
  saveSchema,
  type SchemaPatientOption,
  type SchemaAttachmentRow,
} from './actions';

/**
 * シェーマ（手描き＋人体図ライブラリ）— FR-CHT-04 / 174項 17。
 *
 * 人体図ライブラリ(public/schema-library)を名前検索→背景配置→手描き注釈し、
 * NoteAttachment(kind=SCHEMA) として保存する。クライアントコンポーネントとして
 * サーバーアクションを呼び、DB未接続(フロントのみモード)でも try/catch・null安全で描画する。
 *
 * ※ 図メタデータは public/schema-library/README.md と同期。図を増減したら両方更新する。
 */

interface SchemaFigure {
  id: string; // = public/schema-library/<id>.svg
  name: string;
  region: string;
  keywords: string[];
}

const SCHEMA_LIBRARY: SchemaFigure[] = [
  {
    id: 'body-front',
    name: '全身（前面）',
    region: '全身',
    keywords: ['全身', '前面', 'ぜんしん', 'body', 'front', 'zenshin'],
  },
  {
    id: 'body-back',
    name: '全身（背面）',
    region: '全身',
    keywords: ['全身', '背面', 'せなか', '背中', 'back', 'spine', 'senaka'],
  },
  {
    id: 'head',
    name: '頭部（正面）',
    region: '頭頸部',
    keywords: ['頭部', '顔', 'あたま', 'かお', 'head', 'face', 'atama'],
  },
  {
    id: 'eye-nose',
    name: '眼・鼻部',
    region: '頭頸部',
    keywords: ['眼', '目', '鼻', 'がん', 'び', 'め', 'eye', 'nose'],
  },
  {
    id: 'mouth',
    name: '口腔・口元',
    region: '頭頸部',
    keywords: ['口', '口腔', '歯', 'くち', 'は', 'mouth', 'oral', 'kuchi'],
  },
  {
    id: 'chest',
    name: '胸部（前面）',
    region: '体幹',
    keywords: ['胸部', '胸', 'むね', 'chest', 'thorax', 'mune', 'kyoubu'],
  },
  {
    id: 'abdomen',
    name: '腹部（4分割）',
    region: '体幹',
    keywords: ['腹部', 'お腹', 'おなか', 'ruq', 'luq', 'rlq', 'llq', 'abdomen', 'fukubu'],
  },
];

const figureUrl = (id: string) => `/schema-library/${id}.svg`;

export default function SchemaPage() {
  const [targets, setTargets] = React.useState<SchemaPatientOption[]>([]);
  const [loadingTargets, setLoadingTargets] = React.useState(true);
  const [encounterId, setEncounterId] = React.useState('');

  const [query, setQuery] = React.useState('');
  const [figureId, setFigureId] = React.useState<string | null>(null);
  const [strokes, setStrokes] = React.useState('[]');
  const [caption, setCaption] = React.useState('');
  const [canvasKey, setCanvasKey] = React.useState(0);

  const [saved, setSaved] = React.useState<SchemaAttachmentRow[]>([]);
  const [msg, setMsg] = React.useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const [pending, start] = React.useTransition();

  // 添付先候補（当日受付）をロード。DB無なら空配列で画面は成立。
  React.useEffect(() => {
    let active = true;
    (async () => {
      try {
        const t = await listSchemaTargets();
        if (!active) return;
        setTargets(t);
        if (t.length > 0) setEncounterId((cur) => cur || t[0]!.encounterId);
      } catch {
        if (active) setTargets([]);
      } finally {
        if (active) setLoadingTargets(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const selectedTarget = targets.find((t) => t.encounterId === encounterId) ?? null;
  const patientId = selectedTarget?.patientId ?? '';

  // 選択患者の保存済シェーマを取得（版管理に追随）。
  const refreshSaved = React.useCallback(async () => {
    if (!patientId) {
      setSaved([]);
      return;
    }
    try {
      setSaved(await listPatientSchemas(patientId));
    } catch {
      setSaved([]);
    }
  }, [patientId]);

  React.useEffect(() => {
    void refreshSaved();
  }, [refreshSaved]);

  const results = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SCHEMA_LIBRARY;
    return SCHEMA_LIBRARY.filter(
      (f) =>
        f.name.toLowerCase().includes(q) ||
        f.region.toLowerCase().includes(q) ||
        f.keywords.some((k) => k.toLowerCase().includes(q)),
    );
  }, [query]);

  const selectedFigure = SCHEMA_LIBRARY.find((f) => f.id === figureId) ?? null;

  const resetCanvas = () => {
    setStrokes('[]');
    setCanvasKey((k) => k + 1);
  };

  const onSave = () =>
    start(async () => {
      setMsg(null);
      const r = await saveSchema({
        encounterId,
        libraryRef: figureId,
        strokes,
        caption,
      });
      if (r.ok) {
        setMsg({ tone: 'ok', text: 'シェーマを保存しました（NoteAttachment kind=SCHEMA・版管理に追随）' });
        setCaption('');
        resetCanvas();
        await refreshSaved();
      } else {
        setMsg({ tone: 'err', text: r.error ?? '保存に失敗しました' });
      }
    });

  let strokeCount = 0;
  try {
    const p = JSON.parse(strokes || '[]');
    strokeCount = Array.isArray(p) ? p.length : 0;
  } catch {
    strokeCount = 0;
  }
  const canSave = !!encounterId && (strokeCount > 0 || !!figureId);

  return (
    <PageBody>
      <PageHeader
        title="シェーマ（人体図ライブラリ＋手描き）"
        desc="人体図を名前検索→背景配置→手描き注釈し、カルテ記載に添付（FR-CHT-04 / 174項 17）"
        crumbs={['Medixus カルテ', '診療', 'シェーマ']}
        actions={<Badge tone="blue">FR-CHT-04</Badge>}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_1fr_300px]">
        {/* ── LEFT: 人体図ライブラリ（名前検索） ── */}
        <Panel>
          <PanelHeader
            title="人体図ライブラリ"
            desc="名前・部位で検索"
            icon={<Icon name="schema" size={15} />}
          />
          <div className="relative mb-2">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted">
              <Icon name="search" size={14} />
            </span>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="例: 腹部, 頭, eye, RUQ"
              className="w-full pl-7"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            {results.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFigureId(f.id)}
                className={`group flex flex-col items-center rounded-card border p-1.5 text-center transition-colors hover:bg-accent-50 ${
                  figureId === f.id ? 'border-accent-500 bg-accent-50' : 'border-line'
                }`}
                title={f.name}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={figureUrl(f.id)}
                  alt={f.name}
                  className="h-20 w-full rounded border border-line/60 bg-white object-contain"
                />
                <span className="mt-1 line-clamp-1 text-2xs font-medium text-ink">{f.name}</span>
                <span className="text-2xs text-muted">{f.region}</span>
              </button>
            ))}
            {results.length === 0 && (
              <div className="col-span-2">
                <EmptyState title="該当する人体図がありません" hint="別のキーワードで検索してください" />
              </div>
            )}
          </div>
          <p className="mt-2 text-2xs text-muted/80">
            図は院内ライブラリ（public/schema-library）。背景なしの手描きのみでも保存できます。
          </p>
        </Panel>

        {/* ── CENTER: キャンバス（背景配置＋手描き注釈） ── */}
        <Panel>
          <PanelHeader
            title="注釈キャンバス"
            desc={selectedFigure ? `背景: ${selectedFigure.name}` : '背景なし（手描きのみ）'}
            icon={<Icon name="edit" size={15} />}
            actions={
              <div className="flex items-center gap-1.5">
                {figureId && (
                  <Button size="sm" variant="ghost" onClick={() => setFigureId(null)}>
                    <Icon name="x" size={13} /> 背景を外す
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={resetCanvas} disabled={strokeCount === 0}>
                  <Icon name="refresh" size={13} /> 注釈クリア
                </Button>
              </div>
            }
          />

          <div className="flex flex-col items-center gap-3">
            <SchemaCanvas
              key={canvasKey}
              imageUrl={figureId ? figureUrl(figureId) : undefined}
              value={strokes}
              onChange={setStrokes}
              width={360}
              height={420}
            />

            <div className="w-full max-w-[440px]">
              <label className="mb-1 block text-2xs font-bold text-muted">所見コメント（任意・文字としても保存）</label>
              <Input
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="例: 右下腹部に圧痛、反跳痛あり"
                className="w-full"
              />
            </div>

            {/* 添付先（受診中の患者） */}
            <div className="w-full max-w-[440px]">
              <label className="mb-1 block text-2xs font-bold text-muted">添付先カルテ（受診中の患者）</label>
              {loadingTargets ? (
                <p className="text-2xs text-muted">読み込み中…</p>
              ) : targets.length === 0 ? (
                <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-2xs text-warn">
                  受診中の患者が見つかりません（DB未接続のフロントのみモードでは選択肢が出ません）。
                  受付済の患者があれば選択して保存できます。
                </p>
              ) : (
                <select
                  value={encounterId}
                  onChange={(e) => setEncounterId(e.target.value)}
                  className="w-full rounded border border-line px-2 py-1.5 text-sm"
                >
                  {targets.map((t) => (
                    <option key={t.encounterId} value={t.encounterId}>
                      {t.patientNo} ・ {t.name}（{t.deptName}）
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex w-full max-w-[440px] items-center gap-2">
              <Button
                variant="primary"
                disabled={pending || !canSave}
                onClick={onSave}
                className="flex-1 justify-center"
              >
                <Icon name="check" size={14} /> シェーマを保存（カルテに添付）
              </Button>
              {selectedTarget && (
                <Link
                  href={`/chart/${encounterId}`}
                  className="text-2xs text-info underline whitespace-nowrap"
                >
                  カルテを開く →
                </Link>
              )}
            </div>

            {msg && (
              <div
                className={`w-full max-w-[440px] rounded border px-3 py-2 text-xs ${
                  msg.tone === 'ok'
                    ? 'border-accent-300 bg-accent-50 text-accent-700'
                    : 'border-alert/40 bg-red-50 text-alert'
                }`}
              >
                {msg.text}
              </div>
            )}
            {!canSave && encounterId && (
              <p className="text-2xs text-muted/80">人体図を選ぶか注釈を1つ以上描くと保存できます。</p>
            )}
          </div>
        </Panel>

        {/* ── RIGHT: 保存済シェーマ（版管理追随） ── */}
        <Panel>
          <PanelHeader
            title="保存済シェーマ"
            desc={selectedTarget ? selectedTarget.name : '患者未選択'}
            icon={<Icon name="chart" size={15} />}
          />
          {!patientId ? (
            <EmptyState title="患者を選択してください" />
          ) : saved.length === 0 ? (
            <EmptyState title="保存済シェーマはありません" hint="左で人体図を選び注釈して保存" />
          ) : (
            <ul className="flex flex-col gap-2">
              {saved.map((a) => {
                const fig = a.libraryRef ? SCHEMA_LIBRARY.find((f) => f.id === a.libraryRef) : null;
                return (
                  <li key={a.id} className="rounded-card border border-line p-2">
                    <div className="flex gap-2">
                      <div className="h-24 w-20 shrink-0 overflow-hidden rounded border border-line/60 bg-white">
                        <SchemaCanvas
                          imageUrl={a.libraryRef ? figureUrl(a.libraryRef) : undefined}
                          value={a.strokes ?? '[]'}
                          readOnly
                          width={80}
                          height={96}
                        />
                      </div>
                      <div className="min-w-0 flex-1 text-xs">
                        <div className="flex items-center gap-1">
                          <Badge tone="green">SCHEMA</Badge>
                          <span className="text-2xs text-muted">第{a.noteVersion}版</span>
                        </div>
                        <div className="mt-1 font-medium text-ink">
                          {fig?.name ?? (a.libraryRef ? a.libraryRef : '手描きのみ')}
                        </div>
                        {a.caption && <div className="mt-0.5 text-2xs text-muted">{a.caption}</div>}
                        <div className="mt-0.5 text-2xs text-muted/70">
                          {new Date(a.recordedDate).toLocaleString('ja-JP')}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-2 text-2xs text-muted/70">
            シェーマは記載ノートの NoteAttachment(kind=SCHEMA) として保存され、ノートの版管理に追随します。
          </p>
        </Panel>
      </div>
    </PageBody>
  );
}
