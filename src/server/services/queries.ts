import { and, asc, count, desc, eq, sql, sum } from "drizzle-orm";
import type { Db } from "../db/client";
import { bets, driverRegistryHidden, drivers, operationLog, raceClosures, raceResults, races, settlements, type Race } from "../db/schema";
import { AppError } from "../errors";
import { computeGlobalAccounting, computeRaceAccounting, type RaceAccountingInput } from "@/lib/accounting";
import { computeCommission, computeOddsCents } from "@/lib/finance";
import type { RaceStatus } from "@/lib/constants";
import type {
  AccountingRowDTO,
  BackupStatusDTO,
  BetRowDTO,
  DriverRowDTO,
  GlobalAccountingDTO,
  KnownDriverDTO,
  RaceCardDTO,
  RaceDTO,
  RaceDetailDTO,
} from "@/lib/dto";
import { normalizeName } from "@/lib/identity";
import { PARIS_TZ } from "@/lib/format";
import { backupConfigStatus } from "../backup/config";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function toRaceDTO(r: Race): RaceDTO {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    scheduledAt: iso(r.scheduledAt),
    commissionBps: r.commissionBps,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    openedAt: iso(r.openedAt),
    closedAt: iso(r.closedAt),
    resultAt: iso(r.resultAt),
    cancelledAt: iso(r.cancelledAt),
    completedAt: iso(r.completedAt),
  };
}

export async function listRaces(db: Db, opts: { q?: string; status?: RaceStatus } = {}): Promise<RaceCardDTO[]> {
  const betAgg = db
    .select({
      raceId: bets.raceId,
      betCount: count().as("bet_count"),
      totalStakes: sum(bets.amount).as("total_stakes"),
    })
    .from(bets)
    .groupBy(bets.raceId)
    .as("bet_agg");
  const driverAgg = db
    .select({ raceId: drivers.raceId, driverCount: count().as("driver_count") })
    .from(drivers)
    .groupBy(drivers.raceId)
    .as("driver_agg");

  const rows = await db
    .select({
      race: races,
      betCount: sql<number>`coalesce(${betAgg.betCount}, 0)`.mapWith(Number),
      totalStakes: sql<number>`coalesce(${betAgg.totalStakes}, 0)`.mapWith(Number),
      driverCount: sql<number>`coalesce(${driverAgg.driverCount}, 0)`.mapWith(Number),
    })
    .from(races)
    .leftJoin(betAgg, eq(betAgg.raceId, races.id))
    .leftJoin(driverAgg, eq(driverAgg.raceId, races.id))
    .where(opts.status ? eq(races.status, opts.status) : undefined)
    .orderBy(desc(races.createdAt));

  const q = opts.q ? normalizeName(opts.q) : "";
  return rows
    .filter((r) => !q || normalizeName(r.race.name).includes(q))
    .map((r) => ({ ...toRaceDTO(r.race), betCount: r.betCount, totalStakes: r.totalStakes, driverCount: r.driverCount }));
}

/**
 * Registre des pilotes déjà engagés dans au moins une course (toutes courses confondues),
 * dédoublonné par nom normalisé : nom et numéro de la participation la plus récente.
 */
export async function listKnownDrivers(db: Db): Promise<KnownDriverDTO[]> {
  const [rows, hiddenRows] = await Promise.all([
    db
      .select({ name: drivers.name, nameKey: drivers.nameKey, number: drivers.number, createdAt: drivers.createdAt })
      .from(drivers)
      .orderBy(desc(drivers.createdAt)),
    db.select({ nameKey: driverRegistryHidden.nameKey }).from(driverRegistryHidden),
  ]);
  const hidden = new Set(hiddenRows.map((h) => h.nameKey));
  const map = new Map<string, KnownDriverDTO>();
  for (const r of rows) {
    if (hidden.has(r.nameKey)) continue;
    const cur = map.get(r.nameKey);
    if (cur) cur.races += 1;
    else map.set(r.nameKey, { name: r.name, nameKey: r.nameKey, number: r.number, races: 1, lastUsedAt: r.createdAt.toISOString() });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, "fr", { sensitivity: "base" }));
}

