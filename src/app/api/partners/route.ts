import { handle, readJson } from "@/server/http";
import { updatePartners } from "@/server/services/commands";
import { getPartnersOverview } from "@/server/services/queries";

export const dynamic = "force-dynamic";

/** Associés et répartition du bénéfice de chaque course. */
export async function GET() {
  return handle((db) => getPartnersOverview(db));
}

/** Modifie les noms et parts des 4 associés (somme = 100 %). */
export async function PUT(req: Request) {
  return handle(async (db) => updatePartners(db, (await readJson(req)) as never));
}
