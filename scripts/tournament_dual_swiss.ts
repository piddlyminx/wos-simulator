#!/usr/bin/env tsx
import { main } from "../v3/src/tournament/dualSwissCli.js";

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
