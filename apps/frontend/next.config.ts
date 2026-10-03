import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  eslint: {
    // Lint runs separately via `npm run lint` (flat config); keep the
    // Next 15 build from invoking legacy eslint options.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
