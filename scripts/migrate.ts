/** Applique les migrations Drizzle (tables, contraintes, triggers d'intégrité). Idempotent. */
import { connect } from "./_db";

const { db, close, label } = await connect();
console.log(`Migrations → ${label}`);
try {
  if (label.startsWith("PGlite")) {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(db as never, { migrationsFolder: "./drizzle" });
  } else {
    const { migrate } = await import("drizzle-orm/neon-serverless/migrator");
    await migrate(db as never, { migrationsFolder: "./drizzle" });
  }
  console.log("✔ Base à jour.");
} catch (e) {
  console.error("✖ Échec des migrations :", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await close();
}
