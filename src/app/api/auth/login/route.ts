import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { errorResponse, readJson } from "@/server/http";
import { login } from "@/server/services/auth";
import { setSessionCookie } from "@/server/session";

export const dynamic = "force-dynamic";

/** Connexion : pseudo + mot de passe. 5 échecs consécutifs bloquent le compte 15 min. */
export async function POST(req: Request) {
  try {
    const db = await getDb();
    const { user, token, expiresAt } = await login(db, await readJson(req));
    const res = NextResponse.json({ user }, { headers: { "Cache-Control": "no-store" } });
    setSessionCookie(res, token, expiresAt);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
