import { handle } from "@/server/http";
import { deleteAccount } from "@/server/services/auth";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle((db, me) => deleteAccount(db, id, me));
}
