import { sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Db, Tx } from "../db/client";
import { bets, drivers, operationLog, raceClosures, raceResults, races, settlements } from "../db/schema";
import { verifyBackup, type BackupFile } from "./export";

const DATE_FIELDS = new Set([
  "createdAt",
  "scheduledAt",
  "openedAt",
  "closedAt",
  "resultAt",
  "cancelledAt",
  "completedAt",
  "recordedAt",
  "paidAt",
]);

const revive = (rows: Record<string, unknown>[]) =>
  rows.map((r) =>
    Object.fromEntries(
      Object.entries(r).map(([k, v]) => [k, DATE_FIELDS.has(k) && typeof v === "string" ? new Date(v) : v]),
    ),
  );

async function insertChunks(t: Tx, table: PgTable, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    if (chunk.length) await t.insert(table).values(chunk as never);
  }
}

/**
 * Restaure une sauvegarde complète (script d'administration LOCAL uniquement, jamais exposé sur le site).
 * - Refuse une base non vide, sauf si `wipe: true` (efface d'abord toutes les données).
 * - Tout se passe dans UNE transaction : succès complet ou aucun changement.
 */
export async function restoreBackup(db: Db, raw: unknown, opts: { wipe?: boolean } = {}) {
  const v = verifyBackup(raw);
  if (!v.ok) throw new Error(v.error);
  const file: BackupFile = v.file;

  return db.transaction(async (t) => {
    // Désactive les garde-fous d'immuabilité pour CETTE transaction uniquement.
    await t.execute(sql`select set_config('racebet.maintenance', 'on', true)`);
    const [{ n }] = (await t.select({ n: sql<number>`count(*)::int` }).from(races)) as [{ n: number }];
    if (Number(n) > 0) {
      if (!opts.wipe) throw new Error("La base cible contient déjà des données. Relancez avec --wipe pour l'écraser.");
      for (const table of [operationLog, settlements, raceResults, raceClosures, bets, drivers, races]) {
        await t.delete(table);
      }
    }
    await insertChunks(t, races, revive(file.data.races));
    await insertChunks(t, drivers, revive(file.data.drivers));
    await insertChunks(t, bets, revive(file.data.bets));
    await insertChunks(t, raceClosures, revive(file.data.raceClosures));
    await insertChunks(t, raceResults, revive(file.data.raceResults));
    await insertChunks(t, settlements, revive(file.data.settlements));
    await insertChunks(t, operationLog, revive(file.data.operationLog));
    await t.execute(
      sql`select setval(pg_get_serial_sequence('operation_log','id'), coalesce((select max(id) from operation_log), 0) + 1, false)`,
    );
    return file.counts;
  });
}
