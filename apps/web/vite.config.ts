import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import basicSsl from "@vitejs/plugin-basic-ssl";

/**
 * Vite is pinned to 7.x deliberately.
 *
 * Vite 8.3.0 builds with Rolldown, and its own default output config passes an
 * object for `manualChunks` where Rolldown requires a function — so `vite build`
 * fails with "manualChunks is not a function" on a completely empty config, with
 * or without plugins. Revisit when the Vite/Rolldown pairing settles.
 *
 * The PWA is hand-written in `public/sw.js` rather than generated.
 * vite-plugin-pwa@1.3.0 is inert against Vite 7.3.6 — it resolves into the
 * plugin list and emits no service worker, no manifest and no error, on a
 * minimal config as well as ours. Writing it by hand also makes the decision
 * that actually matters explicit: which endpoints must NEVER be served stale.
 */
export default defineConfig({
  // HTTPS on the dev server is not optional for testing on a phone: the camera
  // API is only available in a secure context, so on a plain http:// LAN address
  // getUserMedia never fires and the Aadhaar scanner cannot be tested at all.
  // The certificate is self-signed, so the phone shows a warning once.
  plugins: [react(), tailwindcss(), basicSsl()],
  server: {
    port: 5173,
    // Listen on every interface so a phone on the same Wi-Fi can reach it.
    host: true,
    /**
     * Proxy the API through this origin rather than calling it directly.
     *
     * Three problems disappear at once: an https:// page cannot fetch an
     * http:// API (mixed content), a phone cannot resolve "localhost", and
     * cross-origin CORS stops applying because there is only one origin. It
     * also means only ONE certificate warning to accept instead of two.
     */
    proxy: {
      "/api": {
        target: "http://localhost:4000",
        changeOrigin: true,
        // The Socket.IO handshake upgrades to a websocket on this same path.
        ws: true,
      },
      "/health": { target: "http://localhost:4000", changeOrigin: true },
    },
  },
  build: {
    // SSR was given up in the two-service split, so a farmer on a weak
    // connection downloads this bundle before seeing anything. Splitting vendor
    // code out keeps it cached across our own deploys, which are far more
    // frequent than React's.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (/[\/]node_modules[\/](react|react-dom|react-router|scheduler)[\/]/.test(id)) return "react";
          if (id.includes("@clerk")) return "clerk";
          if (id.includes("@tanstack")) return "query";
          return undefined;
        },
      },
    },
  },
});
