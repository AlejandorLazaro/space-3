/** @type {import('next').NextConfig} */

const nextConfig = {
  output: 'export',
  basePath: '/your-repo-name',      // only needed for project pages, not username.github.io
  images: { unoptimized: true },     // Next's Image server-side optimizer needs a server; this disables it
};
module.exports = nextConfig;
