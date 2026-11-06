import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/server/db/schema";
import type { Db } from "@/server/db/client";
import { closeBets, paySettlement, placeBet, recordResult } from "@/server/services/commands";
import { getRaceDetail } from "@/server/services/queries";
import { setupOpenRace } from "./helpers";

const dir = mkdtempSync(path.join(tmpdir(), "racebet-persist-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

async function open() {
  const client = new PGlite(dir);
  const db = drizzle({ client, schema }) as unknown as Db;
  await migrate(db as never, { migrationsFolder: "./drizzle" });
  return { db, client };
}

describe("Test 10 — persistance", () => {
  it("toutes les données survivent à la fermeture et à une nouvelle session", async () => {
    const s1 = await open();
    const { race, drivers: [A, B] } = await setupOpenRace(s1.db);
    await placeBet(s1.db, race.id, { bettorName: "Persistant", driverId: A!.id, amount: 9000 });
    await placeBet(s1.db, race.id, { bettorName: "Autre", driverId: B!.id, amount: 1000 });
    await closeBets(s1.db, race.id);
    await recordResult(s1.db, race.id, { winnerDriverId: A!.id });
    const before = await getRaceDetail(s1.db, race.id);
    await paySettlement(s1.db, before.bets[0]!.settlement!.id);
    const snapshot = await getRaceDetail(s1.db, race.id);
    await s1.client.close();

    // Nouvelle session : nouvelle connexion, migrations rejouées (idempotentes).
    const s2 = await open();
    const after = await getRaceDetail(s2.db, race.id);
    expect({ ...after, serverTime: "" }).toEqual({ ...snapshot, serverTime: "" });
    expect(after.race.status).toBe("paid");
    await s2.client.close();
  });
});
