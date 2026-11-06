import { beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createTestDb, setupOpenRace } from "./helpers";
import type { Db } from "@/server/db/client";
import { bets, drivers, partnerPayouts, races, settlements } from "@/server/db/schema";
import {
  addDriver,
  cancelRace,
  closeBets,
  createRace,
  deleteRace,
  hideKnownDriver,
  openBets,
  payPartnerShare,
  paySettlement,
  placeBet,
  recordResult,
  removeDriver,
  updateDriver,
  updatePartners,
} from "@/server/services/commands";
import { getGlobalAccounting, getPartnersOverview, getRaceDetail, listKnownDrivers } from "@/server/services/queries";
import { buildBackup, verifyBackup } from "@/server/backup/export";
import { restoreBackup } from "@/server/backup/restore";
import { AppError, pgErrorInfo } from "@/server/errors";

let db: Db;
beforeEach(async () => {
  ({ db } = await createTestDb());
});

const expectCode = async (p: Promise<unknown>, code: string) => {
  const err = await p.then(
    () => null,
    (e) => e,
  );
  expect(err, `attendu une erreur ${code}`).toBeInstanceOf(AppError);
  expect((err as AppError).code).toBe(code);
};

/** Vérifie qu'une requête SQL directe est rejetée par un trigger (erreur encapsulée par Drizzle). */
const dbRejects = async (p: PromiseLike<unknown>, re: RegExp) => {
  const err = await Promise.resolve(p).then(
    () => null,
    (e) => e,
  );
  expect(err, "la base aurait dû refuser").not.toBeNull();
  expect(pgErrorInfo(err).message).toMatch(re);
};

describe("Cycle de vie complet (Tests 1 & 11)", () => {
  it("pari mutuel : cotes, résultat, paiements idempotents, statut final", async () => {
    const { race, drivers: [A, B] } = await setupOpenRace(db);
    await placeBet(db, race.id, { bettorName: "Joueur 1", driverId: A!.id, amount: 10_000 });
    await placeBet(db, race.id, { bettorName: "Joueur 2", driverId: A!.id, amount: 30_000 });
    await placeBet(db, race.id, { bettorName: "Joueur 3", driverId: B!.id, amount: 160_000 });

    let d = await getRaceDetail(db, race.id);
    expect(d.totalPool).toBe(200_000);
    expect(d.distributable).toBe(170_000);
    expect(d.drivers.find((x) => x.id === A!.id)!.oddsCents).toBe(425);
    expect(d.drivers.find((x) => x.name === "Charlie")!.oddsCents).toBeNull();
    expect(d.accounting.organizerRevenue).toBeNull(); // pas encore un bénéfice
    expect(d.accounting.pendingStakes).toBe(200_000);

    await closeBets(db, race.id);
    await recordResult(db, race.id, { winnerDriverId: A!.id, ranking: [A!.id, B!.id] });
    d = await getRaceDetail(db, race.id);
    expect(d.race.status).toBe("result");
    const j1 = d.bets.find((b) => b.bettorName === "Joueur 1")!;
    expect(j1.payment).toBe("to_pay");
    expect(j1.amountDue).toBe(42_500);
    expect(d.bets.find((b) => b.bettorName === "Joueur 3")!.payment).toBe("loser");
    expect(d.accounting.dueToWinners).toBe(170_000);
    expect(d.accounting.organizerRevenue).toBe(30_000);

    // Test 11 : double validation d'un paiement
    const r1 = await paySettlement(db, j1.settlement!.id);
    const r2 = await paySettlement(db, j1.settlement!.id);
    expect(r1.alreadyPaid).toBe(false);
    expect(r2.alreadyPaid).toBe(true);
    d = await getRaceDetail(db, race.id);
    expect(d.accounting.paidToWinners).toBe(42_500);

    const j2 = d.bets.find((b) => b.bettorName === "Joueur 2")!;
    await Promise.all([paySettlement(db, j2.settlement!.id), paySettlement(db, j2.settlement!.id)]);
    d = await getRaceDetail(db, race.id);
    expect(d.accounting.paidToWinners).toBe(170_000);
    expect(d.accounting.remainingToPay).toBe(0);
    expect(d.race.status).toBe("paid");
    // Le trigger empêche toute "dé-validation" d'un paiement
    await dbRejects(db.update(settlements).set({ status: "pending", amountPaid: 0, paidAt: null }), /RB_ALREADY_PAID/);
  });
});