export async function getRaceDetail(db: Db, raceId: string): Promise<RaceDetailDTO> {
  if (!/^[0-9a-f-]{36}$/i.test(raceId)) throw new AppError("NOT_FOUND", "Course introuvable.");
  const [race] = await db.select().from(races).where(eq(races.id, raceId));
  if (!race) throw new AppError("NOT_FOUND", "Course introuvable.");

  const [driverRows, betRows, settlementRows, closureRows, resultRows] = await Promise.all([
    db.select().from(drivers).where(eq(drivers.raceId, raceId)).orderBy(asc(drivers.createdAt), asc(drivers.id)),
    db.select().from(bets).where(eq(bets.raceId, raceId)).orderBy(asc(bets.createdAt), asc(bets.id)),
    db.select().from(settlements).where(eq(settlements.raceId, raceId)),
    db.select().from(raceClosures).where(eq(raceClosures.raceId, raceId)),
    db.select().from(raceResults).where(eq(raceResults.raceId, raceId)),
  ]);
  const closure = closureRows[0] ?? null;
  const result = resultRows[0] ?? null;

  const poolByDriver = new Map<string, { pool: number; count: number }>();
  for (const b of betRows) {
    const cur = poolByDriver.get(b.driverId) ?? { pool: 0, count: 0 };
    cur.pool += b.amount;
    cur.count += 1;
    poolByDriver.set(b.driverId, cur);
  }
  const totalPool = betRows.reduce((s, b) => s + b.amount, 0);
  // Après clôture, la base de calcul est l'instantané figé (identique aux paris : plus aucun ajout possible).
  const poolForOdds = closure ? closure.totalPool : totalPool;
  const distributable = poolForOdds - Number(computeCommission(poolForOdds, race.commissionBps));

  const driverDTOs: DriverRowDTO[] = driverRows
    .map((d) => {
      const agg = poolByDriver.get(d.id) ?? { pool: 0, count: 0 };
      const odds = computeOddsCents(distributable, agg.pool);
      return {
        id: d.id,
        name: d.name,
        number: d.number,
        finalPosition: d.finalPosition,
        isWinner: d.isWinner,
        betCount: agg.count,
        pool: agg.pool,
        oddsCents: odds === null ? null : Number(odds),
      };
    })
    .sort((a, b) => (a.number ?? 1e9) - (b.number ?? 1e9));
  const driverById = new Map(driverDTOs.map((d) => [d.id, d]));
  const settlementByBet = new Map(settlementRows.map((s) => [s.betId, s]));

  const cancelled = race.status === "cancelled" || race.status === "refunded";
  const hasResult = !!result && !cancelled;

  const betDTOs: BetRowDTO[] = betRows.map((b) => {
    const d = driverById.get(b.driverId)!;
    const s = settlementByBet.get(b.id) ?? null;
    let outcome: BetRowDTO["outcome"] = "pending";
    let payment: BetRowDTO["payment"] = "none";
    let amountDue: number | null = null;
    let indicative = false;
    if (cancelled) {
      outcome = "refund";
      payment = s?.status === "paid" ? "refunded" : "to_refund";
      amountDue = s?.amountDue ?? b.amount;
    } else if (hasResult) {
      if (b.driverId === result!.winnerDriverId) {
        outcome = "winner";
        payment = s?.status === "paid" ? "paid" : "to_pay";
        amountDue = s?.amountDue ?? 0;
      } else {
        outcome = "loser";
        payment = "loser";
        amountDue = 0;
      }
    } else if (d.pool > 0) {
      // Gain indicatif : plancher(mise × distribuable / mises du pilote). Non contractuel.
      amountDue = Number((BigInt(b.amount) * BigInt(distributable)) / BigInt(d.pool));
      indicative = true;
    }
    return {
      id: b.id,
      bettorName: b.bettorName,
      phone: b.phone,
      driverId: b.driverId,
      driverName: d.name,
      driverNumber: d.number,
      amount: b.amount,
      createdAt: b.createdAt.toISOString(),
      oddsCents: d.oddsCents,
      outcome,
      payment,
      amountDue,
      indicative,
      settlement: s
        ? { id: s.id, kind: s.kind, status: s.status, amountDue: s.amountDue, paidAt: iso(s.paidAt) }
        : null,
    };
  });

  const sumSettlements = (kind: "payout" | "refund", paidOnly: boolean) =>
    settlementRows
      .filter((s) => s.kind === kind && (!paidOnly || s.status === "paid"))
      .reduce((acc, s) => acc + (paidOnly ? s.amountPaid : s.amountDue), 0);

  const accounting = computeRaceAccounting({
    status: race.status,
    commissionBps: race.commissionBps,
    driverCount: driverRows.length,
    bettorCount: betRows.length,
    totalStakes: totalPool,
    payoutDue: sumSettlements("payout", false),
    payoutPaid: sumSettlements("payout", true),
    refundDue: sumSettlements("refund", false),
    refundPaid: sumSettlements("refund", true),
    result: result
      ? {
          organizerKept: result.organizerKept,
          noWinner: result.noWinner,
          distributablePool: result.distributablePool,
          commissionAmount: result.commissionAmount,
        }
      : null,
  });

  return {
    race: toRaceDTO(race),
    drivers: driverDTOs,
    bets: betDTOs,
    totalPool,
    distributable,
    oddsFinal: !!closure,
    closure: closure ? { closedAt: closure.closedAt.toISOString(), totalPool: closure.totalPool, betCount: closure.betCount } : null,
    result: result
      ? {
          winnerDriverId: result.winnerDriverId,
          recordedAt: result.recordedAt.toISOString(),
          totalPool: result.totalPool,
          commissionAmount: result.commissionAmount,
          distributablePool: result.distributablePool,
          winnerPool: result.winnerPool,
          winnersCount: result.winnersCount,
          totalPayout: result.totalPayout,
          organizerKept: result.organizerKept,
          noWinner: result.noWinner,
        }
      : null,
    accounting,
    serverTime: new Date().toISOString(),
  };
}

