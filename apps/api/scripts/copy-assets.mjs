/**
 * Copies non-TypeScript assets from src/ into dist/ after a build.
 *
 * `tsc` emits only the files it compiles, so the UIDAI certificates would be
 * absent from a production build. That failure is silent and nasty: Secure QR
 * scans still parse, `signatureVerified` just stays false for everyone, and the
 * deploy looks like it is working. Failing the build is much better than
 * shipping an API where nothing verifies.
 */

import { cp, readdir, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/** Directories copied verbatim from src/ to dist/, and whether they may be empty. */
const assets = [{ path: "lib/aadhaar/certs", requireFiles: ".cer" }];

let failed = false;

for (const { path, requireFiles } of assets) {
  const from = join(apiRoot, "src", path);
  const to = join(apiRoot, "dist", path);

  try {
    await access(from);
  } catch {
    console.error(`copy-assets: missing source directory src/${path}`);
    failed = true;
    continue;
  }

  await cp(from, to, { recursive: true });

  const copied = await readdir(to);
  const matching = copied.filter((f) => f.endsWith(requireFiles));

  if (matching.length === 0) {
    console.error(
      `copy-assets: no ${requireFiles} files in src/${path}.\n` +
        `  Without a UIDAI certificate every Aadhaar scan fails closed, and the\n` +
        `  deploy would look healthy while verifying nothing. See that directory's README.`,
    );
    failed = true;
    continue;
  }

  console.log(`copy-assets: ${path} -> dist (${matching.join(", ")})`);
}

if (failed) process.exit(1);