describe("Test 2 — aucun pari sur le vainqueur (bout en bout)", () => {
  it("course terminée directement, organisateur 200 000", async () => {
    const { race, drivers: [A, B, C] } = await setupOpenRace(db);
    await placeBet(db, race.id, { bettorName: "P1", driverId: A!.id, amount: 120_000 });
    await placeBet(db, race.id, { bettorName: "P2", driverId: B!.id, amount: 80_000 });
    await closeBets(db, race.id);
    await recordResult(db, race.id, { winnerDriverId: C!.id });
    const d = await getRaceDetail(db, race.id);
    expect(d.race.status).toBe("paid");
    expect(d.result!.noWinner).toBe(true);
    expect(d.accounting.organizerRevenue).toBe(200_000);
    expect(d.accounting.dueToWinners).toBe(0);
    const g = await getGlobalAccounting(db);
    expect(g.global.revenue).toBe(200_000);
    expect(g.global.noWinnerKept).toBe(200_000);
    expect(g.global.commissionsEarned).toBe(0);
  });
});

describe("Test 3 — tous sur le vainqueur", () => {
  it("cote ×0,85, 10 000 → 8 500", async () => {
    const { race, drivers: [A] } = await setupOpenRace(db);
    for (let i = 0; i < 10; i++) await placeBet(db, race.id, { bettorName: `J${i}`, driverId: A!.id, amount: 10_000 });
    await closeBets(db, race.id);
    await recordResult(db, race.id, { winnerDriverId: A!.id });
    const d = await getRaceDetail(db, race.id);
    expect(d.drivers.find((x) => x.id === A!.id)!.oddsCents).toBe(85);
    for (const b of d.bets) expect(b.amountDue).toBe(8_500);
  });
});

describe("Test 4 — annulation", () => {
  it("remboursements intégraux même après clôture, sans commission", async () => {
    const { race, drivers: [A, B] } = await setupOpenRace(db);
    await placeBet(db, race.id, { bettorName: "R1", driverId: A!.id, amount: 100_000 });
    await placeBet(db, race.id, { bettorName: "R2", driverId: B!.id, amount: 150_000 });
    await closeBets(db, race.id);
    await cancelRace(db, race.id);
    let d = await getRaceDetail(db, race.id);
    expect(d.race.status).toBe("cancelled");
    expect(d.accounting.refundsDue).toBe(250_000);
    expect(d.accounting.commissionKept).toBe(0);
    expect(d.bets.every((b) => b.payment === "to_refund")).toBe(true);
    for (const b of d.bets) await paySettlement(db, b.settlement!.id);
    d = await getRaceDetail(db, race.id);
    expect(d.race.status).toBe("refunded");
    expect(d.accounting.refundsPaid).toBe(250_000);
    expect(d.bets.every((b) => b.payment === "refunded")).toBe(true);
  });

  it("une course avec résultat officiel n'est pas annulable", async () => {
    const { race, drivers: [A] } = await setupOpenRace(db);
    await placeBet(db, race.id, { bettorName: "R1", driverId: A!.id, amount: 1000 });
    await closeBets(db, race.id);
    await recordResult(db, race.id, { winnerDriverId: A!.id });
    await expectCode(cancelRace(db, race.id), "RACE_STATE");
  });
});

