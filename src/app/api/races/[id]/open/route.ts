import { handle } from "@/server/http";
import { openBets } from "@/server/services/commands";
import { toRaceDTO } from "@/server/services/queries";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async (db) => toRaceDTO(await openBets(db, id)));
}
