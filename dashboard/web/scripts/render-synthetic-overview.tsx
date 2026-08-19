import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";
import { renderToStaticMarkup } from "react-dom/server";

import {
  SyntheticBattleOverview,
  syntheticBattleOverviewCss,
} from "../components/reports/SyntheticBattleOverview";
import { buildSyntheticBattleOverview } from "../lib/synthetic-report";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");

function outputArgument(): string {
  const index = process.argv.indexOf("--output");
  if (index === -1) {
    return path.join(repoRoot, "artifacts/synthetic-reports/battle-overview-proof.png");
  }
  const value = process.argv[index + 1];
  if (!value) throw new Error("--output requires a path");
  return path.resolve(process.cwd(), value);
}

async function pngDataUrl(filePath: string): Promise<string> {
  const data = await readFile(filePath);
  return `data:image/png;base64,${data.toString("base64")}`;
}

async function fontDataUrl(filePath: string, mimeType: string): Promise<string> {
  const data = await readFile(filePath);
  return `data:${mimeType};base64,${data.toString("base64")}`;
}

function croppedImageDataUrl(
  sourceDataUrl: string,
  source: { width: number; height: number },
  crop: { x: number; y: number; width: number; height: number },
): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${crop.width}" height="${crop.height}" viewBox="0 0 ${crop.width} ${crop.height}"><image href="${sourceDataUrl}" x="-${crop.x}" y="-${crop.y}" width="${source.width}" height="${source.height}" /></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

async function main(): Promise<void> {
  const output = outputArgument();
  const [capturedReport, reportFont] = await Promise.all([
    pngDataUrl(
      path.join(repoRoot, "skill/captures/reports/20260818T132901Z_war/report_01_long.png"),
    ),
    fontDataUrl("/usr/share/fonts/opentype/tlwg/Loma-Bold.otf", "font/otf"),
  ]);
  const sourceSize = { width: 720, height: 3859 };
  const banner = croppedImageDataUrl(capturedReport, sourceSize, {
    x: 25,
    y: 111,
    width: 670,
    height: 142,
  });
  const leftAvatar = croppedImageDataUrl(capturedReport, sourceSize, {
    x: 98,
    y: 347,
    width: 116,
    height: 116,
  });
  const rightAvatar = croppedImageDataUrl(capturedReport, sourceSize, {
    x: 489,
    y: 347,
    width: 116,
    height: 116,
  });

  const report = buildSyntheticBattleOverview({
    winner: "left",
    timestamp: "2026-08-17 23:00:52",
    seed: "synthetic-proof-451",
    left: {
      name: "[ARK]Piddlyminxxx",
      coordinates: "X:786 Y:573",
      initialTroops: 500,
      survivors: 301,
      powerChange: -1400,
      avatarDataUrl: leftAvatar,
    },
    right: {
      name: "[BBQ]XxWIPxX",
      coordinates: "X:790 Y:573",
      initialTroops: 500,
      survivors: 0,
      powerChange: -3500,
      avatarDataUrl: rightAvatar,
    },
  });

  const markup = renderToStaticMarkup(
    <SyntheticBattleOverview report={report} bannerDataUrl={banner} avatarsAreFramed />,
  );
  const html = `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          @font-face {
            font-family: "Lilita One";
            font-style: normal;
            font-weight: 400;
            font-display: block;
            src: url("https://fonts.gstatic.com/s/lilitaone/v17/i7dPIFZ9Zz-WBtRtedDbUEY.ttf") format("truetype");
          }
          @font-face {
            font-family: "WOS Report";
            font-style: normal;
            font-weight: 700;
            font-display: block;
            src: url("${reportFont}") format("opentype");
          }
          ${syntheticBattleOverviewCss}
        </style>
      </head>
      <body>${markup}</body>
    </html>`;

  await mkdir(path.dirname(output), { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      viewport: { width: 720, height: 1000 },
      deviceScaleFactor: 1,
    });
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        Array.from(document.images, (image) =>
          image.complete
            ? Promise.resolve()
            : new Promise<void>((resolve, reject) => {
                image.addEventListener("load", () => resolve(), { once: true });
                image.addEventListener("error", () => reject(new Error("Image failed to load")), {
                  once: true,
                });
              }),
        ),
      );
    });
    const reportElement = page.locator("#synthetic-report");
    await reportElement.screenshot({ path: output });
    const box = await reportElement.boundingBox();
    process.stdout.write(
      `${JSON.stringify({ ok: true, output, width: box?.width, height: box?.height }, null, 2)}\n`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
