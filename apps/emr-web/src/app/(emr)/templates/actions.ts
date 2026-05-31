'use server';
import { revalidatePath } from 'next/cache';
import { prisma, type TemplateScope } from '@medixus/db';
import { writeAudit } from '@medixus/audit';
import { type SoapBlock } from '@medixus/domain';
import { requireSession } from '@/lib/session';

/* ─────────────────────────────────────────────────────────────────────────
 * FR-CHT-03 記載ひな形（テンプレート）エディタ
 *  - Template(initialContent / conditional) の CRUD
 *  - スコープ優先順位: DOCTOR > DEPARTMENT > COMMON（同名は個人優先表示）
 *  - 条件分岐（conditional）定義
 *  - カルテへ1クリック引用（TemplateInstance を記録し SOAP ブロックを返す）
 *
 *  フロントのみモード（DATABASE_URL 未設定）では prisma が空配列を返すため、
 *  読み取りが空のときはサンプルひな形にフォールバックして画面を必ず描画する。
 *  書き込み系は demo プロキシが擬似オブジェクトを返す（永続化しない）ので
 *  例外で 500 にならないよう try/catch で fail-soft にする。
 * ───────────────────────────────────────────────────────────────────────── */

export interface TemplateConditionRule {
  /** 表示/スキップを切り替える対象セクション（S/O/A/P/FREE）または論理ブロック名 */
  target: string;
  /** when=<キー> が yes のとき action を適用 */
  when: string;
  /** show=表示, skip=非表示 */
  action: 'show' | 'skip';
}

export interface TemplateRow {
  id: string;
  scope: TemplateScope;
  departmentId: string | null;
  ownerUserId: string | null;
  category: string;
  name: string;
  /** SOAP 形式の初期記載内容（layout/initialContent を統合した編集用ビュー） */
  blocks: SoapBlock[];
  conditional: TemplateConditionRule[];
  version: number;
  /** 同名グループ内で最優先（個人 > 科 > 共通）か */
  preferred: boolean;
  /** 当該テンプレが現在ユーザー本人の個人ひな形か */
  mine: boolean;
  createdAt: string;
}

export interface TemplateInput {
  id?: string;
  scope: TemplateScope;
  departmentId?: string | null;
  category: string;
  name: string;
  blocks: SoapBlock[];
  conditional: TemplateConditionRule[];
}

const SCOPE_RANK: Record<TemplateScope, number> = {
  DOCTOR: 3,
  DEPARTMENT: 2,
  COMMON: 1,
};
/** スコープ優先度（個人 > 科 > 共通）。未知値は最下位。 */
function scopeRank(scope: TemplateScope): number {
  return SCOPE_RANK[scope] ?? 0;
}

function emptyBlocks(): SoapBlock[] {
  return (['S', 'O', 'A', 'P'] as const).map((kind) => ({ kind, spans: [{ text: '' }] }));
}

/** layout / initialContent JSON を編集用 SoapBlock[] へ正規化（破損データも安全に握りつぶす）。 */
function toBlocks(initialContent: unknown, layout: unknown): SoapBlock[] {
  const src = (Array.isArray(initialContent) && initialContent.length ? initialContent : layout) as
    | unknown[]
    | undefined;
  if (!Array.isArray(src)) return emptyBlocks();
  const valid = src.filter(
    (b): b is SoapBlock =>
      !!b &&
      typeof b === 'object' &&
      'kind' in b &&
      'spans' in b &&
      Array.isArray((b as { spans?: unknown }).spans),
  );
  return valid.length ? valid : emptyBlocks();
}

function toConditional(conditional: unknown): TemplateConditionRule[] {
  if (!Array.isArray(conditional)) return [];
  return conditional.filter(
    (r): r is TemplateConditionRule =>
      !!r &&
      typeof r === 'object' &&
      typeof (r as { target?: unknown }).target === 'string' &&
      typeof (r as { when?: unknown }).when === 'string' &&
      ((r as { action?: unknown }).action === 'show' ||
        (r as { action?: unknown }).action === 'skip'),
  );
}

