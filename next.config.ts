import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The ESP32 and phones on the hotspot reach the dev server by LAN IP.
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '172.*.*.*'],
};

export default nextConfig;
