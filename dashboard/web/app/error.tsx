"use client";

import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <h1
        className="text-4xl font-bold font-mono"
        style={{ color: "#f38ba8" }}
      >
        500
      </h1>
      <p className="text-sm opacity-60">Something went wrong.</p>
      {error.message && (
        <p className="text-xs font-mono opacity-40">{error.message}</p>
      )}
      <div className="flex gap-4">
        <button
          onClick={reset}
          className="text-sm hover:underline"
          style={{ color: "var(--sidebar-active)" }}
        >
          Try again
        </button>
        <Link
          href="/runs"
          className="text-sm hover:underline"
          style={{ color: "var(--sidebar-active)" }}
        >
          &larr; Back to Runs
        </Link>
      </div>
    </div>
  );
}
