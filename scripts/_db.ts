/**
 * Connexion base pour les scripts d'administration LOCAUX (jamais exécutés par le site).
 * Lit .env.local puis .env.
 */
import { config } from "dotenv";
import * as schema from "../src/server/db/schema";
import type { Db } from "../src/server/db/client";

config({ path: ".env.local" });
config();

export async function connect(): Promise<{ db: Db; close: () => Promise<void>; label: string }> {
  if (process.env.DATABASE_DRIVER === "pglite") {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const dir = process.env.PGLITE_DIR ?? "./.pglite";
    const client = new PGlite(dir);
    return { db: drizzle({ client, schema }) as unknown as Db, close: () => client.close(), label: `PGlite (${dir})` };
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL manquante. Renseignez-la dans .env.local (voir .env.example).");
    process.exit(1);
  }
  const { Pool, neonConfig } = await import("@neondatabase/serverless");
  const { drizzle } = await import("drizzle-orm/neon-serverless");
  if (typeof globalThis.WebSocket === "undefined") neonConfig.webSocketConstructor = (await import("ws")).default;
  const pool = new Pool({ connectionString: url });
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return "hôte inconnu";
    }
  })();
  return { db: drizzle({ client: pool, schema }) as unknown as Db, close: () => pool.end(), label: `Neon (${host})` };
}
