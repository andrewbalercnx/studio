
import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  // Restarting the server as requested.
  // Restarting the server again.
  // Restarting the server again.
  // Restarting the server again.
  // Restarting the server again.
  // Restarting the server again.
  // And restarting again.
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
