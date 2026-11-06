import { handle, readJson } from "@/server/http";
import { createRace } from "@/server/services/commands";
import { listRaces, toRaceDTO } from "@/server/services/queries";
import { RACE_STATUSES, type RaceStatus } from "@/lib/constants";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const s = url.searchParams.get("status");
  const status = s && (RACE_STATUSES as readonly string[]).includes(s) ? (s as RaceStatus) : undefined;
  const q = url.searchParams.get("q")?.slice(0, 120) || undefined;
  return handle((db) => listRaces(db, { q, status }));
}

export async function POST(req: Request) {
  return handle(async (db) => toRaceDTO(await createRace(db, (await readJson(req)) as never)), 201);
}
