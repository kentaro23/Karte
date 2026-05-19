import { PrismaClient } from '@prisma/client';
import { appendOnlyExtension, AppendOnlyViolation } from './append-only.js';

const base = (): PrismaClient =>
  new PrismaClient({ log: process.env.PRISMA_LOG ? ['query', 'warn', 'error'] : ['warn', 'error'] });

const globalForPrisma = globalThis as unknown as {
  __medixusPrisma?: ReturnType<typeof makeClient>;
};

function makeClient() {
  return base().$extends(appendOnlyExtension());
}

export const prisma = globalForPrisma.__medixusPrisma ?? makeClient();
if (process.env.NODE_ENV !== 'production') globalForPrisma.__medixusPrisma = prisma;

export { AppendOnlyViolation };
export * from '@prisma/client';
export type Db = typeof prisma;
