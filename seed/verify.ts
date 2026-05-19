/** Phase 1 integration smoke: real auth + audit hash-chain, against seeded DB. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.DATABASE_URL) {
  for (const line of readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/.exec(line);
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2];
  }
}

const { prisma } = await import('@medixus/db');
const { authenticate } = await import('@medixus/auth');
const { verifyAuditChain } = await import('@medixus/audit');
const { AppendOnlyViolation } = await import('@medixus/db');

let pass = 0;
let fail = 0;
const ok = (c: boolean, label: string) => {
  console.log(`${c ? '✓' : '✗'} ${label}`);
  c ? pass++ : fail++;
};

const good = await authenticate({ loginId: 'doctor', password: 'Medixus#2026' });
ok(good.ok === true, 'authenticate(doctor) succeeds + issues session token');

const bad = await authenticate({ loginId: 'doctor', password: 'wrong' });
ok(bad.ok === false, 'authenticate(wrong password) rejected');

const chain = await verifyAuditChain();
ok(chain.ok === true, 'audit hash-chain verifies (tamper-evident)');

// append-only guard: amending content of a clinical note must be refused
const note = await prisma.clinicalNote.findFirst({ where: { isLatest: true } });
let blocked = false;
if (note) {
  try {
    await prisma.clinicalNote.update({
      where: { id: note.id },
      data: { blocks: [{ kind: 'S', spans: [{ text: 'TAMPER' }] }] as object },
    });
  } catch (e) {
    blocked = e instanceof AppendOnlyViolation || /append-only/.test(String(e));
  }
}
ok(blocked, 'clinical-note content mutation blocked (電子保存の三原則・真正性)');

const checks = await prisma.ruleCheckResult.groupBy({ by: ['result'], _count: true });
ok(
  checks.some((c) => c.result === 'BLOCKED'),
  `safety engine produced BLOCKED findings (${checks.map((c) => `${c.result}:${c._count}`).join(', ')})`,
);

await prisma.$disconnect();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
