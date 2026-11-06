export type ErrorCode =
  | "VALIDATION"
  | "NOT_FOUND"
  | "RACE_STATE"
  | "DUPLICATE_BET"
  | "DUPLICATE_DRIVER"
  | "DUPLICATE_NUMBER"
  | "DRIVERS_LOCKED"
  | "BET_IMMUTABLE"
  | "NOT_ENOUGH_DRIVERS"
  | "HAS_BETS"
  | "ALREADY_PAID"
  | "DB_NOT_CONFIGURED"
  | "CONFLICT"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "INTERNAL";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  NOT_FOUND: 404,
  RACE_STATE: 409,
  DUPLICATE_BET: 409,
  DUPLICATE_DRIVER: 409,
  DUPLICATE_NUMBER: 409,
  DRIVERS_LOCKED: 409,
  BET_IMMUTABLE: 405,
  NOT_ENOUGH_DRIVERS: 409,
  HAS_BETS: 409,
  ALREADY_PAID: 409,
  DB_NOT_CONFIGURED: 503,
  CONFLICT: 409,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.status = STATUS[code];
  }
}

type PgLike = { code?: string; constraint?: string; constraint_name?: string; message?: string; cause?: unknown };

/** Remonte la chaîne des causes (Drizzle encapsule les erreurs du pilote). */
export function pgErrorInfo(err: unknown): { code?: string; constraint?: string; message: string } {
  let cur: unknown = err;
  const messages: string[] = [];
  for (let i = 0; i < 6 && cur && typeof cur === "object"; i++) {
    const e = cur as PgLike;
    if (e.message) messages.push(e.message);
    if (e.code && /^[0-9A-Z]{5}$/.test(e.code)) {
      return { code: e.code, constraint: e.constraint ?? e.constraint_name, message: e.message ?? "" };
    }
    cur = e.cause;
  }
  return { message: messages.join(" | ") };
}

/** Traduit les erreurs PostgreSQL (contraintes / triggers) en erreurs métier lisibles. */
export function mapDbError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;
  const { code, constraint, message } = pgErrorInfo(err);
  if (code === "23505") {
    if (constraint === "bets_one_per_player_per_race")
      return new AppError("DUPLICATE_BET", "Ce joueur a déjà parié sur cette course. Un seul pari par joueur et par course.");
    if (constraint === "drivers_race_name_key")
      return new AppError("DUPLICATE_DRIVER", "Un pilote porte déjà ce nom dans cette course.");
    if (constraint === "drivers_race_number_key")
      return new AppError("DUPLICATE_NUMBER", "Ce numéro est déjà attribué à un autre pilote de la course.");
    if (constraint === "bets_request_id_key") return new AppError("CONFLICT", "Requête déjà traitée.");
    if (constraint === "admin_users_username_key") return new AppError("CONFLICT", "Ce pseudo est déjà pris.");
    return new AppError("CONFLICT", "Doublon refusé par la base de données.");
  }
  if (code === "42P01" || code === "42883") {
    return new AppError(
      "DB_NOT_CONFIGURED",
      "Base Neon connectée mais tables absentes : exécutez « npm run db:migrate » depuis votre PC avec la même DATABASE_URL.",
    );
  }
  if (code === "23503") return new AppError("CONFLICT", "Référence invalide (élément lié introuvable ou utilisé).");
  if (code === "23514") return new AppError("VALIDATION", "Valeur refusée par les contraintes de la base.");
  if (code === "P0001" || /RB_[A-Z_]+/.test(message)) {
    const m = /RB_([A-Z_]+): ?(.*)/.exec(message);
    const tag = m?.[1];
    const text = m?.[2] ?? message;
    switch (tag) {
      case "BET_IMMUTABLE":
        return new AppError("BET_IMMUTABLE", "Un pari validé ne peut être ni modifié ni supprimé.");
      case "BETS_NOT_OPEN":
        return new AppError("RACE_STATE", "Les paris ne sont pas ouverts pour cette course.");
      case "DRIVERS_LOCKED":
        return new AppError("DRIVERS_LOCKED", "La liste des pilotes est verrouillée.");
      case "ALREADY_PAID":
        return new AppError("ALREADY_PAID", "Règlement déjà effectué.");
      case "RACE_NOT_FOUND":
        return new AppError("NOT_FOUND", "Course introuvable.");
      default:
        return new AppError("RACE_STATE", text);
    }
  }
  return null;
}
