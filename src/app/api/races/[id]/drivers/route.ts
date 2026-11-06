import { handle, readJson } from "@/server/http";
import { addDriver } from "@/server/services/commands";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async (db) => addDriver(db, id, (await readJson(req)) as never), 201);
}
