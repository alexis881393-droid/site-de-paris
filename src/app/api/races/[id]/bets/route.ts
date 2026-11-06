import { handle, readJson } from "@/server/http";
import { placeBet } from "@/server/services/commands";

export const dynamic = "force-dynamic";
type Ctx = { params: Promise<{ id: string }> };

/**
 * Enregistrement d'un pari : SEULE opération d'écriture exposée sur les paris.
 * Aucune route PUT / PATCH / DELETE n'existe (Next.js répond 405), et la base
 * refuse de toute façon toute modification ou suppression (trigger).
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  return handle(async (db) => {
    const r = await placeBet(db, id, (await readJson(req)) as never);
    return { betId: r.bet.id, replayed: r.replayed };
  }, 201);
}
