import type { RaceStatus } from "./constants";

export const RACE_STATUS_LABEL: Record<RaceStatus, string> = {
  draft: "En préparation",
  open: "Paris ouverts",
  closed: "Paris clôturés",
  result: "Résultats enregistrés",
  paid: "Paiements terminés",
  cancelled: "Course annulée",
  refunded: "Remboursements terminés",
};

export type StatusTone = "neutral" | "live" | "locked" | "result" | "done" | "danger" | "muted";

export const RACE_STATUS_TONE: Record<RaceStatus, StatusTone> = {
  draft: "neutral",
  open: "live",
  closed: "locked",
  result: "result",
  paid: "done",
  cancelled: "danger",
  refunded: "muted",
};

/** Courses "actives" : opérations encore à réaliser. */
export const ACTIVE_STATUSES: RaceStatus[] = ["draft", "open", "closed", "result", "cancelled"];
export const FINISHED_STATUSES: RaceStatus[] = ["paid", "refunded"];

export type BetOutcome = "pending" | "winner" | "loser" | "refund";
export type PaymentState = "none" | "loser" | "to_pay" | "paid" | "to_refund" | "refunded";

export const PAYMENT_LABEL: Record<PaymentState, string> = {
  none: "En attente",
  loser: "Perdant",
  to_pay: "À payer",
  paid: "Payé",
  to_refund: "À rembourser",
  refunded: "Remboursé",
};

/**
 * Une course peut être supprimée définitivement si aucune somme n'est encore due :
 * - préparation, paiements terminés, remboursements terminés : oui ;
 * - paris ouverts / clôturés / annulée : seulement sans aucun pari ;
 * - résultats enregistrés (gains à payer) : non.
 * (Annulée avec paris = remboursements en attente, sinon elle serait "refunded".)
 */
export function canDeleteRace(status: RaceStatus, betCount: number): boolean {
  switch (status) {
    case "draft":
    case "paid":
    case "refunded":
      return true;
    case "open":
    case "closed":
    case "cancelled":
      return betCount === 0;
    case "result":
      return false;
  }
}
