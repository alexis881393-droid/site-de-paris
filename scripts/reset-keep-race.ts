/**
 * REMISE À ZÉRO EN GARDANT UNE COURSE — script d'administration LOCAL uniquement.
 *
 *   npm run reset:keep -- "Liste noire"            (aperçu : n'écrit rien)
 *   npm run reset:keep -- "Liste noire" --apply    (sauvegarde automatique, puis remise à zéro)
 *
 * Conserve UNIQUEMENT la course désignée (recherche sur le nom, accents et casse ignorés) et ses pilotes.
 * Cette course repart « En préparation » : ses paris, clôture, résultat et paiements sont effacés.
 * Tout le reste est effacé : autres courses, paris, règlements, parts d'associés, journal, registre masqué.
 * Les associés reviennent à « Associé 1 » à « Associé 4 », 25 % chacun.
 *
 * La base visée est celle de DATABASE_URL (.env.local). Une sauvegarde complète est écrite
 * dans .\backups\ avant toute modification (restaurable avec npm run restore -- <fichier> --wipe).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { count, eq, ne, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { buildBackup } from "../src/server/backup/export";
import {
  bets,
  driverRegistryHidden,
  drivers,
  operationLog,
  partnerPayouts,
  partners,
  raceClosures,
  raceResults,
  races,
  settlements,
} from "../src/server/db/schema";
import { normalizeName } from "../src/lib/identity";
import { connect } from "./_db";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const query = args.find((a) => !a.startsWith("--"));
if (!query) {
  console.error('Usage : npm run reset:keep -- "<nom de la course à garder>" [--apply]');
  process.exit(1);
}

const { db, close, label } = await connect();
try {
  console.log(`Base : ${label}`);
  const all = await db.select().from(races);
  const q = normalizeName(query);
  const matches = all.filter((r) => normalizeName(r.name).includes(q));
  if (matches.length !== 1) {
    console.error(
      matches.length === 0
        ? `✖ Aucune course ne contient « ${query} ». Courses existantes :`
        : `✖ ${matches.length} courses correspondent à « ${query} », précisez le nom :`,
    );
    for (const r of matches.length ? matches : all) console.error(`   - ${r.name} (${r.status})`);
    process.exitCode = 1;
  } else {
    const keep = matches[0]!;
    const keptDrivers = await db.select().from(drivers).where(eq(drivers.raceId, keep.id));
    const n = async (table: PgTable) =>
      Number(((await db.select({ n: count() }).from(table)) as [{ n: number }])[0].n);

    console.log(`\nCourse conservée : « ${keep.name} » (statut actuel : ${keep.status})`);
    console.log(`Pilotes conservés (${keptDrivers.length}) : ${keptDrivers.map((d) => d.name).join(", ") || "aucun"}`);
    console.log("\nSera effacé :");
    console.table({
      "autres courses": all.length - 1,
      "pilotes des autres courses": (await n(drivers)) - keptDrivers.length,
      paris: await n(bets),
      règlements: await n(settlements),
      "parts d'associés": await n(partnerPayouts),
      "résultats / clôtures": (await n(raceResults)) + (await n(raceClosures)),
      "entrées du journal": await n(operationLog),
      "pilotes masqués du registre": await n(driverRegistryHidden),
    });

    if (!apply) {
      console.log("\nAperçu uniquement : rien n'a été modifié. Ajoutez --apply pour exécuter.");
    } else {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question(
        `\nATTENTION : effacement DÉFINITIF sur ${label}. Tapez REMETTRE A ZERO pour continuer : `,
      );
      rl.close();
      if (answer.trim() !== "REMETTRE A ZERO") {
        console.log("Annulé. Aucune modification.");
      } else {
        const backup = await buildBackup(db);
        mkdirSync("backups", { recursive: true });
        const path = `backups/avant-remise-a-zero-${backup.exportedAt.replace(/[:.]/g, "-")}.json`;
        writeFileSync(path, JSON.stringify(backup, null, 2));
        console.log(`✔ Sauvegarde écrite : ${path}`);

        await db.transaction(async (t) => {
          // Lève les garde-fous d'immuabilité pour CETTE transaction uniquement.
          await t.execute(sql`select set_config('racebet.maintenance', 'on', true)`);
          await t.delete(partnerPayouts);
          await t.delete(settlements);
          await t.delete(raceResults);
          await t.delete(raceClosures);
          await t.delete(bets);
          await t.delete(operationLog);
          await t.delete(driverRegistryHidden);
          await t.delete(drivers).where(ne(drivers.raceId, keep.id));
          await t.delete(races).where(ne(races.id, keep.id));
          await t
            .update(races)
            .set({ status: "draft", openedAt: null, closedAt: null, resultAt: null, cancelledAt: null, completedAt: null })
            .where(eq(races.id, keep.id));
          await t.update(drivers).set({ finalPosition: null, isWinner: false }).where(eq(drivers.raceId, keep.id));
          for (const position of [1, 2, 3, 4]) {
            await t
              .update(partners)
              .set({ name: `Associé ${position}`, shareBps: 2500, updatedAt: new Date() })
              .where(eq(partners.position, position));
          }
          await t.execute(sql`select set_config('racebet.maintenance', 'off', true)`);
        });
        console.log(`✔ Remise à zéro terminée. « ${keep.name} » est en préparation avec ${keptDrivers.length} pilote(s).`);
      }
    }
  }
} catch (e) {
  console.error("✖ Échec, aucune modification :", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await close();
}
