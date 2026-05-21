'use client';

/**
 * EMR ルートグループのエラーバウンダリ。
 * サーバ側で投げられた例外を捕捉し、原因の手掛かりとともに復旧導線を表示する。
 * （Next.js は本番ではエラー本文を redact するため digest だけ見える）
 */
export default function EmrError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main
      style={{
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
          Medixus カルテで問題が発生しました
        </h1>
        <p style={{ fontSize: 14, color: '#374151', margin: '0 0 16px', lineHeight: 1.7 }}>
          サーバ側の処理が中断されました。最も多い原因は <strong>DATABASE_URL の未設定</strong>、
          または <strong>DB スキーマ未適用</strong>です。
          Vercel プロジェクトの環境変数を確認し、初回は{' '}
          <code style={{ background: '#f3f4f6', padding: '0 4px', borderRadius: 4 }}>
            pnpm db:migrate &amp;&amp; pnpm db:triggers &amp;&amp; pnpm seed
          </code>{' '}
          を実行してください。
        </p>
        {error.digest && (
          <p style={{ fontSize: 12, color: '#6b7280', margin: '0 0 16px' }}>
            エラー識別子: <code>{error.digest}</code>（Vercel の Function Logs で同 ID を検索すると詳細が表示されます）
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
        </div>
      </div>
    </main>
  );
}
