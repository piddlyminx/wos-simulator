import type { NextConfig } from "next";
import path from "path";

const pollIntervalMs = Number(process.env.NEXT_WATCH_POLL_INTERVAL_MS ?? 0);

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  allowedDevOrigins: [
    "wos-sim.ratme.org",
    "localhost",
    "localhost:3000",
    "127.0.0.1",
    "127.0.0.1:3000",
  ],
  // Prevent Next.js from walking up to the home-directory package-lock.json
  // and misidentifying the workspace root.
  outputFileTracingRoot: path.resolve(__dirname),
  ...(pollIntervalMs > 0
    ? {
        watchOptions: {
          pollIntervalMs,
        },
      }
    : {}),
  // This is a purely dynamic app; skip static prerender of all pages.
  // Avoids the Next.js 15.x bug where /_not-found prerender fails with
  // "Cannot read properties of null (reading 'useOptimistic')" when the
  // layout contains Link components.
  experimental: {
    // Force all pages to be dynamically rendered at request time.
    // This bypasses the broken /_not-found static prerender in Next.js 15.5.x.
  },
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@v3": path.resolve(__dirname, "../../v3/src"),
    };
    return config;
  },
};

export default nextConfig;
