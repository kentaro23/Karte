'use client';

/**
 * 全アプリ共通のエラーバウンダリ。root layout を含む全レイヤーの例外を捕捉。
 * (emr)/error.tsx より広い範囲をカバーする最終防壁。
 * Next.js は global-error の場合に独自 <html> を提供する必要があるため html/body を含める。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ja">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          background: '#f7f8fa',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          fontFamily: 'system-ui, -apple-system, "Helvetica Neue", sans-serif',
        }}
      >
        <div
          style={{
            width: 'min(560px, 100%)',
            background: '#fff',
            border: '1px solid #e5e7eb',
            borderRadius: 12,
            padding: 24,
            boxShadow: '0 4px 16px rgba(0,0,0,0.04)',
          }}
        >
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>
            Medixus カルテ — サーバエラー
          </h1>
          <p style={{ fontSize: 14, color: '#374151', margin: '0 0 16px', lineHeight: 1.7 }}>
            予期せぬエラーが発生しました。原因の切り分けには{' '}
            <a
              href="/api/diag"
              style={{ color: '#0b5f37', textDecoration: 'underline' }}
            >
              /api/diag
            </a>{' '}
            にアクセスしてください（DATABASE_URL 設定状況・DB 接続・スキーマ有無を JSON で返します）。
          </p>
          {error.digest && (
            <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 16px' }}>
              エラー識別子: <code>{error.digest}</code>
            </p>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={reset}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                background: '#fff',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              再試行
            </button>
            <a
              href="/login"
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                border: 'none',
                background: '#0b5f37',
                color: '#fff',
                textDecoration: 'none',
                fontSize: 14,
              }}
            >
              ログイン画面へ
            </a>
            <a
              href="/api/diag"
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                background: '#fff',
                color: '#374151',
                textDecoration: 'none',
                fontSize: 14,
              }}
            >
              診断 (/api/diag)
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
