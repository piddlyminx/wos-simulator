import type { Metadata } from "next";
import SiteNav from "@/components/SiteNav";
import { getPublicSurface } from "@/lib/public-surface";
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
  const publicSurface = getPublicSurface();

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col md:flex-row">
        <SiteNav publicSurface={publicSurface} />
        <main className="min-w-0 flex-1 overflow-x-hidden">
          <div className="mx-auto flex min-h-screen w-full max-w-[1500px] flex-col px-3 pb-8 pt-[60px] sm:px-5 md:px-6 md:pt-6">
            {children}
          </div>
        </main>
      </body>
    </html>
  );
}
