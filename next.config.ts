
import type {NextConfig} from 'next';

// Only ignore TypeScript errors in development/preview environments
// Production builds should fail on type errors to catch issues early
const shouldIgnoreTypeErrors = process.env.NODE_ENV !== 'production' ||
  process.env.IGNORE_BUILD_ERRORS === 'true';

const nextConfig: NextConfig = {
  // Enable standalone output for Docker deployment
  output: 'standalone',
  typescript: {
    // In production, type errors will fail the build unless IGNORE_BUILD_ERRORS is set
    ignoreBuildErrors: shouldIgnoreTypeErrors,
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
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
        port: '',
        pathname: '/**',
      }
    ]
  }
}
export default nextConfig;
