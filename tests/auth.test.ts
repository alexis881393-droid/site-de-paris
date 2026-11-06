import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb, setupOpenRace } from "./helpers";
import type { Db } from "@/server/db/client";
import { adminSessions, adminUsers } from "@/server/db/schema";
import {
  createAccessCode,
  deleteAccount,
  getAccountsOverview,
  login,
  logout,
  normalizeAccessCode,
  registerWithCode,
  revokeAccessCode,
  userForToken,
  verifyPassword,
} from "@/server/services/auth";
import { getPublicOdds } from "@/server/services/public";
import { closeBets, placeBet } from "@/server/services/commands";
import { AppError } from "@/server/errors";

let db: Db;
beforeEach(async () => {
  ({ db } = await createTestDb());
});

const code = async (e: Promise<unknown>) => {
  try {
    await e;
  } catch (err) {
    return (err as AppError).code;
  }
  return "OK";
};

describe("espace privé : codes d'accès et comptes", () => {
  it("crée un compte avec un code, qui ne sert qu'une fois", async () => {
    const { code: c } = await createAccessCode(db, null);
    expect(c).toMatch(/^RB-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/);
    // Saisie tolérante : minuscules, espaces, sans tirets.
    const r = await registerWithCode(db, { code: ` ${c.toLowerCase().replace(/-/g, " ")} `, username: "Alexis", password: "motdepasse1" });
    expect(r.user.username).toBe("Alexis");
    expect(await userForToken(db, r.token)).toEqual(r.user);
    expect(await code(registerWithCode(db, { code: c, username: "Autre", password: "motdepasse1" }))).toBe("FORBIDDEN");

    const [u] = await db.select().from(adminUsers);
    expect(u!.passwordHash).not.toContain("motdepasse1");
    expect(await verifyPassword("motdepasse1", u!.passwordHash)).toBe(true);
  });

  it("refuse un code inconnu, révoqué, un pseudo pris (casse ignorée) ou un mot de passe court", async () => {
    expect(await code(registerWithCode(db, { code: "RB-AAAA-BBBB-CCCC", username: "Alexis", password: "motdepasse1" }))).toBe("FORBIDDEN");
    const a = await createAccessCode(db, null);
    await registerWithCode(db, { code: a.code, username: "Alexis", password: "motdepasse1" });
    const b = await createAccessCode(db, null);
    expect(await code(registerWithCode(db, { code: b.code, username: "ALEXIS", password: "motdepasse1" }))).toBe("CONFLICT");
    expect(await code(registerWithCode(db, { code: b.code, username: "Bob", password: "court" }))).toBe("VALIDATION");
    const me = (await login(db, { username: "alexis", password: "motdepasse1" })).user;
    await revokeAccessCode(db, b.id, me);
    expect(await code(registerWithCode(db, { code: b.code, username: "Bob", password: "motdepasse1" }))).toBe("FORBIDDEN");
    expect(await code(revokeAccessCode(db, b.id, me))).toBe("CONFLICT");
  });

  it("connexion, déconnexion et blocage après 5 échecs", async () => {
    const { code: c } = await createAccessCode(db, null);
    await registerWithCode(db, { code: c, username: "Alexis", password: "motdepasse1" });
    expect(await code(login(db, { username: "inconnu", password: "x" }))).toBe("UNAUTHORIZED");
    const ok = await login(db, { username: "alexis", password: "motdepasse1" });
    await logout(db, ok.token);
    expect(await userForToken(db, ok.token)).toBeNull();
    for (let i = 0; i < 4; i++) expect(await code(login(db, { username: "Alexis", password: "mauvais!!" }))).toBe("UNAUTHORIZED");
    expect(await code(login(db, { username: "Alexis", password: "mauvais!!" }))).toBe("RATE_LIMITED");
    // Même le bon mot de passe est refusé pendant le blocage.
    expect(await code(login(db, { username: "Alexis", password: "motdepasse1" }))).toBe("RATE_LIMITED");
  });

  it("session expirée refusée ; liste des comptes ; suppression d'un autre compte uniquement", async () => {
    const first = await registerWithCode(db, { code: (await createAccessCode(db, null)).code, username: "Alexis", password: "motdepasse1" });
    const invite = await createAccessCode(db, first.user);
    const second = await registerWithCode(db, { code: invite.code, username: "Bob", password: "motdepasse2" });

    const ov = await getAccountsOverview(db, first.user);
    expect(ov.users.map((u) => [u.username, u.invitedBy, u.isMe])).toEqual([["Alexis", null, true], ["Bob", "Alexis", false]]);
    expect(ov.codes.every((c) => c.status === "used")).toBe(true);
    expect(ov.codes[0]!.hint).toBe(normalizeAccessCode(invite.code).slice(-4));

    expect(await code(deleteAccount(db, first.user.id, first.user))).toBe("FORBIDDEN");
    await deleteAccount(db, second.user.id, first.user);
    expect(await userForToken(db, second.token)).toBeNull();

    await db.update(adminSessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(adminSessions.userId, first.user.id));
    expect(await userForToken(db, first.token)).toBeNull();
  });
});

describe("vue publique des cotes", () => {
  it("expose les cotes et leur évolution, sans aucune donnée de parieur", async () => {
    const { race, drivers } = await setupOpenRace(db, { commission: "10", drivers: ["Alpha", "Bravo"] });
    await placeBet(db, race.id, { bettorName: "Tony", phone: "555-0101", driverId: drivers[0]!.id, amount: 1000 });
    await placeBet(db, race.id, { bettorName: "Mia", driverId: drivers[1]!.id, amount: 3000 });

    const r = await getPublicOdds(db, null);
    expect(r.race!.id).toBe(race.id);
    expect(r.race!.history).toHaveLength(2);
    // Après le 1er pari : seul Alpha a une cote (1000 - 10 % = 900 → ×0,90).
    expect(r.race!.history[0]!.odds).toEqual({ [drivers[0]!.id]: 90, [drivers[1]!.id]: null });
    // Après le 2e : 4000 - 400 = 3600 → Alpha ×3,60, Bravo ×1,20.
    expect(r.race!.drivers.map((d) => d.oddsCents)).toEqual([360, 120]);
    const json = JSON.stringify(r);
    for (const secret of ["Tony", "Mia", "555", "1000", "3000"]) expect(json).not.toContain(secret);

    await closeBets(db, race.id);
    expect((await getPublicOdds(db, race.id)).race!.status).toBe("closed");
  });

  it("n'affiche ni les courses en préparation ni les identifiants invalides", async () => {
    const { createRace } = await import("@/server/services/commands");
    await createRace(db, { name: "Brouillon", commissionPercent: "10" });
    expect(await getPublicOdds(db, "pas-un-uuid")).toEqual({ races: [], race: null });
  });
});
