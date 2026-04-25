/**
 * Vanilla service worker — shell caching only (Phase 2 Step 12).
 *
 * Scope per blueprint §9 Step 12 + plan §0.2 #5:
 *  - Cache the app shell (index, dashboard, manifest, icons) so
 *    "Add to Home Screen" → launch loads instantly even on flaky
 *    networks.
 *  - DO NOT cache API responses or snapshot/signal/composite data.
 *    The offline-data story is explicitly out-of-scope for Phase 2.
 *  - Network-first for same-origin GETs so users always see fresh
 *    HTML when online; cache serves as the offline fallback only.
 *
 * Bumping CACHE_NAME invalidates all prior caches on activate —
 * the simplest possible busting story. No precache manifest, no
 * workbox.
 */

// F-R5.12: PNG icons added for iOS A2HS reliability (iOS Safari does
// not honour SVG manifest icons consistently). CACHE_NAME bumped to
// `v2` so existing installs evict the stale precache that lacks the
// PNG entries on next activation.
const CACHE_NAME = "finance-shell-v2";
const SHELL_ASSETS = [
  "/",
  "/dashboard",
  "/manifest.webmanifest",
  "/icons/192.svg",
  "/icons/512.svg",
  "/icons/192.png",
  "/icons/512.png",
  "/icons/maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only handle same-origin GETs. POST/PUT/DELETE and cross-origin
  // requests pass straight through untouched.
  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  // Never cache API / data routes — offline stale data would silently
  // mislead the dashboard. Let these hit the network or fail loudly.
  if (url.pathname.startsWith("/api/")) return;

  // Never cache RSC flight payloads or _next/data — they're per-user
  // personalized and matching /api policy per plan §0.2 #5.
  if (url.pathname.startsWith("/_next/data/")) return;
  if (url.searchParams.has("_rsc")) return;
  if (event.request.headers.get("RSC") === "1") return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        // Only cache successful, same-origin responses — don't persist
        // transient 4xx/5xx.
        if (!res.ok) return res;
        if (res.status === 0 || res.type === "opaqueredirect") return res;
        // Clone before the response body is consumed by the caller.
        const resClone = res.clone();
        caches
          .open(CACHE_NAME)
          .then((cache) => cache.put(event.request, resClone))
          .catch(() => {
            /* cache write failures are non-fatal */
          });
        return res;
      })
      .catch(() =>
        caches
          .match(event.request)
          .then((cached) => cached || Response.error()),
      ),
  );
});
