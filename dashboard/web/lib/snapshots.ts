import "server-only";
import zlib from "zlib";
import { getRunSnapshotBlob } from "./db";

/**
 * Per-run simulator-file snapshot helpers (WOS-200).
 *
 * The TypeScript dashboard ingestion path writes a gzipped USTAR tarball
 * containing every simulator-relevant file's content at the time of the
 * run. This module unpacks those tarballs entirely in-process so the
 * dashboard can diff two runs without `git` being present in the
 * container.
 *
 * We parse USTAR inline (no tar-stream dep — it's only a transitive dep
 * of better-sqlite3 today and we don't want to couple to that). The
 * Python writer uses the default POSIX format with regular files only,
 * so the minimal implementation below is sufficient.
 */

const BLOCK = 512;
const USTAR_MAGIC = "ustar";

function readString(buf: Buffer, offset: number, length: number): string {
  const slice = buf.subarray(offset, offset + length);
  const nul = slice.indexOf(0);
  return (nul === -1 ? slice : slice.subarray(0, nul)).toString("utf8");
}

function readOctal(buf: Buffer, offset: number, length: number): number {
  const s = readString(buf, offset, length).trim();
  return s ? parseInt(s, 8) : 0;
}

/**
 * Parse a gzipped USTAR tarball into a Map<path, contentBuffer>.
 * Non-regular entries (directories, symlinks, long-name metadata blocks)
 * are skipped. Returns an empty map if the buffer is empty or unreadable.
 */
export function parseSnapshotTarball(gzipBytes: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  if (!gzipBytes || gzipBytes.length === 0) return out;

  let raw: Buffer;
  try {
    raw = zlib.gunzipSync(gzipBytes);
  } catch (err) {
    console.error("[wos-dashboard] parseSnapshotTarball: gunzip failed", err);
    return out;
  }

  let pos = 0;
  while (pos + BLOCK <= raw.length) {
    const header = raw.subarray(pos, pos + BLOCK);
    // Two consecutive zero blocks terminate the archive.
    if (header.every((b) => b === 0)) break;

    const name = readString(header, 0, 100);
    const size = readOctal(header, 124, 12);
    const typeflag = String.fromCharCode(header[156]);
    const prefix =
      readString(header, 257, 6) === USTAR_MAGIC
        ? readString(header, 345, 155)
        : "";
    const fullName = prefix ? `${prefix}/${name}` : name;

    pos += BLOCK;

    if (typeflag === "0" || typeflag === "" || typeflag === "\0") {
      // Regular file.
      const content = raw.subarray(pos, pos + size);
      out.set(fullName, Buffer.from(content));
    }
    // else: skip directories ('5'), PAX ('x'), long-name ('L'/'K'), etc.
    // We don't need them — the writer only emits regular files.

    // Round size up to the next 512-byte block.
    pos += Math.ceil(size / BLOCK) * BLOCK;
  }

  return out;
}

/**
 * Convenience: load a run's snapshot as a Map<path, contentString>.
 * Returns null when the run has no snapshot (legacy run).
 */
export function getRunSnapshot(runId: string): Map<string, string> | null {
  const blob = getRunSnapshotBlob(runId);
  if (!blob) return null;
  const map = parseSnapshotTarball(blob);
  const out = new Map<string, string>();
  for (const [path, buf] of map) out.set(path, buf.toString("utf8"));
  return out;
}
