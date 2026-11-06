import { handlePublic } from "@/server/http";
import { getPublicOdds } from "@/server/services/public";

export const dynamic = "force-dynamic";

/** Vue publique : cotes des pilotes et leur évolution. Aucune donnée de parieur. */
export async function GET(req: Request) {
  const course = new URL(req.url).searchParams.get("course");
  return handlePublic((db) => getPublicOdds(db, course));
}
