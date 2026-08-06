import type { NextConfig } from "next";
import path from "path";

const pollIntervalMs = Number(process.env.NEXT_WATCH_POLL_INTERVAL_MS ?? 0);
const distDir = process.env.NEXT_DIST_DIR ?? ".next";
const repoRoot = path.resolve(__dirname, "../..");
const simulatorSourceRoot = path.resolve(__dirname, "../../simulator/src");
const webpackSimulatorConfig = path.resolve(
  simulatorSourceRoot,
  "config-webpack.ts",
);

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
  outputFileTracingExcludes: {
    "/*": [
      "./next.config.ts",
      "./playwright.config.ts",
      "./eslint.config.mjs",
      "./postcss.config.mjs",
      "./tailwind.config.ts",
      "./tsconfig.json",
      "./tsconfig.tsbuildinfo",
      "./app/**/*.test.ts",
      "./components/**/*.test.tsx",
      "./lib/**/*.test.ts",
      "./tests/**",
      "./test-results/**",
      "./tmp/**",
    ],
  },
  turbopack: {
    root: repoRoot,
    resolveAlias: {
      "@simulator": simulatorSourceRoot,
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
  webpack: (config, { webpack }) => {
    config.plugins = config.plugins ?? [];
    // Raw TSX tests use config-default's Node loader. Every Next bundle swaps
    // that neutral import for the Webpack context-backed loader instead.
    config.plugins.push(
      new webpack.NormalModuleReplacementPlugin(
        /^@simulator\/config-default$/,
        webpackSimulatorConfig,
      ),
    );
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
