import { computeCommission } from "./finance";
import type { RaceStatus } from "./constants";

/** Données persistées minimales d'une course nécessaires à sa comptabilité. */
export type RaceAccountingInput = {
  status: RaceStatus;
  commissionBps: number;
  driverCount: number;
  bettorCount: number;
  totalStakes: number;
  payoutDue: number;
  payoutPaid: number;
  refundDue: number;
  refundPaid: number;
  /** Présent uniquement si un résultat officiel est enregistré. */
  result: { organizerKept: number; noWinner: boolean; distributablePool: number; commissionAmount: number } | null;
};

export type RaceAccounting = {
  status: RaceStatus;
  driverCount: number;
  bettorCount: number;
  totalStakes: number;
  commissionBps: number;
  /** Commission prévue au taux de la course (référence). */
  commissionTheoretical: number;
  /** Commission réellement acquise : 0 si annulée ou sans gagnant ; null tant qu'il n'y a pas de résultat. */
  commissionKept: number | null;
  /** Cagnotte conservée car aucun parieur gagnant (inclut la commission absorbée). */
  noWinnerKept: number;
  distributable: number;
  dueToWinners: number;
  paidToWinners: number;
  remainingToPay: number;
  refundsDue: number;
  refundsPaid: number;
  refundsRemaining: number;
  /** Revenu définitivement acquis par l'organisateur ; null si non encore déterminé. */
  organizerRevenue: number | null;
  /** Mises détenues en attente de résultat : PAS un bénéfice. */
  pendingStakes: number;
  /** Fonds encore en caisse = mises − versements − remboursements. */
  cashHeld: number;
  noWinner: boolean;
  finalized: boolean;
};

const UNDECIDED: RaceStatus[] = ["draft", "open", "closed"];

export function computeRaceAccounting(i: RaceAccountingInput): RaceAccounting {
  const commissionTheoretical = Number(computeCommission(i.totalStakes, i.commissionBps));
  const cancelled = i.status === "cancelled" || i.status === "refunded";
  const hasResult = i.result !== null && !cancelled;
  const noWinner = hasResult && i.result!.noWinner;

  let commissionKept: number | null = null;
  let organizerRevenue: number | null = null;
  if (cancelled) {
    commissionKept = 0;
    organizerRevenue = 0;
  } else if (hasResult) {
    commissionKept = noWinner ? 0 : i.result!.commissionAmount;
    organizerRevenue = i.result!.organizerKept;
  }

  return {
    status: i.status,
    driverCount: i.driverCount,
    bettorCount: i.bettorCount,
    totalStakes: i.totalStakes,
    commissionBps: i.commissionBps,
    commissionTheoretical,
    commissionKept,
    noWinnerKept: noWinner ? i.result!.organizerKept : 0,
    distributable: hasResult ? i.result!.distributablePool : i.totalStakes - commissionTheoretical,
    dueToWinners: i.payoutDue,
    paidToWinners: i.payoutPaid,
    remainingToPay: i.payoutDue - i.payoutPaid,
    refundsDue: i.refundDue,
    refundsPaid: i.refundPaid,
    refundsRemaining: i.refundDue - i.refundPaid,
    organizerRevenue,
    pendingStakes: UNDECIDED.includes(i.status) ? i.totalStakes : 0,
    cashHeld: i.totalStakes - i.payoutPaid - i.refundPaid,
    noWinner,
    finalized: i.status === "paid" || i.status === "refunded",
  };
}

export type GlobalAccounting = {
  raceCount: number;
  activeCount: number;
  finishedCount: number;
  cancelledCount: number;
  totalStakes: number;
  commissionsEarned: number;
  noWinnerKept: number;
  revenue: number;
  remainingToPay: number;
  refundsRemaining: number;
  paidToWinners: number;
  refundsPaid: number;
  pendingStakes: number;
  cashHeld: number;
};

/**
 * Agrégation globale. Le revenu = commissions acquises (courses avec gagnants)
 * + cagnottes conservées (courses sans gagnant). Pour une même course, ces deux
 * postes sont mutuellement exclusifs : aucun double comptage possible.
 */
export function computeGlobalAccounting(rows: RaceAccounting[]): GlobalAccounting {
  const sum = (f: (r: RaceAccounting) => number) => rows.reduce((s, r) => s + f(r), 0);
  return {
    raceCount: rows.length,
    activeCount: rows.filter((r) => !r.finalized && r.status !== "cancelled").length +
      rows.filter((r) => r.status === "cancelled" && r.refundsRemaining > 0).length,
    finishedCount: rows.filter((r) => r.finalized).length,
    cancelledCount: rows.filter((r) => r.status === "cancelled" || r.status === "refunded").length,
    totalStakes: sum((r) => r.totalStakes),
    commissionsEarned: sum((r) => (r.noWinner ? 0 : (r.commissionKept ?? 0))),
    noWinnerKept: sum((r) => r.noWinnerKept),
    revenue: sum((r) => r.organizerRevenue ?? 0),
    remainingToPay: sum((r) => r.remainingToPay),
    refundsRemaining: sum((r) => r.refundsRemaining),
    paidToWinners: sum((r) => r.paidToWinners),
    refundsPaid: sum((r) => r.refundsPaid),
    pendingStakes: sum((r) => r.pendingStakes),
    cashHeld: sum((r) => r.cashHeld),
  };
}
