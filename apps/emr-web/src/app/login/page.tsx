'use client';
import { useActionState } from 'react';
import { MedixusLogo } from '@medixus/ui';
import { loginAction, type LoginState } from './actions';

function formatPrevLogin(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function LoginPage() {
  const [state, action, pending] = useActionState<LoginState | null, FormData>(
    loginAction,
    null,
  );
  const needTotp = state?.needTotp === true;
  const prevLogin = formatPrevLogin(state?.prevLoginAt);

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: '#f6f6f6',
      }}
    >
      <form
        action={action}
        style={{
          width: 380,
          background: '#fff',
          border: '1px solid #d7d7d7',
          borderRadius: 8,
          padding: 32,
        }}
      >
        <div style={{ marginBottom: 20 }}>
          <MedixusLogo height={34} />
        </div>

        {needTotp ? (
          <>
            <h1 style={{ fontSize: 18, margin: '0 0 4px' }}>二要素認証</h1>
            <p style={{ fontSize: 12, color: '#666', marginTop: 0 }}>
              認証アプリに表示された6桁のコードを入力してください
            </p>
            {/* Carry credentials so the server can re-run password + TOTP in one submit. */}
            <input type="hidden" name="loginId" value={state?.loginId ?? ''} />
            <input type="hidden" name="password" value={state?.password ?? ''} />
            <label style={lbl}>認証コード</label>
            <input
              name="totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              autoFocus
              required
              placeholder="123456"
              style={{ ...inp, letterSpacing: 6, textAlign: 'center', fontSize: 18 }}
            />
          </>
        ) : (
          <>
            <h1 style={{ fontSize: 18, margin: '0 0 4px' }}>電子カルテ ログイン</h1>
            <p style={{ fontSize: 12, color: '#666', marginTop: 0 }}>
              利用者ID・パスワードを入力してください
            </p>
            <label style={lbl}>利用者ID</label>
            <input name="loginId" autoComplete="username" required style={inp} />
            <label style={lbl}>パスワード</label>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              style={inp}
            />
          </>
        )}

        {prevLogin && (
          <p style={{ fontSize: 11, color: '#666', marginTop: 12 }}>
            前回ログイン: {prevLogin}
            {state?.prevTerminal ? `（${state.prevTerminal}）` : ''}
          </p>
        )}

        {state?.error && (
          <p
            style={{
              color: state.locked ? '#fff' : '#8a2b2b',
              background: state.locked ? '#8a2b2b' : 'transparent',
              fontSize: 13,
              fontWeight: state.locked ? 700 : 400,
              padding: state.locked ? '8px 10px' : 0,
              borderRadius: state.locked ? 4 : 0,
              marginTop: 12,
            }}
          >
            {state.locked ? '🔒 ' : ''}
            {state.error}
          </p>
        )}

        <button type="submit" disabled={pending || state?.locked} style={submit}>
          {pending ? '認証中…' : needTotp ? 'コードを確認' : 'ログイン'}
        </button>

        {!needTotp && (
          <p style={{ fontSize: 11, color: '#888', marginTop: 16 }}>
            デモ: <code>doctor</code> / <code>Medixus#2026</code>
          </p>
        )}
      </form>
    </main>
  );
}

const lbl: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 700,
  marginTop: 14,
  marginBottom: 4,
};
const inp: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid #d7d7d7',
  borderRadius: 4,
  fontSize: 14,
};
const submit: React.CSSProperties = {
  marginTop: 22,
  width: '100%',
  padding: '10px',
  background: '#0b5f37',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  fontWeight: 700,
  cursor: 'pointer',
};
