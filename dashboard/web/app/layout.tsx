import type { Metadata } from "next";
import SiteNav from "@/components/SiteNav";
import "./globals.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "WOS Simulator Dashboard",
  description: "Battle simulator accuracy dashboard for Whiteout Survival",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col md:flex-row">
        <SiteNav />
        <main className="flex-1 min-w-0 overflow-auto px-3 sm:px-6 pb-6 pt-[72px] md:pt-6">
          {children}
        </main>
      </body>
    </html>
  );
}
