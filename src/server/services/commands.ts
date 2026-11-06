import { and, count, eq, sum } from "drizzle-orm";
import type { Db, Tx } from "../db/client";
import {
  bets,
  drivers,
  raceClosures,
  raceResults,
  races,
  settlements,
  type Race,
  type RaceStatus,
} from "../db/schema";
import { AppError, mapDbError } from "../errors";
import { logOperation } from "../log";
import { parseCommissionPercent, planCancellation, planResult, toNumber } from "@/lib/finance";
import { parisLocalToDate } from "@/lib/format";
import { bettorIdentityKey, cleanDisplayName, normalizeFivemId, normalizeName } from "@/lib/identity";
import {
  createRaceSchema,
  driverSchema,
  formatZodError,
  placeBetSchema,
  recordResultSchema,
  type CreateRaceInput,
  type DriverInput,
  type PlaceBetInput,
  type RecordResultInput,
} from "@/lib/validation";
import type { z } from "zod";

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new AppError("VALIDATION", formatZodError(r.error));
  return r.data;
}

/** Exécute une transaction en traduisant les erreurs PostgreSQL en erreurs métier. */
async function tx<T>(db: Db, fn: (t: Tx) => Promise<T>): Promise<T> {
  try {
    return await db.transaction(fn);
  } catch (e) {
    throw mapDbError(e) ?? e;
  }
}

async function lockRace(t: Tx, raceId: string, mode: "update" | "share"): Promise<Race> {
  const [race] = await t.select().from(races).where(eq(races.id, raceId)).for(mode);
  if (!race) throw new AppError("NOT_FOUND", "Course introuvable.");
  return race;
}

