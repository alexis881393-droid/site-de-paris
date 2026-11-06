import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/server/db/client";
import { backupConfigStatus } from "@/server/backup/config";
import { runR2Backup } from "@/server/backup/r2";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const a = Buffer.from(req.headers.get("authorization") ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Sauvegarde quotidienne (Vercel Cron, 1 fois par jour sur l'offre Hobby).
 * Protégée par CRON_SECRET : Vercel envoie "Authorization: Bearer <CRON_SECRET>".
 */
export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: { message: "Non autorisé." } }, { status: 401 });
  const cfg = backupConfigStatus();
  if (!cfg.configured) {
    return NextResponse.json({ ok: false, message: "Sauvegardes automatiques non configurées.", missing: cfg.missing }, { status: 503 });
  }
  try {
    const r = await runR2Backup(await getDb());
    return NextResponse.json({ ok: true, key: r.key, bytes: r.bytes, counts: r.counts, deleted: r.deleted.length });
  } catch (e) {
    console.error("[racebet] sauvegarde échouée", e);
    return NextResponse.json({ ok: false, message: "Sauvegarde échouée (voir journaux Vercel)." }, { status: 500 });
  }
}
