import { handle } from "@/server/http";
import { paySettlement } from "@/server/services/commands";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/** Marque un gain ou un remboursement comme versé. Idempotent (double clic sans effet). */
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async (db) => {
    const r = await paySettlement(db, id);
    return { alreadyPaid: r.alreadyPaid, raceStatus: r.raceStatus, settlementId: r.settlement.id };
  });
}
