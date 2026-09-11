import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: { port: 5173 },
    build: {
        // SSR was given up in the two-service split, so a farmer on a weak
        // connection downloads this bundle before seeing anything. Keeping the
        // vendor chunk separate lets it stay in cache across our own deploys.
        rollupOptions: {
            output: {
                manualChunks: {
                    react: ["react", "react-dom", "react-router"],
                    query: ["@tanstack/react-query"],
                },
            },
        },
    },
});
//# sourceMappingURL=vite.config.js.map