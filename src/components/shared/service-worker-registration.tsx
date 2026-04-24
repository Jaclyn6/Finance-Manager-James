"use client";

import { useEffect } from "react";

/**
 * Registers `/sw.js` on mount (Phase 2 Step 12 — PWA shell).
 *
 * Why a Client Component instead of an inline `<script>` in
 * `layout.tsx`: we run under Next 16 with `cacheComponents: true`,
 * and a raw `<script>` in the streamed HTML cannot read `navigator`
 * or gate on `"serviceWorker" in navigator` without accidentally
 * blocking first paint when the feature is missing (old iOS, etc.).
 * A dedicated Client Component with `useEffect` runs after hydration,
 * gracefully no-ops in unsupported browsers, and keeps the registration
 * off the critical rendering path.
 *
 * Registration is idempotent — the browser de-dupes by scope, so
 * re-mounting this component (e.g., route-level transitions) does
 * not pile up controllers. We intentionally do NOT eagerly call
 * `registration.update()` on mount: the default browser 24-hour
 * update check is sufficient for an internal tool and avoids extra
 * network chatter on every page navigation.
 *
 * Scope defaults to `/` since `/sw.js` is served from the origin
 * root by Next's static `public/` mount.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    // Defer to load so registration never competes with first paint.
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Non-fatal — the app works without the SW. Swallowed rather
        // than console.error'd so dev / e2e logs stay clean.
      });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}
