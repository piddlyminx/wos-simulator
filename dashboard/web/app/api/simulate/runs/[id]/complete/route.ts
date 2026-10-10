import { NextResponse } from "next/server";

import { completeReportSimulation } from "@/lib/simulation-store";
import type { SimulateApiResult, SimulateRequestPayload } from "@/lib/simulate-run";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await req.json()) as {
      request?: SimulateRequestPayload;
      result?: SimulateApiResult;
    } | null;
    if (!body || !body.request || typeof body.request !== "object" || Array.isArray(body.request)) {
      return NextResponse.json({ error: "request is required" }, { status: 400 });
    }
    if (!body.result || typeof body.result !== "object" || Array.isArray(body.result)) {
      return NextResponse.json({ error: "result is required" }, { status: 400 });
    }
    const saved = await completeReportSimulation(id, body.request, body.result);
    if (!saved) {
      return NextResponse.json(
        { error: `No saved simulation found for ${id}` },
        { status: 404 },
      );
    }
    return NextResponse.json(saved);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
