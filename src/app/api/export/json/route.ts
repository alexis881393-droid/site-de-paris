import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { errorResponse } from "@/server/http";
import { buildBackup } from "@/server/backup/export";

export const dynamic = "force-dynamic";

/** Export complet (sauvegarde manuelle) au format JSON versionné. */
export async function GET() {
  try {
    const backup = await buildBackup(await getDb());
    const stamp = backup.exportedAt.replace(/[:.]/g, "-");
    return new NextResponse(JSON.stringify(backup, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="racebet-sauvegarde-${stamp}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
