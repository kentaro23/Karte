'use client';
import * as React from 'react';

/** 帳票上部の操作（印刷/戻る）。印刷時は非表示。 */
export function PrintButton() {
  return (
    <div className="no-print mx-auto mb-3 flex w-[210mm] max-w-full items-center gap-2 px-2">
      <button
        onClick={() => window.print()}
        className="rounded bg-accent-500 px-4 py-1.5 text-sm font-bold text-white hover:bg-accent-600"
      >
        印刷（⌘P / Ctrl+P）
      </button>
      <button
        onClick={() => window.history.back()}
        className="rounded border border-line bg-white px-3 py-1.5 text-sm"
      >
        戻る
      </button>
      <span className="text-2xs text-muted">A4・余白自動。プレビューで体裁確認できます。</span>
    </div>
  );
}
