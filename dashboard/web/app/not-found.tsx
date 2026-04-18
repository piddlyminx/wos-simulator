"use client";

import Link from "next/link";

export default function NotFound() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "50vh",
        gap: "1rem",
        fontFamily: "monospace",
      }}
    >
      <h1 style={{ color: "var(--sidebar-active)", fontSize: "2rem" }}>404</h1>
      <p style={{ opacity: 0.6 }}>Page not found.</p>
      <Link href="/runs" style={{ color: "var(--sidebar-active)" }}>
        Back to Runs
      </Link>
    </div>
  );
}
