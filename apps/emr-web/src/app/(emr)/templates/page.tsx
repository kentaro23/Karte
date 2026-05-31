import { PageBody, PageHeader } from '@/components/page';
import { listTemplates } from './actions';
import { TemplateEditorClient } from './editor-client';

/**
 * FR-CHT-03 記載ひな形（テンプレート）エディタ。
 * 共通／診療科／個人スコープのひな形を作成・編集し、カルテへ1クリック引用する。
 * データ取得は listTemplates 側で fail-soft（DB 未接続でもサンプル表示）。
 */
export default async function TemplatesPage() {
  let templates: Awaited<ReturnType<typeof listTemplates>>['templates'] = [];
  let departments: Awaited<ReturnType<typeof listTemplates>>['departments'] = [];
  let demo = true;
  try {
    const res = await listTemplates();
    templates = res.templates;
    departments = res.departments;
    demo = res.demo;
  } catch (err) {
    console.error('[TemplatesPage] listTemplates failed:', err);
  }

  return (
    <PageBody>
      <PageHeader
        title="記載ひな形（テンプレート）"
        desc="診療科/医師/共通スコープのひな形を作成・編集・引用。条件分岐・初期コンテンツ対応（174項 18 / FR-CHT-03）"
        crumbs={['Medixus カルテ', '診療', 'テンプレート']}
      />
      <TemplateEditorClient templates={templates} departments={departments} demo={demo} />
    </PageBody>
  );
}
