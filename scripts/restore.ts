/**
 * RESTAURATION D'UNE SAUVEGARDE — script d'administration LOCAL uniquement.
 *
 *   npm run restore -- chemin\vers\sauvegarde.json            (base cible vide)
 *   npm run restore -- chemin\vers\sauvegarde.json.gz --wipe  (écrase TOUTES les données)
 *   npm run restore -- chemin\vers\sauvegarde.json --check    (vérifie le fichier sans rien écrire)
 *
 * La base cible est celle de DATABASE_URL (.env.local). Testez d'abord sur une branche Neon.
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createInterface } from "node:readline/promises";
import { verifyBackup } from "../src/server/backup/export";
import { restoreBackup } from "../src/server/backup/restore";
import { connect } from "./_db";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const wipe = args.includes("--wipe");
const checkOnly = args.includes("--check");
if (!file) {
  console.error("Usage : npm run restore -- <fichier.json|fichier.json.gz> [--wipe] [--check]");
  process.exit(1);
}

const buf = readFileSync(file);
const raw = JSON.parse((file.endsWith(".gz") ? gunzipSync(buf) : buf).toString("utf8"));
const v = verifyBackup(raw);
if (!v.ok) {
  console.error(`✖ Fichier refusé : ${v.error}`);
  process.exit(1);
}
console.log(`✔ Fichier valide — export du ${v.file.exportedAt}`);
console.table(v.file.counts);
if (checkOnly) process.exit(0);

const { db, close, label } = await connect();
console.log(`Cible : ${label}`);
const rl = createInterface({ input: process.stdin, output: process.stdout });
const answer = await rl.question(
  wipe
    ? "ATTENTION : toutes les données actuelles de cette base seront EFFACÉES puis remplacées. Tapez RESTAURER pour continuer : "
    : "Restaurer dans cette base (elle doit être vide) ? Tapez RESTAURER pour continuer : ",
);
rl.close();
if (answer.trim() !== "RESTAURER") {
  console.log("Annulé. Aucune modification.");
  await close();
  process.exit(0);
}
try {
  const counts = await restoreBackup(db, raw, { wipe });
  console.log("✔ Restauration terminée :");
  console.table(counts);
} catch (e) {
  console.error("✖ Restauration annulée (aucune modification) :", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await close();
}