describe("Test 5 — un seul pari par joueur et par course", () => {
  it("refuse un second pari, même sur un autre pilote, casse/espaces/accents différents", async () => {
    const { race, drivers: [A, B] } = await setupOpenRace(db);
    await placeBet(db, race.id, { bettorName: "José Dupont", driverId: A!.id, amount: 100 });
    await expectCode(placeBet(db, race.id, { bettorName: "  jose   DUPONT ", driverId: B!.id, amount: 100 }), "DUPLICATE_BET");
    await placeBet(db, race.id, { bettorName: "Max", phone: "555-0123", driverId: A!.id, amount: 100 });
    await expectCode(placeBet(db, race.id, { bettorName: "Autre nom", phone: "555 01 23", driverId: B!.id, amount: 100 }), "DUPLICATE_BET");
    // Même nom RP sans identifiant après un pari avec identifiant : refusé
    await expectCode(placeBet(db, race.id, { bettorName: "max", driverId: B!.id, amount: 100 }), "DUPLICATE_BET");
    // Contrainte SQL directe
    await expect(
      db.insert(bets).values({
        raceId: race.id,
        driverId: B!.id,
        bettorName: "x",
        bettorNameKey: "x",
        identityKey: "tel:5550123",
        amount: 1,
      }),
    ).rejects.toThrow();
  });

  it("le même joueur peut parier sur plusieurs courses", async () => {
    const r1 = await setupOpenRace(db, { name: "R1" });
    const r2 = await setupOpenRace(db, { name: "R2" });
    await placeBet(db, r1.race.id, { bettorName: "Nomade", driverId: r1.drivers[0]!.id, amount: 100 });
    await placeBet(db, r2.race.id, { bettorName: "Nomade", driverId: r2.drivers[0]!.id, amount: 100 });
  });
});

