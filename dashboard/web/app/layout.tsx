import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "WOS Simulator Dashboard",
  description: "Battle simulator accuracy dashboard for Whiteout Survival",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen">
        <nav
          className="w-52 flex-shrink-0 flex flex-col py-6 px-4 gap-2"
          style={{
            backgroundColor: "var(--sidebar-bg)",
            color: "var(--sidebar-text)",
            borderRight: "1px solid var(--border-color)",
          }}
        >
          <div className="mb-6">
            <h1 className="text-sm font-bold uppercase tracking-widest opacity-60">
              WOS Sim
            </h1>
            <p className="text-xs opacity-40 mt-1">Accuracy Dashboard</p>
          </div>

          <Link
            href="/runs"
            className="nav-link block px-3 py-2 rounded text-sm transition-colors"
          >
            Runs
          </Link>
          <Link
            href="/coverage"
            className="nav-link block px-3 py-2 rounded text-sm transition-colors"
          >
            Coverage
          </Link>
          <Link
            href="/heroes"
            className="nav-link block px-3 py-2 rounded text-sm transition-colors"
          >
            Heroes
          </Link>
          <Link
            href="/testcases/changelog"
            className="nav-link block px-3 py-2 rounded text-sm transition-colors"
          >
            Changelog
          </Link>
        </nav>

        <main className="flex-1 overflow-auto p-6">{children}</main>
      </body>
    </html>
  );
}
