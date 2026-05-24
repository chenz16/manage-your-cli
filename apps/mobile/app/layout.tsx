import type { Metadata, Viewport } from 'next';
import './globals.css';
import './components.css';
import { ServiceWorkerRegister } from './_components/ServiceWorkerRegister';
// MobileTabBar + MobileBootstrap removed — superseded by WeizoApp 4-tab shell
// rendered directly from page.tsx (single-page SPA pattern).

export const metadata: Metadata = {
  // M-L-042 — Align metadata to manifest.json (Chinese-ified in M-L-024) so the
  // PWA install prompt, browser tab title, and OS share-card stay Chinese.
  title: 'Holon — 工作台',
  description: '你的桌面 AI · 派活给员工 · 工作进度一屏看完',
  manifest: '/manifest.json',
  applicationName: 'Holon — 工作台',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Holon',
  },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/icon-192.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // M-L-056 — Do NOT disable pinch-zoom. `maximumScale:1`+`userScalable:false`
  // make iOS Safari refuse pinch-to-zoom on every surface, locking out
  // low-vision owners (WCAG 1.4.4 fail). Allow scaling up to 5×; native pinch
  // + iOS Dynamic Type scale the px-based layout fine.
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
  themeColor: '#F8F6EF',
  // M-L-KBD1 — interactiveWidget=resizes-content makes the browser resize the
  // visual viewport (and layout) when the soft keyboard opens, rather than
  // overlaying it. This populates env(keyboard-inset-height) and shrinks the
  // chat scroll area so the composer stays visible above the keyboard.
  interactiveWidget: 'resizes-content',
};

// M-L-005 — Root layout: app-shell (dark gutter on desktop, paper on
// phones) > phone-shell (centered 393×852 iPhone 16 card on desktop,
// full-bleed on phones) > sticky PhoneStatus header + scrolling main +
// absolute-positioned bottom-tabs. Per docs/mobile-architecture-principles.md
// Principle 3: visual sync with desk's paper/ink/gold tokens, mibusy-pattern
// frame only at the page wrapper.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh">
      <head>
        {/* Legacy iOS Safari standalone meta. Next 15 emits the modern
            `mobile-web-app-capable` from appleWebApp.capable, but iOS Safari
            still keys "Add to Home Screen" standalone mode off the legacy
            apple-prefixed tag on older iOS. Belt-and-suspenders. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body>
        <div className="app-shell">
          <div className="phone-shell">
            <main className="main">{children}</main>
          </div>
        </div>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
