import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Opt into Next.js 16 Cache Components model. This flag supersedes the removed
  // experimental.dynamicIO / experimental.useCache / experimental.ppr flags and
  // lets us express cache lifetimes in code via the 'use cache' directive
  // (see src/lib/data/*.ts) plus cacheTag/cacheLife helpers.
  cacheComponents: true,
};

export default nextConfig;
