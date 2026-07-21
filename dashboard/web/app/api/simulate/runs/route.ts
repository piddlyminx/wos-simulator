import { NextResponse } from "next/server";

import {
  cleanupSimulationRuns,
  listSimulationRunsPage,
  saveSimulationRun,
} from "@/lib/simulation-store";
import type {
  SavedSimulationKind,
  SavedSimulationRequest,
  SavedSimulationResult,
} from "@/lib/simulate-run";
import { isSavedSimulationKind } from "@/lib/simulate-run";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
    const offset = Number.parseInt(url.searchParams.get("offset") ?? "0", 10);
    const kinds = parseKindFilter(url.searchParams);
    const page = await listSimulationRunsPage({
      limit: Number.isFinite(limit) ? limit : 20,
      offset: Number.isFinite(offset) ? offset : 0,
      kinds,
    });
    return NextResponse.json(page);
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      kind?: SavedSimulationKind;
      request?: SavedSimulationRequest;
      result?: SavedSimulationResult;
    };
    if (!isSavedSimulationKind(body.kind)) {
      return NextResponse.json(
        { error: "kind must be a supported saved simulation kind" },
        { status: 400 },
      );
    }
    if (!body.request || typeof body.request !== "object") {
      return NextResponse.json({ error: "request is required" }, { status: 400 });
    }
    if (!body.result || typeof body.result !== "object") {
      return NextResponse.json({ error: "result is required" }, { status: 400 });
    }
    const saved = await saveSimulationRun(body.kind, body.request, body.result);
    return NextResponse.json({
      saved_run_id: saved.id,
      saved_at: saved.created_at,
      saved_kind: saved.kind,
      share_url: saved.share_url,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  try {
    return NextResponse.json(await cleanupSimulationRuns());
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

function parseKindFilter(searchParams: URLSearchParams): SavedSimulationKind[] | undefined {
  const raw = [
    ...searchParams.getAll("kind"),
    ...(searchParams.get("kinds")?.split(",") ?? []),
  ];
  const kinds = raw
    .map((value) => value.trim())
    .filter(isSavedSimulationKind);
  return kinds.length > 0 ? [...new Set(kinds)] : undefined;
}
