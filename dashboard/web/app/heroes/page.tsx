import Link from "next/link";
import { getHeroes, getMissingTables } from "@/lib/db";
import type { Hero } from "@/types/dashboard";

export const dynamic = "force-dynamic";

const GEN_ORDER = ["Gen 7", "Gen 6", "Gen 5", "Gen 4", "Gen 3", "Gen 2", "Gen 1", "SR"];

export default function HeroesPage() {
  const missingTables = getMissingTables();
  const heroes = getHeroes();

  return (
    <div>
      <h2
        className="text-lg font-bold mb-4"
        style={{ color: "var(--sidebar-active)" }}
      >
        Heroes
      </h2>

      {missingTables.length > 0 && (
        <div
          className="rounded p-3 mb-4 text-sm font-mono"
          style={{
            border: "1px solid #f38ba8",
            backgroundColor: "rgba(243,139,168,0.08)",
            color: "#f38ba8",
          }}
        >
          DB misconfiguration: missing tables:{" "}
          <strong>{missingTables.join(", ")}</strong>. Run{" "}
          <code>python dashboard/seed_heroes.py</code> to seed the hero
          catalogue.
        </div>
      )}

      {heroes.length === 0 ? (
        <div
          className="rounded p-6 text-sm opacity-60"
          style={{ border: "1px solid var(--border-color)" }}
        >
          {missingTables.length > 0
            ? "Heroes table is missing — see the error above."
            : "No heroes found. Run python dashboard/seed_heroes.py to seed the hero catalogue."}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table
            className="w-full text-sm border-collapse"
            style={{ borderColor: "var(--border-color)" }}
          >
            <thead>
              <tr
                className="text-left text-xs uppercase tracking-wider opacity-60"
                style={{ borderBottom: "1px solid var(--border-color)" }}
              >
                <th className="pb-2 pr-4">Name</th>
                <th className="pb-2 pr-4">Gen</th>
                <th className="pb-2">Classes</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const byGen = new Map<string, Hero[]>();
                for (const h of heroes) {
                  const g = h.generation ?? "Unknown";
                  if (!byGen.has(g)) byGen.set(g, []);
                  byGen.get(g)!.push(h);
                }
                const groups = [...GEN_ORDER, "Unknown"].filter((g) =>
                  byGen.has(g)
                );
                return groups.flatMap((gen) => [
                  <tr key={`gen-${gen}`}>
                    <td
                      colSpan={3}
                      className="pt-4 pb-1 text-xs uppercase tracking-widest opacity-40 font-mono"
                    >
                      {gen}
                    </td>
                  </tr>,
                  ...byGen.get(gen)!.map((hero) => {
                    let classes: string[] = [];
                    try {
                      classes = JSON.parse(hero.classes ?? "[]");
                    } catch {
                      // ignore
                    }
                    return (
                      <tr
                        key={hero.name}
                        className="transition-colors"
                        style={{ borderBottom: "1px solid var(--border-color)" }}
                      >
                        <td className="py-2 pr-4 font-mono">
                          <Link
                            href={"/heroes/" + encodeURIComponent(hero.name)}
                            style={{ color: "var(--sidebar-active)" }}
                            className="hover:underline"
                          >
                            {hero.name}
                          </Link>
                        </td>
                        <td className="py-2 pr-4">
                          <span
                            className="inline-block px-2 py-0.5 rounded text-xs font-bold font-mono"
                            style={{
                              backgroundColor: "var(--sidebar-bg)",
                              border: "1px solid var(--border-color)",
                              color: "var(--sidebar-active)",
                            }}
                          >
                            {hero.generation ?? "—"}
                          </span>
                        </td>
                        <td className="py-2 text-xs opacity-60">
                          {classes.join(", ") || "—"}
                        </td>
                      </tr>
                    );
                  }),
                ]);
              })()}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
