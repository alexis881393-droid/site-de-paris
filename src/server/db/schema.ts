import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Statuts internes d'une course (affichage en français côté UI) :
 * draft = EN PRÉPARATION, open = PARIS OUVERTS, closed = PARIS CLÔTURÉS,
 * result = RÉSULTATS ENREGISTRÉS, paid = PAIEMENTS TERMINÉS,
 * cancelled = COURSE ANNULÉE, refunded = REMBOURSEMENTS TERMINÉS.
 */
import { RACE_STATUSES, SETTLEMENT_KINDS, SETTLEMENT_STATUSES } from "../../lib/constants";
export * from "../../lib/constants";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
// Montants en dollars fictifs entiers. mode "number" : valeurs bornées à 1e12 par la validation,
// donc toujours sûres en JavaScript ; les calculs se font en BigInt (src/lib/finance.ts).
const money = (name: string) => bigint(name, { mode: "number" });

export const races = pgTable(
  "races",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    scheduledAt: ts("scheduled_at"),
    /** Commission en points de base (1 250 = 12,50 %). Figée à la création. */
    commissionBps: integer("commission_bps").notNull(),
    status: text("status", { enum: RACE_STATUSES }).notNull().default("draft"),
    createdAt: ts("created_at").notNull().defaultNow(),
    openedAt: ts("opened_at"),
    closedAt: ts("closed_at"),
    resultAt: ts("result_at"),
    cancelledAt: ts("cancelled_at"),
    completedAt: ts("completed_at"),
  },
  (t) => [
    check("races_commission_range", sql`${t.commissionBps} between 0 and 10000`),
    check("races_name_not_blank", sql`length(btrim(${t.name})) between 1 and 120`),
    check(
      "races_status_valid",
      sql`${t.status} in ('draft','open','closed','result','paid','cancelled','refunded')`,
    ),
    index("races_status_idx").on(t.status),
    index("races_created_idx").on(t.createdAt),
  ],
);

export const drivers = pgTable(
  "drivers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    raceId: uuid("race_id")
      .notNull()
      .references(() => races.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(),
    number: integer("number"),
    finalPosition: integer("final_position"),
    isWinner: boolean("is_winner").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("drivers_race_name_key").on(t.raceId, t.nameKey),
    // Permet une clé étrangère composite depuis bets (pilote obligatoirement de la même course).
    unique("drivers_id_race_key").on(t.id, t.raceId),
    uniqueIndex("drivers_race_number_key").on(t.raceId, t.number).where(sql`${t.number} is not null`),
    uniqueIndex("drivers_race_position_key")
      .on(t.raceId, t.finalPosition)
      .where(sql`${t.finalPosition} is not null`),
    uniqueIndex("drivers_one_winner_per_race").on(t.raceId).where(sql`${t.isWinner}`),
    check("drivers_number_range", sql`${t.number} is null or ${t.number} between 0 and 9999`),
    check("drivers_position_range", sql`${t.finalPosition} is null or ${t.finalPosition} >= 1`),
    check("drivers_name_not_blank", sql`length(btrim(${t.name})) between 1 and 60`),
  ],
);

export const bets = pgTable(
  "bets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    raceId: uuid("race_id")
      .notNull()
      .references(() => races.id, { onDelete: "restrict" }),
    driverId: uuid("driver_id").notNull(),
    bettorName: text("bettor_name").notNull(),
    bettorNameKey: text("bettor_name_key").notNull(),
    /** Numéro de téléphone RP du parieur (colonne historique "fivem_id"). */
    phone: text("fivem_id"),
    /** Clé d'identité unique par course : "tel:<chiffres>" ou "name:<nom normalisé>" ("fivem:" = ancien format). */
    identityKey: text("identity_key").notNull(),
    amount: money("amount").notNull(),
    /** Identifiant de requête client : rend l'enregistrement idempotent (double clic). */
    requestId: uuid("request_id").unique("bets_request_id_key"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    unique("bets_one_per_player_per_race").on(t.raceId, t.identityKey),
    foreignKey({
      name: "bets_driver_same_race_fk",
      columns: [t.driverId, t.raceId],
      foreignColumns: [drivers.id, drivers.raceId],
    }).onDelete("restrict"),
    check("bets_amount_positive", sql`${t.amount} > 0 and ${t.amount} <= 1000000000000`),
    check("bets_identity_prefix", sql`${t.identityKey} ~ '^(fivem|tel|name):.+'`),
    index("bets_race_idx").on(t.raceId),
    index("bets_driver_idx").on(t.driverId),
  ],
);

