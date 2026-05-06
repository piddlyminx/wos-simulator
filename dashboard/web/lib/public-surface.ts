export type PublicSurface = "dashboard" | "simulate";

export function getPublicSurface(): PublicSurface {
  return process.env.PUBLIC_SURFACE === "simulate" ? "simulate" : "dashboard";
}

export function isPublicSimulateSurface(): boolean {
  return getPublicSurface() === "simulate";
}
