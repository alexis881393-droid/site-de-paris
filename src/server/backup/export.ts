import { createHash } from "node:crypto";
import { asc } from "drizzle-orm";
import type { Db } from "../db/client";
import { bets, drivers, operationLog, raceClosures, raceResults, races, settlements } from "../db/schema";

export const BACKUP_FORMAT = "racebet-control-backup";
export const BACKUP_FORMAT_VERSION = 1;

export type BackupData = {
  races: Record<string, unknown>[];
  drivers: Record<string, unknown>[];
  bets: Record<string, unknown>[];
  raceClosures: Record<string, unknown>[];
  raceResults: Record<string, unknown>[];
  settlements: Record<string, unknown>[];
  operationLog: Record<string, unknown>[];
};

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  exportedAt: string;
  timezone: "UTC";
  counts: Record<keyof BackupData, number>;
  checksum: { algorithm: "sha256"; value: string };
  data: BackupData;
};

/** Sérialisation JSON stable : les Date deviennent des chaînes ISO 8601 UTC. */
const plain = <T extends Record<string, unknown>>(rows: T[]) =>
  rows.map((r) =>
    Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])),
  );

export function checksumOf(data: BackupData): string {
  return createHash("sha256").update(JSON.stringify(data), "utf8").digest("hex");
}

/** Export complet et cohérent : toutes les lectures dans une seule transaction (instantané unique). */
export async function buildBackup(db: Db): Promise<BackupFile> {
  const data = await db.transaction(async (q) => {
    const result: BackupData = {
      races: plain(await q.select().from(races).orderBy(asc(races.createdAt), asc(races.id))),
      drivers: plain(await q.select().from(drivers).orderBy(asc(drivers.createdAt), asc(drivers.id))),
      bets: plain(await q.select().from(bets).orderBy(asc(bets.createdAt), asc(bets.id))),
      raceClosures: plain(await q.select().from(raceClosures).orderBy(asc(raceClosures.raceId))),
      raceResults: plain(await q.select().from(raceResults).orderBy(asc(raceResults.raceId))),
      settlements: plain(await q.select().from(settlements).orderBy(asc(settlements.createdAt), asc(settlements.id))),
      operationLog: plain(await q.select().from(operationLog).orderBy(asc(operationLog.id))),
    };
    return result;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.length])) as BackupFile["counts"];
  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    timezone: "UTC",
    counts,
    checksum: { algorithm: "sha256", value: checksumOf(data) },
    data,
  };
}

/** Vérifie format, version, compteurs et somme de contrôle d'un fichier de sauvegarde. */
export function verifyBackup(raw: unknown): { ok: true; file: BackupFile } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Fichier illisible." };
  const f = raw as BackupFile;
  if (f.format !== BACKUP_FORMAT) return { ok: false, error: "Format de sauvegarde inconnu." };
  if (f.formatVersion !== BACKUP_FORMAT_VERSION) return { ok: false, error: `Version ${f.formatVersion} non prise en charge.` };
  if (!f.data || !f.checksum?.value) return { ok: false, error: "Données ou somme de contrôle absentes." };
  for (const [k, n] of Object.entries(f.counts ?? {})) {
    const arr = (f.data as Record<string, unknown[]>)[k];
    if (!Array.isArray(arr) || arr.length !== n) return { ok: false, error: `Compteur incohérent pour ${k}.` };
  }
  if (checksumOf(f.data) !== f.checksum.value) return { ok: false, error: "Somme de contrôle invalide : fichier altéré." };
  return { ok: true, file: f };
}
