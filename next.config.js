/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Tree-shake the Phosphor icon barrel so only the icons we import are
    // bundled (avoids pulling in the full ~1.5k-icon set + slow dev compiles).
    optimizePackageImports: ["@phosphor-icons/react"],
  },
};

module.exports = nextConfig;
