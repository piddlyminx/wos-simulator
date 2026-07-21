import { NextResponse } from "next/server";

import {
  readSimulationRun,
  setSimulationRunKept,
} from "@/lib/simulation-store";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const saved = await readSimulationRun(id);
    if (!saved) {
      return NextResponse.json(
        { error: `No saved simulation found for ${id}` },
        { status: 404 },
      );
    }
    return NextResponse.json(saved);
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const body = (await req.json()) as { kept?: unknown };
    if (typeof body.kept !== "boolean") {
      return NextResponse.json(
        { error: "kept must be a boolean" },
        { status: 400 },
      );
    }
    const kept = await setSimulationRunKept(id, body.kept);
    if (kept === null) {
      return NextResponse.json(
        { error: `No saved simulation found for ${id}` },
        { status: 404 },
      );
    }
    return NextResponse.json({ id, kept });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }
}
