/** @type {import('next').NextConfig} */

const isProd = process.env.NODE_ENV === 'production';

const nextConfig = {
  output: 'export',
  basePath: isProd ? '/space-3' : '',      // only needed for project pages, not username.github.io
  images: { unoptimized: true },     // Next's Image server-side optimizer needs a server; this disables it
};
module.exports = nextConfig;
