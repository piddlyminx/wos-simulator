import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import { withDirectoryLock } from "@/lib/file-lock";
import { resolveSimulatorRoot } from "@/lib/simulator-root";
import {
  buildSimulationShareUrl,
  buildSimulationRunTitle,
  type SavedSimulationKind,
  type SavedSimulationRequest,
  type SavedSimulationResult,
  type SavedSimulationRunListItem,
  type SavedSimulationRunDocument,
  type SavedSimulationRunResponse,
} from "@/lib/simulate-run";

const ID_RE = /^[A-Za-z0-9_-]{8,128}$/;

export const SIM_RUNS_DIR =
  process.env.SIM_RUNS_DIR ??
  path.join(resolveSimulatorRoot(), "tmp", "simulate-runs");

function runPath(id: string): string {
  if (!ID_RE.test(id)) {
    throw new Error(`Invalid saved simulation id: ${id}`);
  }
  return path.join(SIM_RUNS_DIR, `${id}.json`);
}

async function ensureStoreDir(): Promise<void> {
  await fs.mkdir(SIM_RUNS_DIR, { recursive: true });
}

function withShareUrl(
  doc: SavedSimulationRunDocument,
): SavedSimulationRunResponse {
  return {
    ...doc,
    share_url: buildSimulationShareUrl(doc.id),
  };
}

function assertSavedSimulationDoc(
  value: unknown,
): SavedSimulationRunDocument {
  if (!value || typeof value !== "object") {
    throw new Error("Saved simulation document is missing");
  }
  const doc = value as Partial<SavedSimulationRunDocument>;
  if (
    doc.version !== 1 ||
    typeof doc.id !== "string" ||
    !ID_RE.test(doc.id) ||
    (doc.kind !== "simulate" && doc.kind !== "optimize_ratio") ||
    typeof doc.created_at !== "string" ||
    doc.request === undefined ||
    doc.result === undefined
  ) {
    throw new Error("Saved simulation document is malformed");
  }
  return doc as SavedSimulationRunDocument;
}

export async function saveSimulationRun(
  kind: SavedSimulationKind,
  request: SavedSimulationRequest,
  result: SavedSimulationResult,
): Promise<SavedSimulationRunResponse> {
  await ensureStoreDir();

  return withDirectoryLock(SIM_RUNS_DIR, async () => {
    const id = randomUUID();
    const doc: SavedSimulationRunDocument = {
      version: 1,
      id,
      kind,
      created_at: new Date().toISOString(),
      request,
      result,
    };

    const filePath = runPath(id);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, filePath);
    return withShareUrl(doc);
  });
}

export async function readSimulationRun(
  id: string,
): Promise<SavedSimulationRunResponse | null> {
  await ensureStoreDir();
  return withDirectoryLock(SIM_RUNS_DIR, async () => {
    try {
      const raw = await fs.readFile(runPath(id), "utf8");
      return withShareUrl(assertSavedSimulationDoc(JSON.parse(raw)));
    } catch (err) {
      const nodeErr = err as NodeJS.ErrnoException;
      if (nodeErr?.code === "ENOENT") {
        return null;
      }
      throw err;
    }
  });
}

export async function listSimulationRuns(
  limit = 20,
): Promise<SavedSimulationRunListItem[]> {
  await ensureStoreDir();
  return withDirectoryLock(SIM_RUNS_DIR, async () => {
    const entries = await fs.readdir(SIM_RUNS_DIR, { withFileTypes: true });
    const docs: SavedSimulationRunDocument[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(
          path.join(SIM_RUNS_DIR, entry.name),
          "utf8",
        );
        docs.push(assertSavedSimulationDoc(JSON.parse(raw)));
      } catch {
        // Ignore partial or stale scratch files so one bad save does not break
        // the recent-run picker.
      }
    }

    return docs
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, Math.max(1, Math.min(100, limit)))
      .map((doc) => ({
        id: doc.id,
        kind: doc.kind,
        created_at: doc.created_at,
        share_url: buildSimulationShareUrl(doc.id),
        title: buildSimulationRunTitle(doc.request),
      }));
  });
}
