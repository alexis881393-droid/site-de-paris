import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/server/db/schema";
import type { Db } from "@/server/db/client";
import { addDriver, createRace, openBets } from "@/server/services/commands";

/** Base PostgreSQL réelle (PGlite, en mémoire) avec toutes les migrations et triggers. */
export async function createTestDb(): Promise<{ db: Db; client: PGlite }> {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return { db: db as unknown as Db, client };
}

export async function setupOpenRace(db: Db, opts: { commission?: string; drivers?: string[]; name?: string } = {}) {
  const race = await createRace(db, { name: opts.name ?? "Grand Prix Test", commissionPercent: opts.commission ?? "15" });
  const ds = [];
  for (const [i, n] of (opts.drivers ?? ["Alpha", "Bravo", "Charlie"]).entries()) {
    ds.push(await addDriver(db, race.id, { name: n, number: i + 1 }));
  }
  await openBets(db, race.id);
  return { race, drivers: ds };
}
