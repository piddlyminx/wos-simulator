import { parsePatch, applyPatch, createTwoFilesPatch, formatPatch } from "diff";

export function normalizeName(s: string | undefined): string {
  return (s ?? "").replace(/^[ab]\//, "");
}

export function reconstructBefore(parsed: ReturnType<typeof parsePatch>[0]): string {
  const lines: string[] = [];
  for (const hunk of parsed.hunks ?? []) {
    for (const line of hunk.lines) {
      if (line[0] === " " || line[0] === "-") lines.push(line.slice(1));
    }
  }
  return lines.join("\n");
}

export function computeIncrementalDiff(prevPatch: string, currPatch: string): string {
  const parsedPrev = parsePatch(prevPatch);
  const parsedCurr = parsePatch(currPatch);

  const mapPrev = new Map(
    parsedPrev.map((p) => [normalizeName(p.newFileName || p.oldFileName), p])
  );
  const mapCurr = new Map(
    parsedCurr.map((p) => [normalizeName(p.newFileName || p.oldFileName), p])
  );

  const parts: string[] = [];

  for (const [name, filePrev] of mapPrev) {
    const fileCurr = mapCurr.get(name);
    if (!fileCurr) continue;
    mapCurr.delete(name);

    const before = reconstructBefore(filePrev);
    const stateA = applyPatch(before, filePrev);
    const stateB = applyPatch(before, fileCurr);

    if (stateA === false || stateB === false) {
      parts.push(formatPatch([fileCurr]));
      continue;
    }
    if (stateA !== stateB) {
      parts.push(
        createTwoFilesPatch(name, name, stateA, stateB, "prev run", "this run")
      );
    }
  }

  for (const [, fileCurr] of mapCurr) {
    parts.push(formatPatch([fileCurr]));
  }

  return parts.join("\n");
}
