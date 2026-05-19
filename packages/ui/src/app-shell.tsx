'use client';
import * as React from 'react';
import { cn } from './cn.js';
import { Icon, type IconName } from './icon.js';

/* ── live clock ─────────────────────────────────────────────────────────── */
export function Clock() {
  const [now, setNow] = React.useState<Date | null>(null);
  React.useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!now) return <span className="tabular-nums text-xs text-white/80">--:--:--</span>;
  const d = now;
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return (
    <span className="tabular-nums text-xs text-white/90">
      {d.getFullYear()}/{`${d.getMonth() + 1}`.padStart(2, '0')}/
      {`${d.getDate()}`.padStart(2, '0')}（{w}）{`${d.getHours()}`.padStart(2, '0')}:
      {`${d.getMinutes()}`.padStart(2, '0')}:{`${d.getSeconds()}`.padStart(2, '0')}
    </span>
  );
}

/* ── top bar ────────────────────────────────────────────────────────────── */
export function TopBar({
  logo,
  user,
  notifications = 0,
  onLock,
  onSwitchUser,
  onLogout,
  onSearch,
}: {
  logo: React.ReactNode;
  user: { name: string; jobType: string };
  notifications?: number;
  onLock?: () => void;
  onSwitchUser?: () => void;
  onLogout?: () => void;
  onSearch?: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-4 bg-accent-700 px-4 text-white">
      <div className="flex items-center gap-2">{logo}</div>
      <button
        onClick={onSearch}
        className="ml-2 flex w-72 items-center gap-2 rounded bg-white/10 px-3 py-1.5 text-xs text-white/70 hover:bg-white/15"
      >
        <Icon name="search" size={14} />
        患者検索（ID・カナ・氏名）
        <span className="ml-auto rounded bg-white/15 px-1.5 py-0.5 text-2xs">⌘K</span>
      </button>
      <div className="flex-1" />
      <Clock />
      <button
        onClick={onLock}
        title="画面ロック（離席時）"
        className="rounded p-1.5 text-white/80 hover:bg-white/10 hover:text-white"
      >
        <Icon name="lock" size={16} />
      </button>
      <div className="relative">
        <Icon name="bell" size={16} className="text-white/80" />
        {notifications > 0 && (
          <span className="absolute -right-1.5 -top-1.5 rounded-full bg-amber-400 px-1 text-2xs font-bold text-ink">
            {notifications}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 border-l border-white/20 pl-3 text-xs">
        <Icon name="users" size={15} className="text-white/70" />
        <span className="font-semibold">{user.name}</span>
        <span className="text-white/60">{user.jobType}</span>
        {onSwitchUser && (
          <button onClick={onSwitchUser} title="利用者変更（ログオフせず）" className="ml-1 text-white/70 hover:text-white">
            <Icon name="switch" size={15} />
          </button>
        )}
        {onLogout && (
          <button onClick={onLogout} title="ログアウト" className="text-white/70 hover:text-white">
            <Icon name="logout" size={15} />
          </button>
        )}
      </div>
    </header>
  );
}

/* ── module rail ────────────────────────────────────────────────────────── */
export interface NavItem {
  key: string;
  label: string;
  icon: IconName;
  href: string;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}
export interface RailLinkProps {
  href: string;
  className?: string;
  title?: string;
  children: React.ReactNode;
}

export function ModuleRail({
  groups,
  pathname,
  Link = ((p: any) => <a {...p} />) as React.ComponentType<RailLinkProps>,
  collapsed,
  onToggle,
}: {
  groups: NavGroup[];
  pathname: string;
  Link?: React.ComponentType<RailLinkProps>;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <nav
      className={cn(
        'flex shrink-0 flex-col overflow-y-auto border-r border-line bg-white transition-all',
        collapsed ? 'w-[58px]' : 'w-[208px]',
      )}
    >
      <div className="flex-1 py-2">
        {groups.map((g) => (
          <div key={g.label} className="mb-1.5">
            {!collapsed && (
              <div className="px-3 pb-1 pt-2 text-2xs font-bold uppercase tracking-wider text-muted/70">
                {g.label}
              </div>
            )}
            {g.items.map((it) => {
              const active = pathname === it.href || pathname.startsWith(it.href + '/');
              return (
                <Link
                  key={it.key}
                  href={it.href}
                  className={cn(
                    'mx-1.5 my-0.5 flex items-center gap-2.5 rounded px-2.5 py-2 text-sm transition-colors',
                    collapsed && 'justify-center',
                    active
                      ? 'bg-accent-50 font-semibold text-accent-700'
                      : 'text-ink/80 hover:bg-soft',
                  )}
                  title={collapsed ? it.label : undefined}
                >
                  <Icon name={it.icon} size={17} className={active ? 'text-accent-600' : 'text-muted'} />
                  {!collapsed && <span className="truncate">{it.label}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
      {onToggle && (
        <button
          onClick={onToggle}
          className="flex items-center justify-center border-t border-line py-2 text-muted hover:bg-soft"
          title={collapsed ? '展開' : '折りたたむ'}
        >
          <Icon name="chevron" size={16} className={collapsed ? '' : 'rotate-180'} />
        </button>
      )}
    </nav>
  );
}

/* ── status bar ─────────────────────────────────────────────────────────── */
export function StatusBar({
  left,
  center,
  right,
}: {
  left?: React.ReactNode;
  center?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-line bg-soft px-3 text-2xs text-muted">
      <div className="flex items-center gap-3">{left}</div>
      <div className="flex items-center gap-3">{center}</div>
      <div className="flex items-center gap-3">{right}</div>
    </footer>
  );
}

/* ── shell wrapper ──────────────────────────────────────────────────────── */
export function AppShell({
  top,
  rail,
  status,
  children,
}: {
  top: React.ReactNode;
  rail: React.ReactNode;
  status?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      {top}
      <div className="flex min-h-0 flex-1">
        {rail}
        <main className="min-w-0 flex-1 overflow-auto">{children}</main>
      </div>
      {status}
    </div>
  );
}

/* ── screensaver lock overlay ───────────────────────────────────────────── */
export function ScreensaverOverlay({
  userName,
  onUnlock,
}: {
  userName: string;
  onUnlock: (password: string) => Promise<boolean> | boolean;
}) {
  const [pw, setPw] = React.useState('');
  const [err, setErr] = React.useState(false);
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-accent-900/95 text-white">
      <div className="w-80 text-center">
        <Icon name="lock" size={40} className="mx-auto mb-3 text-white/80" />
        <p className="text-sm">画面ロック中</p>
        <p className="mb-4 text-xs text-white/70">{userName} が使用中 — 正式な手順で解除してください</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await onUnlock(pw);
            if (!ok) setErr(true);
          }}
        >
          <input
            type="password"
            autoFocus
            value={pw}
            onChange={(e) => {
              setPw(e.target.value);
              setErr(false);
            }}
            placeholder="パスワード"
            className="w-full rounded border border-white/30 bg-white/10 px-3 py-2 text-sm text-white outline-none placeholder:text-white/40"
          />
          {err && <p className="mt-2 text-xs text-amber-300">解除できませんでした</p>}
          <button className="mt-3 w-full rounded bg-white py-2 text-sm font-bold text-accent-700">
            解除
          </button>
        </form>
      </div>
    </div>
  );
}
