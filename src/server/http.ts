import "server-only";
import { NextResponse } from "next/server";
import { DatabaseNotConfiguredError, getDb, type Db } from "./db/client";
import { AppError, mapDbError } from "./errors";
import { requireUser } from "./session";
import type { SessionUserDTO } from "@/lib/dto";

/**
 * Enveloppe commune des routes de l'espace privé : session obligatoire, base,
 * erreurs métier → JSON, jamais de fuite de secrets.
 */
export async function handle<T>(fn: (db: Db, user: SessionUserDTO) => Promise<T>, status = 200): Promise<NextResponse> {
  try {
    const db = await getDb();
    const user = await requireUser(db);
    const data = await fn(db, user);
    return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

/** Variante SANS session, réservée aux routes publiques (lecture seule). */
export async function handlePublic<T>(fn: (db: Db) => Promise<T>): Promise<NextResponse> {
  try {
    const db = await getDb();
    const data = await fn(db);
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof DatabaseNotConfiguredError) {
    return NextResponse.json(
      { error: { code: "DB_NOT_CONFIGURED", message: "Base de données non configurée (DATABASE_URL manquante)." } },
      { status: 503 },
    );
  }
  const mapped = e instanceof AppError ? e : mapDbError(e);
  if (mapped) {
    return NextResponse.json({ error: { code: mapped.code, message: mapped.message } }, { status: mapped.status });
  }
  console.error("[racebet] erreur inattendue", e);
  return NextResponse.json(
    { error: { code: "INTERNAL", message: "Erreur interne. Réessayez ; si le problème persiste, consultez les journaux Vercel." } },
    { status: 500 },
  );
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError("VALIDATION", "Corps de requête JSON invalide.");
  }
}
