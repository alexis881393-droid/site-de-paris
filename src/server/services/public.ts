import { asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { bets, drivers, races, type Race } from "../db/schema";
import { computeCommission, computeOddsCents, toNumber } from "@/lib/finance";
import type { PublicOddsDTO, PublicRaceDTO } from "@/lib/dto";
import type { RaceStatus } from "@/lib/constants";

/** Courses visibles du public : paris ouverts, clôturés ou résultat connu (jamais en préparation ni annulées). */
const PUBLIC_STATUSES: RaceStatus[] = ["open", "closed", "result", "paid"];
const MAX_RACES = 8;
const MAX_POINTS = 400;

const toPublicRace = (r: Race): PublicRaceDTO => ({
  id: r.id,
  name: r.name,
  status: r.status,
  scheduledAt: r.scheduledAt ? r.scheduledAt.toISOString() : null,
});

/**
 * Cotes publiques : uniquement les noms des pilotes, leurs cotes et leur évolution.
 * Aucune donnée de parieur (nom, téléphone, montant) n'est exposée.
 */
export async function getPublicOdds(db: Db, requested: string | null): Promise<PublicOddsDTO> {
  const rows = await db
    .select()
    .from(races)
    .where(inArray(races.status, PUBLIC_STATUSES))
    .orderBy(desc(races.openedAt), desc(races.createdAt))
    .limit(MAX_RACES);
  // Paris ouverts d'abord, puis les plus récentes.
  const list = [...rows.filter((r) => r.status === "open"), ...rows.filter((r) => r.status !== "open")];
  const race = list.find((r) => r.id === requested) ?? list[0];
  if (!race) return { races: [], race: null };

  const [driverRows, betRows] = await Promise.all([
    db
      .select({ id: drivers.id, name: drivers.name, number: drivers.number, isWinner: drivers.isWinner, position: drivers.finalPosition })
      .from(drivers)
      .where(eq(drivers.raceId, race.id))
      .orderBy(asc(drivers.createdAt), asc(drivers.id)),
    db
      .select({ driverId: bets.driverId, amount: bets.amount, createdAt: bets.createdAt })
      .from(bets)
      .where(eq(bets.raceId, race.id))
      .orderBy(asc(bets.createdAt), asc(bets.id)),
  ]);

  // Rejoue les paris dans l'ordre : cotes de chaque pilote après chaque pari.
  const pools = new Map<string, bigint>(driverRows.map((d) => [d.id, 0n]));
  let total = 0n;
  const oddsNow = () => {
    const distributable = total - computeCommission(total, race.commissionBps);
    const odds: Record<string, number | null> = {};
    for (const d of driverRows) {
      const c = computeOddsCents(distributable, pools.get(d.id) ?? 0n);
      odds[d.id] = c == null ? null : toNumber(c);
    }
    return odds;
  };
  let history = betRows.map((b) => {
    pools.set(b.driverId, (pools.get(b.driverId) ?? 0n) + BigInt(b.amount));
    total += BigInt(b.amount);
    return { t: b.createdAt.toISOString(), odds: oddsNow() };
  });
  if (history.length > MAX_POINTS) {
    const step = history.length / MAX_POINTS;
    history = [...Array.from({ length: MAX_POINTS - 1 }, (_, i) => history[Math.floor(i * step)]!), history[history.length - 1]!];
  }
  const current = oddsNow();

  return {
    races: list.map(toPublicRace),
    race: {
      ...toPublicRace(race),
      drivers: driverRows.map((d) => ({ id: d.id, name: d.name, number: d.number, oddsCents: current[d.id] ?? null, isWinner: d.isWinner })),
      history,
      serverTime: new Date().toISOString(),
    },
  };
}
