import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Monorepo root, two levels up from apps/emr-web/.
const monorepoRoot = resolve(__dirname, '../..');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Production build uses a SEPARATE dir so `next build` never corrupts the
  // running `next dev` cache (set NEXT_DIST_DIR=.next-build in the build script).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Tell Next.js / @vercel/nft that the dependency root is the monorepo
  // root (not the per-app dir). Without this, the file tracer cannot follow
  // pnpm's `node_modules/.pnpm/<pkg>/node_modules/...` layout and silently
  // drops Prisma's runtime-loaded native engine.
  outputFileTracingRoot: monorepoRoot,
  // Prisma loads the Query Engine binary via dynamic require at runtime,
  // which static tracing cannot detect. We must explicitly include the
  // engine .node binaries (both rhel-openssl-3.0.x for AWS Lambda and
  // native for any other runtime) in every serverless function bundle,
  // plus the generated client and the schema.
  outputFileTracingIncludes: {
    '/**/*': [
      '../../node_modules/.pnpm/@prisma+client*/node_modules/.prisma/client/**/*',
      '../../node_modules/.pnpm/@prisma+client*/node_modules/@prisma/client/**/*',
      '../../node_modules/.prisma/client/**/*',
      '../../packages/db/prisma/schema.prisma',
    ],
  },
  transpilePackages: [
    '@medixus/db',
    '@medixus/domain',
    '@medixus/auth',
    '@medixus/authz',
    '@medixus/audit',
    '@medixus/order-checks',
    '@medixus/rule-engine',
    '@medixus/master-import',
    '@medixus/ui',
  ],
  serverExternalPackages: ['@prisma/client', '.prisma/client'],
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  webpack: (config) => {
    // workspace packages ship TS with NodeNext-style ".js" specifiers
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.jsx': ['.tsx', '.jsx'],
    };
    return config;
  },
};

export default nextConfig;
