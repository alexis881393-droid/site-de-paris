import { NextResponse } from "next/server";
import { getDb } from "@/server/db/client";
import { errorResponse } from "@/server/http";
import { buildCsv, type CsvKind } from "@/server/backup/csv";

export const dynamic = "force-dynamic";
const KINDS: CsvKind[] = ["courses", "paris", "reglements", "associes"];

/** Exports CSV comptables (séparateur ";" et BOM UTF-8 pour Excel FR). */
export async function GET(req: Request) {
  try {
    const u = new URL(req.url).searchParams;
    const kind = (u.get("type") ?? "courses") as CsvKind;
    if (!KINDS.includes(kind)) return NextResponse.json({ error: { message: "Type d'export inconnu." } }, { status: 400 });
    const csv = await buildCsv(await getDb(), kind);
    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="racebet-${kind}-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
