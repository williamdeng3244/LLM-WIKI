const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    const target = process.env.BACKEND_URL || 'http://backend:8000';
    return [
      { source: '/api/:path*', destination: `${target}/api/:path*` },
      // Gated artifact viewer — backend serves the auth-gated shell and
      // the raw body (with strict CSP) at /a/<short_id>[/raw]. Proxying
      // keeps one canonical implementation; no Next.js shell duplicates.
      { source: '/a/:path*', destination: `${target}/a/:path*` },
    ];
  },
  // Dedupe `three`. We pin 0.160 in package.json but `3d-force-graph`
  // pulls a nested 0.184 — webpack bundles BOTH, which breaks class
  // identity for `Sprite`/`SpriteMaterial`/`AdditiveBlending` between
  // our `nodeThreeObject` builder and the lib's renderer (causing the
  // additive-blended halo to render as a flat sprite, so the glow
  // slider has no visible effect). Force every `from 'three'` to
  // resolve to a single instance — the nested copy the lib itself
  // depends on, so we don't accidentally downgrade the lib.
  webpack: (config) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = config.resolve.alias || {};
    config.resolve.alias['three$'] = path.resolve(
      __dirname,
      'node_modules/3d-force-graph/node_modules/three',
    );
    return config;
  },
};
module.exports = nextConfig;
