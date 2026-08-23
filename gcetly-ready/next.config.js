/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  // Knowledge/FAQ JSON files are read at request time from /data via fs.
};

module.exports = nextConfig;
