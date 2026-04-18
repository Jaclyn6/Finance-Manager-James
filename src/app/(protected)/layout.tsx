import { Suspense } from "react";

import { Header } from "@/components/layout/header";
import { Sidebar } from "@/components/layout/sidebar";
import { DisclaimerBanner } from "@/components/shared/disclaimer-banner";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shell for every route under the `(protected)` group (dashboard,
 * asset detail, changelog). The proxy at `src/proxy.ts` is the auth
 * gate — by the time this layout renders, we're guaranteed to have a
 * session. Inside the layout:
 *
 * - DisclaimerBanner: static, sits above everything to satisfy PRD
 *   §11.5 (never let the user forget this is interpretive).
 * - Sidebar: Client Component for active-link highlight.
 * - Header: Server Component; its `UserDisplay` child reads cookies
 *   inside a Suspense boundary so the shell can prerender.
 *
 * No `'use cache'` directive here — the layout itself has no data
 * dependencies. Per-page caching is opted into at each page.
 */
export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen min-h-0 flex-col">
      <DisclaimerBanner />
      <div className="flex flex-1 min-h-0">
        {/*
          Sidebar uses `usePathname()` for active-link highlighting,
          which is a runtime routing API. Under `cacheComponents: true`,
          any dynamic API must live inside a Suspense boundary so the
          static shell can prerender around it. Fallback is a Sidebar-
          shaped skeleton so layout doesn't shift when nav hydrates.
        */}
        <Suspense fallback={<Skeleton className="h-full w-56 rounded-none border-r" />}>
          <Sidebar />
        </Suspense>
        <div className="flex flex-1 min-w-0 flex-col">
          <Header />
          <main className="flex-1 overflow-auto bg-background px-6 py-6">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