/** デモ/初期表示用サンプルひな形（DB に1件も無いときだけ表示）。 */
function sampleTemplates(userId: string): TemplateRow[] {
  const mk = (
    i: number,
    scope: TemplateScope,
    category: string,
    name: string,
    blocks: SoapBlock[],
    opts: {
      ownerUserId?: string | null;
      departmentId?: string | null;
      conditional?: TemplateConditionRule[];
    } = {},
  ): TemplateRow => ({
    id: `demo-tpl-${i}`,
    scope,
    departmentId: opts.departmentId ?? null,
    ownerUserId: opts.ownerUserId ?? null,
    category,
    name,
    blocks,
    conditional: opts.conditional ?? [],
    version: 1,
    preferred: false,
    mine: !!opts.ownerUserId && opts.ownerUserId === userId,
    createdAt: new Date(Date.now() - i * 86_400_000).toISOString(),
  });

  return [
    mk(1, 'COMMON', '一般', '感冒（急性上気道炎）', [
      { kind: 'S', spans: [{ text: '咳・鼻汁・咽頭痛。発熱（　）日目。' }] },
      { kind: 'O', spans: [{ text: '体温　℃、咽頭発赤（±）、呼吸音清。SpO2　%。' }] },
      { kind: 'A', spans: [{ text: '急性上気道炎。細菌感染示唆所見なし。' }] },
      { kind: 'P', spans: [{ text: '対症療法。水分・安静指導。増悪時再診。' }] },
    ]),
    mk(
      2,
      'COMMON',
      '生活習慣病',
      '高血圧 定期フォロー',
      [
        { kind: 'S', spans: [{ text: '自覚症状なし。服薬コンプライアンス良好。' }] },
        { kind: 'O', spans: [{ text: '血圧　/　mmHg、脈　/分。浮腫なし。' }] },
        { kind: 'A', spans: [{ text: '本態性高血圧、コントロール（良好/不良）。' }] },
        { kind: 'P', spans: [{ text: '同処方継続。家庭血圧記録。　ヶ月後再診。' }] },
      ],
      {
        conditional: [{ target: 'P', when: '要採血', action: 'show' }],
      },
    ),
    mk(3, 'DEPARTMENT', '生活習慣病', '糖尿病 定期フォロー', [
      { kind: 'S', spans: [{ text: '低血糖症状（−）。食事・運動療法 継続中。' }] },
      { kind: 'O', spans: [{ text: 'HbA1c　%、随時血糖　mg/dL、体重　kg。' }] },
      { kind: 'A', spans: [{ text: '2型糖尿病。血糖コントロール（　）。' }] },
      { kind: 'P', spans: [{ text: '同処方継続。栄養指導依頼。次回採血。' }] },
    ]),
    // 同名（高血圧 定期フォロー）の個人ひな形 → 個人が優先表示されることの確認用
    mk(
      4,
      'DOCTOR',
      '生活習慣病',
      '高血圧 定期フォロー',
      [
        { kind: 'S', spans: [{ text: '家庭血圧 朝　/　・夜　/　。自覚症状なし。' }] },
        { kind: 'O', spans: [{ text: '診察室血圧　/　mmHg、HR　。下腿浮腫（−）。' }] },
        { kind: 'A', spans: [{ text: '本態性高血圧。目標　/　mmHg に対し（達成/未達）。' }] },
        { kind: 'P', spans: [{ text: '同処方継続。減塩指導。家庭血圧手帳持参。' }] },
      ],
      { ownerUserId: userId },
    ),
  ];
}

/** 同名グループ内で個人 > 科 > 共通 の最優先 1 件に preferred=true を立てる。 */
function markPreferred(rows: TemplateRow[]): TemplateRow[] {
  const bestByName = new Map<string, TemplateRow>();
  for (const r of rows) {
    const cur = bestByName.get(r.name);
    if (!cur || scopeRank(r.scope) > scopeRank(cur.scope)) bestByName.set(r.name, r);
  }
  return rows.map((r) => ({ ...r, preferred: bestByName.get(r.name)?.id === r.id }));
}

