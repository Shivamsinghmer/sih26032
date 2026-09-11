/**
 * The service worker, written by hand.
 *
 * The decision that matters here is not *what to cache* but **what must never
 * be cached**. A cached queue position or capacity figure sends a farmer to the
 * mandi at the wrong hour, which is precisely the failure this whole project
 * exists to remove. So the allow-list below is short and deliberate, and
 * everything else falls through to the network untouched.
 *
 * Cached:
 *   · the app shell, so the app opens at all on a dead connection
 *   · the dashboard, because it carries the GATE PASS — the one thing a farmer
 *     standing at a gate with no signal genuinely needs, and a code that does
 *     not go stale once issued
 *   · the centre list, which changes about never
 *
 * Never cached:
 *   · /farmer/queue-context, /centres/*, /slots, /admin/*  — anything whose
 *     value being one minute old changes what a person should do
 *   · every POST and PATCH
 */

const VERSION = "v1";
const SHELL = `shell-${VERSION}`;
const DATA = `data-${VERSION}`;

const SHELL_ASSETS = ["/", "/index.html", "/manifest.webmanifest", "/favicon.svg", "/icon-192.png", "/icon-512.png"];

/** Endpoints safe to serve from cache when the network is gone. */
const CACHEABLE = [/\/api\/v1\/farmer\/dashboard$/, /\/api\/v1\/centres$/];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // Individually, so one missing asset does not fail the whole install.
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((a) => cache.add(a))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Never interfere with anything that changes state, or with the socket.
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/socket")) return;

  // SPA navigations: serve the cached shell when offline so the app still opens
  // and can say what it does and does not know.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/index.html").then((r) => r ?? Response.error())),
    );
    return;
  }

  // Same-origin build assets: cache-first, since they are content-hashed.
  if (url.origin === self.location.origin && url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((response) => {
            const copy = response.clone();
            void caches.open(SHELL).then((c) => c.put(request, copy));
            return response;
          }),
      ),
    );
    return;
  }

  // The short allow-list of API reads: network first, cache as a fallback only.
  if (CACHEABLE.some((re) => re.test(url.pathname))) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(DATA).then((c) => c.put(request, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(request).then((hit) => {
            if (!hit) return Response.error();
            // Tell the app this came from cache, so a screen can say so rather
            // than presenting stale data as live.
            const headers = new Headers(hit.headers);
            headers.set("X-From-Cache", "1");
            return hit.blob().then((body) => new Response(body, { status: 200, headers }));
          }),
        ),
    );
    return;
  }

  // Everything else: straight to the network, uncached, on purpose.
});
