import { createHash, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { and, asc, desc, eq, gt, isNull, lt } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { z } from "zod";
import type { Db, DbOrTx } from "../db/client";
import { accessCodes, adminSessions, adminUsers, type AdminUser } from "../db/schema";
import { AppError } from "../errors";
import { logOperation } from "../log";
import { formatZodError, loginSchema, registerSchema } from "@/lib/validation";
import type { AccountsOverviewDTO, SessionUserDTO } from "@/lib/dto";

const scrypt = (password: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))));

// ---------------------------------------------------------------------------
// Primitives cryptographiques
// ---------------------------------------------------------------------------

const SCRYPT = { N: 16384, r: 8, p: 1 } as const;
const MAXMEM = 64 * 1024 * 1024;
const KEYLEN = 64;

/** Hachage scrypt salé : "scrypt$N$r$p$sel$empreinte" (base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { ...SCRYPT, maxmem: MAXMEM });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), hash.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, hashB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password.normalize("NFKC"), Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: MAXMEM,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Empreinte des codes d'accès et des jetons de session (jamais stockés en clair). */
export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/**
 * Alphabet sans caractères ambigus (0/O, 1/I/L). 6 caractères = 887 millions de combinaisons :
 * court à dicter en RP, et chaque code expire au bout de CODE_TTL_DAYS jours.
 */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

export const CODE_TTL_DAYS = 7;
const codeExpired = (createdAt: Date) => createdAt.getTime() < Date.now() - CODE_TTL_DAYS * 86_400_000;

/** Code d'accès court, facile à dicter : XXX-XXX (ex. K7P-3QX). */
export function generateAccessCode(): string {
  const chars = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  return `${chars.slice(0, 3)}-${chars.slice(3)}`;
}

/** Forme canonique d'un code saisi : majuscules, sans tirets ni espaces, sans le préfixe RB. */
export function normalizeAccessCode(input: string): string {
  const s = input.toUpperCase().replace(/[^0-9A-Z]/g, "");
  return s.length === 14 && s.startsWith("RB") ? s.slice(2) : s;
}

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) throw new AppError("VALIDATION", formatZodError(r.error));
  return r.data;
}

const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

// ---------------------------------------------------------------------------
// Codes d'accès
// ---------------------------------------------------------------------------

/** Crée un code d'accès à usage unique. Le code en clair n'est renvoyé qu'ici, une seule fois. */
export async function createAccessCode(db: DbOrTx, createdBy: SessionUserDTO | null): Promise<{ id: string; code: string }> {
  const code = generateAccessCode();
  const core = normalizeAccessCode(code);
  const [row] = await db
    .insert(accessCodes)
    .values({ codeHash: sha256(core), hint: core.slice(-2), createdBy: createdBy?.id ?? null })
    .returning({ id: accessCodes.id });
  await logOperation(db, "access_code_created", null, { codeId: row!.id, by: createdBy?.username ?? "script local" });
  return { id: row!.id, code };
}

export async function revokeAccessCode(db: Db, codeId: string, by: SessionUserDTO) {
  if (!isUuid(codeId)) throw new AppError("NOT_FOUND", "Code introuvable.");
  const [row] = await db
    .update(accessCodes)
    .set({ revokedAt: new Date() })
    .where(and(eq(accessCodes.id, codeId), isNull(accessCodes.usedAt), isNull(accessCodes.revokedAt)))
    .returning({ id: accessCodes.id });
  if (!row) throw new AppError("CONFLICT", "Ce code a déjà été utilisé ou révoqué.");
  await logOperation(db, "access_code_revoked", null, { codeId, by: by.username });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Comptes et sessions
// ---------------------------------------------------------------------------

export const SESSION_DAYS = 30;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const toSessionUser = (u: AdminUser): SessionUserDTO => ({ id: u.id, username: u.username });

async function createSession(db: DbOrTx, userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  await db.insert(adminSessions).values({ id: sha256(token), userId, expiresAt });
  // Ménage opportuniste des sessions expirées.
  await db.delete(adminSessions).where(lt(adminSessions.expiresAt, new Date()));
  return { token, expiresAt };
}

/** Création de compte avec un code d'accès valide, consommé dans la même transaction. */
export async function registerWithCode(db: Db, input: unknown) {
  const { code, username, password } = parse(registerSchema, input);
  const passwordHash = await hashPassword(password);
  return db.transaction(async (t) => {
    const [ac] = await t
      .select()
      .from(accessCodes)
      .where(eq(accessCodes.codeHash, sha256(normalizeAccessCode(code))))
      .for("update");
    if (!ac || ac.usedAt || ac.revokedAt || codeExpired(ac.createdAt)) {
      throw new AppError("FORBIDDEN", "Code d'accès invalide, expiré, déjà utilisé ou révoqué.");
    }
    const usernameKey = username.toLowerCase();
    const [taken] = await t.select({ id: adminUsers.id }).from(adminUsers).where(eq(adminUsers.usernameKey, usernameKey));
    if (taken) throw new AppError("CONFLICT", "Ce pseudo est déjà pris.");
    const [user] = await t
      .insert(adminUsers)
      .values({ username, usernameKey, passwordHash, invitedBy: ac.createdBy, lastLoginAt: new Date() })
      .returning();
    await t.update(accessCodes).set({ usedAt: new Date(), usedBy: user!.id }).where(eq(accessCodes.id, ac.id));
    await logOperation(t, "account_created", null, { userId: user!.id, username, codeId: ac.id });
    const session = await createSession(t, user!.id);
    return { user: toSessionUser(user!), ...session };
  });
}

// Empreinte factice : même durée de calcul quand le pseudo n'existe pas.
let dummyHash: Promise<string> | null = null;

export async function login(db: Db, input: unknown) {
  const { username, password } = parse(loginSchema, input);
  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.usernameKey, username.toLowerCase()));
  if (!user) {
    await verifyPassword(password, await (dummyHash ??= hashPassword("racebet-dummy-password")));
    throw new AppError("UNAUTHORIZED", "Pseudo ou mot de passe incorrect.");
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const min = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    throw new AppError("RATE_LIMITED", `Trop de tentatives. Réessayez dans ${min} min.`);
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    const failed = user.failedLogins + 1;
    const lock = failed >= MAX_FAILED;
    await db
      .update(adminUsers)
      .set({ failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
      .where(eq(adminUsers.id, user.id));
    throw lock
      ? new AppError("RATE_LIMITED", `Trop de tentatives. Compte bloqué ${LOCK_MINUTES} min.`)
      : new AppError("UNAUTHORIZED", "Pseudo ou mot de passe incorrect.");
  }
  await db.update(adminUsers).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(adminUsers.id, user.id));
  const session = await createSession(db, user.id);
  return { user: toSessionUser(user), ...session };
}

