import { NextResponse } from "next/server";

import { listSimulationRuns, saveSimulationRun } from "@/lib/simulation-store";
import type {
  SavedSimulationKind,
  SavedSimulationRequest,
  SavedSimulationResult,
} from "@/lib/simulate-run";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Number.parseInt(url.searchParams.get("limit") ?? "20", 10);
    const runs = await listSimulationRuns(Number.isFinite(limit) ? limit : 20);
    return NextResponse.json({ runs });
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
    if (body.kind !== "simulate" && body.kind !== "optimize_ratio") {
      return NextResponse.json(
        { error: "kind must be simulate or optimize_ratio" },
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
