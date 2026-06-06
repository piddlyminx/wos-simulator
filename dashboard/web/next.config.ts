import type { NextConfig } from "next";
import path from "path";

const pollIntervalMs = Number(process.env.NEXT_WATCH_POLL_INTERVAL_MS ?? 0);
const distDir = process.env.NEXT_DIST_DIR ?? ".next";
const repoRoot = path.resolve(__dirname, "../..");
const simulatorSourceRoot = path.resolve(__dirname, "../../simulator/src");

const nextConfig: NextConfig = {
  distDir,
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
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
    resolveAlias: {
      "@simulator": "../../simulator/src",
    },
    resolveExtensions: [".mdx", ".tsx", ".ts", ".jsx", ".js", ".mjs", ".json"],
  },
  ...(pollIntervalMs > 0
    ? {
        watchOptions: {
          pollIntervalMs,
        },
      }
    : {}),
  webpack: (config) => {
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      "@simulator": simulatorSourceRoot,
    };
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      ".js": [".ts", ".js"],
    };
    return config;
  },
};

export default nextConfig;
