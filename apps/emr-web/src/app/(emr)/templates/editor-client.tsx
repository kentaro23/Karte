'use client';
import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Panel,
  PanelHeader,
  Button,
  Badge,
  Icon,
  Modal,
  Field,
  Input,
  Select,
  Textarea,
  EmptyState,
} from '@medixus/ui';
import { SOAP_LABEL, type SoapBlock, type SoapKind } from '@medixus/domain';
import {
  createTemplate,
  updateTemplate,
  deleteTemplate,
  applyTemplate,
  type TemplateRow,
  type TemplateConditionRule,
  type TemplateInput,
} from './actions';

type Scope = TemplateRow['scope'];

const SCOPE_LABEL: Record<Scope, string> = {
  COMMON: '共通',
  DEPARTMENT: '診療科',
  DOCTOR: '個人',
};
const SCOPE_TONE: Record<Scope, 'gray' | 'blue' | 'green'> = {
  COMMON: 'gray',
  DEPARTMENT: 'blue',
  DOCTOR: 'green',
};
const SCOPE_ORDER: Scope[] = ['DOCTOR', 'DEPARTMENT', 'COMMON'];
const SOAP_KINDS: SoapKind[] = ['S', 'O', 'A', 'P'];

function emptyBlocks(): SoapBlock[] {
  return SOAP_KINDS.map((kind) => ({ kind, spans: [{ text: '' }] }));
}
/** SoapBlock[] の各セクションを 1 本のテキストに畳む（編集用）。 */
function blockText(blocks: SoapBlock[], kind: SoapKind): string {
  return blocks.find((b) => b.kind === kind)?.spans.map((s) => s.text).join('') ?? '';
}
function blocksFromText(texts: Record<SoapKind, string>): SoapBlock[] {
  return SOAP_KINDS.map((kind) => ({ kind, spans: [{ text: texts[kind] ?? '' }] }));
}
function blocksToPlain(blocks: SoapBlock[]): string {
  return blocks
    .map((b) => `【${b.kind}】${b.spans.map((s) => s.text).join('')}`)
    .filter((line) => line.replace(/^【.】/, '').trim().length > 0)
    .join('\n');
}

interface EditorState {
  id?: string;
  scope: Scope;
  departmentId: string;
  category: string;
  name: string;
  texts: Record<SoapKind, string>;
  conditional: TemplateConditionRule[];
}

function toEditorState(t?: TemplateRow): EditorState {
  if (!t) {
    return {
      scope: 'DOCTOR',
      departmentId: '',
      category: '',
      name: '',
      texts: { S: '', O: '', A: '', P: '', FREE: '' },
      conditional: [],
    };
  }
  return {
    id: t.id,
    scope: t.scope,
    departmentId: t.departmentId ?? '',
    category: t.category,
    name: t.name,
    texts: {
      S: blockText(t.blocks, 'S'),
      O: blockText(t.blocks, 'O'),
      A: blockText(t.blocks, 'A'),
      P: blockText(t.blocks, 'P'),
      FREE: blockText(t.blocks, 'FREE'),
    },
    conditional: t.conditional.map((c) => ({ ...c })),
  };
}

