import { handle } from "@/server/http";
import { createAccessCode } from "@/server/services/auth";

export const dynamic = "force-dynamic";

/** Génère un code d'accès à usage unique. Le code en clair n'est renvoyé qu'une fois. */
export async function POST() {
  return handle((db, me) => createAccessCode(db, me), 201);
}
