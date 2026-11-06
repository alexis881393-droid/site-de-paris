import { handle, readJson } from "@/server/http";
import { removeDriver, updateDriver } from "@/server/services/commands";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; driverId: string }> };

/** Correction d'un pilote : uniquement en préparation (contrôlé côté serveur et en base). */
export async function PATCH(req: Request, { params }: Ctx) {
  const { id, driverId } = await params;
  return handle(async (db) => updateDriver(db, id, driverId, (await readJson(req)) as never));
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, driverId } = await params;
  return handle((db) => removeDriver(db, id, driverId));
}
