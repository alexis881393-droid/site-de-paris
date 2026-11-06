import { z } from "zod";
import { MAX_AMOUNT, parseCommissionPercent } from "./finance";
import { RACE_STATUSES } from "./constants";

const trimmed = (min: number, max: number, label: string) =>
  z
    .string({ error: `${label} obligatoire` })
    .transform((s) => s.replace(/\s+/g, " ").trim())
    .pipe(
      z
        .string()
        .min(min, `${label} obligatoire`)
        .max(max, `${label} : ${max} caractères maximum`),
    );

const optionalText = (max: number, label: string) =>
  z
    .string()
    .max(max, `${label} : ${max} caractères maximum`)
    .optional()
    .nullable()
    .transform((s) => {
      const v = s?.trim();
      return v ? v : null;
    });

export const createRaceSchema = z.object({
  name: trimmed(1, 120, "Nom de la course"),
  description: optionalText(1000, "Description"),
  /** Saisie "AAAA-MM-JJTHH:MM" à l'heure de Paris. */
  scheduledAt: z
    .string()
    .optional()
    .nullable()
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v), "Date invalide"),
  commissionPercent: z
    .union([z.string(), z.number()])
    .refine((v) => parseCommissionPercent(v) !== null, "Commission : nombre entre 0 et 100, 2 décimales max."),
});
export type CreateRaceInput = z.input<typeof createRaceSchema>;

const driverNumber = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).trim());
    if (!Number.isInteger(n) || n < 0 || n > 9999) {
      ctx.addIssue({ code: "custom", message: "Numéro : entier entre 0 et 9999" });
      return z.NEVER;
    }
    return n;
  });

export const driverSchema = z.object({
  name: trimmed(1, 60, "Nom du pilote"),
  number: driverNumber,
});
export type DriverInput = z.input<typeof driverSchema>;

/** Mise : entier strictement positif. Les chaînes "10 000" sont acceptées, pas les décimales. */
export const amountSchema = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    const s = typeof v === "number" ? String(v) : v.replace(/[\s  $]/g, "");
    if (!/^\d+$/.test(s)) {
      ctx.addIssue({ code: "custom", message: "La mise doit être un nombre entier positif (sans décimales)." });
      return z.NEVER;
    }
    const n = Number(s);
    if (!Number.isSafeInteger(n) || n <= 0) {
      ctx.addIssue({ code: "custom", message: "La mise doit être strictement positive." });
      return z.NEVER;
    }
    if (n > MAX_AMOUNT) {
      ctx.addIssue({ code: "custom", message: "Mise trop élevée (1 000 milliards de $ maximum)." });
      return z.NEVER;
    }
    return n;
  });

export const placeBetSchema = z.object({
  bettorName: trimmed(1, 60, "Nom RP du parieur"),
  phone: optionalText(30, "Numéro de téléphone").refine(
    (v) => v === null || /^\+?[0-9][0-9 .\-()]{0,28}$/.test(v),
    "Numéro de téléphone invalide : chiffres, espaces, +, - ou points uniquement.",
  ),
  driverId: z.uuid("Pilote invalide"),
  amount: amountSchema,
  requestId: z.uuid().optional(),
});
export type PlaceBetInput = z.input<typeof placeBetSchema>;

export const recordResultSchema = z.object({
  winnerDriverId: z.uuid("Vainqueur invalide"),
  /** Classement informatif complet (ordre d'arrivée), vainqueur en premier si fourni. */
  ranking: z.array(z.uuid()).max(500).optional(),
});
export type RecordResultInput = z.input<typeof recordResultSchema>;

export const raceListQuerySchema = z.object({
  q: z.string().max(120).optional(),
  status: z.enum(RACE_STATUSES).optional(),
});

export function formatZodError(err: z.ZodError): string {
  return err.issues.map((i) => i.message).join(" · ");
}

/** Configuration des associés : 4 noms et parts dont la somme vaut exactement 100 %. */
export const partnersSchema = z.object({
  partners: z
    .array(
      z.object({
        id: z.string().uuid("Associé introuvable"),
        name: trimmed(1, 40, "Nom de l'associé"),
        shareBps: z.number().int("Part invalide").min(0, "Part invalide").max(10_000, "Part invalide"),
      }),
    )
    .length(4, "Il faut exactement 4 associés.")
    .refine((list) => list.reduce((s, p) => s + p.shareBps, 0) === 10_000, "La somme des parts doit faire exactement 100 %.")
    .refine((list) => new Set(list.map((p) => p.id)).size === list.length, "Associé en double."),
});
export type PartnersInput = z.input<typeof partnersSchema>;

// ---------------------------------------------------------------------------
// Espace privé
// ---------------------------------------------------------------------------

export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Pseudo : 3 caractères minimum")
  .max(24, "Pseudo : 24 caractères maximum")
  .regex(/^[\p{L}\p{N}_.-]+$/u, "Pseudo : lettres, chiffres, « _ », « . » ou « - » uniquement (sans espace)");

export const passwordSchema = z
  .string()
  .min(8, "Mot de passe : 8 caractères minimum")
  .max(128, "Mot de passe : 128 caractères maximum");

export const registerSchema = z.object({
  code: z.string().trim().min(1, "Code d'accès requis").max(40),
  username: usernameSchema,
  password: passwordSchema,
});
export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.object({
  username: z.string().trim().min(1, "Pseudo requis").max(24),
  password: z.string().min(1, "Mot de passe requis").max(128),
});
export type LoginInput = z.input<typeof loginSchema>;
