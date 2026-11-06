import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { errorResponse } from "@/server/http";
import { logout } from "@/server/services/auth";
import { clearSessionCookie, sessionToken } from "@/server/session";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    await logout(await getDb(), await sessionToken());
    const res = NextResponse.json({ ok: true });
    clearSessionCookie(res);
    return res;
  } catch (e) {
    return errorResponse(e);
  }
}