export function TemplateEditorClient(props: {
  templates: TemplateRow[];
  departments: { id: string; name: string }[];
  demo: boolean;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [msg, setMsg] = React.useState<string | null>(null);

  const [editor, setEditor] = React.useState<EditorState | null>(null);
  const [quote, setQuote] = React.useState<{
    tpl: TemplateRow;
    answers: Record<string, boolean>;
    blocks: SoapBlock[] | null;
  } | null>(null);

  const flash = (m: string) => {
    setMsg(m);
    window.setTimeout(() => setMsg(null), 3500);
  };

  // 「個人優先表示」: 同名は preferred の 1 件のみを既定表示。重複は折りたたむ。
  const [showAll, setShowAll] = React.useState(false);
  const visible = showAll ? props.templates : props.templates.filter((t) => t.preferred);

  const grouped = SCOPE_ORDER.map((scope) => ({
    scope,
    rows: visible.filter((t) => t.scope === scope),
  })).filter((g) => g.rows.length > 0);

  const deptName = (id: string | null) =>
    id ? (props.departments.find((d) => d.id === id)?.name ?? id) : null;

  /* ── 引用（1クリック） ── */
  const openQuote = (tpl: TemplateRow) => {
    // 条件分岐が無いものは即引用。あるものは回答ダイアログを出す。
    if (tpl.conditional.length === 0) {
      start(async () => {
        const r = await applyTemplate(tpl.id, {});
        if (r.ok) {
          setQuote({ tpl, answers: {}, blocks: r.blocks });
          flash(`「${tpl.name}」を引用しました（カルテへ流し込み可能）`);
        } else {
          flash(r.error);
        }
      });
    } else {
      setQuote({ tpl, answers: {}, blocks: null });
    }
  };

  const runQuote = () => {
    if (!quote) return;
    start(async () => {
      const r = await applyTemplate(quote.tpl.id, quote.answers);
      if (r.ok) {
        setQuote({ ...quote, blocks: r.blocks });
        flash(`「${quote.tpl.name}」を引用しました`);
      } else {
        flash(r.error);
      }
    });
  };

  const copyQuote = async () => {
    if (!quote?.blocks) return;
    try {
      await navigator.clipboard.writeText(blocksToPlain(quote.blocks));
      flash('引用内容をクリップボードへコピーしました');
    } catch {
      flash('コピーに失敗しました（手動で選択してください）');
    }
  };

  /* ── 保存（作成/更新） ── */
  const saveEditor = () => {
    if (!editor) return;
    const input: TemplateInput = {
      id: editor.id,
      scope: editor.scope,
      departmentId: editor.scope === 'DEPARTMENT' ? editor.departmentId || null : null,
      category: editor.category,
      name: editor.name,
      blocks: blocksFromText(editor.texts),
      conditional: editor.conditional.filter((c) => c.target && c.when),
    };
    start(async () => {
      const r = editor.id ? await updateTemplate(input) : await createTemplate(input);
      if (r.ok) {
        flash(
          editor.id
            ? `ひな形「${editor.name}」を更新しました`
            : `ひな形「${editor.name}」を作成しました`,
        );
        setEditor(null);
        router.refresh();
      } else {
        flash(r.error);
      }
    });
  };

  const removeTemplate = (t: TemplateRow) => {
    if (!window.confirm(`ひな形「${t.name}」を削除しますか？`)) return;
    start(async () => {
      const r = await deleteTemplate(t.id);
      if (r.ok) {
        flash(`ひな形「${t.name}」を削除しました`);
        router.refresh();
      } else {
        flash(r.error ?? '削除に失敗しました');
      }
    });
  };

  return (
    <div className="flex flex-col gap-4">
      {props.demo && (
        <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-warn">
          サンプルひな形を表示しています（データ未接続）。作成・編集・引用の操作は確認できますが保存はされません。
        </div>
      )}

      <Panel>
        <PanelHeader
          title="記載ひな形（テンプレート）"
          desc="共通／診療科／個人スコープのひな形を作成・編集・引用。同名は個人ひな形が優先表示されます（DOCTOR > DEPARTMENT > COMMON）。"
          icon={<Icon name="template" size={16} />}
          actions={
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-2xs text-muted">
                <input
                  type="checkbox"
                  checked={showAll}
                  onChange={(e) => setShowAll(e.target.checked)}
                />
                同名の重複も表示
              </label>
              <Button variant="primary" onClick={() => setEditor(toEditorState())}>
                <Icon name="plus" size={14} /> 新規ひな形
              </Button>
            </div>
          }
        />

        {grouped.length === 0 ? (
          <EmptyState
            title="ひな形がありません"
            hint="「新規ひな形」から個人ひな形を作成できます"
            icon={<Icon name="template" size={32} />}
          />
        ) : (
          <div className="flex flex-col gap-4">
            {grouped.map((g) => (
              <div key={g.scope}>
                <div className="mb-1.5 flex items-center gap-2">
                  <Badge tone={SCOPE_TONE[g.scope]}>{SCOPE_LABEL[g.scope]}</Badge>
                  <span className="text-2xs text-muted">{g.rows.length} 件</span>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {g.rows.map((t) => (
                    <div
                      key={t.id}
                      className="flex flex-col gap-2 rounded border border-line bg-white p-3 shadow-panel"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="truncate text-sm font-bold text-ink">{t.name}</span>
                            {t.preferred && (
                              <Badge tone="green" title="同名内で優先表示">
                                優先
                              </Badge>
                            )}
                            {t.mine && <Badge tone="green">自分</Badge>}
                            {t.conditional.length > 0 && (
                              <Badge tone="blue" title="条件分岐あり">
                                条件{t.conditional.length}
                              </Badge>
                            )}
                          </div>
                          <div className="mt-0.5 text-2xs text-muted">
                            {t.category}
                            {t.scope === 'DEPARTMENT' && deptName(t.departmentId)
                              ? ` ・ ${deptName(t.departmentId)}`
                              : ''}
                            {` ・ v${t.version}`}
                          </div>
                        </div>
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => openQuote(t)}
                          disabled={pending}
                          title="カルテへ1クリック引用"
                        >
                          <Icon name="chart" size={13} /> 引用
                        </Button>
                      </div>

                      <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded bg-soft px-2 py-1.5 text-2xs leading-relaxed text-ink">
                        {blocksToPlain(t.blocks) || '（内容なし）'}
                      </pre>

                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditor(toEditorState(t))}
                        >
                          <Icon name="edit" size={13} /> 編集
                        </Button>
                        {t.scope === 'DOCTOR' && t.mine && (
                          <Button size="sm" variant="danger" onClick={() => removeTemplate(t)}>
                            <Icon name="x" size={13} /> 削除
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      {/* ── 引用結果ダイアログ ── */}
      <Modal
        open={!!quote}
        onClose={() => setQuote(null)}
        title={quote ? `引用: ${quote.tpl.name}` : ''}
        width={520}
        footer={
          quote?.blocks ? (
            <>
              <Button variant="ghost" onClick={() => setQuote(null)}>
                閉じる
              </Button>
              <Button variant="secondary" onClick={copyQuote}>
                <Icon name="edit" size={14} /> コピー
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setQuote(null);
                  router.push('/patients/select');
                }}
              >
                <Icon name="chart" size={14} /> カルテで開く
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setQuote(null)}>
                キャンセル
              </Button>
              <Button variant="primary" onClick={runQuote} disabled={pending}>
                引用する
              </Button>
            </>
          )
        }
      >
        {quote && !quote.blocks && (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-muted">
              条件に回答すると、該当セクションのみがカルテへ流し込まれます。
            </p>
            {quote.tpl.conditional.map((c, i) => (
              <label
                key={`${c.target}-${c.when}-${i}`}
                className="flex items-center justify-between rounded border border-line px-3 py-2 text-sm"
              >
                <span>
                  {c.when}{' '}
                  <span className="text-2xs text-muted">
                    （該当なら【{c.target}】を{c.action === 'show' ? '表示' : '非表示'}）
                  </span>
                </span>
                <input
                  type="checkbox"
                  checked={!!quote.answers[c.when]}
                  onChange={(e) =>
                    setQuote({
                      ...quote,
                      answers: { ...quote.answers, [c.when]: e.target.checked },
                    })
                  }
                />
              </label>
            ))}
          </div>
        )}
        {quote?.blocks && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted">
              以下の内容を引用しました（TemplateInstance 記録済）。「カルテで開く」から患者を選んで流し込めます。
            </p>
            <pre className="whitespace-pre-wrap rounded border border-line bg-soft px-3 py-2 text-xs leading-relaxed text-ink">
              {blocksToPlain(quote.blocks) || '（表示対象セクションがありません）'}
            </pre>
          </div>
        )}
      </Modal>

      {/* ── 作成 / 編集エディタ ── */}
      <Modal
        open={!!editor}
        onClose={() => setEditor(null)}
        title={editor?.id ? 'ひな形を編集' : 'ひな形を作成'}
        width={640}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditor(null)}>
              キャンセル
            </Button>
            <Button variant="primary" onClick={saveEditor} disabled={pending}>
              {editor?.id ? '更新（版+1）' : '作成'}
            </Button>
          </>
        }
      >
        {editor && (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="ひな形名" required>
                <Input
                  value={editor.name}
                  onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                  placeholder="例: 高血圧 定期フォロー"
                />
              </Field>
              <Field label="カテゴリ">
                <Input
                  value={editor.category}
                  onChange={(e) => setEditor({ ...editor, category: e.target.value })}
                  placeholder="例: 生活習慣病"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="スコープ" hint="個人 > 診療科 > 共通 の順で優先表示されます">
                <Select
                  value={editor.scope}
                  disabled={!!editor.id}
                  onChange={(e) => setEditor({ ...editor, scope: e.target.value as Scope })}
                >
                  <option value="DOCTOR">個人（自分のみ）</option>
                  <option value="DEPARTMENT">診療科</option>
                  <option value="COMMON">共通</option>
                </Select>
              </Field>
              {editor.scope === 'DEPARTMENT' && (
                <Field label="診療科">
                  <Select
                    value={editor.departmentId}
                    onChange={(e) => setEditor({ ...editor, departmentId: e.target.value })}
                  >
                    <option value="">（全科共通）</option>
                    {props.departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-semibold text-ink">初期記載内容（SOAP）</span>
              {SOAP_KINDS.map((kind) => (
                <Field key={kind} label={SOAP_LABEL[kind] ?? kind}>
                  <Textarea
                    rows={2}
                    value={editor.texts[kind] ?? ''}
                    onChange={(e) =>
                      setEditor({
                        ...editor,
                        texts: { ...editor.texts, [kind]: e.target.value },
                      })
                    }
                    placeholder="差し込み箇所は全角空白（　）で表現できます"
                  />
                </Field>
              ))}
            </div>

            {/* 条件分岐 */}
            <div className="flex flex-col gap-2 rounded border border-line bg-soft/50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-ink">条件分岐（任意）</span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setEditor({
                      ...editor,
                      conditional: [
                        ...editor.conditional,
                        { target: 'P', when: '', action: 'show' },
                      ],
                    })
                  }
                >
                  <Icon name="plus" size={13} /> 条件を追加
                </Button>
              </div>
              <p className="text-2xs text-muted">
                引用時に「条件名」へ回答すると、対象セクションの表示/非表示を切り替えます。
              </p>
              {editor.conditional.length === 0 ? (
                <p className="py-1 text-center text-2xs text-muted/70">条件はありません</p>
              ) : (
                editor.conditional.map((c, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input
                      className="flex-1"
                      value={c.when}
                      placeholder="条件名（例: 要採血）"
                      onChange={(e) => {
                        const next = [...editor.conditional];
                        next[i] = { ...c, when: e.target.value };
                        setEditor({ ...editor, conditional: next });
                      }}
                    />
                    <Select
                      value={c.action}
                      className="w-24"
                      onChange={(e) => {
                        const next = [...editor.conditional];
                        next[i] = { ...c, action: e.target.value as 'show' | 'skip' };
                        setEditor({ ...editor, conditional: next });
                      }}
                    >
                      <option value="show">表示</option>
                      <option value="skip">非表示</option>
                    </Select>
                    <Select
                      value={c.target}
                      className="w-20"
                      onChange={(e) => {
                        const next = [...editor.conditional];
                        next[i] = { ...c, target: e.target.value };
                        setEditor({ ...editor, conditional: next });
                      }}
                    >
                      {SOAP_KINDS.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </Select>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setEditor({
                          ...editor,
                          conditional: editor.conditional.filter((_, j) => j !== i),
                        })
                      }
                      aria-label="条件を削除"
                    >
                      <Icon name="x" size={13} />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </Modal>

      {msg && (
        <p className="fixed bottom-4 right-4 z-[120] rounded bg-ink/85 px-3 py-1.5 text-xs text-white shadow-pop">
          {msg}
        </p>
      )}
    </div>
  );
}