describe("Test 6 — pari verrouillé", () => {
  it("UPDATE / DELETE / TRUNCATE refusés par la base", async () => {
    const { race, drivers: [A, B] } = await setupOpenRace(db);
    const { bet } = await placeBet(db, race.id, { bettorName: "Fixe", driverId: A!.id, amount: 5000 });
    await dbRejects(db.update(bets).set({ amount: 1 }).where(eq(bets.id, bet.id)), /RB_BET_IMMUTABLE/);
    await dbRejects(db.update(bets).set({ driverId: B!.id }).where(eq(bets.id, bet.id)), /RB_BET_IMMUTABLE/);
    await dbRejects(db.delete(bets).where(eq(bets.id, bet.id)), /RB_BET_IMMUTABLE/);
    await dbRejects(db.execute(sql`truncate bets cascade`), /RB_BET_IMMUTABLE|truncate/i);
    const [still] = await db.select().from(bets).where(eq(bets.id, bet.id));
    expect(still!.amount).toBe(5000);
  });

  it("paris refusés hors période d'ouverture, y compris en SQL direct", async () => {
    const race = await createRace(db, { name: "Prépa", commissionPercent: "10" });
    const a = await addDriver(db, race.id, { name: "A" });
    await addDriver(db, race.id, { name: "B" });
    await expectCode(placeBet(db, race.id, { bettorName: "Tôt", driverId: a.id, amount: 10 }), "RACE_STATE");
    await dbRejects(
      db.insert(bets).values({ raceId: race.id, driverId: a.id, bettorName: "x", bettorNameKey: "x", identityKey: "name:x", amount: 1 }), /RB_BETS_NOT_OPEN/);
  });

  it("pilotes verrouillés après ouverture, commission immuable", async () => {
    const { race, drivers: [A] } = await setupOpenRace(db);
    await expectCode(addDriver(db, race.id, { name: "Tard" }), "RACE_STATE");
    await expectCode(updateDriver(db, race.id, A!.id, { name: "Renommé" }), "RACE_STATE");
    await expectCode(removeDriver(db, race.id, A!.id), "RACE_STATE");
    await dbRejects(db.update(drivers).set({ name: "SQL" }).where(eq(drivers.id, A!.id)), /RB_DRIVERS_LOCKED/);
    await dbRejects(db.update(races).set({ commissionBps: 0 }).where(eq(races.id, race.id)), /RB_COMMISSION_LOCKED/);
    await dbRejects(db.update(races).set({ status: "paid" }).where(eq(races.id, race.id)), /RB_INVALID_TRANSITION/);
  });

  it("au moins deux pilotes, noms uniques normalisés", async () => {
    const race = await createRace(db, { name: "Duo", commissionPercent: "12,5" });
    expect(race.commissionBps).toBe(1250);
    await addDriver(db, race.id, { name: "Éclair", number: 7 });
    await expectCode(openBets(db, race.id), "NOT_ENOUGH_DRIVERS");
    await expectCode(addDriver(db, race.id, { name: "  eclair " }), "DUPLICATE_DRIVER");
    await expectCode(addDriver(db, race.id, { name: "Autre", number: 7 }), "DUPLICATE_NUMBER");
  });

  it("suppression : impossible avec des paris, possible en préparation", async () => {
    const { race, drivers: [A] } = await setupOpenRace(db);
    await placeBet(db, race.id, { bettorName: "P", driverId: A!.id, amount: 1 });
    await expectCode(deleteRace(db, race.id), "HAS_BETS");
    const draft = await createRace(db, { name: "Brouillon", commissionPercent: "5" });
    await addDriver(db, draft.id, { name: "X" });
    await deleteRace(db, draft.id);
    expect(await db.select().from(races).where(eq(races.id, draft.id))).toHaveLength(0);
  });

  it("course terminée : suppression complète ; refusée tant que des gains ou remboursements sont dus", async () => {
    const { race, drivers: [A, B] } = await setupOpenRace(db);
    await placeBet(db, race.id, { bettorName: "G", driverId: A!.id, amount: 1000 });
    await placeBet(db, race.id, { bettorName: "P", driverId: B!.id, amount: 1000 });
    await closeBets(db, race.id);
    await recordResult(db, race.id, { winnerDriverId: A!.id });
    await expectCode(deleteRace(db, race.id), "RACE_STATE"); // gain à payer
    const d = await getRaceDetail(db, race.id);
    await paySettlement(db, d.bets.find((b) => b.settlement)!.settlement!.id);
    await deleteRace(db, race.id);
    expect(await db.select().from(races).where(eq(races.id, race.id))).toHaveLength(0);
    expect(await db.select().from(bets).where(eq(bets.raceId, race.id))).toHaveLength(0);
    expect(await db.select().from(settlements).where(eq(settlements.raceId, race.id))).toHaveLength(0);
    // Les garde-fous sont rétablis après la suppression
    const other = await setupOpenRace(db, { name: "Autre" });
    const { bet } = await placeBet(db, other.race.id, { bettorName: "X", driverId: other.drivers[0]!.id, amount: 5 });
    await dbRejects(db.delete(bets).where(eq(bets.id, bet.id)), /RB_BET_IMMUTABLE/);
    // Annulée avec remboursements en attente : refusé, puis possible une fois remboursé
    await cancelRace(db, other.race.id);
    await expectCode(deleteRace(db, other.race.id), "RACE_STATE");
    const o = await getRaceDetail(db, other.race.id);
    await paySettlement(db, o.bets[0]!.settlement!.id);
    await deleteRace(db, other.race.id);
    // La fonction SQL refuse aussi une course avec gains dus (appel direct)
    const third = await setupOpenRace(db, { name: "Trois" });
    await placeBet(db, third.race.id, { bettorName: "Y", driverId: third.drivers[0]!.id, amount: 5 });
    await closeBets(db, third.race.id);
    await recordResult(db, third.race.id, { winnerDriverId: third.drivers[0]!.id });
    await dbRejects(db.execute(sql`select racebet_purge_race(${third.race.id}::uuid)`), /RB_RACE_NOT_DELETABLE/);
  });

  it("registre : un pilote retiré n'apparaît plus, réapparaît s'il est recréé", async () => {
    await setupOpenRace(db, { name: "R", drivers: ["Alpha", "Bravo"] });
    await hideKnownDriver(db, "alpha");
    expect((await listKnownDrivers(db)).map((k) => k.nameKey)).toEqual(["bravo"]);
    const r2 = await createRace(db, { name: "R2", commissionPercent: "5" });
    await addDriver(db, r2.id, { name: "Alpha" });
    expect((await listKnownDrivers(db)).map((k) => k.nameKey)).toEqual(["alpha", "bravo"]);
  });
});