function requireStatus(race: Race, allowed: RaceStatus[], message: string) {
  if (!allowed.includes(race.status)) throw new AppError("RACE_STATE", message);
}

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
function assertId(id: string, what = "Identifiant") {
  if (!isUuid(id)) throw new AppError("NOT_FOUND", `${what} introuvable.`);
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

export async function createRace(db: Db, input: CreateRaceInput) {
  const data = parse(createRaceSchema, input);
  const commissionBps = parseCommissionPercent(data.commissionPercent)!;
  const scheduledAt = data.scheduledAt ? parisLocalToDate(data.scheduledAt) : null;
  if (data.scheduledAt && !scheduledAt) throw new AppError("VALIDATION", "Date invalide.");
  return tx(db, async (t) => {
    const [race] = await t
      .insert(races)
      .values({ name: data.name, description: data.description, scheduledAt, commissionBps })
      .returning();
    await logOperation(t, "race_created", race!.id, { name: race!.name, commissionBps });
    return race!;
  });
}

export async function deleteRace(db: Db, raceId: string) {
  assertId(raceId, "Course");
  return tx(db, async (t) => {
    const race = await lockRace(t, raceId, "update");
    const [{ n }] = (await t.select({ n: count() }).from(bets).where(eq(bets.raceId, raceId))) as [{ n: number }];
    if (n > 0) throw new AppError("HAS_BETS", "Cette course contient des paris : elle ne peut pas être supprimée.");
    const [closure] = await t.select({ id: raceClosures.raceId }).from(raceClosures).where(eq(raceClosures.raceId, raceId));
    if (!["draft", "cancelled"].includes(race.status) || closure) {
      throw new AppError(
        "RACE_STATE",
        "Seule une course en préparation (ou annulée avant clôture) sans aucun pari peut être supprimée. Sinon, annulez-la : elle reste dans l'historique.",
      );
    }
    await t.delete(races).where(eq(races.id, raceId));
    await logOperation(t, "race_deleted", raceId, { name: race.name });
    return { deleted: true };
  });
}

export async function openBets(db: Db, raceId: string) {
  assertId(raceId, "Course");
  return tx(db, async (t) => {
    const race = await lockRace(t, raceId, "update");
    requireStatus(race, ["draft"], "Seule une course en préparation peut ouvrir ses paris.");
    const [{ n }] = (await t.select({ n: count() }).from(drivers).where(eq(drivers.raceId, raceId))) as [{ n: number }];
    if (n < 2) throw new AppError("NOT_ENOUGH_DRIVERS", "Ajoutez au moins deux pilotes avant d'ouvrir les paris.");
    const [updated] = await t
      .update(races)
      .set({ status: "open", openedAt: new Date() })
      .where(eq(races.id, raceId))
      .returning();
    await logOperation(t, "bets_opened", raceId, { drivers: n });
    return updated!;
  });
}

export async function closeBets(db: Db, raceId: string) {
  assertId(raceId, "Course");
  return tx(db, async (t) => {
    // FOR UPDATE : attend la fin des paris en cours (verrou FOR SHARE), puis bloque les suivants.
    const race = await lockRace(t, raceId, "update");
    requireStatus(race, ["open"], "Les paris de cette course ne sont pas ouverts.");
    const pools = await t
      .select({ driverId: bets.driverId, pool: sum(bets.amount).mapWith(Number), bets: count() })
      .from(bets)
      .where(eq(bets.raceId, raceId))
      .groupBy(bets.driverId);
    const totalPool = pools.reduce((s, p) => s + p.pool, 0);
    const betCount = pools.reduce((s, p) => s + p.bets, 0);
    const closedAt = new Date();
    await t.insert(raceClosures).values({
      raceId,
      closedAt,
      totalPool,
      betCount,
      commissionBps: race.commissionBps,
      driverPools: pools,
    });
    const [updated] = await t.update(races).set({ status: "closed", closedAt }).where(eq(races.id, raceId)).returning();
    await logOperation(t, "bets_closed", raceId, { totalPool, betCount });
    return updated!;
  });
}

export async function recordResult(db: Db, raceId: string, input: RecordResultInput) {
  assertId(raceId, "Course");
  const data = parse(recordResultSchema, input);
  return tx(db, async (t) => {
    const race = await lockRace(t, raceId, "update");
    requireStatus(race, ["closed"], "Le résultat ne peut être enregistré qu'après la clôture des paris, une seule fois.");
    const raceDrivers = await t.select().from(drivers).where(eq(drivers.raceId, raceId));
    const ids = new Set(raceDrivers.map((d) => d.id));
    if (!ids.has(data.winnerDriverId)) throw new AppError("VALIDATION", "Le vainqueur doit être un pilote de cette course.");

    let ranking = data.ranking?.length ? data.ranking : [data.winnerDriverId];
    if (new Set(ranking).size !== ranking.length) throw new AppError("VALIDATION", "Classement : pilote en double.");
    if (ranking.some((id) => !ids.has(id))) throw new AppError("VALIDATION", "Classement : pilote inconnu.");
    if (ranking[0] !== data.winnerDriverId) {
      throw new AppError("VALIDATION", "Le premier du classement doit être le vainqueur sélectionné.");
    }

    const raceBets = await t
      .select({ id: bets.id, amount: bets.amount, createdAt: bets.createdAt, driverId: bets.driverId })
      .from(bets)
      .where(eq(bets.raceId, raceId));
    const plan = planResult(raceBets, data.winnerDriverId, race.commissionBps);
    const now = new Date();

    // Classement (informatif) puis vainqueur.
    for (const [index, driverId] of ranking.entries()) {
      await t
        .update(drivers)
        .set({ finalPosition: index + 1, isWinner: driverId === data.winnerDriverId })
        .where(and(eq(drivers.id, driverId), eq(drivers.raceId, raceId)));
    }

    await t.insert(raceResults).values({
      raceId,
      winnerDriverId: data.winnerDriverId,
      recordedAt: now,
      totalPool: toNumber(plan.totalPool),
      commissionBps: race.commissionBps,
      commissionAmount: toNumber(plan.commissionTheoretical),
      distributablePool: toNumber(plan.distributable),
      winnerPool: toNumber(plan.winnerPool),
      winnersCount: plan.payouts.length,
      totalPayout: toNumber(plan.totalPayout),
      organizerKept: toNumber(plan.organizerKept),
      noWinner: plan.noWinner,
    });

    if (plan.payouts.length) {
      await t.insert(settlements).values(
        plan.payouts.map((p) => {
          const amount = toNumber(p.amount);
          // Un gain nul (commission de 100 %) n'a rien à verser : soldé immédiatement.
          return amount === 0
            ? { raceId, betId: p.betId, kind: "payout" as const, amountDue: 0, amountPaid: 0, status: "paid" as const, paidAt: now }
            : { raceId, betId: p.betId, kind: "payout" as const, amountDue: amount };
        }),
      );
    }

    const pending = plan.payouts.some((p) => p.amount > 0n);
    const [updated] = await t
      .update(races)
      .set(pending ? { status: "result", resultAt: now } : { status: "paid", resultAt: now, completedAt: now })
      .where(eq(races.id, raceId))
      .returning();

    await logOperation(t, "result_recorded", raceId, {
      winnerDriverId: data.winnerDriverId,
      ranking,
      totalPool: toNumber(plan.totalPool),
      distributable: toNumber(plan.distributable),
      winners: plan.payouts.length,
      totalPayout: toNumber(plan.totalPayout),
      organizerKept: toNumber(plan.organizerKept),
      noWinner: plan.noWinner,
    });
    if (!pending) await logOperation(t, "race_completed", raceId, { status: "paid" });
    return updated!;
  });
}

export async function cancelRace(db: Db, raceId: string) {
  assertId(raceId, "Course");
  return tx(db, async (t) => {
    const race = await lockRace(t, raceId, "update");
    requireStatus(
      race,
      ["draft", "open", "closed"],
      "Seule une course sans résultat officiel peut être annulée.",
    );
    const raceBets = await t
      .select({ id: bets.id, amount: bets.amount, createdAt: bets.createdAt })
      .from(bets)
      .where(eq(bets.raceId, raceId));
    const plan = planCancellation(raceBets);
    if (plan.refunds.length) {
      await t
        .insert(settlements)
        .values(plan.refunds.map((r) => ({ raceId, betId: r.betId, kind: "refund" as const, amountDue: toNumber(r.amount) })));
    }
    const [updated] = await t
      .update(races)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(eq(races.id, raceId))
      .returning();
    await logOperation(t, "race_cancelled", raceId, {
      previousStatus: race.status,
      refunds: plan.refunds.length,
      totalRefund: toNumber(plan.totalRefund),
    });
    return updated!;
  });
}

// ---------------------------------------------------------------------------
// Pilotes
// ---------------------------------------------------------------------------

export async function addDriver(db: Db, raceId: string, input: DriverInput) {
  assertId(raceId, "Course");
  const data = parse(driverSchema, input);
  return tx(db, async (t) => {
    const race = await lockRace(t, raceId, "share");
    requireStatus(race, ["draft"], "La liste des pilotes est verrouillée depuis l'ouverture des paris.");
    const name = cleanDisplayName(data.name);
    const [driver] = await t
      .insert(drivers)
      .values({ raceId, name, nameKey: normalizeName(name), number: data.number })
      .returning();
    await logOperation(t, "driver_added", raceId, { driverId: driver!.id, name, number: data.number });
    return driver!;
  });
}

export async function updateDriver(db: Db, raceId: string, driverId: string, input: DriverInput) {
  assertId(raceId, "Course");
  assertId(driverId, "Pilote");
  const data = parse(driverSchema, input);
  return tx(db, async (t) => {
    const race = await lockRace(t, raceId, "share");
    requireStatus(race, ["draft"], "La liste des pilotes est verrouillée depuis l'ouverture des paris.");
    const name = cleanDisplayName(data.name);
    const [driver] = await t
      .update(drivers)
      .set({ name, nameKey: normalizeName(name), number: data.number })
      .where(and(eq(drivers.id, driverId), eq(drivers.raceId, raceId)))
      .returning();
    if (!driver) throw new AppError("NOT_FOUND", "Pilote introuvable.");
    await logOperation(t, "driver_updated", raceId, { driverId, name, number: data.number });
    return driver;
  });
}

export async function removeDriver(db: Db, raceId: string, driverId: string) {
  assertId(raceId, "Course");
  assertId(driverId, "Pilote");
  return tx(db, async (t) => {
    const race = await lockRace(t, raceId, "share");
    requireStatus(race, ["draft"], "La liste des pilotes est verrouillée depuis l'ouverture des paris.");
    const [driver] = await t
      .delete(drivers)
      .where(and(eq(drivers.id, driverId), eq(drivers.raceId, raceId)))
      .returning();
    if (!driver) throw new AppError("NOT_FOUND", "Pilote introuvable.");
    await logOperation(t, "driver_removed", raceId, { driverId, name: driver.name });
    return { removed: true };
  });
}

// ---------------------------------------------------------------------------
// Paris
// ---------------------------------------------------------------------------

export async function placeBet(db: Db, raceId: string, input: PlaceBetInput) {
  assertId(raceId, "Course");
  const data = parse(placeBetSchema, input);
  const bettorName = cleanDisplayName(data.bettorName);
  const fivemId = data.fivemId ? data.fivemId.replace(/\s+/g, "") : null;
  const nameKey = normalizeName(bettorName);
  const identityKey = bettorIdentityKey(bettorName, fivemId);

  // Idempotence : un même requestId renvoie le pari déjà enregistré (double clic, nouvelle tentative réseau).
  if (data.requestId) {
    const [existing] = await db.select().from(bets).where(eq(bets.requestId, data.requestId));
    if (existing) {
      if (existing.raceId !== raceId) throw new AppError("CONFLICT", "Requête déjà utilisée pour une autre course.");
      return { bet: existing, replayed: true };
    }
  }

  try {
    return await tx(db, async (t) => {
      const race = await lockRace(t, raceId, "share");
      requireStatus(race, ["open"], "Les paris ne sont pas ouverts pour cette course.");
      const [driver] = await t
        .select({ id: drivers.id, name: drivers.name })
        .from(drivers)
        .where(and(eq(drivers.id, data.driverId), eq(drivers.raceId, raceId)));
      if (!driver) throw new AppError("VALIDATION", "Ce pilote ne participe pas à cette course.");

      // Un même nom RP ne peut pas contourner l'unicité en ajoutant/omettant un identifiant FiveM.
      const sameName = await t
        .select({ fivemId: bets.fivemId })
        .from(bets)
        .where(and(eq(bets.raceId, raceId), eq(bets.bettorNameKey, nameKey)));
      const normalizedFivem = normalizeFivemId(fivemId);
      if (sameName.some((b) => !normalizedFivem || !b.fivemId)) {
        throw new AppError(
          "DUPLICATE_BET",
          "Un parieur portant ce nom RP a déjà parié sur cette course. Un seul pari par joueur et par course.",
        );
      }

      const [bet] = await t
        .insert(bets)
        .values({
          raceId,
          driverId: driver.id,
          bettorName,
          bettorNameKey: nameKey,
          fivemId,
          identityKey,
          amount: data.amount,
          requestId: data.requestId ?? null,
        })
        .returning();
      await logOperation(t, "bet_placed", raceId, {
        betId: bet!.id,
        bettorName,
        fivemId,
        driverId: driver.id,
        driverName: driver.name,
        amount: data.amount,
      });
      return { bet: bet!, replayed: false };
    });
  } catch (e) {
    // Requête rejouée en parallèle (même requestId) : renvoyer le pari déjà enregistré.
    if (e instanceof AppError && data.requestId) {
      const [existing] = await db.select().from(bets).where(eq(bets.requestId, data.requestId));
      if (existing && existing.raceId === raceId) return { bet: existing, replayed: true };
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Règlements (gains / remboursements)
// ---------------------------------------------------------------------------

export async function paySettlement(db: Db, settlementId: string) {
  assertId(settlementId, "Règlement");
  const [found] = await db
    .select({ raceId: settlements.raceId })
    .from(settlements)
    .where(eq(settlements.id, settlementId));
  if (!found) throw new AppError("NOT_FOUND", "Règlement introuvable.");

  return tx(db, async (t) => {
    const race = await lockRace(t, found.raceId, "update");
    const [s] = await t.select().from(settlements).where(eq(settlements.id, settlementId)).for("update");
    if (!s) throw new AppError("NOT_FOUND", "Règlement introuvable.");
    // Idempotent : un second clic ne comptabilise rien de plus.
    if (s.status === "paid") return { settlement: s, alreadyPaid: true, raceStatus: race.status };

    const expected = s.kind === "payout" ? "result" : "cancelled";
    if (race.status !== expected) throw new AppError("RACE_STATE", "Ce règlement n'est pas exigible dans l'état actuel de la course.");

    const now = new Date();
    const [paid] = await t
      .update(settlements)
      .set({ status: "paid", amountPaid: s.amountDue, paidAt: now })
      .where(and(eq(settlements.id, settlementId), eq(settlements.status, "pending")))
      .returning();
    await logOperation(t, s.kind === "payout" ? "payout_paid" : "refund_paid", race.id, {
      settlementId,
      betId: s.betId,
      amount: s.amountDue,
    });

    const [{ n }] = (await t
      .select({ n: count() })
      .from(settlements)
      .where(and(eq(settlements.raceId, race.id), eq(settlements.status, "pending")))) as [{ n: number }];
    let raceStatus: RaceStatus = race.status;
    if (n === 0) {
      raceStatus = s.kind === "payout" ? "paid" : "refunded";
      await t.update(races).set({ status: raceStatus, completedAt: now }).where(eq(races.id, race.id));
      await logOperation(t, "race_completed", race.id, { status: raceStatus });
    }
    return { settlement: paid!, alreadyPaid: false, raceStatus };
  });
}
