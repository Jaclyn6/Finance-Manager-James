import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

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
      </body>
    </html>
  );
}
