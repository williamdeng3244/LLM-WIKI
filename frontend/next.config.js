/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const target = process.env.BACKEND_URL || 'http://backend:8000';
    return [{ source: '/api/:path*', destination: `${target}/api/:path*` }];
  },
};
module.exports = nextConfig;
