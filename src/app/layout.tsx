import type { Metadata } from 'next';
import './globals.css';
import { cn } from '@/lib/utils';
import { Providers } from './providers';

const SITE_URL = 'https://storypic.rcnx.io';
const SITE_NAME = 'StoryPic Kids';
const SITE_DESCRIPTION =
  'StoryPic Kids turns a few photos into beautifully illustrated, personalised storybooks starring your own child — read together on screen or in print.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'StoryPic Kids — personalised storybooks starring your child',
    template: '%s · StoryPic Kids',
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    'personalised storybooks',
    'kids books',
    'custom children’s books',
    'AI storybooks',
    'bedtime stories',
    'illustrated storybooks',
    'StoryPic Kids',
  ],
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: SITE_NAME,
  },
  formatDetection: {
    telephone: false,
  },
  alternates: {
    canonical: '/',
  },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: 'Stories where your child is the hero',
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: 'en_GB',
    images: [
      {
        url: '/og/og-image.png',
        width: 1200,
        height: 630,
        alt: 'StoryPic Kids — personalised, illustrated storybooks starring your child',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Stories where your child is the hero',
    description: SITE_DESCRIPTION,
    images: ['/og/og-image.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=PT+Sans:wght@400;700&display=swap" rel="stylesheet" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="theme-color" content="#f59e0b" />
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
        <link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32x32.png" />
        <link rel="icon" type="image/png" sizes="16x16" href="/icons/favicon-16x16.png" />
      </head>
      <body className={cn("h-full font-body antialiased bg-background")}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
