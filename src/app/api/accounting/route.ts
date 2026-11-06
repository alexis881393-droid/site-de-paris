import { handle } from "@/server/http";
import { getGlobalAccounting } from "@/server/services/queries";
import { RACE_STATUSES, type RaceStatus } from "@/lib/constants";

export const dynamic = "force-dynamic";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams;
  const s = u.get("status");
  const from = u.get("from");
  const to = u.get("to");
  return handle((db) =>
    getGlobalAccounting(db, {
      status: s && (RACE_STATUSES as readonly string[]).includes(s) ? (s as RaceStatus) : undefined,
      q: u.get("q")?.slice(0, 120) || undefined,
      from: from && DAY.test(from) ? from : undefined,
      to: to && DAY.test(to) ? to : undefined,
    }),
  );
}
