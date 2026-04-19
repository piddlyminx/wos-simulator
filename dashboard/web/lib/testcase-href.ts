/**
 * Pure URL helpers for testcase detail pages. Safe to import from both
 * server and client components — no Node-only APIs.
 */

/**
 * Build a canonical URL for a testcase file detail page from the DB-stored
 * file path. The stored path always begins with `testcases/`; we strip that
 * leading segment because the route itself is `/testcases/...`.
 * The remaining path segments are URI-encoded so filenames with unusual
 * characters stay safe.
 */
export function testcaseDetailHref(filePath: string): string {
  const stripped = filePath.replace(/^testcases\//, "");
  const segments = stripped.split("/").map(encodeURIComponent);
  return `/testcases/${segments.join("/")}`;
}

/**
 * Inverse of testcaseDetailHref — reconstruct the DB `file` value from a
 * Next.js catch-all `params.path` array.
 */
export function testcaseFileFromPath(segments: string[]): string {
  const decoded = segments.map(decodeURIComponent).join("/");
  return `testcases/${decoded}`;
}
