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
