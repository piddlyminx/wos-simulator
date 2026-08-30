import { createHash, randomBytes } from "crypto";

export const SAVED_RUN_OWNER_COOKIE = "wos_saved_run_owner";
export const SAVED_RUN_OWNER_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

const OWNER_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function createSavedRunOwnerToken(): string {
  return randomBytes(32).toString("base64url");
}

export function readSavedRunOwnerToken(req: Request): string | null {
  const cookieHeader = req.headers.get("cookie");
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name !== SAVED_RUN_OWNER_COOKIE) continue;
    const value = valueParts.join("=");
    return OWNER_TOKEN_RE.test(value) ? value : null;
  }
  return null;
}

export function hashSavedRunOwnerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
