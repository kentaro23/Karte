import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { prisma } from '@medixus/db';
import { requireSession } from '@/lib/session';
import { AppChrome } from '@/components/app-chrome';
import { logoutAction, switchUserAction, unlockAction } from './_actions';

export default async function EmrLayout({ children }: { children: ReactNode }) {
  const s = await requireSession();
  const hdr = await headers();
  const [clinic, pendingRx, unapproved] = await Promise.all([
    prisma.clinic.findFirst({ select: { name: true } }),
    prisma.prescription.count({ where: { status: 'rule_checked' } }),
    prisma.countersign.count({ where: { status: 'UNAPPROVED' } }),
  ]);
  return (
    <AppChrome
      user={{ name: s.name, jobType: s.jobType }}
      clinicName={clinic?.name ?? 'Medixus Clinic'}
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
