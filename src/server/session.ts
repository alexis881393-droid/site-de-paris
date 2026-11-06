import "server-only";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import type { Db } from "./db/client";
import { AppError } from "./errors";
import { userForToken } from "./services/auth";
import type { SessionUserDTO } from "@/lib/dto";

/**
 * Cookie de session : httpOnly (inaccessible au JavaScript). En production : SameSite=None + Secure,
 * pour que la connexion fonctionne aussi quand le site est intégré ailleurs (script FiveM).
 * La protection anti-CSRF est assurée par l'en-tête X-Racebet (src/proxy.ts).
 */
export const SESSION_COOKIE = "rb_session";

export async function sessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function currentUser(db: Db): Promise<SessionUserDTO | null> {
  return userForToken(db, await sessionToken());
}

/** Exige une session valide : sinon 401 (l'interface renvoie alors vers l'écran de connexion). */
export async function requireUser(db: Db): Promise<SessionUserDTO> {
  const user = await currentUser(db);
  if (!user) throw new AppError("UNAUTHORIZED", "Session expirée ou absente : reconnectez-vous.");
  return user;
}

const PROD = process.env.NODE_ENV === "production";
const SAME_SITE = PROD ? ("none" as const) : ("lax" as const);

export function setSessionCookie(res: NextResponse, token: string, expiresAt: Date) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: PROD,
    sameSite: SAME_SITE,
    partitioned: PROD,
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: PROD, sameSite: SAME_SITE, partitioned: PROD, path: "/", maxAge: 0 });
}
