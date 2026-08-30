import { expect, test } from "@playwright/test";

test("POST /api/simulate/runs saves a computed simulation result", async ({ request }) => {
  const emptyMineResponse = await request.get(
    "/api/simulate/runs?scope=mine&kinds=simulate&limit=100",
  );
  expect(emptyMineResponse.ok()).toBeTruthy();
  expect((await emptyMineResponse.json()).runs).toEqual([]);
  const emptyStarredResponse = await request.get(
    "/api/simulate/runs?scope=starred&kinds=simulate&limit=100",
  );
  expect(emptyStarredResponse.ok()).toBeTruthy();
  expect((await emptyStarredResponse.json()).runs).toEqual([]);

  const response = await request.post("/api/simulate/runs", {
    data: {
      kind: "simulate",
      request: {
        attacker: {
          troops: { infantry: 1, lancer: 0, marksman: 0 },
          troop_types: { infantry: "infantry_t6", lancer: "lancer_t6", marksman: "marksman_t6" },
          heroes: {},
          joiners: [],
          stats: { inf: [100, 100, 100, 100], lanc: [100, 100, 100, 100], mark: [100, 100, 100, 100] },
        },
        defender: {
          troops: { infantry: 1, lancer: 0, marksman: 0 },
          troop_types: { infantry: "infantry_t6", lancer: "lancer_t6", marksman: "marksman_t6" },
          heroes: {},
          joiners: [],
          stats: { inf: [100, 100, 100, 100], lanc: [100, 100, 100, 100], mark: [100, 100, 100, 100] },
        },
        replicates: 1,
        rally_mode: false,
      },
      result: {
        replicates: 1,
        summary: {
          mean: 0,
          std: 0,
          best: { value: 0, winner: "draw" },
          worst: { value: 0, winner: "draw" },
          attacker_win_rate: 0,
          avg_rounds: 1,
          avg_skill_activations: 0,
          avg_skill_kills: 0,
          avg_attacker_activations: 0,
          avg_defender_activations: 0,
          avg_attacker_kills: 0,
          avg_defender_kills: 0,
        },
        outcomes: [0],
        per_side_skills: { attacker: [], defender: [] },
      },
    },
  });
  expect(response.ok()).toBeTruthy();
  expect(response.headers()["set-cookie"]).toContain("wos_saved_run_owner=");
  const body = await response.json();
  expect(body.saved_kind).toBe("simulate");
  expect(body.share_url).toMatch(/^\/simulate\?run=/);

  const mineResponse = await request.get(
    "/api/simulate/runs?scope=mine&kinds=simulate&limit=100",
  );
  expect(mineResponse.ok()).toBeTruthy();
  const mine = await mineResponse.json();
  expect(mine.runs.map((run: { id: string }) => run.id)).toContain(
    body.saved_run_id,
  );

  const starResponse = await request.patch(
    `/api/simulate/runs/${body.saved_run_id}`,
    { data: { kept: true } },
  );
  expect(starResponse.ok()).toBeTruthy();
  expect(await starResponse.json()).toEqual({
    id: body.saved_run_id,
    kept: true,
  });

  const starredResponse = await request.get(
    "/api/simulate/runs?scope=starred&kinds=simulate&limit=100",
  );
  expect(starredResponse.ok()).toBeTruthy();
  const starred = await starredResponse.json();
  expect(starred.runs.map((run: { id: string }) => run.id)).toContain(
    body.saved_run_id,
  );

  const deleteResponse = await request.delete("/api/simulate/runs");
  expect(deleteResponse.status()).toBe(405);
});