/** Pilotes retirés du registre (liste « déjà enregistrés ») : n'affecte pas les courses passées. */
export const driverRegistryHidden = pgTable("driver_registry_hidden", {
  nameKey: text("name_key").primaryKey(),
  hiddenAt: ts("hidden_at").notNull().defaultNow(),
});

/** Instantané figé lors de la clôture des paris. */
export const raceClosures = pgTable(
  "race_closures",
  {
    raceId: uuid("race_id")
      .primaryKey()
      .references(() => races.id, { onDelete: "restrict" }),
    closedAt: ts("closed_at").notNull().defaultNow(),
    totalPool: money("total_pool").notNull(),
    betCount: integer("bet_count").notNull(),
    commissionBps: integer("commission_bps").notNull(),
    /** [{ driverId, pool, bets }] : base de calcul des cotes finales. */
    driverPools: jsonb("driver_pools").notNull(),
  },
  (t) => [check("race_closures_pool_nonneg", sql`${t.totalPool} >= 0`)],
);

/** Résultat officiel et répartition financière figée. */
export const raceResults = pgTable(
  "race_results",
  {
    raceId: uuid("race_id")
      .primaryKey()
      .references(() => races.id, { onDelete: "restrict" }),
    winnerDriverId: uuid("winner_driver_id")
      .notNull()
      .references(() => drivers.id, { onDelete: "restrict" }),
    recordedAt: ts("recorded_at").notNull().defaultNow(),
    totalPool: money("total_pool").notNull(),
    commissionBps: integer("commission_bps").notNull(),
    commissionAmount: money("commission_amount").notNull(),
    distributablePool: money("distributable_pool").notNull(),
    winnerPool: money("winner_pool").notNull(),
    winnersCount: integer("winners_count").notNull(),
    totalPayout: money("total_payout").notNull(),
    /** Revenu définitif de l'organisateur pour cette course. */
    organizerKept: money("organizer_kept").notNull(),
    noWinner: boolean("no_winner").notNull(),
  },
  (t) => [
    check(
      "race_results_balance",
      sql`${t.totalPayout} + ${t.organizerKept} = ${t.totalPool}`,
    ),
    check("race_results_nonneg", sql`${t.totalPayout} >= 0 and ${t.organizerKept} >= 0`),
  ],
);

/** Règlements : gains à verser ou remboursements. Au plus un règlement par pari. */
export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    raceId: uuid("race_id")
      .notNull()
      .references(() => races.id, { onDelete: "restrict" }),
    betId: uuid("bet_id")
      .notNull()
      .references(() => bets.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: SETTLEMENT_KINDS }).notNull(),
    amountDue: money("amount_due").notNull(),
    amountPaid: money("amount_paid").notNull().default(0),
    status: text("status", { enum: SETTLEMENT_STATUSES }).notNull().default("pending"),
    createdAt: ts("created_at").notNull().defaultNow(),
    paidAt: ts("paid_at"),
  },
  (t) => [
    unique("settlements_one_per_bet").on(t.betId),
    check("settlements_kind_valid", sql`${t.kind} in ('payout','refund')`),
    check("settlements_status_valid", sql`${t.status} in ('pending','paid')`),
    check("settlements_due_nonneg", sql`${t.amountDue} >= 0`),
    check(
      "settlements_paid_consistent",
      sql`(${t.status} = 'pending' and ${t.amountPaid} = 0 and ${t.paidAt} is null) or (${t.status} = 'paid' and ${t.amountPaid} = ${t.amountDue} and ${t.paidAt} is not null)`,
    ),
    index("settlements_race_idx").on(t.raceId),
  ],
);

export const OPERATION_TYPES = [
  "race_created",
  "race_deleted",
  "driver_added",
  "driver_updated",
  "driver_removed",
  "driver_hidden",
  "bets_opened",
  "bet_placed",
  "bets_closed",
  "result_recorded",
  "race_cancelled",
  "payout_paid",
  "refund_paid",
  "race_completed",
  "backup_created",
  "backup_failed",
] as const;
export type OperationType = (typeof OPERATION_TYPES)[number];

/** Journal des opérations (append-only). */
export const operationLog = pgTable(
  "operation_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    raceId: uuid("race_id"),
    type: text("type", { enum: OPERATION_TYPES }).notNull(),
    payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("operation_log_race_idx").on(t.raceId), index("operation_log_created_idx").on(t.createdAt)],
);

export type Race = typeof races.$inferSelect;
export type Driver = typeof drivers.$inferSelect;
export type Bet = typeof bets.$inferSelect;
export type Settlement = typeof settlements.$inferSelect;
export type RaceResult = typeof raceResults.$inferSelect;
export type RaceClosure = typeof raceClosures.$inferSelect;
export type OperationLogEntry = typeof operationLog.$inferSelect;
