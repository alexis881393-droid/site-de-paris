import { describe, expect, it } from "vitest";
import {
  allocatePayouts,
  computeCommission,
  computeDistributable,
  computeOddsCents,
  parseCommissionPercent,
  planCancellation,
  planResult,
} from "@/lib/finance";
import { computeGlobalAccounting, computeRaceAccounting } from "@/lib/accounting";
import { bettorIdentityKey, normalizeName } from "@/lib/identity";
import { formatMoney, formatOdds, parisLocalToDate } from "@/lib/format";
import { amountSchema } from "@/lib/validation";

const bet = (id: string, driverId: string, amount: number, t = 0) => ({
  id,
  driverId,
  amount,
  createdAt: new Date(1_700_000_000_000 + t),
});

describe("Test 1 — pari mutuel classique", () => {
  it("cagnotte 200 000, commission 15 %, 40 000 sur le vainqueur → ×4,25", () => {
    const bets = [
      bet("a", "A", 10_000, 1),
      bet("b", "A", 30_000, 2),
      bet("c", "B", 100_000, 3),
      bet("d", "C", 60_000, 4),
    ];
    const plan = planResult(bets, "A", 1500);
    expect(plan.totalPool).toBe(200_000n);
    expect(plan.commissionTheoretical).toBe(30_000n);
    expect(plan.distributable).toBe(170_000n);
    expect(plan.winnerPool).toBe(40_000n);
    expect(computeOddsCents(plan.distributable, plan.winnerPool)).toBe(425n);
    expect(formatOdds(425)).toBe("×4,25");
    const a = plan.payouts.find((p) => p.betId === "a")!;
    expect(a.amount).toBe(42_500n); // 10 000 × 4,25, mise comprise
    expect(plan.totalPayout).toBe(170_000n);
    expect(plan.organizerKept).toBe(30_000n);
    expect(plan.commissionKept).toBe(30_000n);
  });
});

describe("Test 2 — aucun pari sur le vainqueur", () => {
  it("l'organisateur conserve 100 % de la cagnotte, aucun paiement", () => {
    const bets = [bet("a", "A", 120_000), bet("b", "B", 80_000)];
    const plan = planResult(bets, "Z", 1500);
    expect(plan.noWinner).toBe(true);
    expect(plan.organizerKept).toBe(200_000n);
    expect(plan.totalPayout).toBe(0n);
    expect(plan.payouts).toHaveLength(0);
    // La commission est absorbée : jamais comptée en plus.
    expect(plan.commissionKept).toBe(0n);
    const acc = computeRaceAccounting({
      status: "paid",
      commissionBps: 1500,
      driverCount: 3,
      bettorCount: 2,
      totalStakes: 200_000,
      payoutDue: 0,
      payoutPaid: 0,
      refundDue: 0,
      refundPaid: 0,
      result: { organizerKept: 200_000, noWinner: true, distributablePool: 170_000, commissionAmount: 30_000 },
    });
    const g = computeGlobalAccounting([acc]);
    expect(g.revenue).toBe(200_000);
    expect(g.noWinnerKept).toBe(200_000);
    expect(g.commissionsEarned).toBe(0);
  });
});

describe("Test 3 — tous les paris sur le vainqueur", () => {
  it("cote ×0,85 : 10 000 misés rapportent 8 500", () => {
    const bets = Array.from({ length: 10 }, (_, i) => bet(`b${i}`, "A", 10_000, i));
    const plan = planResult(bets, "A", 1500);
    expect(plan.distributable).toBe(85_000n);
    expect(computeOddsCents(plan.distributable, plan.winnerPool)).toBe(85n);
    expect(formatOdds(85)).toBe("×0,85");
    for (const p of plan.payouts) expect(p.amount).toBe(8_500n);
    expect(plan.organizerKept).toBe(15_000n);
  });
});

describe("Test 4 — annulation", () => {
  it("remboursement intégral de 250 000, commission 0", () => {
    const bets = [bet("a", "A", 100_000), bet("b", "B", 150_000)];
    const plan = planCancellation(bets);
    expect(plan.totalRefund).toBe(250_000n);
    expect(plan.commissionKept).toBe(0n);
    const acc = computeRaceAccounting({
      status: "cancelled",
      commissionBps: 1500,
      driverCount: 2,
      bettorCount: 2,
      totalStakes: 250_000,
      payoutDue: 0,
      payoutPaid: 0,
      refundDue: 250_000,
      refundPaid: 0,
      result: null,
    });
    expect(acc.commissionKept).toBe(0);
    expect(acc.organizerRevenue).toBe(0);
    expect(acc.refundsRemaining).toBe(250_000);
  });
});

