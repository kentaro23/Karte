import { PrismaClient } from '@prisma/client';
import { appendOnlyExtension, AppendOnlyViolation } from './append-only.js';
import { isDemoMode, makeDemoClient } from './demo.js';

const base = (): PrismaClient =>
  new PrismaClient({ log: process.env.PRISMA_LOG ? ['query', 'warn', 'error'] : ['warn', 'error'] });

const globalForPrisma = globalThis as unknown as {
  __medixusPrisma?: ReturnType<typeof makeClient>;
};

function makeClient() {
  return base().$extends(appendOnlyExtension());
}

// Frontend-only / demo mode: when `DATABASE_URL` is not set we hand out a
// Proxy that returns sample data so the EMR can render and every button is
// clickable without provisioning a database. The moment a real
// `DATABASE_URL` is configured the real PrismaClient is used.
export const prisma = isDemoMode
  ? (makeDemoClient() as unknown as ReturnType<typeof makeClient>)
  : (globalForPrisma.__medixusPrisma ?? makeClient());

if (!isDemoMode && process.env.NODE_ENV !== 'production') {
  globalForPrisma.__medixusPrisma = prisma;
}

export { AppendOnlyViolation, isDemoMode };
export * from '@prisma/client';
export type Db = typeof prisma;