export async function userForToken(db: Db, token: string | undefined): Promise<SessionUserDTO | null> {
  if (!token || token.length > 100) return null;
  const [row] = await db
    .select({ user: adminUsers })
    .from(adminSessions)
    .innerJoin(adminUsers, eq(adminUsers.id, adminSessions.userId))
    .where(and(eq(adminSessions.id, sha256(token)), gt(adminSessions.expiresAt, new Date())));
  return row ? toSessionUser(row.user) : null;
}

export async function logout(db: Db, token: string | undefined) {
  if (token && token.length <= 100) await db.delete(adminSessions).where(eq(adminSessions.id, sha256(token)));
}

/** Suppression d'un autre compte (ses sessions sont fermées). Impossible sur son propre compte. */
export async function deleteAccount(db: Db, userId: string, by: SessionUserDTO) {
  if (!isUuid(userId)) throw new AppError("NOT_FOUND", "Compte introuvable.");
  if (userId === by.id) throw new AppError("FORBIDDEN", "Vous ne pouvez pas supprimer votre propre compte.");
  const [row] = await db.delete(adminUsers).where(eq(adminUsers.id, userId)).returning({ username: adminUsers.username });
  if (!row) throw new AppError("NOT_FOUND", "Compte introuvable.");
  await logOperation(db, "account_deleted", null, { userId, username: row.username, by: by.username });
  return { ok: true };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function getAccountsOverview(db: Db, me: SessionUserDTO): Promise<AccountsOverviewDTO> {
  const inviter = alias(adminUsers, "inviter");
  const creator = alias(adminUsers, "creator");
  const consumer = alias(adminUsers, "consumer");
  const [users, codes] = await Promise.all([
    db
      .select({ u: adminUsers, invitedBy: inviter.username })
      .from(adminUsers)
      .leftJoin(inviter, eq(inviter.id, adminUsers.invitedBy))
      .orderBy(asc(adminUsers.createdAt)),
    db
      .select({ c: accessCodes, createdBy: creator.username, usedBy: consumer.username })
      .from(accessCodes)
      .leftJoin(creator, eq(creator.id, accessCodes.createdBy))
      .leftJoin(consumer, eq(consumer.id, accessCodes.usedBy))
      .orderBy(desc(accessCodes.createdAt))
      .limit(100),
  ]);
  return {
    me,
    users: users.map(({ u, invitedBy }) => ({
      id: u.id,
      username: u.username,
      createdAt: u.createdAt.toISOString(),
      lastLoginAt: iso(u.lastLoginAt),
      invitedBy,
      isMe: u.id === me.id,
    })),
    codes: codes.map(({ c, createdBy, usedBy }) => ({
      id: c.id,
      hint: c.hint,
      createdAt: c.createdAt.toISOString(),
      createdBy,
      status: c.usedAt ? "used" : c.revokedAt ? "revoked" : codeExpired(c.createdAt) ? "expired" : "active",
      usedAt: iso(c.usedAt),
      usedBy: usedBy ?? (c.usedAt ? "compte supprimé" : null),
      revokedAt: iso(c.revokedAt),
    })),
  };
}
