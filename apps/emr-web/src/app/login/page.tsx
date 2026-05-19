'use client';
import { useActionState } from 'react';
import { MedixusLogo } from '@medixus/ui';
import { loginAction } from './actions';

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, null as { error?: string } | null);
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
        <h1 style={{ fontSize: 18, margin: '0 0 4px' }}>電子カルテ ログイン</h1>
        <p style={{ fontSize: 12, color: '#666', marginTop: 0 }}>
          利用者ID・パスワードを入力してください
        </p>
        <label style={lbl}>利用者ID</label>
        <input name="loginId" autoComplete="username" required style={inp} />
        <label style={lbl}>パスワード</label>
        <input name="password" type="password" autoComplete="current-password" required style={inp} />
        {state?.error && (
          <p style={{ color: '#8a2b2b', fontSize: 13, marginTop: 12 }}>{state.error}</p>
        )}
        <button type="submit" disabled={pending} style={submit}>
          {pending ? '認証中…' : 'ログイン'}
        </button>
        <p style={{ fontSize: 11, color: '#888', marginTop: 16 }}>
          デモ: <code>doctor</code> / <code>Medixus#2026</code>
        </p>
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
