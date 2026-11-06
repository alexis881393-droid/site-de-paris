import { handle } from "@/server/http";
import { getBackupStatus } from "@/server/services/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle((db) => getBackupStatus(db));
}
