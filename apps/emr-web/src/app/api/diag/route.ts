import { NextResponse } from 'next/server';
import { prisma } from '@medixus/db';

/**
 * 本番運用の自己診断 — `/api/diag` で叩く。
 * 機密データを返さないが、構成ミス（DATABASE_URL 未設定 / DB 未到達 / スキーマ未適用）の
 * 切り分けに必要な情報だけ返す。サーバ側エラーの digest を追えない時の代替手段。
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const result: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    node: process.version,
    env: {
      NODE_ENV: process.env.NODE_ENV ?? null,
      DATABASE_URL_set: Boolean(process.env.DATABASE_URL),
      AUTH_SECRET_set: Boolean(process.env.AUTH_SECRET),
      VERCEL: process.env.VERCEL ?? null,
      VERCEL_ENV: process.env.VERCEL_ENV ?? null,
      VERCEL_REGION: process.env.VERCEL_REGION ?? null,
    },
  };

  // 1. Prisma client construction
  try {
    void prisma;
    result.prisma_client = 'ok';
  } catch (err) {
    result.prisma_client = { error: String(err), message: (err as Error)?.message };
    return NextResponse.json(result, { status: 500 });
  }

  // 2. SELECT 1 — DB connectivity
  try {
    const ping = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 as ok`;
    result.db_ping = ping;
  } catch (err) {
    result.db_ping = {
      error: String(err),
      message: (err as Error)?.message,
      code: (err as { code?: string })?.code,
    };
    return NextResponse.json(result, { status: 500 });
  }

  // 3. Schema sanity — count a known core table
  try {
    const clinics = await prisma.clinic.count();
    const users = await prisma.staffUser.count();
    const patients = await prisma.patient.count();
    result.schema = { clinics, users, patients };
  } catch (err) {
    result.schema = {
      error: String(err),
      message: (err as Error)?.message,
      hint: 'Likely: schema not migrated. Run `pnpm db:migrate && pnpm db:triggers && pnpm seed` against this DATABASE_URL.',
    };
    return NextResponse.json(result, { status: 500 });
  }

  return NextResponse.json(result, { status: 200 });
}
