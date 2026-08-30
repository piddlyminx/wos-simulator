import { NextResponse } from "next/server";

import {
  createSavedRunOwnerToken,
  hashSavedRunOwnerToken,
  readSavedRunOwnerToken,
  SAVED_RUN_OWNER_COOKIE,
  SAVED_RUN_OWNER_COOKIE_MAX_AGE,
} from "@/lib/saved-run-owner";
import {
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
    const scope = url.searchParams.get("scope") ?? "all";
    if (scope !== "mine" && scope !== "starred" && scope !== "all") {
      return NextResponse.json(
        { error: "scope must be mine, starred, or all" },
        { status: 400 },
      );
    }
    const ownerToken = readSavedRunOwnerToken(req);
    if (scope !== "all" && !ownerToken) {
      return NextResponse.json({ runs: [], has_more: false, next_offset: 0 });
    }
    const page = await listSimulationRunsPage({
      limit: Number.isFinite(limit) ? limit : 20,
      offset: Number.isFinite(offset) ? offset : 0,
      kinds,
      ownerHash:
        scope !== "all" && ownerToken
          ? hashSavedRunOwnerToken(ownerToken)
          : undefined,
      kept: scope === "starred" ? true : undefined,
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
    const currentOwnerToken = readSavedRunOwnerToken(req);
    const ownerToken = currentOwnerToken ?? createSavedRunOwnerToken();
    const saved = await saveSimulationRun(
      body.kind,
      body.request,
      body.result,
      hashSavedRunOwnerToken(ownerToken),
    );
    const response = NextResponse.json({
      saved_run_id: saved.id,
      saved_at: saved.created_at,
      saved_kind: saved.kind,
      share_url: saved.share_url,
    });
    response.cookies.set({
      name: SAVED_RUN_OWNER_COOKIE,
      value: ownerToken,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SAVED_RUN_OWNER_COOKIE_MAX_AGE,
    });
    return response;
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
