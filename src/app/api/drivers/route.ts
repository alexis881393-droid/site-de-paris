import { handle } from "@/server/http";
import { listKnownDrivers } from "@/server/services/queries";

export const dynamic = "force-dynamic";

/** Registre des pilotes déjà créés (lecture seule), pour les réutiliser dans les prochaines courses. */
export async function GET() {
  return handle((db) => listKnownDrivers(db));
}