describe("Registre des pilotes", () => {
  it("liste les pilotes déjà créés, dédoublonnés, avec leur dernier numéro", async () => {
    await setupOpenRace(db, { name: "R1", drivers: ["Alpha", "Bravo"] });
    const r2 = await createRace(db, { name: "R2", commissionPercent: "10" });
    await addDriver(db, r2.id, { name: "  ALPHA ", number: 42 });
    const known = await listKnownDrivers(db);
    expect(known.map((k) => k.nameKey)).toEqual(["alpha", "bravo"]);
    const alpha = known.find((k) => k.nameKey === "alpha")!;
    expect(alpha.races).toBe(2);
    expect(alpha.number).toBe(42);
    expect(alpha.name).toBe("ALPHA");
  });
});

describe("Test 7 — courses indépendantes", () => {
  it("les paris d'une course ne modifient ni les cotes ni les comptes d'une autre", async () => {
    const r1 = await setupOpenRace(db, { name: "Course 1" });
    const r2 = await setupOpenRace(db, { name: "Course 2", commission: "20" });
    await placeBet(db, r1.race.id, { bettorName: "A", driverId: r1.drivers[0]!.id, amount: 1000 });
    await placeBet(db, r1.race.id, { bettorName: "B", driverId: r1.drivers[1]!.id, amount: 3000 });
    const before = await getRaceDetail(db, r2.race.id);
    await placeBet(db, r2.race.id, { bettorName: "C", driverId: r2.drivers[0]!.id, amount: 500 });
    const d1 = await getRaceDetail(db, r1.race.id);
    const d2 = await getRaceDetail(db, r2.race.id);
    expect(before.totalPool).toBe(0);
    expect(d1.totalPool).toBe(4000);
    expect(d2.totalPool).toBe(500);
    expect(d1.drivers[0]!.oddsCents).toBe(340); // 3400 / 1000
    expect(d2.drivers[0]!.oddsCents).toBe(80);
    // Pilote d'une autre course refusé (clé étrangère composite)
    await expectCode(placeBet(db, r2.race.id, { bettorName: "D", driverId: r1.drivers[0]!.id, amount: 10 }), "VALIDATION");
  });
});

