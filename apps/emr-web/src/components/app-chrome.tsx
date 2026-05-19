'use client';
import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  AppShell,
  TopBar,
  ModuleRail,
  StatusBar,
  MedixusLogo,
  ScreensaverOverlay,
  Modal,
  Field,
  Input,
  Button,
  type RailLinkProps,
} from '@medixus/ui';
import { NAV } from '@/lib/nav';

const NextLink = ({ href, className, title, children }: RailLinkProps) => (
  <Link href={href} className={className} title={title}>
    {children}
  </Link>
);

const IDLE_MS = 5 * 60 * 1000;

export function AppChrome({
  user,
  clinicName,
  terminalId,
  notifications,
  children,
  logoutAction,
  switchUserAction,
  unlockAction,
}: {
  user: { name: string; jobType: string };
  clinicName: string;
  terminalId: string;
  notifications: number;
  children: React.ReactNode;
  logoutAction: () => Promise<void>;
  switchUserAction: (prev: unknown, fd: FormData) => Promise<{ error?: string } | void>;
  unlockAction: (password: string) => Promise<boolean>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = React.useState(false);
  const [locked, setLocked] = React.useState(false);
  const [showSwitch, setShowSwitch] = React.useState(false);
  const [switchErr, setSwitchErr] = React.useState<string | null>(null);

  // idle → screensaver lock (別紙3 #15-21)
  React.useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      if (!locked) timer = setTimeout(() => setLocked(true), IDLE_MS);
    };
    const evts = ['mousemove', 'keydown', 'click', 'scroll'] as const;
    evts.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      evts.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [locked]);

  // ⌘K / Ctrl+K global patient search
  React.useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        router.push('/patients/select?tab=kana');
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [router]);

  return (
    <>
      <AppShell
        top={
          <TopBar
            logo={<MedixusLogo height={24} />}
            user={user}
            notifications={notifications}
            onLock={() => setLocked(true)}
            onSwitchUser={() => setShowSwitch(true)}
            onLogout={() => logoutAction()}
            onSearch={() => router.push('/patients/select?tab=kana')}
          />
        }
        rail={
          <ModuleRail
            groups={NAV}
            pathname={pathname}
            Link={NextLink}
            collapsed={collapsed}
            onToggle={() => setCollapsed((c) => !c)}
          />
        }
        status={
          <StatusBar
            left={
              <>
                <span>{clinicName}</span>
                <span>端末: {terminalId}</span>
              </>
            }
            center={<span>Medixus カルテ — 電子保存の三原則準拠（真正性・見読性・保存性）</span>}
            right={
              <>
                <span>{user.name}（{user.jobType}）</span>
                <span>v0.1 Phase 1</span>
              </>
            }
          />
        }
      >
        {children}
      </AppShell>

      {locked && (
        <ScreensaverOverlay
          userName={user.name}
          onUnlock={async (pw) => {
            const ok = await unlockAction(pw);
            if (ok) setLocked(false);
            return ok;
          }}
        />
      )}

      <SwitchUserModal
        open={showSwitch}
        onClose={() => setShowSwitch(false)}
        action={switchUserAction}
        err={switchErr}
        setErr={setSwitchErr}
      />
    </>
  );
}

function SwitchUserModal({
  open,
  onClose,
  action,
  err,
  setErr,
}: {
  open: boolean;
  onClose: () => void;
  action: (prev: unknown, fd: FormData) => Promise<{ error?: string } | void>;
  err: string | null;
  setErr: (s: string | null) => void;
}) {
  const [pending, start] = React.useTransition();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="利用者変更（ログオフせず切替）"
      width={400}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            const r = await action(null, fd);
            if (r && 'error' in r && r.error) setErr(r.error);
          });
        }}
        className="flex flex-col gap-3"
      >
        <p className="text-xs text-muted">
          現在開いているカルテを閉じずに、別の利用者でカルテ記載できます（別紙3 #73）。
        </p>
        <Field label="利用者ID" required>
          <Input name="loginId" autoComplete="username" required />
        </Field>
        <Field label="パスワード" required>
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        {err && <p className="text-xs text-alert">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            キャンセル
          </Button>
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? '認証中…' : '切替'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
