import type { NextConfig } from 'next';

// web/ a son propre lockfile : la racine de traçage est web/, pas le dépôt.
const nextConfig: NextConfig = { outputFileTracingRoot: __dirname };
export default nextConfig;
