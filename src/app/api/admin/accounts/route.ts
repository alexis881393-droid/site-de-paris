import { handle } from "@/server/http";
import { getAccountsOverview } from "@/server/services/auth";

export const dynamic = "force-dynamic";

/** Liste des comptes et des codes d'accès (espace privé). */
export async function GET() {
  return handle((db, me) => getAccountsOverview(db, me));
}
