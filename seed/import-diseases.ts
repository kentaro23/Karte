/** 傷病名マスター取込ランナー。 pnpm import:diseases <utf8-csv> [release] */
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
const csvPath = process.argv[2];
const release = process.argv[3] ?? new Date().toISOString().slice(0, 7);
if (!csvPath) { console.error('usage: import-diseases.ts <utf8-csv> [release]'); process.exit(1); }

const { importDiseaseMaster } = await import('@medixus/master-import');
const { prisma } = await import('@medixus/db');

console.log(`[import:diseases] ${csvPath} (release ${release})`);
const r = await importDiseaseMaster({ filePath: csvPath, sourceRelease: release });
const total = await prisma.diseaseMaster.count();
await prisma.$disconnect();
console.log(`[import:diseases] imported=${r.imported} / DiseaseMaster総数=${total}`);
