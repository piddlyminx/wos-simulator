import { NextRequest, NextResponse } from "next/server";

const PUBLIC_SURFACE = process.env.PUBLIC_SURFACE;

function isAllowedPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  if (pathname === "/simulate" || pathname.startsWith("/simulate/")) return true;
  if (pathname === "/healthz") return true;
  if (pathname === "/icon.svg") return true;
  if (pathname === "/api/ocr-report") return true;
  if (pathname === "/api/simulate" || pathname.startsWith("/api/simulate/")) {
    return true;
  }
  return false;
}

export function middleware(req: NextRequest) {
  if (PUBLIC_SURFACE !== "simulate") return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (pathname === "/") {
    return NextResponse.redirect(new URL("/simulate", req.url));
  }

  if (isAllowedPublicPath(pathname)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse("Not found", {
    status: 404,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
