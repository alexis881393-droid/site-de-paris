import type { RaceAccounting, GlobalAccounting } from "./accounting";
import type { RaceStatus, SettlementKind, SettlementStatus } from "./constants";
import type { BetOutcome, PaymentState } from "./status";

/** Objets échangés entre l'API et l'interface (dates en ISO 8601 UTC). */

export type RaceDTO = {
  id: string;
  name: string;
  description: string | null;
  scheduledAt: string | null;
  commissionBps: number;
  status: RaceStatus;
  createdAt: string;
  openedAt: string | null;
  closedAt: string | null;
  resultAt: string | null;
  cancelledAt: string | null;
  completedAt: string | null;
};

export type RaceCardDTO = RaceDTO & {
  driverCount: number;
  betCount: number;
  totalStakes: number;
};

export type DriverRowDTO = {
  id: string;
  name: string;
  number: number | null;
  finalPosition: number | null;
  isWinner: boolean;
  betCount: number;
  pool: number;
  /** Cote en centièmes, tronquée (affichage uniquement). null = aucune mise. */
  oddsCents: number | null;
};

/** Pilote déjà engagé dans une course précédente (registre). */
export type KnownDriverDTO = {
  name: string;
  nameKey: string;
  number: number | null;
  races: number;
  lastUsedAt: string;
};

export type BetRowDTO = {
  id: string;
  bettorName: string;
  phone: string | null;
  driverId: string;
  driverName: string;
  driverNumber: number | null;
  amount: number;
  createdAt: string;
  oddsCents: number | null;
  outcome: BetOutcome;
  payment: PaymentState;
  /** Gain indicatif (avant résultat) ou montant exact dû (gain / remboursement). */
  amountDue: number | null;
  indicative: boolean;
  settlement: {
    id: string;
    kind: SettlementKind;
    status: SettlementStatus;
    amountDue: number;
    paidAt: string | null;
  } | null;
};

export type ResultDTO = {
  winnerDriverId: string;
  recordedAt: string;
  totalPool: number;
  commissionAmount: number;
  distributablePool: number;
  winnerPool: number;
  winnersCount: number;
  totalPayout: number;
  organizerKept: number;
  noWinner: boolean;
};

export type RaceDetailDTO = {
  race: RaceDTO;
  drivers: DriverRowDTO[];
  bets: BetRowDTO[];
  totalPool: number;
  distributable: number;
  oddsFinal: boolean;
  closure: { closedAt: string; totalPool: number; betCount: number } | null;
  result: ResultDTO | null;
  accounting: RaceAccounting;
  serverTime: string;
};

export type AccountingRowDTO = RaceDTO & { accounting: RaceAccounting };

export type GlobalAccountingDTO = {
  global: GlobalAccounting;
  races: AccountingRowDTO[];
  daily: { day: string; stakes: number; revenue: number }[];
  backup: BackupStatusDTO;
  partners: PartnersOverviewDTO;
};

export type PartnerDTO = { id: string; position: number; name: string; shareBps: number };

/** Part d'un associé sur une course. "provisional" = calculée avec les parts actuelles, pas encore figée. */
export type PartnerShareDTO = {
  partnerId: string;
  name: string;
  shareBps: number;
  amount: number;
  status: "provisional" | "pending" | "paid";
  paidAt: string | null;
};

export type PartnerRaceDTO = {
  raceId: string;
  raceName: string;
  date: string;
  revenue: number;
  /** Répartition figée (au moins une part versée). */
  locked: boolean;
  shares: PartnerShareDTO[];
};

export type PartnersOverviewDTO = {
  partners: PartnerDTO[];
  /** Somme des parts = 100 % (sinon aucun versement possible). */
  sharesValid: boolean;
  /** Toutes les courses avec un bénéfice à redistribuer (plus récentes d'abord). */
  races: PartnerRaceDTO[];
};

export type BackupStatusDTO = {
  configured: boolean;
  missing: string[];
  lastBackupAt: string | null;
  lastBackupKey: string | null;
  lastFailureAt: string | null;
  lastFailureMessage: string | null;
};

// ---------------------------------------------------------------------------
// Espace privé
// ---------------------------------------------------------------------------

export type SessionUserDTO = { id: string; username: string };

export type AccountDTO = {
  id: string;
  username: string;
  createdAt: string;
  lastLoginAt: string | null;
  /** Pseudo de l'administrateur qui a généré le code utilisé (null = code créé en local). */
  invitedBy: string | null;
  isMe: boolean;
};

export type AccessCodeDTO = {
  id: string;
  /** 4 derniers caractères du code. */
  hint: string;
  createdAt: string;
  createdBy: string | null;
  status: "active" | "used" | "revoked";
  usedAt: string | null;
  usedBy: string | null;
  revokedAt: string | null;
};

export type AccountsOverviewDTO = { me: SessionUserDTO; users: AccountDTO[]; codes: AccessCodeDTO[] };

// ---------------------------------------------------------------------------
// Vue publique
// ---------------------------------------------------------------------------

export type PublicRaceDTO = { id: string; name: string; status: RaceStatus; scheduledAt: string | null };

export type PublicDriverDTO = { id: string; name: string; number: number | null; oddsCents: number | null; isWinner: boolean };

export type PublicOddsDTO = {
  races: PublicRaceDTO[];
  race:
    | (PublicRaceDTO & {
        drivers: PublicDriverDTO[];
        /** Évolution des cotes : un point après chaque pari (cotes en centièmes, null = aucune mise). */
        history: { t: string; odds: Record<string, number | null> }[];
        serverTime: string;
      })
    | null;
};
