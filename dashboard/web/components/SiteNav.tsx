"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { PublicSurface } from "@/lib/public-surface";

const DASHBOARD_LINKS: { href: string; label: string }[] = [
  { href: "/", label: "Dashboard" },
  { href: "/runs", label: "Runs" },
  { href: "/parity", label: "Run Reports" },
  { href: "/coverage", label: "Coverage" },
  { href: "/heroes", label: "Heroes" },
  { href: "/testcases", label: "Testcases" },
  { href: "/testcases/changelog", label: "Changelog" },
  { href: "/simulate", label: "Simulate" },
  { href: "/bear", label: "Bear Sim" },
  { href: "/tournament", label: "Tournament" },
];

const SIMULATE_LINKS: { href: string; label: string }[] = [
  { href: "/simulate", label: "Simulate" },
  { href: "/bear", label: "Bear Sim" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function SiteNav({
  publicSurface = "dashboard",
}: {
  publicSurface?: PublicSurface;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const links = publicSurface === "simulate" ? SIMULATE_LINKS : DASHBOARD_LINKS;
  const subtitle =
    publicSurface === "simulate" ? "Battle Simulator" : "Accuracy Dashboard";

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* Mobile top bar */}
      <header
        className="md:hidden fixed top-0 inset-x-0 z-40 flex items-center justify-between px-4 h-12"
        style={{
          backgroundColor: "var(--sidebar-bg)",
          color: "var(--sidebar-text)",
          borderBottom: "1px solid var(--border-color)",
        }}
      >
        <span className="text-sm font-bold uppercase tracking-widest opacity-80">
          WOS Sim
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="site-nav-drawer"
          className="inline-flex items-center justify-center w-10 h-10 rounded"
          style={{
            border: "1px solid var(--border-color)",
            color: "var(--sidebar-text)",
            backgroundColor: "var(--main-bg)",
          }}
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {open ? (
              <>
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </>
            ) : (
              <>
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </>
            )}
          </svg>
        </button>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div
          id="site-nav-drawer"
          className="md:hidden fixed inset-0 z-50 flex"
          role="dialog"
          aria-modal="true"
          aria-label="Site navigation"
        >
          <button
            type="button"
            aria-label="Dismiss navigation"
            className="flex-1 cursor-default"
            onClick={() => setOpen(false)}
            style={{ backgroundColor: "rgba(0,0,0,0.55)" }}
          />
          <nav
            className="w-72 max-w-[85vw] flex flex-col py-4 px-4 gap-1 shadow-xl"
            style={{
              backgroundColor: "var(--sidebar-bg)",
              color: "var(--sidebar-text)",
              borderLeft: "1px solid var(--border-color)",
            }}
          >
            <div className="flex items-center justify-between mb-3 px-1">
              <div>
                <h1 className="text-sm font-bold uppercase tracking-widest opacity-60">
                  WOS Sim
                </h1>
                <p className="text-xs opacity-40 mt-1">{subtitle}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="inline-flex items-center justify-center w-10 h-10 rounded"
                style={{
                  border: "1px solid var(--border-color)",
                  color: "var(--sidebar-text)",
                  backgroundColor: "var(--main-bg)",
                }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            {links.map((link) => {
              const active = isActive(pathname ?? "", link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="nav-link block px-3 py-3 rounded text-base transition-colors"
                  aria-current={active ? "page" : undefined}
                  style={
                    active
                      ? {
                          backgroundColor: "var(--sidebar-hover)",
                          color: "var(--sidebar-active)",
                        }
                      : undefined
                  }
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}

      {/* Desktop sidebar */}
      <nav
        className="hidden md:flex w-52 flex-shrink-0 flex-col py-6 px-4 gap-2"
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
          <p className="text-xs opacity-40 mt-1">{subtitle}</p>
        </div>
        {links.map((link) => {
          const active = isActive(pathname ?? "", link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              className="nav-link block px-3 py-2 rounded text-sm transition-colors"
              aria-current={active ? "page" : undefined}
              style={
                active
                  ? {
                      backgroundColor: "var(--sidebar-hover)",
                      color: "var(--sidebar-active)",
                    }
                  : undefined
              }
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
