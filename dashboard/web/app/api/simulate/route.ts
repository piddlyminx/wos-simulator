import { NextRequest } from "next/server";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

import { saveSimulationRun } from "@/lib/simulation-store";
import type {
  SimulateApiResult,
  SimulateRequestPayload,
} from "@/lib/simulate-run";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REPO_ROOT = path.resolve(process.cwd(), "../..");
const CLI_PATH = path.join(REPO_ROOT, "dashboard", "simulate_battle.py");

function resolvePython(): string {
  if (process.env.SIMULATOR_PYTHON) return process.env.SIMULATOR_PYTHON;
  const venv = path.join(REPO_ROOT, ".venv", "bin", "python");
  if (fs.existsSync(venv)) return venv;
  return "python3";
}

const enc = (obj: unknown) =>
  new TextEncoder().encode(JSON.stringify(obj) + "\n");

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(enc({ type: "error", message: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/x-ndjson" },
    });
  }

  if (!fs.existsSync(CLI_PATH)) {
    return new Response(
      enc({ type: "error", message: `Simulator CLI not found at ${CLI_PATH}` }),
      { status: 500, headers: { "Content-Type": "application/x-ndjson" } },
    );
  }

  const python = resolvePython();
  const payload = JSON.stringify(body);

  const stream = new ReadableStream({
    start(controller) {
      const child = spawn(python, [CLI_PATH], {
        cwd: REPO_ROOT,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderrBuf = "";
      let stderrErrors = "";

      const kill = setTimeout(() => child.kill("SIGKILL"), 55_000);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderrBuf += chunk.toString();
        const lines = stderrBuf.split("\n");
        stderrBuf = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const event = JSON.parse(trimmed) as {
              type: string;
              done: number;
              total: number;
            };
            if (event.type === "progress") {
              controller.enqueue(enc(event));
            }
          } catch {
            stderrErrors += (stderrErrors ? "\n" : "") + trimmed;
          }
        }
      });

      child.on("error", (err: Error) => {
        clearTimeout(kill);
        controller.enqueue(
          enc({ type: "error", message: `Failed to spawn simulator: ${err.message}` }),
        );
        controller.close();
      });

      child.on("close", (code: number | null) => {
        clearTimeout(kill);
        if (code !== 0) {
          controller.enqueue(
            enc({
              type: "error",
              message:
                stderrErrors.slice(0, 4000) ||
                `Simulator exited with code ${code}`,
            }),
          );
          controller.close();
          return;
        }

        let parsed: SimulateApiResult;
        try {
          parsed = JSON.parse(stdout) as SimulateApiResult;
        } catch (err) {
          controller.enqueue(
            enc({
              type: "error",
              message: "Failed to parse simulator output",
              parseError: err instanceof Error ? err.message : String(err),
            }),
          );
          controller.close();
          return;
        }

        void saveSimulationRun("simulate", body as SimulateRequestPayload, parsed)
          .then((saved) => {
            controller.enqueue(
              enc({
                type: "result",
                data: {
                  ...parsed,
                  saved_run_id: saved.id,
                  saved_at: saved.created_at,
                  saved_kind: saved.kind,
                  share_url: saved.share_url,
                },
              }),
            );
            controller.close();
          })
          .catch((saveErr) => {
            controller.enqueue(
              enc({
                type: "error",
                message: `Simulation completed but failed to save: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}`,
              }),
            );
            controller.close();
          });
      });

      child.stdin.write(payload);
      child.stdin.end();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Transfer-Encoding": "chunked",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
