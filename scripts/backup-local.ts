/** Sauvegarde complète vers un fichier local ./backups/racebet-<date>.json (alternative à l'export du site). */
import { mkdirSync, writeFileSync } from "node:fs";
import { buildBackup } from "../src/server/backup/export";
import { connect } from "./_db";

const { db, close, label } = await connect();
try {
  const backup = await buildBackup(db);
  mkdirSync("backups", { recursive: true });
  const path = `backups/racebet-${backup.exportedAt.replace(/[:.]/g, "-")}.json`;
  writeFileSync(path, JSON.stringify(backup, null, 2));
  console.log(`✔ ${label} → ${path}`);
  console.table(backup.counts);
} finally {
  await close();
}
