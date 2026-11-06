import { handle } from "@/server/http";
import { hideKnownDriver } from "@/server/services/commands";
import { listKnownDrivers } from "@/server/services/queries";

export const dynamic = "force-dynamic";

/** Registre des pilotes déjà créés, pour les réutiliser dans les prochaines courses. */
export async function GET() {
  return handle((db) => listKnownDrivers(db));
}

/** Retire un pilote du registre (?key=<nom normalisé>). Les courses passées ne sont pas modifiées. */
export async function DELETE(req: Request) {
  const key = new URL(req.url).searchParams.get("key") ?? "";
  return handle((db) => hideKnownDriver(db, key.slice(0, 120)));
}