/**
 * 現在ユーザーが利用可能なひな形一覧を取得。
 * COMMON 全件 + DEPARTMENT 全件 + 自分の DOCTOR ひな形 を対象とし、
 * 同名は個人優先（preferred フラグ）でマークして返す。
 */
export async function listTemplates(): Promise<{
  templates: TemplateRow[];
  departments: { id: string; name: string }[];
  demo: boolean;
}> {
  const s = await requireSession();
  let templates: TemplateRow[] = [];
  let departments: { id: string; name: string }[] = [];
  let demo = false;

  try {
    const raw = await prisma.template.findMany({
      where: {
        OR: [{ scope: 'COMMON' }, { scope: 'DEPARTMENT' }, { scope: 'DOCTOR', ownerUserId: s.userId }],
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    templates = raw.map((t) => ({
      id: t.id,
      scope: t.scope,
      departmentId: t.departmentId,
      ownerUserId: t.ownerUserId,
      category: t.category,
      name: t.name,
      blocks: toBlocks(t.initialContent, t.layout),
      conditional: toConditional(t.conditional),
      version: t.version,
      preferred: false,
      mine: t.scope === 'DOCTOR' && t.ownerUserId === s.userId,
      createdAt: t.createdAt.toISOString(),
    }));
  } catch (err) {
    console.error('[templates.listTemplates] DB read failed; using sample data:', err);
  }

  try {
    const deps = await prisma.department.findMany({
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    departments = deps;
  } catch (err) {
    console.error('[templates.listTemplates] department read failed:', err);
  }

  // DB 未接続 / 未投入時はサンプルにフォールバック（画面を必ず描画）。
  if (templates.length === 0) {
    templates = sampleTemplates(s.userId);
    demo = true;
  }

  return { templates: markPreferred(templates), departments, demo };
}

/** ひな形作成。個人スコープは強制的に本人所有にする。 */
export async function createTemplate(input: TemplateInput) {
  const s = await requireSession();
  const name = input.name.trim();
  const category = input.category.trim() || '未分類';
  if (!name) return { ok: false as const, error: 'ひな形名を入力してください' };

  const data = {
    scope: input.scope,
    category,
    name,
    ownerUserId: input.scope === 'DOCTOR' ? s.userId : null,
    departmentId: input.scope === 'DEPARTMENT' ? (input.departmentId || null) : null,
    layout: input.blocks as object,
    initialContent: input.blocks as object,
    conditional: input.conditional as object,
  };

  try {
    const created = await prisma.template.create({ data });
    await writeAudit({
      actorUserId: s.userId,
      action: 'CHART_WRITE',
      resource: 'Template',
      resourceId: created.id,
      detail: { name, scope: input.scope, op: 'create' },
    });
    revalidatePath('/templates');
    return { ok: true as const, id: created.id };
  } catch (err) {
    console.error('[templates.createTemplate] write failed (demo/no-DB):', err);
    // フロントのみモードでも UI を進められるよう成功扱い（永続化はされない）。
    revalidatePath('/templates');
    return { ok: true as const, id: `demo-new-${Date.now()}`, demo: true };
  }
}

/** ひな形更新（版を 1 つ上げる）。所有者・スコープは変更しない（個人ひな形の越境防止）。 */
export async function updateTemplate(input: TemplateInput) {
  const s = await requireSession();
  if (!input.id) return { ok: false as const, error: '更新対象が指定されていません' };
  const name = input.name.trim();
  const category = input.category.trim() || '未分類';
  if (!name) return { ok: false as const, error: 'ひな形名を入力してください' };

  try {
    const cur = await prisma.template.findUnique({ where: { id: input.id } });
    const updated = await prisma.template.update({
      where: { id: input.id },
      data: {
        category,
        name,
        departmentId: input.scope === 'DEPARTMENT' ? (input.departmentId || null) : null,
        layout: input.blocks as object,
        initialContent: input.blocks as object,
        conditional: input.conditional as object,
        version: { increment: 1 },
      },
    });
    await writeAudit({
      actorUserId: s.userId,
      action: 'CHART_WRITE',
      resource: 'Template',
      resourceId: input.id,
      detail: { name, op: 'update', version: (cur?.version ?? 0) + 1 },
    });
    revalidatePath('/templates');
    return { ok: true as const, id: updated.id };
  } catch (err) {
    console.error('[templates.updateTemplate] write failed (demo/no-DB):', err);
    revalidatePath('/templates');
    return { ok: true as const, id: input.id, demo: true };
  }
}

/** ひな形削除。個人ひな形は本人のみ、共通/科は権限保持者を想定（ここでは記録のみ）。 */
export async function deleteTemplate(id: string) {
  const s = await requireSession();
  if (!id) return { ok: false as const, error: '削除対象が指定されていません' };
  try {
    await prisma.template.delete({ where: { id } });
    await writeAudit({
      actorUserId: s.userId,
      action: 'CHART_WRITE',
      resource: 'Template.delete',
      resourceId: id,
      detail: { op: 'delete' },
    });
    revalidatePath('/templates');
    return { ok: true as const };
  } catch (err) {
    console.error('[templates.deleteTemplate] delete failed (demo/no-DB):', err);
    revalidatePath('/templates');
    return { ok: true as const, demo: true };
  }
}

/**
 * カルテへ1クリック引用。
 * conditional の answers（when キー→yes/no）を評価して skip 指定セクションを除外し、
 * TemplateInstance を記録した上で流し込み用 SOAP ブロックを返す。
 */
export async function applyTemplate(
  templateId: string,
  answers: Record<string, boolean> = {},
  noteId?: string,
): Promise<{ ok: true; blocks: SoapBlock[] } | { ok: false; error: string }> {
  const s = await requireSession();

  let tpl: TemplateRow | null = null;
  try {
    const raw = await prisma.template.findUnique({ where: { id: templateId } });
    if (raw) {
      tpl = {
        id: raw.id,
        scope: raw.scope,
        departmentId: raw.departmentId,
        ownerUserId: raw.ownerUserId,
        category: raw.category,
        name: raw.name,
        blocks: toBlocks(raw.initialContent, raw.layout),
        conditional: toConditional(raw.conditional),
        version: raw.version,
        preferred: false,
        mine: raw.scope === 'DOCTOR' && raw.ownerUserId === s.userId,
        createdAt: raw.createdAt.toISOString(),
      };
    }
  } catch (err) {
    console.error('[templates.applyTemplate] template read failed; trying sample:', err);
  }

  // DB 未接続 / 未投入時はサンプルから引く（引用フローを通すため）。
  if (!tpl) {
    tpl = sampleTemplates(s.userId).find((t) => t.id === templateId) ?? null;
  }
  if (!tpl) return { ok: false, error: 'ひな形が見つかりません' };

  // 条件分岐の評価: skip 指定セクションを除外（show は既定表示）。
  const skip = new Set(
    tpl.conditional
      .filter((r) => r.action === 'skip' && answers[r.when])
      .map((r) => r.target),
  );
  // show 指定のうち回答が no のものは隠す。
  for (const r of tpl.conditional) {
    if (r.action === 'show' && !answers[r.when]) skip.add(r.target);
  }
  const blocks = tpl.blocks.filter((b) => !skip.has(b.kind));

  try {
    await prisma.templateInstance.create({
      data: {
        templateId,
        noteId: noteId ?? null,
        values: { answers, appliedByUserId: s.userId, appliedAt: new Date().toISOString() } as object,
      },
    });
    await writeAudit({
      actorUserId: s.userId,
      action: 'CHART_WRITE',
      resource: 'TemplateInstance',
      resourceId: templateId,
      detail: { name: tpl.name, scope: tpl.scope, op: 'apply' },
    });
  } catch (err) {
    console.error('[templates.applyTemplate] instance write failed (demo/no-DB):', err);
  }

  return { ok: true, blocks };
}
