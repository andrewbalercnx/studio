'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Smartphone, Monitor, Download, Share, PlusSquare, CheckCircle2, Github } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

export default function InstallPage() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Detect platform
    const userAgent = navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(userAgent));
    setIsAndroid(/android/.test(userAgent));

    // Check if already installed as PWA
    const standalone = window.matchMedia('(display-mode: standalone)').matches ||
                       (window.navigator as any).standalone === true;
    setIsStandalone(standalone);

    // Listen for install prompt
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallPWA = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === 'accepted') {
      setIsInstalled(true);
    }
    setDeferredPrompt(null);
  };

  return (
    <div className="container max-w-4xl py-8 px-4">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold mb-2">Install StoryPic Kids</h1>
        <p className="text-muted-foreground">
          Get the app on your device for the best experience
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* PWA Installation Card */}
        <Card className="relative overflow-hidden">
          <div className="absolute top-2 right-2">
            <Badge variant="secondary">Recommended</Badge>
          </div>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Monitor className="h-6 w-6 text-blue-600" />
              </div>
              <div>
                <CardTitle>Web App (PWA)</CardTitle>
                <CardDescription>Install from your browser</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {isStandalone ? (
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-medium">Already installed!</span>
              </div>
            ) : isInstalled ? (
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-medium">Successfully installed!</span>
              </div>
            ) : deferredPrompt ? (
              <Button onClick={handleInstallPWA} className="w-full">
                <Download className="mr-2 h-4 w-4" />
                Install App
              </Button>
            ) : isIOS ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  To install on iOS:
                </p>
                <ol className="text-sm space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="font-semibold text-blue-600">1.</span>
                    <span>Tap the <Share className="inline h-4 w-4" /> Share button in Safari</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-semibold text-blue-600">2.</span>
                    <span>Scroll down and tap <PlusSquare className="inline h-4 w-4" /> "Add to Home Screen"</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-semibold text-blue-600">3.</span>
                    <span>Tap "Add" to confirm</span>
                  </li>
                </ol>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  To install on your device:
                </p>
                <ol className="text-sm space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="font-semibold text-blue-600">1.</span>
                    <span>Open Chrome or Edge browser</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-semibold text-blue-600">2.</span>
                    <span>Look for the install icon in the address bar</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-semibold text-blue-600">3.</span>
                    <span>Click "Install" when prompted</span>
                  </li>
                </ol>
              </div>
            )}
            <ul className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
              <li>• Works on any device with a modern browser</li>
              <li>• Always up to date automatically</li>
              <li>• Uses minimal storage</li>
            </ul>
          </CardContent>
        </Card>

        {/* Android APK Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <Smartphone className="h-6 w-6 text-green-600" />
              </div>
              <div>
                <CardTitle>Android App</CardTitle>
                <CardDescription>Download APK directly</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Download our native Android app for the full experience on your phone or tablet.
            </p>
            <Button variant="outline" className="w-full" asChild>
              <a href="/downloads/storypic-kids.apk" download>
                <Download className="mr-2 h-4 w-4" />
                Download APK
              </a>
            </Button>
            <div className="space-y-2 text-xs text-muted-foreground">
              <p className="font-medium">Installation steps:</p>
              <ol className="space-y-1">
                <li>1. Download the APK file</li>
                <li>2. Open the downloaded file</li>
                <li>3. Allow "Install from unknown sources" if prompted</li>
                <li>4. Follow the installation wizard</li>
              </ol>
            </div>
            <ul className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
              <li>• Requires Android 8.0 or later</li>
              <li>• Full native app experience</li>
              <li>• Manual updates required</li>
            </ul>
            <div className="pt-2 border-t">
              <a
                href="https://github.com/andrewbalercnx/studio/commit/3e03da8"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Github className="h-3 w-3" />
                <span className="font-mono">3e03da8</span>
              </a>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Additional Info */}
      <div className="mt-8 p-4 bg-muted rounded-lg">
        <h2 className="font-semibold mb-2">Which should I choose?</h2>
        <p className="text-sm text-muted-foreground">
          <strong>Web App (PWA)</strong> is recommended for most users. It works on any device,
          updates automatically, and provides an app-like experience directly from your browser.
        </p>
        <p className="text-sm text-muted-foreground mt-2">
          <strong>Android APK</strong> is a native app that may offer slightly better performance
          on Android devices, but requires manual updates when new versions are released.
        </p>
      </div>
    </div>
  );
}