describe("Test 8 — concurrence", () => {
  it("deux demandes simultanées du même joueur → un seul pari", async () => {
    const { race, drivers: [A, B] } = await setupOpenRace(db);
    const results = await Promise.allSettled([
      placeBet(db, race.id, { bettorName: "Rapide", driverId: A!.id, amount: 100 }),
      placeBet(db, race.id, { bettorName: "RAPIDE", driverId: B!.id, amount: 200 }),
      placeBet(db, race.id, { bettorName: "rapide ", driverId: A!.id, amount: 300 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(bets).where(eq(bets.raceId, race.id))).toHaveLength(1);
  });

  it("double clic (même requestId) → idempotent", async () => {
    const { race, drivers: [A] } = await setupOpenRace(db);
    const requestId = crypto.randomUUID();
    const [a, b] = await Promise.all([
      placeBet(db, race.id, { bettorName: "Clic", driverId: A!.id, amount: 100, requestId }),
      placeBet(db, race.id, { bettorName: "Clic", driverId: A!.id, amount: 100, requestId }),
    ]);
    expect(a.bet.id).toBe(b.bet.id);
    expect(await db.select().from(bets)).toHaveLength(1);
  });

  it("clôture concurrente : cagnotte figée cohérente avec les paris acceptés", async () => {
    const { race, drivers: [A, B] } = await setupOpenRace(db);
    const ops = [
      ...Array.from({ length: 10 }, (_, i) => placeBet(db, race.id, { bettorName: `C${i}`, driverId: (i % 2 ? A : B)!.id, amount: 1000 + i })),
      closeBets(db, race.id),
      ...Array.from({ length: 10 }, (_, i) => placeBet(db, race.id, { bettorName: `D${i}`, driverId: A!.id, amount: 50 })),
    ];
    await Promise.allSettled(ops);
    const accepted = await db.select().from(bets).where(eq(bets.raceId, race.id));
    const d = await getRaceDetail(db, race.id);
    expect(d.race.status).toBe("closed");
    expect(d.closure!.totalPool).toBe(accepted.reduce((s, b) => s + b.amount, 0));
    expect(d.closure!.betCount).toBe(accepted.length);
    expect(d.totalPool).toBe(d.closure!.totalPool);
    await expectCode(placeBet(db, race.id, { bettorName: "Après", driverId: A!.id, amount: 1 }), "RACE_STATE");
  });
});

describe("Test 9 — arrondis en base", () => {
  it("somme des gains = cagnotte distribuable avec parts fractionnaires", async () => {
    const { race, drivers: [A, B] } = await setupOpenRace(db, { commission: "12,5" });
    for (const [i, amt] of [333, 777, 1001, 13].entries()) {
      await placeBet(db, race.id, { bettorName: `W${i}`, driverId: A!.id, amount: amt });
    }
    await placeBet(db, race.id, { bettorName: "L", driverId: B!.id, amount: 9_999 });
    await closeBets(db, race.id);
    await recordResult(db, race.id, { winnerDriverId: A!.id });
    const d = await getRaceDetail(db, race.id);
    const total = d.bets.filter((b) => b.outcome === "winner").reduce((s, b) => s + b.amountDue!, 0);
    expect(total).toBe(d.result!.distributablePool);
    expect(d.result!.totalPayout + d.result!.organizerKept).toBe(d.result!.totalPool);
  });
});

describe("Tests 10 & 12 — persistance et sauvegarde", () => {
  it("export complet relu et restauré à l'identique dans une base vierge", async () => {
    const { race, drivers: [A, B] } = await setupOpenRace(db);
    await placeBet(db, race.id, { bettorName: "S1", phone: "555-0001", driverId: A!.id, amount: 7000 });
    await placeBet(db, race.id, { bettorName: "S2", driverId: B!.id, amount: 3000 });
    await closeBets(db, race.id);
    await recordResult(db, race.id, { winnerDriverId: A!.id });
    const s = (await getRaceDetail(db, race.id)).bets[0]!.settlement!;
    await paySettlement(db, s.id);
    const r2 = await createRace(db, { name: "Annulée", commissionPercent: "10" });
    await addDriver(db, r2.id, { name: "Z" });
    await addDriver(db, r2.id, { name: "Y" });
    await cancelRace(db, r2.id);

    const backup = await buildBackup(db);
    const json = JSON.parse(JSON.stringify(backup));
    expect(verifyBackup(json).ok).toBe(true);

    const { db: target } = await createTestDb();
    await restoreBackup(target, json);
    const again = await buildBackup(target);
    expect(again.data).toEqual(backup.data);
    expect(again.checksum.value).toBe(backup.checksum.value);

    // Données toujours exploitables après restauration (triggers réactivés)
    const restored = await getRaceDetail(target, race.id);
    expect(restored.accounting.paidToWinners).toBe(10_000 - Math.floor((10_000 * 1500) / 10_000));
    await dbRejects(target.delete(bets), /RB_BET_IMMUTABLE/);

    // Restauration refusée sur une base non vide (pas de doublon)
    await expect(restoreBackup(target, json)).rejects.toThrow(/contient déjà/);
    const counts = await buildBackup(target);
    expect(counts.counts).toEqual(backup.counts);

    // Fichier altéré refusé
    json.data.bets[0].amount = 1;
    expect(verifyBackup(json).ok).toBe(false);
  });
});

describe("Redistribution des bénéfices entre associés", () => {
  async function raceWithProfit(name = "GP Associés") {
    const { race, drivers: [A, B] } = await setupOpenRace(db, { name, commission: "10" });
    await placeBet(db, race.id, { bettorName: "G", driverId: A!.id, amount: 50_000 });
    await placeBet(db, race.id, { bettorName: "P", driverId: B!.id, amount: 50_003 });
    await closeBets(db, race.id);
    await recordResult(db, race.id, { winnerDriverId: A!.id });
    return race; // bénéfice = commission 10 % de 100 003 = 10 000
  }

  it("4 associés à 25 % par défaut, répartition provisoire puis figée au premier versement", async () => {
    const race = await raceWithProfit();
    let o = await getPartnersOverview(db);
    expect(o.partners.map((p) => p.shareBps)).toEqual([2500, 2500, 2500, 2500]);
    expect(o.sharesValid).toBe(true);
    const r = o.races.find((x) => x.raceId === race.id)!;
    expect(r.revenue).toBe(10_000);
    expect(r.locked).toBe(false);
    expect(r.shares.map((s) => s.amount)).toEqual([2500, 2500, 2500, 2500]);

    const [p1, p2, p3, p4] = o.partners;
    const first = await payPartnerShare(db, race.id, p1!.id);
    const again = await payPartnerShare(db, race.id, p1!.id);
    expect(first.alreadyPaid).toBe(false);
    expect(again.alreadyPaid).toBe(true);

    // Changer les parts ensuite ne modifie pas une course déjà figée.
    await updatePartners(db, {
      partners: [
        { id: p1!.id, name: "Tony", shareBps: 4000 },
        { id: p2!.id, name: "Lena", shareBps: 2000 },
        { id: p3!.id, name: "Marco", shareBps: 2000 },
        { id: p4!.id, name: "Ines", shareBps: 2000 },
      ],
    });
    o = await getPartnersOverview(db);
    const locked = o.races.find((x) => x.raceId === race.id)!;
    expect(locked.locked).toBe(true);
    expect(locked.shares.map((s) => [s.name, s.amount, s.status])).toEqual([
      ["Associé 1", 2500, "paid"],
      ["Associé 2", 2500, "pending"],
      ["Associé 3", 2500, "pending"],
      ["Associé 4", 2500, "pending"],
    ]);
    // Une nouvelle course utilise les nouvelles parts.
    const other = await raceWithProfit("GP 2");
    const fresh = (await getPartnersOverview(db)).races.find((x) => x.raceId === other.id)!;
    expect(fresh.shares.map((s) => [s.name, s.amount])).toEqual([["Tony", 4000], ["Lena", 2000], ["Marco", 2000], ["Ines", 2000]]);

    // Montant figé en base : modification directe refusée.
    await dbRejects(db.update(partnerPayouts).set({ amount: 1 }).where(eq(partnerPayouts.raceId, race.id)), /RB_PARTNER_PAYOUT_IMMUTABLE/);
    await dbRejects(db.delete(partnerPayouts), /RB_PARTNER_PAYOUT_IMMUTABLE/);

    // Suppression de la course refusée tant que des parts restent à verser.
    const d = await getRaceDetail(db, race.id);
    await paySettlement(db, d.bets.find((b) => b.settlement)!.settlement!.id);
    await expectCode(deleteRace(db, race.id), "RACE_STATE");
    for (const p of [p2, p3, p4]) await payPartnerShare(db, race.id, p!.id);
    await deleteRace(db, race.id);
    expect(await db.select().from(partnerPayouts).where(eq(partnerPayouts.raceId, race.id))).toHaveLength(0);
  });

  it("parts invalides refusées ; versement impossible sans résultat", async () => {
    const o = await getPartnersOverview(db);
    await expectCode(
      updatePartners(db, { partners: o.partners.map((p) => ({ id: p.id, name: p.name, shareBps: 2000 })) }),
      "VALIDATION",
    );
    const { race } = await setupOpenRace(db);
    await expectCode(payPartnerShare(db, race.id, o.partners[0]!.id), "RACE_STATE");
  });
});
