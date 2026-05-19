/** @type {import('next').NextConfig} */
const nextConfig = {
  // Production build uses a SEPARATE dir so `next build` never corrupts the
  // running `next dev` cache (set NEXT_DIST_DIR=.next-build in the build script).
  distDir: process.env.NEXT_DIST_DIR || '.next',
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