describe("Test 9 — arrondis (plus grands restes)", () => {
  it("la somme des gains égale exactement la cagnotte distribuable", () => {
    const winners = [bet("x", "A", 3, 1), bet("y", "A", 3, 2), bet("z", "A", 3, 3)];
    const payouts = allocatePayouts(100n, winners);
    expect(payouts.reduce((s, p) => s + p.amount, 0n)).toBe(100n);
    // 33,33… chacun : le dollar restant va au pari le plus ancien (égalité parfaite).
    expect(payouts.map((p) => p.amount)).toEqual([34n, 33n, 33n]);
  });

  it("résultat stable quel que soit l'ordre d'entrée", () => {
    const winners = [bet("x", "A", 7, 1), bet("y", "A", 11, 2), bet("z", "A", 13, 3), bet("w", "A", 1, 4)];
    const a = allocatePayouts(1_000_003n, winners);
    const b = allocatePayouts(1_000_003n, [...winners].reverse());
    const byId = (arr: { betId: string; amount: bigint }[]) => Object.fromEntries(arr.map((p) => [p.betId, p.amount]));
    expect(byId(a)).toEqual(byId(b));
    expect(a.reduce((s, p) => s + p.amount, 0n)).toBe(1_000_003n);
  });

  it("propriété : somme exacte sur 500 tirages aléatoires", () => {
    let seed = 42;
    const rand = () => (seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31;
    for (let k = 0; k < 500; k++) {
      const n = 1 + Math.floor(rand() * 25);
      const bets = Array.from({ length: n }, (_, i) => bet(`b${i}`, rand() < 0.4 ? "A" : "B", 1 + Math.floor(rand() * 1_000_000), i));
      if (!bets.some((b) => b.driverId === "A")) bets[0]!.driverId = "A";
      const bps = Math.floor(rand() * 10_001);
      const plan = planResult(bets, "A", bps);
      const total = plan.payouts.reduce((s, p) => s + p.amount, 0n);
      expect(total).toBe(plan.distributable);
      expect(plan.totalPayout + plan.organizerKept).toBe(plan.totalPool);
      for (const p of plan.payouts) expect(p.amount >= 0n).toBe(true);
    }
  });

  it("aucune erreur de flottant sur de très gros montants", () => {
    const D = computeDistributable(999_999_999_999, 1234);
    expect(D).toBe(999_999_999_999n - computeCommission(999_999_999_999, 1234));
    const p = allocatePayouts(D, [bet("a", "A", 333_333_333_333), bet("b", "A", 666_666_666_666)]);
    expect(p.reduce((s, x) => s + x.amount, 0n)).toBe(D);
  });

  it("commission arrondie à l'entier inférieur", () => {
    expect(computeCommission(99, 1250)).toBe(12n); // 12,375 → 12
    expect(computeDistributable(99, 1250)).toBe(87n);
  });
});

describe("Saisies et normalisation", () => {
  it("commission décimale", () => {
    expect(parseCommissionPercent("12,5")).toBe(1250);
    expect(parseCommissionPercent("15")).toBe(1500);
    expect(parseCommissionPercent("0")).toBe(0);
    expect(parseCommissionPercent("100")).toBe(10000);
    expect(parseCommissionPercent("100.01")).toBeNull();
    expect(parseCommissionPercent("-1")).toBeNull();
    expect(parseCommissionPercent("12.345")).toBeNull();
  });

  it("mise : entier strictement positif uniquement", () => {
    expect(amountSchema.safeParse("10 000").data).toBe(10_000);
    expect(amountSchema.safeParse(0).success).toBe(false);
    expect(amountSchema.safeParse(-5).success).toBe(false);
    expect(amountSchema.safeParse("12.5").success).toBe(false);
    expect(amountSchema.safeParse(12.5).success).toBe(false);
    expect(amountSchema.safeParse("abc").success).toBe(false);
  });

  it("identité du parieur insensible à la casse, aux accents et aux espaces", () => {
    expect(normalizeName("  José   DUPONT ")).toBe("jose dupont");
    expect(bettorIdentityKey("José Dupont")).toBe(bettorIdentityKey("jose  dupont"));
    expect(bettorIdentityKey("X", " License:ABC ")).toBe("fivem:license:abc");
    // Préfixes distincts : un nom RP ne peut pas imiter un identifiant FiveM.
    expect(bettorIdentityKey("license:abc")).not.toBe(bettorIdentityKey("Y", "license:abc"));
  });

  it("formats français et fuseau de Paris", () => {
    expect(formatMoney(125000)).toBe("125 000 $");
    expect(parisLocalToDate("2026-07-14T21:30")!.toISOString()).toBe("2026-07-14T19:30:00.000Z"); // été UTC+2
    expect(parisLocalToDate("2026-12-24T21:30")!.toISOString()).toBe("2026-12-24T20:30:00.000Z"); // hiver UTC+1
  });
});
