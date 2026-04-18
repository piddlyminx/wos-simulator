import Link from "next/link";
import { getHeroes } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function HeroesPage() {
  const heroes = getHeroes();

  return (
    <div>
      <h2
        className="text-lg font-bold mb-4"
        style={{ color: "var(--sidebar-active)" }}
      >
        Heroes
      </h2>

      {heroes.length === 0 ? (
        <div
          className="rounded p-6 text-sm opacity-60"
          style={{ border: "1px solid var(--border-color)" }}
        >
          No heroes found. The database may not exist yet — run{" "}
          <code className="font-mono">check_testcases.py</code> to populate it.
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
                <th className="pb-2 pr-4">Tier</th>
                <th className="pb-2">Classes</th>
              </tr>
            </thead>
            <tbody>
              {heroes.map((hero) => {
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
                        {hero.tier ?? "—"}
                      </span>
                    </td>
                    <td className="py-2 text-xs opacity-60">
                      {classes.join(", ") || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