/** Comptabilité de toutes les courses (une requête agrégée par table, combinées en mémoire). */
export async function getAccountingRows(db: Db): Promise<AccountingRowDTO[]> {
  const [raceRows, betAgg, driverAgg, settlementAgg, resultRows] = await Promise.all([
    db.select().from(races).orderBy(desc(races.createdAt)),
    db
      .select({ raceId: bets.raceId, n: count(), total: sum(bets.amount).mapWith(Number) })
      .from(bets)
      .groupBy(bets.raceId),
    db.select({ raceId: drivers.raceId, n: count() }).from(drivers).groupBy(drivers.raceId),
    db
      .select({
        raceId: settlements.raceId,
        kind: settlements.kind,
        due: sum(settlements.amountDue).mapWith(Number),
        paid: sum(settlements.amountPaid).mapWith(Number),
      })
      .from(settlements)
      .groupBy(settlements.raceId, settlements.kind),
    db.select().from(raceResults),
  ]);
  const betMap = new Map(betAgg.map((b) => [b.raceId, b]));
  const driverMap = new Map(driverAgg.map((d) => [d.raceId, d.n]));
  const resultMap = new Map(resultRows.map((r) => [r.raceId, r]));
  const settleMap = new Map<string, { payoutDue: number; payoutPaid: number; refundDue: number; refundPaid: number }>();
  for (const s of settlementAgg) {
    const cur = settleMap.get(s.raceId) ?? { payoutDue: 0, payoutPaid: 0, refundDue: 0, refundPaid: 0 };
    if (s.kind === "payout") {
      cur.payoutDue += s.due;
      cur.payoutPaid += s.paid;
    } else {
      cur.refundDue += s.due;
      cur.refundPaid += s.paid;
    }
    settleMap.set(s.raceId, cur);
  }

  return raceRows.map((r) => {
    const b = betMap.get(r.id);
    const st = settleMap.get(r.id) ?? { payoutDue: 0, payoutPaid: 0, refundDue: 0, refundPaid: 0 };
    const res = resultMap.get(r.id);
    const input: RaceAccountingInput = {
      status: r.status,
      commissionBps: r.commissionBps,
      driverCount: driverMap.get(r.id) ?? 0,
      bettorCount: b?.n ?? 0,
      totalStakes: b?.total ?? 0,
      ...st,
      result: res
        ? {
            organizerKept: res.organizerKept,
            noWinner: res.noWinner,
            distributablePool: res.distributablePool,
            commissionAmount: res.commissionAmount,
          }
        : null,
    };
    return { ...toRaceDTO(r), accounting: computeRaceAccounting(input) };
  });
}

const parisDay = new Intl.DateTimeFormat("en-CA", { timeZone: PARIS_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

export async function getGlobalAccounting(
  db: Db,
  filters: { from?: string; to?: string; status?: RaceStatus; q?: string } = {},
): Promise<GlobalAccountingDTO> {
  const all = await getAccountingRows(db);
  const q = filters.q ? normalizeName(filters.q) : "";
  const dayOf = (r: AccountingRowDTO) => parisDay.format(new Date(r.scheduledAt ?? r.createdAt));
  const rows = all.filter((r) => {
    if (filters.status && r.status !== filters.status) return false;
    if (q && !normalizeName(r.name).includes(q)) return false;
    const day = dayOf(r);
    if (filters.from && day < filters.from) return false;
    if (filters.to && day > filters.to) return false;
    return true;
  });

  const dailyMap = new Map<string, { stakes: number; revenue: number }>();
  for (const r of rows) {
    const d = dayOf(r);
    const cur = dailyMap.get(d) ?? { stakes: 0, revenue: 0 };
    cur.stakes += r.accounting.totalStakes;
    cur.revenue += r.accounting.organizerRevenue ?? 0;
    dailyMap.set(d, cur);
  }
  const daily = [...dailyMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(-30)
    .map(([day, v]) => ({ day, ...v }));

  return {
    global: computeGlobalAccounting(rows.map((r) => r.accounting)),
    races: rows,
    daily,
    backup: await getBackupStatus(db),
  };
}

export async function getBackupStatus(db: Db): Promise<BackupStatusDTO> {
  const cfg = backupConfigStatus();
  const [lastOk] = await db
    .select()
    .from(operationLog)
    .where(eq(operationLog.type, "backup_created"))
    .orderBy(desc(operationLog.createdAt))
    .limit(1);
  const [lastFail] = await db
    .select()
    .from(operationLog)
    .where(and(eq(operationLog.type, "backup_failed")))
    .orderBy(desc(operationLog.createdAt))
    .limit(1);
  const failMsg = (lastFail?.payload as { message?: string } | undefined)?.message ?? null;
  return {
    configured: cfg.configured,
    missing: cfg.missing,
    lastBackupAt: lastOk ? lastOk.createdAt.toISOString() : null,
    lastBackupKey: (lastOk?.payload as { key?: string } | undefined)?.key ?? null,
    lastFailureAt: lastFail && (!lastOk || lastFail.createdAt > lastOk.createdAt) ? lastFail.createdAt.toISOString() : null,
    lastFailureMessage: lastFail && (!lastOk || lastFail.createdAt > lastOk.createdAt) ? failMsg : null,
  };
}
