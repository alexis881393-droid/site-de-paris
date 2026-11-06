import type { DbOrTx } from "./db/client";
import { operationLog, type OperationType } from "./db/schema";

export async function logOperation(
  db: DbOrTx,
  type: OperationType,
  raceId: string | null,
  payload: Record<string, unknown> = {},
) {
  await db.insert(operationLog).values({ type, raceId, payload });
}
