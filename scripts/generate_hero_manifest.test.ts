import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { loadSimulatorConfig } from "../simulator/src/config";
import {
  GENERATED_MANIFEST_PATH,
  discoverHeroDefinitionFiles,
  generatedHeroManifestSource,
} from "./generate_hero_manifest";

test("generated hero manifest matches every definition file", () => {
  assert.equal(
    readFileSync(GENERATED_MANIFEST_PATH, "utf8"),
    generatedHeroManifestSource(),
  );

  const configuredNames = Object.keys(loadSimulatorConfig().heroDefinitions).sort();
  const discoveredNames = discoverHeroDefinitionFiles().map((file) =>
    file.slice(0, -".json".length),
  );
  assert.deepEqual(configuredNames, discoveredNames);
});
