/**
 * 薬剤バンドル一括取込ランナー。
 *   pnpm import:drugs:bundle [dir=data]
 * data/ の manifest＋CSV を検証付き・冪等で全実装する（"入れるだけ"）。
 */
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
const dir = path.resolve(root, process.argv[2] ?? 'data');

const { importBundle } = await import('@medixus/master-import');
const { prisma } = await import('@medixus/db');

console.log(`[import:bundle] ${dir}`);
const r = await importBundle(dir);
await prisma.$disconnect();
console.log(
  `[import:bundle] 成分:${r.ingredients} 製品:${r.products} 適応:${r.indications} ` +
    `禁忌:${r.contraindications} 相互:${r.interactions} 用量:${r.dosages} ` +
    `安全skip:${r.skippedSafety}`,
);
if (r.errors.length) {
  console.log('  errors(先頭5):');
  r.errors.slice(0, 5).forEach((e) => console.log('   - ' + e));
}
