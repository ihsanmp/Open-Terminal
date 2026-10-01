import type { NextConfig } from "next";

// API requests are proxied by web/app/api/[...path]/route.ts instead of a
// rewrite here, so the shared API key can be attached server-side. See
// web/lib/api-key.ts.
//
// OPENTERMINAL_FAST_BUILD=1 is the desktop launcher's build (scripts/build.mjs --fast): it
// skips the type-check and lint (run before a commit) and the standalone output only the
// Docker image uses, which roughly halves the build.
const fast = process.env.OPENTERMINAL_FAST_BUILD === "1";

const nextConfig: NextConfig = fast
  ? { typescript: { ignoreBuildErrors: true }, eslint: { ignoreDuringBuilds: true } }
  : { output: "standalone" };

export default nextConfig;
