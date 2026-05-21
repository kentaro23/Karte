import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { prisma } from '@medixus/db';
import { requireSession } from '@/lib/session';
import { AppChrome } from '@/components/app-chrome';
import { logoutAction, switchUserAction, unlockAction } from './_actions';

// All EMR routes touch the database via this layout and per-page Prisma
// calls; skip Next.js's static-discovery render so the build does not need
// a live DATABASE_URL. Runtime behaviour (cookies/headers based session)
// already forces dynamic rendering; this declaration just makes it explicit
// so Vercel builds succeed without DB connectivity.
export const dynamic = 'force-dynamic';

export default async function EmrLayout({ children }: { children: ReactNode }) {
  const s = await requireSession();
  const hdr = await headers();
  // Header notification counts are non-critical: if the DB is unreachable
  // we still want the page chrome to render so the user can navigate to
  // /login or read the error page rather than seeing a generic 500.
  let clinicName = 'Medixus Clinic';
  let pendingRx = 0;
  let unapproved = 0;
  try {
    const [clinic, pendingRxN, unapprovedN] = await Promise.all([
      prisma.clinic.findFirst({ select: { name: true } }),
      prisma.prescription.count({ where: { status: 'rule_checked' } }),
      prisma.countersign.count({ where: { status: 'UNAPPROVED' } }),
    ]);
    if (clinic?.name) clinicName = clinic.name;
    pendingRx = pendingRxN;
    unapproved = unapprovedN;
  } catch (err) {
    console.error('[EmrLayout] DB notification fetch failed:', err);
  }
  return (
    <AppChrome
      user={{ name: s.name, jobType: s.jobType }}
      clinicName={clinicName}
      terminalId={hdr.get('x-terminal-id') ?? 'web-01'}
      notifications={pendingRx + unapproved}
      logoutAction={logoutAction}
      switchUserAction={switchUserAction}
      unlockAction={unlockAction}
    >
      {children}
    </AppChrome>
  );
}
