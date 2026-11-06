import { handle } from "@/server/http";
import { revokeAccessCode } from "@/server/services/auth";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** Révoque un code encore inutilisé. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle((db, me) => revokeAccessCode(db, id, me));
}
