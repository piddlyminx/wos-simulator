import { NextResponse } from "next/server";
import { DB_PATH, getRunCount } from "@/lib/db";
import fs from "fs";

export async function GET() {
  if (!fs.existsSync(DB_PATH)) {
    return NextResponse.json(
      { runs: 0, warning: "DB not found" },
      { status: 200 }
    );
  }

  try {
    const count = getRunCount();
    return NextResponse.json({ runs: count }, { status: 200 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { runs: 0, warning: `DB query failed: ${message}` },
      { status: 200 }
    );
  }
}
