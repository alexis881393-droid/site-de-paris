import { asc } from "drizzle-orm";
import type { Db } from "../db/client";
import { bets, drivers, races, settlements } from "../db/schema";
import { getAccountingRows } from "../services/queries";
import { RACE_STATUS_LABEL } from "@/lib/status";
import { formatDateTime } from "@/lib/format";

export type CsvKind = "courses" | "paris" | "reglements";

const cell = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // Neutralise l'injection de formules dans Excel / Sheets.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const toCsv = (header: string[], rows: unknown[][]) =>
  "﻿" + [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";

const pct = (bps: number) => (bps / 100).toFixed(2).replace(".", ",");

export async function buildCsv(db: Db, kind: CsvKind): Promise<string> {
  if (kind === "courses") {
    const rows = await getAccountingRows(db);
    return toCsv(
      [
        "Course", "Statut", "Date", "Pilotes", "Parieurs", "Total mises", "Commission %", "Commission théorique",
        "Commission acquise", "Cagnotte distribuable", "Dû aux gagnants", "Versé aux gagnants", "Reste à payer",
        "Remboursements dus", "Remboursements effectués", "Conservé sans gagnant", "Revenu organisateur",
      ],
      rows.map((r) => {
        const a = r.accounting;
        return [
          r.name, RACE_STATUS_LABEL[r.status], formatDateTime(r.scheduledAt ?? r.createdAt), a.driverCount, a.bettorCount,
          a.totalStakes, pct(a.commissionBps), a.commissionTheoretical, a.commissionKept ?? "", a.distributable,
          a.dueToWinners, a.paidToWinners, a.remainingToPay, a.refundsDue, a.refundsPaid, a.noWinnerKept,
          a.organizerRevenue ?? "",
        ];
      }),
    );
  }

  const [raceRows, driverRows, betRows, settlementRows] = await Promise.all([
    db.select().from(races),
    db.select().from(drivers),
    db.select().from(bets).orderBy(asc(bets.createdAt), asc(bets.id)),
    db.select().from(settlements).orderBy(asc(settlements.createdAt)),
  ]);
  const raceById = new Map(raceRows.map((r) => [r.id, r]));
  const driverById = new Map(driverRows.map((d) => [d.id, d]));
  const settlementByBet = new Map(settlementRows.map((s) => [s.betId, s]));
  const betById = new Map(betRows.map((b) => [b.id, b]));

  if (kind === "paris") {
    return toCsv(
      ["Course", "Statut course", "Parieur", "Téléphone", "Pilote", "Mise", "Enregistré le", "Type règlement", "Montant dû", "Statut règlement", "Versé le"],
      betRows.map((b) => {
        const s = settlementByBet.get(b.id);
        const race = raceById.get(b.raceId)!;
        return [
          race.name, RACE_STATUS_LABEL[race.status], b.bettorName, b.phone ?? "", driverById.get(b.driverId)?.name ?? "",
          b.amount, formatDateTime(b.createdAt), s ? (s.kind === "payout" ? "Gain" : "Remboursement") : "",
          s?.amountDue ?? "", s ? (s.status === "paid" ? "Versé" : "À verser") : "", s?.paidAt ? formatDateTime(s.paidAt) : "",
        ];
      }),
    );
  }

  return toCsv(
    ["Course", "Parieur", "Téléphone", "Type", "Montant dû", "Montant versé", "Statut", "Créé le", "Versé le"],
    settlementRows.map((s) => {
      const b = betById.get(s.betId)!;
      return [
        raceById.get(s.raceId)?.name ?? "", b.bettorName, b.phone ?? "", s.kind === "payout" ? "Gain" : "Remboursement",
        s.amountDue, s.amountPaid, s.status === "paid" ? "Versé" : "À verser", formatDateTime(s.createdAt),
        s.paidAt ? formatDateTime(s.paidAt) : "",
      ];
    }),
  );
}
