import "server-only";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type DbOrTx = Db | Tx;

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL n'est pas configurée.");
    this.name = "DatabaseNotConfiguredError";
  }
}

type Cache = { db?: Promise<Db> };
const g = globalThis as unknown as { __racebetDb?: Cache };
const cache: Cache = (g.__racebetDb ??= {});

export function databaseMode(): "neon" | "pglite" | "none" {
  if (process.env.DATABASE_DRIVER === "pglite") return "pglite";
  return process.env.DATABASE_URL ? "neon" : "none";
}

async function createDb(): Promise<Db> {
  const mode = databaseMode();
  if (mode === "pglite") {
    if (process.env.VERCEL) throw new Error("DATABASE_DRIVER=pglite est réservé au développement local.");
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    const client = new PGlite(process.env.PGLITE_DIR ?? "./.pglite");
    const db = drizzle({ client, schema });
    await migrate(db, { migrationsFolder: "./drizzle" });
    return db as unknown as Db;
  }
  if (mode === "none") throw new DatabaseNotConfiguredError();

  const { Pool, neonConfig } = await import("@neondatabase/serverless");
  const { drizzle } = await import("drizzle-orm/neon-serverless");
  if (typeof globalThis.WebSocket === "undefined") {
    const ws = (await import("ws")).default;
    neonConfig.webSocketConstructor = ws;
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  return drizzle({ client: pool, schema }) as unknown as Db;
}

export function getDb(): Promise<Db> {
  if (!cache.db) {
    cache.db = createDb().catch((e) => {
      cache.db = undefined;
      throw e;
    });
  }
  return cache.db;
}
