export const RACE_STATUSES = ["draft", "open", "closed", "result", "paid", "cancelled", "refunded"] as const;
export type RaceStatus = (typeof RACE_STATUSES)[number];

export const SETTLEMENT_KINDS = ["payout", "refund"] as const;
export type SettlementKind = (typeof SETTLEMENT_KINDS)[number];

export const SETTLEMENT_STATUSES = ["pending", "paid"] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];
