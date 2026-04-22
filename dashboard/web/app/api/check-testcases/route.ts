import { NextRequest, NextResponse } from "next/server";
import {
  getCheckNowStatus,
  startCheckNow,
} from "@/lib/check-now";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET() {
  return NextResponse.json(getCheckNowStatus(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const matchingInput =
    typeof body === "object" &&
    body !== null &&
    "matchingInput" in body &&
    typeof body.matchingInput === "string"
      ? body.matchingInput
      : "";

  const current = getCheckNowStatus();
  if (current.state === "running") {
    return NextResponse.json(current, {
      status: 409,
      headers: { "Cache-Control": "no-store" },
    });
  }

  try {
    const status = startCheckNow(matchingInput);
    return NextResponse.json(status, {
      status: 202,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to start check_testcases.py",
      },
      { status: 500 },
    );
  }
}
