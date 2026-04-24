import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

import { ServiceWorkerRegistration } from "@/components/shared/service-worker-registration";
import { ThemeProvider } from "@/components/theme-provider";

/**
 * Kraken's UI uses the proprietary Kraken-Product font with an
 * IBM Plex Sans fallback. Since Kraken-Product isn't publicly
 * available, we lean on IBM Plex Sans directly as the system's
 * primary. Korean glyphs fall back through the browser's system
 * Korean font (Apple SD Gothic Neo / Malgun Gothic / Noto Sans CJK)
 * which renders IBM-Plex-Sans-adjacent weights well on modern OSes.
 */
const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Investment Advisor Dashboard",
  description:
    "가족용 투자 어드바이저 대시보드 — 매크로·기술적·온체인 데이터로 비중 확대/유지/축소 판단을 제공합니다.",
  // PWA (Phase 2 Step 12). Web app manifest + iOS-specific hints. The
  // manifest lives at `public/manifest.webmanifest`; Next serves it at
  // `/manifest.webmanifest` without a route handler.
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Investment",
    // `black-translucent` lets our app content render under the status
    // bar in a "fullscreen" feel while keeping the clock/battery
    // readable on light+dark backgrounds.
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icons/192.svg",
    // TODO(Phase 3): generate 180×180 / 192×192 / 512×512 PNGs from
    // icons/*.svg — iOS Safari A2HS still prefers PNG for apple-touch-icon;
    // SVG fallback works on Safari ≥ 14 but is fragile on older iOS.
    apple: "/icons/192.svg",
  },
};

/**
 * Viewport configuration (blueprint §6.2, Step 9.5 v2.2).
 *
 * `width: "device-width"` + `initialScale: 1` is the standard mobile
 * rendering directive — without it, iOS Safari assumes a 980px canvas
 * and shrinks the page to fit, producing unreadable 9pt text on a
 * 360px phone.
 *
 * `maximumScale: 5` preserves the user's right to pinch-zoom for
 * accessibility (WCAG 1.4.4 Resize Text). Setting `maximumScale: 1`
 * — common in "app-like" templates — actively breaks low-vision users
 * and is a documented anti-pattern; we explicitly permit up to 5×.
 *
 * Next.js would add a minimal default if this export were omitted,
 * but being explicit documents the intent and guards against regressions.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      suppressHydrationWarning
      className={`${ibmPlexSans.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider>{children}</ThemeProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
