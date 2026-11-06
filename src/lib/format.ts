export const PARIS_TZ = "Europe/Paris";

const moneyFmt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

/** 125000 → "125 000 $" */
export function formatMoney(v: number | bigint | null | undefined): string {
  if (v == null) return "—";
  return `${moneyFmt.format(v)}\u00a0$`;
}

/** 425 (centièmes) → "×4,25" */
export function formatOdds(cents: number | null | undefined): string {
  if (cents == null) return "—";
  const int = Math.trunc(cents / 100);
  const dec = String(Math.abs(cents % 100)).padStart(2, "0");
  return `×${int},${dec}`;
}

export function formatPercentBps(bps: number): string {
  const int = Math.trunc(bps / 100);
  const dec = bps % 100;
  if (dec === 0) return `${int}\u00a0%`;
  return `${int},${String(dec).padStart(2, "0").replace(/0$/, "")}\u00a0%`;
}

/** Part en pour-mille → "12,5 %" */
export function formatShare(part: number, total: number): string {
  if (total <= 0) return "—";
  const v = (part / total) * 100;
  return `${v.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}\u00a0%`;
}

const dateTimeFmt = new Intl.DateTimeFormat("fr-FR", {
  timeZone: PARIS_TZ,
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const dateFmt = new Intl.DateTimeFormat("fr-FR", {
  timeZone: PARIS_TZ,
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const timeFmt = new Intl.DateTimeFormat("fr-FR", { timeZone: PARIS_TZ, hour: "2-digit", minute: "2-digit" });

export const formatDateTime = (d: string | Date | null | undefined) => (d ? dateTimeFmt.format(new Date(d)) : "—");
export const formatDate = (d: string | Date | null | undefined) => (d ? dateFmt.format(new Date(d)) : "—");
export const formatTime = (d: string | Date | null | undefined) => (d ? timeFmt.format(new Date(d)) : "—");

/** Décalage (minutes) du fuseau Europe/Paris à un instant donné. */
function parisOffsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PARIS_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** "2026-11-06T21:30" saisi à l'heure de Paris → Date UTC exacte. */
export function parisLocalToDate(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let offset = parisOffsetMinutes(new Date(guess));
  let result = guess - offset * 60000;
  offset = parisOffsetMinutes(new Date(result));
  result = guess - offset * 60000;
  const date = new Date(result);
  return Number.isNaN(date.getTime()) ? null : date;
}
