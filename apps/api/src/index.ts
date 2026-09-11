/**
 * Process entry point. Binds the port and closes the database cleanly.
 *
 * One replica, always. Socket.IO rooms are in-process, so a second replica
 * silently drops half the broadcasts — see docs/ARCHITECTURE.md.
 */

import { createApp } from "./app.js";
import { env } from "./env.js";
import { prisma } from "./db.js";

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`api listening on :${env.PORT}  (${env.NODE_ENV})`);
  console.log(`  cors origin   ${env.webOrigins.join(", ")}`);
  if (env.demoMode) {
    // Loud on purpose. A production bundle built without the Clerk key ships
    // with auth off and every panel open, and nothing else would warn you.
    console.warn("  DEMO MODE     CLERK_SECRET_KEY is blank — auth is OFF and every panel is open.");
  }
});

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, shutting down`);
  server.close(() => {
    void prisma.$disconnect().finally(() => process.exit(0));
  });
  // Railway sends SIGTERM and waits; do not hang past that if a socket is stuck.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
