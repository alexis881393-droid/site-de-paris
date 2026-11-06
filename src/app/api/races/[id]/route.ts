import { handle } from "@/server/http";
import { deleteRace } from "@/server/services/commands";
import { getRaceDetail } from "@/server/services/queries";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle((db) => getRaceDetail(db, id));
}

/** Suppression : uniquement une course sans pari (contrôlé côté serveur et en base). */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle((db) => deleteRace(db, id));
}
