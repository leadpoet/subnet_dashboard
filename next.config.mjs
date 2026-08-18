// Use one value for every server entry compiled by this build. A runtime
// timestamp can differ between route bundles, while a long-lived BUILD_TIME
// environment value can stay unchanged across releases.
const dashboardBuildVersion = process.env.NODE_ENV === 'development'
  ? 'dev'
  : String(Date.now())

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,

  env: {
    DASHBOARD_BUILD_VERSION: dashboardBuildVersion,
  },

  // Production alternates between two build directories so PM2 can keep the
  // previous server alive while the replacement worker starts. Local builds
  // continue to use Next.js's default `.next` directory.
  distDir: process.env.NEXT_DIST_DIR || '.next',

  // Enable compression
  compress: true,

};

export default nextConfig;
