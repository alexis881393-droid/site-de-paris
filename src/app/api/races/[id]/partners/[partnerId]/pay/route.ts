import { handle } from "@/server/http";
import { payPartnerShare } from "@/server/services/commands";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string; partnerId: string }> };

/** Marque la part d'un associé comme versée (fige la répartition de la course). Idempotent. */
export async function POST(_req: Request, { params }: Ctx) {
  const { id, partnerId } = await params;
  return handle(async (db) => {
    const r = await payPartnerShare(db, id, partnerId);
    return { alreadyPaid: r.alreadyPaid, payoutId: r.payout.id };
  });
}
