import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REPO_ROOT = path.resolve(process.cwd(), "../..");
const CLI_PATH = path.join(REPO_ROOT, "skill", "scripts", "report_stats_parser.py");
const OCR_TIMEOUT_MS = 55_000;
const OCR_MAX_IMAGE_BYTES = parsePositiveInt(
  process.env.OCR_MAX_IMAGE_BYTES,
  8 * 1024 * 1024,
);
const OCR_MAX_REQUEST_BYTES = parsePositiveInt(
  process.env.OCR_MAX_REQUEST_BYTES,
  Math.ceil((OCR_MAX_IMAGE_BYTES * 4) / 3) + 4096,
);
const OCR_MAX_CONCURRENT = parsePositiveInt(
  process.env.OCR_MAX_CONCURRENT,
  1,
);

let activeOcrRequests = 0;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function base64Payload(value: string): string {
  const comma = value.indexOf(",");
  return (comma >= 0 ? value.slice(comma + 1) : value).replace(/\s/g, "");
}

function estimatedBase64Bytes(value: string): number {
  const payload = base64Payload(value);
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding);
}

function acquireOcrSlot(): boolean {
  if (activeOcrRequests >= OCR_MAX_CONCURRENT) return false;
  activeOcrRequests += 1;
  return true;
}

function releaseOcrSlot() {
  activeOcrRequests = Math.max(0, activeOcrRequests - 1);
}

function resolvePython(): string {
  if (process.env.SIMULATOR_PYTHON) return process.env.SIMULATOR_PYTHON;
  const venv = path.join(REPO_ROOT, ".venv", "bin", "python");
  if (fs.existsSync(venv)) return venv;
  return "python3";
}

export async function POST(req: NextRequest) {
  const contentLength = Number.parseInt(req.headers.get("content-length") ?? "0", 10);
  if (Number.isFinite(contentLength) && contentLength > OCR_MAX_REQUEST_BYTES) {
    return NextResponse.json(
      {
        error: `OCR request is too large. Limit is ${OCR_MAX_REQUEST_BYTES} bytes.`,
      },
      { status: 413 },
    );
  }

  let body: { image_base64?: string } | null = null;
  try {
    body = (await req.json()) as { image_base64?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body?.image_base64 || typeof body.image_base64 !== "string") {
    return NextResponse.json(
      { error: "Missing 'image_base64' field in request body" },
      { status: 400 },
    );
  }

  if (estimatedBase64Bytes(body.image_base64) > OCR_MAX_IMAGE_BYTES) {
    return NextResponse.json(
      {
        error: `OCR image is too large. Limit is ${OCR_MAX_IMAGE_BYTES} decoded bytes.`,
      },
      { status: 413 },
    );
  }

  if (!fs.existsSync(CLI_PATH)) {
    return NextResponse.json(
      { error: `Report parser CLI not found at ${CLI_PATH}` },
      { status: 500 },
    );
  }

  const python = resolvePython();
  const payload = JSON.stringify({ image_base64: body.image_base64 });

  if (!acquireOcrSlot()) {
    return NextResponse.json(
      { error: "OCR is already processing another report. Try again shortly." },
      { status: 429 },
    );
  }

  return new Promise<Response>((resolve) => {
    const finish = (response: Response) => {
      releaseOcrSlot();
      resolve(response);
    };

    const child = spawn(python, [CLI_PATH], {
      cwd: REPO_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const kill = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, OCR_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      clearTimeout(kill);
      finish(
        NextResponse.json(
          { error: `Failed to spawn OCR process: ${err.message}` },
          { status: 500 },
        ),
      );
    });

    child.on("close", (code) => {
      clearTimeout(kill);
      if (code !== 0) {
        // The CLI emits JSON errors on stdout even on failure; try to forward it.
        let parsedErr: unknown = null;
        try {
          parsedErr = JSON.parse(stdout);
        } catch {
          /* ignore */
        }
        finish(
          NextResponse.json(
            {
              error:
                timedOut
                  ? `OCR process timed out after ${OCR_TIMEOUT_MS}ms`
                  : (parsedErr as { error?: string })?.error ||
                    `OCR process exited with code ${code}`,
              stderr: stderr.slice(0, 4000),
            },
            { status: 500 },
          ),
        );
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        finish(NextResponse.json(parsed));
      } catch (err) {
        finish(
          NextResponse.json(
            {
              error: "Failed to parse OCR output",
              raw: stdout.slice(0, 4000),
              parseError: err instanceof Error ? err.message : String(err),
            },
            { status: 500 },
          ),
        );
      }
    });

    child.stdin.write(payload);
    child.stdin.end();
  });
}
