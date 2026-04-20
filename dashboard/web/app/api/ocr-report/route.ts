import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REPO_ROOT = path.resolve(process.cwd(), "../..");
const CLI_PATH = path.join(REPO_ROOT, "dashboard", "ocr_report.py");

function resolvePython(): string {
  if (process.env.SIMULATOR_PYTHON) return process.env.SIMULATOR_PYTHON;
  const venv = path.join(REPO_ROOT, ".venv", "bin", "python");
  if (fs.existsSync(venv)) return venv;
  return "python3";
}

export async function POST(req: NextRequest) {
  let body: { image_base64?: string } | null = null;
  try {
    body = (await req.json()) as { image_base64?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body?.image_base64) {
    return NextResponse.json(
      { error: "Missing 'image_base64' field in request body" },
      { status: 400 },
    );
  }

  if (!fs.existsSync(CLI_PATH)) {
    return NextResponse.json(
      { error: `OCR CLI not found at ${CLI_PATH}` },
      { status: 500 },
    );
  }

  const python = resolvePython();
  const payload = JSON.stringify({ image_base64: body.image_base64 });

  return new Promise<Response>((resolve) => {
    const child = spawn(python, [CLI_PATH], {
      cwd: REPO_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    const kill = setTimeout(() => {
      child.kill("SIGKILL");
    }, 55_000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      clearTimeout(kill);
      resolve(
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
        resolve(
          NextResponse.json(
            {
              error:
                (parsedErr as { error?: string })?.error ||
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
        resolve(NextResponse.json(parsed));
      } catch (err) {
        resolve(
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
