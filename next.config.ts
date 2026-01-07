
import type {NextConfig} from 'next';
import { execSync } from 'child_process';

// Get git commit SHA at build time
let gitCommitSha = 'unknown';
try {
  gitCommitSha = execSync('git rev-parse --short HEAD').toString().trim();
} catch {
  // Ignore errors (e.g., not a git repo)
}

// Only ignore TypeScript errors in development/preview environments
// Production builds should fail on type errors to catch issues early
const shouldIgnoreTypeErrors = process.env.NODE_ENV !== 'production' ||
  process.env.IGNORE_BUILD_ERRORS === 'true';

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_GIT_COMMIT_SHA: gitCommitSha,
  },
  // Enable standalone output for Docker deployment
  output: 'standalone',
  // Transpile workspace packages so they work with Next.js bundler
  transpilePackages: ['@storypic/api-client', '@storypic/shared-types'],
  // Configure Turbopack to use correct workspace root (silences lockfile warning)
  turbopack: {
    root: '.',
  },
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
