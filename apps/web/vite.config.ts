import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/**
 * Vite is pinned to 7.x deliberately.
 *
 * Vite 8.3.0 builds with Rolldown, and its own default output config passes an
 * object for `manualChunks` where Rolldown requires a function — so `vite build`
 * fails with "manualChunks is not a function" on a completely empty config, with
 * or without plugins. Nothing in this repo can work around it. Revisit when the
 * Vite/Rolldown pairing settles.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5173 },
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
