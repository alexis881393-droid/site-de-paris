import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { errorResponse, readJson } from "@/server/http";
import { registerWithCode } from "@/server/services/auth";
import { setSessionCookie } from "@/server/session";

export const dynamic = "force-dynamic";

/** Création de compte avec un code d'accès à usage unique. Connecte directement le nouveau compte. */
export async function POST(req: Request) {
  try {
    const db = await getDb();
    const { user, token, expiresAt } = await registerWithCode(db, await readJson(req));
    const res = NextResponse.json({ user }, { status: 201, headers: { "Cache-Control": "no-store" } });
    setSessionCookie(res, token, expiresAt);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
